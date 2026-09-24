#include "LampGeometry.h"
#include <Preferences.h>
uint16_t lampMidpoint = 0;
void loadLampGeometry() {
  lampMidpoint = 0;
  Preferences prefs;
  if (!prefs.begin("coollamp", true)) return;
  uint8_t data[3]{};
  const bool ok = prefs.getBytesLength("geometryV1") == sizeof(data) &&
    prefs.getBytes("geometryV1", data, sizeof(data)) == sizeof(data);
  prefs.end();
  const uint16_t saved = uint16_t(data[1]) | uint16_t(data[2]) << 8;
  if (ok && data[0] == 1 && saved < 1024) lampMidpoint = saved;
}
bool saveLampGeometry(uint16_t midpoint, uint16_t count) {
  if (!count || count > 1024 || midpoint >= count) return false;
  const uint8_t data[3] = {1, uint8_t(midpoint), uint8_t(midpoint >> 8)};
  Preferences prefs;
  if (!prefs.begin("coollamp", false)) return false;
  const bool ok = prefs.putBytes("geometryV1", data, sizeof(data)) == sizeof(data);
  prefs.end();
  if (ok) lampMidpoint = midpoint;
  return ok;
}
