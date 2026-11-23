#pragma once
#include <stddef.h>
#include <stdint.h>
#include "LampGeometry.h"

// A snapshot of animation inputs, independent of the output brightness/current
// budget. Keep the existing clocks and calibrated geometry at the call site.
namespace LampEffectFrame {
enum class Space : uint8_t { Strip, Motion };
struct Context {
  uint32_t clock;
  uint16_t count, midpoint;
  uint8_t motionPath;

  uint16_t position(uint16_t index, Space space) const {
    if (space == Space::Motion && (!count || count > 1024 || index >= count)) return 0;
    return lampCenteredPosition(index, count,
      space == Space::Motion && motionPath != 1 ? midpoint : 0);
  }
};

// Prepared additive glow operations. Pixel is the existing native RGB type;
// its scaling, rounding and saturating addition remain authoritative. All
// operations retain their original order. Workspace lives on the stack, with
// no per-pixel dispatch, heap allocation or LED-count-sized coordinate cache.
template<class Pixel, size_t Capacity> struct Glows {
  static_assert(Capacity > 0 && Capacity <= 255, "Glow operation count must fit in one byte");
  struct Glow { uint16_t position, width; Pixel color; uint8_t strength; };
  Glow operations[Capacity];
  Pixel background;
  uint8_t size = 0;
  Space space = Space::Strip;

  void add(uint16_t position, uint16_t width, Pixel color, uint8_t strength) {
    // The spatial capacity suite covers every phase and addition-wrap window,
    // including two simultaneous Stars emitters near uint32 clock rollover.
    if (size < Capacity) operations[size++] = {position, width, color, strength};
  }

  void render(const Context& frame, Pixel* pixels) const {
    for (uint16_t index = 0; index < frame.count; ++index) {
      Pixel result = background;
      if (size) {
        const int32_t x = frame.position(index, space);
        for (uint8_t op = 0; op < size; ++op) {
          const auto& glow = operations[op];
          const uint32_t distance = x >= glow.position ? x - glow.position : glow.position - x;
          if (distance >= glow.width) continue;
          Pixel color = glow.color;
          color.nscale8(uint32_t(glow.strength) * (glow.width - distance) / glow.width);
          result += color;
        }
      }
      pixels[index] = result;
    }
  }
};
} // namespace LampEffectFrame
