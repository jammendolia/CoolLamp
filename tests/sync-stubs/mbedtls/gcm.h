#pragma once
#include "md.h"
#include <cstring>
constexpr int MBEDTLS_CIPHER_ID_AES=2,MBEDTLS_GCM_ENCRYPT=1;
// Behavior-only adapter for Windows host tests. Production calls the pinned
// SDK's AES-GCM primitive; Linux CI can select real OpenSSL below.
#ifdef COOL_LAMP_HOST_OPENSSL
#include <openssl/evp.h>
struct mbedtls_gcm_context {uint8_t key[16]{};};
#else
struct mbedtls_gcm_context {uint8_t key[16]{};};
#endif
inline void mbedtls_gcm_init(mbedtls_gcm_context* c){*c=mbedtls_gcm_context{};}
inline void mbedtls_gcm_free(mbedtls_gcm_context* c){*c=mbedtls_gcm_context{};}
inline int mbedtls_gcm_setkey(mbedtls_gcm_context* c,int,unsigned const char* key,unsigned bits){if(bits!=128)return -1;memcpy(c->key,key,16);return 0;}
inline int mbedtls_gcm_crypt_and_tag(mbedtls_gcm_context* c,int,size_t length,const uint8_t* iv,size_t ivLength,const uint8_t* aad,size_t aadLength,const uint8_t* input,uint8_t* output,size_t tagLength,uint8_t* tag){
#ifdef COOL_LAMP_HOST_OPENSSL
 auto* ctx=EVP_CIPHER_CTX_new();int written=0,total=0;int ok=ctx&&EVP_EncryptInit_ex(ctx,EVP_aes_128_gcm(),nullptr,nullptr,nullptr)&&EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_SET_IVLEN,int(ivLength),nullptr)&&EVP_EncryptInit_ex(ctx,nullptr,nullptr,c->key,iv)&&EVP_EncryptUpdate(ctx,nullptr,&written,aad,int(aadLength))&&EVP_EncryptUpdate(ctx,output,&written,input,int(length));total=written;
 if(ok)ok=EVP_EncryptFinal_ex(ctx,output+total,&written)&&EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_GET_TAG,int(tagLength),tag);EVP_CIPHER_CTX_free(ctx);return ok?0:-1;
#else
 for(size_t i=0;i<length;++i)output[i]=input[i]^c->key[i%16]^iv[i%ivLength];
 uint8_t hashed[32];mbedtls_md_hmac(1,c->key,16,output,length,hashed);for(size_t i=0;i<tagLength;++i)tag[i]=hashed[i]^iv[i%ivLength]^aad[i%aadLength];return 0;
#endif
}
inline int mbedtls_gcm_auth_decrypt(mbedtls_gcm_context* c,size_t length,const uint8_t* iv,size_t ivLength,const uint8_t* aad,size_t aadLength,const uint8_t* tag,size_t tagLength,const uint8_t* input,uint8_t* output){
#ifdef COOL_LAMP_HOST_OPENSSL
 auto* ctx=EVP_CIPHER_CTX_new();int written=0,total=0;int ok=ctx&&EVP_DecryptInit_ex(ctx,EVP_aes_128_gcm(),nullptr,nullptr,nullptr)&&EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_SET_IVLEN,int(ivLength),nullptr)&&EVP_DecryptInit_ex(ctx,nullptr,nullptr,c->key,iv)&&EVP_DecryptUpdate(ctx,nullptr,&written,aad,int(aadLength))&&EVP_DecryptUpdate(ctx,output,&written,input,int(length));total=written;
 if(ok)ok=EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_SET_TAG,int(tagLength),const_cast<uint8_t*>(tag))&&EVP_DecryptFinal_ex(ctx,output+total,&written);EVP_CIPHER_CTX_free(ctx);return ok?0:-1;
#else
 uint8_t hashed[32];mbedtls_md_hmac(1,c->key,16,input,length,hashed);for(size_t i=0;i<tagLength;++i)if(tag[i]!=(hashed[i]^iv[i%ivLength]^aad[i%aadLength]))return -1;
 for(size_t i=0;i<length;++i)output[i]=input[i]^c->key[i%16]^iv[i%ivLength];
 return 0;
#endif
}
