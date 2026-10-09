#pragma once
#include "LampEspNow.h"
#include "LampControlEndpoint.h"
namespace LampCommission {
void begin();
void service(uint32_t now,bool blocked=false);
bool receive(const LampEspNow::Received&);
bool working();
bool physicalPending();
// Loop-only, exclusively from the new lamp's physical knob click. HTTP/BLE
// adapters deliberately have no equivalent approval operation.
void approvePhysical();
bool cue(uint32_t now,uint8_t& red,uint8_t& green,uint8_t& blue);
String candidatesJson();
LampControlReply start(const String& target,const String& requestId,const String& broker);
LampControlReply status(const String& target,const String& requestId,const String& broker);
LampControlReply cancel(const String& target,const String& requestId,const String& broker);
}
// Implemented by the loop integration: no fleet, saved Wi-Fi, BLE phone bonds,
// configured group, active setup AP or pairing/provisioning operation.
bool lampMeshEnrollmentEligible();
