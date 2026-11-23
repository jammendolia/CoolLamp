// Normalize by strip length so the same scene fits short and long lamps.
uint16_t effectPosition(int index, int count)
{
  return count > 1 ? static_cast<uint32_t>(index) * 65535UL / (count - 1) : 32768;
}

uint32_t atmosphereHSV(uint8_t hue, uint8_t saturation, uint8_t value) {
  return uint32_t(hue) | (uint32_t(saturation) << 8) | (uint32_t(value) << 16);
}

uint32_t atmosphereAuroraPixel(uint16_t x, const uint16_t* clock) {
  const uint8_t ribbon = inoise8(x / 24, clock[0]);
  const uint8_t fold = sin8(static_cast<uint8_t>(x / 240 + clock[1]));
  const uint8_t hue = 95 + scale8(inoise8(x / 40, clock[2]), 105);
  return atmosphereHSV(hue, 220, scale8(ribbon, fold));
}

uint32_t atmosphereEmbersPixel(uint16_t x, const uint16_t* clock) {
  const uint8_t glow = inoise8(x / 10, clock[0]);
  const uint8_t hot = qsub8(glow, 125);
  return atmosphereHSV(5 + scale8(hot, 25), 245, qadd8(12, scale8(hot, 180)));
}

uint32_t atmosphereLavaPixel(uint16_t x, const uint16_t* clock) {
  const uint8_t blob = inoise8(static_cast<uint16_t>(x / 40 - clock[0]), clock[1]);
  const uint8_t intensity = qadd8(qsub8(blob, 95), qsub8(blob, 95));
  return atmosphereHSV(2 + scale8(intensity, 28), 250, intensity);
}

uint32_t atmospherePlasmaPixel(uint16_t x, const uint16_t* clock) {
  const uint8_t a = sin8(static_cast<uint8_t>(x / 140 + clock[0]));
  const uint8_t b = sin8(static_cast<uint8_t>(x / 230 - clock[1]));
  const uint8_t mix = (static_cast<uint16_t>(a) + b) / 2;
  return atmosphereHSV(145 + scale8(mix, 85), 230, 60 + scale8(mix, 195));
}

void renderAtmosphereHSV(uint8_t mode) {
  if (mode != 2 && (mode < 11 || mode > 13)) return;
  using Pixel = uint32_t (*)(uint16_t, const uint16_t*);
  struct Recipe { Pixel pixel; uint8_t timeDivisors[3]; };
  static constexpr Recipe recipes[] = {
    {atmosphereAuroraPixel, {70,95,110}},
    {atmosphereEmbersPixel, {30,0,0}},
    {atmosphereLavaPixel, {32,100,0}},
    {atmospherePlasmaPixel, {24,33,0}}
  };
  const auto& recipe = recipes[mode == 2 ? 0 : mode - 10];
  const uint32_t t = lampEffectMillis();
  uint16_t clock[3];
  // Divide the full animation clock before narrowing. Each original formula
  // ultimately consumes only its low 16 (noise) or low 8 (sine) bits.
  for (unsigned i = 0; i < 3; ++i) {
    const uint8_t divisor = recipe.timeDivisors[i];
    clock[i] = divisor ? uint16_t(t / divisor) : 0;
  }
  const uint16_t count = NUM_LEDS;
  for (uint16_t i = 0; i < count; ++i) {
    const uint32_t hsv = recipe.pixel(effectPosition(i, count), clock);
    const CRGB color = CHSV(uint8_t(hsv), uint8_t(hsv >> 8), uint8_t(hsv >> 16));
    leds[i].r = color.r; leds[i].g = color.g; leds[i].b = color.b;
  }
}

void CometCollision()
{
  // A full approach/retreat cycle takes six seconds.
  const uint16_t travel = lampBeatSin16(10, 0, 32767);
  const uint16_t other = 65535 - travel;
  const uint8_t flash = travel > 30500 ? (travel - 30500) * 255UL / 2267 : 0;
  for (int i = 0; i < NUM_LEDS; i++) {
    const uint16_t x = lampMotionPosition(i, NUM_LEDS, lampMidpoint);
    const uint32_t d1 = x > travel ? x - travel : travel - x;
    const uint32_t d2 = x > other ? x - other : other - x;
    const uint8_t head1 = d1 < 9000 ? 255 - d1 * 255 / 9000 : 0;
    const uint8_t head2 = d2 < 9000 ? 255 - d2 * 255 / 9000 : 0;
    leds[i] = CHSV(145, 220, scale8(head1, head1));
    leds[i] += CHSV(25, 220, scale8(head2, head2));
    const uint32_t centerDistance = x > 32768 ? x - 32768 : 32768 - x;
    if (centerDistance < 10000) {
      const uint8_t white = scale8(flash, 255 - centerDistance * 255 / 10000);
      leds[i] += CRGB(white, white, white);
    }
  }
}

void Rain()
{
  const int leftCount = lampMotionSplitCount(NUM_LEDS, lampMidpoint);
  const int rightCount = NUM_LEDS - leftCount;
  const uint32_t t = lampEffectMillis();
  for (int i = 0; i < NUM_LEDS; i++) {
    const bool left = i < leftCount;
    const int localIndex = left ? leftCount - 1 - i : i - leftCount;
    const int count = left ? leftCount : rightCount;
    const uint16_t x = effectPosition(localIndex, count);
    uint8_t glow = 0;
    for (int drop = 0; drop < 3; drop++) {
      const uint16_t head = t * (left ? 27UL : 31UL) + drop * 21845UL;
      // Fade behind each falling drop; the gap before wrap is intentional.
      if (head >= x && head - x < 6500) {
        glow = qadd8(glow, 255 - (head - x) * 255UL / 6500);
      }
    }
    leds[i] = CHSV(150, 100, glow);
  }
}

void renderAtmosphereEffect(uint8_t mode) {
  if (mode == 3) { Rain(); return; }
  if (mode == 17) { CometCollision(); return; }
  renderAtmosphereHSV(mode);
}
