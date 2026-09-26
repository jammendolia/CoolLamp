#pragma once
#include <stdint.h>
#include <stddef.h>

// Hardware-independent analysis of signed 24-bit INMP441 samples in 32-bit slots.
struct AudioLevel { uint16_t rms, peak; uint8_t level; bool signal; };
class AudioAnalysis {
  int32_t dc = 0;
  bool initialized = false, gateOpen = false;
  // Q8 input reference. Gain remains the maximum sensitivity; AGC only attenuates.
  uint32_t reference = 0;
  static uint32_t root(uint64_t value) {
    uint64_t bit = uint64_t(1) << 62, result = 0;
    while (bit > value) bit >>= 2;
    while (bit) {
      if (value >= result + bit) { value -= result + bit; result = (result >> 1) + bit; }
      else result >>= 1;
      bit >>= 2;
    }
    return uint32_t(result);
  }
public:
  uint16_t effectiveGainHundredths(uint8_t maximum) const {
    return reference ? uint16_t(2048U*256*100/reference) : uint16_t(maximum)*100;
  }
  // Scale is hundredths: 100 = original response, 200 = twice the contrast.
  static uint8_t scaleLevel(uint8_t level, uint16_t scale) {
    const int32_t mapped = 255 - (255 - int32_t(level)) * scale / 100;
    return mapped <= 0 ? 0 : uint8_t(mapped);
  }
  AudioLevel process(const int32_t* stereo, size_t frames, uint8_t gain, uint16_t gate, uint16_t scale = 100, bool automatic = true) {
    if (!frames) return {};
    uint64_t squares = 0; uint32_t peak = 0;
    int32_t low = 32767, high = -32768;
    for (size_t i = 0; i < frames; ++i) {
      // Discard unused low bits and scale to 16 bits before squaring.
      const int32_t sample = stereo[i * 2] >> 16;
      if (!initialized) { dc = sample * 256; initialized = true; }
      dc += (sample * 256 - dc) / 256;
      const int32_t ac = sample - dc / 256;
      const uint32_t magnitude = ac < 0 ? -ac : ac;
      squares += uint64_t(magnitude) * magnitude;
      if (magnitude > peak) peak = magnitude;
      if (sample < low) low = sample;
      if (sample > high) high = sample;
    }
    const uint32_t rms = root(squares / frames);
    if (rms > uint32_t(gate) + gate / 2) gateOpen = true;
    else if (rms <= gate) gateOpen = false;
    const uint32_t signal = gateOpen ? rms - gate : 0;
    uint32_t scaled = signal * gain * 255 / 2048;
    if (automatic) {
      const uint32_t minimum = 2048U * 256 / (gain ? gain : 1);
      // Target 80% after contrast, leaving room for attacks above the average.
      const uint32_t target = 255 - 51U * 100 / (scale < 100 ? 100 : scale);
      const uint32_t wanted = signal * 255U * 256 / target;
      const uint32_t desired = wanted > minimum ? wanted : minimum;
      if (!reference) reference = desired;
      if (reference < minimum) reference = minimum;
      // Frame-based 80ms attenuation / 5s recovery at 16kHz. Freeze in silence
      // so the gain cannot creep upward while the gate is closed.
      if (signal) {
        const uint32_t duration = desired > reference ? 1280 : 80000;
        const uint32_t stepFrames = frames > duration ? duration : uint32_t(frames);
        const uint32_t distance = desired > reference ? desired-reference : reference-desired;
        const uint32_t step = (uint64_t(distance)*stepFrames + duration-1)/duration;
        reference = desired > reference ? reference+step : reference-step;
      }
      scaled = signal * 255U * 256 / reference;
    }
    return {uint16_t(rms > 65535 ? 65535 : rms), uint16_t(peak > 65535 ? 65535 : peak),
      scaleLevel(uint8_t(scaled > 255 ? 255 : scaled), scale), high - low > 2};
  }
};

// Preserve short transients across render scheduling and the visual attack ramp.
// Capture continues publishing fresh samples during the hold; stale-data protection
// remains the renderer's responsibility. Unsigned elapsed time handles clock wrap.
class AudioPeakHold {
  uint8_t held = 0;
  uint32_t since = 0;
public:
  uint8_t process(uint8_t level, uint32_t now) {
    if (level >= held || uint32_t(now - since) >= 80) {
      held = level; since = now;
    }
    return held;
  }
};

// Time-based smoothing belongs to rendering, never to the effect's virtual clock.
inline uint8_t smoothAudioLevel(uint8_t previous, uint8_t target, uint32_t elapsed, uint8_t speed) {
  const uint32_t duration = target > previous ? 20 : 400 - uint32_t(speed) * 3;
  if (elapsed >= duration) return target;
  const int delta = int(target) - previous;
  if (!delta || !elapsed) return previous;
  const int change = (uint32_t(delta < 0 ? -delta : delta) * elapsed + duration - 1) / duration;
  return uint8_t(int(previous) + (delta < 0 ? -change : change));
}
