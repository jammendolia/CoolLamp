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
  assert(value.rms>680 && value.rms<730 && value.signal && value.level>=200 && value.level<=205);
  // Fixed/manual math remains testable; AGC must work on unclipped RMS.
  AudioAnalysis manual;
  assert(manual.process(block,256,8,8,100,false).level==255);
  for (int i=0;i<10000;++i) {value=tone.process(block,256,30,8);assert(value.level<220);}
  // Full scale alternation must not overflow; force otherwise irrelevant low bits.
  for(int i=0;i<256;++i) block[2*i]=i%2?INT32_MIN:INT32_MAX;
  AudioAnalysis clipped;
  value=clipped.process(block,256,64,8);
  assert(value.rms>30000 && value.peak>30000 && value.level>=200 && value.level<=205);
  // A weak tone below the configured noise floor remains dark.
  for(int i=0;i<256;++i) block[2*i]=(i%2?2:-2)*65536;
  AudioAnalysis quiet;
  assert(!quiet.process(block,256,64,8).level);
  // Sustained loud audio settles below saturation at every contrast setting;
  // long silence stays black and cannot cause runaway gain on resumption.
  for(uint16_t contrast:{100,120,200,400}) {
    AudioAnalysis agc;
    for(int i=0;i<256;++i)block[2*i]=(i%2?100:-100)*65536;
    for(int n=0;n<300;++n)agc.process(block,256,30,8,contrast);
    for(int i=0;i<256;++i)block[2*i]=(i%2?3000:-3000)*65536;
    for(int n=0;n<300;++n)value=agc.process(block,256,30,8,contrast);
    assert(value.level>=195 && value.level<=210);
    for(int i=0;i<256;++i)block[2*i]=0;
    for(int n=0;n<10000;++n){value=agc.process(block,256,30,8,contrast);if(n>100)assert(value.level==0);}
    for(int i=0;i<256;++i)block[2*i]=(i%2?3000:-3000)*65536;
    value=agc.process(block,256,30,8,contrast);assert(value.level<230);
  }
  // A quieter source recovers toward the target, but never exceeds sensitivity.
  AudioAnalysis recovery;
  for(int i=0;i<256;++i)block[2*i]=(i%2?3000:-3000)*65536;
  recovery.process(block,256,30,8);
  for(int i=0;i<256;++i)block[2*i]=(i%2?100:-100)*65536;
  const auto first=recovery.process(block,256,30,8).level;
  for(int n=0;n<4000;++n)value=recovery.process(block,256,30,8);
  assert(value.level>first && value.level>=195 && value.level<=210);
  assert(recovery.effectiveGainHundredths(30)<=3000);
  // Reproduce the reported sequence using nonzero broadband room noise,
  // not digital silence: quiet start -> clap -> five minutes of background.
  {
    uint32_t seed=12345;
    auto noise=[&](int amplitude){for(int i=0;i<256;++i){seed=seed*1664525U+1013904223U;block[2*i]=(int((seed>>16)%2001)-1000)*amplitude/1000*65536;}};
    AudioAnalysis old;
    noise(6000);old.process(block,256,30,8,120);
    uint8_t initial=0;
    for(int n=0;n<2000;++n){noise(180);value=old.process(block,256,30,8,120);if(n==10)initial=value.level;}
    assert(value.level>initial+100 && value.level>180); // 1.6.3 promotes room noise.
    AudioAnalysis fixed;AudioNoiseFloor floor;
    for(int n=0;n<20;++n){noise(180);fixed.process(block,256,30,8,120);}
    for(int n=0;n<63;++n){noise(180);value=fixed.process(block,256,30,8,120);floor.observe(value.rms,256);}
    assert(floor.calibrated() && floor.rms()>80 && floor.rms()<120);
    assert(floor.cutoff(8)>160 && floor.cutoff(1000)==1000);
    fixed.resetGain();
    noise(6000);value=fixed.process(block,256,30,floor.cutoff(8),120);assert(value.level>150);
    for(int n=0;n<18750;++n){
      noise(180+(n%4)*10);value=fixed.process(block,256,30,floor.cutoff(8),120);floor.observe(value.rms,256);
      if(n>100)assert(value.level==0);
    }
    // Real sound still responds after prolonged quiet, and sustained audio
    // never raises the learned floor and gets classified as background.
    const auto baseline=floor.rms();
    for(int n=0;n<1000;++n){noise(6000);value=fixed.process(block,256,30,floor.cutoff(8),120);floor.observe(value.rms,256);}
    assert(value.level>150 && floor.rms()==baseline);
    // Starting capture in music may set a high floor, but subsequent quiet
    // lowers it within a window, allowing later sound through again.
    AudioNoiseFloor loudStart;
    for(int n=0;n<63;++n)loudStart.observe(3000,256);
    assert(loudStart.cutoff(8)==6004);
    for(int n=0;n<63;++n)loudStart.observe(100,256);
    assert(loudStart.cutoff(8)==204);
    AudioNoiseFloor empty;empty.observe(10,0);assert(!empty.calibrated());
    for(int n=0;n<63;++n)empty.observe(65535,256);
    assert(empty.cutoff(8)==65535);
  }
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
  AudioPeakHold hold;
  assert(hold.process(0,100)==0);
  assert(hold.process(240,116)==240);
  assert(hold.process(0,132)==240);
  assert(hold.process(0,180)==240);
  assert(hold.process(0,196)==0);
  assert(hold.process(90,212)==90);
  assert(hold.process(180,228)==180);
  assert(hold.process(0,307)==180);
  assert(hold.process(0,308)==0);
  AudioPeakHold wrap;
  assert(wrap.process(200,0xfffffff0U)==200);
  assert(wrap.process(0,32)==200);
  assert(wrap.process(0,64)==0);
  // A 16 ms clap remains visible to a renderer arriving 48 ms later.
  AudioPeakHold clap;
  clap.process(255,1000);clap.process(0,1016);clap.process(0,1032);
  assert(smoothAudioLevel(0,clap.process(0,1048),16,50)>200);
  uint8_t level=0;
  for(int i=0;i<10;++i) level=smoothAudioLevel(level,200,16,50);
  assert(level>=198);
  for(int i=0;i<100;++i) level=smoothAudioLevel(level,0,16,50);
  assert(level==0);
  assert(smoothAudioLevel(0,255,100,50)==255);
  assert(smoothAudioLevel(128,255,0,50)==128);
  std::cout << "PASS: audio silence, DC, channel selection, tone RMS, overflow, gate, and real-time smoothing\n";
}
