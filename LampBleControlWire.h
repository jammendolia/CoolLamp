#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <atomic>

namespace LampBleControlWire {
constexpr uint8_t Version=1, Begin=22, Chunk=23, Commit=24, Page=25;
constexpr uint8_t Read=1, Mutation=2;
constexpr size_t MaxFrame=20, MaxRequest=1024, MaxResponse=8192;
constexpr size_t Header=12, PageBytes=480, MaxPage=Header+PageBytes;
constexpr uint32_t Timeout=10000;
inline bool operation(uint8_t op){return op>=Begin&&op<=Page;}
inline uint16_t u16(const uint8_t* p){return uint16_t(p[0])|uint16_t(p[1])<<8;}
inline void put16(uint8_t* p,uint16_t value){p[0]=value;p[1]=value>>8;}
inline void zero(void* data,size_t size){volatile uint8_t* p=static_cast<volatile uint8_t*>(data);while(size--)*p++=0;}
inline bool endpoint(uint8_t id,uint8_t method){
  if(method==Read)return id==1||id==2||id==18||id==24||id==26;
  return method==Mutation&&((id>=3&&id<=17)||(id>=19&&id<=25));
}
inline bool validFrame(const uint8_t* frame,size_t size){
  if(!frame||size<5||size>MaxFrame||frame[0]!=Version||!frame[1])return false;
  const uint16_t tx=u16(frame+3);
  switch(frame[2]){
  case Begin:
    return size==9&&((frame[5]==0&&frame[6]==0&&u16(frame+7)==0)||
      (tx&&endpoint(frame[5],frame[6])&&u16(frame+7)<=MaxRequest&&(frame[6]!=Read||u16(frame+7)==0)));
  case Chunk:return tx&&size>=8&&u16(frame+5)<MaxRequest&&!memchr(frame+7,0,size-7);
  case Commit:return tx&&size==5;
  case Page:return tx&&size==7&&u16(frame+5)<=MaxResponse;
  default:return false;
  }
}
inline size_t header(uint8_t* out,uint16_t tx,uint8_t id,uint16_t status,uint16_t total,uint16_t offset,uint16_t length){
  out[0]=Version;put16(out+1,tx);out[3]=id;put16(out+4,status);put16(out+6,total);
  put16(out+8,offset);put16(out+10,length);return Header;
}

struct Frame {uint32_t generation=0;uint8_t length=0,bytes[MaxFrame]{};};
// NimBLE is the only producer; the Arduino loop is the only consumer. Slot
// clearing precedes releasing the head, so no password fragment is retained.
class FrameQueue {
  static constexpr uint8_t Slots=9;
  Frame frames[Slots]{};
  std::atomic<uint8_t> head{0},tail{0};
public:
  bool push(const Frame& frame){
    const uint8_t write=tail.load(std::memory_order_relaxed),next=(write+1)%Slots;
    if(next==head.load(std::memory_order_acquire))return false;
    frames[write]=frame;tail.store(next,std::memory_order_release);return true;
  }
  bool pop(Frame& frame){
    const uint8_t read=head.load(std::memory_order_relaxed);
    if(read==tail.load(std::memory_order_acquire))return false;
    frame=frames[read];zero(&frames[read],sizeof(Frame));
    head.store((read+1)%Slots,std::memory_order_release);return true;
  }
};

class Transfer {
  uint8_t request[MaxRequest+1]{};
  uint8_t* response=nullptr;
  uint32_t owner=0,touched=0;
  uint16_t transaction=0,lastTransaction=0,total=0,received=0,responseSize=0,responseStatus=0;
  uint8_t id=0,method=0;
  enum Phase:uint8_t {Idle,Receiving,Consumed,Responded} phase=Idle;
  bool sequenceReady=false;
  bool matches(const uint8_t* frame,uint32_t generation)const{return owner==generation&&transaction&&u16(frame+3)==transaction;}
public:
  ~Transfer(){reset();}
  Transfer()=default;
  Transfer(const Transfer&)=delete;
  Transfer& operator=(const Transfer&)=delete;
  void clearPayload(){
    zero(request,sizeof(request));
    if(response){zero(response,responseSize);free(response);response=nullptr;}
    transaction=total=received=responseSize=responseStatus=0;id=method=0;touched=0;phase=Idle;
  }
  void reset(uint32_t generation=0){clearPayload();owner=generation;lastTransaction=0;sequenceReady=false;}
  bool service(uint32_t generation,uint32_t now,bool authorized,bool updating){
    if(owner!=generation){reset(generation);return true;}
    if(!authorized||(updating&&id!=18)||(phase!=Idle&&uint32_t(now-touched)>=Timeout)){
      const bool existed=phase!=Idle;clearPayload();return existed;
    }
    return false;
  }
  bool begin(const uint8_t* frame,size_t size,uint32_t generation,uint32_t now){
    if(!validFrame(frame,size)||frame[2]!=Begin)return false;
    if(owner!=generation)reset(generation);
    const uint16_t next=u16(frame+3);
    if(frame[5]==0){if(next&&next!=transaction)return false;clearPayload();return true;}
    if(sequenceReady&&int16_t(uint16_t(next-lastTransaction))<=0)return false;
    clearPayload();transaction=lastTransaction=next;sequenceReady=true;
    id=frame[5];method=frame[6];total=u16(frame+7);touched=now;phase=Receiving;return true;
  }
  bool append(const uint8_t* frame,size_t size,uint32_t generation,uint32_t now){
    if(!validFrame(frame,size)||frame[2]!=Chunk||!matches(frame,generation)||phase!=Receiving||
       uint32_t(now-touched)>=Timeout||u16(frame+5)!=received||received+size-7>total){
      clearPayload();return false;
    }
    memcpy(request+received,frame+7,size-7);received+=size-7;touched=now;return true;
  }
  bool consume(const uint8_t* frame,size_t size,uint32_t generation,uint32_t now){
    if(!validFrame(frame,size)||frame[2]!=Commit||!matches(frame,generation)||phase!=Receiving||
       uint32_t(now-touched)>=Timeout||received!=total)return false;
    // Claim before calling a setter. A lost response cannot execute it again.
    phase=Consumed;touched=now;return true;
  }
  bool finish(uint16_t status,const uint8_t* bytes,size_t size){
    if(phase!=Consumed||size>MaxResponse||(size&&!bytes))return false;
    zero(request,sizeof(request));total=received=0;
    if(size){response=static_cast<uint8_t*>(malloc(size));if(!response)return false;memcpy(response,bytes,size);}
    responseSize=size;responseStatus=status;phase=Responded;return true;
  }
  bool selectPage(const uint8_t* frame,size_t size,uint32_t generation,uint32_t now){
    if(!validFrame(frame,size)||frame[2]!=Page||!matches(frame,generation)||phase!=Responded||
       uint32_t(now-touched)>=Timeout||u16(frame+5)>responseSize)return false;
    touched=now;return true;
  }
  size_t page(uint16_t offset,uint8_t* out,size_t capacity)const{
    if(phase!=Responded||offset>responseSize||!out||capacity<Header)return 0;
    size_t length=responseSize-offset;if(length>PageBytes)length=PageBytes;
    if(length>capacity-Header)length=capacity-Header;
    header(out,transaction,id,responseStatus,responseSize,offset,length);
    if(length)memcpy(out+Header,response+offset,length);
    return Header+length;
  }
  size_t pending(uint8_t* out,size_t capacity)const{
    if(!out||capacity<Header)return 0;
    return header(out,transaction,id,202,0,0,0);
  }
  const uint8_t* body()const{return request;}
  uint16_t bodySize()const{return total;}
  uint8_t endpointId()const{return id;}
  bool mutation()const{return method==Mutation;}
  bool active()const{return phase!=Idle;}
};
}
