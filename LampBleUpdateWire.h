#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <atomic>

namespace LampBleUpdateWire {
constexpr size_t MaxFrame=244, Header=8, DataHeader=12, MaxData=MaxFrame-DataHeader, ManifestCapacity=288;
// Status byte 3 keeps its legacy committed bit. Fast data uses at most four
// copied frames before a written-offset ACK; the receiver queue stays at eight.
constexpr uint8_t CommittedFlag=0x01, DataWriteWithoutResponseFourFlag=0x02, ResumeLeaseFlag=0x04, DetachedFlag=0x08;
constexpr unsigned DataWriteWithoutResponseWindow=4;
enum Operation:uint8_t { Manifest=1,Start=2,Data=3,Finish=4,Cancel=5,StartWithLease=6,Resume=7 };
enum Phase:uint8_t { Idle=0,Preparing=1,Receiving=2,Verifying=3,Restarting=4,Error=5 };
enum Result:uint8_t { Ok=0,Denied=1,Busy=2,Invalid=3,Offset=4,Image=5,Flash=6,Expired=7,Cancelled=8,Partition=9 };
inline uint16_t u16(const uint8_t* p){return p[0]|uint16_t(p[1])<<8;}
inline uint32_t u32(const uint8_t* p){return p[0]|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
inline void put16(uint8_t* p,uint16_t v){p[0]=v;p[1]=v>>8;}
inline void put32(uint8_t* p,uint32_t v){for(unsigned i=0;i<4;++i)p[i]=v>>(i*8);}
inline bool valid(const uint8_t* p,size_t n){
 if(!p||n<Header||n>MaxFrame||p[0]!=1||!u32(p+2)||!u16(p+6))return false;
 return p[1]==Manifest?n>10&&u16(p+8)+n-10<ManifestCapacity:p[1]==Data?n>DataHeader:p[1]==Resume?n==50:n==Header&&(p[1]==Start||p[1]==StartWithLease||p[1]==Finish||p[1]==Cancel);
}
struct Frame {uint32_t generation=0;uint16_t length=0;uint8_t bytes[MaxFrame]{};};
class Queue {
 static constexpr unsigned Slots=9;
 Frame frames[Slots]{};std::atomic<unsigned> head{0},tail{0};
 public:
 bool push(const Frame& frame){const unsigned h=head.load(std::memory_order_relaxed),next=(h+1)%Slots;if(next==tail.load(std::memory_order_acquire))return false;frames[h]=frame;head.store(next,std::memory_order_release);return true;}
 bool pop(Frame& frame){const unsigned t=tail.load(std::memory_order_relaxed);if(t==head.load(std::memory_order_acquire))return false;frame=frames[t];tail.store((t+1)%Slots,std::memory_order_release);return true;}
};
}
