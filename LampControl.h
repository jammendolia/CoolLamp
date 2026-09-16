#pragma once
#include <stdint.h>

constexpr uint8_t LAMP_PROTOCOL_VERSION = 1;
constexpr uint8_t LAMP_EFFECT_COUNT = 29;

struct LampColor { uint8_t enabled, r, g, b; };
LampColor getLampColor(uint8_t mode);
bool setLampColor(uint8_t mode, uint8_t r, uint8_t g, uint8_t b);
bool resetLampColor(uint8_t mode);
void loadLampColors();
bool saveLampColors();

struct LampControlState {
  uint8_t mode;
  uint8_t brightness;
  bool power;
};

// Called only on the Arduino loop task, including commands queued by BLE.
LampControlState getLampControlState();
bool setLampControl(uint32_t mode, uint32_t brightness, bool power);
bool saveLampDefaults();
