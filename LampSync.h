#pragma once
#include "LampSyncProtocol.h"
#include "LampControl.h"
#ifdef ARDUINO
#include <Arduino.h>
void beginLampSync();
void serviceLampSync(const String& name, bool blocked);
String lampSyncJson();
bool configureLampSync(uint8_t role,const String& leader,const String& key);
String lampSyncInvite();
bool configureLampScene(uint8_t scene,uint8_t speed,uint8_t intensity,const uint8_t* primary,const uint8_t* secondary);
bool configureLampOrder(const String& order);
LampSyncWire::Visual lampGroupVisual();
uint8_t lampGroupScene();
void resumeLampSync();
#endif
// All state is accessed on the loop task, never from the audio worker.
extern const LampSyncWire::Visual* lampSyncVisual;
bool lampSyncFollowing();
bool leaveLampSceneForEffect();
void pauseLampSync();
uint32_t lampSyncRenderTime(uint32_t local);
uint32_t lampSyncEffectClock(uint32_t local);
void applyLampSyncControl(const LampSyncWire::Visual* visual);
void captureLampSyncVisual(LampSyncWire::Visual& visual);
