#include "LampGestures.h"

static KnobMode knobMode = KnobMode::Effects;
static LampGestures knobGestures;
static uint32_t knobActivity = 0;
static uint8_t knobEffect = 0;
static bool knobDirty = false;
static uint8_t knobColorIndex = 0;
static bool knobBrightnessPending = false, knobColorsPending = false;
static uint32_t knobSaveAttempt = 0;

// A small, deliberate palette includes usable whites and a warmer pink.
static const uint8_t knobPalette[][3] = {
  {255,100,30}, {255,170,85}, {255,220,170}, {255,255,255},
  {190,220,255}, {255,0,0}, {255,45,0}, {255,110,0},
  {255,190,0}, {255,255,0}, {140,255,0}, {0,255,0},
  {0,255,100}, {0,255,210}, {0,180,255}, {0,70,255},
  {0,0,255}, {90,0,255}, {180,0,255}, {255,0,150},
  {255,35,85}, {255,90,130}, {255,150,170}, {255,65,45}
};
static constexpr int knobPaletteSize = sizeof(knobPalette) / sizeof(knobPalette[0]);

void syncLampKnob() {
  if (knobMode == KnobMode::Brightness) {
    rotaryEncoder.setBoundaries(1, 255, false);
    rotaryEncoder.setEncoderValue(Brightness);
  } else if (knobMode == KnobMode::Color) {
    rotaryEncoder.setBoundaries(0, knobPaletteSize - 1, true);
    rotaryEncoder.setEncoderValue(knobColorIndex);
  } else {
    rotaryEncoder.setBoundaries(1, MODE_MAX, true);
    rotaryEncoder.setEncoderValue(Mode);
  }
  rotaryEncoder.encoderChanged(); // Discard movement from the previous mode.
}

void savePendingLampKnob() {
  knobSaveAttempt = millis();
  if (knobBrightnessPending && saveLampKnobBrightness()) knobBrightnessPending = false;
  if (knobColorsPending && saveLampColors()) knobColorsPending = false;
}

bool finishLampKnob() {
  if (knobDirty && knobMode == KnobMode::Brightness) knobBrightnessPending = true;
  if (knobDirty && knobMode == KnobMode::Color) knobColorsPending = true;
  if (knobDirty) savePendingLampKnob();
  knobDirty = false;
  knobMode = KnobMode::Effects;
  syncLampKnob();
  return true;
}

void enterLampKnob(KnobMode next) {
  if (!finishLampKnob()) return;
  knobMode = next; knobEffect = Mode; knobActivity = millis();
  if (next == KnobMode::Color) {
    // Prefer the actual custom color, otherwise use the rendered effect color.
    const auto c = getLampColor(Mode);
    CRGB current = c.enabled ? CRGB(c.r,c.g,c.b) : leds[NUM_LEDS / 2];
    uint32_t best = UINT32_MAX;
    for (int i = 0; i < knobPaletteSize; ++i) {
      const int dr = int(current.r)-knobPalette[i][0], dg = int(current.g)-knobPalette[i][1], db = int(current.b)-knobPalette[i][2];
      const uint32_t distance = dr*dr + dg*dg + db*db;
      if (distance < best) { best = distance; knobColorIndex = i; }
    }
  }
  syncLampKnob();
}

void applyLampGesture(LampGesture gesture) {
  if (gesture == LampGesture::None) return;
  knobActivity = millis();
  if (gesture == LampGesture::Wifi || gesture == LampGesture::Pairing) {
    finishLampKnob();
    if (gesture == LampGesture::Wifi) toggleLampSetup();
    else { cancelLampSetupPulse(); setLampPairingWindow(!lampPairingOpen()); }
  } else if (!PowerOn) {
    if (gesture == LampGesture::Single) setLampControl(Mode, Brightness, true);
  } else if (gesture == LampGesture::Triple) {
    finishLampKnob(); setLampControl(Mode, Brightness, false);
  } else if (gesture == LampGesture::Double) enterLampKnob(KnobMode::Color);
  else if (knobMode == KnobMode::Effects) enterLampKnob(KnobMode::Brightness);
  else finishLampKnob();
}

bool serviceLampKnob() {
  const uint32_t now = millis();
  const bool down = digitalRead(DI_ENCODER_SW) == LOW;
  if (lampIsUpdating()) {
    knobGestures.reset(now, down);
    knobActivity = now;
    syncLampKnob();
    return false;
  }
  // A phone/web effect or power change ends adjustment of the previous effect.
  if (knobMode != KnobMode::Effects && (Mode != knobEffect || !PowerOn)) finishLampKnob();
  const auto gesture = knobGestures.poll(now, down);
  if (knobGestures.pressed()) knobActivity = now;
  applyLampGesture(gesture);
  bool changed = gesture != LampGesture::None;
  if (rotaryEncoder.encoderChanged()) {
    const long value = rotaryEncoder.getEncoderValue();
    const long previous = knobMode == KnobMode::Brightness ? Brightness : knobMode == KnobMode::Color ? knobColorIndex : Mode;
    long delta = value - previous;
    if (knobMode != KnobMode::Brightness) {
      const long size = knobMode == KnobMode::Color ? knobPaletteSize : MODE_MAX;
      if (delta > size/2) delta -= size;
      if (delta < -size/2) delta += size;
    }
    if (knobGestures.pressed()) { syncLampKnob(); return changed; }
    // Turning immediately after a click confirms that click without waiting.
    const auto pending = knobGestures.takeClicks();
    applyLampGesture(pending);
    knobActivity = now;
    if (knobMode == KnobMode::Brightness) {
      const int next = constrain(int(Brightness) + int(delta)*5, 1, 255);
      knobDirty |= next != Brightness;
      setLampControl(Mode, next, PowerOn);
    } else if (knobMode == KnobMode::Color) {
      knobColorIndex = (int(knobColorIndex) + delta % knobPaletteSize + knobPaletteSize) % knobPaletteSize;
      const auto* c = knobPalette[knobColorIndex];
      if (delta) { setLampColor(knobEffect,c[0],c[1],c[2]); knobDirty = true; }
    } else {
      const int next = (int(Mode)-1 + delta % MODE_MAX + MODE_MAX) % MODE_MAX + 1;
      setLampControl(next, Brightness, PowerOn);
    }
    syncLampKnob(); changed = true;
  }
  if (knobMode != KnobMode::Effects && !knobGestures.pressed() && !knobGestures.pending() && uint32_t(now-knobActivity) >= 5000) finishLampKnob();
  if (knobMode == KnobMode::Effects && (knobBrightnessPending || knobColorsPending) && uint32_t(now-knobSaveAttempt) >= 5000) savePendingLampKnob();
  return changed;
}
