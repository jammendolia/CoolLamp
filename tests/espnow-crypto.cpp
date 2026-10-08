#include "../LampSyncRadioCrypto.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <mbedtls/gcm.h>
using namespace LampSyncWire;
using namespace LampSyncRadioCrypto;
int main(){
#ifndef COOL_LAMP_HOST_BEHAVIOR_CRYPTO
 // NIST AES-128-GCM known-answer vector; real primitive profile only.
 uint8_t zeros[16]{},iv[12]{},cipher[16]{},tag[16]{};
 const uint8_t expectedCipher[16]={0x03,0x88,0xda,0xce,0x60,0xb6,0xa3,0x92,0xf3,0x28,0xc2,0xb9,0x71,0xb2,0xfe,0x78};
 const uint8_t expectedTag[16]={0xab,0x6e,0x47,0xd4,0x2c,0xec,0x13,0xbd,0xf5,0x3a,0x67,0xb2,0x12,0x57,0xbd,0xdf};
 mbedtls_gcm_context context;mbedtls_gcm_init(&context);assert(!mbedtls_gcm_setkey(&context,MBEDTLS_CIPHER_ID_AES,zeros,128));
 assert(!mbedtls_gcm_crypt_and_tag(&context,MBEDTLS_GCM_ENCRYPT,sizeof(zeros),iv,sizeof(iv),nullptr,0,zeros,cipher,sizeof(tag),tag));
 assert(!memcmp(cipher,expectedCipher,16)&&!memcmp(tag,expectedTag,16));mbedtls_gcm_free(&context);
#endif
 static_assert(sizeof(Packet)==226&&sizeof(Visual)==83&&EnvelopeSize==226,"Preserve wire and envelope size");
 Packet packet{};memcpy(packet.magic,"CLSY",4);packet.version=2;packet.kind=Frame;packet.role=1;
 strcpy(packet.sender,"112233445566");strcpy(packet.leader,packet.sender);strcpy(packet.name,"Coordinator");
 packet.session=0x0102030405060708ULL;packet.target=123;packet.sequence=9;packet.time=456;
 packet.visual.mode=46;packet.visual.brightness=100;packet.visual.power=1;packet.visual.speed=50;
 uint8_t key[16]{};for(unsigned i=0;i<16;++i)key[i]=i;
 uint8_t sealed[EnvelopeSize],again[EnvelopeSize],source[6];SendNonce previous;
 assert(macFromIdentity(packet.sender,source));assert(source[0]==0x66&&source[5]==0x11);
 char identity[13];assert(identityFromMac(source,identity)&&!strcmp(identity,packet.sender));
 assert(seal(packet,"aabbccddee00",key,sealed,sizeof(sealed),previous));
 assert(memcmp(sealed,&packet,BodySize));assert(seal(packet,"aabbccddee00",key,again,sizeof(again),previous));assert(!memcmp(sealed,again,sizeof(sealed)));
 Packet decoded{};assert(open(sealed,sizeof(sealed),source,"aabbccddee00",key,decoded));assert(!memcmp(&packet,&decoded,BodySize));
 for(unsigned i=0;i<EnvelopeSize;++i){memcpy(again,sealed,sizeof(again));again[i]^=1;assert(!open(again,sizeof(again),source,"aabbccddee00",key,decoded));}
 key[0]^=1;assert(!open(sealed,sizeof(sealed),source,"aabbccddee00",key,decoded));key[0]^=1;
 assert(!open(sealed,sizeof(sealed),source,"aabbccddee02",key,decoded));source[1]^=2;assert(!open(sealed,sizeof(sealed),source,"aabbccddee00",key,decoded));source[1]^=2;
 packet.visual.power=0;assert(!seal(packet,"aabbccddee00",key,again,sizeof(again),previous)); // changed plaintext cannot reuse nonce/key
 ++packet.sequence;assert(seal(packet,"aabbccddee00",key,again,sizeof(again),previous));assert(memcmp(sealed,again,sizeof(sealed)));
 --packet.sequence;assert(!seal(packet,"aabbccddee00",key,again,sizeof(again),previous)); // older nonce rejected
 packet.session++;assert(seal(packet,"aabbccddee00",key,again,sizeof(again),previous));
 source[0]|=1;assert(!identityFromMac(source,identity));source[0]&=~1;
 packet.kind=Discover;assert(!seal(packet,"aabbccddee00",key,again,sizeof(again),previous));
 std::cout<<"PASS: 226-byte per-peer authenticated envelope, exact MAC/ID binding, every-byte tamper/key/destination rejection, unchanged nonce retry and changed/older nonce rejection\n";
}
