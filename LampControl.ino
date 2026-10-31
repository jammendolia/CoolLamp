#include "LampControl.h"
#include "LampEffectRegistry.h"
#include "LampStyle.h"

static_assert(LAMP_EFFECT_CAPACITY == MODE_MAX, "Keep the Bluetooth effect bound in sync");
static_assert(LAMP_BASE_EFFECT_COUNT==LampEffects::BaseCount&&LAMP_EFFECT_COUNT==LampEffects::LegacyCount&&LAMP_EFFECT_CAPACITY==LampEffects::Count,"Keep the protocol catalog bounds in sync");

static LampEffects::Availability lampEffectAvailability(bool regional,bool capture){
  return {lampHasMicrophone(),lampSyncFollowing(),regional&&lampEdisonProfileMatches(),uint8_t(regional?lampSyncRole():0),capture&&lampMicrophoneEnabled(),regional&&lampStyleUsesWholeStrip()};
}

// V1 remains a dense slot table. Optional availability metadata fences gaps;
// Other designs retain their original 38/47 slots; Edison stays at 51/52.
uint8_t lampAvailableEffectCount() {
  return LampEffects::catalogCount(lampEffectAvailability(true,false));
}
bool lampEffectAvailable(uint8_t mode){
  if(!LampEffects::find(mode))return false;
  const auto requirement=LampEffects::requirement(mode);
  if(requirement==LampEffects::Requirement::General)return true;
  return LampEffects::available(mode,lampEffectAvailability(LampEffects::needsEdison(mode)||LampEffects::needsSonata(mode),requirement==LampEffects::Requirement::EdisonAudio));
}
uint8_t lampNextAvailableEffect(uint8_t current,int delta){
  const int bound=lampAvailableEffectCount();
  int next=(int(current)-1+delta%bound+bound)%bound+1;
  for(int tries=0;tries<bound;++tries){
    if(lampEffectAvailable(next))return uint8_t(next);
    next=(next-1+(delta<0?-1:1)+bound)%bound+1;
  }
  return current;
}

LampControlState getLampControlState()
{
  return {Mode, Brightness, PowerOn};
}

bool setLampControl(uint32_t mode, uint32_t brightness, bool power)
{
  const bool offCurrent=!power&&mode==Mode&&lampSyncRole()==0;
  if (lampCalibrationActive() || mode<1 || mode>LAMP_EFFECT_CAPACITY || brightness<1 || brightness>255 || (!offCurrent&&!lampEffectAvailable(uint8_t(mode)))) return false;
  const bool wasFollowing = lampSyncFollowing();
  if (wasFollowing) {
    pauseLampSync();
    if (mode > lampAvailableEffectCount()) mode = Mode;
  }
  if (!offCurrent&&!lampEffectAvailable(uint8_t(mode))) return false;
  if (Mode != mode) {
    if(!leaveLampSceneForEffect())return false;
    Mode = mode;
    fill_solid(leds, NUM_LEDS, CRGB::Black);
  }
  // A disconnected follower can rejoin later. Local off must pause it too.
  if (!power && !wasFollowing) pauseLampSync();
  Brightness = brightness;
  PowerOn = power;
  syncLampKnob();
  FastLED.setBrightness(PowerOn ? Brightness : 0);
  noteLampUpdateUse();
  return true;
}
