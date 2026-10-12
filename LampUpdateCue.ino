#include "LampRuntimeMetrics.h"
bool renderLampUpdateCue(){
  const auto update=getLampUpdateStatus();
  static LampUpdateCue::Cadence cadence;
  const uint32_t now=millis();
  if(!update.receiving){cadence.due(false,0,now);return false;}
  if(!cadence.due(true,update.cueGeneration,now))return true;
  if(!leds||!originalFrame||!NUM_LEDS||NUM_LEDS>MAX_LED_COUNT)return true;
  // Reuse the existing frame scratch buffer and restore every RGB byte. The
  // captured power/brightness belong to admission, never a later state change.
  ::memcpy(originalFrame,leds,NUM_LEDS*sizeof(CRGB));
  const uint32_t elapsed=uint32_t(now-cadence.started);
  const auto ambient=LampUpdateCue::ambient(elapsed,update.cueGeneration);
  const auto filled=LampUpdateCue::color(update.route,48);
  for(uint16_t i=0;i<NUM_LEDS;++i){
    auto color=update.cueOn?ambient:LampUpdateCue::Color{0,0,0};
    if(update.cueOn){
      const uint8_t glow=LampUpdateCue::level(i,NUM_LEDS,lampMidpoint,elapsed,update.writtenOffset,update.totalBytes);
      if(glow==48)color=filled;
      else if(NUM_LEDS==1&&update.totalBytes&&update.writtenOffset<=update.totalBytes)
        color=LampUpdateCue::blend(ambient,filled,update.writtenOffset,update.totalBytes);
    }
    leds[i]=CRGB(color.r,color.g,color.b);
  }
  lampShowFrame(update.cueOn?min(uint8_t(40),update.cueBrightness):uint8_t(0),LampRuntimeMetrics::FrameKind::Update);
  ::memcpy(leds,originalFrame,NUM_LEDS*sizeof(CRGB));
  return true;
}
