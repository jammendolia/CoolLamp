#pragma once
#include <Arduino.h>
#include "LampVersion.h"

enum LampUpdatePhase : uint8_t { UPDATE_IDLE, UPDATE_CHECKING, UPDATE_AVAILABLE, UPDATE_DOWNLOADING, UPDATE_RESTARTING, UPDATE_ERROR };
enum LampUpdateError : uint8_t { UPDATE_OK, UPDATE_OFFLINE, UPDATE_CLOCK, UPDATE_NETWORK, UPDATE_MANIFEST, UPDATE_PARTITION, UPDATE_IMAGE, UPDATE_STORAGE, UPDATE_MEMORY };
struct LampUpdateStatus {
  uint8_t phase, progress, error;
  bool automatic, available;
  uint16_t latest[3];
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
void getLampUpdatePacket(uint8_t* packet); // Exactly 20 bytes; fits minimum BLE MTU.
String lampUpdateJson();
