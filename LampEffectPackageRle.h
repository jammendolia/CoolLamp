#pragma once
#include <stddef.h>
#include <stdint.h>

// Private prototype codec, not Heatshrink. CLRC wraps the token-RLE format
// from tools/measure-effect-pack-compression.py; CLFX is its raw fallback.
// Input must remain immutable during this call and must not overlap output.
// Structural failures set decoded=0 and leave output unchanged. This does
// not authenticate a publisher or check the decoded CLFX checksum/bytecode;
// the package player must validate those before preparing or displaying it.
namespace LampEffectPackageRle {
constexpr size_t HeaderBytes=12, MaxDecodedBytes=32+128*12;
constexpr uint8_t Version=1, Codec=1;
namespace detail {
inline uint16_t u16(const uint8_t* p){return uint16_t(p[0])|(uint16_t(p[1])<<8);}
inline uint32_t u32(const uint8_t* p){return uint32_t(u16(p))|(uint32_t(u16(p+2))<<16);}
inline bool magic(const uint8_t* p,char a,char b,char c,char d){return p[0]==a&&p[1]==b&&p[2]==c&&p[3]==d;}
inline bool overlaps(const uint8_t* source,size_t size,const uint8_t* output,size_t count){
  const auto a=reinterpret_cast<uintptr_t>(source),b=reinterpret_cast<uintptr_t>(output);
  return a<=b?b-a<size:a-b<count;
}
}
inline bool decode(const uint8_t* source,size_t size,uint8_t* output,size_t capacity,size_t& decoded) noexcept {
  decoded=0;
  if(!source||!output||size<4)return false;
  if(detail::magic(source,'C','L','F','X')){
    if(size<32||size>MaxDecodedBytes||size>capacity||detail::u32(source+12)!=size||
       detail::overlaps(source,size,output,size))return false;
    for(size_t n=0;n<size;++n)output[n]=source[n];
    decoded=size;return true;
  }
  if(!detail::magic(source,'C','L','R','C')||size<HeaderBytes||source[4]!=Version||source[5]!=Codec||
     source[10]||source[11])return false;
  const size_t expected=detail::u16(source+6),encoded=detail::u16(source+8);
  if(expected<32||expected>MaxDecodedBytes||expected>capacity||encoded!=size-HeaderBytes||
     detail::overlaps(source,size,output,expected))return false;
  // Preflight without writes: bound every literal/run and require exact output.
  size_t at=HeaderBytes,written=0;
  while(at<size){
    const uint8_t token=source[at++];
    const size_t count=token<128?size_t(token)+1:size_t(token&127)+3;
    if(count>expected-written)return false;
    if(token<128){if(count>size-at)return false;at+=count;}
    else {if(at==size)return false;++at;}
    written+=count;
  }
  if(written!=expected)return false;
  // The immutable, disjoint input has passed all structural/output checks.
  at=HeaderBytes;written=0;
  while(at<size){
    const uint8_t token=source[at++];
    const size_t count=token<128?size_t(token)+1:size_t(token&127)+3;
    if(token<128)for(size_t n=0;n<count;++n)output[written++]=source[at++];
    else {const uint8_t value=source[at++];for(size_t n=0;n<count;++n)output[written++]=value;}
  }
  decoded=written;return true;
}
}
