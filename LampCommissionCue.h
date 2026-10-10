#pragma once
#include <stdint.h>
#include <stddef.h>

// A v2 comparison contains six independently derived four-bit symbols (24
// bits). Each symbol is shown redundantly as a color and two counts of 1..4
// pulses. A seventh CRC4 symbol detects transcription/counting errors; it does
// not add entropy. No dynamic allocation or mutable rendering state.
namespace LampCommissionCue {
constexpr uint8_t Symbols=6, DisplaySymbols=7;
constexpr uint32_t PulseOn=350,PulsePeriod=700,CountPeriod=3400;
constexpr uint32_t SymbolPeriod=8000,Cycle=DisplaySymbols*SymbolPeriod+2000;
constexpr uint32_t MaximumRenderGap=200;
inline uint8_t check(const uint8_t* symbols) {
 uint8_t crc=0;
 for(unsigned i=0;i<Symbols;++i)for(int bit=3;bit>=0;--bit){
  const bool high=((crc>>3)^((symbols[i]>>bit)&1))&1;
  crc=uint8_t((crc<<1)&15);if(high)crc^=3;
 }
 return crc;
}
inline void counts(uint8_t symbol,uint8_t& first,uint8_t& second){first=1+((symbol>>2)&3);second=1+(symbol&3);}
inline bool render(const uint8_t* symbols,uint32_t elapsed,uint8_t& red,uint8_t& green,uint8_t& blue) {
 red=green=blue=0;
 const uint32_t phase=elapsed%Cycle;if(phase>=DisplaySymbols*SymbolPeriod)return false;
 const uint8_t index=phase/SymbolPeriod,symbol=index<Symbols?symbols[index]:check(symbols);
 const uint32_t at=phase%SymbolPeriod;if(at>=2*CountPeriod)return false;
 uint8_t first,second;counts(symbol,first,second);
 const uint32_t group=at%CountPeriod;const uint8_t count=at<CountPeriod?first:second;
 if(group>=count*PulsePeriod||group%PulsePeriod>=PulseOn)return false;
 static constexpr uint8_t colors[16][3]={{255,0,0},{255,96,0},{255,220,0},{128,255,0},{0,255,0},{0,255,96},{0,220,255},{0,96,255},{0,0,255},{96,0,255},{180,0,255},{255,0,220},{255,0,96},{255,170,96},{128,180,255},{255,255,255}};
 red=colors[symbol][0];green=colors[symbol][1];blue=colors[symbol][2];return true;
}
}
