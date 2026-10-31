// Solid recipes retain the original raw RGB values. Custom starts from white;
// the common appearance stage still applies its saved tint/gradient/intensity.
void renderSolidEffect(uint8_t mode) {
  struct Recipe { uint8_t r, g, b; };
  static constexpr Recipe recipes[] = {
    {255,255,255}, {255,0,0}, {0,255,0}, {0,0,255},
    {144,0,255}, {255,35,85}, {255,255,0}, {0,255,255},
    {255,255,255}
  };
  static_assert(MODE_WHITE == 21 && MODE_CUSTOM == 29 &&
    sizeof(recipes) == 3 * (MODE_CUSTOM - MODE_WHITE + 1),
    "Keep solid recipes aligned with the unchanged effect IDs");
  if (mode < MODE_WHITE || mode > MODE_CUSTOM) return;
  const auto& recipe = recipes[mode - MODE_WHITE];
  const uint8_t r = recipe.r, g = recipe.g, b = recipe.b;
  CRGB* pixel = leds;
  const CRGB* end = pixel + NUM_LEDS;
  for (; pixel != end; ++pixel) {
    pixel->r = r; pixel->g = g; pixel->b = b;
  }
}
