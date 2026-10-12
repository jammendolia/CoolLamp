#pragma once
#include <Arduino.h>
#include "UpdateManifest.h"
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
String statusJson(const FirmwareManifest& candidate);
}
