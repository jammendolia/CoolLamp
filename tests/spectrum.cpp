#include <cassert>
#include <cmath>
#include <iostream>
#include "../AudioSpectrum.h"
int main(){
  int32_t samples[512]{};
  AudioSpectrum silent;auto zero=silent.process(samples,256,0,1000);
  assert(!zero.bass&&!zero.mid&&!zero.treble&&!zero.beat&&!zero.bassBeat);
  for(int band=0;band<3;++band){
    AudioSpectrum spectrum;AudioSpectrum::Result result{};
    const int hz[3]={100,1000,6000};
    for(unsigned block=0;block<100;++block){
      for(unsigned i=0;i<256;++i)samples[2*i]=int32_t(std::sin((block*256+i)*6.28318530718*hz[band]/16000)*10000)*65536;
      result=spectrum.process(samples,256,180,block*16);
    }
    const uint16_t levels[3]={result.bass,result.mid,result.treble};
    std::cout<<hz[band]<<" Hz: "<<levels[0]<<","<<levels[1]<<","<<levels[2]<<"\n";
    for(int other=0;other<3;++other)if(other!=band)assert(levels[band]>levels[other]);
  }
  AudioSpectrum full;
  for(int i=0;i<256;++i)samples[2*i]=i%2?INT32_MAX:INT32_MIN;
  for(int i=0;i<100;++i)full.process(samples,256,255,i*16);
  AudioSpectrum beats;
  auto a=beats.process(samples,256,0,1000);assert(a.beat==0);
  auto b=beats.process(samples,256,200,1200);assert(b.beat==1);
  auto c=beats.process(samples,256,255,1216);assert(c.beat==1);
  for(int i=0;i<200;++i)c=beats.process(samples,256,0,1300+i*16);
  assert(c.beat==1);
  c=beats.process(samples,256,200,5000);assert(c.beat==2);
  std::cout<<"PASS: three-band separation, silence, full-scale arithmetic and onset refractory period\n";
}
