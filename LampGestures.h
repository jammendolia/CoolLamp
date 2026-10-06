#pragma once
#include <stdint.h>

enum class LampGesture : uint8_t { None, Single, Double, Triple, Wifi, Pairing, FactoryArm, FactoryReset };
enum class KnobMode : uint8_t { Effects, Brightness, Color };

// Pure, nonblocking gesture recognition. All time differences tolerate millis wrap.
class LampGestures {
  bool raw = false, stable = false, wifi = false, pairing = false;
  bool factory = false, blockedHold = false;
  uint8_t clicks = 0;
  uint32_t changedAt = 0, pressedAt = 0, releasedAt = 0;
public:
  bool pressed() const { return raw || stable; }
  bool pending() const { return clicks != 0; }
  void reset(uint32_t now, bool down) {
    raw = stable = down; changedAt = pressedAt = releasedAt = now;
    clicks = 0; wifi = pairing = down; // Suppress a hold that began during an update.
    factory = false; blockedHold = down;
  }
  LampGesture takeClicks() {
    if (pressed() || !clicks) return LampGesture::None;
    const auto result = clicks == 1 ? LampGesture::Single : clicks == 2 ? LampGesture::Double : LampGesture::Triple;
    clicks = 0; return result;
  }
  LampGesture poll(uint32_t now, bool down) {
    if (down != raw) { raw = down; changedAt = now; }
    if (raw != stable && uint32_t(now - changedAt) >= 30) {
      stable = raw;
      if (stable) { pressedAt = changedAt; wifi = pairing = factory = blockedHold = false; }
      else if (factory && !blockedHold) { factory = false; clicks = 0; return LampGesture::FactoryReset; }
      else if (!wifi && !pairing && uint32_t(changedAt - pressedAt) <= 600) {
        if (clicks < 3) ++clicks;
        releasedAt = now;
      }
    }
    if (stable && raw && !blockedHold) {
      const uint32_t held = now - pressedAt;
      if (held > 600) clicks = 0;
      if (!wifi && held >= 3000) { wifi = true; return LampGesture::Wifi; }
      if (!pairing && held >= 6000) { pairing = true; return LampGesture::Pairing; }
      if (!factory && held >= 10000) { factory = true; return LampGesture::FactoryArm; }
    }
    if (!pressed() && clicks && uint32_t(now - releasedAt) >= 350) return takeClicks();
    return LampGesture::None;
  }
};
