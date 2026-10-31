#pragma once
#include <stdint.h>
#include <string.h>
#include "LampEffectRegistry.h"
namespace LampEffectSchema {
// Empty requirements mean every physical design, independent of artwork
// recommendations. Future effects may supply an explicit canonical style list.
struct StyleRequirement {const char* const* ids=nullptr;uint8_t count=0;};
inline StyleRequirement styles(uint8_t localId,bool scene){
  static const char* const edison[]={"edison"};
  static const char* const sonata[]={"sonata"};
  return scene?StyleRequirement{}:LampEffects::needsEdison(localId)?StyleRequirement{edison,1}:LampEffects::needsSonata(localId)?StyleRequirement{sonata,1}:StyleRequirement{};
}
inline bool compatible(StyleRequirement required,const char* style){
  if(!required.count)return true;
  if(!style||!required.ids)return false;
  for(uint8_t i=0;i<required.count;++i)if(!strcmp(required.ids[i],style))return true;
  return false;
}
inline const char* key(uint8_t id){
  return LampEffects::key(id);
}
inline bool motion(uint8_t id){return id>=1&&id<=LampEffects::Count&&id!=52&&!(id>=21&&id<=29);}
inline bool intensity(uint8_t id){return motion(id)||id==52;}
inline const char* intensityRole(uint8_t id){return id==30||id==33||id==38?"density-and-glow":id==31||id==35?"activity-and-glow":"glow";}
inline bool automatic(uint8_t id){return id<=28||(id>=41&&id<=44)||id==47;}
inline bool zonePalette(uint8_t id){return id==45||id==46;}
inline bool secondary(uint8_t id){return id>=1&&id<=LampEffects::Count&&!zonePalette(id);}
}
