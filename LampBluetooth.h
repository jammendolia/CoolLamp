#pragma once
#include <Arduino.h>

#ifndef COOL_LAMP_BLE
#define COOL_LAMP_BLE 1
#endif

void beginLampBluetooth(const String& name);
void serviceLampBluetooth();
void setLampPairingWindow(bool open);
bool lampPairingOpen();
bool lampBluetoothReady();
void forgetLampPhones();
