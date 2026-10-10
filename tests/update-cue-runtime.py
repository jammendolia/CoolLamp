"""Actual local overlay and admission latch; no device or radio is touched."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'LampUpdate.cpp').read_text()
begin=source[source.index('void startReceiverCue()'):source.index('void fail(uint8_t error)')]
fixture=r'''
#include "LampUpdateCue.h"
#include "LampUpdate.h"
#include "LampControl.h"
#include <cassert>
#include <cstring>
#include <vector>
#include <iostream>
#include <algorithm>
using std::min;
struct CRGB {uint8_t r,g,b;CRGB(uint8_t r=0,uint8_t g=0,uint8_t b=0):r(r),g(g),b(b){}};
uint16_t NUM_LEDS=1;constexpr uint16_t MAX_LED_COUNT=1024;
uint16_t lampMidpoint=0;
bool PowerOn=true;uint8_t Brightness=100,Mode=4;
uint32_t clockMs=0;uint32_t millis(){return clockMs;}
LampUpdateStatus status{};int mux=0;
#define portENTER_CRITICAL(value) ((void)(value))
#define portEXIT_CRITICAL(value) ((void)(value))
LampControlState getLampControlState(){return {Mode,Brightness,PowerOn};}
LampUpdateStatus getLampUpdateStatus(){return status;}
CRGB* leds=nullptr;CRGB* originalFrame=nullptr;
struct {
 unsigned calls=0;uint8_t brightness=0;uint16_t currentBudget=500;
 std::vector<CRGB> visible;
 void show(uint8_t b){++calls;brightness=b;visible.assign(leds,leds+NUM_LEDS);}
}FastLED;
'''
test=r'''
int main(){
 std::vector<CRGB> frame(1026,CRGB(11,22,33)),scratch(1026,CRGB(1,2,3));leds=frame.data()+1;originalFrame=scratch.data()+1;
 const auto unchanged=frame;
 // Mere availability/checking/donation/postboot health has no receiver latch.
 for(uint8_t phase:{uint8_t(UPDATE_IDLE),uint8_t(UPDATE_CHECKING),uint8_t(UPDATE_AVAILABLE),uint8_t(UPDATE_DOWNLOADING),uint8_t(UPDATE_RESTARTING)}){status.phase=phase;status.receiving=false;assert(!renderLampUpdateCue());}
 assert(FastLED.calls==0);
 PowerOn=false;Brightness=80;startReceiverCue();PowerOn=true;Brightness=255;
 assert(renderLampUpdateCue()&&FastLED.brightness==0);for(const auto& p:FastLED.visible)assert(!p.r&&!p.g&&!p.b);
 clockMs+=100;assert(renderLampUpdateCue()&&FastLED.brightness==0); // off-at-admission stays off after another state change.
 status.receiving=false;assert(!renderLampUpdateCue());PowerOn=true;Brightness=23;startReceiverCue();PowerOn=false;Brightness=200;
 clockMs+=100;assert(renderLampUpdateCue()&&FastLED.brightness==23);assert(frame.size()==unchanged.size()&&!memcmp(frame.data(),unchanged.data(),frame.size()*sizeof(CRGB)));
 const auto calls=FastLED.calls;for(unsigned i=0;i<99;++i){++clockMs;assert(renderLampUpdateCue());}assert(FastLED.calls==calls);++clockMs;assert(renderLampUpdateCue()&&FastLED.calls==calls+1);
 for(uint16_t count:{uint16_t(1),uint16_t(2),uint16_t(3),uint16_t(5),uint16_t(133),uint16_t(205),uint16_t(1023),uint16_t(1024)}){
  NUM_LEDS=count;lampMidpoint=count>1?count/2:0;status.receiving=false;renderLampUpdateCue();PowerOn=true;Brightness=255;startReceiverCue();
  status.totalBytes=2031616;status.writtenOffset=0;clockMs=UINT32_MAX-50;assert(renderLampUpdateCue());const auto before=FastLED.calls;
  clockMs=48;renderLampUpdateCue();assert(FastLED.calls==before);clockMs=49;renderLampUpdateCue();assert(FastLED.calls==before+1);
  for(uint32_t written:{uint32_t(1),uint32_t(1015808),uint32_t(2031616)}){status.writtenOffset=written;clockMs+=100;assert(renderLampUpdateCue());assert(FastLED.brightness==40&&FastLED.visible.size()==count&&FastLED.currentBudget==500);for(const auto& p:FastLED.visible)assert(p.r<=48&&p.g<=38&&p.b<=28);}
  assert(!memcmp(frame.data(),unchanged.data(),frame.size()*sizeof(CRGB)));assert(Mode==4&&Brightness==255&&PowerOn);
 }
 // Known progress grows both base halves rather than reversing the folded strip.
 assert(LampUpdateCue::level(0,5,0,0,1,100)>0);assert(LampUpdateCue::level(4,5,0,0,1,100)>0);assert(LampUpdateCue::level(2,5,0,0,1,100)==0);
 assert(LampUpdateCue::level(0,0,0,0,1,100)==0&&LampUpdateCue::level(0,1025,0,0,1,100)==0);
 status.receiving=false;assert(!renderLampUpdateCue());
 std::cout<<"PASS production update cue: power/brightness latch, receiver-only, local frame restore, 1-1024/odd/folded geometry, dark automatic update, cadence/rollover, no settings/group/catalog mutations\n";
}
'''
with tempfile.TemporaryDirectory(prefix='update-cue-',dir=ROOT/'.build') as folder:
    folder=Path(folder);(folder/'Arduino.h').write_text((ROOT/'tests/sync-stubs/Arduino.h').read_text().replace('inline uint32_t fakeNow=0;\ninline uint32_t millis(){return fakeNow;}',''))
    cpp=folder/'test.cpp';cpp.write_text(fixture+begin+'\n#include "LampUpdateCue.ino"\n'+test);binary=folder/'cue.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,'-I'+str(folder),'-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True)
    subprocess.run([str(binary)],check=True)
