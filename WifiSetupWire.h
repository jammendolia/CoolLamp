#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace WifiSetupWire {
constexpr uint8_t CONTROL = 14, NETWORK = 15, BEGIN = 16, CHUNK = 17, COMMIT = 18;
constexpr size_t MAX_FRAME = 20, MAX_CREDENTIALS = 95;
inline bool validFrame(const uint8_t* bytes, size_t size) {
  if (!bytes || size < 4 || size > MAX_FRAME) return false;
  switch (bytes[2]) {
    case CONTROL: return size == 4 && bytes[3] <= 2;
    case NETWORK: return size == 4 && bytes[3] < 16;
    case BEGIN: return size == 6 && bytes[3] >= 1 && bytes[3] <= 32 &&
      bytes[5] <= 1 && (bytes[5] ? bytes[4] == 0 : bytes[4] >= 8 && bytes[4] <= 63);
    case CHUNK: return size >= 5 && bytes[3] < MAX_CREDENTIALS;
    case COMMIT: return size == 4 && bytes[3] == 0;
    default: return false;
  }
}
struct Credentials {
  uint8_t bytes[MAX_CREDENTIALS]{};
  uint8_t ssidSize = 0, passwordSize = 0, received = 0;
  uint32_t owner = 0, touched = 0;
  void clear() {
    volatile uint8_t* p = bytes;
    for (size_t i = 0; i < sizeof(bytes); ++i) p[i] = 0;
    ssidSize = passwordSize = received = 0; owner = touched = 0;
  }
  bool begin(const uint8_t* frame, size_t size, uint32_t generation, uint32_t now) {
    clear();
    if (!validFrame(frame, size) || frame[2] != BEGIN) return false;
    ssidSize = frame[3]; passwordSize = frame[4]; owner = generation; touched = now;
    return true;
  }
  bool append(const uint8_t* frame, size_t size, uint32_t generation, uint32_t now) {
    if (!validFrame(frame, size) || frame[2] != CHUNK || !ssidSize || generation != owner ||
        uint32_t(now - touched) >= 20000 || frame[3] != received ||
        received + size - 4 > size_t(ssidSize + passwordSize) || memchr(frame + 4, 0, size - 4)) {
      clear(); return false;
    }
    memcpy(bytes + received, frame + 4, size - 4);
    received += size - 4; touched = now; return true;
  }
  bool complete(uint32_t generation, uint32_t now) const {
    return ssidSize && owner == generation && uint32_t(now - touched) < 20000 &&
      received == ssidSize + passwordSize;
  }
};
}
