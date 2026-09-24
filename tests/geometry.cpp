#include <cassert>
#include <algorithm>
#include <iostream>
#include <vector>
#include "../LampGeometry.cpp"
using std::min;
struct CRGB {
  uint8_t r=0,g=0,b=0;
  CRGB()=default;
  CRGB(uint8_t r,uint8_t g,uint8_t b):r(r),g(g),b(b){}
  CRGB& operator+=(CRGB c){r=min(255,int(r)+c.r);g=min(255,int(g)+c.g);b=min(255,int(b)+c.b);return *this;}
  bool operator==(CRGB c)const{return r==c.r&&g==c.g&&b==c.b;}
};
CRGB CHSV(uint8_t,uint8_t,uint8_t v){return {v,v,v};}
CRGB HeatColor(uint8_t heat){return {heat,heat,heat};}
uint8_t qadd8(uint8_t a,uint8_t b){return min(255,int(a)+b);}
uint8_t qsub8(uint8_t a,uint8_t b){return a>b?a-b:0;}
uint8_t random8(){return 0;}
uint8_t random8(int limit){assert(limit>0);return 0;}
uint8_t random8(int low,int high){assert(low<high);return low;}
uint8_t scale8(uint8_t a,uint8_t b){return uint16_t(a)*b/255;}
uint8_t sin8(uint8_t x){return x;}
uint8_t inoise8(uint16_t x,uint16_t y){return (x+y)%256;}
uint32_t lampEffectMillis(){return 1000;}
uint16_t lampBeatSin16(uint16_t,uint16_t,uint16_t high){return high;}
uint16_t NUM_LEDS=134;
CRGB* leds;
uint8_t* splitHeat;
#include "../FireSplit.ino"
#include "../Atmosphere.ino"
int main(){
  loadLampGeometry();assert(lampMidpoint==0);
  assert(saveLampGeometry(40,134));lampMidpoint=0;loadLampGeometry();assert(lampMidpoint==40);
  Preferences::failWrites=true;assert(!saveLampGeometry(60,134));assert(lampMidpoint==40);Preferences::failWrites=false;
  assert(!saveLampGeometry(134,134));assert(!saveLampGeometry(1,1));assert(!saveLampGeometry(0,0));
  assert(saveLampGeometry(0,1));loadLampGeometry();assert(lampMidpoint==0);
  Preferences::storage["geometryV1"]={1,255,255};loadLampGeometry();assert(lampMidpoint==0);
  for(uint16_t count=1;count<=1024;++count) {
    NUM_LEDS=count;
    for(uint16_t center:{uint16_t(0),uint16_t(1),uint16_t(count/3),uint16_t(count-1),uint16_t(1023)}) {
      lampMidpoint=center;
      const auto split=lampSplitCount(count,center);
      assert(split>=1 && split<=count);if(count>1)assert(split<count);
      std::vector<CRGB> frame(count+2);leds=frame.data()+1;
      std::vector<uint8_t> heat(count+2,0);splitHeat=heat.data()+1;
      frame.front()=frame.back()={13,27,39};heat.front()=heat.back()=123;
      uint16_t previous=0;
      for(uint16_t i=0;i<count;++i) {
        auto x=lampCenteredPosition(i,count,center);assert(x>=previous);previous=x;
        if(!center)assert(x==(count>1?uint32_t(i)*65535/(count-1):32768));
        if(center && count>1)assert((i<split)==(x<32768));
      }
      if(count>1){assert(lampCenteredPosition(0,count,center)==0);assert(previous==65535);}
      for(bool reverse:{false,true})for(bool colors:{false,true})FireSplit(reverse,colors,0);
      Rain();CometCollision();
      assert(frame.front()==CRGB(13,27,39) && frame.back()==CRGB(13,27,39));
      assert(heat.front()==123 && heat.back()==123);
    }
  }
  // With a 40/94 split, full collision must peak next to that boundary.
  NUM_LEDS=134;lampMidpoint=40;std::vector<CRGB> frame(NUM_LEDS);leds=frame.data();CometCollision();
  assert(leds[39].r>leds[66].r && leds[40].r>leds[67].r);
  std::cout<<"PASS: geometry persistence, invalid settings, exact automatic mapping, asymmetric split/rain/collision bounds for lengths 1–1024\n";
}
