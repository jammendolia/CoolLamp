bool lampCalibrationActive(){return false;}
unsigned short lampCalibrationPosition(){return 1;}
void moveLampCalibration(unsigned short){}
bool finishLampCalibration(bool){return true;}
#include <cassert>
#include <cstdint>
#include <iostream>
#include "../LampControl.h"
bool installed=false;
bool lampHasMicrophone(){return installed;}
bool following=false;
uint8_t syncRole=0;
bool syncPaused=false;
bool lampSyncFollowing(){return following;}
bool leaveLampSceneForEffect(){return true;}
void pauseLampSync(){if(syncRole==2){following=false;syncPaused=true;}}
constexpr uint8_t MODE_MAX=47;
uint8_t Mode=4,Brightness=100;
bool PowerOn=true;
struct CRGB { static constexpr int Black=0; };
int leds[1];constexpr int NUM_LEDS=1;
void fill_solid(int*,int,int){}
void syncLampKnob(){}
struct { void setBrightness(int){} } FastLED;
#include "../LampControl.ino"
int main(){
  assert(lampAvailableEffectCount()==38);
  assert(setLampControl(38,100,true));
  assert(!setLampControl(39,100,true) && Mode==38);
  installed=true;
  assert(lampAvailableEffectCount()==47);
  assert(setLampControl(39,100,true) && setLampControl(47,100,true));
  assert(!setLampControl(48,100,true) && !setLampControl(40,0,true));
  installed=false;
  assert(!setLampControl(47,100,true));
  assert(setLampControl(4,100,true));
  syncRole=2;following=true;
  assert(lampAvailableEffectCount()==47);
  assert(setLampControl(4,100,true));
  assert(!following && lampAvailableEffectCount()==38);
  // Local off must prevent a configured follower rejoining after a dropout.
  syncPaused=false;
  assert(!setLampControl(0,100,false) && !syncPaused);
  assert(!setLampControl(4,0,false) && !syncPaused);
  assert(setLampControl(4,100,false));
  assert(!PowerOn && syncPaused && !following);
  assert(setLampControl(4,100,true) && PowerOn && syncPaused);
  // Coordinator off must continue propagating to its group; solo is unaffected.
  syncRole=1;syncPaused=false;
  assert(setLampControl(4,100,false) && !PowerOn && !syncPaused);
  syncRole=0;
  assert(setLampControl(4,100,false) && !syncPaused);
  std::cout<<"PASS: real control path accepts audio only on configured microphone variants\n";
}
