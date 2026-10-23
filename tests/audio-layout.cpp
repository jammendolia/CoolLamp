#include <cassert>
#include <cstdint>
#include <iostream>
#include "../AudioAnalysis.h"
#include "../AudioSpectrum.h"

int main(){
  AudioAnalysis oldAnalysis,monoAnalysis,compactAnalysis;
  AudioSpectrum oldBands,monoBands,compactBands;
  AudioNoiseFloor oldFloor,monoFloor,compactFloor;
  AudioPeakHold oldHold,monoHold,compactHold;
  int32_t stereo[512]{},mono[256]{};int16_t compact[256]{};
  uint32_t random=0x8e752bac;
  for(unsigned block=0;block<2048;++block){
    const size_t counts[]={256,128,1,255,0};const size_t count=counts[block%5];
    for(unsigned i=0;i<256;++i){
      random^=random<<13;random^=random>>17;random^=random<<5;
      int32_t value=int32_t(random&65535)-32768;
      if(block%7==0)value=0;else if(block%11==0)value=i%2?32767:-32768;
      compact[i]=int16_t(value);mono[i]=value*65536+int32_t(random&65535);
      stereo[2*i]=mono[i];stereo[2*i+1]=i%2?INT32_MAX:INT32_MIN;
    }
    const uint8_t gain=uint8_t(1+block%64);const uint16_t gate=block%1025,scale=100+block%301;
    const bool automatic=block%3!=0;const uint32_t now=UINT32_MAX-2000+block*16;
    const auto a=oldAnalysis.process(stereo,count,gain,oldFloor.cutoff(gate),scale,automatic);
    const auto b=monoAnalysis.process<1>(mono,count,gain,monoFloor.cutoff(gate),scale,automatic);
    const auto c=compactAnalysis.process<1>(compact,count,gain,compactFloor.cutoff(gate),scale,automatic);
    assert(a.rms==b.rms&&a.rms==c.rms&&a.peak==b.peak&&a.peak==c.peak);
    assert(a.level==b.level&&a.level==c.level&&a.signal==b.signal&&a.signal==c.signal);
    assert(oldAnalysis.effectiveGainHundredths(gain)==monoAnalysis.effectiveGainHundredths(gain));
    assert(oldAnalysis.effectiveGainHundredths(gain)==compactAnalysis.effectiveGainHundredths(gain));
    oldFloor.observe(a.rms,count);monoFloor.observe(b.rms,count);compactFloor.observe(c.rms,count);
    assert(oldFloor.rms()==monoFloor.rms()&&oldFloor.rms()==compactFloor.rms());
    assert(oldFloor.calibrated()==monoFloor.calibrated()&&oldFloor.calibrated()==compactFloor.calibrated());
    const auto x=oldBands.process(stereo,count,a.level,now);
    const auto y=monoBands.process<1>(mono,count,b.level,now);
    const auto z=compactBands.process<1>(compact,count,c.level,now);
    assert(x.bass==y.bass&&x.bass==z.bass&&x.mid==y.mid&&x.mid==z.mid&&x.treble==y.treble&&x.treble==z.treble);
    assert(x.beat==y.beat&&x.beat==z.beat&&x.bassBeat==y.bassBeat&&x.bassBeat==z.bassBeat);
    const auto held=oldHold.process(a.level,now);
    assert(held==monoHold.process(b.level,now)&&held==compactHold.process(c.level,now));
  }
  std::cout<<"2048 blocks: stereo32, mono32 and mono16 agree exactly, including rollover and unused right-channel garbage\n";
}
