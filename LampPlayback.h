#pragma once
#include <stdint.h>
struct LampRotation {
  uint8_t version=1, enabled=0, random=1, category=0;
  uint32_t seconds=30;
};
inline bool validLampRotation(const LampRotation& r) {
  return r.version==1 && r.enabled<=1 && r.random<=1 && r.category<=2 && r.seconds>=5 && r.seconds<=86400;
}
// category: 0 all, 1 light, 2 audio. Random draws exclude the current effect.
inline uint8_t nextRotationEffect(uint8_t current, uint8_t available, const LampRotation& r, uint32_t draw) {
  const unsigned first=r.category==2?39:1, last=r.category==1?(available<38?available:38):available;
  if(last<first)return 0;
  const unsigned count=last-first+1;
  const bool inside=current>=first && current<=last;
  if(!r.random)return inside ? first+(current-first+1)%count : first;
  if(count==1)return first;
  unsigned index=draw%(count-(inside?1:0));
  if(inside && index>=current-first)++index;
  return first+index;
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
