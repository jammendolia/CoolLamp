#include "UpdatePublisher.h"
#include "LampVersion.h"
#include <mbedtls/ecdsa.h>
#include <mbedtls/sha256.h>
#include <Preferences.h>
// An external manufacturing build may define an immutable keyset include that
// declares publisherKeys[] and publisherMinimumEpoch. It contains public keys
// only. No development key is implicitly a product root of trust.
#if defined(COOL_LAMP_PUBLISHER_TRUST_PROVISIONED)
#include "LampPublisherTrust.generated.h"
#elif defined(COOL_LAMP_PUBLISHER_TRUST_CONFIG)
#include COOL_LAMP_PUBLISHER_TRUST_CONFIG
#else
static constexpr UpdatePublisher::TrustedKey publisherKeys[1]{};
static constexpr uint32_t publisherMinimumEpoch=0;
#endif
namespace UpdatePublisher {
namespace {
bool hex(const char* p,size_t digits,uint8_t* out){
 if(strlen(p)!=digits)return false;
 for(size_t i=0;i<digits;++i){const char c=p[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;const uint8_t value=c<='9'?c-'0':c-'a'+10;if(i%2)out[i/2]|=value;else out[i/2]=value<<4;}return true;
}
bool decimal(const char* p,uint32_t& n){
 if(!p||!*p||(*p=='0'&&p[1]))return false;
 n=0;unsigned count=0;while(*p){if(*p<'0'||*p>'9'||++count>10)return false;const uint32_t digit=*p++-'0';if(n>(UINT32_MAX-digit)/10)return false;n=n*10+digit;}return true;
}
size_t keyCount(){return publisherKeys[0].id?sizeof(publisherKeys)/sizeof(publisherKeys[0]):0;}
}
bool verify(const char* text,size_t length,const TrustedKey* keys,size_t count,uint32_t floor,const uint16_t minimumVersion[3],Manifest& out){
 if(!text||!keys||!minimumVersion||!count||count>MaxTrustedKeys||length>=ManifestCapacity||!length||memchr(text,0,length))return false;
 char copy[ManifestCapacity]{};memcpy(copy,text,length);char* lines[9];char* p=copy;size_t signedLength=0;
 for(unsigned i=0;i<9;++i){lines[i]=p;char* end=strchr(p,'\n');if(!end)return false;*end=0;p=end+1;if(i==7)signedLength=size_t(p-copy);}
 Manifest next;
 if(*p||strcmp(lines[0],"COOLLAMP-OTA-2")||strcmp(lines[2],"esp32c3")||strcmp(lines[3],"dual-ota-2031616")||
    !parseFirmwareVersion(lines[1],next.image.version)||firmwareIsNewer(minimumVersion,next.image.version)||
    !decimal(lines[4],next.image.size)||next.image.size<288||next.image.size>2031616||!hex(lines[5],64,next.image.sha256)||
    !decimal(lines[6],next.epoch)||!next.epoch||next.epoch==UINT32_MAX||next.epoch<floor||!hex(lines[8],128,next.signature))return false;
 uint8_t id[4];if(!hex(lines[7],8,id))return false;for(unsigned i=0;i<4;++i)next.keyId=next.keyId<<8|id[i];if(!next.keyId)return false;
 const TrustedKey* key=nullptr;for(size_t i=0;i<count;++i){if(keys[i].id==next.keyId){if(key)return false;key=&keys[i];}}
 if(!key||key->publicKey[0]!=4||next.epoch<key->firstEpoch||next.epoch>key->lastEpoch)return false;
 uint8_t digest[32];if(mbedtls_sha256(reinterpret_cast<const uint8_t*>(text),signedLength,digest,0))return false;
 mbedtls_ecp_group group;mbedtls_ecp_point point;mbedtls_mpi r,s;mbedtls_ecp_group_init(&group);mbedtls_ecp_point_init(&point);mbedtls_mpi_init(&r);mbedtls_mpi_init(&s);
 const bool okay=!mbedtls_ecp_group_load(&group,MBEDTLS_ECP_DP_SECP256R1)&&!mbedtls_ecp_point_read_binary(&group,&point,key->publicKey,PublicKeySize)&&
   !mbedtls_ecp_check_pubkey(&group,&point)&&!mbedtls_mpi_read_binary(&r,next.signature,32)&&!mbedtls_mpi_read_binary(&s,next.signature+32,32)&&
   !mbedtls_ecdsa_verify(&group,digest,sizeof(digest),&point,&r,&s);
 mbedtls_mpi_free(&s);mbedtls_mpi_free(&r);mbedtls_ecp_point_free(&point);mbedtls_ecp_group_free(&group);
 if(okay)out=next;
 return okay;
}
bool enforced(){return keyCount()>0;}
uint32_t minimumEpoch(){
 uint32_t floor=publisherMinimumEpoch;
 Preferences prefs;if(!prefs.begin("lamptrust",false))return UINT32_MAX;
 if(prefs.isKey("pubEpochV1")&&prefs.getType("pubEpochV1")!=PT_U32){prefs.end();return UINT32_MAX;}
 const uint32_t retained=prefs.getUInt("pubEpochV1",0);if(retained>floor)floor=retained;prefs.end();
 return floor;
}
bool verifyProvisioned(const char* text,size_t length,Manifest& out){
 if(!enforced())return false;
 const uint16_t current[]={LAMP_VERSION_MAJOR,LAMP_VERSION_MINOR,LAMP_VERSION_PATCH};
 return verify(text,length,publisherKeys,keyCount(),minimumEpoch(),current,out);
}
bool recordEpoch(uint32_t epoch){
 if(!enforced()||!epoch||epoch<minimumEpoch())return false;
 Preferences prefs;if(!prefs.begin("lamptrust",false))return false;
 const bool okay=prefs.putUInt("pubEpochV1",epoch)==sizeof(uint32_t);prefs.end();return okay;
}
bool retainManifest(const char* text,size_t length){
 Manifest verified;if(!verifyProvisioned(text,length,verified))return false;
 Preferences prefs;if(!prefs.begin("lamptrust",false))return false;
 const bool okay=prefs.putBytes("pubManifestV2",text,length)==length;prefs.end();return okay;
}
bool copyRetainedManifest(char* out,size_t capacity,size_t& length){
 length=0;if(!out||capacity<ManifestCapacity||!enforced())return false;
 Preferences prefs;if(!prefs.begin("lamptrust",true))return false;
 const size_t count=prefs.getBytesLength("pubManifestV2");
 const bool loaded=count>0&&count<ManifestCapacity&&prefs.getBytes("pubManifestV2",out,count)==count;prefs.end();
 if(!loaded)return false;
 out[count]=0;Manifest verified;
 if(!verifyProvisioned(out,count,verified))return false;
 length=count;return true;
}
bool format(const Manifest& m,char* out,size_t capacity,size_t& length){
 length=0;if(!out||capacity<ManifestCapacity||!m.epoch||m.epoch==UINT32_MAX||!m.keyId||m.image.size<288||m.image.size>2031616)return false;
 char digest[65],signature[129];for(unsigned i=0;i<32;++i)snprintf(digest+2*i,3,"%02x",m.image.sha256[i]);for(unsigned i=0;i<64;++i)snprintf(signature+2*i,3,"%02x",m.signature[i]);
 const int used=snprintf(out,capacity,"COOLLAMP-OTA-2\n%u.%u.%u\nesp32c3\ndual-ota-2031616\n%lu\n%s\n%lu\n%08lx\n%s\n",m.image.version[0],m.image.version[1],m.image.version[2],static_cast<unsigned long>(m.image.size),digest,static_cast<unsigned long>(m.epoch),static_cast<unsigned long>(m.keyId),signature);
 if(used<=0||size_t(used)>=capacity)return false;
 length=size_t(used);return true;
}
}
