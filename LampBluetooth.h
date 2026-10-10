#pragma once
#include <Arduino.h>

#ifndef COOL_LAMP_BLE
#define COOL_LAMP_BLE 1
#endif

void beginLampBluetooth(const String& name);
void serviceLampBluetooth();
void setLampPairingWindow(bool open);
bool lampPairingOpen();
bool lampPairingCueActive();
String lampBluetoothStatusJson();
bool lampBluetoothReady();
bool lampBluetoothHasBonds();
// Loop-only. Success means all peer bond deletion was verified; a failure can
// be partial and requires an authoritative status read before retrying.
bool forgetLampPhones();
