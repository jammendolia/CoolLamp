#include "LampEdisonEffects.h"
#include "LampModel.h"

bool lampEdisonProfileMatches(){
  return LampModel::factoryAvailable() && !strcmp(LampModel::current().id,"edison-v1") &&
    getLampStyle()==LampPhysicalStyle::Edison && LampEdison::matchingGeometry(NUM_LEDS,lampMidpoint);
}

void renderEdisonEffect(uint8_t mode,uint32_t clock){
  if(!lampEffectAvailable(mode)){fill_solid(leds,NUM_LEDS,CRGB::Black);return;}
  const auto color=getLampColor(mode);const auto options=getLampEffectOptions(mode);
  LampEdison::Audio bands{};
  if(mode==MODE_EDISON_SOUND_FILAMENT){
    const auto audio=getLampRenderAudio();
    const uint16_t largest=max(uint16_t(1),max(audio.bass,max(audio.mid,audio.treble)));
    bands={uint8_t(uint32_t(audio.bass)*audio.level/largest),
      uint8_t(uint32_t(audio.mid)*audio.level/largest),
      uint8_t(uint32_t(audio.treble)*audio.level/largest),audio.level,audio.valid};
  }
  const LampEdison::RGB primary{color.r,color.g,color.b};
  const LampEdison::RGB secondary=options.dual?LampEdison::RGB{options.r,options.g,options.b}:primary;
  const auto frame=LampEdison::prepare(mode,clock,bands,primary,secondary);
  for(uint16_t index=0;index<NUM_LEDS;++index){
    const auto pixel=LampEdison::pixel(frame,index,NUM_LEDS);
    leds[index]=CRGB(pixel.r,pixel.g,pixel.b);
  }
}
