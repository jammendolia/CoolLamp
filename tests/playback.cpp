#include <cassert>
#include <algorithm>
#include <iostream>
#include <new>
#include "../LampPlayback.h"
#include "../LampGeometry.h"
#include <Preferences.h>
uint32_t now=0;uint32_t millis(){return now;}void delay(int){}
uint32_t esp_random(){return 0;}
uint8_t Mode=4,Brightness=100,role=0,scene=0;
bool PowerOn=true,updating=false,mic=false,failCount=false;
constexpr int NUM_LEDS=134,MAX_LED_COUNT=1024;
uint16_t savedCount=134;
struct CRGB{uint8_t r=0,g=0,b=0;CRGB()=default;CRGB(int r,int g,int b):r(r),g(g),b(b){}static const CRGB Black,Red,White;};
const CRGB CRGB::Black{},CRGB::Red{255,0,0},CRGB::White{255,255,255};
uint16_t lampMidpoint=0;
bool lampFactoryResetPending(){return false;}
bool saveLampGeometry(uint16_t midpoint,uint16_t count){if(failCount||midpoint>=count)return false;lampMidpoint=midpoint;return true;}
CRGB leds[NUM_LEDS];
void fill_solid(CRGB* p,int n,CRGB c){std::fill(p,p+n,c);}
struct Controller{CRGB* p=leds;int n=NUM_LEDS;void setLeds(CRGB* data,int count){p=data;n=count;}};
struct Driver{Controller c;int brightness=100,shows=0;Controller& operator[](int){return c;}void show(){++shows;}void setBrightness(int b){brightness=b;}}FastLED;
uint8_t lampSyncRole(){return role;}uint8_t lampGroupScene(){return scene;}
bool lampHasMicrophone(){return mic;}bool lampUpdateOwnsResources(){return updating;}
bool lampPairingOpen(){return false;}bool lampSetupPulse(){return false;}bool lampIdentifyActive(){return false;}
uint8_t lampAvailableEffectCount(){return mic?47:38;}
bool setLampControl(uint32_t m,uint32_t b,bool p){Mode=m;Brightness=b;PowerOn=p;return true;}
void resetLampCalibrationKnob(){}
void syncLampKnob(){}bool finishLampKnob(){return true;}
bool saveLampLedCount(uint16_t count){if(failCount)return false;savedCount=count;return true;}
#include "../LampPlayback.ino"
int main(){
 LampRotation r;r.enabled=1;r.random=0;r.seconds=5;
 assert(saveLampRotation(r));lampRotation={};loadLampRotation();assert(lampRotation.enabled && lampRotation.seconds==5);
 now=4999;serviceLampRotation();assert(Mode==4);now=5000;serviceLampRotation();assert(Mode==5);
 PowerOn=false;now=20000;serviceLampRotation();PowerOn=true;now=24999;serviceLampRotation();assert(Mode==5);now=25000;serviceLampRotation();assert(Mode==6);
 role=2;now+=100000;serviceLampRotation();assert(Mode==6 && !saveLampRotation(r));role=0;
 scene=1;now+=100000;serviceLampRotation();assert(Mode==6 && !saveLampRotation(r));scene=0;
 r.category=2;assert(!saveLampRotation(r));mic=true;assert(saveLampRotation(r));now+=5000;serviceLampRotation();assert(Mode==39);
 r.category=1;r.random=1;assert(saveLampRotation(r));
 for(unsigned count:{38,47})for(unsigned current=1;current<=count;++current)for(unsigned draw=0;draw<100;++draw){
  auto next=nextRotationEffect(current,count,r,draw);assert(next>=1&&next<=38&&next!=current);
 }
 r.category=2;assert(nextRotationEffect(4,38,r,0)==0);
 r.random=0;assert(nextRotationEffect(47,47,r,0)==39);
 r.category=0;assert(nextRotationEffect(47,47,r,0)==1);
 Preferences::failWrites=true;r.enabled=0;assert(!saveLampRotation(r)&&lampRotation.enabled);Preferences::failWrites=false;
 // Unsigned time arithmetic across millis rollover.
 r.enabled=1;r.category=1;r.random=0;now=0xfffffff0;assert(saveLampRotation(r));Mode=38;serviceLampRotation();now+=5000;serviceLampRotation();assert(Mode==1);
 // Probe beyond the configured allocation without touching the normal buffer.
 leds[0]={7,8,9};assert(beginLampCalibration());assert(FastLED.c.n==1024 && FastLED.c.p!=leds);
 moveLampCalibration(1024);now+=50;assert(renderLampCalibration());assert(FastLED.c.p[1023].g==220&&leds[0].r==7);
 moveLampCalibration(0);assert(lampCalibrationPosition()==1024);
 moveLampCalibration(1025);assert(lampCalibrationPosition()==1024);
 moveLampCalibration(1);now+=50;renderLampCalibration();assert(FastLED.c.p[1023].g==0 && FastLED.c.p[0].g==220);
 failCount=true;assert(!finishLampCalibration(true)&&lampCalibrationActive()&&savedCount==134);failCount=false;
 moveLampCalibration(200);assert(finishLampCalibration(true)&&savedCount==200&&FastLED.c.p==leds&&FastLED.c.n==134);
 assert(beginLampCalibration());moveLampCalibration(20);assert(finishLampCalibration(false)&&savedCount==200);
 assert(beginLampCalibration());now+=300000;assert(!renderLampCalibration()&&!lampCalibrationActive());
 assert(beginLampCalibration());updating=true;assert(!renderLampCalibration()&&!lampCalibrationActive());assert(!beginLampCalibration());updating=false;
 role=1;assert(!beginLampCalibration());role=2;assert(!beginLampCalibration());role=0;
 PowerOn=false;assert(beginLampCalibration());assert(finishLampCalibration(false)&&FastLED.brightness==0);
 PowerOn=true;
 assert(beginLampCenterCalibration()&&lampCalibrationCenter()&&lampCalibrationPosition()==67&&FastLED.c.n==134);
 assert(!beginLampCalibration());moveLampCalibration(133);moveLampCalibration(134);assert(lampCalibrationPosition()==133);
 now+=50;renderLampCalibration();assert(leds[0].r==7);
 assert(finishLampCalibration(true)&&lampMidpoint==133&&savedCount==200&&FastLED.c.p==leds);
 assert(beginLampCenterCalibration());moveLampCalibration(10);now+=9999;assert(renderLampCalibration());
 now+=1;assert(!renderLampCalibration()&&!lampCalibrationActive()&&lampMidpoint==133);
 assert(beginLampCenterCalibration());moveLampCalibration(20);failCount=true;assert(!finishLampCalibration(true)&&lampCalibrationCenter()&&lampMidpoint==133);failCount=false;
 now+=10000;assert(!renderLampCalibration()&&lampMidpoint==133);
 role=2;assert(beginLampCenterCalibration());assert(finishLampCalibration(false)&&role==2);role=0;
 now=0xfffffff0;assert(beginLampCenterCalibration());touchLampCalibration();now+=10000;assert(!renderLampCalibration()&&lampMidpoint==133);
 std::cout<<"PASS: rotation timing, filters, persistence, pause, rollover; calibration bounds, buffer restoration, timeout, save failure\n";
}
