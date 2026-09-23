#include <cassert>
#include <cstdint>
#include <iostream>
#include "../LampControl.h"
bool installed=false;
bool lampHasMicrophone(){return installed;}
constexpr uint8_t MODE_MAX=40;
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
  assert(lampAvailableEffectCount()==40);
  assert(setLampControl(39,100,true) && setLampControl(40,100,true));
  assert(!setLampControl(41,100,true) && !setLampControl(40,0,true));
  installed=false;
  assert(!setLampControl(40,100,true));
  assert(setLampControl(4,100,true));
  std::cout<<"PASS: real control path accepts audio only on configured microphone variants\n";
}
