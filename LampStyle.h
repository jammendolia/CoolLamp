#pragma once
#include <stdint.h>

// Physical construction selected by the user, independent of ESP32 hardware,
// LED count, midpoint, effect, lamp name, GPIOs and group membership.
enum class LampPhysicalStyle : uint8_t {
  Unspecified=0,
  Helix=1,
  LargeHelix=2,
  Corkscrew=3
};
void beginLampStyle();
LampPhysicalStyle getLampStyle();
uint8_t lampStyleCode();
const char* lampStyleId();
const char* lampStyleFamily();
bool configureLampStyle(uint8_t code);
#ifdef ARDUINO
#include <Arduino.h>
String lampStyleJson();
#endif
