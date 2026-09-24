#pragma once
#include <stdint.h>
struct VuColor { uint8_t r,g,b; };
extern VuColor lampVuColors[3];
void loadLampVuColors();
bool saveLampVuColors(const VuColor* colors);
inline uint8_t vuZone(uint16_t height,uint16_t size) {
  if(size<=1)return 2;
  const uint32_t percent=uint32_t(height)*100;
  return percent<uint32_t(size-1)*65?0:percent<uint32_t(size-1)*80?1:2;
}
