#pragma once
#include <stdint.h>
#include <stddef.h>

// Separate NVS namespace: recovery survives power loss during user-settings reset.
struct FactoryResetRecord {
  uint8_t data[10]{};
  void encode(uint16_t leds,uint16_t power,uint16_t midpoint,bool mic,uint8_t stage=0) {
    data[0]=1;data[1]=stage;data[2]=leds;data[3]=leds>>8;
    data[4]=power;data[5]=power>>8;data[6]=midpoint;data[7]=midpoint>>8;data[8]=mic;
    data[9]=0xa5;for(unsigned i=0;i<9;++i)data[9]^=data[i];
  }
  uint16_t leds()const{return uint16_t(data[2])|uint16_t(data[3])<<8;}
  uint16_t power()const{return uint16_t(data[4])|uint16_t(data[5])<<8;}
  uint16_t midpoint()const{return uint16_t(data[6])|uint16_t(data[7])<<8;}
  bool valid()const {
    uint8_t check=0xa5;for(unsigned i=0;i<9;++i)check^=data[i];
    return data[0]==1&&data[1]<=1&&data[8]<=1&&data[9]==check&&
      leds()>=1&&leds()<=1024&&power()>=100&&power()<=20000&&midpoint()<leds();
  }
};
