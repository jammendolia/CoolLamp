#pragma once
// Host-only minimal profile for the exact pinned production Mbed TLS source.
// This is never included by firmware or used to replace installed SDK archives.
#define MBEDTLS_AES_C
#define MBEDTLS_CIPHER_C
#define MBEDTLS_GCM_C
#define MBEDTLS_MD_C
#define MBEDTLS_SHA256_C
#define MBEDTLS_PLATFORM_C
