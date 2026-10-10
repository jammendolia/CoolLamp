#pragma once
#include "LampSyncProtocol.h"
#include "LampControl.h"
#ifdef ARDUINO
#include <Arduino.h>
#include "LampControlEndpoint.h"
struct LampSyncGroupContext {
  uint8_t role=0,protocol=2,count=0;
  uint64_t boot=0;
  char identity[13]{},leader[13]{};
  uint8_t key[16]{};
  char members[LampSyncWire::MaxMembers][13]{};
};
// Loop-only internal lease context. The caller must wipe the copied key.
bool lampSyncGroupContext(LampSyncGroupContext& out);
void beginLampSync();
void serviceLampSync(const String& name, bool blocked, bool scanning=false);
String lampSyncJson(uint8_t peerCursor=0,uint8_t peerLimit=8);
String lampSyncIncarnation(); // Stable nonsecret group fingerprint; empty if independent.
bool configureLampSync(uint8_t role,const String& leader,const String& key,uint8_t protocol=2,const String& expectedIncarnation="");
String lampSyncInvite();
bool configureLampScene(uint8_t scene,uint8_t speed,uint8_t intensity,const uint8_t* primary,const uint8_t* secondary);
bool configureLampOrder(const String& order);
// The authenticated owner must first confirm the target's saved departure on a
// fresh, identity-verified connection. Exact order + current session fence the
// subsequent coordinator prune; absent targets are an idempotent read outcome.
LampControlReply removeLampGroupMember(const String& target,const String& order,const String& session);
LampSyncWire::Visual lampGroupVisual();
uint8_t lampGroupScene();
uint8_t lampSyncRole();
bool lampSyncPaused();
bool configureLampSyncPause(bool pause);
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
