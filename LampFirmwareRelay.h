#pragma once
#include "LampEspNow.h"
#include "LampControlEndpoint.h"
namespace LampFirmwareRelay {
void begin();
bool ownsRadio();
bool receive(const LampEspNow::Received& message);
void service(uint32_t now);
void suspend();
// Called only by authenticated encrypted BLE RPC, never exposed over HTTP.
LampControlReply control(bool mutation,const String& form);
}
