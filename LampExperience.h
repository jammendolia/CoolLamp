#pragma once
#include <Arduino.h>
void beginLampExperience();
String lampDescriptorJson();
String lampRevisionJson();
String lampEffectSchemaPage(uint8_t offset,uint8_t count,bool scenes);
void handleLampStatePatch();
void handleLampAppearanceSave();
void handleLampReceipt();
void handleLampUpdatePolicy();
