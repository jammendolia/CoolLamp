#include <algorithm>
#include "../LampGeometry.h"
uint16_t lampMidpoint=0;
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <vector>
#include "../LampControl.h"
using std::min;
bool microphone=false;
uint8_t lampAvailableEffectCount(){return microphone?LAMP_EFFECT_COUNT:LAMP_BASE_EFFECT_COUNT;}
LampControlState control{3,100,true};
LampControlState getLampControlState(){return control;}
#include "../LampColors.ino"
#include "../LampVu.cpp"
// Host RGB and sine stand-ins exercise the actual effect loops and arithmetic.
// Hardware compilation separately validates the real FastLED API.
struct CRGB {
  uint8_t r=0,g=0,b=0;
  CRGB()=default;
  CRGB(uint8_t r,uint8_t g,uint8_t b):r(r),g(g),b(b){}
  void nscale8(uint8_t n){r=unsigned(r)*n/255;g=unsigned(g)*n/255;b=unsigned(b)*n/255;}
  CRGB& operator+=(CRGB c){r=min(255,int(r)+c.r);g=min(255,int(g)+c.g);b=min(255,int(b)+c.b);return *this;}
  bool operator==(CRGB c)const{return r==c.r&&g==c.g&&b==c.b;}
  static const CRGB Black;
};
const CRGB CRGB::Black{};
CRGB blend(CRGB a,CRGB b,uint8_t n){return {uint8_t((a.r*(255-n)+b.r*n)/255),uint8_t((a.g*(255-n)+b.g*n)/255),uint8_t((a.b*(255-n)+b.b*n)/255)};}
void fill_solid(CRGB* p,int count,CRGB c){std::fill(p,p+count,c);}
uint8_t sin8(uint8_t x){return std::lround(127.5+127.5*std::sin(x*6.28318530718/256));}
uint32_t effectClockMs=0;
uint32_t millis(){return 0;}
uint16_t beat16(uint16_t,uint32_t){return 0;}
uint8_t beat8(uint16_t,uint32_t){return 0;}
uint16_t beatsin16(uint16_t,uint16_t,uint16_t,uint32_t,uint16_t){return 0;}
uint8_t beatsin8(uint16_t,uint8_t,uint8_t,uint32_t,uint8_t){return 0;}
uint16_t beatsin88(uint16_t,uint16_t,uint16_t,uint32_t,uint16_t){return 0;}
int NUM_LEDS=134;CRGB* leds=nullptr;
enum {MODE_DROPLETS=30,MODE_LIGHTNING,MODE_TIDE,MODE_FIREFLIES,MODE_HEARTBEAT,MODE_STARS,MODE_BREATHING,MODE_BLOBS,MODE_DROPLETS_OUTWARD,MODE_SOUND_GLOW,MODE_SOUND_METER,MODE_SPECTRUM_RISE,MODE_BASS_LAUNCH,MODE_SPECTRAL_EMBERS,MODE_BEAT_BLOOM,MODE_BAND_FOUNTAIN,MODE_VU_METER};
#include "../NewEffects.ino"
#include "../AudioAnalysis.h"
struct AudioSnapshot { bool valid=true; uint8_t level=0; uint16_t bass=0,mid=0,treble=0; uint32_t beat=0,bassBeat=0; } audioSnapshot;
AudioSnapshot getLampAudioFeatures(){return audioSnapshot;}
#include "../AudioEffects.ino"
int main(){
  // Migrate the original 29-color blob without losing black or per-mode slots.
  auto& old=Preferences::storage["colors"];old.resize(117);old[0]=1;
  for(int i=0;i<29;++i){old[1+i*4]=1;old[2+i*4]=i;old[3+i*4]=i+1;old[4+i*4]=i+2;}
  loadLampColors();assert(getLampColor(3).r==2);assert(getLampColor(29).r==28);
  assert(getLampColor(37).enabled==1);assert(getLampEffectOptions(31).intensity==35);
  assert(setLampColor(30,0,0,0));assert(setLampEffectOptions(30,{1,0,1,0,255,0}));
  assert(!setLampEffectOptions(39,{50,100,0,1,2,3}));assert(!setLampEffectOptions(30,{0,100,0,1,2,3}));
  Preferences::failWrites=true;assert(!saveLampColors());Preferences::failWrites=false;assert(saveLampColors());
  assert(Preferences::storage["colors"].size()==153);assert(Preferences::storage["effectOptions"].size()==229);
  setLampColor(30,255,255,255);setLampEffectOptions(30,{50,100,0,1,2,3});loadLampColors();
  assert(getLampColor(30).r==0);assert(getLampEffectOptions(30).speed==1);assert(getLampEffectOptions(30).g==255);
  // Upgrade the 37-effect release without resetting existing colors/options.
  Preferences::storage["colors"].resize(149);
  Preferences::storage["effectOptions"].resize(223);
  setLampColor(38,1,2,3);setLampEffectOptions(38,{3,4,0,5,6,7});
  loadLampColors();
  assert(getLampColor(30).r==0 && getLampEffectOptions(30).speed==1);
  assert(getLampEffectOptions(30).g==255);
  assert(getLampColor(38).r==255 && getLampEffectOptions(38).speed==50);
  assert(saveLampColors());
  assert(Preferences::storage["colors"].size()==153);
  assert(Preferences::storage["effectOptions"].size()==229);
  assert(getLampColor(3).r==2);resetLampColor(30);assert(getLampEffectOptions(30).speed==50);
  // The current 38-effect payload remains readable and keeps its byte layout.
  setLampColor(38,11,22,33);assert(saveLampColors());loadLampColors();
  assert(getLampColor(38).r==11);
  microphone=true;
  assert(setLampColor(39,17,18,19));assert(setLampEffectOptions(40,{75,80,1,20,21,22}));
  assert(saveLampColors());loadLampColors();
  assert(getLampColor(39).r==17 && getLampEffectOptions(40).speed==75);
  assert(Preferences::storage["colors"].size()==153 && Preferences::storage["effectOptions"].size()==229);
  // Upgrade the two-effect audio blob without losing its custom settings.
  Preferences::storage["audioEffectsV1"].resize(21);
  loadLampColors();assert(getLampColor(39).r==17 && getLampEffectOptions(40).speed==75);
  assert(!getLampColor(41).enabled);
  assert(setLampColor(45,1,2,3));assert(saveLampColors());loadLampColors();
  assert(getLampColor(45).r==1 && Preferences::storage["audioEffectsV1"].size()==81);
  Preferences::storage["audioEffectsV1"].resize(71);
  loadLampColors();assert(getLampColor(45).r==1 && getLampEffectOptions(40).speed==75);
  assert(setLampColor(46,2,3,4));assert(saveLampColors() && Preferences::storage["audioEffectsV1"].size()==81);
  microphone=false;
  assert(!setLampColor(39,1,2,3) && !setLampEffectOptions(40,{50,100,0,1,2,3}));
  control.mode=37;uint8_t packet[8];getLampEffectPacket(packet);assert(packet[0]==1&&packet[1]==37&&packet[2]==50);
  microphone=true;
  for(int count:{1,2,3,133,134,135,1024}) for(uint16_t midpoint:{0,1,40,1000}) {
    lampMidpoint=midpoint;
    NUM_LEDS=count;std::vector<CRGB> frame(count+2);leds=frame.data()+1;
    const CRGB guard(13,27,39);frame.front()=frame.back()=guard;
    for(uint8_t mode:{39,40}) for(uint8_t speed:{1,50,100}) {
      setLampColor(mode,255,255,255);setLampEffectOptions(mode,{speed,100,0,0,0,0});
      audioSnapshot={true,255};
      for(uint32_t t=1000;t<2000;t+=16)renderAudioEffect(mode,t);
      assert(leds[0].r>240 && leds[count-1].r>240);
      audioSnapshot={false,255};
      for(uint32_t t=2000;t<6000;t+=16)renderAudioEffect(mode,t);
      for(int i=0;i<count;++i)assert(leds[i]==CRGB::Black);
      assert(frame.front()==guard && frame.back()==guard);
    }
  }
  for(int count:{1,2,3,133,134,135,1024}) for(uint16_t midpoint:{0,1,40,1000}) {
    lampMidpoint=midpoint;
    NUM_LEDS=count;std::vector<CRGB> frame(count+2);leds=frame.data()+1;
    const CRGB guard(13,27,39);frame.front()=frame.back()=guard;
    if(count>=133 && !lampMidpoint) {
      setLampColor(38,255,0,0);setLampEffectOptions(38,{50,25,1,0,0,255});
      auto peak=[&](bool blue){
        int best=0;
        for(int i=1;i<count;++i) {
          if((blue?leds[i].b:leds[i].r)>(blue?leds[best].b:leds[best].r))best=i;
        }
        return best;
      };
      renderNewEffect(38,0);assert(leds[count/2].r==255 && leds[0].r==0 && leds[count-1].r==0);
      renderNewEffect(38,2800);assert(peak(false)==0);
      renderNewEffect(38,6200-1103);assert(leds[count/2].b==255 && leds[0].b==0 && leds[count-1].b==0);
      renderNewEffect(38,6200-1103+2800);assert(leds[count-1].b==255 && peak(true)>count*9/10);
      // The original still starts at the left end and travels inward.
      setLampColor(30,255,0,0);setLampEffectOptions(30,{50,25,1,0,0,255});
      renderNewEffect(30,0);assert(peak(false)==0);
      renderNewEffect(30,2800);assert(leds[count/2].r==255 && leds[0].r==0 && leds[count-1].r==0);
    }
    if(count==134 && lampMidpoint==40) {
      setLampColor(38,255,0,0);setLampEffectOptions(38,{50,0,0,0,0,0});
      renderNewEffect(38,0);
      assert(leds[39].r>leds[66].r && leds[40].r>leds[67].r);
      renderNewEffect(38,2800);assert(leds[0].r==255);
      setLampColor(34,255,0,0);setLampEffectOptions(34,{50,100,0,0,0,0});
      renderNewEffect(34,0);
      assert(leds[39].r>leds[66].r && leds[40].r>leds[67].r);
    }
    for(int mode=30;mode<=38;++mode){
      resetLampColor(mode);setLampColor(mode,255,0,0);setLampEffectOptions(mode,{100,100,1,0,0,255});
      bool lit=false,changed=false;std::vector<CRGB> first;
      for(uint32_t t=0;t<24000;t+=137){
        renderNewEffect(mode,t);
        assert(frame.front()==guard&&frame.back()==guard);
        for(int i=0;i<count;++i)lit|=leds[i].r||leds[i].g||leds[i].b;
        if(first.empty())first.assign(leds,leds+count);else changed|=!std::equal(first.begin(),first.end(),leds);
      }
      if(!lit||!changed)std::cerr<<"Animation missing: count="<<count<<" mode="<<mode<<" lit="<<lit<<" changed="<<changed<<"\n";
      assert(lit&&changed);
      for(uint32_t t:{0xffffff00U,0xffffffffU,0U,1U})renderNewEffect(mode,t);
      assert(frame.front()==guard&&frame.back()==guard);
      setLampColor(mode,0,0,0);setLampEffectOptions(mode,{50,100,0,255,0,0});renderNewEffect(mode,1234);
      for(int i=0;i<count;++i)assert(leds[i]==CRGB::Black);
    }
  }
  for(int count:{1,2,3,134,1024}) for(uint16_t midpoint:{0,1,40,1000}) {
    NUM_LEDS=count;lampMidpoint=midpoint;std::vector<CRGB> frame(count+2);leds=frame.data()+1;
    const CRGB guard(13,27,39);frame.front()=frame.back()=guard;
    for(uint8_t mode=41;mode<=46;++mode) {
      resetLampColor(mode);bool lit=false;
      for(uint32_t t=1000;t<5000;t+=16) {
        audioSnapshot={true,200,100,60,30,t/400,t/500};renderAudioEffect(mode,t);
        for(int i=0;i<count;++i)lit|=leds[i].r||leds[i].g||leds[i].b;
        assert(frame.front()==guard && frame.back()==guard);
      }
      assert(lit);
      audioSnapshot={false,0};
      for(uint32_t t=5000;t<9000;t+=16)renderAudioEffect(mode,t);
      for(int i=0;i<count;++i)assert(leds[i]==CRGB::Black);
      for(uint32_t t:{0xfffffff0U,0U,80U})renderAudioEffect(mode,t);
      assert(frame.front()==guard && frame.back()==guard);
    }
  }
  NUM_LEDS=134;lampMidpoint=40;std::vector<CRGB> spectrumFrame(NUM_LEDS);leds=spectrumFrame.data();
  resetLampColor(41);
  for(uint32_t t=1000;t<2000;t+=16){audioSnapshot={true,200,10000,0,0,0,0};renderAudioEffect(41,t);}
  assert(leds[0].r>leds[0].b);
  for(uint32_t t=2000;t<3000;t+=16){audioSnapshot={true,200,0,0,10000,0,0};renderAudioEffect(41,t);}
  assert(leds[0].b>leds[0].r);
  setLampColor(41,0,0,0);setLampEffectOptions(41,{50,100,0,0,0,0});
  renderAudioEffect(41,3016);for(int i=0;i<NUM_LEDS;++i)assert(leds[i]==CRGB::Black);
  NUM_LEDS=202;lampMidpoint=101;std::vector<CRGB> vuFrame(NUM_LEDS);leds=vuFrame.data();
  resetLampColor(46);setLampEffectOptions(46,{100,100,0,0,0,0});
  audioSnapshot={true,255};
  for(uint32_t t=10000;t<11000;t+=16)renderAudioEffect(46,t);
  assert(leds[64]==CRGB(0,255,0) && leds[65]==CRGB(255,255,0));
  assert(leds[79]==CRGB(255,255,0) && leds[80]==CRGB(255,0,0) && leds[100]==CRGB(255,0,0));
  for(int i=0;i<101;++i)assert(leds[i]==leds[201-i]);
  // Switching from a bright audio effect must not carry its visual height into VU.
  audioSnapshot={true,255};renderAudioEffect(39,11016);
  audioSnapshot={true,128};
  for(uint32_t t=11032;t<311032;t+=16) {
    renderAudioEffect(46,t);
    assert(leds[60]==CRGB::Black && leds[100]==CRGB::Black);
  }
  audioSnapshot={true,255};for(uint32_t t=10000;t<11000;t+=16)renderAudioEffect(46,t);
  const VuColor custom[3]={{10,20,30},{40,50,60},{70,80,90}};
  Preferences::failWrites=true;assert(!saveLampVuColors(custom));assert(lampVuColors[0].g==255);
  Preferences::failWrites=false;assert(saveLampVuColors(custom));lampVuColors[0]={};loadLampVuColors();assert(lampVuColors[0].g==20);
  renderAudioEffect(46,11000);assert(leds[0]==CRGB(10,20,30) && leds[80]==CRGB(70,80,90));
  audioSnapshot={true,128};for(uint32_t t=11016;t<12000;t+=16)renderAudioEffect(46,t);
  assert(leds[0]==CRGB(10,20,30) && leds[60]==CRGB::Black && leds[100]==CRGB::Black);
  std::cout<<"PASS: legacy color migration, option persistence/retry, packet bounds, nine animated effects, black colors, 1/2/odd/1024 LEDs and clock wrap.\n";
}
