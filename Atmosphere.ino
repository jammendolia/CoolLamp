// Normalize by strip length so the same scene fits short and long lamps.
uint16_t effectPosition(int index, int count)
{
  return count > 1 ? static_cast<uint32_t>(index) * 65535UL / (count - 1) : 32768;
}

void Aurora()
{
  const uint32_t t = millis();
  for (int i = 0; i < NUM_LEDS; i++) {
    const uint16_t x = effectPosition(i, NUM_LEDS);
    const uint8_t ribbon = inoise8(x / 24, t / 70);
    const uint8_t fold = sin8(static_cast<uint8_t>(x / 240 + t / 95));
    const uint8_t hue = 95 + scale8(inoise8(x / 40, t / 110), 105);
    leds[i] = CHSV(hue, 220, scale8(ribbon, fold));
  }
}

void Embers()
{
  const uint32_t t = millis();
  for (int i = 0; i < NUM_LEDS; i++) {
    const uint16_t x = effectPosition(i, NUM_LEDS);
    const uint8_t glow = inoise8(x / 10, t / 30);
    const uint8_t hot = qsub8(glow, 125);
    leds[i] = CHSV(5 + scale8(hot, 25), 245, qadd8(12, scale8(hot, 180)));
  }
}

void Lava()
{
  const uint32_t t = millis();
  for (int i = 0; i < NUM_LEDS; i++) {
    const uint16_t x = effectPosition(i, NUM_LEDS);
    const uint8_t blob = inoise8(static_cast<uint16_t>(x / 40 - t / 32), t / 100);
    const uint8_t intensity = qadd8(qsub8(blob, 95), qsub8(blob, 95));
    leds[i] = CHSV(2 + scale8(intensity, 28), 250, intensity);
  }
}

void Plasma()
{
  const uint32_t t = millis();
  for (int i = 0; i < NUM_LEDS; i++) {
    const uint16_t x = effectPosition(i, NUM_LEDS);
    const uint8_t a = sin8(static_cast<uint8_t>(x / 140 + t / 24));
    const uint8_t b = sin8(static_cast<uint8_t>(x / 230 - t / 33));
    const uint8_t mix = (static_cast<uint16_t>(a) + b) / 2;
    leds[i] = CHSV(145 + scale8(mix, 85), 230, 60 + scale8(mix, 195));
  }
}

void CometCollision()
{
  // A full approach/retreat cycle takes six seconds.
  const uint16_t travel = beatsin16(10, 0, 32767);
  const uint16_t other = 65535 - travel;
  const uint8_t flash = travel > 30500 ? (travel - 30500) * 255UL / 2267 : 0;
  for (int i = 0; i < NUM_LEDS; i++) {
    const uint16_t x = effectPosition(i, NUM_LEDS);
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
  const int leftCount = (NUM_LEDS + 1) / 2;
  const int rightCount = NUM_LEDS / 2;
  const uint32_t t = millis();
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
