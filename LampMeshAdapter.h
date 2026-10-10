#pragma once
#include "LampEspNow.h"
#include "LampControlEndpoint.h"
namespace LampMeshAdapter {
void begin();
bool receive(const LampEspNow::Received& message);
void service(uint32_t now,bool blocked=false);
bool working();
// Retains mesh intent during a bounded Wi-Fi probe or other radio suspension.
bool enabled();
bool online(const uint8_t* address);
String statusJson();
LampControlReply request(const String& target,const String& requestId,const String& endpoint,const String& method,const String& form,bool confidential=false);
LampControlReply result(const String& target,const String& requestId,const String& offset,bool confidential=false);
}
