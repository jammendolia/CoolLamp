#pragma once
#include <stdint.h>

// A measured construction, not a geometry inferred from artwork or a name.
// Public positions are one-based inclusive; pixel() takes a zero-based index.
namespace LampEdison {
constexpr uint16_t LedCount=222, Midpoint=81;
constexpr uint8_t FirstEffect=48, LastEffect=52;
constexpr bool matchingGeometry(uint16_t count,uint16_t midpoint){return count==LedCount&&midpoint==Midpoint;}
struct RGB {uint8_t r,g,b;};
// Normalize the existing audio snapshot to 0..255 before preparing the frame.
struct Audio {uint8_t bass=0,mid=0,treble=0,level=0;bool valid=false;};
struct Frame {
  uint16_t phase=0;
  uint8_t effect=0,breath=0,head=0,envelope=0;
  RGB primary{255,150,35},secondary{255,65,8};
  Audio audio{};
};
// Pure deterministic functions: no allocation, hardware, persistence or timers.
// Binary periods divide 2^32, so uint32 clock rollover has no phase discontinuity.
Frame prepare(uint8_t effect,uint32_t clock,const Audio& audio=Audio{},
              RGB primary=RGB{255,150,35},RGB secondary=RGB{255,65,8});
RGB pixel(const Frame& frame,uint16_t index,uint16_t count);
}
