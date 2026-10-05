#include "../LampSyncProtocol.h"
#include <cassert>
#include <iostream>
#include <limits>
using namespace LampSyncWire;
Packet frame(){
  Packet p{};memcpy(p.magic,"CLSY",4);p.version=2;p.kind=Frame;p.role=1;
  strcpy(p.sender,"aabbccddeeff");strcpy(p.leader,p.sender);strcpy(p.name,"Studio");
  p.session=123;p.target=456;p.sequence=1;p.time=1000;
  p.visual.mode=46;p.visual.brightness=100;p.visual.speed=50;p.visual.power=1;
  return p;
}
int main(){
  auto p=frame();assert(valid(p,sizeof(p)));
  assert(!valid(p,sizeof(p)-1));assert(!valid(p,sizeof(p)+1));
  auto bad=p;bad.version=1;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.kind=5;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.name[48]='x';assert(!valid(bad,sizeof(bad)));
  bad=p;bad.sender[12]='x';assert(!valid(bad,sizeof(bad)));
  bad=p;bad.leader[0]='Z';assert(!valid(bad,sizeof(bad)));
  bad=p;bad.visual.mode=48;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.visual.mode=0;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.visual.speed=0;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.visual.speed=101;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.visual.brightness=0;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.visual.primary[0]=2;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.visual.power=2;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.target=0;assert(!valid(bad,sizeof(bad)));
  assert(rate(50)==256&&rate(100)==1024&&rate(1)==36);
  bad=p;bad.visual.scene=19;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.visual.count=10;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.visual.count=2;bad.visual.position=2;assert(!valid(bad,sizeof(bad)));
  bad=p;bad.visual.scene=1;bad.visual.count=2;bad.visual.sceneSpeed=50;assert(valid(bad,sizeof(bad)));
  bad.visual.sceneIntensity=101;assert(!valid(bad,sizeof(bad)));
  Receiver r;assert(r.stale(0));
  assert(!r.accept(p,10,999));assert(r.accept(p,10,456));
  assert(!r.accept(p,11,456)); // duplicate cannot refresh heartbeat
  assert(r.last==10);
  p.sequence=2;assert(r.accept(p,20,456));
  p.sequence=1;assert(!r.accept(p,30,456));
  p.sequence=3;p.session=789;assert(!r.accept(p,30,456)); // old or new boot needs fresh handshake
  assert(!r.stale(3020)&&r.stale(3021));
  r.reset();assert(!r.accept(p,4000,555)); // replay with old subscription nonce
  r.clock(50000,1000,1040);assert(r.clockReady);assert(uint32_t(1040+r.offset)==50020);
  r.clock(90000,2000,2240);assert(uint32_t(1040+r.offset)==50020); // discard high RTT
  r.clock(51020,2000,2040);assert(uint32_t(2040+r.offset)==51025); // bounded slew
  r.reset();p=frame();p.sequence=UINT32_MAX;
  assert(r.accept(p,UINT32_MAX-100,456));p.sequence=0;assert(r.accept(p,20,456));
  assert(!r.stale(3020)&&r.stale(3021)); // millis and sequence wrap
  r.reset();r.clock(30,UINT32_MAX-19,20);assert(uint32_t(20+r.offset)==50);
  std::cout<<"PASS: packet ranges, subscription nonce, duplicate/replay rejection, timeout, bounded clock correction and rollover\n";
}
