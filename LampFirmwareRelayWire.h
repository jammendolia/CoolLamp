#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
namespace LampFirmwareRelayWire {
constexpr size_t Header=16,Tag=16,BodyLimit=218,DataLimit=201;
enum Kind:uint8_t {Offer=1,Request=2,Data=3,Ack=4,Finish=5,Reject=6,SignedOffer=7};
inline uint32_t u32(const uint8_t* p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
inline uint64_t u64(const uint8_t* p){return uint64_t(u32(p))|uint64_t(u32(p+4))<<32;}
inline void put32(uint8_t* p,uint32_t v){for(unsigned i=0;i<4;++i)p[i]=v>>(8*i);}
inline void put64(uint8_t* p,uint64_t v){put32(p,uint32_t(v));put32(p+4,uint32_t(v>>32));}
inline bool valid(const uint8_t* p,size_t n){
 if(!p||!n)return false;
 switch(p[0]){
 case Offer:return n==51&&u32(p+7)>=288&&u32(p+7)<=2031616&&u64(p+43);
 case SignedOffer:return n==123&&u32(p+7)>=288&&u32(p+7)<=2031616&&u64(p+43)&&u32(p+51)&&u32(p+55);
 case Request:return n==49&&u64(p+1)&&u64(p+41);
 case Data:return n>=14&&n<=13+DataLimit&&u64(p+1);
 case Ack:return n==14&&u64(p+1)&&p[13]<=2;
 case Finish:case Reject:return n==9&&u64(p+1);
 default:return false;
 }
}
// One exact offset is acknowledged. Duplicates are acknowledged without writing
// again; future/out-of-order chunks cannot advance or commit the receiver.
inline bool duplicate(uint32_t offset,size_t size,uint32_t written){return offset<written&&size<=written-offset;}
}
