#pragma once
#include "LampEffectPackage.h"
#if COOLLAMP_EFFECT_PACK_COMPRESSED
#include "LampEffectPackageRle.h"
#include "LampEffectPackagesCompressed.generated.h"
#else
#include "LampEffectPackages.generated.h"
#endif

// Trusted embedded fixtures only. This is not an installer or publisher policy.
namespace LampEffectPackagePrototype {
using RGB=LampEffectPackage::RGB;
#if COOLLAMP_EFFECT_PACK_COMPRESSED
namespace Packages=LampEffectPackagesCompressed;
#else
namespace Packages=LampEffectPackages;
#endif
struct Math {
  static uint8_t sin8(uint8_t phase){return ::sin8(phase);}
  static RGB blend8(RGB a,RGB b,uint8_t amount){
    const CRGB color=::blend(CRGB(a.r,a.g,a.b),CRGB(b.r,b.g,b.b),amount);
    return {color.r,color.g,color.b};
  }
  static RGB scale8(RGB color,uint8_t amount){
    return {::scale8(color.r,amount),::scale8(color.g,amount),::scale8(color.b,amount)};
  }
  static RGB add(RGB a,RGB b){return {qadd8(a.r,b.r),qadd8(a.g,b.g),qadd8(a.b,b.b)};}
};
struct Cache {
  const Packages::Entry* entry=nullptr;
  uint16_t capabilities=0,count=0,midpoint=0;
  LampEffectPackage::View view{};
  LampEffectPackage::Workspace workspace{};
#if COOLLAMP_EFFECT_PACK_COMPRESSED
  uint8_t decoded[LampEffectPackage::HeaderBytes+LampEffectPackage::MaxInstructions*LampEffectPackage::InstructionBytes]{};
#endif
};
inline Cache cache{};

inline bool render(uint8_t mode,uint32_t clock){
  const auto* entry=Packages::find(mode);
  if(!entry)return false;
  if(!lampEffectAvailable(mode)){fill_solid(leds,NUM_LEDS,CRGB::Black);return true;}
  LampEffectPackage::Inputs inputs;
  inputs.clock=clock;inputs.count=NUM_LEDS;inputs.midpoint=lampMidpoint;inputs.motionPath=lampEffectiveMotionPath();
  inputs.capabilities=LampEffectPackage::Strip;
  if(lampEdisonProfileMatches())inputs.capabilities|=LampEffectPackage::EdisonRegions;
  const auto color=getLampColor(mode);const auto options=getLampEffectOptions(mode);
  inputs.primary={color.r,color.g,color.b};
  inputs.secondary=options.dual?RGB{options.r,options.g,options.b}:inputs.primary;
  if(mode==MODE_EDISON_SOUND_FILAMENT){
    inputs.capabilities|=LampEffectPackage::AudioFeatures;
    const auto audio=getLampRenderAudio();
    const uint16_t largest=max(uint16_t(1),max(audio.bass,max(audio.mid,audio.treble)));
    inputs.audio={uint8_t(uint32_t(audio.bass)*audio.level/largest),
      uint8_t(uint32_t(audio.mid)*audio.level/largest),uint8_t(uint32_t(audio.treble)*audio.level/largest),audio.level,audio.valid};
  }
  if(cache.entry!=entry||cache.capabilities!=inputs.capabilities||cache.count!=inputs.count||cache.midpoint!=inputs.midpoint){
    cache.entry=entry;cache.capabilities=inputs.capabilities;cache.count=inputs.count;cache.midpoint=inputs.midpoint;
#if COOLLAMP_EFFECT_PACK_COMPRESSED
    cache.view=LampEffectPackage::View{};cache.workspace.valid=false;
    size_t decoded=0;
    if(LampEffectPackageRle::decode(entry->bytes,entry->size,cache.decoded,sizeof(cache.decoded),decoded))
      LampEffectPackage::validate(cache.decoded,decoded,inputs.capabilities,inputs.count,inputs.midpoint,cache.view);
#else
    LampEffectPackage::validate(entry->bytes,entry->size,inputs.capabilities,inputs.count,inputs.midpoint,cache.view);
#endif
  }
  if(!LampEffectPackage::render<Math>(cache.view,inputs,cache.workspace,leds))fill_solid(leds,NUM_LEDS,CRGB::Black);
  return true;
}
}
