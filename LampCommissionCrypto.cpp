#include "LampCommissionCrypto.h"
#include "LampMeshWire.h"
#include <mbedtls/ecdh.h>
#include <mbedtls/gcm.h>
#include <mbedtls/hkdf.h>
#include <mbedtls/md.h>
#include <mbedtls/sha256.h>
#include <esp_system.h>
#include <esp_random.h>
#include <stdlib.h>
namespace LampCommissionCrypto {
using namespace LampMeshWire;
void erase(void* p,size_t n){volatile uint8_t* b=static_cast<volatile uint8_t*>(p);while(n--)*b++=0;}
namespace {
int random(void*,unsigned char* out,size_t n){while(n){const uint32_t value=esp_random();const size_t take=n<4?n:4;memcpy(out,&value,take);out+=take;n-=take;}return 0;}
bool transcriptHash(const Transcript& t,uint8_t* digest){
 if(!mac(t.broker)||!mac(t.target)||same(t.broker,t.target)||!t.brokerBoot||!t.targetBoot||!t.requestId||t.brokerPublic[0]!=4||t.targetPublic[0]!=4)return false;
 constexpr char domain[]="CoolLamp physical commissioning P256 v1";
 uint8_t expected[32]{};
 if(!commitment(t.broker,t.brokerBoot,t.brokerPublic,t.brokerNonce,expected)||memcmp(expected,t.brokerCommit,32)||!commitment(t.target,t.targetBoot,t.targetPublic,t.targetNonce,expected)||memcmp(expected,t.targetCommit,32))return false;
 uint8_t bytes[sizeof(domain)-1+12+24+2*PublicKeySize+8+96];size_t at=0;
 memcpy(bytes,domain,sizeof(domain)-1);at+=sizeof(domain)-1;memcpy(bytes+at,t.broker,6);at+=6;memcpy(bytes+at,t.target,6);at+=6;
 put64(bytes+at,t.brokerBoot);at+=8;put64(bytes+at,t.targetBoot);at+=8;put64(bytes+at,t.requestId);at+=8;
 memcpy(bytes+at,t.brokerPublic,PublicKeySize);at+=PublicKeySize;memcpy(bytes+at,t.targetPublic,PublicKeySize);at+=PublicKeySize;memcpy(bytes+at,t.fleetId,8);at+=8;
 memcpy(bytes+at,t.brokerNonce,16);at+=16;memcpy(bytes+at,t.targetNonce,16);at+=16;memcpy(bytes+at,t.brokerCommit,32);at+=32;memcpy(bytes+at,t.targetCommit,32);
 return mbedtls_sha256(bytes,sizeof(bytes),digest,0)==0;
}
bool bodyValid(uint8_t direction,uint8_t kind,size_t n){
 if(direction>1||kind<Ready||kind>Cancel)return false;
 if(kind==Commit)return direction==0&&n==16;
 if(kind==Cancel)return direction==0&&n==0;
 if(kind==Failed)return direction==1&&n==1;
 return direction==1&&n==0;
}
void header(const Transcript& t,uint8_t direction,uint8_t kind,uint32_t sequence,size_t size,uint8_t* out){
 memcpy(out,"CCE\1",4);memcpy(out+4,t.broker,6);memcpy(out+10,t.target,6);put64(out+16,t.brokerBoot);put64(out+24,t.targetBoot);put64(out+32,t.requestId);
 out[40]=kind;out[41]=direction;out[42]=uint8_t(size);out[43]=0;put32(out+44,sequence);
}
}
Exchange::~Exchange(){clear();}
bool commitment(const uint8_t* address,uint64_t boot,const uint8_t* publicKey,const uint8_t* nonce,uint8_t* output){
 if(!mac(address)||!boot||!publicKey||publicKey[0]!=4||!nonce||!output)return false;
 constexpr char domain[]="CoolLamp commissioning key commitment v1";
 uint8_t input[sizeof(domain)-1+6+8+PublicKeySize+16];size_t at=sizeof(domain)-1;memcpy(input,domain,at);memcpy(input+at,address,6);at+=6;put64(input+at,boot);at+=8;memcpy(input+at,publicKey,PublicKeySize);at+=PublicKeySize;memcpy(input+at,nonce,16);
 const bool okay=mbedtls_sha256(input,sizeof(input),output,0)==0;erase(input,sizeof(input));return okay;
}
void Exchange::clear(){if(context_){mbedtls_ecdh_free(static_cast<mbedtls_ecdh_context*>(context_));free(context_);context_=nullptr;}erase(public_,sizeof(public_));}
bool Exchange::generate(){
 clear();auto* context=static_cast<mbedtls_ecdh_context*>(malloc(sizeof(mbedtls_ecdh_context)));if(!context)return false;mbedtls_ecdh_init(context);context_=context;
 uint8_t encoded[66]{};size_t size=0;
 if(mbedtls_ecdh_setup(context,MBEDTLS_ECP_DP_SECP256R1)||mbedtls_ecdh_make_public(context,&size,encoded,sizeof(encoded),random,nullptr)||size!=66||encoded[0]!=65||encoded[1]!=4){clear();return false;}
 memcpy(public_,encoded+1,PublicKeySize);erase(encoded,sizeof(encoded));return true;
}
bool Exchange::derive(const uint8_t* peer,const Transcript& t,Keys& out){
 if(!context_||!peer||peer[0]!=4)return false;
 Keys next{};uint8_t encoded[66]{65},secret[32]{},derived[34]{};memcpy(encoded+1,peer,PublicKeySize);size_t size=0;
 auto* context=static_cast<mbedtls_ecdh_context*>(context_);
 bool okay=!mbedtls_ecdh_read_public(context,encoded,sizeof(encoded))&&!mbedtls_ecdh_calc_secret(context,&size,secret,sizeof(secret),random,nullptr)&&size==32&&transcriptHash(t,next.digest);
 constexpr char domain[]="CoolLamp commission traffic and physical colors v1";
 if(okay)okay=mbedtls_hkdf(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),next.digest,sizeof(next.digest),secret,sizeof(secret),reinterpret_cast<const uint8_t*>(domain),sizeof(domain)-1,derived,sizeof(derived))==0;
 if(okay){memcpy(next.brokerToTarget,derived,16);memcpy(next.targetToBroker,derived+16,16);for(unsigned i=0;i<4;++i)next.pattern[i]=uint8_t(derived[32+i/2]>>(i%2?0:4))&15;out=next;}
 erase(secret,sizeof(secret));erase(derived,sizeof(derived));erase(encoded,sizeof(encoded));erase(&next,sizeof(next));return okay;
}
bool fleetIdentifier(const uint8_t* fleet,uint8_t* id){
 if(!fleet||!id)return false;
 constexpr char domain[]="CoolLamp fleet identifier v1";uint8_t digest[32]{};
 const bool okay=mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),fleet,16,reinterpret_cast<const uint8_t*>(domain),sizeof(domain)-1,digest)==0;
 if(okay)memcpy(id,digest,8);
 erase(digest,sizeof(digest));return okay;
}
bool seal(const Transcript& t,const Keys& keys,uint8_t direction,uint8_t kind,uint32_t sequence,const uint8_t* body,size_t length,uint8_t* out,size_t& size){
 size=0;if(!out||!sequence||!bodyValid(direction,kind,length)||(length&&!body))return false;
 uint8_t digest[32]{};if(!transcriptHash(t,digest)||memcmp(digest,keys.digest,32))return false;header(t,direction,kind,sequence,length,out);
 uint8_t aad[HeaderSize+32],nonce[12];memcpy(aad,out,HeaderSize);memcpy(aad+HeaderSize,keys.digest,32);put64(nonce,direction?t.targetBoot:t.brokerBoot);put32(nonce+8,sequence);
 mbedtls_gcm_context context;mbedtls_gcm_init(&context);int result=mbedtls_gcm_setkey(&context,MBEDTLS_CIPHER_ID_AES,direction?keys.targetToBroker:keys.brokerToTarget,128);
 if(!result)result=mbedtls_gcm_crypt_and_tag(&context,MBEDTLS_GCM_ENCRYPT,length,nonce,sizeof(nonce),aad,sizeof(aad),body,out+HeaderSize,TagSize,out+HeaderSize+length);
 mbedtls_gcm_free(&context);erase(aad,sizeof(aad));erase(digest,sizeof(digest));if(result)return false;size=HeaderSize+length+TagSize;return true;
}
bool open(const Transcript& t,const Keys& keys,const uint8_t* source,const uint8_t* in,size_t size,uint8_t& kind,uint32_t& sequence,uint8_t* body,size_t& length){
 length=0;if(!in||!source||!body||size<HeaderSize+TagSize||size>HeaderSize+BodyLimit+TagSize||memcmp(in,"CCE\1",4))return false;
 const uint8_t direction=in[41],type=in[40],n=in[42];const uint32_t seq=u32(in+44);
 if(!seq||in[43]||!bodyValid(direction,type,n)||size!=HeaderSize+n+TagSize||!same(source,direction?t.target:t.broker))return false;
 uint8_t expected[HeaderSize];header(t,direction,type,seq,n,expected);if(memcmp(in,expected,HeaderSize))return false;
 uint8_t digest[32]{};if(!transcriptHash(t,digest)||memcmp(digest,keys.digest,32))return false;
 uint8_t aad[HeaderSize+32],nonce[12];memcpy(aad,in,HeaderSize);memcpy(aad+HeaderSize,keys.digest,32);put64(nonce,direction?t.targetBoot:t.brokerBoot);put32(nonce+8,seq);
 mbedtls_gcm_context context;mbedtls_gcm_init(&context);int result=mbedtls_gcm_setkey(&context,MBEDTLS_CIPHER_ID_AES,direction?keys.targetToBroker:keys.brokerToTarget,128);
 if(!result)result=mbedtls_gcm_auth_decrypt(&context,n,nonce,sizeof(nonce),aad,sizeof(aad),in+HeaderSize+n,TagSize,in+HeaderSize,body);
 mbedtls_gcm_free(&context);erase(aad,sizeof(aad));erase(digest,sizeof(digest));if(result){erase(body,n);return false;}kind=type;sequence=seq;length=n;return true;
}
}
