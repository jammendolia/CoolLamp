#include "../LampGroupScenes.h"
#include <cassert>
#include <set>
#include <iostream>
using namespace LampGroupScenes;
using LampSyncWire::Visual;
unsigned energy(RGB c){return unsigned(c.r)+c.g+c.b;}
Visual scene(unsigned id){
 Visual v{};v.scene=id;v.count=2;v.sceneSpeed=50;v.sceneIntensity=100;v.groupStart=1000;
 v.scenePrimary[0]=255;v.scenePrimary[1]=90;v.scenePrimary[2]=10;
 v.sceneSecondary[0]=30;v.sceneSecondary[1]=80;v.sceneSecondary[2]=255;
 v.audioValid=1;v.level=180;v.bass=100;v.mid=20;v.treble=50;
 v.groupBeatLevel=180;v.groupBeat=0;v.groupBeatAt=1000;v.groupMotionAt=1000;
 return v;
}
int main(){
 // Every physical LED maps to the correct mirrored height, even with unequal halves.
 for(uint16_t count: {1,2,3,5,134,1024})for(uint16_t center: {0,1,2,65,1023}){
   const auto split=lampSplitCount(count,center);
   assert(height(0,count,center)==0);
   if(count>1)assert(height(count-1,count,center)==0);
   if(split>1)assert(height(split-1,count,center)==65535);
   if(count-split>1)assert(height(split,count,center)==65535);
   for(uint16_t i=0;i<count;++i)for(unsigned id=1;id<=18;++id){
     auto v=scene(id);
     (void)pixel(v,height(i,count,center),0xfffffff0);
     (void)pixel(v,height(i,count,center),2000);
   }
 }
 // Portal crosses from the controller's top into the follower's top, then descends.
 auto portal=scene(1);const unsigned leg=1400;
 assert(energy(pixel(portal,32768,1000+leg/2))>0);
 portal.position=1;assert(energy(pixel(portal,32768,1000+leg/2))==0);
 assert(energy(pixel(portal,32768,1000+leg+leg/2))>0);
 portal.position=0;assert(energy(pixel(portal,32768,1000+leg+leg/2))==0);
 // Frequency split gives different heights for bass and treble.
 auto fountain=scene(3);
 assert(energy(pixel(fountain,40000,2000))>0);
 fountain.position=1;assert(energy(pixel(fountain,40000,2000))==0);
 // Duet alternates positions; strong hits light every position.
 auto duet=scene(4);assert(energy(pixel(duet,22000,1300))>0);
 duet.position=1;assert(energy(pixel(duet,22000,1300))==0);
 duet.groupBeatLevel=230;assert(energy(pixel(duet,22000,1300))>0);
 // Audio scenes go silent on invalid audio; no fabricated response.
 for(unsigned id: {3,4,7,16,17}){auto v=scene(id);v.audioValid=0;for(unsigned h=0;h<65536;h+=128)assert(!energy(pixel(v,h,1300)));}
 // Future starts, one-member groups and zero scene intensity remain dark.
 for(unsigned id=1;id<=18;++id){
   auto v=scene(id);assert(!energy(pixel(v,0,999)));
   v.count=1;assert(!energy(pixel(v,0,2000)));
   v.count=2;v.sceneIntensity=0;assert(!energy(pixel(v,0,2000)));
 }
 // Scenes differ in their spatial/temporal signatures and have no local mutable RNG.
 std::set<uint64_t> signatures;
 for(unsigned id=1;id<=18;++id){
   auto v=scene(id);uint64_t signature=1469598103934665603ULL;
   for(unsigned t=1100;t<7000;t+=137)for(unsigned pos=0;pos<2;++pos)for(unsigned h=0;h<65536;h+=4096){
     v.position=pos;const auto a=pixel(v,h,t),b=pixel(v,h,t);
     assert(a.r==b.r&&a.g==b.g&&a.b==b.b);
     signature=(signature^(unsigned(a.r)<<16|unsigned(a.g)<<8|a.b))*1099511628211ULL;
   }
   signatures.insert(signature);
 }
 assert(signatures.size()==18);
 // Cradle energy falls only on the source, then rises only on the far lamp.
 auto cradle=scene(9);
 assert(energy(pixel(cradle,49152,1000+leg/2))>0);
 cradle.position=1;assert(!energy(pixel(cradle,49152,1000+leg/2)));
 assert(energy(pixel(cradle,49152,1000+leg+leg/3+leg/2))>0);
 // Tides swap full and empty vessels after half a cycle.
 auto tide=scene(12);assert(!energy(pixel(tide,40000,1000)));
 tide.position=1;assert(energy(pixel(tide,40000,1000))>0);
 assert(!energy(pixel(tide,40000,1000+2*leg)));
 tide.position=0;assert(energy(pixel(tide,40000,1000+2*leg))>0);
 // Rocket leaves the source and bursts in the next lamp.
 auto rocket=scene(14);assert(energy(pixel(rocket,16384,1000+leg/2))>0);
 rocket.position=1;assert(!energy(pixel(rocket,16384,1000+leg/2)));
 assert(energy(pixel(rocket,65535,1000+leg+leg/4))>0);
 // Fixed-spectrum scene actually launches white, independent of palette choices.
 auto prism=scene(15);auto white=pixel(prism,32767,1000+leg/2);
 assert(white.r>0 && white.r==white.g && white.g==white.b);
 // Beat chase routes accents, including the opposite accent on strong beats.
 auto chase=scene(17);assert(energy(pixel(chase,18724,1300))>0);
 chase.position=1;assert(!energy(pixel(chase,18724,1300)));
 chase.groupBeat=1;assert(energy(pixel(chase,18724,1300))>0);
 chase.groupBeat=0;chase.groupBeatLevel=230;assert(energy(pixel(chase,18724,1300))>0);
 for(unsigned id:{16,17}){auto silent=scene(id);silent.level=0;silent.groupBeatLevel=0;assert(!energy(pixel(silent,0,1300)));}
 // Extremes: every position, low/high speed, nine members and maximum band values.
 for(unsigned id=9;id<=18;++id)for(unsigned count:{2,3,9})for(unsigned speed:{1,100}){
   auto v=scene(id);v.count=count;v.sceneSpeed=speed;v.bass=v.mid=v.treble=65535;
   for(unsigned pos=0;pos<count;++pos)for(unsigned t=1000;t<90000;t+=499){
     v.position=pos;(void)pixel(v,0,t);(void)pixel(v,32768,t);(void)pixel(v,65535,t);
   }
 }
 // Unsigned time rollover is valid across a recently scheduled start.
 auto wave=scene(8);wave.groupStart=0xffffff00;assert(energy(pixel(wave,30000,500))>0);
 std::cout<<"PASS: eighteen distinct deterministic scenes, spatial handoff, band split, alternating beats, silence, asymmetric geometry, intensity and clock rollover\n";
}
