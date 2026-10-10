#pragma once
#include "UpdateManifest.h"
namespace UpdatePublisher {
// Largest canonical text is 280 bytes (max version/size/epoch), plus NUL.
constexpr size_t ManifestCapacity=288,PublicKeySize=65,SignatureSize=64,MaxTrustedKeys=4;
struct TrustedKey {uint32_t id,firstEpoch,lastEpoch;uint8_t publicKey[PublicKeySize];};
struct Manifest {FirmwareManifest image{};uint32_t epoch=0,keyId=0;uint8_t signature[SignatureSize]{};};
// Strict text contract. Verification consumes canonical bytes preceding the
// signature line. Raw P256 r||s signature matches WebCrypto ECDSA semantics.
bool verify(const char* text,size_t length,const TrustedKey* keys,size_t keyCount,
            uint32_t minimumEpoch,const uint16_t minimumVersion[3],Manifest& out);
// Immutable public-key provisioning only. The default has NO publisher root;
// legacy integrity/fleet trust remains accurately reported until provisioning.
bool enforced();
bool verifyProvisioned(const char* text,size_t length,Manifest& out);
uint32_t minimumEpoch();
bool recordEpoch(uint32_t epoch); // Separate reset-retained trust namespace.
bool retainManifest(const char* text,size_t length); // Original signed bytes only.
bool copyRetainedManifest(char* out,size_t capacity,size_t& length);
bool format(const Manifest& manifest,char* out,size_t capacity,size_t& length);
}
