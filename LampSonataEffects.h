#pragma once
#include <stdint.h>
#include "LampEffectFrame.h"

// Sonata is one continuous strip, beginning at the lower inner curl and ending
// at the upper inner curl. No LED count, equal-sized curls or split is inferred.
namespace LampSonata {
constexpr uint8_t FirstEffect=53, LastEffect=55;
constexpr bool effect(uint8_t mode){return mode>=FirstEffect&&mode<=LastEffect;}

inline uint16_t triangle(uint16_t phase){
  return phase<32768?uint16_t(uint32_t(phase)*2):uint16_t(uint32_t(65535-phase)*2);
}

// Prepare at most three accents once, then use the shared glow renderer.
// Binary clock periods divide 2^32, including across animation-clock rollover.
// Brightness, intensity, tempo, power limiting and output stay in the normal
// pipeline. Pixel is the existing native RGB type; no extra framebuffer exists.
template<class Pixel>
LampEffectFrame::Glows<Pixel,3> prepare(uint8_t mode,uint32_t clock,Pixel primary,Pixel secondary){
  LampEffectFrame::Glows<Pixel,3> frame;
  frame.background=Pixel(0,0,0);
  if(!effect(mode))return frame;
  frame.background=secondary;
  frame.background.nscale8(4);
  if(mode==53){ // Aria: a soft pearl and a quieter wake follow the entire S.
    const uint16_t phase=uint16_t(clock<<2),head=triangle(phase);
    const uint16_t wake=phase<32768?(head>6000?head-6000:0):(head<59535?head+6000:65535);
    frame.add(wake,21000,secondary,68);
    frame.add(head,11000,primary,215);
  }else if(mode==54){ // Duet: two voices pass and return along the same path.
    const uint16_t head=triangle(uint16_t(clock<<3));
    frame.add(head,10000,primary,225);
    frame.add(65535-head,10000,secondary,215);
  }else{ // Cadenza: three staggered notes travel from lower curl to upper curl.
    for(uint8_t note=0;note<3;++note){
      const uint16_t phase=uint16_t((clock<<3)+uint32_t(note)*16384);
      frame.add(phase,6500,note==1?secondary:primary,uint8_t(triangle(phase)>>8));
    }
  }
  return frame;
}
} // namespace LampSonata
