#pragma once
#include "LampControlEndpoint.h"
#include <stddef.h>
#include <stdint.h>

// Local bridge serving policy, independent of household ownership and group
// membership. Call begin/service/request only on the bridge owning loop.
// Read helpers never access NVS. Authorization belongs to the HTTP caller.
namespace BridgeLampLinks {
constexpr size_t MaximumExcluded=64, ReceiptCapacity=4, StatusCapacity=1536, ReceiptJsonCapacity=512;
constexpr uint32_t ReceiptLifetimeMs=60000, StorageRetryMs=1000;
bool begin(const char* bridgeIdentity,uint64_t boot);
void service(uint32_t now,bool busy=false);
bool ready();
bool allows(const uint8_t* actualTargetMac); // Fail closed while storage is uncertain.
String statusJson();
// add = allow this bridge to serve an existing authorized household lamp;
// remove = exclude it from this bridge's new control/donation requests.
// Neither operation enrolls/revokes a household credential or alters a group.
// requestId/expectedBoot: exactly 16 lowercase hex digits, nonzero.
// expectedRevision: canonical decimal uint32; no automatic lost-reply replay.
LampControlReply request(const String& action,const String& target,const String& requestId,
                         const String& expectedBoot,const String& expectedRevision,bool busy=false);
LampControlReply receipt(const String& requestId,const String& expectedBoot);
}
