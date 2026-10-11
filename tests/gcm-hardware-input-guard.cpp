// Test-only ESP-IDF 5.5.5 AES-GCM pointer validation, followed by real pinned
// Mbed TLS encryption/decryption. The DMA port rejects null input/output even
// for length 0; the software implementation alone does not catch that error.
// https://github.com/espressif/esp-idf/blob/v5.5.5/components/mbedtls/port/aes/esp_aes_gcm.c
#include <mbedtls/gcm.h>

unsigned lampGcmGuardEmptyEncryptCalls=0;
unsigned lampGcmGuardNullRejections=0;
bool lampGcmGuardFailEmpty=false;

extern "C" {
int __real_mbedtls_gcm_crypt_and_tag(mbedtls_gcm_context*,int,size_t,
 const unsigned char*,size_t,const unsigned char*,size_t,
 const unsigned char*,unsigned char*,size_t,unsigned char*);
int __real_mbedtls_gcm_auth_decrypt(mbedtls_gcm_context*,size_t,
 const unsigned char*,size_t,const unsigned char*,size_t,
 const unsigned char*,size_t,const unsigned char*,unsigned char*);

int __wrap_mbedtls_gcm_crypt_and_tag(mbedtls_gcm_context* context,int mode,size_t length,
 const unsigned char* iv,size_t ivLength,const unsigned char* aad,size_t aadLength,
 const unsigned char* input,unsigned char* output,size_t tagLength,unsigned char* tag){
 if(!length)++lampGcmGuardEmptyEncryptCalls;
 if(!input||!output){++lampGcmGuardNullRejections;return MBEDTLS_ERR_GCM_BAD_INPUT;}
 if(!length&&lampGcmGuardFailEmpty)return MBEDTLS_ERR_GCM_BAD_INPUT;
 return __real_mbedtls_gcm_crypt_and_tag(context,mode,length,iv,ivLength,aad,aadLength,input,output,tagLength,tag);
}
int __wrap_mbedtls_gcm_auth_decrypt(mbedtls_gcm_context* context,size_t length,
 const unsigned char* iv,size_t ivLength,const unsigned char* aad,size_t aadLength,
 const unsigned char* tag,size_t tagLength,const unsigned char* input,unsigned char* output){
 if(!input||!output){++lampGcmGuardNullRejections;return MBEDTLS_ERR_GCM_BAD_INPUT;}
 return __real_mbedtls_gcm_auth_decrypt(context,length,iv,ivLength,aad,aadLength,tag,tagLength,input,output);
}
}
