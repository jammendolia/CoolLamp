#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

struct FirmwareManifest {
  uint16_t version[3];
  uint32_t size;
  uint8_t sha256[32];
};

inline bool sameFirmwareManifest(const FirmwareManifest& a, const FirmwareManifest& b) {
  return !memcmp(a.version, b.version, sizeof(a.version)) && a.size == b.size &&
         !memcmp(a.sha256, b.sha256, sizeof(a.sha256));
}

inline bool parseFirmwareVersion(const char* text, uint16_t out[3]) {
  const char* p = text;
  for (unsigned i = 0; i < 3; ++i) {
    if (*p < '0' || *p > '9') return false;
    if (*p == '0' && p[1] >= '0' && p[1] <= '9') return false;
    uint32_t value = 0;
    do { value = value * 10 + (*p++ - '0'); if (value > 65535) return false; } while (*p >= '0' && *p <= '9');
    out[i] = value;
    if (i < 2) { if (*p++ != '.') return false; } else if (*p) return false;
  }
  return true;
}
inline bool firmwareIsNewer(const uint16_t next[3], const uint16_t current[3]) {
  for (unsigned i = 0; i < 3; ++i) if (next[i] != current[i]) return next[i] > current[i];
  return false;
}
inline bool parseFirmwareManifest(char* text, FirmwareManifest& out) {
  // Six LF-terminated lines, no optional or unbounded fields.
  char* lines[6]; char* p = text;
  for (unsigned i = 0; i < 6; ++i) {
    lines[i] = p; char* end = strchr(p, '\n'); if (!end) return false;
    *end = 0; p = end + 1;
  }
  if (*p || strcmp(lines[0], "COOLLAMP-OTA-1") || strcmp(lines[2], "esp32c3") ||
      strcmp(lines[3], "dual-ota-2031616") || !parseFirmwareVersion(lines[1], out.version)) return false;
  if (!*lines[4] || strlen(lines[4]) > 7) return false;
  out.size = 0;
  for (p = lines[4]; *p; ++p) { if (*p < '0' || *p > '9') return false; out.size = out.size * 10 + *p - '0'; }
  if (out.size < 288 || out.size > 2031616 || strlen(lines[5]) != 64) return false;
  for (unsigned i = 0; i < 32; ++i) {
    unsigned value = 0;
    for (unsigned j = 0; j < 2; ++j) {
      const char c = lines[5][i * 2 + j];
      if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
      value = value * 16 + (c <= '9' ? c - '0' : c - 'a' + 10);
    }
    out.sha256[i] = value;
  }
  return true;
}
