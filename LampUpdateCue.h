#pragma once
#include <stdint.h>
#include "LampGeometry.h"
namespace LampUpdateCue {
constexpr uint32_t FrameMs=100;
struct Cadence {
 uint32_t generation=0,started=0,last=0;
 bool initialized=false;
 bool due(bool receiver,uint32_t nextGeneration,uint32_t now){
  if(!receiver){initialized=false;return false;}
  if(!initialized||generation!=nextGeneration){initialized=true;generation=nextGeneration;started=last=now;return true;}
  if(uint32_t(now-last)<FrameMs)return false;
  last=now;return true;
 }
};
inline uint8_t level(uint16_t index,uint16_t count,uint16_t midpoint,uint32_t elapsed,uint32_t written,uint32_t total){
 if(!count||count>1024||index>=count)return 0;
 const uint32_t tick=(elapsed/FrameMs)%40,wave=tick<=20?tick:40-tick;
 if(!total||!written||written>total)return 12+wave*6/20; // Indeterminate; no invented percentage.
 const uint8_t glow=32+wave*16/20;
 if(count==1)return uint64_t(written)*glow/total;
 const uint16_t centered=lampCenteredPosition(index,count,midpoint);
 const uint32_t height=centered<=32767?uint32_t(centered)*2:uint32_t(65535-centered)*2;
 const uint32_t progress=uint64_t(written)*65535/total;
 if(height<=progress)return glow;
 const uint32_t delta=height-progress;return delta<4096?uint32_t(glow)*(4096-delta)/4096:0;
}
}
bool renderLampUpdateCue(); // Main-loop-only overlay; no catalog entry or group frame.
