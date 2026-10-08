#pragma once
#include <stdint.h>

// Loop-owned handoff: request callers may still hold a consumed BLE response
// or HTTP form, and group teardown may already have run earlier in that loop.
// Observe one service boundary, then let a complete subsequent Network/BLE
// pass release their resources before notifying the HTTPS worker. No timer or
// callback waits, and no reset of BLE transaction/replay state is involved.
class LampUpdateHandoff {
  uint8_t pass=0;
public:
  void queue(){pass=1;}
  void cancel(){pass=0;}
  bool service(){
    if(pass==1){pass=2;return false;}
    if(pass==2){pass=0;return true;}
    return false;
  }
};
