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
bool edison=false,microphoneEnabled=true;
bool lampEdisonProfileMatches(){return edison;}
bool lampMicrophoneEnabled(){return microphoneEnabled;}
bool following=false;
uint8_t syncRole=0;
uint8_t lampSyncRole(){return syncRole;}
bool syncPaused=false;
bool lampSyncFollowing(){return following;}
bool leaveLampSceneForEffect(){return true;}
void pauseLampSync(){if(syncRole==2){following=false;syncPaused=true;}}
constexpr uint8_t MODE_MAX=52;
uint8_t Mode=4,Brightness=100;
bool PowerOn=true;
struct CRGB { static constexpr int Black=0; };
int leds[1];constexpr int NUM_LEDS=1;
void fill_solid(int*,int,int){}
void syncLampKnob(){}
void noteLampUpdateUse(){}
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
  // Appended IDs are inaccessible on all legacy/unmatched constructions.
  const auto unchanged=getLampControlState();
  for(uint32_t id:{48u,49u,50u,51u,52u,53u,255u,UINT32_MAX}){
    assert(!setLampControl(id,200,true));
    const auto state=getLampControlState();
    assert(state.mode==unchanged.mode&&state.brightness==unchanged.brightness&&state.power==unchanged.power);
  }
  edison=true;installed=false;
  assert(lampAvailableEffectCount()==51);
  for(uint8_t id=39;id<=47;++id)assert(!lampEffectAvailable(id));
  for(uint8_t id=48;id<=51;++id)assert(lampEffectAvailable(id)&&setLampControl(id,80,true));
  assert(!lampEffectAvailable(52)&&!setLampControl(52,80,true));
  // Knob selection skips unavailable audio slots without changing the old IDs.
  assert(lampNextAvailableEffect(38,1)==48);
  assert(lampNextAvailableEffect(48,-1)==38);
  assert(lampNextAvailableEffect(51,1)==1);
  assert(lampNextAvailableEffect(1,-1)==51);
  installed=true;microphoneEnabled=false;
  assert(lampAvailableEffectCount()==52&&!lampEffectAvailable(52));
  assert(lampNextAvailableEffect(51,1)==1&&lampNextAvailableEffect(1,-1)==51);
  microphoneEnabled=true;
  assert(lampEffectAvailable(52)&&setLampControl(52,80,true));
  assert(lampNextAvailableEffect(51,1)==52&&lampNextAvailableEffect(52,1)==1&&lampNextAvailableEffect(1,-1)==52);
  microphoneEnabled=false;assert(setLampControl(52,80,false)&&!PowerOn);
  microphoneEnabled=true;assert(setLampControl(52,80,true));
  // Region effects cannot travel in legacy Mirror/group packets. A rejected
  // selection must not pause a follower or apply power/brightness changes.
  for(uint8_t role:{uint8_t(1),uint8_t(2)}){
    syncRole=role;following=role==2;syncPaused=false;
    const auto before=getLampControlState();
    for(uint8_t id=48;id<=52;++id){
      assert(!lampEffectAvailable(id)&&!setLampControl(id,200,false));
      const auto after=getLampControlState();
      assert(after.mode==before.mode&&after.brightness==before.brightness&&after.power==before.power);
      assert(!syncPaused&&following==(role==2));
    }
  }
  syncRole=0;following=false;edison=false;
  assert(lampAvailableEffectCount()==47);
  std::cout<<"PASS: real control path preserves legacy audio, fences Edison IDs/profile/microphone/group, skips unavailable slots and rejects without mutation\n";
}
