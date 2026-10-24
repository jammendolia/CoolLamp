#include "LampControl.h"

static_assert(LAMP_EFFECT_CAPACITY == MODE_MAX, "Keep the Bluetooth effect bound in sync");

// V1 remains a dense slot table. Optional availability metadata fences gaps;
// all non-Edison lamps retain their original 38/47-slot catalogs.
uint8_t lampAvailableEffectCount() {
  if(lampEdisonProfileMatches()&&lampSyncRole()==0)return lampHasMicrophone()?52:51;
  return (lampHasMicrophone() || lampSyncFollowing()) ? LAMP_EFFECT_COUNT : LAMP_BASE_EFFECT_COUNT;
}
bool lampEffectAvailable(uint8_t mode){
  if(mode<1)return false;
  if(mode<=LAMP_BASE_EFFECT_COUNT)return true;
  if(mode<=LAMP_EFFECT_COUNT)return lampHasMicrophone()||lampSyncFollowing();
  // Region effects are standalone. Legacy Mirror packets cannot negotiate them.
  return mode<=lampAvailableEffectCount()&&(mode!=52||lampMicrophoneEnabled());
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
