#pragma once
#include <stdint.h>
#include "LampStyle.h"

// A split is a boundary after a one-based LED number, not an array index.
// Zero selects the historical midpoint. Keep both sides nonempty when possible.
inline uint16_t lampSplitCount(uint16_t count, uint16_t midpoint) {
  if (count <= 1) return count;
  if (!midpoint) return (count + 1) / 2;
  return midpoint < count ? midpoint : count - 1;
}
inline uint16_t lampCenteredPosition(uint16_t index, uint16_t count, uint16_t midpoint) {
  if (count <= 1) return 32768;
  if (!midpoint) return uint32_t(index) * 65535 / (count - 1);
  const uint32_t center = 2 * lampSplitCount(count, midpoint) - 1;
  const uint32_t x = 2 * index, end = 2 * (count - 1);
  return x <= center ? x * 32768 / center : 32768 + (x - center) * 32767 / (end - center);
}
extern uint16_t lampMidpoint;
void loadLampGeometry();
bool saveLampGeometry(uint16_t midpoint, uint16_t count);

// Independent local animation layout. Physical calibration/height helpers
// above retain their exact legacy meaning for groups and update progress.
constexpr const char* LAMP_MOTION_PATH_KEY="motionV1";
constexpr const char* LAMP_MOTION_PATH_NAMESPACE="lampmodel"; // User reset preserves local strip layout.
struct LampMotionPathRecord {
  uint8_t data[3]{};
  void encode(uint8_t path){data[0]=1;data[1]=path;data[2]=0x5a^data[0]^data[1];}
  bool valid()const{return data[0]==1&&data[1]<=1&&data[2]==uint8_t(0x5a^data[0]^data[1]);}
  uint8_t path()const{return data[1];}
};
extern uint8_t lampMotionPath; // 0 calibrated split, 1 one whole-strip lane.
inline uint8_t lampEffectiveMotionPath(){return lampStyleUsesWholeStrip()?1:lampMotionPath;}
bool readStoredLampMotionPath(uint8_t& path); // Missing=>Split; malformed/unreadable=>false.
bool saveLampMotionPath(uint8_t path); // Owning loop, commit + exact readback.
bool lampMotionPathSaveUncertain(); // Unreadable boot record/failed restoration must be reconciled.
inline uint16_t lampMotionSplitCount(uint16_t count,uint16_t midpoint){
  return lampEffectiveMotionPath()==1?count:lampSplitCount(count,midpoint);
}
inline uint16_t lampMotionPosition(uint16_t index,uint16_t count,uint16_t midpoint){
  if(!count||count>1024||index>=count)return 0;
  return lampCenteredPosition(index,count,lampEffectiveMotionPath()==1?0:midpoint);
}
