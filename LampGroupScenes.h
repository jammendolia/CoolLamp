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
 RGB custom{};bool customColor=false;
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
 case 9: { // Newton's cradle: fall, bottom-to-bottom transfer, then rise at the far end.
   const uint32_t hop=leg/3,period=2*leg+(v.count-1)*hop;
   const uint32_t turn=elapsed/period,t=elapsed%period;
   const uint32_t slot=(turn&1)?v.count-1-v.position:v.position;
   if(t<leg && slot==0)light=glow(distance(h,65535-uint64_t(t)*t*65535/(leg*leg)),12000);
   else if(t>=leg && t<leg+(v.count-1)*hop){
     const uint32_t travel=t-leg,index=travel/hop;
     if(slot==index || slot==index+1)light=uint32_t(glow(h,14000))*glow(distance(travel%hop,slot==index?0:hop),hop)/255;
   }else if(t>=leg+(v.count-1)*hop && slot==uint32_t(v.count-1)){
     const uint32_t age=t-leg-(v.count-1)*hop,remaining=leg-age;
     light=glow(distance(h,65535-uint64_t(remaining)*remaining*65535/(leg*leg)),12000);
   }
   tint=(turn&1)?255:0;break;
 }
 case 10: { // Conversation: a three-note phrase travels through the lamps with varied replies.
   const uint32_t turn=elapsed/(leg*3),t=elapsed%(leg*3),note=t/leg;
   if(v.position!=turn%v.count)break;
   const uint32_t motif=hash(turn/v.count+note*37),duration=leg*(45+(motif%35))/100;
   const uint32_t age=t%leg;
   if(age<duration){light=glow(distance(h,uint64_t(age)*65535/duration),18000);tint=uint8_t(motif+v.position*39);}
   break;
 }
 case 11: { // Constellation: persistent stars traced one at a time across the room.
   const uint32_t step=leg/3,period=step*v.count*4,epoch=elapsed/period,t=elapsed%period;
   for(unsigned star=0;star<4;++star){
     const uint32_t seed=hash(epoch*997+v.position*41+star*173),point=3000+seed%59536;
     const uint8_t shape=glow(distance(h,point),3500);
     const uint32_t shimmer=(elapsed/(35+seed%30)+seed)%256;
     uint32_t strength=30+(shimmer<128?shimmer:255-shimmer)/3;
     if(t/step==v.position*4+star)strength=255;
     const auto value=uint32_t(shape)*strength/255;
     if(value>light){light=value;tint=seed>>24;}
   }break;
 }
 case 12: { // Tidal basin: normalized vessel levels conserve the shared volume.
   const uint32_t phase=uint64_t(elapsed%(4*leg))*65536/(4*leg);
   uint32_t total=0,weight=0;
   for(unsigned i=0;i<v.count;++i){const uint32_t p=(phase+i*65536/v.count)%65536,w=p<32768?p:65535-p;total+=w;if(i==v.position)weight=w;}
   const uint32_t edge=total?uint64_t(weight)*65535*v.count/(2*total):0;
   if(h<edge){light=100+uint32_t(h)*100/65535;tint=h>>8;}
   if(edge){const auto surface=glow(distance(h,edge),3500);if(surface>light){light=surface;tint=240;}}
   break;
 }
 case 13: { // Firefly courtship: staggered answers, then a shared flash.
   const uint32_t period=leg*(v.count+2),t=elapsed%period,round=elapsed/period;
   const bool chorus=t>=leg*v.count;
   const uint32_t age=chorus?(t-leg*v.count)%leg:t%leg;
   const uint8_t flash=(chorus||t/leg==v.position)?glow(distance(age,leg/3),leg/3):12;
   for(unsigned fly=0;fly<3;++fly){
     const uint32_t seed=hash(v.position*103+fly*57+round*19),base=9000+seed%47536;
     const uint32_t wander=(elapsed/(8+fly*3)+seed)%12000;
     const uint32_t point=base+(wander<6000?wander:11999-wander);
     const uint8_t value=uint32_t(glow(distance(h,point),4500))*flash/255;
     if(value>light){light=value;tint=uint8_t(seed);}
   }break;
 }
 case 14: { // Rocket relay: launch on one lamp, explode on the next, then hand off.
   const uint32_t period=leg*3,round=elapsed/period,t=elapsed%period,source=round%v.count;
   if(t<leg && v.position==source){light=glow(distance(h,uint64_t(t)*t*65535/(leg*leg)),11000);tint=0;}
   const uint32_t burstAt=leg+leg/4;
   if(t>=burstAt && v.position==(source+1)%v.count){
     const uint32_t age=t-burstAt,duration=period-burstAt,point=65535-uint64_t(age)*65535/duration;
     light=uint32_t(glow(distance(h,point),18000))*glow(age,duration)/255;
     light=uint32_t(light)*(130+(hash(h/1800+age/65+round*97)%126))/255;
     tint=uint8_t(h/256+round*67);
   }break;
 }
 case 15: { // Prism split: white enters, spectral colors spread, then reunite as white.
   const uint32_t duration=leg*v.count,t=elapsed%(2*duration+2*leg);
   if(t<leg){if(v.position==0)light=glow(distance(h,uint64_t(t)*65535/leg),15000);tint=0;}
   else if(t<leg+2*duration){
     const uint32_t age=t-leg,travel=age<duration?age:2*duration-1-age;
     const uint32_t point=uint64_t(travel)*span/duration;
     light=glow(distance(x,point),35000);tint=uint32_t(v.position)*255/(v.count-1);
   }else if(v.position==0){const uint32_t age=t-leg-2*duration;light=glow(distance(h,65535-uint64_t(age)*65535/leg),22000);}
   // Fixed optical spectrum; the app hides the two-color palette for this scene.
   if(t<leg || t>=leg+2*duration)custom={255,255,255};
   else {const unsigned hue=uint64_t(x)*1152/(span-1),segment=hue/256,f=hue%256;
     switch(segment){case 0:custom={255,uint8_t(f),0};break;case 1:custom={uint8_t(255-f),255,0};break;case 2:custom={0,255,uint8_t(f)};break;case 3:custom={0,uint8_t(255-f),255};break;default:custom={uint8_t(f),0,255};break;}}
   customColor=true;break;
 }
 case 16: { // Rhythm section: bass surges, mid ribbons and treble sparkle roles.
   if(!sound || !v.level)break;
   const unsigned role=v.count==2?v.position:v.position%3;
   const uint32_t largest=v.bass>v.mid?(v.bass>v.treble?v.bass:v.treble):(v.mid>v.treble?v.mid:v.treble);
   if(!largest)break;
   const uint32_t bass=uint32_t(v.level)*v.bass/largest,mid=uint32_t(v.level)*v.mid/largest,treble=uint32_t(v.level)*v.treble/largest;
   if(role==0){light=h<bass*257?bass:0;tint=0;}
   if(role==1){const uint32_t point=(uint64_t(elapsed)*65536/leg)%65536;light=uint32_t(glow(distance(h,point),18000))*mid/255;tint=140;}
   if(role==2 || (v.count==2 && role==1)){
     const uint32_t seed=hash(h/2600+elapsed/(leg/12+1)*31+v.position*997);
     const uint8_t spark=(seed%256<treble/3)?treble:0;
     if(spark>light){light=spark;tint=255;}
   }break;
 }
 case 17: { // Beat chase: alternate travel direction every eight beats; strong hits split.
   if(!sound || !beatReady)break;
   const uint32_t duration=1800-uint32_t(v.sceneSpeed)*15;
   if(beatAge>=duration)break;
   const uint32_t step=v.groupBeat%v.count;
   const uint32_t target=((v.groupBeat/8)&1)?v.count-1-step:step;
   const uint32_t opposite=v.count-1-target;
   if(v.position!=target && !(v.groupBeatLevel>=220 && v.position==opposite))break;
   light=uint32_t(glow(distance(h,uint64_t(beatAge)*65535/duration),24000))*v.groupBeatLevel/255;
   tint=v.position==target?0:255;break;
 }
 case 18: { // Shared heartbeat: double pulses converge in time, then spread apart.
   const uint32_t period=leg*3,breath=(elapsed/period)%16;
   const uint32_t spread=breath<8?8-breath:breath-8;
   const uint32_t offset=v.position*leg*spread/(v.count*8);
   const uint32_t t=(elapsed%period+period-offset)%period;
   const uint8_t first=glow(distance(t,leg/3),leg/4),second=glow(distance(t,leg),leg/3);
   light=first>second?first:uint32_t(second)*3/4;
   light=uint32_t(light)*(150+uint32_t(h)*105/65535)/255;tint=uint8_t(v.position*255/(v.count-1));break;
 }
 default: return {};
 }
 RGB c=customColor?custom:mix(v.scenePrimary,v.sceneSecondary,tint);
 const uint32_t amount=uint32_t(light)*v.sceneIntensity;
 c.r=uint32_t(c.r)*amount/25500;c.g=uint32_t(c.g)*amount/25500;c.b=uint32_t(c.b)*amount/25500;
 return c;
}
}
