#pragma once
#include <Arduino.h>
#include "LampVersion.h"
#include "LampUpdatePolicy.h"
#include "UpdateManifest.h"
#include "LampUpdateAutomatic.h"
#include "LampUpdateAttempt.h"
#include "UpdateHttpDiagnostics.h"
class LampJsonSink;

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
// Main-loop only: retain updater ownership after a possibly durable commit.
void holdLampUpdateCommitUnconfirmed();
bool beginLampBluetoothUpdateRadio();
void finishLampBluetoothUpdateRadio(bool restarting);
void getLampUpdatePacket(uint8_t* packet); // Exactly 20 bytes; fits minimum BLE MTU.
String lampUpdateJson();
struct LampUpdatePolicyJsonSnapshot {
  LampUpdatePolicy::Policy policy{};
  uint32_t revision=0;
  LampUpdatePolicy::Eligibility eligibility=LampUpdatePolicy::InvalidPolicy;
  uint8_t coordination=0;
  bool valid=false;
};
static_assert(sizeof(LampUpdatePolicyJsonSnapshot)<=84,"Policy read snapshot must stay bounded");
LampUpdatePolicyJsonSnapshot captureLampUpdatePolicyJson();
void appendLampUpdatePolicyJson(LampJsonSink& out,const LampUpdatePolicyJsonSnapshot& snapshot);
struct LampUpdateJsonSnapshot {
  LampUpdateStatus status{};
  LampUpdateAttempt::StatusSnapshot attempt{};
  LampUpdatePolicyJsonSnapshot policy{};
  UpdateHttpDiagnosticsSnapshot http{};
  LampUpdateAutomatic::Snapshot automaticService{};
  char deviceId[13]{};
  uint32_t heap=0,largest=0,workerStack=0,loopStack=0;
  bool wifi=false,healthy=false,publisher=false;
};
static_assert(sizeof(LampUpdateJsonSnapshot)<=256,"Update read snapshot must stay bounded");
LampUpdateJsonSnapshot captureLampUpdateJson(bool includeAutomatic=false);
void appendLampUpdateJson(LampJsonSink& out,const LampUpdateJsonSnapshot& snapshot,bool includeAutomatic=false);
// Loop-owned durable policy. Automatic and donation admission share this gate;
// Update now retains its explicit manual override.
void noteLampUpdateUse();
bool lampAutomaticUpdateAllowed();
bool lampAutomaticUpdateArtifactAllowed(const FirmwareManifest& artifact);
bool lampAutomaticDonorDiscoveryAllowed(); // RAM-only fallback admission; no scan/radio mutation.
void noteLampAutomaticDonorOffer(const FirmwareManifest& artifact); // Loop only, authenticated/validated artifact.
bool setLampUpdatePolicy(const LampUpdatePolicy::Policy& policy,uint32_t expectedRevision);
bool lampUpdatePolicySaveUncertain(); // Last save: failed return may have committed.
uint32_t lampUpdatePolicyRevision(); // Mutation CAS admission; may reconcile an uncertain save.
void serviceLampUpdatePolicy(uint32_t now); // Owning loop: bounded retry/volatile expiry.
String lampUpdatePolicyJson();
bool lampBootHealthy(); // Responsive-loop gate only, not complete peripheral/RF acceptance.
void beginLampManualUpdateCue(); // Loop only, after receiver reservation (never on a donor).
void finishLampManualUpdate(bool verified,bool commitUnconfirmed=false); // Loop only; selected/uncertain image retains owner until reboot.
void setLampManualUpdateCueProgress(uint32_t written); // Legacy upload has no pinned total.
void setLampManualUpdateCueProgress(uint32_t written,uint32_t total); // Pinned browser receiver only.
void setLampUpdateRoute(uint8_t route); // Loop-owned receiver route only.
bool lampRolloutRecoveryPreflight(const FirmwareManifest& pinned);
bool lampControlTrafficIdle(uint32_t now); // Owning loop only: active/recent HTTP or BLE.
