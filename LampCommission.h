#pragma once
#include "LampEspNow.h"
#include "LampControlEndpoint.h"
struct LampCommissionComparisonSnapshot {uint8_t version=0,count=0,symbols[7]{};bool approvalReady=false;};
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
// Public comparison data only, copied from the accepted target transcript.
// Allows an accessory display to show the same symbols without inferring them
// from radio advertisements or exposing any key/nonce material.
using ComparisonSnapshot=LampCommissionComparisonSnapshot;
bool comparisonSnapshot(ComparisonSnapshot& out);
String candidatesJson();
// comparisonVersion=2 is opt-in and must be supported by the discovered target.
// No downgrade is performed; v1 retains its existing four-color behavior.
LampControlReply start(const String& target,const String& requestId,const String& broker,uint8_t comparisonVersion=1);
LampControlReply status(const String& target,const String& requestId,const String& broker);
LampControlReply cancel(const String& target,const String& requestId,const String& broker);
}
// Implemented by the loop integration: no fleet, saved Wi-Fi, BLE phone bonds,
// configured group, active setup AP or pairing/provisioning operation.
bool lampMeshEnrollmentEligible();
