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
inline uint8_t triangle(uint32_t phase){
 const uint32_t p=phase&65535;
 return uint8_t((p<32768?p:65535-p)>>7);
}
inline uint32_t circleDistance(uint32_t a,uint32_t b){
 const uint32_t d=distance(a&65535,b&65535);
 return d<65536-d?d:65536-d;
}
// Every new room scene has its own visible ambient field. Audio adds accents;
// stale input cannot create beats or extinguish the rest of the room.
inline RGB roomAudioPixel(const LampSyncWire::Visual& v,uint16_t h,uint32_t elapsed,uint32_t now){
 const uint32_t leg=2200-uint32_t(v.sceneSpeed)*16;
 const uint32_t phase=uint64_t(elapsed)*65536/(2*leg);
 const uint32_t slot=uint32_t(v.position)*65536/v.count;
 const uint32_t local=phase+slot;
 const bool audible=v.audioValid&&v.level;
 const uint32_t level=audible?v.level:0;
 const uint32_t largest=v.bass>v.mid?(v.bass>v.treble?v.bass:v.treble):(v.mid>v.treble?v.mid:v.treble);
 const uint32_t bass=audible&&largest?uint32_t(v.bass)*level/largest:0;
 const uint32_t mid=audible&&largest?uint32_t(v.mid)*level/largest:0;
 const uint32_t treble=audible&&largest?uint32_t(v.treble)*level/largest:0;
 const uint32_t beatAge=now-v.groupBeatAt;
 const bool beatReady=audible&&v.groupBeatLevel&&int32_t(beatAge)>=0;
 const uint32_t hit=beatReady?uint32_t(glow(beatAge,2*leg))*v.groupBeatLevel/255:0;
 const uint32_t beat=audible?v.groupBeat:0;
 uint32_t light=40+triangle(uint32_t(h)+local/2)/16;
 uint8_t tint=uint8_t((h>>9)+(local>>8));
 switch(v.scene){
 case 19: { // Bass cathedral: tall columns surge together, with staggered ridges.
   const uint32_t edge=bass*257;
   const uint32_t column=h<edge?90+bass/3:0;
   const uint32_t ridge=glow(circleDistance(h,local),16000);
   light+=column+bass*ridge/510+mid/5+hit/6;
   tint=uint8_t(triangle(uint32_t(h)+local/2)+bass/4);
   break;
 }
 case 20: { // Spectrum loom: three broad ribbons interleave on every lamp.
   const uint32_t a=glow(circleDistance(h,local),23000);
   const uint32_t b=glow(circleDistance(h,65535-local*2),20000);
   const uint32_t c=glow(circleDistance(h,local*3+21845),17000);
   light+=(bass*a+mid*b+treble*c)/510+level/5+hit/5;
   tint=uint8_t((h>>8)/3+triangle(local)/2+mid/3);
   break;
 }
 case 21: { // Resonant rings: shared onsets expand in different local phases.
   const uint32_t radius=(uint64_t(beatAge)*65536/leg+slot/4)&65535;
   const uint32_t ring=glow(distance(h,radius),22000);
   light+=level/6+hit*(80+ring*140/255)/255;
   tint=uint8_t((h>>9)+(local>>9)+beat*37);
   break;
 }
 case 22: { // Velvet thunder: broad bass pressure with fine treble shimmer.
   const uint32_t swell=triangle(phase/4+slot/8);
   const uint32_t shimmer=triangle(uint32_t(h)*4+local*3);
   light+=bass*(100+swell/2)/255+treble*shimmer/510+hit/5;
   tint=uint8_t(triangle(uint32_t(h)/2+local/3)+treble/4);
   break;
 }
 case 23: { // Prism chorus: all lamps sustain different palette harmonies.
   const uint32_t harmony=(beat%6)*42;
   light+=level*(120+triangle(uint32_t(h)+local)/3)/255+hit/6;
   tint=uint8_t((local>>8)+(h>>10)+harmony+bass/5+treble/3);
   break;
 }
 case 24: { // Twin vortex: counter-rotating helices, above a constant field.
   const uint32_t a=glow(circleDistance(h,local),20000);
   const uint32_t b=glow(circleDistance(h,65535-local+32768),20000);
   light+=((bass+mid)*a+(mid+treble)*b)/510+level/6+hit/5;
   tint=uint8_t(a>b?triangle(uint32_t(h)+local)/3:170+triangle(uint32_t(h)-local)/3);
   break;
 }
 case 25: { // Electric bloom: every lamp opens its own bloom on shared beats.
   const uint32_t center=14000+hash(uint32_t(v.position)*421+beat*37)%37535;
   const uint32_t radius=(255-hit)*150;
   const uint32_t petal=glow(distance(distance(h,center),radius),12000);
   light+=level/6+hit*petal/255+treble*triangle(uint32_t(h)*3+local)/765;
   tint=uint8_t((local>>8)+(h>>9)+beat*29);
   break;
 }
 case 26: { // Room groove: complementary roles with a shared rhythmic bed.
   const unsigned role=v.position%3;
   const uint32_t band=role==0?bass:role==1?mid:treble;
   const uint32_t motif=triangle(uint32_t(h)*(role+1)+local*(role+1)+beat*8192);
   light+=band*(80+motif/2)/255+level/4+hit*(48+role*24)/255;
   tint=uint8_t((local>>8)+(h>>10)+role*70+beat*23);
   break;
 }
 default:return {};
 }
 if(light>255)light=255;
 RGB c=mix(v.scenePrimary,v.sceneSecondary,tint);
 const uint32_t amount=light*v.sceneIntensity;
 c.r=uint32_t(c.r)*amount/25500;c.g=uint32_t(c.g)*amount/25500;c.b=uint32_t(c.b)*amount/25500;
 return c;
}
// Broad fields reveal curves along a corkscrew or helix without assuming its
// number of turns or azimuth. Every member keeps an illuminated palette field.
// Geometry, global brightness and power limiting remain the lamp's normal path.
inline RGB corkscrewPixel(const LampSyncWire::Visual& v,uint16_t h,uint32_t elapsed,uint32_t now){
 if(!v.power||!v.brightness)return {};
 const uint32_t leg=2200-uint32_t(v.sceneSpeed)*16;
 const uint32_t phase=uint64_t(elapsed)*65536/(4*leg);
 const uint32_t slot=uint32_t(v.position)*65536/v.count;
 const uint32_t local=phase+slot;
 const bool audible=v.scene>=29&&v.audioValid&&v.level;
 const uint32_t level=audible?v.level:0;
 const uint32_t largest=v.bass>v.mid?(v.bass>v.treble?v.bass:v.treble):(v.mid>v.treble?v.mid:v.treble);
 const uint32_t bass=audible&&largest?uint32_t(v.bass)*level/largest:0;
 const uint32_t mid=audible&&largest?uint32_t(v.mid)*level/largest:0;
 const uint32_t treble=audible&&largest?uint32_t(v.treble)*level/largest:0;
 const uint32_t beatAge=now-v.groupBeatAt;
 const bool beatReady=audible&&v.groupBeatLevel&&int32_t(beatAge)>=0&&beatAge<2*leg;
 const uint32_t hit=beatReady?uint32_t(glow(beatAge,2*leg))*v.groupBeatLevel/255:0;
 uint32_t light=0,tint=0;
 switch(v.scene){
 case 27: { // Chromatic screw: layered color bands climb every curved strip.
   const uint32_t band=triangle(uint32_t(h)*2-local);
   const uint32_t fold=triangle(uint32_t(h)*3-phase+slot/2+21845);
   light=58+band/5+fold/6;
   tint=32+triangle(uint32_t(h)*2-local)*191/255;
   break;
 }
 case 28: { // Mercury ribbon: liquid highlights flow in opposing directions.
   const uint32_t a=glow(circleDistance(h,local),18000);
   const uint32_t b=glow(circleDistance(h,65535-phase*2+slot+32768),22000);
   light=50+a*96/255+b*60/255;
   tint=64+triangle(uint32_t(h)+local/3)/4+b*96/255-a*32/255;
   break;
 }
 case 29: { // Bass turbine: bass compresses and widens broad pressure bands.
   const uint32_t pressure=uint32_t(h)*3+uint32_t(h)*bass/128+local*2;
   const uint32_t ridge=glow(circleDistance(pressure,32768),7500+bass*50);
   const uint32_t fine=triangle(uint32_t(h)*9-local*4);
   light=52+triangle(uint32_t(h)+local/2)/10+ridge*(55+bass/2)/255+treble*fine/1275+hit/7;
   tint=32+triangle(uint32_t(h)*2+local+mid*96)*191/255;
   break;
 }
 case 30: { // Prism torque: shared beat parity reverses a fading twist accent.
   // The slower complementary wash always flows, even after a beat expires.
   const uint32_t turn=beatReady&&(v.groupBeat&1)?local*2:65535-local*2;
   const uint32_t ridge=glow(circleDistance(uint32_t(h)*2,turn+slot),16000);
   const uint32_t fine=triangle(uint32_t(h)*5+local*3);
   light=55+triangle(uint32_t(h)*2+local)/8+mid*triangle(uint32_t(h)-local)/765+hit*ridge/425+treble*fine/1530;
   tint=32+triangle(uint32_t(h)*2-phase+slot+bass*80)*159/255+((v.position&1)?31:0);
   break;
 }
 case 31: { // Echo coils: a beat releases a ripple train on every lit lamp.
   const uint32_t travel=beatReady?uint64_t(beatAge)*65536/leg:0;
   const uint32_t first=glow(circleDistance(uint32_t(h)*3+slot/3,travel),10000+bass*20);
   const uint32_t second=glow(circleDistance(uint32_t(h)*3+slot/3,travel+21845),9000);
   const uint32_t echo=hit*(first*140+second*70)/65025;
   const uint32_t fine=triangle(uint32_t(h)*6-local*2);
   light=50+triangle(uint32_t(h)+local)/9+echo+treble*fine/1530;
   tint=48+triangle(uint32_t(h)+local/2+mid*64)/3+echo*64/255;
   break;
 }
 case 32: { // Aurora braid: three smooth curtains breathe with spectral bands.
   const uint32_t a=triangle(uint32_t(h)+local/3);
   const uint32_t b=triangle(uint32_t(h)*2-local/2+21845);
   const uint32_t c=triangle(uint32_t(h)*3+local/4+43690);
   light=60+triangle(uint32_t(h)/2+phase/5+slot/3)/5+
     (a*(32+bass/3)+b*(20+mid/4)+c*(16+treble/5))/510+level/10+hit/12;
   const uint32_t blend=(a*(64+bass)+b*(32+mid)+c*(24+treble))/(120+bass+mid+treble);
   tint=32+blend*191/255;
   break;
 }
 default:return {};
 }
 // Keep saturated, colored light below a full-brightness pulse. Avoid palette
 // endpoints so a single black endpoint cannot blank the ambient field.
 if(light>230)light=230;
 if(tint<16)tint=16;else if(tint>239)tint=239;
 RGB c=mix(v.scenePrimary,v.sceneSecondary,uint8_t(tint));
 const uint32_t amount=light*v.sceneIntensity;
 c.r=uint32_t(c.r)*amount/25500;c.g=uint32_t(c.g)*amount/25500;c.b=uint32_t(c.b)*amount/25500;
 return c;
}
inline RGB pixel(const LampSyncWire::Visual& v,uint16_t h,uint32_t now){
 if(!v.scene||v.count<2||v.count>9||v.position>=v.count||int32_t(now-v.groupStart)<0)return {};
 const uint32_t elapsed=now-v.groupStart;
 if(v.scene>=19&&v.scene<=26)return roomAudioPixel(v,h,elapsed,now);
 if(v.scene>=27&&v.scene<=32)return corkscrewPixel(v,h,elapsed,now);
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
