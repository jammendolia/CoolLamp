bool calibrating=false,calibrationSaved=false;
unsigned short position=134;
void syncLampKnob();
void resetLampCalibrationKnob();
bool lampCalibrationActive(){return calibrating;}
unsigned short lampCalibrationPosition(){return position;}
void moveLampCalibration(unsigned short p){position=p;syncLampKnob();}
bool finishLampCalibration(bool save){calibrationSaved=save;calibrating=false;resetLampCalibrationKnob();return true;}
#include <algorithm>
#include "../LampGeometry.h"
uint16_t lampMidpoint=0;
#include <cassert>
#include <cstdint>
#include <iostream>
#include "../LampControl.h"
#include "../LampGestures.h"
uint32_t clockMs=0;
uint32_t millis(){return clockMs;}
bool button=false,updating=false,pairing=false;
unsigned updateUseNotes=0;void noteLampUpdateUse(){++updateUseNotes;}
bool factoryArmed=false,factoryPending=false;
int factoryResets=0;
void armLampFactoryReset(bool armed){factoryArmed=armed&&!updating;}
bool lampFactoryResetPending(){return factoryPending;}
bool requestLampFactoryReset(){if(updating)return false;++factoryResets;factoryPending=true;return true;}
uint16_t lampCalibrationMaximum(){return 1024;}
void touchLampCalibration(){}
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
namespace LampCommission {
bool pending=false;unsigned approvals=0;
bool physicalPending(){return pending;}
void approvePhysical(){if(pending){++approvals;pending=false;}}
}
uint8_t lampAvailableEffectCount(){return microphone?47:38;}
LampColor colors[48]{};
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
bool lampSyncFollowing(){return false;}
void pauseLampSync(){}
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
  microphone=true;setLampControl(47,100,true);turn(1);assert(Mode==1);turn(-1);assert(Mode==47);
  microphone=false;
  setLampControl(38,100,true);turn(1);assert(Mode==1);turn(-1);assert(Mode==38);setLampControl(4,100,true);
  turn(1);assert(Mode==5&&Brightness==100);
  clicks(1);assert(knobMode==KnobMode::Brightness&&PowerOn);
  turn(1);assert(Brightness==105&&Mode==5&&brightnessSaves==0);
  tick(4900);assert(knobMode==KnobMode::Brightness);turn(1);tick(4900);assert(brightnessSaves==0);
  tick(101);assert(knobMode==KnobMode::Effects&&Brightness==110&&brightnessSaves==1);
  tick(6000);assert(brightnessSaves==1);turn(1);assert(Mode==6);
  clicks(2);assert(knobMode==KnobMode::Color);const int index=knobColorIndex;
  const auto priorUseNotes=updateUseNotes;turn(1);assert(knobColorIndex==(index+1)%knobPaletteSize&&Mode==6&&colors[6].enabled&&updateUseNotes==priorUseNotes+1);
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
  // Calibration owns the knob and never changes the underlying effect or brightness.
  const auto oldMode=Mode,oldBrightness=Brightness;
  button=true;tick(80);button=false;tick(100); // A click pending before app setup must not save it.
  calibrating=true;resetLampCalibrationKnob();tick(500);assert(calibrating);turn(10000);assert(position==1024&&Mode==oldMode&&Brightness==oldBrightness);
  turn(-10000);assert(position==1);turn(199);clicks(1);assert(!calibrating&&calibrationSaved&&position==200);
  calibrating=true;syncLampKnob();clicks(2);assert(!calibrating&&!calibrationSaved);
  // Enrollment consumes only a fresh, debounced single click. It cannot turn
  // the lamp on, change the effect, persist knob settings, or open pairing.
  const auto setupMode=Mode,setupBrightness=Brightness;
  const bool setupPower=PowerOn;
  const int setupBrightnessWrites=brightnessSaves,setupColorWrites=colorSaves;
  const int setupWifi=wifiToggles,setupPairing=pairToggles,setupResets=factoryResets;
  button=true;tick(80);LampCommission::pending=true;tick(1);button=false;tick(500);
  assert(LampCommission::pending&&LampCommission::approvals==0); // Pre-held release is not approval.
  turn(20);clicks(2);clicks(3);
  assert(LampCommission::pending&&LampCommission::approvals==0);
  button=true;tick(12000);button=false;tick(500);
  assert(LampCommission::pending&&LampCommission::approvals==0);
  assert(Mode==setupMode&&Brightness==setupBrightness&&PowerOn==setupPower);
  assert(brightnessSaves==setupBrightnessWrites&&colorSaves==setupColorWrites);
  assert(wifiToggles==setupWifi&&pairToggles==setupPairing&&factoryResets==setupResets);
  clicks(1);assert(!LampCommission::pending&&LampCommission::approvals==1);
  assert(Mode==setupMode&&Brightness==setupBrightness&&PowerOn==setupPower);
  LampCommission::pending=true;tick(1);button=true;tick(80);LampCommission::pending=false;tick(1);
  button=false;tick(500);assert(LampCommission::approvals==1&&knobMode==KnobMode::Effects);
  // Factory reset arms at ten seconds, but only commits on release, once.
  button=true;tick(10001);assert(factoryArmed&&factoryResets==0);
  tick(5000);assert(factoryResets==0);button=false;tick(40);assert(factoryResets==1&&!factoryArmed);
  tick(1000);assert(factoryResets==1);factoryPending=false;
  button=true;tick(9900);button=false;tick(500);assert(factoryResets==1&&!factoryArmed);
  // A press spanning an update never turns into a destructive long hold.
  updating=true;button=true;tick(12000);updating=false;tick(12000);button=false;tick(1000);assert(factoryResets==1);
  clockMs=0xfffffff0U;button=true;tick(10001);button=false;tick(40);assert(factoryResets==2);
  std::cout<<"PASS: single/double/triple clicks, click-and-turn, debounce, long holds, live preview, save-once, inactivity, bounds, remote changes, OTA suppression and clock wrap.\n";
}
