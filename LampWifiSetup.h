#pragma once
#include <Arduino.h>
#include "WifiSetupWire.h"

// Called only from the Arduino loop; Bluetooth callbacks enqueue bounded frames.
uint8_t lampWifiSetupCommand(const uint8_t* frame, size_t size, uint32_t owner, String& reply);
void serviceLampWifiSetup();
void resetLampWifiSetupTransfer();
void captureLampWifiSetupNetwork(uint8_t index, const String& ssid, int rssi, bool open);
void finishLampWifiSetupScan(bool success);
String lampWifiSetupJson();
bool lampWifiSetupBusy();
void beginLampWifiSetupDiagnostics();
