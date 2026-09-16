#include "LampControl.h"

static_assert(LAMP_EFFECT_COUNT == MODE_MAX, "Keep the Bluetooth effect count in sync");

LampControlState getLampControlState()
{
  return {Mode, Brightness, PowerOn};
}

bool setLampControl(uint32_t mode, uint32_t brightness, bool power)
{
  if (mode < 1 || mode > MODE_MAX || brightness < 1 || brightness > 255) return false;
  if (Mode != mode) {
    Mode = mode;
    fill_solid(leds, NUM_LEDS, CRGB::Black);
  }
  Brightness = brightness;
  PowerOn = power;
  syncLampKnob();
  FastLED.setBrightness(PowerOn ? Brightness : 0);
  return true;
}
