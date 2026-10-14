#include "BridgeArtifact.h"
#include <stdio.h>
#include <string.h>
#ifdef COOLLAMP_BRIDGE_BENCH
#include "BridgeBenchFixture.generated.h"
#endif

namespace BridgeArtifact {
namespace {
uint32_t little32(const uint8_t* p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
bool canonical(const Metadata& m,const char* text,size_t length){
 char digest[65]{},signature[129]{},result[UpdatePublisher::ManifestCapacity]{};
 for(unsigned i=0;i<32;++i)snprintf(digest+i*2,3,"%02x",m.image.sha256[i]);
 int n=0;
 if(m.trust==Trust::PublisherSignature){
  for(unsigned i=0;i<64;++i)snprintf(signature+i*2,3,"%02x",m.signature[i]);
  n=snprintf(result,sizeof(result),"COOLLAMP-OTA-2\n%u.%u.%u\nesp32c3\ndual-ota-2031616\n%lu\n%s\n%lu\n%08lx\n%s\n",m.image.version[0],m.image.version[1],m.image.version[2],static_cast<unsigned long>(m.image.size),digest,static_cast<unsigned long>(m.epoch),static_cast<unsigned long>(m.keyId),signature);
 }else{
  n=snprintf(result,sizeof(result),"COOLLAMP-OTA-1\n%u.%u.%u\nesp32c3\ndual-ota-2031616\n%lu\n%s\n",m.image.version[0],m.image.version[1],m.image.version[2],static_cast<unsigned long>(m.image.size),digest);
 }
 return n>0&&size_t(n)<sizeof(result)&&size_t(n)==length&&!memcmp(result,text,length);
}
}
Artifact::Artifact(){mbedtls_sha256_init(&hash_);}
Artifact::~Artifact(){mbedtls_sha256_free(&hash_);}
bool Artifact::clear(){
 if(pinned_)return false;
 if(hashing_)mbedtls_sha256_free(&hash_);
#ifdef COOLLAMP_BRIDGE_BENCH
 benchMarkerFound_=false;benchMarkerAt_=0;
#endif
 diagnosticMarkerFound_=false;diagnosticMarkerAt_=0;
 mbedtls_sha256_init(&hash_);hashing_=false;source_={};metadata_={};state_=State::Empty;error_=Error::None;offset_=0;markerAt_=0;markerLength_=0;markerFound_=false;memset(marker_,0,sizeof(marker_));return true;
}
bool Artifact::fail(Error reason){
 if(hashing_){mbedtls_sha256_free(&hash_);mbedtls_sha256_init(&hash_);hashing_=false;}
 state_=State::Error;error_=reason;return false;
}
bool Artifact::rawRead(uint32_t at,uint8_t* out,size_t n){
 if(!source_.read||!out||at>metadata_.image.size||n>metadata_.image.size-at||at>source_.capacity||n>source_.capacity-at)return fail(Error::Bounds);
 if(!source_.read(source_.context,at,out,n))return fail(Error::Read);
 return true;
}
bool Artifact::inspectImage(){
 // ESP application header is 24 bytes, followed by eight-byte segment headers.
 // Validate the cached TARGET chip (C3=5), never the S3 host's chip identifier.
 uint8_t header[24]{},segment[8]{},description[4]{};
 if(!rawRead(0,header,sizeof(header)))return false;
 if(header[0]!=0xe9||!header[1]||header[1]>16||header[12]!=5||header[13]!=0||header[23]!=1)return fail(Error::Image);
 uint32_t end=24;
 for(unsigned i=0;i<header[1];++i){
  if(!rawRead(end,segment,sizeof(segment)))return false;
  end+=8;const uint32_t n=little32(segment+4);
  if(n>metadata_.image.size-end)return fail(Error::Image);
  if(i==0){if(n<4||!rawRead(end,description,4))return fail(Error::Image);if(little32(description)!=0xabcd5432)return fail(Error::Image);}
  end+=n;
 }
 // Checksum is the final byte of the next 16-byte block; the appended image
 // digest follows. The receiver also performs ESP-IDF image validation.
 const uint32_t exact=((end+16)&~uint32_t(15))+32;
 return exact==metadata_.image.size||fail(Error::Image);
}
bool Artifact::begin(Source source,const char* original,size_t length,Trust trust,VerifyPublisher verify,void* context){
 if(!clear())return false;
 if(!original||!length||length>=sizeof(metadata_.original)||memchr(original,0,length))return fail(Error::Manifest);
 if(trust==Trust::None)return fail(Error::Untrusted);
 Metadata next{};next.trust=trust;
 if(trust==Trust::PublisherSignature){
  UpdatePublisher::Manifest signedImage{};
  if(!verify||!verify(context,original,length,signedImage))return fail(Error::Untrusted);
  next.image=signedImage.image;next.epoch=signedImage.epoch;next.keyId=signedImage.keyId;memcpy(next.signature,signedImage.signature,64);
  if(!next.epoch||next.epoch==UINT32_MAX||!next.keyId)return fail(Error::Manifest);
 }else if(trust==Trust::HttpsPinnedLegacy){
  char copy[UpdatePublisher::ManifestCapacity]{};memcpy(copy,original,length);
  if(!parseFirmwareManifest(copy,next.image))return fail(Error::Manifest);
#ifdef COOLLAMP_BRIDGE_BENCH
 }else if(trust==Trust::LocalPhysicalBench){
  // Physical bench authorization pins these exact bytes at build time. This
  // is neither HTTPS release provenance nor a publisher signature. The normal
  // bridge build has no way to activate this trust class.
  if(length!=sizeof(BridgeBenchFixture::Manifest)-1||memcmp(original,BridgeBenchFixture::Manifest,length))return fail(Error::Untrusted);
  char copy[UpdatePublisher::ManifestCapacity]{};memcpy(copy,original,length);
  if(!parseFirmwareManifest(copy,next.image)||next.image.version[0]!=1||next.image.version[1]!=15||next.image.version[2]!=5)return fail(Error::Manifest);
#endif
 }else return fail(Error::Untrusted);
 if(next.image.size<288||next.image.size>MaximumImageSize||!canonical(next,original,length))return fail(Error::Manifest);
 if(!source.read||source.capacity<next.image.size)return fail(Error::Bounds);
 memcpy(next.original,original,length);next.originalLength=length;metadata_=next;source_=source;
 if(!inspectImage())return false;
 const int used=snprintf(marker_,sizeof(marker_),"COOLLAMP-PUBLIC-%u.%u.%u",next.image.version[0],next.image.version[1],next.image.version[2]);
 if(used<=0||size_t(used)>=sizeof(marker_))return fail(Error::Marker);
 markerLength_=size_t(used)+1;
 if(mbedtls_sha256_starts(&hash_,0))return fail(Error::Hash);
 hashing_=true;state_=State::Verifying;return true;
}
void Artifact::service(size_t budget){
 if(state_!=State::Verifying||!budget)return;
 // Bound one service call even if a caller accidentally supplies a huge budget.
 if(budget>4096)budget=4096;
 uint8_t bytes[512];
 while(budget&&offset_<metadata_.image.size){
  size_t n=metadata_.image.size-offset_;if(n>sizeof(bytes))n=sizeof(bytes);if(n>budget)n=budget;
  if(!rawRead(offset_,bytes,n))return;
  if(mbedtls_sha256_update(&hash_,bytes,n)){fail(Error::Hash);return;}
  for(size_t i=0;i<n;++i){
   if(bytes[i]==uint8_t(marker_[markerAt_])){if(++markerAt_==markerLength_){markerFound_=true;markerAt_=0;}}
   else markerAt_=bytes[i]==uint8_t(marker_[0])?1:0;
   constexpr char testPrefix[]="COOLLAMP-TEST-IMAGE-";
   if(bytes[i]==uint8_t(testPrefix[diagnosticMarkerAt_])){if(++diagnosticMarkerAt_==sizeof(testPrefix)-1){diagnosticMarkerFound_=true;diagnosticMarkerAt_=0;}}
   else diagnosticMarkerAt_=bytes[i]==uint8_t(testPrefix[0])?1:0;
#ifdef COOLLAMP_BRIDGE_BENCH
   if(metadata_.trust==Trust::LocalPhysicalBench){
    constexpr char diagnostic[]="COOLLAMP-TEST-IMAGE-1.15.5";
    if(bytes[i]==uint8_t(diagnostic[benchMarkerAt_])){if(++benchMarkerAt_==sizeof(diagnostic)-1){benchMarkerFound_=true;benchMarkerAt_=0;}}
    else benchMarkerAt_=bytes[i]==uint8_t(diagnostic[0])?1:0;
   }
#endif
  }
  offset_+=uint32_t(n);budget-=n;
 }
 if(offset_<metadata_.image.size)return;
 uint8_t digest[32];const int result=mbedtls_sha256_finish(&hash_,digest);mbedtls_sha256_free(&hash_);mbedtls_sha256_init(&hash_);hashing_=false;
 if(result||memcmp(digest,metadata_.image.sha256,32)){fail(Error::Hash);return;}
 if(!markerFound_){fail(Error::Marker);return;}
 if(diagnosticMarkerFound_&&metadata_.trust!=Trust::LocalPhysicalBench){fail(Error::Untrusted);return;}
#ifdef COOLLAMP_BRIDGE_BENCH
 if(metadata_.trust==Trust::LocalPhysicalBench&&!benchMarkerFound_){fail(Error::Marker);return;}
#endif
 state_=State::Ready;error_=Error::None;
}
bool Artifact::acquire(){if(!ready()||pinned_)return false;pinned_=true;return true;}
bool Artifact::read(uint32_t at,uint8_t* out,size_t n){return ready()&&rawRead(at,out,n);}
}
