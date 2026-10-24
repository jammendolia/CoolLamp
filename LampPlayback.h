#pragma once
#include <stdint.h>
#include "LampControl.h"
struct LampRotation {
  uint8_t version=1, enabled=0, random=1, category=0;
  uint32_t seconds=30;
};
inline bool validLampRotation(const LampRotation& r) {
  return r.version==1 && r.enabled<=1 && r.random<=1 && r.category<=2 && r.seconds>=5 && r.seconds<=86400;
}
// category: 0 all, 1 light, 2 audio. Random draws exclude the current effect.
inline uint8_t nextRotationEffect(uint8_t current, uint8_t available, const LampRotation& r, uint32_t draw,uint64_t selectable=UINT64_MAX) {
  uint8_t choices[LAMP_EFFECT_CAPACITY],count=0,currentIndex=255; // Only initialized entries below count are read.
  for(uint8_t id=1;id<=available&&id<=LAMP_EFFECT_CAPACITY;++id){
    if(!(selectable&(uint64_t(1)<<(id-1)))||(r.category&&((r.category==2)!=lampEffectNeedsAudio(id))))continue;
    if(id==current)currentIndex=count;
    choices[count++]=id;
  }
  if(!count)return 0;
  if(!r.random){for(uint8_t i=0;i<count;++i)if(choices[i]>current)return choices[i];return choices[0];}
  const bool skip=currentIndex!=255&&count>1;
  unsigned index=draw%(count-skip);if(skip&&index>=currentIndex)++index;
  return choices[index];
}
extern LampRotation lampRotation;
void loadLampRotation();
bool saveLampRotation(const LampRotation& next);
void serviceLampRotation();
bool lampCalibrationActive();
uint16_t lampCalibrationPosition();
bool beginLampCalibration();
bool beginLampCenterCalibration();
bool lampCalibrationCenter();
uint16_t lampCalibrationMaximum();
void touchLampCalibration();
void resetLampCalibrationKnob();
void moveLampCalibration(uint16_t position);
bool finishLampCalibration(bool save);
bool renderLampCalibration();
bool saveLampLedCount(uint16_t count);
uint8_t lampSyncRole();
