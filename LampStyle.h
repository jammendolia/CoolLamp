#pragma once
#include <stdint.h>

// Physical construction classification, independent of ESP32 hardware,
// LED count, midpoint, effect, lamp name, GPIOs and group membership.
enum class LampPhysicalStyle : uint8_t {
  Unspecified=0,
  Helix=1,
  LargeHelix=2,
  Corkscrew=3,
  Edison=4
};
// Append new styles without renumbering saved/wire values. Unknown future
// factory IDs remain in their string descriptor and use generic classification.
constexpr uint8_t LAMP_PHYSICAL_STYLE_MAX=static_cast<uint8_t>(LampPhysicalStyle::Edison);
void beginLampStyle();
LampPhysicalStyle getLampStyle();
uint8_t lampStyleCode();
const char* lampStyleId();
const char* lampStyleFamily();
bool configureLampStyle(uint8_t code);
bool lampStyleLocked();
bool lampStyleSupportsEffect(uint8_t localId,bool scene=false);
class LampJsonSink;
void appendLampStyleJson(LampJsonSink& out);
#ifdef ARDUINO
#include <Arduino.h>
String lampStyleJson();
#endif
