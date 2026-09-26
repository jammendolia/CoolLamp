#pragma once
#include <stdint.h>
struct FountainColor { uint8_t r,g,b; };
extern FountainColor lampFountainColors[3];
extern bool lampFountainCustom;
void loadLampFountainColors();
bool saveLampFountainColors(const FountainColor* colors);
