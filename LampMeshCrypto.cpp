#include "LampMeshCrypto.h"
#include <mbedtls/gcm.h>
#include <mbedtls/md.h>
namespace LampMeshCrypto {
namespace {
void erase(void* p,size_t n){volatile uint8_t* b=static_cast<volatile uint8_t*>(p);while(n--)*b++=0;}
bool derive(const uint8_t* fleet,const uint8_t* mac,bool hop,uint8_t* key){
 const char* domain=hop?"CoolLamp mesh hop HMAC v1":"CoolLamp mesh origin AES-GCM v1";
 uint8_t input[64]{};const size_t n=strlen(domain);memcpy(input,domain,n);memcpy(input+n,mac,6);
 return mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),fleet,16,input,n+6,key)==0;
}
bool hopTag(const uint8_t* in,size_t size,const uint8_t* fleet,const uint8_t* sender,uint8_t* tag){
 uint8_t key[32]{},digest[32]{};if(!derive(fleet,sender,true,key))return false;
 const int result=mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),key,32,in,size-16,digest);
 if(!result)memcpy(tag,digest,16);
 erase(key,sizeof(key));erase(digest,sizeof(digest));return !result;
}
}
bool seal(const LampMeshWire::Packet& p,const uint8_t* payload,const uint8_t* fleet,const uint8_t* sender,uint8_t ttl,uint8_t attempt,uint8_t* out,size_t& size){
 using namespace LampMeshWire;size=0;
 if(!fleet||!mac(sender)||!out||!valid(p)||(p.payloadSize&&!payload)||ttl>=HopLimit||attempt>AttemptLimit)return false;
 uint8_t key[32]{};if(!derive(fleet,p.origin,false,key))return false;encode(p,out);out[HeaderSize]=ttl;out[HeaderSize+1]=attempt;
 uint8_t nonce[12];put64(nonce,p.boot);put32(nonce+8,p.sequence);
 mbedtls_gcm_context context;mbedtls_gcm_init(&context);int result=mbedtls_gcm_setkey(&context,MBEDTLS_CIPHER_ID_AES,key,128);
 if(!result)result=mbedtls_gcm_crypt_and_tag(&context,MBEDTLS_GCM_ENCRYPT,p.payloadSize,nonce,sizeof(nonce),out,HeaderSize,payload,out+HeaderSize+HopSize,TagSize,out+HeaderSize+HopSize+p.payloadSize);
 mbedtls_gcm_free(&context);erase(key,sizeof(key));if(result)return false;
 size=HeaderSize+HopSize+p.payloadSize+2*TagSize;
 if(!hopTag(out,size,fleet,sender,out+size-TagSize)){size=0;return false;}return true;
}
bool open(const uint8_t* in,size_t size,const uint8_t* fleet,const uint8_t* sender,LampMeshWire::Packet& p,uint8_t* payload){
 using namespace LampMeshWire;if(!fleet||!mac(sender)||!payload)return false;Packet decoded{};if(!decode(in,size,decoded))return false;
 uint8_t expected[16]{},key[32]{};if(!hopTag(in,size,fleet,sender,expected))return false;uint8_t difference=0;for(unsigned i=0;i<16;++i)difference|=expected[i]^in[size-16+i];erase(expected,sizeof(expected));if(difference)return false;
 if(!derive(fleet,decoded.origin,false,key))return false;
 uint8_t nonce[12];put64(nonce,decoded.boot);put32(nonce+8,decoded.sequence);mbedtls_gcm_context context;mbedtls_gcm_init(&context);int result=mbedtls_gcm_setkey(&context,MBEDTLS_CIPHER_ID_AES,key,128);
 if(!result)result=mbedtls_gcm_auth_decrypt(&context,decoded.payloadSize,nonce,sizeof(nonce),in,HeaderSize,in+HeaderSize+HopSize+decoded.payloadSize,TagSize,in+HeaderSize+HopSize,payload);
 mbedtls_gcm_free(&context);erase(key,sizeof(key));if(result){erase(payload,decoded.payloadSize);return false;}p=decoded;return true;
}
bool forward(const uint8_t* in,size_t size,const uint8_t* fleet,const uint8_t* sender,uint8_t* out){
 using namespace LampMeshWire;Packet p{};if(!fleet||!mac(sender)||!out||!decode(in,size,p)||!in[HeaderSize])return false;
 memcpy(out,in,size);--out[HeaderSize];return hopTag(out,size,fleet,sender,out+size-TagSize);
}
}
