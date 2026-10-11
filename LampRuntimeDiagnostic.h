#pragma once
#include <stdint.h>
#include <stddef.h>
#include "LampRuntimeMetrics.h"

// USB support measurements must remain available while heap is fragmented.
// This snapshot has no variable text except validated identity/version literals.
namespace LampRuntimeDiagnostic {
constexpr size_t Capacity = 2304;
struct Input {
  const char* identity = nullptr;
  const char* version = nullptr;
  uint32_t uptime = 0, freeHeap = 0, minHeap = 0, largestBlock = 0;
  uint32_t loopStack = 0, closeStack = 0, frames = 0, maxRender = 0;
  uint32_t mode = 0, brightness = 0, leds = 0, midpoint = 0;
  uint32_t updatePhase = 0, updateError = 0, channel = 0, style = 0;
  uint32_t closeQueued = 0, closeAttempts = 0, closeFailures = 0;
  uint32_t closeAborts = 0, closePending = 0, closeMaxOwnedMs = 0;
  bool power = false, automatic = false, healthy = false, connected = false, scanning = false;
  uint8_t address[4]{};
};
class Text {
  char* output_; size_t capacity_, used_ = 0; bool okay_ = true;
  void fail(){okay_=false;if(output_&&capacity_)output_[0]=0;}
  void key(const char* name){add(",\"");add(name);add("\":");}
public:
  Text(char* output, size_t capacity):output_(output),capacity_(capacity){
    if(output_&&capacity_)output_[0]=0;else okay_=false;
  }
  void add(const char* text) {
    if(!okay_)return;
    if(!text){fail();return;}
    while(*text){
      if(used_>=capacity_-1){fail();return;}
      output_[used_++]=*text++;
    }
    output_[used_]=0;
  }
  void number(uint32_t value){
    if(!okay_)return;
    // At most ten uint32 decimal digits. No printf/newlib stream or lock:
    // those can lazily allocate a mutex and abort during heap exhaustion.
    char digits[10];size_t count=0;
    do{digits[count++]=char('0'+value%10);value/=10;}while(value);
    if(count>=capacity_-used_){fail();return;}
    while(count)output_[used_++]=digits[--count];
    output_[used_]=0;
  }
  void field(const char* name,uint32_t value){key(name);number(value);}
  void field(const char* name,bool value){key(name);add(value?"true":"false");}
  void field(const char* name,const char* value){key(name);add("\"");add(value);add("\"");}
  size_t size()const{return okay_?used_:0;}
};
// Same low48-bit, zero-padded lowercase efuse identity as lampIdentity().
// Keep the USB builder on this primitive instead of its snprintf-based helper.
inline void canonicalIdentity(uint64_t efuse,char (&output)[13]){
  static constexpr char hex[]="0123456789abcdef";
  for(unsigned i=0;i<12;++i)output[i]=hex[(efuse>>((11-i)*4))&15];
  output[12]=0;
}
inline bool safeLiteral(const char* value, bool version) {
  if(!value || !value[0])return false;
  size_t length=0;
  while(value[length] && length<16){
    const char c=value[length++];
    if(c>='0'&&c<='9')continue;
    if(version ? c=='.' : (c>='a'&&c<='f'))continue;
    return false;
  }
  return length<=16 && !value[length];
}
template<class HttpMetrics>
size_t serialize(char* output,size_t capacity,const Input& i,
                 const LampRuntimeMetrics::Snapshot& m,const HttpMetrics& h) {
  if(!output || !capacity)return 0;
  output[0]=0;
  if(!safeLiteral(i.identity,false)||!safeLiteral(i.version,true))return 0;
  Text out(output,capacity);
  out.add("{\"diagnosticsVersion\":2,\"deviceId\":\"");out.add(i.identity);out.add("\"");
  out.field("firmwareVersion",i.version);out.field("uptimeMs",i.uptime);out.field("freeHeap",i.freeHeap);
  out.field("minFreeHeap",i.minHeap);out.field("largestFreeBlock",i.largestBlock);
  out.field("loopStackMinimumBytes",i.loopStack);out.field("httpCloseStackMinimumBytes",i.closeStack);
  out.add(",\"render\":{\"frames\":");out.number(i.frames);out.field("maxRenderUs",i.maxRender);
  out.field("power",i.power);out.field("mode",i.mode);out.field("brightness",i.brightness);
  out.field("leds",i.leds);out.field("midpoint",i.midpoint);out.add("}");
  out.add(",\"firmware\":{\"version\":\"");out.add(i.version);out.add("\"");
  out.field("phase",i.updatePhase);out.field("error",i.updateError);out.field("automatic",i.automatic);
  out.field("bootHealthy",i.healthy);out.add("}");
  out.add(",\"wifi\":{\"connected\":");out.add(i.connected?"true":"false");out.add(",\"address\":\"");
  for(unsigned index=0;index<4;++index){if(index)out.add(".");out.number(i.address[index]);}
  out.add("\"");out.field("channel",i.channel);out.add("},\"scan\":{\"active\":");
  out.add(i.scanning?"true":"false");out.add("},\"lampStyle\":{\"code\":");out.number(i.style);out.add("}");
  out.add(",\"socketCleanup\":{\"queued\":");out.number(i.closeQueued);out.field("attempts",i.closeAttempts);
  out.field("failures",i.closeFailures);out.field("aborts",i.closeAborts);out.field("pendingOwned",i.closePending);
  out.field("maxOwnedMs",i.closeMaxOwnedMs);out.add("}");
  out.add(",\"timing\":{\"version\":1");out.field("animationGapTargetUs",LampRuntimeMetrics::AnimationGapTargetUs);
  out.field("loops",m.loops);out.field("shows",m.shows);out.field("animationShows",m.animationShows);
  out.field("maxLoopUs",m.maxLoopUs);out.field("maxLoopGapUs",m.maxLoopGapUs);
  out.field("maxNetworkServiceUs",m.maxNetworkServiceUs);out.field("maxBluetoothServiceUs",m.maxBluetoothServiceUs);
  out.field("maxBeforeRenderUs",m.maxBeforeRenderUs);out.field("maxShowUs",m.maxShowUs);
  out.field("maxFrameGapUs",m.maxFrameGapUs);out.field("maxAnimationFrameGapUs",m.maxAnimationFrameGapUs);
  out.field("animationGapOverruns",m.animationGapOverruns);
  const auto window=[&](const LampRuntimeMetrics::Window& w){
    out.add("{\"sequence\":");out.number(w.sequence);out.field("startUs",w.startUs);out.field("endUs",w.endUs);
    out.field("observedThroughUs",w.observedThroughUs);out.field("observations",w.observations);
    out.field("animationFrames",w.animationFrames);out.field("maxAnimationGapUs",w.maxAnimationGapUs);
    out.field("animationGapOverruns",w.animationGapOverruns);out.add("}");
  };
  out.add(",\"windows\":{\"durationUs\":");out.number(LampRuntimeMetrics::WindowUs);
  out.add(",\"current\":");window(m.currentWindow);out.add(",\"last\":");window(m.lastWindow);out.add("}");
  out.add(",\"http\":{\"accepted\":");out.number(h.accepted);out.field("rejected",h.rejected);
  out.field("deadlines",h.deadlines);out.field("cancelled",h.cancelled);out.field("blockedSends",h.blockedSends);
  out.field("responses",h.responses);out.field("responseFailures",h.responseFailures);out.field("dispatches",h.dispatches);
  out.field("maxServiceUs",h.maxServiceUs);out.field("maxDispatchUs",h.maxDispatchUs);
  out.field("maxReceiveBytes",h.maxReceiveBytes);out.field("maxSendBytes",h.maxSendBytes);
  out.field("closeQueueFull",h.closeQueueFull);out.field("maxConnectionMs",h.maxConnectionMs);
  out.field("maxIdleMs",h.maxIdleMs);out.add("}}}\n");
  return out.size();
}
}
