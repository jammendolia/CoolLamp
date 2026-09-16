#pragma once
#include <stdint.h>

constexpr uint8_t LAMP_PROTOCOL_VERSION = 1;
constexpr uint8_t LAMP_EFFECT_COUNT = 28;

struct LampControlState {
  uint8_t mode;
  uint8_t brightness;
  bool power;
};

// Called only on the Arduino loop task, including commands queued by BLE.
LampControlState getLampControlState();
bool setLampControl(uint32_t mode, uint32_t brightness, bool power);
bool saveLampDefaults();
