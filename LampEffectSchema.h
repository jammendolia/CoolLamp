#pragma once
#include <stdint.h>
namespace LampEffectSchema {
inline const char* key(uint8_t id){
  static const char* const keys[]={"pacifica","aurora","rain","fire","split-fire-rising","split-fire-falling","split-fire-rising-reversed-colors","blue-gas-fire","witch-fire","purple-fire","embers","lava","plasma","rainbow","rainbow-glitter","confetti","comet-collision","sinelon","bpm","juggle","white","red","green","blue","purple","pink","yellow","cyan","custom-solid","droplets-rising","lightning-storm","color-tide","fireflies","heartbeat","shooting-stars","breathing-glow","lava-blobs","droplets-falling","sound-glow","sound-meter","spectrum-rise","bass-launch","spectral-embers","beat-bloom","three-band-fountain","vu-meter","rainbow-embers"};
  return id>=1&&id<=47?keys[id-1]:"unknown";
}
inline bool motion(uint8_t id){return id>=1&&id<=47&&!(id>=21&&id<=29);}
inline bool intensity(uint8_t id){return motion(id);}
inline const char* intensityRole(uint8_t id){return id==30||id==33||id==38?"density-and-glow":id==31||id==35?"activity-and-glow":"glow";}
inline bool automatic(uint8_t id){return id<=28||(id>=41&&id<=44)||id==47;}
inline bool zonePalette(uint8_t id){return id==45||id==46;}
inline bool secondary(uint8_t id){return id>=1&&id<=47&&!zonePalette(id);}
}
