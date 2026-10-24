#include "LampEdisonEffects.h"
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <iostream>
#include <vector>
using namespace LampEdison;
static unsigned brightness(RGB pixel){return unsigned(pixel.r)+pixel.g+pixel.b;}
static bool same(RGB a,RGB b){return a.r==b.r&&a.g==b.g&&a.b==b.b;}
static unsigned region(uint8_t effect,uint32_t clock,unsigned first,unsigned last,Audio audio={}){
  const auto frame=prepare(effect,clock,audio);unsigned value=0;
  for(unsigned i=first;i<=last;++i)value+=brightness(pixel(frame,i,LedCount));
  return value;
}
int main(){
  assert(matchingGeometry(222,81));
  for(unsigned count=0;count<=1025;++count){
    if(count!=222)assert(!matchingGeometry(count,81));
    for(uint8_t effect=48;effect<=52;++effect){
      const auto f=prepare(effect,UINT32_MAX);
      if(count!=222)for(unsigned index:{0u,36u,37u,80u,123u,124u,127u,221u,1024u,65535u})assert(brightness(pixel(f,index,count))==0);
      assert(brightness(pixel(f,count,count))==0);
    }
  }
  assert(!matchingGeometry(222,0)&&!matchingGeometry(222,80)&&!matchingGeometry(222,82)&&!matchingGeometry(222,222));
  for(unsigned effect:{0u,1u,47u,53u,255u})for(unsigned index=0;index<222;++index)assert(brightness(pixel(prepare(effect,0),index,222))==0);
  // Black user colors really produce black; the renderer never invents a palette.
  for(uint8_t effect=48;effect<=52;++effect)for(unsigned index=0;index<222;++index)assert(brightness(pixel(prepare(effect,12345,Audio{255,255,255,255,true},{0,0,0},{0,0,0}),index,222))==0);
  // All effects are deterministic and rollover continuous without retained state.
  // The byte clock repeats at a power-of-two period and needs no late catch-up.
  for(uint8_t effect=48;effect<=52;++effect){
    for(uint32_t now:{0u,1u,4095u,4096u,6144u,8192u,16383u,16384u,UINT32_MAX}){
      const auto a=prepare(effect,now),b=prepare(effect,now+16384u);
      for(unsigned index=0;index<222;++index)assert(same(pixel(a,index,222),pixel(b,index,222)));
    }
    const auto before=prepare(effect,UINT32_MAX),after=prepare(effect,0);
    for(unsigned index=0;index<222;++index){
      const auto a=pixel(before,index,222),b=pixel(after,index,222);
      assert(std::abs(int(a.r)-b.r)<15&&std::abs(int(a.g)-b.g)<15&&std::abs(int(a.b)-b.b)<15);
    }
  }
  // Filament fills the complete bulb, keeps coils quieter, and breathes gently.
  assert(region(48,0,37,123)>region(48,0,127,221));
  assert(region(48,4096,37,123)>region(48,0,37,123));
  for(unsigned i=0;i<222;++i)assert(brightness(pixel(prepare(48,0),i,222))>0);
  // Eureka visibly charges coils before the upright and bulb. At the final
  // bloom frame LED81 (zero-based80) is included, including the odd loop split.
  assert(region(49,3500,127,221)>region(49,0,127,221));
  assert(region(49,5500,0,36)>region(49,3500,0,36));
  assert(region(49,8160,37,123)>region(49,5500,37,123));
  assert(brightness(pixel(prepare(49,8160),80,222))>200);
  // Orbit moves while all pixels outside the loop stay at their quiet baseline.
  bool moved=false;
  for(unsigned i=0;i<222;++i){
    const auto a=pixel(prepare(50,0),i,222),b=pixel(prepare(50,2048),i,222);
    if(i>=37&&i<=123)moved|=!same(a,b);else assert(same(a,b));
  }
  assert(moved);
  // Induction reaches the exact top anchor near the end of its rise, rather
  // than treating the entire222-pixelstrip as a symmetric circle.
  const auto wave=prepare(51,223u*32);
  assert(brightness(pixel(wave,80,222))>brightness(pixel(wave,37,222)));
  assert(brightness(pixel(wave,80,222))>brightness(pixel(wave,123,222)));
  // Invalid/stale audio contributes no level. Bass and mid/high channels own
  // different regions; full-range values never overflow into a dark output.
  Audio stale{255,255,255,255,false};
  for(unsigned i=0;i<222;++i)assert(same(pixel(prepare(52,0,stale),i,222),pixel(prepare(52,0),i,222)));
  const Audio bass{255,0,0,0,true},voice{0,255,255,0,true};
  assert(region(52,0,127,221,bass)>region(52,0,127,221));
  assert(region(52,0,37,123,bass)==region(52,0,37,123));
  assert(region(52,0,127,221,voice)==region(52,0,127,221));
  assert(region(52,0,37,123,voice)>region(52,0,37,123));
  std::cout<<"Edison production renderers: bounds, regions, colors, progression, rollover and audio passed\n";
}
