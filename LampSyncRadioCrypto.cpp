#include "LampSyncRadioCrypto.h"
#include <mbedtls/gcm.h>
#include <mbedtls/md.h>
#include <cstring>
#include <cstdio>

namespace LampSyncRadioCrypto {
namespace {
constexpr uint8_t magic[4]={'C','L','N',1};
void erase(void* memory,size_t length){volatile uint8_t* bytes=static_cast<volatile uint8_t*>(memory);while(length--)*bytes++=0;}
bool derive(const char* a,const char* b,const uint8_t* groupKey,uint8_t* key) {
  if(!LampSyncWire::id(a)||!LampSyncWire::id(b)||!strcmp(a,b)||!groupKey)return false;
  constexpr char domain[]="CoolLamp ESP-NOW AES-GCM v1";
  uint8_t input[sizeof(domain)-1+24],hash[32];memcpy(input,domain,sizeof(domain)-1);
  const bool first=strcmp(a,b)<0;memcpy(input+sizeof(domain)-1,first?a:b,12);memcpy(input+sizeof(domain)-1+12,first?b:a,12);
  const int result=mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),groupKey,16,input,sizeof(input),hash);
  if(!result)memcpy(key,hash,16);
  erase(hash,sizeof(hash));return result==0;
}
bool deriveBroadcast(const char* sender,const uint8_t* groupKey,uint8_t* key) {
  if(!LampSyncWire::id(sender)||!groupKey)return false;
  constexpr char domain[]="CoolLamp scene broadcast v3";
  uint8_t input[sizeof(domain)-1+12],hash[32]{};
  memcpy(input,domain,sizeof(domain)-1);memcpy(input+sizeof(domain)-1,sender,12);
  const int result=mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),groupKey,16,input,sizeof(input),hash);
  if(!result)memcpy(key,hash,16);
  erase(hash,sizeof(hash));return result==0;
}
}
bool identityFromMac(const uint8_t* address,char* identity) {
  if(!address||!identity||(address[0]&1))return false;
  uint8_t any=0;for(unsigned i=0;i<6;++i)any|=address[i];if(!any)return false;
  snprintf(identity,13,"%02x%02x%02x%02x%02x%02x",address[5],address[4],address[3],address[2],address[1],address[0]);return true;
}
bool macFromIdentity(const char* identity,uint8_t* address) {
  if(!identity||!address||!LampSyncWire::id(identity))return false;
  for(unsigned i=0;i<6;++i){unsigned value=0;for(unsigned j=0;j<2;++j){const char c=identity[(5-i)*2+j];value=value*16+(c<='9'?c-'0':c-'a'+10);}address[i]=uint8_t(value);}
  char checked[13];return identityFromMac(address,checked)&&!strcmp(checked,identity);
}
bool seal(const LampSyncWire::Packet& packet,const char* destination,const uint8_t* groupKey,uint8_t* output,size_t capacity,SendNonce& previous) {
  if(!output||capacity<EnvelopeSize||packet.kind==LampSyncWire::Discover||!packet.session||!packet.sequence||!LampSyncWire::valid(packet,sizeof(packet)))return false;
  uint8_t key[16]{},hash[32]{};
  if(!derive(packet.sender,destination,groupKey,key))return false;
  if(mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),key,sizeof(key),reinterpret_cast<const uint8_t*>(&packet),BodySize,hash)){erase(key,sizeof(key));return false;}
  if(previous.session==packet.session&&(packet.sequence<previous.sequence||
    (previous.sequence==packet.sequence&&memcmp(previous.bodyHash,hash,sizeof(hash))))){erase(key,sizeof(key));erase(hash,sizeof(hash));return false;}
  memcpy(output,magic,4);memcpy(output+4,&packet.session,8);memcpy(output+12,&packet.sequence,4);
  mbedtls_gcm_context context;mbedtls_gcm_init(&context);
  int result=mbedtls_gcm_setkey(&context,MBEDTLS_CIPHER_ID_AES,key,128);
  if(!result)result=mbedtls_gcm_crypt_and_tag(&context,MBEDTLS_GCM_ENCRYPT,BodySize,output+4,12,output,HeaderSize,
    reinterpret_cast<const uint8_t*>(&packet),output+HeaderSize,TagSize,output+HeaderSize+BodySize);
  mbedtls_gcm_free(&context);erase(key,sizeof(key));
  if(!result){previous.session=packet.session;previous.sequence=packet.sequence;memcpy(previous.bodyHash,hash,sizeof(hash));}
  erase(hash,sizeof(hash));return result==0;
}
bool open(const uint8_t* input,size_t length,const uint8_t* source,const char* destination,const uint8_t* groupKey,LampSyncWire::Packet& packet) {
  if(!input||length!=EnvelopeSize||memcmp(input,magic,4))return false;
  char sender[13];uint8_t key[16]{};if(!identityFromMac(source,sender)||!derive(sender,destination,groupKey,key))return false;
  LampSyncWire::Packet decoded{};mbedtls_gcm_context context;mbedtls_gcm_init(&context);
  int result=mbedtls_gcm_setkey(&context,MBEDTLS_CIPHER_ID_AES,key,128);
  if(!result)result=mbedtls_gcm_auth_decrypt(&context,BodySize,input+4,12,input,HeaderSize,input+HeaderSize+BodySize,TagSize,
    input+HeaderSize,reinterpret_cast<uint8_t*>(&decoded));
  mbedtls_gcm_free(&context);erase(key,sizeof(key));
  if(result||decoded.kind==LampSyncWire::Discover||!decoded.sequence||memcmp(&decoded.session,input+4,8)||memcmp(&decoded.sequence,input+12,4)||
    !LampSyncWire::valid(decoded,sizeof(decoded))||strcmp(decoded.sender,sender)){erase(&decoded,sizeof(decoded));return false;}
  if(mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),groupKey,16,reinterpret_cast<const uint8_t*>(&decoded),BodySize,decoded.mac))return false;
  packet=decoded;return true;
}
bool sealBroadcast(const LampSyncWire::Packet& packet,const uint8_t* groupKey,uint8_t* output,size_t capacity,SendNonce& previous) {
  if(!output||capacity<EnvelopeSize||packet.version!=LampSyncWire::ExpandedVersion||packet.kind!=LampSyncWire::Frame||
    packet.role!=1||packet.target!=packet.session||!packet.sequence||strcmp(packet.sender,packet.leader)||!LampSyncWire::valid(packet,sizeof(packet)))return false;
  uint8_t key[16]{},hash[32]{};
  if(!deriveBroadcast(packet.sender,groupKey,key))return false;
  if(mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),key,sizeof(key),reinterpret_cast<const uint8_t*>(&packet),BodySize,hash)){erase(key,sizeof(key));return false;}
  if(previous.session==packet.session&&(packet.sequence<previous.sequence||(previous.sequence==packet.sequence&&memcmp(previous.bodyHash,hash,sizeof(hash))))){erase(key,sizeof(key));erase(hash,sizeof(hash));return false;}
  const uint8_t header[4]={'C','L','N',3};memcpy(output,header,4);memcpy(output+4,&packet.session,8);memcpy(output+12,&packet.sequence,4);
  mbedtls_gcm_context context;mbedtls_gcm_init(&context);
  int result=mbedtls_gcm_setkey(&context,MBEDTLS_CIPHER_ID_AES,key,128);
  if(!result)result=mbedtls_gcm_crypt_and_tag(&context,MBEDTLS_GCM_ENCRYPT,BodySize,output+4,12,output,HeaderSize,
    reinterpret_cast<const uint8_t*>(&packet),output+HeaderSize,TagSize,output+HeaderSize+BodySize);
  mbedtls_gcm_free(&context);erase(key,sizeof(key));
  if(!result){previous.session=packet.session;previous.sequence=packet.sequence;memcpy(previous.bodyHash,hash,sizeof(hash));}
  erase(hash,sizeof(hash));return result==0;
}
bool openBroadcast(const uint8_t* input,size_t length,const uint8_t* source,const uint8_t* groupKey,LampSyncWire::Packet& packet) {
  const uint8_t header[4]={'C','L','N',3};
  if(!input||length!=EnvelopeSize||memcmp(input,header,4))return false;
  char sender[13];uint8_t key[16]{};
  if(!identityFromMac(source,sender)||!deriveBroadcast(sender,groupKey,key))return false;
  LampSyncWire::Packet decoded{};mbedtls_gcm_context context;mbedtls_gcm_init(&context);
  int result=mbedtls_gcm_setkey(&context,MBEDTLS_CIPHER_ID_AES,key,128);
  if(!result)result=mbedtls_gcm_auth_decrypt(&context,BodySize,input+4,12,input,HeaderSize,input+HeaderSize+BodySize,TagSize,
    input+HeaderSize,reinterpret_cast<uint8_t*>(&decoded));
  mbedtls_gcm_free(&context);erase(key,sizeof(key));
  if(result||decoded.version!=LampSyncWire::ExpandedVersion||decoded.kind!=LampSyncWire::Frame||decoded.role!=1||
    decoded.target!=decoded.session||!decoded.sequence||strcmp(decoded.sender,decoded.leader)||strcmp(decoded.sender,sender)||
    memcmp(&decoded.session,input+4,8)||memcmp(&decoded.sequence,input+12,4)||!LampSyncWire::valid(decoded,sizeof(decoded))){erase(&decoded,sizeof(decoded));return false;}
  if(mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),groupKey,16,reinterpret_cast<const uint8_t*>(&decoded),BodySize,decoded.mac))return false;
  packet=decoded;return true;
}
}
