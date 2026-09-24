// Fixed-size visual state; never allocate in the rendering loop.
struct AudioPulse { uint32_t born; uint8_t strength; CRGB color; };
static AudioPulse audioPulses[6]{};
static uint8_t audioPulseNext=0;
static uint32_t audioBeatSeen=0, audioBassSeen=0;
static uint8_t audioBandLevels[3]{}, audioPeak=0;
static uint32_t audioPeakAt=0;

CRGB audioMix(CRGB a,CRGB b,CRGB c,uint8_t x,uint8_t y,uint8_t z) {
  const uint32_t sum=uint32_t(x)+y+z;
  if(!sum)return CRGB::Black;
  return CRGB((uint32_t(a.r)*x+uint32_t(b.r)*y+uint32_t(c.r)*z)/sum,
    (uint32_t(a.g)*x+uint32_t(b.g)*y+uint32_t(c.g)*z)/sum,
    (uint32_t(a.b)*x+uint32_t(b.b)*y+uint32_t(c.b)*z)/sum);
}

void renderAudioEffect(uint8_t mode, uint32_t now) {
  static uint32_t last = 0;
  static uint8_t previousMode = 0, level = 0;
  const auto options = getLampEffectOptions(mode);
  const auto color = getLampColor(mode);
  const auto audio = getLampAudioFeatures();
  if (previousMode != mode || now - last > 250) {
    level=0; audioPeak=0; audioPeakAt=now;
    for(auto& pulse:audioPulses)pulse.strength=0;
    for(auto& band:audioBandLevels)band=0;
    audioBeatSeen=audio.beat;audioBassSeen=audio.bassBeat;
  }
  const uint32_t elapsed = min(uint32_t(now - last), uint32_t(100));
  level = smoothAudioLevel(level, audio.valid ? audio.level : 0, elapsed, options.speed);
  last = now; previousMode = mode;
  const CRGB primary(color.r, color.g, color.b), secondary(options.r, options.g, options.b);
  const uint16_t rawBands[3]={audio.bass,audio.mid,audio.treble};
  uint16_t largest=1;
  for(auto b:rawBands)if(b>largest)largest=b;
  for(unsigned b=0;b<3;++b)audioBandLevels[b]=smoothAudioLevel(audioBandLevels[b],
    audio.valid?uint32_t(rawBands[b])*255/largest:0,elapsed,options.speed);
  const CRGB bassColor=color.enabled?primary:CRGB(255,65,0);
  const CRGB highColor=color.enabled?(options.dual?secondary:primary):CRGB(75,30,255);
  const CRGB midColor=color.enabled?blend(bassColor,highColor,128):CRGB(0,230,130);
  const CRGB spectral=audioMix(bassColor,midColor,highColor,audioBandLevels[0],audioBandLevels[1],audioBandLevels[2]);
  if(level>=audioPeak){audioPeak=level;audioPeakAt=now;}
  else if(uint32_t(now-audioPeakAt)>180)audioPeak=smoothAudioLevel(audioPeak,level,elapsed,options.speed);
  const bool launch=mode==MODE_BASS_LAUNCH && audio.bassBeat!=audioBassSeen;
  const bool bloom=mode==MODE_BEAT_BLOOM && audio.beat!=audioBeatSeen;
  if(audio.valid && (launch||bloom)) {
    auto& pulse=audioPulses[audioPulseNext++%6];pulse={now,audio.level,spectral};
  }
  audioBeatSeen=audio.beat;audioBassSeen=audio.bassBeat;
  const uint32_t duration=1600-uint32_t(options.speed)*10;
  const uint16_t left = lampSplitCount(NUM_LEDS, lampMidpoint);
  for (uint16_t i = 0; i < NUM_LEDS; ++i) {
    const uint16_t size = i < left ? left : NUM_LEDS - left;
    // Both strip ends at base, midpoint at top.
    const uint16_t height = i < left ? i : NUM_LEDS - 1 - i;
    const uint8_t position = size > 1 ? uint32_t(height) * 255 / (size - 1) : 0;
    CRGB tint = options.dual ? blend(primary, secondary, position) : primary;
    if(mode>=MODE_SPECTRUM_RISE) {
      tint=CRGB::Black;
      const int coverage=int(level)*size-int(height)*255;
      const uint8_t fill=coverage<=0?0:coverage>=255?255:uint8_t(coverage);
      if(mode==MODE_SPECTRUM_RISE) {
        tint=spectral;tint.nscale8(fill);
        if(level && audioPeak && abs(int(position)-audioPeak)<5){CRGB marker=color.enabled?spectral:CRGB(255,255,255);marker.nscale8(level);tint+=marker;}
      } else if(mode==MODE_BAND_FOUNTAIN) {
        const CRGB colors[3]={bassColor,midColor,highColor};
        for(unsigned b=0;b<3;++b){
          const uint8_t bandHeight=uint16_t(level)*audioBandLevels[b]/255;
          const int amount=int(bandHeight)*size-int(height)*255;
          CRGB layer=colors[b];layer.nscale8(amount<=0?0:amount>=255?180:uint32_t(amount)*180/255);tint+=layer;
        }
      } else if(mode==MODE_SPECTRAL_EMBERS) {
        const uint8_t flame=uint16_t(level)*audioBandLevels[0]/255;
        const int amount=int(flame)*size-int(height)*255;
        tint=blend(bassColor,midColor,position/3);
        const uint8_t flicker=160+effectHash(uint32_t(i)+now/55)%96;
        tint.nscale8(amount<=0?0:amount>=255?flicker:uint32_t(amount)*flicker/255);
        const uint32_t seed=effectHash(uint32_t(i)+now/80);
        if(level && (seed&255)<uint16_t(level)*audioBandLevels[2]/1024){CRGB spark=highColor;spark.nscale8(level);tint+=spark;}
      } else {
        for(auto& pulse:audioPulses){
          const uint32_t age=now-pulse.born;
          if(!pulse.strength || age>=duration)continue;
          const int travel=age*255/duration;
          const int head=mode==MODE_BEAT_BLOOM?255-travel:travel;
          const unsigned distance=abs(int(position)-head);
          if(distance<45){CRGB ray=pulse.color;ray.nscale8(uint32_t(pulse.strength)*(45-distance)/45*(duration-age)/duration);tint+=ray;}
          if(mode==MODE_BASS_LAUNCH && travel>210 && position>220){
            CRGB flare=pulse.color;flare.nscale8(uint32_t(pulse.strength)*(travel-210)/45*(255-travel)/45);tint+=flare;
          }
        }
      }
    } else if (mode == MODE_SOUND_METER) {
      const int coverage = int(level) * size - int(height) * 255;
      tint.nscale8(coverage <= 0 ? 0 : coverage >= 255 ? 255 : uint8_t(coverage));
    } else tint.nscale8(level);
    leds[i] = tint;
  }
}
