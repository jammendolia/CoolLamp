#pragma once
#include <stdint.h>

// A split is a boundary after a one-based LED number, not an array index.
// Zero selects the historical midpoint. Keep both sides nonempty when possible.
inline uint16_t lampSplitCount(uint16_t count, uint16_t midpoint) {
  if (count <= 1) return count;
  if (!midpoint) return (count + 1) / 2;
  return midpoint < count ? midpoint : count - 1;
}
inline uint16_t lampCenteredPosition(uint16_t index, uint16_t count, uint16_t midpoint) {
  if (count <= 1) return 32768;
  if (!midpoint) return uint32_t(index) * 65535 / (count - 1);
  const uint32_t center = 2 * lampSplitCount(count, midpoint) - 1;
  const uint32_t x = 2 * index, end = 2 * (count - 1);
  return x <= center ? x * 32768 / center : 32768 + (x - center) * 32767 / (end - center);
}
extern uint16_t lampMidpoint;
void loadLampGeometry();
bool saveLampGeometry(uint16_t midpoint, uint16_t count);
