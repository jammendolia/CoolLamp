#include "../UpdateIo.h"
#include <assert.h>
#include <stdio.h>

int main() {
  constexpr int readAgain=-0x6900, writeAgain=-0x6880;
  uint32_t time=0;
  int calls=0, waits=0;
  auto clock=[&]{return time;};
  auto wait=[&]{time+=10;++waits;};
  const int sequence[]={readAgain,writeAgain,512};
  assert(updateIo([&]{return sequence[calls++];},clock,wait,0,readAgain,writeAgain)==512);
  assert(calls==3 && waits==2);
  assert(updateIo([]{return 0;},clock,wait,0,readAgain,writeAgain)==0);
  assert(updateIo([]{return -123;},clock,wait,0,readAgain,writeAgain)==-123);
  time=0; calls=0;
  assert(updateIo([&]{++calls;return readAgain;},clock,wait,0,readAgain,writeAgain)==-1);
  assert(time==30000 && calls==3000);
  time=179990;calls=0;
  assert(updateIo([&]{++calls;return writeAgain;},clock,wait,0,readAgain,writeAgain)==-1);
  assert(time==180000 && calls==1);
  time=UINT32_MAX-5;const auto started=time;calls=0;
  assert(updateIo([&]{return ++calls==1?readAgain:32;},clock,wait,started,readAgain,writeAgain)==32);
  assert(calls==2 && time==4);
  puts("PASS: TLS retry, EOF/fatal errors, idle and total deadlines, timer wraparound.");
}
