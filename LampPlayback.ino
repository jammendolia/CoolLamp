#include <Preferences.h>
#include "LampPlayback.h"
LampRotation lampRotation;
static uint32_t rotationAt=0;
static uint8_t rotationMode=0;
static CRGB* calibrationLeds=nullptr;
static uint16_t calibrationPosition=1;
static uint32_t calibrationTouched=0, calibrationFrame=0;
static bool calibrationFailed=false;
bool lampCalibrationActive(){return calibrationLeds!=nullptr;}
uint16_t lampCalibrationPosition(){return calibrationPosition;}
void loadLampRotation(){
  Preferences prefs; LampRotation saved;
  if(!prefs.begin("coollamp",true))return;
  const bool ok=prefs.getBytesLength("rotationV1")==sizeof(saved) && prefs.getBytes("rotationV1",&saved,sizeof(saved))==sizeof(saved);
  prefs.end(); if(ok && validLampRotation(saved))lampRotation=saved;
}
bool saveLampRotation(const LampRotation& next){
  if(!validLampRotation(next) || (next.enabled && (lampSyncRole()==2 || lampGroupScene() || (next.category==2 && !lampHasMicrophone()))))return false;
  Preferences prefs;if(!prefs.begin("coollamp",false))return false;
  const bool ok=prefs.putBytes("rotationV1",&next,sizeof(next))==sizeof(next);prefs.end();
  if(ok){lampRotation=next;rotationAt=millis();rotationMode=Mode;}return ok;
}
void serviceLampRotation(){
  const uint32_t now=millis();
  if(!lampRotation.enabled || !PowerOn || lampCalibrationActive() || lampSyncRole()==2 || lampGroupScene() || lampUpdateOwnsResources() || lampPairingOpen() || lampSetupPulse() || lampIdentifyActive()){
    rotationAt=now;rotationMode=Mode;return;
  }
  if(Mode!=rotationMode){rotationAt=now;rotationMode=Mode;return;}
  if(uint32_t(now-rotationAt)<lampRotation.seconds*1000U)return;
  rotationAt=now;
  const uint8_t next=nextRotationEffect(Mode,lampAvailableEffectCount(),lampRotation,esp_random());
  if(next && setLampControl(next,Brightness,PowerOn))rotationMode=Mode;
}
bool beginLampCalibration(){
  if(lampCalibrationActive())return true;
  if(lampUpdateOwnsResources() || lampSyncRole()!=0)return false;
  auto* buffer=new(std::nothrow) CRGB[MAX_LED_COUNT]{};if(!buffer)return false;
  finishLampKnob();
  calibrationLeds=buffer;calibrationPosition=NUM_LEDS;calibrationTouched=millis();calibrationFailed=false;
  FastLED[0].setLeds(calibrationLeds,MAX_LED_COUNT);
  resetLampCalibrationKnob();return true;
}
void moveLampCalibration(uint16_t position){
  if(!lampCalibrationActive() || !position || position>MAX_LED_COUNT)return;
  calibrationPosition=position;calibrationTouched=millis();calibrationFailed=false;syncLampKnob();
}
bool finishLampCalibration(bool save){
  if(!lampCalibrationActive())return false;
  if(save && !saveLampLedCount(calibrationPosition)){calibrationFailed=true;calibrationTouched=millis();return false;}
  // Clear the entire probe range, including pixels beyond the former length.
  fill_solid(calibrationLeds,MAX_LED_COUNT,CRGB::Black);FastLED.show();
  FastLED[0].setLeds(leds,NUM_LEDS);delete[] calibrationLeds;calibrationLeds=nullptr;
  FastLED.setBrightness(PowerOn?Brightness:0);resetLampCalibrationKnob();return true;
}
bool renderLampCalibration(){
  if(!lampCalibrationActive())return false;
  const uint32_t now=millis();
  if(lampUpdateOwnsResources() || lampSyncRole()!=0 || uint32_t(now-calibrationTouched)>=300000){finishLampCalibration(false);return false;}
  if(uint32_t(now-calibrationFrame)>=50){
    calibrationFrame=now;fill_solid(calibrationLeds,MAX_LED_COUNT,CRGB::Black);
    calibrationLeds[calibrationPosition-1]=calibrationFailed?CRGB::Red:CRGB(0,220,180);
    FastLED.setBrightness(80);FastLED.show();
  }
  delay(1);return true;
}
