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
#include "LampRuntimeMetrics.h"
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
void lampShowFrame(uint8_t brightness,LampRuntimeMetrics::FrameKind kind){assert(kind==LampRuntimeMetrics::FrameKind::Update);FastLED.show(brightness);}
'''
test=r'''
int main(){
 std::vector<CRGB> frame(1026,CRGB(11,22,33)),scratch(1026,CRGB(1,2,3));leds=frame.data()+1;originalFrame=scratch.data()+1;
 const auto unchanged=frame;
 const auto same=[](const CRGB& a,const CRGB& b){return a.r==b.r&&a.g==b.g&&a.b==b.b;};
 const auto intensity=[](const CRGB& p){return std::max(p.r,std::max(p.g,p.b));};
 const auto rgb=[](LampUpdateCue::Color value){return CRGB(value.r,value.g,value.b);};
 const auto ambientAt=[&](uint32_t elapsed){
  const auto value=rgb(LampUpdateCue::ambient(elapsed,status.cueGeneration));
  assert(intensity(value)>0&&intensity(value)<=18);
  return value;
 };
 const auto assertAmbientFrame=[&](uint32_t elapsed){const auto expected=ambientAt(elapsed);for(const auto& p:FastLED.visible)assert(same(p,expected));};
 // Exercise the production palette/interpolation independently of the overlay.
 // These assertions specify visible bounds and continuity, not its hash/palette.
 std::vector<CRGB> generationColors;
 for(uint32_t generation:{uint32_t(0),uint32_t(1),uint32_t(2),uint32_t(3),uint32_t(17),uint32_t(64),UINT32_MAX}){
  auto previous=rgb(LampUpdateCue::ambient(0,generation));generationColors.push_back(previous);bool changed=false;
  for(uint32_t elapsed=0;elapsed<=76800;elapsed+=100){
   const auto value=rgb(LampUpdateCue::ambient(elapsed,generation));
   assert(intensity(value)>0&&intensity(value)<=18);
   assert(same(value,rgb(LampUpdateCue::ambient(elapsed,generation))));
   const auto delta=[](uint8_t a,uint8_t b){return a>b?a-b:b-a;};
   assert(delta(value.r,previous.r)<=1&&delta(value.g,previous.g)<=1&&delta(value.b,previous.b)<=1);
   changed|=!same(value,previous);previous=value;
  }
  assert(changed);
  const auto boundary=rgb(LampUpdateCue::ambient(UINT32_MAX,generation));assert(intensity(boundary)>0&&intensity(boundary)<=18);
 }
 assert(std::any_of(generationColors.begin()+1,generationColors.end(),[&](const CRGB& value){return !same(value,generationColors.front());}));
 const LampUpdateCue::Color a{6,12,18},b{48,0,0};
 assert(same(rgb(LampUpdateCue::blend(a,b,0,100)),CRGB(6,12,18)));
 assert(same(rgb(LampUpdateCue::blend(a,b,50,100)),CRGB(27,6,9)));
 assert(same(rgb(LampUpdateCue::blend(a,b,100,100)),CRGB(48,0,0)));
 assert(same(rgb(LampUpdateCue::blend(a,b,0,0)),CRGB(6,12,18)));
 assert(same(rgb(LampUpdateCue::blend(a,b,101,100)),CRGB(6,12,18)));
 assert(same(rgb(LampUpdateCue::blend({0,0,0},{255,255,255},UINT32_MAX-1,UINT32_MAX)),CRGB(254,254,254)));
 assert(same(rgb(LampUpdateCue::blend({0,0,0},{255,255,255},UINT32_MAX,UINT32_MAX)),CRGB(255,255,255)));
 status.route=UPDATE_ROUTE_DONATION; // Preserve exhaustive amber geometry regression checks.
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
  status.totalBytes=2031616;status.writtenOffset=0;clockMs=UINT32_MAX-50;assert(renderLampUpdateCue());assertAmbientFrame(0);const auto before=FastLED.calls;
  clockMs=48;renderLampUpdateCue();assert(FastLED.calls==before);clockMs=49;renderLampUpdateCue();assert(FastLED.calls==before+1);assertAmbientFrame(100);
  for(uint32_t written:{uint32_t(1),uint32_t(1015808),uint32_t(2031616)}){status.writtenOffset=written;clockMs+=100;assert(renderLampUpdateCue());assert(FastLED.brightness==40&&FastLED.visible.size()==count&&FastLED.currentBudget==500);for(const auto& p:FastLED.visible)assert(p.r<=48&&p.g<=38&&p.b<=28);}
  assert(!memcmp(frame.data(),unchanged.data(),frame.size()*sizeof(CRGB)));assert(Mode==4&&Brightness==255&&PowerOn);
 }
 // Exercise the real overlay at every supported count, including odd counts
 // and both endpoint calibrations. Inspect observable pixels rather than
 // reproduce its height/progress calculation in this fixture.
 uint64_t sampledPixels=0;unsigned geometries=0;
 for(uint16_t count=1;count<=1024;++count){
  std::vector<uint16_t> midpoints={0,uint16_t(count/2),uint16_t(count-1)};
  if(count>1)midpoints.push_back(1);
  std::sort(midpoints.begin(),midpoints.end());midpoints.erase(std::unique(midpoints.begin(),midpoints.end()),midpoints.end());
  for(uint16_t midpoint:midpoints){
   ++geometries;NUM_LEDS=count;lampMidpoint=midpoint;status.receiving=false;assert(!renderLampUpdateCue());
   PowerOn=true;Brightness=255;startReceiverCue();status.totalBytes=2031616;status.writtenOffset=0;clockMs=0;
   assert(renderLampUpdateCue());assertAmbientFrame(0);
   std::vector<bool> filledBefore(count,false);
   for(uint32_t written:{uint32_t(1),uint32_t(20316),uint32_t(507904),uint32_t(1015808),uint32_t(1523712),uint32_t(2011299),uint32_t(2031615),uint32_t(2031616)}){
    status.writtenOffset=written;clockMs+=4000;assert(renderLampUpdateCue());const auto low=FastLED.visible;const auto lowAmbient=ambientAt(clockMs);
    clockMs+=2000;assert(renderLampUpdateCue());const auto high=FastLED.visible;const auto highAmbient=ambientAt(clockMs);
    // Time changes only the subdued background. Confirmed-byte progress and
    // the solid foreground must never advance merely because time passes.
    clockMs+=2000;
    assert(FastLED.brightness==40&&FastLED.currentBudget==500);
    if(count==1){
     assert(same(low[0],rgb(LampUpdateCue::blend({lowAmbient.r,lowAmbient.g,lowAmbient.b},{48,38,28},written,status.totalBytes))));
     assert(same(high[0],rgb(LampUpdateCue::blend({highAmbient.r,highAmbient.g,highAmbient.b},{48,38,28},written,status.totalBytes))));
     if(written<status.totalBytes)assert(intensity(low[0])<48&&intensity(high[0])<48);
    }else{
     assert(low.front().r==48&&low.back().r==48); // Both physical base ends.
     bool ambientVisible=false;
     for(uint16_t i=0;i<count;++i){
      const bool filled=low[i].r==48;
      assert(!filledBefore[i]||filled);filledBefore[i]=filled;
      if(filled){assert(low[i].g==38&&low[i].b==28&&high[i].r==48&&high[i].g==38&&high[i].b==28);}
      else{ambientVisible=true;assert(same(low[i],lowAmbient)&&same(high[i],highAmbient));}
     }
     if(count>2&&written==1)assert(ambientVisible); // The top is still unfilled.
    }
    if(written==status.totalBytes)for(const auto& p:high)assert(p.r==48&&p.g==38&&p.b==28);
    sampledPixels+=uint64_t(count)*2;
   }
   // No guessed percentage for zero bytes, absent size, or a corrupt offset.
   for(uint8_t invalid=0;invalid<3;++invalid){
    status.totalBytes=invalid==1?0:2031616;status.writtenOffset=invalid==0?0:2031617;
    clockMs+=4000;assert(renderLampUpdateCue());assertAmbientFrame(clockMs);
    clockMs+=2000;assert(renderLampUpdateCue());assertAmbientFrame(clockMs);
    clockMs+=2000;
   }
   assert(!memcmp(frame.data(),unchanged.data(),frame.size()*sizeof(CRGB)));assert(Mode==4&&Brightness==255&&PowerOn);
  }
 }
 // Preserve the physical folded-strip orientation and strict sharp boundary.
 assert(LampUpdateCue::level(0,5,0,0,1,100)==48);assert(LampUpdateCue::level(4,5,0,0,1,100)==48);assert(LampUpdateCue::level(2,5,0,0,1,100)==12);
 assert(LampUpdateCue::level(2,5,0,2000,1,100)==18);
 assert(LampUpdateCue::level(1,5,0,0,49,100)==12&&LampUpdateCue::level(1,5,0,0,50,100)==48);
 assert(LampUpdateCue::level(3,5,0,0,49,100)==12&&LampUpdateCue::level(3,5,0,0,51,100)==48);
 // Wide artifact counters do not overflow or falsely indicate completed data.
 for(uint32_t elapsed:{uint32_t(0),uint32_t(2000),UINT32_MAX}){
  assert(LampUpdateCue::level(0,1,0,elapsed,UINT32_MAX-1,UINT32_MAX)<48);
  assert(LampUpdateCue::level(0,1,0,elapsed,UINT32_MAX,UINT32_MAX)==48);
  assert(LampUpdateCue::level(2,5,0,elapsed,UINT32_MAX,UINT32_MAX)==48);
 }
 assert(LampUpdateCue::level(0,0,0,0,1,100)==0&&LampUpdateCue::level(0,1025,0,0,1,100)==0&&LampUpdateCue::level(5,5,0,0,1,100)==0);
 status.receiving=false;assert(!renderLampUpdateCue());
 // Test route selection through the production renderer, using explicit RGB
 // expectations rather than reimplement its palette or geometry calculation.
 struct RouteColor {uint8_t route;CRGB filled,maximum;};
 const RouteColor routeColors[]={
  {UPDATE_ROUTE_NONE,          {48,48,48},{255,255,255}},
  {UPDATE_ROUTE_INTERNET,      {28,48,28},{153,255,153}},
  {UPDATE_ROUTE_BLUETOOTH,     {28,38,48},{153,204,255}},
  {UPDATE_ROUTE_DONATION,      {48,38,28},{255,204,153}},
  {UPDATE_ROUTE_MANUAL_UPLOAD, {38,28,48},{204,153,255}},
  {5,                         {48,48,48},{255,255,255}},
  {255,                       {48,48,48},{255,255,255}}
 };
 const auto checkFrameRestored=[&](){
  assert(!memcmp(frame.data(),unchanged.data(),frame.size()*sizeof(CRGB)));
  assert(scratch.front().r==1&&scratch.front().g==2&&scratch.front().b==3);
  assert(scratch.back().r==1&&scratch.back().g==2&&scratch.back().b==3);
 };
 uint64_t coloredPixels=0;unsigned coloredGeometries=0;
 std::vector<std::vector<CRGB>> firstRouteAmbient;
 for(const auto& expected:routeColors){
  status.route=expected.route;
  // No channel overflows even outside the overlay's 0-48 level range. Unknown
  // routes and legacy NONE deliberately use neutral white, never donor amber.
  const auto zero=LampUpdateCue::color(expected.route,0),maximum=LampUpdateCue::color(expected.route,255);
  assert(!zero.r&&!zero.g&&!zero.b&&same(CRGB(maximum.r,maximum.g,maximum.b),expected.maximum));
  // At a fixed background, every confirmed-byte increase moves the single
  // pixel monotonically toward the route color, without reaching it early.
  const auto bg=LampUpdateCue::ambient(1700,29),fill=LampUpdateCue::Color{expected.filled.r,expected.filled.g,expected.filled.b};
  auto previous=rgb(bg);
  for(uint32_t part=0;part<=100;++part){
   const auto value=rgb(LampUpdateCue::blend(bg,fill,part,100));
   assert(value.r>=previous.r&&value.g>=previous.g&&value.b>=previous.b);
   if(part<100)assert(intensity(value)<48);else assert(same(value,expected.filled));
   previous=value;
  }
  // Sender/donor service activity has no receiver latch, regardless of route
  // or phase. It must not render, alter the local frame or latch power.
  const auto inactiveCalls=FastLED.calls;
  for(uint8_t phase:{uint8_t(UPDATE_IDLE),uint8_t(UPDATE_CHECKING),uint8_t(UPDATE_AVAILABLE),uint8_t(UPDATE_DOWNLOADING),uint8_t(UPDATE_RESTARTING),uint8_t(UPDATE_ERROR)}){
   status.phase=phase;status.receiving=false;assert(!renderLampUpdateCue());
  }
  assert(FastLED.calls==inactiveCalls);checkFrameRestored();
  // Keep the same generation and elapsed time across different receivers:
  // background is physically identical across all routes, even unknown ones.
  NUM_LEDS=5;lampMidpoint=2;status.cueGeneration=123;PowerOn=true;Brightness=23;startReceiverCue();
  status.totalBytes=100;status.writtenOffset=0;unsigned ambientSample=0;
  for(uint32_t elapsed:{uint32_t(0),uint32_t(100),uint32_t(2000),uint32_t(6300),uint32_t(6400),uint32_t(12800)}){
   clockMs=elapsed;assert(renderLampUpdateCue());assertAmbientFrame(elapsed);
   if(expected.route==UPDATE_ROUTE_NONE)firstRouteAmbient.push_back(FastLED.visible);
   else{assert(FastLED.visible.size()==firstRouteAmbient[ambientSample].size());for(uint16_t i=0;i<NUM_LEDS;++i)assert(same(FastLED.visible[i],firstRouteAmbient[ambientSample][i]));}
   ++ambientSample;
  }
  status.receiving=false;assert(!renderLampUpdateCue());checkFrameRestored();
  // Every source obeys captured off-at-start state. Later live control state
  // cannot make an update visible or change its saved brightness/settings.
  NUM_LEDS=5;lampMidpoint=2;PowerOn=false;Brightness=80;startReceiverCue();
  status.totalBytes=100;status.writtenOffset=100;PowerOn=true;Brightness=255;clockMs=0;
  assert(renderLampUpdateCue()&&FastLED.brightness==0);for(const auto& p:FastLED.visible)assert(!intensity(p));
  clockMs=2000;assert(renderLampUpdateCue()&&FastLED.brightness==0);for(const auto& p:FastLED.visible)assert(!intensity(p));
  checkFrameRestored();
  for(uint16_t count=1;count<=1024;++count){
   std::vector<uint16_t> midpoints={0,uint16_t(count/2),uint16_t(count-1)};
   if(count>1)midpoints.push_back(1);
   std::sort(midpoints.begin(),midpoints.end());midpoints.erase(std::unique(midpoints.begin(),midpoints.end()),midpoints.end());
   for(uint16_t midpoint:midpoints){
    ++coloredGeometries;NUM_LEDS=count;lampMidpoint=midpoint;status.receiving=false;assert(!renderLampUpdateCue());
    PowerOn=true;Brightness=23;startReceiverCue();PowerOn=false;Brightness=200;
    status.totalBytes=100;status.writtenOffset=0;clockMs=0;
    assert(renderLampUpdateCue());assertAmbientFrame(0);
    clockMs=2000;assert(renderLampUpdateCue());assertAmbientFrame(clockMs);
    // Route identifies only the steady foreground. The whole-lamp ambient
    // remains subdued, independent of route, and changes without advancing fill.
    std::vector<bool> filledBefore(count,false);
    for(uint32_t written:{uint32_t(1),uint32_t(50),uint32_t(100)}){
     status.writtenOffset=written;clockMs+=2000;assert(renderLampUpdateCue());const auto low=FastLED.visible;const auto lowAmbient=ambientAt(clockMs);
     clockMs+=2000;assert(renderLampUpdateCue());const auto high=FastLED.visible;const auto highAmbient=ambientAt(clockMs);
     assert(FastLED.brightness==23&&FastLED.currentBudget==500&&low.size()==count&&high.size()==count);
     if(count==1){
      const auto fill=LampUpdateCue::Color{expected.filled.r,expected.filled.g,expected.filled.b};
      assert(same(low[0],rgb(LampUpdateCue::blend({lowAmbient.r,lowAmbient.g,lowAmbient.b},fill,written,100))));
      assert(same(high[0],rgb(LampUpdateCue::blend({highAmbient.r,highAmbient.g,highAmbient.b},fill,written,100))));
      if(written<100)assert(intensity(low[0])<48&&intensity(high[0])<48);
      if(written==100){assert(same(low[0],expected.filled)&&same(high[0],expected.filled));}
     }else{
      assert(same(low.front(),expected.filled)&&same(low.back(),expected.filled));
      bool ambientVisible=false;
      for(uint16_t i=0;i<count;++i){
       const bool filled=intensity(low[i])==48;
       assert(!filledBefore[i]||filled);filledBefore[i]=filled;
       if(filled){assert(same(low[i],expected.filled)&&same(high[i],expected.filled));}
       else{ambientVisible=true;assert(same(low[i],lowAmbient)&&same(high[i],highAmbient));}
      }
      if(count>2&&written==1)assert(ambientVisible);
     }
     if(written==100)for(const auto& p:high)assert(same(p,expected.filled));
     coloredPixels+=uint64_t(count)*2;
    }
    // Invalid or absent progress keeps the entire lamp's ambient motion, without a
    // route-specific invented completed region or percentage.
    for(uint8_t invalid=0;invalid<3;++invalid){
     status.totalBytes=invalid==1?0:100;status.writtenOffset=invalid==0?0:101;
     clockMs+=2000;assert(renderLampUpdateCue());assertAmbientFrame(clockMs);
     clockMs+=2000;assert(renderLampUpdateCue());assertAmbientFrame(clockMs);
     coloredPixels+=uint64_t(count)*2;
    }
    checkFrameRestored();assert(Mode==4&&Brightness==200&&!PowerOn&&status.route==expected.route);
   }
  }
  // Route coloring must not weaken rollover-safe cadence or the admission
  // generation fence when a new receiver replaces a prior session.
  NUM_LEDS=5;lampMidpoint=2;status.receiving=false;assert(!renderLampUpdateCue());
  status.cueGeneration=UINT32_MAX;PowerOn=true;Brightness=255;startReceiverCue();assert(status.cueGeneration==1);
  status.totalBytes=100;status.writtenOffset=100;clockMs=UINT32_MAX-50;assert(renderLampUpdateCue());const auto before=FastLED.calls;
  clockMs=48;assert(renderLampUpdateCue()&&FastLED.calls==before);
  clockMs=49;assert(renderLampUpdateCue()&&FastLED.calls==before+1&&FastLED.brightness==40);
  for(const auto& p:FastLED.visible)assert(same(p,expected.filled));
  checkFrameRestored();
  status.receiving=false;assert(!renderLampUpdateCue());
  // The actual single-pixel renderer must not round an incomplete wide byte
  // count into its completed color, and must reach that exact color at finish.
  NUM_LEDS=1;lampMidpoint=0;PowerOn=true;Brightness=23;startReceiverCue();
  status.totalBytes=UINT32_MAX;status.writtenOffset=UINT32_MAX-1;clockMs=0;
  assert(renderLampUpdateCue()&&intensity(FastLED.visible[0])<48);
  status.writtenOffset=UINT32_MAX;clockMs=100;assert(renderLampUpdateCue());assert(same(FastLED.visible[0],expected.filled));
  checkFrameRestored();status.receiving=false;assert(!renderLampUpdateCue());
 }
 // Bad geometry never writes or displays a frame, even with receiver ownership.
 PowerOn=true;startReceiverCue();const auto validCalls=FastLED.calls;
 for(uint16_t invalid:{uint16_t(0),uint16_t(1025)}){NUM_LEDS=invalid;clockMs+=100;assert(renderLampUpdateCue());assert(FastLED.calls==validCalls);checkFrameRestored();}
 status.receiving=false;assert(!renderLampUpdateCue());
 std::cout<<"PASS production update cue: "<<geometries<<" calibrated geometries / "<<sampledPixels<<" progress pixel samples; "<<coloredGeometries<<" route-calibrated geometries / "<<coloredPixels<<" colored progress/invalid pixel samples across all five known routes and two unknown routes; bounded smoothly changing whole-lamp ambient, exact steady sharp route fill, one-pixel blend, monotonic confirmed-byte mask, power/brightness latch, sender-only inactivity, local frame restore, every count 1-1024 including odd counts, invalid progress, cadence/generation/rollover, no settings/group/catalog mutations\n";
}
'''
with tempfile.TemporaryDirectory(prefix='update-cue-',dir=ROOT/'.build') as folder:
    folder=Path(folder);(folder/'Arduino.h').write_text((ROOT/'tests/sync-stubs/Arduino.h').read_text().replace('inline uint32_t fakeNow=0;\ninline uint32_t millis(){return fakeNow;}',''))
    cpp=folder/'test.cpp';cpp.write_text(fixture+begin+'\n#include "LampUpdateCue.ino"\n'+test);binary=folder/'cue.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,'-I'+str(folder),'-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True)
    subprocess.run([str(binary)],check=True)
