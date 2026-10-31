// Two independent Fire2012 simulations, with their bases at opposite strip ends.
// Heat travels inward: 0 -> 66 and 133 -> 67 for the 134-LED lamp.
// Reverse mode maps both bases to the center and sends heat toward the ends.
// Whole-strip layout uses one complete lane; reverse runs from last LED to zero.
// Original split-fire adaptation by J Ammendolia.
// Based on Fire2012 by Mark Kriegsman, July 2012.
#include "LampFireEffects.h"

void updateFireHeat(uint8_t* heat, int count, int cooling, int sparking)
{
  if (count == 0) return; // A one-LED strip has only a left half.
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

void updateSplitHeat(uint8_t* heat, int count) {
  updateFireHeat(heat, count, 55, 120);
}

// Reversed colors keep the low-heat center white and the hot bases red/orange.
// Restrict the reversed heat palette to red through white, excluding black.
#if defined(__GNUC__) || defined(__clang__)
__attribute__((always_inline))
#endif
inline CRGB splitFireColor(uint8_t heat, bool reverseColors, uint8_t palette)
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

void drawFireLane(const uint8_t* heat, int count, int firstPixel, int step,
                  bool reverseColors, uint8_t palette) {
  for (int i = 0, pixel = firstPixel; i < count; ++i, pixel += step) {
    const auto color = splitFireColor(heat[i], reverseColors, palette);
    // Direct native channel stores avoid the library's three-byte memcpy.
    auto& output = leds[pixel];
    output.r = color.r; output.g = color.g; output.b = color.b;
  }
}

void FireSplit(bool reverse, bool reverseColors, uint8_t palette)
{
  const int leftCount = lampMotionSplitCount(NUM_LEDS, lampMidpoint);
  const int rightCount = NUM_LEDS - leftCount;
  // Evolve the configured lanes independently; a whole-strip lane has no right side.
  uint8_t* leftHeat = splitHeat;
  uint8_t* rightHeat = splitHeat + leftCount;
  updateSplitHeat(leftHeat, leftCount);
  updateSplitHeat(rightHeat, rightCount);

  drawFireLane(leftHeat, leftCount, reverse ? leftCount - 1 : 0,
               reverse ? -1 : 1, reverseColors, palette);
  drawFireLane(rightHeat, rightCount, reverse ? leftCount : NUM_LEDS - 1,
               reverse ? 1 : -1, reverseColors, palette);
}
