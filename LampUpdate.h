#pragma once
#include <Arduino.h>
#include "LampVersion.h"
#include "LampUpdatePolicy.h"
#include "UpdateManifest.h"

enum LampUpdatePhase : uint8_t { UPDATE_IDLE, UPDATE_CHECKING, UPDATE_AVAILABLE, UPDATE_DOWNLOADING, UPDATE_RESTARTING, UPDATE_ERROR };
enum LampUpdateError : uint8_t { UPDATE_OK, UPDATE_OFFLINE, UPDATE_CLOCK, UPDATE_NETWORK, UPDATE_MANIFEST, UPDATE_PARTITION, UPDATE_IMAGE, UPDATE_STORAGE, UPDATE_MEMORY };
enum LampUpdateRoute : uint8_t { UPDATE_ROUTE_NONE,UPDATE_ROUTE_INTERNET,UPDATE_ROUTE_BLUETOOTH,UPDATE_ROUTE_DONATION,UPDATE_ROUTE_MANUAL_UPLOAD };
struct LampUpdateStatus {
  uint8_t phase, progress, error;
  bool automatic, available;
  uint16_t latest[3];
  bool receiving=false,cueOn=false;
  uint8_t cueBrightness=0;
  uint32_t writtenOffset=0,totalBytes=0,cueGeneration=0;
  uint8_t route=UPDATE_ROUTE_NONE;
  uint32_t checkedAt=0;
};
void beginLampUpdater();
void serviceLampUpdater();
LampUpdateStatus getLampUpdateStatus();
bool requestLampUpdateCheck();
bool requestLampUpdateInstall();
bool setLampAutoUpdate(bool enabled);
bool lampRemoteUpdateBusy();
bool lampUpdateOwnsResources();
bool reserveLampManualUpdate();
void releaseLampManualUpdate();
bool beginLampBluetoothUpdate();
void setLampBluetoothUpdateProgress(uint32_t received,uint32_t total);
void finishLampBluetoothUpdate(bool verified,bool cancelled=false);
bool beginLampBluetoothUpdateRadio();
void finishLampBluetoothUpdateRadio(bool restarting);
void getLampUpdatePacket(uint8_t* packet); // Exactly 20 bytes; fits minimum BLE MTU.
String lampUpdateJson();
// Loop-owned durable policy. Automatic and donation admission share this gate;
// Update now retains its explicit manual override.
void noteLampUpdateUse();
bool lampAutomaticUpdateAllowed();
bool setLampUpdatePolicy(const LampUpdatePolicy::Policy& policy,uint32_t expectedRevision);
bool lampUpdatePolicySaveUncertain(); // Last save: failed return may have committed.
uint32_t lampUpdatePolicyRevision();
String lampUpdatePolicyJson();
bool lampBootHealthy(); // Responsive-loop gate only, not complete peripheral/RF acceptance.
void beginLampManualUpdateCue(); // Loop only, after receiver reservation (never on a donor).
void setLampManualUpdateCueProgress(uint32_t written); // Legacy upload has no pinned total.
void setLampUpdateRoute(uint8_t route); // Loop-owned receiver route only.
bool lampRolloutRecoveryPreflight(const FirmwareManifest& pinned);
