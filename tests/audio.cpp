#include <cassert>
#include <cmath>
#include <iostream>
#include <limits>
#include "../AudioAnalysis.h"

int main() {
  int32_t block[512]{};
  AudioAnalysis silence;
  auto value = silence.process(block,256,8,8);
  assert(!value.level && !value.signal && !value.rms);
  assert(!silence.process(block,0,8,8).level);
  // Right-slot garbage (unselected microphone channel) must have no effect.
  for (int i=0;i<256;++i) block[2*i+1]=INT32_MAX;
  assert(!silence.process(block,256,8,8).level);
  // DC input settles to silence without false audio activity.
  for (int i=0;i<256;++i) block[2*i]=1000*65536;
  AudioAnalysis dc;
  value=dc.process(block,256,8,8);
  assert(!value.rms && !value.signal && !value.level);
  // 1 kHz at 16 kHz sampling: known amplitude, signed samples, lower slot bits ignored.
  for(int i=0;i<256;++i) block[2*i]=int32_t(std::sin(i*6.28318530718/16)*1000)*65536;
  AudioAnalysis tone;
  value=tone.process(block,256,8,8);
  assert(value.rms>680 && value.rms<730 && value.signal && value.level==255);
  // Full scale alternation must not overflow; force otherwise irrelevant low bits.
  for(int i=0;i<256;++i) block[2*i]=i%2?INT32_MIN:INT32_MAX;
  AudioAnalysis clipped;
  value=clipped.process(block,256,64,8);
  assert(value.rms>30000 && value.peak>30000 && value.level==255);
  // A weak tone below the configured noise floor remains dark.
  for(int i=0;i<256;++i) block[2*i]=(i%2?2:-2)*65536;
  AudioAnalysis quiet;
  assert(!quiet.process(block,256,64,8).level);
  // Contrast preserves maximum, has an exact black floor, and is monotonic.
  for (uint16_t scale=100;scale<=400;scale+=5) {
    uint8_t previous=0;
    for (int input=0;input<=255;++input) {
      const auto output=AudioAnalysis::scaleLevel(input,scale);
      assert(output>=previous && output<=input);
      if(scale==100) assert(output==input);
      previous=output;
    }
    assert(previous==255);
    assert(AudioAnalysis::scaleLevel(0,scale)==0);
  }
  assert(AudioAnalysis::scaleLevel(127,200)==0);
  assert(AudioAnalysis::scaleLevel(191,200)==127);
  assert(AudioAnalysis::scaleLevel(170,300)==0);
  uint8_t level=0;
  for(int i=0;i<10;++i) level=smoothAudioLevel(level,200,16,50);
  assert(level>=198);
  for(int i=0;i<100;++i) level=smoothAudioLevel(level,0,16,50);
  assert(level==0);
  assert(smoothAudioLevel(0,255,100,50)==255);
  assert(smoothAudioLevel(128,255,0,50)==128);
  std::cout << "PASS: audio silence, DC, channel selection, tone RMS, overflow, gate, and real-time smoothing\n";
}
