#pragma once
#include "WiFi.h"
#include <vector>
#include <deque>
#include <algorithm>
struct WiFiUDP {
  inline static std::deque<std::vector<uint8_t>> incoming;
  inline static std::vector<std::vector<uint8_t>> outgoing;
  std::vector<uint8_t> current;
  bool begin(uint16_t){return true;}
  bool beginPacket(IPAddress,uint16_t){current.clear();return true;}
  void stop(){incoming.clear();}
  int parsePacket(){return incoming.empty()?0:int(incoming.front().size());}
  int read(uint8_t* out,size_t size){size=std::min(size,incoming.front().size());memcpy(out,incoming.front().data(),size);return int(size);}
  void clear(){if(!incoming.empty())incoming.pop_front();}
  IPAddress remoteIP(){return {192,168,1,3};}
  void write(const uint8_t* data,size_t n){current.assign(data,data+n);}
  void endPacket(){outgoing.push_back(current);}
};
