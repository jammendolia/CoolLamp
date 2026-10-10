#pragma once
#include "LampEspNow.h"
#include "LampControlEndpoint.h"
#include "UpdateManifest.h"
namespace LampFirmwareRelay {
void begin();
bool ownsRadio();
bool receive(const LampEspNow::Received& message);
void service(uint32_t now);
void suspend();
// Called only by authenticated encrypted BLE RPC, never exposed over HTTP.
LampControlReply control(bool mutation,const String& form);
// Internal loop services only. Fleet bytes never belong to an HTTP/JSON reply.
bool copyFleetKey(uint8_t* out);
bool provisionFleetKey(const uint8_t* key);
String fleetId();
bool runningManifest(FirmwareManifest& out); // False until incrementally measured and validated.
}
