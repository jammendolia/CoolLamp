#pragma once
#include <stdint.h>
#include "LampGeometry.h"
#include "LampUpdate.h"
namespace LampUpdateCue {
constexpr uint32_t FrameMs=100;
struct Color { uint8_t r,g,b; };
inline Color color(uint8_t route,uint8_t level){
 // Keep comparable, subdued channel levels across routes. The renderer's
 // existing admission brightness/current cap still governs physical output.
 const uint8_t soft=uint16_t(level)*3/5,medium=uint16_t(level)*4/5;
 switch(route){
  case UPDATE_ROUTE_BLUETOOTH:return {soft,medium,level};
  case UPDATE_ROUTE_INTERNET:return {soft,level,soft};
  case UPDATE_ROUTE_DONATION:return {level,medium,soft};
  case UPDATE_ROUTE_MANUAL_UPLOAD:return {medium,soft,level};
  default:return {level,level,level}; // Unknown source stays neutral; never guess a route.
 }
}
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
 const uint8_t ambient=12+wave*6/20;
 if(!total||!written||written>total)return ambient; // Ambient only; no invented percentage.
 constexpr uint8_t filled=48;
 // A single pixel cannot show height. Blend its ambient brightness toward the
 // solid completed level using the same confirmed byte fraction instead.
 if(count==1)return ambient+uint64_t(written)*(filled-ambient)/total;
 const uint16_t centered=lampCenteredPosition(index,count,midpoint);
 const uint32_t height=centered<=32767?uint32_t(centered)*2:uint32_t(65535-centered)*2;
 const uint32_t progress=uint64_t(written)*65535/total;
 // Preserve the calibrated folded-strip height: both base ends fill toward
 // the physical top. Filled pixels remain steady; the rest breathe gently.
 return height<=progress?filled:ambient;
}
}
bool renderLampUpdateCue(); // Main-loop-only overlay; no catalog entry or group frame.
