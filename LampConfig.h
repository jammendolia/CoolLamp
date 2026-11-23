#pragma once
#include <Arduino.h>

// Change the default for new lamps, or set the active length on the Wi-Fi page.
#define DEFAULT_LED_COUNT 134
#define MAX_LED_COUNT 1024
static_assert(DEFAULT_LED_COUNT >= 1 && DEFAULT_LED_COUNT <= MAX_LED_COUNT,
              "Default LED count must fit the allocated strip buffer");

struct LampSettings {
  uint32_t version;
  uint16_t ledCount;
  uint16_t milliAmps;
  uint8_t brightness;
  uint8_t startupMode;
  char ssid[33];
  char wifiPassword[64];
  char adminPassword[64];
};
extern LampSettings lampSettings;
void loadLampSettings();
// beginLampSync() initializes this canonical low-48-bit hardware identity
// before updater, network and Bluetooth startup. Keep one representation for
// every subsystem instead of repeatedly formatting the eFuse MAC.
const char* lampIdentityText();
inline String lampIdentity(){return String(lampIdentityText());}
String lampEffectCatalogEntry(uint8_t mode);
bool lampIdentifyActive();
void beginLampNetwork();
void serviceLampNetwork();
void cancelLampSetupPulse();
bool lampIsUpdating();
bool lampNetworkRestartPending();
bool lampSetupPulse();
String lampCenterCalibrationJson();
