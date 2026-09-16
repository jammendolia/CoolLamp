#include <Preferences.h>

// Separate, versioned storage preserves the existing Wi-Fi/settings layout.
static LampColor effectColors[LAMP_EFFECT_COUNT];
static bool colorsDirty = false;

LampColor defaultLampColor(uint8_t mode)
{
  if (mode == 3) return {0, 128, 160, 255};
  return {static_cast<uint8_t>(mode == LAMP_EFFECT_COUNT), 255, 60, 110};
}

void loadLampColors()
{
  for (uint8_t i = 0; i < LAMP_EFFECT_COUNT; ++i) effectColors[i] = defaultLampColor(i + 1);
  uint8_t data[1 + LAMP_EFFECT_COUNT * 4] = {};
  Preferences prefs;
  if (!prefs.begin("coollamp", true)) return;
  const bool valid = prefs.getBytesLength("colors") == sizeof(data) &&
    prefs.getBytes("colors", data, sizeof(data)) == sizeof(data) && data[0] == 1;
  prefs.end();
  if (!valid) return;
  for (uint8_t i = 0; i < LAMP_EFFECT_COUNT; ++i) if (data[1 + i * 4] > 1) return;
  for (uint8_t i = 0; i < LAMP_EFFECT_COUNT; ++i) {
    const uint8_t* c = data + 1 + i * 4;
    effectColors[i] = {c[0], c[1], c[2], c[3]};
  }
  effectColors[LAMP_EFFECT_COUNT - 1].enabled = 1;
}

LampColor getLampColor(uint8_t mode)
{
  return mode >= 1 && mode <= LAMP_EFFECT_COUNT ? effectColors[mode - 1] : LampColor{0, 0, 0, 0};
}

bool setLampColor(uint8_t mode, uint8_t r, uint8_t g, uint8_t b)
{
  if (mode < 1 || mode > LAMP_EFFECT_COUNT) return false;
  const LampColor next{1, r, g, b};
  const auto old = effectColors[mode - 1];
  colorsDirty |= old.enabled != 1 || old.r != r || old.g != g || old.b != b;
  effectColors[mode - 1] = next;
  return true;
}

bool resetLampColor(uint8_t mode)
{
  if (mode < 1 || mode > LAMP_EFFECT_COUNT) return false;
  const auto next = defaultLampColor(mode);
  const auto old = effectColors[mode - 1];
  colorsDirty |= old.enabled != next.enabled || old.r != next.r || old.g != next.g || old.b != next.b;
  effectColors[mode - 1] = next;
  return true;
}

bool saveLampColors()
{
  if (!colorsDirty) return true;
  uint8_t data[1 + LAMP_EFFECT_COUNT * 4] = {1};
  for (uint8_t i = 0; i < LAMP_EFFECT_COUNT; ++i) {
    const auto c = effectColors[i];
    data[1 + i * 4] = c.enabled; data[2 + i * 4] = c.r;
    data[3 + i * 4] = c.g; data[4 + i * 4] = c.b;
  }
  Preferences prefs;
  if (!prefs.begin("coollamp", false)) return false;
  const bool saved = prefs.putBytes("colors", data, sizeof(data)) == sizeof(data);
  prefs.end();
  if (saved) colorsDirty = false;
  return saved;
}
