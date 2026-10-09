#pragma once
#include <Arduino.h>

// The encrypted Bluetooth RPC and HTTP adapters share the same loop-only
// endpoint implementation. Passwords/tokens never belong in the snapshot.
namespace LampControlEndpoint {
enum Id : uint8_t {
  State=1, Sync=2, SyncInvite=3, Group=4, Scene=5, Order=6,
  Config=7, Audio=8, AudioTuning=9, Rotation=10, Geometry=11,
  Calibration=12, Name=13, Identify=14, VuColors=15,
  FountainColors=16, AudioTest=17, Firmware=18, FirmwareCheck=19,
  FirmwareInstall=20, FirmwareAutomatic=21, FactoryReset=22,
  OfflineJoin=23, Bluetooth=24, Style=25, Effects=26, FirmwareFleet=27,
  MeshStatus=28, MeshRequest=29, MeshResult=30,
  Power=31, Preview=32, Defaults=33, Color=34, EffectOptions=35,
  MeshNew=36, EnrollStart=37, EnrollStatus=38, EnrollCancel=39
};
}
struct LampControlReply {
  uint16_t status=500;
  String body;
};
// Implemented by the network/config adapter; called on the Arduino loop only.
String lampControlSnapshotJson();
LampControlReply lampControlRequest(uint8_t endpoint,bool mutation,const String& form);
