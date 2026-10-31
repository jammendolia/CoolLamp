#include "LampSonataEffects.h"

void renderSonataEffect(uint8_t mode,const LampEffectFrame::Context& context){
  if(!lampEffectAvailable(mode)){fill_solid(leds,NUM_LEDS,CRGB::Black);return;}
  const auto color=getLampColor(mode);const auto options=getLampEffectOptions(mode);
  const CRGB primary(color.r,color.g,color.b),secondary=options.dual?CRGB(options.r,options.g,options.b):primary;
  const auto frame=LampSonata::prepare(mode,context.clock,primary,secondary);
  frame.render(context,leds);
}
