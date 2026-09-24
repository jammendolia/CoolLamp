void renderAudioEffect(uint8_t mode, uint32_t now) {
  static uint32_t last = 0;
  static uint8_t previousMode = 0, level = 0;
  const auto options = getLampEffectOptions(mode);
  const auto color = getLampColor(mode);
  const auto audio = getLampAudioFeatures();
  if (previousMode != mode || now - last > 250) level = 0;
  const uint32_t elapsed = min(uint32_t(now - last), uint32_t(100));
  level = smoothAudioLevel(level, audio.valid ? audio.level : 0, elapsed, options.speed);
  last = now; previousMode = mode;
  const CRGB primary(color.r, color.g, color.b), secondary(options.r, options.g, options.b);
  const uint16_t left = lampSplitCount(NUM_LEDS, lampMidpoint);
  for (uint16_t i = 0; i < NUM_LEDS; ++i) {
    const uint16_t size = i < left ? left : NUM_LEDS - left;
    // Both strip ends at base, midpoint at top.
    const uint16_t height = i < left ? i : NUM_LEDS - 1 - i;
    const uint8_t position = size > 1 ? uint32_t(height) * 255 / (size - 1) : 0;
    CRGB tint = options.dual ? blend(primary, secondary, position) : primary;
    if (mode == MODE_SOUND_METER) {
      const int coverage = int(level) * size - int(height) * 255;
      tint.nscale8(coverage <= 0 ? 0 : coverage >= 255 ? 255 : uint8_t(coverage));
    } else tint.nscale8(level);
    leds[i] = tint;
  }
}
