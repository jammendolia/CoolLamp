#pragma once
#include "LampSyncProtocol.h"
#include "LampGeometry.h"

// Stateless spatial renderer: identical scene data/time always gives identical pixels.
// Heights are 0 at either strip end and 65535 at the configured center.
namespace LampGroupScenes {
struct RGB { uint8_t r=0,g=0,b=0; };
inline uint32_t hash(uint32_t x){x^=x>>16;x*=0x7feb352dU;x^=x>>15;x*=0x846ca68bU;return x^(x>>16);}
inline uint32_t distance(uint32_t a,uint32_t b){return a>b?a-b:b-a;}
inline uint8_t glow(uint32_t d,uint32_t width){return d>=width?0:255-d*255/width;}
inline RGB mix(const uint8_t* a,const uint8_t* b,uint8_t t){
 return {uint8_t((uint32_t(a[0])*(255-t)+uint32_t(b[0])*t)/255),
 uint8_t((uint32_t(a[1])*(255-t)+uint32_t(b[1])*t)/255),
 uint8_t((uint32_t(a[2])*(255-t)+uint32_t(b[2])*t)/255)};
}
inline uint16_t height(uint16_t led,uint16_t count,uint16_t midpoint){
 const uint16_t left=lampSplitCount(count,midpoint);
 const uint16_t size=led<left?left:count-left, h=led<left?led:count-1-led;
 return size>1?uint32_t(h)*65535/(size-1):0;
}
inline RGB pixel(const LampSyncWire::Visual& v,uint16_t h,uint32_t now){
 if(!v.scene||v.count<2||v.count>9||v.position>=v.count||int32_t(now-v.groupStart)<0)return {};
 const uint32_t elapsed=now-v.groupStart;
 const uint32_t leg=2200-uint32_t(v.sceneSpeed)*16; // 2184..600ms per lamp
 const uint32_t span=uint32_t(v.count)*65536;
 const uint32_t x=uint32_t(v.position)*65536+((v.position&1)?65535-h:h);
 const uint32_t cycle=elapsed/(leg*v.count);
 const uint32_t head=uint64_t(elapsed%(leg*v.count))*65536/leg;
 uint8_t light=0,tint=uint8_t(h>>8);
 const bool sound=v.audioValid!=0;
 const uint32_t beatAge=now-v.groupBeatAt;
 const bool beatReady=v.groupBeatLevel && int32_t(beatAge)>=0;
 switch(v.scene){
 case 1: { // Portal: one comet crosses a top/bottom boundary into the next lamp.
   const uint32_t behind=(head+span-x)%span;
   light=glow(behind,22000);
   tint=uint8_t(cycle*47);
   break;
 }
 case 2: { // Ping-pong: an audio-accelerated bounce across the whole ordered group.
   const uint32_t duration=leg*v.count;
   const uint32_t age=now-v.groupMotionAt;
   const uint32_t motion=v.groupMotion+(int32_t(age)>=0&&age<3000?uint64_t(age)*(256+(sound?v.level:0))/256:0);
   const uint32_t p=uint64_t(motion%(duration*2))*span/duration;
   const uint32_t ball=p<span?p:2*span-1-p;
   light=glow(distance(x,ball),18000);tint=p<span?30:225;
   break;
 }
 case 3: { // Frequency split: alternating bass and treble, with mids in the blend.
   if(!sound)break;
   const uint32_t largest=v.bass>v.treble?(v.bass>v.mid?v.bass:v.mid):(v.treble>v.mid?v.treble:v.mid);
   const uint32_t band=(v.position&1)?v.treble:v.bass;
   const uint32_t amplitude=largest?uint32_t(v.level)*band/largest:0;
   const int32_t edge=int32_t(amplitude*257)-h;
   light=edge>=0?255:glow(uint32_t(-edge),2500);
   if(!amplitude)light=0;
   const uint32_t ripple=(uint64_t(elapsed)*65536/leg+h)%65536;
   light=uint32_t(light)*(200+(ripple<32768?ripple:65535-ripple)*55/32768)/255;
   tint=(v.position&1)?225:25;
   break;
 }
 case 4: { // Duet: beat-addressed turns; strong accents unite the entire group.
   const uint32_t bloom=1600-uint32_t(v.sceneSpeed)*14;
   if(!sound||!beatReady||beatAge>=bloom)break;
   if(v.groupBeatLevel<220 && v.position!=v.groupBeat%v.count)break;
   const uint32_t ring=beatAge*65535/bloom;
   light=uint32_t(glow(distance(h,ring),26000))*v.groupBeatLevel/255;
   tint=uint8_t(v.groupBeat*57);
   break;
 }
 case 5: { // Orbit: two smooth bands circulate through the shared path.
   const uint32_t d=distance(x,head),wrapped=d<span-d?d:span-d;
   const uint32_t other=(head+span/2)%span,od=distance(x,other),ow=od<span-od?od:span-od;
   const uint8_t a=glow(wrapped,50000),b=glow(ow,50000);
   light=a>b?a:b;tint=a>b?0:255;
   break;
 }
 case 6: { // Storm front: a deterministic strike propagates through lamp order.
   const uint32_t period=5000-uint32_t(v.sceneSpeed)*25;
   const uint32_t storm=elapsed/period, local=elapsed%period;
   const uint32_t slot=(hash(storm)&1)?v.count-1-v.position:v.position;
   const int32_t age=int32_t(local)-int32_t(slot*150);
   if(age>=0&&age<450){
     const uint32_t flicker=uint32_t(age)%150;
     light=glow(flicker,95);
     light=uint32_t(light)*(160+(hash(storm+h/2500)&95))/255;
     tint=180;
   }
   break;
 }
 case 7: { // Ember exchange: local sound flames plus one shared travelling ember.
   if(!sound)break;
   const uint32_t flame=uint32_t(v.level)*(v.position&1?170:210);
   light=h<flame?uint32_t(v.level)*(100+(hash(h/1800+elapsed/65+v.position*997)&63))/255:0;
   tint=h>>8;
   if(beatReady&&beatAge<leg*2+350){
     const uint32_t source=v.groupBeat%v.count,target=(source+1)%v.count;
     uint32_t point=0;bool spark=false;
     if(v.position==source&&beatAge<leg){point=beatAge*65535/leg;spark=true;}
     if(v.position==target&&beatAge>=leg&&beatAge<leg*2){point=65535-(beatAge-leg)*65535/leg;spark=true;}
     if(spark){const auto particle=glow(distance(h,point),14000);if(particle>light){light=particle;tint=uint8_t(v.groupBeat*73);}}
     if(v.position==target&&beatAge>=leg*2){const auto burst=glow(beatAge-leg*2,350);if(burst>light){light=burst;tint=220;}}
   }
   break;
 }
 case 8: { // Color wave: delayed palette breathing, flowing across all lamps.
   const uint32_t phase=(elapsed*uint64_t(65536)/leg+span-x)%131072;
   tint=uint8_t((phase<65536?phase:131071-phase)>>8);
   light=255;
   break;
 }
 default: return {};
 }
 RGB c=mix(v.scenePrimary,v.sceneSecondary,tint);
 const uint32_t amount=uint32_t(light)*v.sceneIntensity;
 c.r=uint32_t(c.r)*amount/25500;c.g=uint32_t(c.g)*amount/25500;c.b=uint32_t(c.b)*amount/25500;
 return c;
}
}
