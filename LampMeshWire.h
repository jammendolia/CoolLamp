#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// All identities are Wi-Fi STA MAC addresses. The immutable header is AEAD
// associated data; TTL and retry wave are authenticated separately at each hop.
namespace LampMeshWire {
constexpr size_t HeaderSize=52, HopSize=2, TagSize=16, PayloadLimit=160;
constexpr size_t WireLimit=HeaderSize+HopSize+PayloadLimit+2*TagSize;
constexpr size_t RequestLimit=1024, ResponseLimit=8192;
constexpr uint8_t HopLimit=4, AttemptLimit=7;
enum Kind:uint8_t {Presence=1,Challenge=2,ChallengeReply=3,Request=4,Receipt=5,Response=6,ResponseReceipt=7};
enum ReceiptCode:uint8_t {Receiving=1,Executed=2,Rejected=3,Busy=4};
struct Packet {
 uint8_t origin[6]{},target[6]{};
 uint64_t boot=0,targetBoot=0,requestId=0;
 uint32_t sequence=0;
 uint8_t kind=0,index=0,count=1,payloadSize=0;
 uint16_t totalSize=0,status=0;
};
inline uint16_t u16(const uint8_t* p){return uint16_t(p[0])|uint16_t(p[1])<<8;}
inline uint32_t u32(const uint8_t* p){return uint32_t(u16(p))|uint32_t(u16(p+2))<<16;}
inline uint64_t u64(const uint8_t* p){return uint64_t(u32(p))|uint64_t(u32(p+4))<<32;}
inline void put16(uint8_t* p,uint16_t n){p[0]=uint8_t(n);p[1]=uint8_t(n>>8);}
inline void put32(uint8_t* p,uint32_t n){put16(p,uint16_t(n));put16(p+2,uint16_t(n>>16));}
inline void put64(uint8_t* p,uint64_t n){put32(p,uint32_t(n));put32(p+4,uint32_t(n>>32));}
inline bool mac(const uint8_t* p){if(!p||(p[0]&1))return false;uint8_t any=0;for(unsigned i=0;i<6;++i)any|=p[i];return any!=0;}
inline bool same(const uint8_t* a,const uint8_t* b){return memcmp(a,b,6)==0;}
inline bool zeroMac(const uint8_t* p){uint8_t any=0;for(unsigned i=0;i<6;++i)any|=p[i];return !any;}
inline uint8_t fragments(size_t n){return uint8_t(n?(n+PayloadLimit-1)/PayloadLimit:1);}
inline size_t fragmentSize(size_t n,uint8_t i){const size_t offset=size_t(i)*PayloadLimit;return n>offset?(n-offset<PayloadLimit?n-offset:PayloadLimit):0;}
inline uint64_t mask(uint8_t n){return n==64?~uint64_t(0):(uint64_t(1)<<n)-1;}
inline bool valid(const Packet& p){
 if(!mac(p.origin)||!p.boot||!p.sequence||p.payloadSize>PayloadLimit||p.kind<Presence||p.kind>ResponseReceipt)return false;
 if(p.kind==Presence)return zeroMac(p.target)&&!p.targetBoot&&!p.requestId&&!p.index&&p.count==1&&!p.status&&p.totalSize==p.payloadSize&&p.payloadSize>=3;
 if(!mac(p.target)||same(p.origin,p.target)||!p.targetBoot||!p.requestId)return false;
 if(p.kind==Challenge||p.kind==ChallengeReply)return !p.payloadSize&&!p.totalSize&&!p.status&&!p.index&&p.count==1;
 if(p.kind==Receipt)return p.payloadSize==9&&!p.index&&p.count==1&&p.totalSize<=ResponseLimit&&(p.status==0||(p.status>=100&&p.status<=599));
 if(p.kind==ResponseReceipt)return p.payloadSize==8&&!p.index&&p.count==1&&!p.status&&p.totalSize<=ResponseLimit;
 const size_t limit=p.kind==Request?RequestLimit:ResponseLimit;
 return p.totalSize<=limit&&p.count==fragments(p.totalSize)&&p.index<p.count&&p.payloadSize==fragmentSize(p.totalSize,p.index)&&
   p.sequence>p.index&&(p.kind==Request?!p.status:(p.status>=100&&p.status<=599));
}
inline void encode(const Packet& p,uint8_t* out){
 memcpy(out,"CLM\1",4);memcpy(out+4,p.origin,6);memcpy(out+10,p.target,6);put64(out+16,p.boot);put64(out+24,p.targetBoot);put64(out+32,p.requestId);
 put32(out+40,p.sequence);out[44]=p.kind;out[45]=p.index;out[46]=p.count;out[47]=p.payloadSize;put16(out+48,p.totalSize);put16(out+50,p.status);
}
inline bool decode(const uint8_t* in,size_t n,Packet& p){
 if(!in||n<HeaderSize+HopSize+2*TagSize||n>WireLimit||memcmp(in,"CLM\1",4))return false;
 memcpy(p.origin,in+4,6);memcpy(p.target,in+10,6);p.boot=u64(in+16);p.targetBoot=u64(in+24);p.requestId=u64(in+32);p.sequence=u32(in+40);
 p.kind=in[44];p.index=in[45];p.count=in[46];p.payloadSize=in[47];p.totalSize=u16(in+48);p.status=u16(in+50);
 return valid(p)&&n==HeaderSize+HopSize+p.payloadSize+2*TagSize&&in[HeaderSize]<HopLimit&&in[HeaderSize+1]<=AttemptLimit;
}
static_assert(WireLimit<=250,"Fit every ESP-NOW radio version");
static_assert((ResponseLimit+PayloadLimit-1)/PayloadLimit<=64,"Fragment receipts fit one bitmap");
}
