#pragma once
#include <stdint.h>

// Native fire primitives share code, not simulation history. Counts and pixel
// indices use the existing calibrated layout; empty lanes consume no entropy.
void updateFireHeat(uint8_t* heat, int count, int cooling, int sparking);
void drawFireLane(const uint8_t* heat, int count, int firstPixel, int step,
                  bool reverseColors, uint8_t palette);
void FireSplit(bool reverse, bool reverseColors, uint8_t palette);
void renderFireEffect(uint8_t mode);
