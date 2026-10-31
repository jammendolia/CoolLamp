void Confetti()
{
  renderLegacyDots(16);
}

// Native fading-dot renderer. Preserve each effect's random draw order,
// HSV rounding and additive (Confetti/Sinelon) versus maximum (Juggle) blend.
void renderLegacyDots(uint8_t mode)
{
  struct Recipe { uint8_t fade, count, beat, saturation, value, hueStep; };
  static const Recipe recipes[] = {
    {10, 1, 0, 200, 255, 0},
    {20, 1, 13, 255, 192, 0},
    {20, 8, 7, 200, 255, 32},
  };
  const auto& recipe = recipes[(mode - 16) / 2];
  fadeToBlackBy(leds, NUM_LEDS, recipe.fade);
  for (uint8_t dot = 0; dot < recipe.count; ++dot) {
    uint16_t position;
    uint8_t hue = recipe.hueStep ? dot * recipe.hueStep : gHue;
    if (!recipe.beat) {
      position = random16(NUM_LEDS);
      hue += random8(64);
    } else {
      position = lampBeatSin16(recipe.beat + dot, 0, NUM_LEDS - 1);
    }
    const CRGB color = CHSV(hue, recipe.saturation, recipe.value);
    if (recipe.hueStep) leds[position] |= color;
    else leds[position] += color;
  }
}
