#pragma once
#include "LampSyncProtocol.h"
namespace LampSyncRadioCrypto {
constexpr size_t HeaderSize=16, BodySize=offsetof(LampSyncWire::Packet,mac), TagSize=16, EnvelopeSize=HeaderSize+BodySize+TagSize;
static_assert(EnvelopeSize<=250,"ESP-NOW envelope must fit every supported radio version");
struct SendNonce {uint64_t session=0;uint32_t sequence=0;uint8_t bodyHash[32]{};};
bool identityFromMac(const uint8_t* address,char* identity);
bool macFromIdentity(const char* identity,uint8_t* address);
bool seal(const LampSyncWire::Packet& packet,const char* destination,const uint8_t* groupKey,
  uint8_t* output,size_t capacity,SendNonce& previous);
bool open(const uint8_t* input,size_t length,const uint8_t* source,const char* destination,const uint8_t* groupKey,LampSyncWire::Packet& packet);
// Expanded frames use a separate group-broadcast key domain; never a per-peer
// key/nonce. Only already nonce-admitted followers may consume these frames.
bool sealBroadcast(const LampSyncWire::Packet& packet,const uint8_t* groupKey,uint8_t* output,size_t capacity,SendNonce& previous);
bool openBroadcast(const uint8_t* input,size_t length,const uint8_t* source,const uint8_t* groupKey,LampSyncWire::Packet& packet);
}
