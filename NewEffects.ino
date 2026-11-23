#include "LampEffectFrame.h"
#include "LampEffectPackageBuild.h"

// Animation time is independent of networking, button holds and update timers.
uint32_t lampEffectMillis() { return effectClockMs; }
uint16_t lampBeat16(uint16_t bpm, uint32_t base) { return beat16(bpm, millis()-effectClockMs+base); }
uint8_t lampBeat8(uint16_t bpm, uint32_t base) { return beat8(bpm, millis()-effectClockMs+base); }
uint16_t lampBeatSin16(uint16_t bpm, uint16_t low, uint16_t high, uint32_t base, uint16_t phase) { return beatsin16(bpm,low,high,millis()-effectClockMs+base,phase); }
uint8_t lampBeatSin8(uint16_t bpm, uint8_t low, uint8_t high, uint32_t base, uint8_t phase) { return beatsin8(bpm,low,high,millis()-effectClockMs+base,phase); }
uint16_t lampBeatSin88(uint16_t bpm, uint16_t low, uint16_t high, uint32_t base, uint16_t phase) { return beatsin88(bpm,low,high,millis()-effectClockMs+base,phase); }

uint32_t effectHash(uint32_t x) { x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; return x ^ (x >> 16); }
void effectGlowAt(uint16_t position, uint16_t width, CRGB color, uint8_t strength, bool centered) {
  for (int i=0;i<NUM_LEDS;++i) {
    const int32_t x = centered ? lampMotionPosition(i, NUM_LEDS, lampMidpoint) : lampCenteredPosition(i, NUM_LEDS, 0);
    const uint32_t distance = abs(x-int32_t(position));
    if (distance >= width) continue;
    CRGB pixel = color; pixel.nscale8(uint32_t(strength)*(width-distance)/width); leds[i] += pixel;
  }
}
void effectGlow(uint16_t position, uint16_t width, CRGB color, uint8_t strength) {
  effectGlowAt(position, width, color, strength, false);
}
void renderSpatialEffect(uint8_t mode, const LampEffectFrame::Context& context) {
  const uint32_t t=context.clock;
  const auto c=getLampColor(mode); const auto o=getLampEffectOptions(mode);
  const CRGB a(c.r,c.g,c.b), b=o.dual ? CRGB(o.r,o.g,o.b) : a;
  // Stars can activate two emitters across uint32 rollover, at most 18 tails.
  // Other recipes peak at 14 glows. Keep exact scaling and contribution order.
  LampEffectFrame::Glows<CRGB,18> frame;
  frame.background=CRGB::Black;
  switch(mode) {
    case MODE_DROPLETS:
    case MODE_DROPLETS_OUTWARD: {
      frame.space=LampEffectFrame::Space::Motion;
      const unsigned count=1+o.intensity/25;
      for(unsigned k=0;k<count;++k) {
        const uint32_t phase=(t+k*1103)%6200;
        uint32_t travel;
        if(phase<2800) travel=uint64_t(phase)*phase*32767/(2800UL*2800);
        else { const uint32_t age=phase-2800; travel=32767-uint32_t(sin8(age*256/850+192))*uint32_t(3400-age)*8/255; }
        travel=min(travel,uint32_t(32767));
        // Keep the calibrated split bounce; whole strip traverses both endpoints.
        const uint32_t distance=mode==MODE_DROPLETS_OUTWARD ? 32767-travel : travel;
        const uint16_t position=context.motionPath==1?
          (mode==MODE_DROPLETS_OUTWARD?65535-uint32_t(travel)*65535/32767:uint32_t(travel)*65535/32767):
          (k%2?65535-distance:distance);
        frame.add(position,4500,k%2?b:a,255);
        frame.add(position,10000,k%2?b:a,55);
      } break;
    }
    case MODE_LIGHTNING: {
      frame.background=b; frame.background.nscale8(8);
      // One soft-edged strike per 6–10 seconds at normal speed; no rapid full-strip strobe.
      const uint32_t period=10000-o.intensity*40, phase=t%period, seed=effectHash(t/period);
      if(phase<650) {
        const uint8_t pulse=sin8(phase*256/650+192);
        for(unsigned k=0;k<5;++k) frame.add(effectHash(seed+k)%65536,2500+effectHash(seed+k+9)%6000,a,pulse);
      } break;
    }
#if !COOLLAMP_EFFECT_PACK_REPLACE_NATIVE
    case MODE_TIDE: {
      const uint8_t wave=sin8(t/35);
      const uint16_t reach=19000+uint32_t(wave)*180;
      frame.add(0,reach,a,120+wave/2); frame.add(65535,reach,b,247-wave/2);
      break;
    }
#endif
    case MODE_FIREFLIES: {
      const unsigned count=3+o.intensity/9;
      for(unsigned k=0;k<count;++k) {
        const uint32_t seed=effectHash(k+31), period=3800+seed%5000;
        const uint8_t wave=sin8(uint64_t(t%period)*256/period+(seed>>24));
        const uint8_t glow=uint16_t(wave)*wave/255;
        const uint16_t position=(seed%58000)+uint32_t(sin8(t/90+k*39))*29;
        frame.add(position,2200+(seed%2500),k%2?b:a,glow);
      } break;
    }
    case MODE_HEARTBEAT: {
      frame.space=LampEffectFrame::Space::Motion;
      const uint32_t phase=t%4200;
      for(unsigned k=0;k<2;++k) {
        if(phase<k*600 || phase>k*600+1700) continue;
        const uint32_t age=phase-k*600;
        const uint16_t distance=age*32767/1700;
        const uint8_t strength=(1700-age)*255/1700;
        if(context.motionPath==1)frame.add(uint32_t(distance)*65535/32767,6500,k?b:a,strength);
        else{
          frame.add(32767-distance,6500,k?b:a,strength);
          frame.add(32768+distance,6500,k?b:a,strength);
        }
      } break;
    }
    case MODE_STARS: {
      frame.background=b; frame.background.nscale8(5);
      for(unsigned k=0;k<1U+o.intensity/40;++k) {
        const uint32_t phase=(t+k*1801)%5600;
        if(phase>1800) continue;
        const bool reverse=((t+k*1801)/5600+k)%2;
        const int32_t head=int32_t(phase)*80000/1800-7000;
        for(unsigned tail=0;tail<9;++tail) {
          const int32_t p=head-int32_t(tail)*1800;
          if(p>=0 && p<=65535) frame.add(reverse?65535-p:p,2400,k%2?b:a,255/(tail+1));
        }
      } break;
    }
#if !COOLLAMP_EFFECT_PACK_REPLACE_NATIVE
    case MODE_BREATHING: {
      const uint8_t breath=sin8(t/28); CRGB color=blend(a,b,breath);
      color.nscale8(12+uint16_t(breath)*243/255); frame.background=color; break;
    }
#endif
    case MODE_BLOBS: {
      for(unsigned k=0;k<5;++k) {
        const uint16_t center=uint16_t(sin8(t/(45+k*11)+k*51))*257;
        const uint16_t width=9000+uint16_t(sin8(t/60+k*73))*45;
        frame.add(center,width,blend(a,b,k*63),110);
      } break;
    }
  }
  frame.render(context,leds);
}
void renderNewEffect(uint8_t mode, uint32_t t) {
  const LampEffectFrame::Context frame{t,uint16_t(NUM_LEDS),lampMidpoint,lampEffectiveMotionPath()};
  renderSpatialEffect(mode,frame);
}
