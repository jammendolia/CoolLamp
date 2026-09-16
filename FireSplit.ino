// Two independent Fire2012 simulations, with their bases at opposite strip ends.
// Heat travels inward: 0 -> 66 and 133 -> 67 for the 134-LED lamp.
// Reverse mode maps both bases to the center and sends heat toward the ends.
// Original split-fire adaptation by J Ammendolia.
// Based on Fire2012 by Mark Kriegsman, July 2012.

void updateSplitHeat(uint8_t* heat, int count)
{
  if (count == 0) return; // A one-LED strip has only a left half.
  const uint8_t cooling = 55;
  const uint8_t sparking = 120;
  const int coolingRange = (cooling * 10) / count + 2;
  for (int i = 0; i < count; i++) {
    heat[i] = qsub8(heat[i], random8(0, coolingRange > 255 ? 255 : coolingRange));
  }

  for (int i = count - 1; i >= 2; i--) {
    heat[i] = (heat[i - 1] + heat[i - 2] + heat[i - 2]) / 3;
  }

  if (random8() < sparking) {
    const int spark = random8(count < 7 ? count : 7);
    heat[spark] = qadd8(heat[spark], random8(160, 255));
  }
}

// Reversed colors keep the low-heat center white and the hot bases red/orange.
// Restrict the reversed heat palette to red through white, excluding black.
CRGB splitFireColor(uint8_t heat, bool reverseColors, uint8_t palette)
{
  if (palette != 0) {
    const uint8_t hue = palette == 1 ? 160 : (palette == 2 ? 96 : 192);
    const uint8_t saturation = heat > 170 ? 255 - (heat - 170) * 3 : 255;
    return CHSV(hue, saturation, qadd8(heat, heat));
  }
  if (!reverseColors) return HeatColor(heat);
  const uint8_t paletteHeat = 255 - (static_cast<uint16_t>(heat) * 170 / 255);
  return HeatColor(paletteHeat);
}

void FireSplit(bool reverse, bool reverseColors, uint8_t palette)
{
  const int leftCount = (NUM_LEDS + 1) / 2;
  const int rightCount = NUM_LEDS / 2;
  // Give both bases some heat on first entry, then evolve independently.
  uint8_t* leftHeat = splitHeat;
  uint8_t* rightHeat = splitHeat + leftCount;
  updateSplitHeat(leftHeat, leftCount);
  updateSplitHeat(rightHeat, rightCount);

  for (int i = 0; i < leftCount; i++) {
    const int pixel = reverse ? leftCount - 1 - i : i;
    leds[pixel] = splitFireColor(leftHeat[i], reverseColors, palette);
  }
  for (int i = 0; i < rightCount; i++) {
    const int pixel = reverse ? leftCount + i : NUM_LEDS - 1 - i;
    leds[pixel] = splitFireColor(rightHeat[i], reverseColors, palette);
  }
}
