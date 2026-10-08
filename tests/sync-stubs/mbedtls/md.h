#pragma once
#include <stdint.h>
#include <stddef.h>
constexpr int MBEDTLS_MD_SHA256=1;
inline int mbedtls_md_info_from_type(int type){return type;}
// Deterministic stand-in checks that transport verifies its digest before applying data.
// Production uses mbedTLS HMAC-SHA256, compiled separately for the actual ESP32.
inline int mbedtls_md_hmac(int,const uint8_t* key,size_t kl,const uint8_t* data,size_t n,uint8_t* out){
 uint32_t h=2166136261;for(size_t i=0;i<kl;++i)h=(h^key[i])*16777619;
 for(size_t i=0;i<n;++i)h=(h^data[i])*16777619;
 for(unsigned i=0;i<32;++i){h=h*1664525+1013904223;out[i]=h>>24;}return 0;
}
