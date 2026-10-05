#define ARDUINO 1
#include "../LampSync.cpp"
#include <cassert>
#include <iostream>
bool microphone=true;
bool lampHasMicrophone(){return microphone;}
LampAudioFeatures getLampAudioFeatures(){LampAudioFeatures a{};a.valid=true;a.level=100;a.beat=1;return a;}
unsigned applied=0,restored=0;
void applyLampSyncControl(const Visual* v){if(v)++applied;else ++restored;}
void captureLampSyncVisual(Visual& v){v={};v.mode=46;v.power=1;v.brightness=150;v.speed=50;v.audioValid=1;v.level=140;}
void receive(Packet p,bool sign=true){if(sign)digest(p,p.mac);const auto* b=reinterpret_cast<uint8_t*>(&p);WiFiUDP::incoming.emplace_back(b,b+sizeof(p));}
Packet leaderPacket(Kind kind,uint64_t target,uint32_t seq){
 Packet p=packet(kind,"Coordinator");strcpy(p.sender,"112233445566");strcpy(p.leader,p.sender);p.role=1;p.session=888;p.target=target;p.sequence=seq;captureLampSyncVisual(p.visual);return p;
}
int main(){
 beginLampSync();const String key="0123456789abcdef0123456789abcdef";
 assert(!configureLampSync(2,"aabbccddeeff",key));assert(!configureLampSync(1,"112233445566",key));
 assert(configureLampSync(2,"112233445566",key));const auto saved=Preferences::storage["syncV1"];
 fakeNow=2000;serviceLampSync("Follower",false);
 auto beacon=leaderPacket(Discover,0,1);receive(beacon,false);serviceLampSync("Follower",false);
 fakeNow=3000;serviceLampSync("Follower",false);assert(ping==3000);
 auto response=leaderPacket(ClockReply,nonce,10);response.echo=ping;
 receive(response);fakeNow=3020;serviceLampSync("Follower",false);
 assert(lampSyncFollowing()&&applied==1);assert(receiver.clockReady);
 assert(Preferences::storage["syncV1"]==saved);
 auto update=leaderPacket(Frame,nonce,11);update.visual.level=210;receive(update);fakeNow=3040;serviceLampSync("Follower",false);
 assert(applied==2&&lampSyncVisual->level==210);
 receive(update);serviceLampSync("Follower",false);assert(applied==2); // duplicate
 update.sequence=12;digest(update,update.mac);update.visual.level=1;receive(update,false);serviceLampSync("Follower",false);assert(applied==2); // tampered
 update=leaderPacket(Frame,nonce+1,12);receive(update);serviceLampSync("Follower",false);assert(applied==2); // other follower
 Preferences::failWrites=true;assert(!configureLampSync(0,"",""));assert(lampSyncFollowing());Preferences::failWrites=false;
 fakeNow=3241;serviceLampSync("Follower",false);assert(!lampSyncVisual->audioValid&&lampSyncVisual->level==0); // silence before group loss
 fakeNow=6041;serviceLampSync("Follower",false);assert(!lampSyncFollowing()&&restored==1);assert(Preferences::storage["syncV1"]==saved);
 // A previous session's valid signed packets cannot reactivate this lamp.
 update=leaderPacket(ClockReply,response.target,99);update.echo=ping;receive(update);serviceLampSync("Follower",false);assert(!lampSyncFollowing());
 fakeNow=7041;serviceLampSync("Follower",false);response=leaderPacket(ClockReply,nonce,100);response.echo=ping;receive(response);fakeNow+=20;serviceLampSync("Follower",false);assert(lampSyncFollowing());
 pauseLampSync();assert(!lampSyncFollowing()&&paused);resumeLampSync();assert(!paused);
 fakeNow=8041;serviceLampSync("Follower",false);response=leaderPacket(ClockReply,nonce,101);response.echo=ping;receive(response);fakeNow+=20;serviceLampSync("Follower",false);assert(lampSyncFollowing());
 serviceLampSync("Follower",true);assert(!lampSyncFollowing()&&!started); // OTA/setup release resources
 assert(configureLampSync(0,"",""));assert(config.role==0);assert(Preferences::storage["syncV1"]!=saved);
 // Leader admission and authenticated stream use the subscriber nonce.
 assert(configureLampSync(1,"aabbccddeeff",key));serviceLampSync("Leader",false);
 auto subscribe=packet(Subscribe,"Follower");strcpy(subscribe.sender,"112233445566");subscribe.role=2;subscribe.session=777;subscribe.target=nonce;receive(subscribe);
 fakeNow+=40;serviceLampSync("Leader",false);
 bool found=false;for(const auto& b:WiFiUDP::outgoing){Packet p{};memcpy(&p,b.data(),sizeof(p));if(p.kind==Frame&&p.target==777){found=true;assert(authenticated(p));assert(p.visual.mode==46);}}
 assert(found);
 assert(sceneConfig.count==2);
 const uint8_t primary[]={1,2,3},secondary[]={4,5,6};
 assert(configureLampScene(1,60,80,primary,secondary));
 assert(lampGroupScene()==1);
 const auto sceneSaved=Preferences::storage["groupSceneV1"];
 Preferences::failWrites=true;assert(!configureLampScene(8,60,80,primary,secondary));assert(lampGroupScene()==1);Preferences::failWrites=false;
 assert(!configureLampOrder("aabbccddeeff,aabbccddeeff"));
 assert(!configureLampOrder("aabbccddeeff,998877665544"));
 assert(!configureLampOrder("aabbccddeeff")); // connected follower must remain
 assert(configureLampOrder("112233445566,aabbccddeeff"));
 assert(lampGroupVisual().position==1);
 microphone=false;assert(!configureLampScene(3,50,80,primary,secondary));assert(configureLampScene(5,50,80,primary,secondary));microphone=true;
 fakeNow+=40;WiFiUDP::outgoing.clear();serviceLampSync("Leader",false);
 for(const auto& b:WiFiUDP::outgoing){Packet p{};memcpy(&p,b.data(),sizeof(p));if(p.kind==Frame){assert(p.visual.position==0&&p.visual.count==2&&p.visual.scene==5);assert(authenticated(p));}}
 // All new IDs survive persistence and use the existing authenticated packet layout.
 for(unsigned id=9;id<=18;++id){assert(configureLampScene(id,50,80,primary,secondary));beginLampSync();assert(lampGroupScene()==id);}
 assert(!configureLampScene(19,50,80,primary,secondary));
 microphone=false;assert(!configureLampScene(16,50,80,primary,secondary));assert(!configureLampScene(17,50,80,primary,secondary));microphone=true;
 assert(std::string(lampSyncJson().c_str()).find("sceneCount")!=std::string::npos);
 const auto orderSaved=Preferences::storage["groupSceneV1"];beginLampSync();assert(sceneConfig.count==2&&positionOf("aabbccddeeff")==1);assert(Preferences::storage["groupSceneV1"]==orderSaved);
 assert(lampSyncInvite()==String("CL1-aabbccddeeff-")+key);
 std::cout<<"PASS: actual sync service handshake, authentication rejection, stale audio, reconnect, failed save, pause, OTA shutdown, leader stream and NVS isolation\n";
}
