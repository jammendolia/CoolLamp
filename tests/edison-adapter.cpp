#include <algorithm>
#include <array>
#include <cassert>
#include <cstring>
#include <iostream>
#include "LampControl.h"
#include "LampStyle.h"
#include "LampModel.h"
#include "LampAudio.h"
#include "LampEdisonEffects.h"
using std::max;
uint16_t NUM_LEDS=222,lampMidpoint=81;
uint8_t Brightness=137;
bool PowerOn=true;
constexpr uint8_t MODE_EDISON_SOUND_FILAMENT=52;
struct CRGB {
  uint8_t r=0,g=0,b=0;
  CRGB()=default;
  CRGB(uint8_t red,uint8_t green,uint8_t blue):r(red),g(green),b(blue){}
  static const CRGB Black;
};
const CRGB CRGB::Black{};
static std::array<CRGB,1026> storage;
CRGB* leds=storage.data()+1;
void fill_solid(CRGB* data,uint16_t count,CRGB color){std::fill(data,data+count,color);}
static LampPhysicalStyle style=LampPhysicalStyle::Edison;
LampPhysicalStyle getLampStyle(){return style;}
namespace LampModel {
static bool available=true;
static Record model;
bool factoryAvailable(){return available;}
const Record& current(){return model;}
}
static bool selectable=true;
bool lampEffectAvailable(uint8_t mode){return selectable&&mode>=48&&mode<=52&&lampEdisonProfileMatches();}
static LampColor color{1,20,200,80};
static LampEffectOptions options{50,100,0,240,12,180};
static LampAudioFeatures audio{};
static unsigned audioReads=0;
LampColor getLampColor(uint8_t){return color;}
LampEffectOptions getLampEffectOptions(uint8_t){return options;}
LampAudioFeatures getLampRenderAudio(){++audioReads;return audio;}
// Compile the actual adapter without rewriting/extracting its function bodies.
// No FastLED.show or Preferences definitions exist in this fixture: any new
// rendering/storage ownership violation becomes a compile/link failure.
#include "EdisonEffects.ino"

static bool same(CRGB a,CRGB b){return a.r==b.r&&a.g==b.g&&a.b==b.b;}
static const CRGB sentinel{13,17,19};
static void guardedRender(uint8_t mode,uint32_t clock){
  storage.fill(sentinel);
  const auto modelBefore=LampModel::model;
  const auto savedColor=color;
  const auto savedOptions=options;
  const auto savedCount=NUM_LEDS,savedMid=lampMidpoint;
  const auto savedBrightness=Brightness;
  const bool savedPower=PowerOn;
  renderEdisonEffect(mode,clock);
  assert(same(storage.front(),sentinel));
  for(unsigned index=NUM_LEDS+1;index<storage.size();++index)assert(same(storage[index],sentinel));
  assert(!std::memcmp(&modelBefore,&LampModel::model,sizeof(modelBefore)));
  assert(!std::memcmp(&savedColor,&color,sizeof(color))&&!std::memcmp(&savedOptions,&options,sizeof(options)));
  assert(NUM_LEDS==savedCount&&lampMidpoint==savedMid&&Brightness==savedBrightness&&PowerOn==savedPower);
}
static void compareExpected(uint8_t mode,uint32_t clock,LampEdison::Audio expected){
  const LampEdison::RGB primary{color.r,color.g,color.b};
  const auto secondary=options.dual?LampEdison::RGB{options.r,options.g,options.b}:primary;
  const auto frame=LampEdison::prepare(mode,clock,expected,primary,secondary);
  guardedRender(mode,clock);
  for(unsigned index=0;index<NUM_LEDS;++index){const auto value=LampEdison::pixel(frame,index,NUM_LEDS);assert(same(leds[index],CRGB(value.r,value.g,value.b)));}
}
int main(){
  std::strcpy(LampModel::model.id,"edison-v1");
  assert(lampEdisonProfileMatches());
  LampModel::available=false;assert(!lampEdisonProfileMatches());LampModel::available=true;
  for(const char* id:{"edison-v2","future-edison","helix-v1","","Edison-v1"}){std::strcpy(LampModel::model.id,id);assert(!lampEdisonProfileMatches());}
  std::strcpy(LampModel::model.id,"edison-v1");
  for(auto invalid:{LampPhysicalStyle::Unspecified,LampPhysicalStyle::Helix,LampPhysicalStyle::LargeHelix,LampPhysicalStyle::Corkscrew}){style=invalid;assert(!lampEdisonProfileMatches());}
  style=LampPhysicalStyle::Edison;
  for(uint16_t count:{uint16_t(1),uint16_t(221),uint16_t(223),uint16_t(1024)}){
    NUM_LEDS=count;assert(!lampEdisonProfileMatches());guardedRender(48,0);
    for(unsigned i=0;i<NUM_LEDS;++i)assert(same(leds[i],CRGB::Black));
  }
  NUM_LEDS=222;
  for(uint16_t center:{uint16_t(0),uint16_t(80),uint16_t(82),uint16_t(222)}){lampMidpoint=center;assert(!lampEdisonProfileMatches());}
  lampMidpoint=81;assert(lampEdisonProfileMatches());
  selectable=false;guardedRender(48,0);for(unsigned i=0;i<NUM_LEDS;++i)assert(same(leds[i],CRGB::Black));selectable=true;
  for(uint8_t mode=48;mode<=51;++mode){
    audioReads=0;compareExpected(mode,4096,{});assert(audioReads==0);
  }
  // The adapter uses supplied RGB colors, with a second color only when dual
  // is enabled. It leaves global brightness/intensity to the main render path.
  compareExpected(50,2048,{});const auto single=storage;
  options.dual=1;compareExpected(50,2048,{});
  bool changed=false;for(unsigned i=0;i<222;++i)changed|=!same(storage[i+1],single[i+1]);assert(changed);
  const auto baseline=storage;options.intensity=0;Brightness=1;PowerOn=false;guardedRender(50,2048);
  for(unsigned i=0;i<222;++i)assert(same(storage[i+1],baseline[i+1]));
  options.intensity=100;Brightness=137;PowerOn=true;
  // Concrete expected normalized values exercise UINT16_MAX without copying
  // the production normalization formula into the test.
  audio={};audio.valid=true;audio.level=200;audio.bass=65535;audio.mid=32767;audio.treble=0;
  audioReads=0;compareExpected(52,0,{200,99,0,200,true});assert(audioReads==1);
  audio.bass=audio.mid=audio.treble=65535;audio.level=255;
  compareExpected(52,0,{255,255,255,255,true});
  audio.bass=audio.mid=audio.treble=0;audio.level=200;
  compareExpected(52,0,{0,0,0,200,true});
  audio.bass=65535;audio.mid=32767;audio.treble=1;audio.valid=false;
  compareExpected(52,0,{});
  std::cout<<"PASS: actual Edison adapter profile/identity, guard pixels, colors, ownership and full-range audio normalization\n";
}
