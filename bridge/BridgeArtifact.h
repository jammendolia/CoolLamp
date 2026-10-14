#pragma once
#include "UpdatePublisher.h"
#include <mbedtls/sha256.h>

namespace BridgeArtifact {
constexpr uint32_t MaximumImageSize=2031616;
// The storage owner must not erase/write this source while Artifact::pinned().
struct Source {
 void* context=nullptr;
 bool (*read)(void*,uint32_t,uint8_t*,size_t)=nullptr;
 uint32_t capacity=0;
};
enum class Trust:uint8_t {None,HttpsPinnedLegacy,PublisherSignature,LocalPhysicalBench};
enum class State:uint8_t {Empty,Verifying,Ready,Error};
enum class Error:uint8_t {None,Manifest,Untrusted,Bounds,Read,Image,Hash,Marker};
using VerifyPublisher=bool (*)(void*,const char*,size_t,UpdatePublisher::Manifest&);
struct Metadata {
 FirmwareManifest image{};
 Trust trust=Trust::None;
 uint32_t epoch=0,keyId=0;
 uint8_t signature[64]{};
 char original[UpdatePublisher::ManifestCapacity]{};
 size_t originalLength=0;
};
class Artifact {
 public:
 Artifact();
 ~Artifact();
 Artifact(const Artifact&)=delete;
 Artifact& operator=(const Artifact&)=delete;
 // Legacy trust is supplied only after the downloader validates a pinned HTTPS
 // release. Signed trust additionally requires the original publisher verifier.
 bool begin(Source,const char* original,size_t length,Trust,
            VerifyPublisher=nullptr,void* verifierContext=nullptr);
 void service(size_t byteBudget=1024);
 bool clear();
 bool ready()const{return state_==State::Ready;}
 bool pinned()const{return pinned_;}
 State state()const{return state_;}
 Error error()const{return error_;}
 uint32_t verifiedBytes()const{return offset_;}
 const Metadata& metadata()const{return metadata_;}
 bool acquire();
 void release(){pinned_=false;}
 bool read(uint32_t offset,uint8_t* output,size_t count);
 private:
 bool fail(Error);
 bool inspectImage();
 bool rawRead(uint32_t,uint8_t*,size_t);
 Source source_{};
 Metadata metadata_{};
 State state_=State::Empty;
 Error error_=Error::None;
 bool hashing_=false,pinned_=false,markerFound_=false;
 bool diagnosticMarkerFound_=false;
 size_t diagnosticMarkerAt_=0;
#ifdef COOLLAMP_BRIDGE_BENCH
 bool benchMarkerFound_=false;
 size_t benchMarkerAt_=0;
#endif
 uint32_t offset_=0;
 size_t markerAt_=0,markerLength_=0;
 char marker_[64]{};
 mbedtls_sha256_context hash_{};
};
}
