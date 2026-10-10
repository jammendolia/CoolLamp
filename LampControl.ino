#include "LampControl.h"

static_assert(LAMP_EFFECT_COUNT == MODE_MAX, "Keep the Bluetooth effect count in sync");

uint8_t lampAvailableEffectCount() { return (lampHasMicrophone() || lampSyncFollowing()) ? LAMP_EFFECT_COUNT : LAMP_BASE_EFFECT_COUNT; }

LampControlState getLampControlState()
{
  return {Mode, Brightness, PowerOn};
}

bool setLampControl(uint32_t mode, uint32_t brightness, bool power)
{
  if (lampCalibrationActive()) return false;
  const bool wasFollowing = lampSyncFollowing();
  if (wasFollowing) {
    pauseLampSync();
    if (mode > lampAvailableEffectCount()) mode = Mode;
  }
  if (mode < 1 || mode > lampAvailableEffectCount() || brightness < 1 || brightness > 255) return false;
  if (Mode != mode) {
    if(!leaveLampSceneForEffect())return false;
    Mode = mode;
    fill_solid(leds, NUM_LEDS, CRGB::Black);
  }
  // A disconnected follower can rejoin later. Local off must pause it too.
  if (!power && !wasFollowing) pauseLampSync();
  Brightness = brightness;
  PowerOn = power;
  syncLampKnob();
  FastLED.setBrightness(PowerOn ? Brightness : 0);
  noteLampUpdateUse();
  return true;
}
