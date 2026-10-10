#pragma once
#include <stdint.h>
// Runtime elapsed time alone can include a stalled setup/loop. Require an
// uninterrupted responsive-loop interval before the SDK image is confirmed.
class LampUpdateHealth {
 uint32_t started_=0,last_=0;
 uint16_t passes_=0;
 bool initialized_=false;
 public:
 static constexpr uint32_t RequiredMs=30000,MaximumGapMs=1000;
 static constexpr uint16_t RequiredPasses=128;
 void begin(uint32_t now){started_=last_=now;passes_=0;initialized_=true;}
 bool observe(uint32_t now){
  if(!initialized_){begin(now);return false;}
  if(uint32_t(now-last_)>MaximumGapMs){started_=now;passes_=0;}
  last_=now;if(passes_<UINT16_MAX)++passes_;
  return uint32_t(now-started_)>=RequiredMs&&passes_>=RequiredPasses;
 }
};
