#pragma once
#include "LampControlEndpoint.h"
#include "LampMeshCore.h"

// Transport adapter for a standalone bridge. HTTP authorization belongs to the
// caller. Except enqueueReceive(), call these functions on the Arduino loop.
// Stop/quiesce the radio receive producer before begin() or stop().
namespace BridgeControl {
constexpr size_t ReceiveCapacity=8, ResultPageSize=256;
constexpr uint32_t ReceiveMaxAge=1500, ResultRetention=15000;
constexpr size_t DiagnosticCapacity=1024;
struct Hooks {
  void* context=nullptr;
  // Copy an existing enrolled fleet credential. Never generate a substitute.
  bool (*copyFleetKey)(void*,uint8_t* out16)=nullptr;
  String (*fleetId)(void*)=nullptr;
  bool (*send)(void*,const uint8_t*,size_t)=nullptr;
  // Renew a short radio-channel lease while authenticated neighbors or control
  // work require the current channel. Expiry lets offline discovery resume.
  void (*holdChannel)(void*,uint32_t until)=nullptr;
  // Optional admission restriction, applied in addition to wire authentication.
  bool (*trusted)(void*,const uint8_t*)=nullptr;
  // Optional truthful local GET State/Descriptor/Revision/MeshStatus response.
  // Local mutations are rejected before this hook is called.
  uint16_t (*localRead)(void*,uint8_t,uint8_t*,size_t,size_t&)=nullptr;
  // Bridge-origin ordinary requests only. Authenticated discovery/forwarding,
  // retained results and State/Descriptor/Revision GET + Receipt POST query
  // stay available to reconcile a previously uncertain target mutation.
  bool (*allowRequest)(void*,const uint8_t* actualTargetMac)=nullptr;
};
bool begin(const uint8_t* selfStaMac,uint64_t boot,const char* name,const char* version,const Hooks&);
void stop();
// Single producer; bounded copy only, no authentication/state changes here.
bool enqueueReceive(const uint8_t* source,const uint8_t* wire,size_t size,uint32_t receivedAt);
void service(uint32_t now,bool wifiConnected,bool blocked=false);
bool enabled();
bool working();
// Read-only serving-policy mutation admission. Retain unconsumed completed
// control results until their owner consumes them or bounded retention ends.
bool policyChangeAllowed();
bool online(const uint8_t* address);
uint32_t receiveDropped();
String statusJson();
// Local read-only RAM diagnostics: never contains request/reply bodies, names,
// access tokens/passwords, Wi-Fi networks or household key material. Result
// query counts reset for each accepted command; times use rollover-safe
// milliseconds since that command. Duplicate-request result reads also count.
String diagnosticJson();
String stateJson();
LampControlReply request(const String& target,const String& requestId,const String& endpoint,
                         const String& method,const String& form,const String& expectedTargetBoot=String());
LampControlReply result(const String& target,const String& requestId,const String& offset,
                        const String& expectedTargetBoot=String());
}
