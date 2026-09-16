#include <Preferences.h>

// Separate, versioned storage preserves the existing Wi-Fi/settings layout.
static LampColor effectColors[LAMP_EFFECT_COUNT];
static bool colorsDirty = false;
static LampEffectOptions effectOptions[LAMP_EFFECT_COUNT];
static bool optionsDirty = false;

LampColor defaultLampColor(uint8_t mode)
{
  if (mode == 3) return {0, 128, 160, 255};
  if (mode == 31) return {1, 190, 215, 255};
  if (mode == 33) return {1, 255, 200, 60};
  return {static_cast<uint8_t>(mode >= LAMP_CUSTOM_SOLID), 255, 60, 110};
}

LampEffectOptions defaultEffectOptions(uint8_t mode) {
  return {50, static_cast<uint8_t>(mode == 31 ? 35 : 100), static_cast<uint8_t>(mode >= 30), 35, 160, 255};
}

void loadLampColors()
{
  for (uint8_t i = 0; i < LAMP_EFFECT_COUNT; ++i) {
    effectColors[i] = defaultLampColor(i + 1);
    effectOptions[i] = defaultEffectOptions(i + 1);
  }
  uint8_t data[1 + LAMP_EFFECT_COUNT * 4] = {};
  Preferences prefs;
  if (!prefs.begin("coollamp", true)) return;
  const size_t length = prefs.getBytesLength("colors");
  const bool valid = (length == 117 || length == sizeof(data)) &&
    prefs.getBytes("colors", data, length) == length && data[0] == 1;
  uint8_t options[1 + LAMP_EFFECT_COUNT * 6] = {};
  if (prefs.getBytesLength("effectOptions") == sizeof(options) &&
      prefs.getBytes("effectOptions", options, sizeof(options)) == sizeof(options) && options[0] == 1) {
    for (uint8_t i = 0; i < LAMP_EFFECT_COUNT; ++i) {
      const auto* p = options + 1 + i * 6;
      if (p[0] >= 1 && p[0] <= 100 && p[1] <= 100 && p[2] <= 1) effectOptions[i] = {p[0],p[1],p[2],p[3],p[4],p[5]};
    }
  }
  prefs.end();
  if (!valid) return;
  const uint8_t count = (length - 1) / 4;
  for (uint8_t i = 0; i < count; ++i) if (data[1 + i * 4] > 1) return;
  for (uint8_t i = 0; i < count; ++i) {
    const uint8_t* c = data + 1 + i * 4;
    effectColors[i] = {c[0], c[1], c[2], c[3]};
  }
  effectColors[LAMP_CUSTOM_SOLID - 1].enabled = 1;
  colorsDirty = count != LAMP_EFFECT_COUNT;
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
  effectOptions[mode - 1] = defaultEffectOptions(mode);
  optionsDirty = true;
  return true;
}

bool saveLampColors()
{
  if (!colorsDirty && !optionsDirty) return true;
  uint8_t data[1 + LAMP_EFFECT_COUNT * 4] = {1};
  for (uint8_t i = 0; i < LAMP_EFFECT_COUNT; ++i) {
    const auto c = effectColors[i];
    data[1 + i * 4] = c.enabled; data[2 + i * 4] = c.r;
    data[3 + i * 4] = c.g; data[4 + i * 4] = c.b;
  }
  Preferences prefs;
  if (!prefs.begin("coollamp", false)) return false;
  const bool saved = !colorsDirty || prefs.putBytes("colors", data, sizeof(data)) == sizeof(data);
  uint8_t options[1 + LAMP_EFFECT_COUNT * 6] = {1};
  for (uint8_t i = 0; i < LAMP_EFFECT_COUNT; ++i) {
    const auto o = effectOptions[i]; uint8_t* p = options + 1 + i * 6;
    p[0]=o.speed;p[1]=o.intensity;p[2]=o.dual;p[3]=o.r;p[4]=o.g;p[5]=o.b;
  }
  const bool savedOptions = !optionsDirty || prefs.putBytes("effectOptions", options, sizeof(options)) == sizeof(options);
  prefs.end();
  if (saved) colorsDirty = false;
  if (savedOptions) optionsDirty = false;
  return saved && savedOptions;
}

LampEffectOptions getLampEffectOptions(uint8_t mode) {
  return mode >= 1 && mode <= LAMP_EFFECT_COUNT ? effectOptions[mode - 1] : defaultEffectOptions(1);
}
bool setLampEffectOptions(uint8_t mode, LampEffectOptions o) {
  if (mode < 1 || mode > LAMP_EFFECT_COUNT || o.speed < 1 || o.speed > 100 || o.intensity > 100 || o.dual > 1) return false;
  const auto old = effectOptions[mode - 1];
  optionsDirty |= old.speed!=o.speed || old.intensity!=o.intensity || old.dual!=o.dual || old.r!=o.r || old.g!=o.g || old.b!=o.b;
  effectOptions[mode - 1] = o; return true;
}
void getLampEffectPacket(uint8_t* out) {
  const auto mode = getLampControlState().mode; const auto o = getLampEffectOptions(mode);
  const uint8_t packet[8]={1,mode,o.speed,o.intensity,o.dual,o.r,o.g,o.b};
  memcpy(out,packet,sizeof(packet));
}
