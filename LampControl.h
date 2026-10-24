#pragma once
#include <stdint.h>

constexpr uint8_t LAMP_PROTOCOL_VERSION = 1;
constexpr uint8_t LAMP_BASE_EFFECT_COUNT = 38;
constexpr uint8_t LAMP_EFFECT_COUNT = 47;
// Legacy slots 1..47 and their NVS records never move. Extensions append IDs.
constexpr uint8_t LAMP_EFFECT_CAPACITY = 52;
uint8_t lampAvailableEffectCount();
bool lampEdisonProfileMatches();
bool lampEffectAvailable(uint8_t mode);
inline bool lampEffectNeedsAudio(uint8_t mode){return (mode>=39&&mode<=47)||mode==52;}
uint8_t lampNextAvailableEffect(uint8_t current,int delta);
constexpr uint8_t LAMP_CUSTOM_SOLID = 29;
struct LampEffectOptions { uint8_t speed, intensity, dual, r, g, b; };
LampEffectOptions getLampEffectOptions(uint8_t mode);
bool setLampEffectOptions(uint8_t mode, LampEffectOptions options);
void getLampEffectPacket(uint8_t* packet);

struct LampColor { uint8_t enabled, r, g, b; };
LampColor getLampColor(uint8_t mode);
bool setLampColor(uint8_t mode, uint8_t r, uint8_t g, uint8_t b);
bool resetLampColor(uint8_t mode);
void loadLampColors();
bool saveLampColors();
void loadLampAppearanceV2();
bool saveLampAppearanceV2(uint8_t mode,uint32_t now);
enum class LampAppearanceResult:uint8_t {Persisted,Failed,Uncertain,Busy};
LampAppearanceResult saveLampAppearanceAccepted(uint8_t mode,uint32_t now);
bool lampAppearanceMigrationPending();

struct LampControlState {
  uint8_t mode;
  uint8_t brightness;
  bool power;
};

// Called only on the Arduino loop task, including commands queued by BLE.
LampControlState getLampControlState();
bool setLampControl(uint32_t mode, uint32_t brightness, bool power);
bool saveLampDefaults();
bool saveLampKnobBrightness();
void syncLampKnob();
