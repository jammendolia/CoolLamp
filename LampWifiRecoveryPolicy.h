#pragma once
#include <stdint.h>

// Keep an unavailable home AP from continuously sweeping the group's radio
// channel. These are transient radio actions, never saved Wi-Fi preferences.
class LampWifiRecoveryPolicy {
public:
  enum Action { None, Suspend, Probe, AbortProbe, Restore };
  static constexpr uint32_t Interval=60000, Budget=2000;
private:
  bool owned=false,attempt=false;
  uint32_t next=0,started=0;
public:
  Action tick(uint32_t now,bool offlineIntent,bool associated,bool busy,bool autoReconnect){
    if(busy){if(attempt){attempt=false;next=now+Interval;}return None;}
    if(!offlineIntent||associated){if(owned){owned=false;attempt=false;return Restore;}return None;}
    if(!owned||autoReconnect){owned=true;attempt=false;next=now+Interval;return Suspend;}
    if(attempt){if(uint32_t(now-started)>=Budget){attempt=false;next=now+Interval;return AbortProbe;}return None;}
    if(int32_t(now-next)>=0){attempt=true;started=now;return Probe;}
    return None;
  }
  void failed(uint32_t now){attempt=false;next=now+Interval;}
  bool probing()const{return attempt;}
};
