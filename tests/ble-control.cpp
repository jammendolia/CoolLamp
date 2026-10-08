#include "../LampBleControlWire.h"
#include <algorithm>
#include <cassert>
#include <iostream>
#include <vector>
using namespace LampBleControlWire;

std::vector<uint8_t> start(uint16_t tx,uint8_t endpoint=7,uint8_t method=Mutation,uint16_t size=0){
  std::vector<uint8_t> f{1,1,Begin,uint8_t(tx),uint8_t(tx>>8),endpoint,method,uint8_t(size),uint8_t(size>>8)};return f;
}
std::vector<uint8_t> part(uint16_t tx,uint16_t offset,const uint8_t* bytes,size_t size){
  std::vector<uint8_t> f{1,2,Chunk,uint8_t(tx),uint8_t(tx>>8),uint8_t(offset),uint8_t(offset>>8)};
  f.insert(f.end(),bytes,bytes+size);return f;
}
std::vector<uint8_t> commit(uint16_t tx){return {1,3,Commit,uint8_t(tx),uint8_t(tx>>8)};}
std::vector<uint8_t> page(uint16_t tx,uint16_t offset){return {1,4,Page,uint8_t(tx),uint8_t(tx>>8),uint8_t(offset),uint8_t(offset>>8)};}
bool begin(Transfer& transfer,uint16_t tx,uint8_t endpoint=7,uint8_t method=Mutation,uint16_t size=0,uint32_t owner=9,uint32_t now=100){
  const auto frame=start(tx,endpoint,method,size);return transfer.begin(frame.data(),frame.size(),owner,now);
}
void appendAll(Transfer& transfer,uint16_t tx,const std::vector<uint8_t>& body,uint32_t owner=9,uint32_t now=100){
  for(size_t offset=0;offset<body.size();offset+=13){
    const auto frame=part(tx,offset,body.data()+offset,std::min(size_t(13),body.size()-offset));
    assert(validFrame(frame.data(),frame.size()));assert(transfer.append(frame.data(),frame.size(),owner,now));
  }
}
bool consume(Transfer& transfer,uint16_t tx,uint32_t owner=9,uint32_t now=100){
  const auto frame=commit(tx);return transfer.consume(frame.data(),frame.size(),owner,now);
}
void wiped(const Transfer& transfer){for(size_t i=0;i<MaxRequest+1;++i)assert(transfer.body()[i]==0);}

