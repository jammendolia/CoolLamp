#pragma once
#include <stdint.h>
#include <stddef.h>
#include <type_traits>

// Three overlapping bands at 16 kHz. Fixed-point one-pole crossovers keep
// work and memory bounded: bass low-pass, mid difference, treble residual.
class AudioSpectrum {
  int32_t slow=0, fast=0, dc=0;
  bool initialized=false;
  uint32_t average=0, bassAverage=0, lastBeat=0, lastBass=0;
  uint32_t beats=0, bassBeats=0;
  static uint16_t root(uint64_t x) {
    uint64_t bit=uint64_t(1)<<62, result=0;
    while(bit>x)bit>>=2;
    while(bit){if(x>=result+bit){x-=result+bit;result=(result>>1)+bit;}else result>>=1;bit>>=2;}
    return result>65535?65535:uint16_t(result);
  }
public:
  struct Result { uint16_t bass,mid,treble; uint32_t beat,bassBeat; };
  template<size_t Stride=2,typename Sample=int32_t>
  Result process(const Sample* samples,size_t frames,uint8_t level,uint32_t now) {
    static_assert(Stride==1||Stride==2,"Only mono or interleaved stereo capture");
    static_assert(std::is_same<Sample,int32_t>::value||std::is_same<Sample,int16_t>::value,"Signed microphone words only");
    uint64_t energy[3]{};
    for(size_t i=0;i<frames;++i){
      const int32_t sample=(sizeof(Sample)==2 ? int32_t(samples[i*Stride]) : samples[i*Stride]>>16)*256;
      if(!initialized){dc=sample;initialized=true;}
      dc+=(sample-dc)/256;
      const int32_t ac=sample-dc;
      slow+=int64_t(ac-slow)*6000/65536;
      fast+=int64_t(ac-fast)*35600/65536;
      const int32_t bands[3]={slow/256,(fast-slow)/256,(ac-fast)/256};
      for(unsigned b=0;b<3;++b)energy[b]+=int64_t(bands[b])*bands[b];
    }
    Result r{};
    if(frames){r.bass=root(energy[0]/frames);r.mid=root(energy[1]/frames);r.treble=root(energy[2]/frames);}
    if(level>16 && uint32_t(now-lastBeat)>=180 && uint32_t(level)*256>average+average/3+2048){++beats;lastBeat=now;}
    if(level>16 && uint32_t(now-lastBass)>=180 && uint32_t(r.bass)*256>bassAverage+bassAverage/2+1024){++bassBeats;lastBass=now;}
    average=(average*31+uint32_t(level)*256)/32;
    bassAverage=(bassAverage*31+uint32_t(r.bass)*256)/32;
    r.beat=beats;r.bassBeat=bassBeats;return r;
  }
};
