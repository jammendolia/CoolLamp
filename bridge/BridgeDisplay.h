#pragma once
#include <stdint.h>
#include <Wire.h>

// Caller fills these plain text lines on the owning Arduino loop. The display
// copies them immediately; it never retains pointers or reads bridge secrets.
struct BridgeDisplayStatus {
  static constexpr unsigned TextCapacity=22;
  char title[TextCapacity]="COOLLAMP BRIDGE";
  char line1[TextCapacity]{};
  char line2[TextCapacity]{};
  char line3[TextCapacity]{};
  char line4[TextCapacity]{};
  int16_t progressPercent=-1; // -1 hides the progress bar; 0..100 shows it.
  bool activity=false;
};

class BridgeDisplay {
public:
  bool begin();
  void show(const BridgeDisplayStatus& status);
  void loop(uint32_t nowMs);
  bool available()const{return available_;}
private:
  TwoWire wire_{0};
  BridgeDisplayStatus pending_{};
  uint8_t frame_[1024]{};
  uint32_t nextFrameAt_=0;
  uint8_t page_=8;
  bool available_=false,dirty_=true;
  bool commands(const uint8_t* bytes,unsigned length);
  bool sendPage(unsigned page);
  void render();
  void pixel(unsigned x,unsigned y);
  void text(unsigned x,unsigned y,const char* value,unsigned maximum);
};
