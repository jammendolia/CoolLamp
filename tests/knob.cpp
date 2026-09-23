#include <algorithm>
#include <cassert>
#include <cstdint>
#include <iostream>
#include "../LampControl.h"
#include "../LampGestures.h"
uint32_t clockMs=0;
uint32_t millis(){return clockMs;}
bool button=false,updating=false,pairing=false;
constexpr int LOW=0,DI_ENCODER_SW=2,NUM_LEDS=3;
int digitalRead(int){return button?0:1;}
int constrain(int x,int low,int high){return std::clamp(x,low,high);}
struct CRGB{uint8_t r,g,b;CRGB(uint8_t r=0,uint8_t g=0,uint8_t b=0):r(r),g(g),b(b){}};
CRGB leds[3]={{255,255,255},{255,35,85},{255,255,255}};
uint8_t Mode=4,Brightness=100;
bool PowerOn=true;
bool failSave=false;
int brightnessSaves=0,colorSaves=0,wifiToggles=0,pairToggles=0;
bool microphone=false;
uint8_t lampAvailableEffectCount(){return microphone?40:38;}
LampColor colors[41]{};
struct Encoder {
  long value=4,low=1,high=38;bool wrap=true,changed=false;
  void setBoundaries(long a,long b,bool w){low=a;high=b;wrap=w;}
  void setEncoderValue(long v){value=std::clamp(v,low,high);}
  long getEncoderValue(){return value;}
  bool encoderChanged(){bool c=changed;changed=false;return c;}
  void turn(int delta){value+=delta;if(wrap){while(value>high)value-=high-low+1;while(value<low)value+=high-low+1;}else value=std::clamp(value,low,high);changed=true;}
} rotaryEncoder;
bool setLampControl(uint32_t m,uint32_t b,bool p){Mode=m;Brightness=b;PowerOn=p;syncLampKnob();return true;}
LampColor getLampColor(uint8_t m){return colors[m];}
bool setLampColor(uint8_t m,uint8_t r,uint8_t g,uint8_t b){colors[m]={1,r,g,b};return true;}
bool saveLampColors(){++colorSaves;return !failSave;}
bool saveLampKnobBrightness(){++brightnessSaves;return !failSave;}
bool lampIsUpdating(){return updating;}
bool lampPairingOpen(){return pairing;}
void setLampPairingWindow(bool p){pairing=p;++pairToggles;}
void toggleLampSetup(){++wifiToggles;}
void cancelLampSetupPulse(){}
// Arduino normally supplies these declarations.
void applyLampGesture(LampGesture);
#include "../LampKnob.ino"
void tick(unsigned ms){for(unsigned i=0;i<ms;++i){++clockMs;serviceLampKnob();}}
void clicks(int n){for(int i=0;i<n;++i){button=true;tick(80);button=false;tick(100);}tick(400);}
void turn(int delta){rotaryEncoder.turn(delta);tick(1);}
int main(){
  microphone=true;setLampControl(40,100,true);turn(1);assert(Mode==1);turn(-1);assert(Mode==40);
  microphone=false;
  setLampControl(38,100,true);turn(1);assert(Mode==1);turn(-1);assert(Mode==38);setLampControl(4,100,true);
  turn(1);assert(Mode==5&&Brightness==100);
  clicks(1);assert(knobMode==KnobMode::Brightness&&PowerOn);
  turn(1);assert(Brightness==105&&Mode==5&&brightnessSaves==0);
  tick(4900);assert(knobMode==KnobMode::Brightness);turn(1);tick(4900);assert(brightnessSaves==0);
  tick(101);assert(knobMode==KnobMode::Effects&&Brightness==110&&brightnessSaves==1);
  tick(6000);assert(brightnessSaves==1);turn(1);assert(Mode==6);
  clicks(2);assert(knobMode==KnobMode::Color);const int index=knobColorIndex;
  turn(1);assert(knobColorIndex==(index+1)%knobPaletteSize&&Mode==6&&colors[6].enabled);
  assert(colorSaves==0);clicks(1);assert(colorSaves==1&&knobMode==KnobMode::Effects);
  clicks(3);assert(!PowerOn&&knobMode==KnobMode::Effects);clicks(1);assert(PowerOn&&knobMode==KnobMode::Effects);
  // Immediate click-and-turn adjusts brightness, not the effect.
  button=true;tick(80);button=false;tick(50);turn(1);
  assert(knobMode==KnobMode::Brightness&&Brightness==115&&Mode==6);
  turn(1000);assert(Brightness==255);turn(-1000);assert(Brightness==1&&PowerOn);
  clicks(3);assert(!PowerOn&&brightnessSaves==2);clicks(1);
  // Click pending before a long hold never becomes a short-press action.
  button=true;tick(80);button=false;tick(80);button=true;tick(3001);
  assert(wifiToggles==1&&pairToggles==0&&knobMode==KnobMode::Effects);
  tick(3000);assert(wifiToggles==1&&pairToggles==1);
  button=false;tick(1000);assert(PowerOn&&knobMode==KnobMode::Effects);
  // Debounce rejects mechanical bounce.
  button=true;tick(10);button=false;tick(10);button=true;tick(10);button=false;tick(500);
  assert(knobMode==KnobMode::Effects);
  // Remote changes exit adjustment; subsequent rotation still selects effects.
  clicks(2);turn(1);setLampControl(20,100,true);tick(1);assert(knobMode==KnobMode::Effects);turn(1);assert(Mode==21);
  // No delayed click/hold after firmware-update suppression.
  updating=true;button=true;tick(7000);updating=false;tick(7000);button=false;tick(500);
  assert(wifiToggles==1&&pairToggles==1&&knobMode==KnobMode::Effects);
  // Click and inactivity arithmetic also work across the uint32 wrap.
  clockMs=0xffffff00U;clicks(1);assert(knobMode==KnobMode::Brightness);turn(1);tick(5001);assert(knobMode==KnobMode::Effects);
  // Failed flash writes do not trap the controls or hammer flash every loop.
  clicks(1);turn(1);failSave=true;clicks(3);assert(!PowerOn&&knobMode==KnobMode::Effects);
  const int attempts=brightnessSaves;tick(4000);assert(brightnessSaves==attempts);
  failSave=false;tick(1100);assert(brightnessSaves==attempts+1&&!knobBrightnessPending);
  std::cout<<"PASS: single/double/triple clicks, click-and-turn, debounce, long holds, live preview, save-once, inactivity, bounds, remote changes, OTA suppression and clock wrap.\n";
}
