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
__attribute__((noinline)) inline bool parseFirmwareSha256(const char* text, uint8_t out[32]) {
  if (!text) return false;
  for (unsigned i = 0; i < 64; ++i) {
    const char c=text[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;
    const uint8_t nibble=c<='9'?c-'0':c-'a'+10;
    if(i&1)out[i/2]|=nibble;else out[i/2]=nibble<<4;
  }
  return !text[64];
}
__attribute__((noinline)) inline void formatFirmwareHex(const uint8_t* bytes,size_t size,char* out) {
  static constexpr char digits[]="0123456789abcdef";
  for(size_t i=0;i<size;++i){out[i*2]=digits[bytes[i]>>4];out[i*2+1]=digits[bytes[i]&15];}out[size*2]=0;
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
  return out.size >= 288 && out.size <= 2031616 && parseFirmwareSha256(lines[5], out.sha256);
}
