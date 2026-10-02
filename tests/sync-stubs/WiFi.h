#pragma once
#include "Arduino.h"
struct IPAddress {
  uint8_t bytes[4]{};
  IPAddress()=default;
  IPAddress(uint8_t a,uint8_t b,uint8_t c,uint8_t d):bytes{a,b,c,d}{}
  uint8_t& operator[](unsigned i){return bytes[i];}
  uint8_t operator[](unsigned i)const{return bytes[i];}
  bool operator!=(const IPAddress& p)const{return memcmp(bytes,p.bytes,4)!=0;}
  String toString()const{char s[16];snprintf(s,sizeof(s),"%u.%u.%u.%u",bytes[0],bytes[1],bytes[2],bytes[3]);return String(s);}
};
constexpr int WL_CONNECTED=3;
struct FakeWiFi {
  int state=WL_CONNECTED;
  int status(){return state;}
  IPAddress localIP(){return {192,168,1,2};}
  IPAddress subnetMask(){return {255,255,255,0};}
};
inline FakeWiFi WiFi;
