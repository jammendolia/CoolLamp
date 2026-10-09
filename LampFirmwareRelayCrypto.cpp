#include "LampFirmwareRelayCrypto.h"
#include <mbedtls/gcm.h>
#include <mbedtls/md.h>
namespace LampFirmwareRelayCrypto {
namespace {
void zero(void* p,size_t n){volatile uint8_t* b=static_cast<volatile uint8_t*>(p);while(n--)*b++=0;}
bool derive(const uint8_t* source,const uint8_t* destination,const uint8_t* fleet,uint8_t* key){
 constexpr char domain[]="CoolLamp firmware relay AES-GCM v1";
 uint8_t input[sizeof(domain)-1+12],digest[32];memcpy(input,domain,sizeof(domain)-1);memcpy(input+sizeof(domain)-1,source,6);memcpy(input+sizeof(domain)-1+6,destination,6);
 const int result=mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),fleet,16,input,sizeof(input),digest);if(!result)memcpy(key,digest,16);zero(digest,sizeof(digest));return !result;
}
}
bool seal(const uint8_t* body,size_t length,const uint8_t* source,const uint8_t* destination,const uint8_t* fleet,uint64_t boot,uint32_t sequence,uint8_t* output){
 using namespace LampFirmwareRelayWire;
 if(!source||!destination||!fleet||!output||!boot||!sequence||length>BodyLimit||!valid(body,length))return false;
 uint8_t key[16];if(!derive(source,destination,fleet,key))return false;
 memcpy(output,"CLF\1",4);put64(output+4,boot);put32(output+12,sequence);
 mbedtls_gcm_context context;mbedtls_gcm_init(&context);int result=mbedtls_gcm_setkey(&context,MBEDTLS_CIPHER_ID_AES,key,128);
 if(!result)result=mbedtls_gcm_crypt_and_tag(&context,MBEDTLS_GCM_ENCRYPT,length,output+4,12,output,Header,body,output+Header,Tag,output+Header+length);
 mbedtls_gcm_free(&context);zero(key,sizeof(key));return !result;
}
bool open(const uint8_t* input,size_t length,const uint8_t* source,const uint8_t* destination,const uint8_t* fleet,uint8_t* body,size_t& size){
 using namespace LampFirmwareRelayWire;size=0;
 if(!input||!body||!source||!destination||!fleet||length<=Header+Tag||length>250||memcmp(input,"CLF\1",4)||!u64(input+4)||!u32(input+12))return false;
 uint8_t key[16];if(!derive(source,destination,fleet,key))return false;
 const size_t n=length-Header-Tag;mbedtls_gcm_context context;mbedtls_gcm_init(&context);int result=mbedtls_gcm_setkey(&context,MBEDTLS_CIPHER_ID_AES,key,128);
 if(!result)result=mbedtls_gcm_auth_decrypt(&context,n,input+4,12,input,Header,input+Header+n,Tag,input+Header,body);
 mbedtls_gcm_free(&context);zero(key,sizeof(key));if(result||!valid(body,n)){zero(body,n);return false;}size=n;return true;
}
}
