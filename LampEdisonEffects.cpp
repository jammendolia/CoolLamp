#include "LampEdisonEffects.h"

namespace LampEdison {
namespace {
constexpr RGB black{0,0,0};
uint8_t triangle(uint8_t phase){return phase<128?uint8_t(phase*2):uint8_t((255-phase)*2);}
uint8_t limit(unsigned value){return value>255?255:uint8_t(value);}
RGB weighted(const RGB& a,const RGB& b,unsigned first,unsigned second){
  RGB result;
  auto* out=reinterpret_cast<uint8_t*>(&result);
  const auto* x=reinterpret_cast<const uint8_t*>(&a);const auto* y=reinterpret_cast<const uint8_t*>(&b);
  for(unsigned channel=0;channel<3;++channel)out[channel]=limit((unsigned(x[channel])*first+unsigned(y[channel])*second)/255);
  return result;
}
RGB scale(const RGB& color,uint8_t level){return weighted(color,black,level,0);}
RGB mix(const RGB& a,const RGB& b,uint8_t amount){return weighted(a,b,255-amount,amount);}
// Both physical loop ends are at the bottom; LED81 is the sole top anchor.
uint8_t loopHeight(uint16_t index){return index<=80?index-37:123-index;}
uint8_t distance(uint8_t a,uint8_t b){const uint8_t forward=a-b,backward=b-a;return forward<backward?forward:backward;}
uint8_t pulse(uint8_t at,uint8_t head,uint8_t width){const unsigned d=at>head?at-head:head-at;return d>=width?0:uint16_t(width-d)*255/width;}
}

Frame prepare(uint8_t effect,uint32_t clock,const Audio& audio,RGB primary,RGB secondary){
  Frame frame;
  frame.effect=effect;frame.phase=(clock>>5)&511;
  frame.breath=triangle(uint8_t(clock>>5));
  frame.primary=primary;frame.secondary=secondary;
  if(audio.valid)frame.audio=audio;
  // Palette interpolation and progress conversion happen once per frame.
  // Pixel traversal then uses the measured region's native LED distances.
  if(effect==48||effect==49||effect==52){
    frame.primary=mix(secondary,primary,220);
    frame.secondary=mix(secondary,primary,90);
  }
  if(effect==49){
    const auto p=frame.phase;
    frame.head=p<128?p*95/128:p<192?(p-128)*37/64:p<256?(p-192)*43/63:0;
  }
  if(effect==51){
    const uint8_t p=uint8_t(frame.phase);
    frame.head=p<96?p:p<224?uint16_t(p-96)*43/127:0;
    // Used only in the first96ticks; later values are deliberately irrelevant.
    frame.envelope=p<12?p:p>83?uint8_t(95-p):12;
  }
  return frame;
}

RGB pixel(const Frame& frame,uint16_t index,uint16_t count){
  if(count!=LedCount||index>=count||frame.effect<FirstEffect||frame.effect>LastEffect)return black;
  const bool stem=index<37,loop=index>=37&&index<124,coil=index>=127;
  const uint8_t phase=uint8_t(frame.phase);
  unsigned level=0;
  switch(frame.effect){
    case 48: // Filament: a warm bulb with a quiet, slow thermal breath.
      level=loop?210+frame.breath/8:coil?44+frame.breath/16:stem?24+frame.breath/32:18;
      break;
    case 49: { // Eureka: coils charge, stem rises, then the bulb blooms.
      const uint16_t p=frame.phase;
      if(p<128){
        level=coil?(221-index<=frame.head?8+p:4):loop?8:3;
      }else if(p<192){
        level=coil?100:stem?(index<=frame.head?190:5):loop?10:45;
      }else if(p<256){
        level=loop?(loopHeight(index)<=frame.head?230:14):coil?80:60;
      }else{
        level=loop?220+frame.breath/16:coil?55:24;
        if(p>=448)level=level*(512-p)/64;
      }
      break;
    }
    case 50: { // Orbit: two opposite soft trails stay within the bulb loop.
      if(!loop)return scale(frame.secondary,coil?12:5);
      const uint8_t position=uint16_t(index-37)*256/87;
      const uint8_t a=distance(position,phase),b=distance(position,uint8_t(255-phase));
      const uint8_t first=a<28?uint16_t(28-a)*240/28:0;
      const uint8_t second=b<28?uint16_t(28-b)*220/28:0;
      return weighted(frame.primary,frame.secondary,first,unsigned(second)+10);
    }
    case 51: { // Induction: coil energy releases a rising wave into the bulb.
      if(phase<96){
        level=coil?12+unsigned(pulse(221-index,frame.head,16))*frame.envelope/16:loop?10:8;
      }else if(phase<224){
        level=loop?14+unsigned(pulse(loopHeight(index),frame.head,8))*7/8:coil?22:28;
      }else level=loop?80*(256-phase)/32:12;
      break;
    }
    case 52: // Sound filament: bass in the coils, voice/highs in the bulb.
      level=coil?6+unsigned(frame.audio.bass)*3/4:loop?12+unsigned(frame.audio.mid)*3/4+frame.audio.treble/4:stem?5+frame.audio.level/8:4+frame.audio.level/8;
      break;
  }
  return scale(loop?frame.primary:frame.secondary,limit(level));
}
}
