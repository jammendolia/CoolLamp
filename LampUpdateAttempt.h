#pragma once
#include <Arduino.h>
#include "UpdateManifest.h"
class LampJsonSink;
// Reset-retained exact-artifact quarantine. Loop-owned admission/confirmation;
// the updater owner may record its validated commit before boot selection.
namespace LampUpdateAttempt {
constexpr size_t Capacity=4,RecordSize=188;
void begin();
bool automaticAllowed(const FirmwareManifest& artifact);
enum AdmissionReason:uint8_t {Eligible,Unconfirmed,Full,Unavailable,InvalidArtifact};
AdmissionReason automaticAdmissionReason(const FirmwareManifest& artifact); // Pure, allocation-free.
bool prepare(const FirmwareManifest& artifact,bool explicitRepair);
bool confirmHealthy(const FirmwareManifest& measuredRunning);
// Capture once before counting/writing a reply. Reads only the in-memory
// quarantine under its lock; encoding never reads NVS or changes admission.
struct StatusSnapshot {
 bool storageReady=false;
 uint8_t unconfirmedArtifacts=0,candidateReason=3;
};
static_assert(sizeof(StatusSnapshot)==3,"Attempt read snapshot must stay bounded");
StatusSnapshot captureStatus(const FirmwareManifest& candidate);
void appendStatus(LampJsonSink& out,const StatusSnapshot& snapshot);
String statusJson(const FirmwareManifest& candidate);
}