int main(){
  static_assert(MaxFrame==20&&Header==12&&MaxPage==492,"Keep the agreed minimum-MTU framing");
  for(uint8_t endpoint=1;endpoint<=26;++endpoint){
    const bool read=endpoint==1||endpoint==2||endpoint==18||endpoint==24||endpoint==26;
    auto f=start(1,endpoint,Read);assert(validFrame(f.data(),f.size())==read);
    const bool mutate=(endpoint>=3&&endpoint<=17)||(endpoint>=19&&endpoint<=25);
    f=start(1,endpoint,Mutation);assert(validFrame(f.data(),f.size())==mutate);
  }
  auto f=start(1,1,Read,1);assert(!validFrame(f.data(),f.size()));
  f=start(1,7,Mutation,1025);assert(!validFrame(f.data(),f.size()));
  f=start(0);assert(!validFrame(f.data(),f.size()));
  f=start(1);f[0]=2;assert(!validFrame(f.data(),f.size()));
  f[0]=1;f[1]=0;assert(!validFrame(f.data(),f.size()));
  for(size_t n=0;n<9;++n)assert(!validFrame(f.data(),n));
  assert(!validFrame(nullptr,9));

  Transfer transfer;
  std::vector<uint8_t> body(MaxRequest,'p');body[MaxRequest-1]='Z';
  assert(begin(transfer,40000,7,Mutation,body.size()));appendAll(transfer,40000,body);
  assert(transfer.bodySize()==MaxRequest&&!memcmp(transfer.body(),body.data(),body.size()));
  assert(transfer.body()[MaxRequest]==0);
  assert(consume(transfer,40000));assert(!consume(transfer,40000));
  std::vector<uint8_t> response(MaxResponse);for(size_t i=0;i<response.size();++i)response[i]=i%253;
  assert(transfer.finish(200,response.data(),response.size()));wiped(transfer);
  std::vector<uint8_t> reconstructed;uint8_t output[MaxPage]{};
  for(uint16_t offset=0;offset<MaxResponse;offset+=PageBytes){
    f=page(40000,offset);assert(transfer.selectPage(f.data(),f.size(),9,150));
    const size_t size=transfer.page(offset,output,sizeof(output));
    assert(size>=Header&&size<=MaxPage&&output[0]==1&&u16(output+1)==40000&&output[3]==7);
    assert(u16(output+4)==200&&u16(output+6)==MaxResponse&&u16(output+8)==offset&&u16(output+10)==size-Header);
    reconstructed.insert(reconstructed.end(),output+Header,output+size);
  }
  assert(reconstructed==response);
  f=page(40000,MaxResponse);assert(transfer.selectPage(f.data(),f.size(),9,150));
  assert(transfer.page(MaxResponse,output,sizeof(output))==Header&&u16(output+10)==0);
  assert(!begin(transfer,40000)&&!begin(transfer,39999));assert(!consume(transfer,40000));
  assert(begin(transfer,40001,7,Mutation,3));wiped(transfer);
  const uint8_t secret[]={'p','w','d'};
  f=part(40001,0,secret,sizeof(secret));assert(transfer.append(f.data(),f.size(),9,200));
  assert(!consume(transfer,40001,8,200));
  f=part(40001,0,secret,sizeof(secret));assert(!transfer.append(f.data(),f.size(),9,200));wiped(transfer);
  assert(!begin(transfer,40001));
  assert(begin(transfer,40002,7,Mutation,3));
  f=part(40002,0,secret,sizeof(secret));assert(transfer.append(f.data(),f.size(),9,200));
  assert(!transfer.service(9,10199,true,false));
  assert(transfer.service(9,10200,true,false));wiped(transfer);assert(!consume(transfer,40002,9,10200));
  assert(!begin(transfer,40002));assert(begin(transfer,40003,7,Mutation,3));
  f=part(40003,0,secret,sizeof(secret));assert(transfer.append(f.data(),f.size(),9,200));
  f=start(40003,0,0,0);assert(transfer.begin(f.data(),f.size(),9,300));wiped(transfer);
  assert(!consume(transfer,40003));assert(!begin(transfer,40003));
  assert(begin(transfer,40004,7,Mutation,3));
  assert(transfer.service(10,300,true,false));wiped(transfer);
  assert(begin(transfer,40004,7,Mutation,0,10));assert(consume(transfer,40004,10));
  assert(!transfer.finish(200,response.data(),MaxResponse+1));
  transfer.reset(9);
  assert(begin(transfer,65534));assert(consume(transfer,65534));assert(transfer.finish(200,nullptr,0));
  assert(begin(transfer,65535));assert(consume(transfer,65535));assert(transfer.finish(204,nullptr,0));
  assert(begin(transfer,1));assert(consume(transfer,1));assert(transfer.finish(200,nullptr,0));
  assert(!begin(transfer,65535));

  transfer.reset(9);
  assert(begin(transfer,1,7,Mutation,3,9,0xffffff00U));
  f=part(1,0,secret,sizeof(secret));assert(transfer.append(f.data(),f.size(),9,0xffffff00U));
  assert(!transfer.service(9,0x100U,true,false));assert(consume(transfer,1,9,0x100U));
  assert(transfer.finish(200,secret,sizeof(secret)));assert(transfer.service(9,0x100U,false,false));wiped(transfer);
  assert(begin(transfer,2));assert(transfer.service(9,100,true,true));wiped(transfer);
  assert(begin(transfer,3,18,Read));assert(!transfer.service(9,100,true,true));

  FrameQueue queue;Frame frame;frame.generation=42;frame.length=20;
  const char key[]="private-password";memcpy(frame.bytes,key,sizeof(key));
  for(unsigned i=0;i<8;++i)assert(queue.push(frame));
  assert(!queue.push(frame));
  Frame received;
  for(unsigned i=0;i<8;++i){assert(queue.pop(received));assert(received.generation==42&&received.length==20&&!memcmp(received.bytes,key,sizeof(key)));}
  assert(!queue.pop(received));
  const auto* representation=reinterpret_cast<const uint8_t*>(&queue);
  assert(std::search(representation,representation+sizeof(queue),reinterpret_cast<const uint8_t*>(key),reinterpret_cast<const uint8_t*>(key)+sizeof(key))==representation+sizeof(queue));
  for(unsigned i=0;i<30;++i){assert(queue.push(frame));assert(queue.pop(received));}
  std::cout<<"PASS: bounded BLE RPC framing, complete 8192-byte paging, owner/replay/timeout/cancel fences, request and queue zeroization, rollover and update cleanup\n";
}
