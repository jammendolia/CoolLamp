#define ARDUINO 1
#include "firmware-relay-fixture.h"
#include "../LampSync.cpp"
#include <esp_now.h>
#include <cassert>
#include <iostream>
bool lampHasMicrophone(){return true;}
LampAudioFeatures getLampAudioFeatures(){LampAudioFeatures value{};return value;}
unsigned applied=0,restored=0;
void applyLampSyncControl(const Visual* value){if(value)++applied;else ++restored;}
void captureLampSyncVisual(Visual& value){value={};value.mode=46;value.power=1;value.brightness=100;value.speed=50;value.audioValid=1;value.level=140;}
const char* leaderId="112233445566";
uint8_t leaderMac[6]{},localMac[6]{};
LampSyncRadioCrypto::SendNonce leaderNonce;
Packet remote(Kind kind,uint32_t seq){Packet p=packet(kind,"Leader");strcpy(p.sender,leaderId);strcpy(p.leader,leaderId);p.role=1;p.session=700;p.target=nonce;p.sequence=seq;p.echo=ping;captureLampSyncVisual(p.visual);return p;}
void inject(Packet p){uint8_t bytes[LampSyncRadioCrypto::EnvelopeSize];assert(LampSyncRadioCrypto::seal(p,identity,keyBytes,bytes,sizeof(bytes),leaderNonce));FakeRadio::receive(leaderMac,bytes,sizeof(bytes));}
void beacon(){auto p=remote(Discover,1);FakeRadio::receive(leaderMac,reinterpret_cast<uint8_t*>(&p),sizeof(p));}
int main(){
 fakeEfuseMac=0xaabbccddee00ULL;WiFi.state=0;FakeRadio::associated=false;fakeNow=1000;beginLampSync();
 assert(LampSyncRadioCrypto::macFromIdentity(leaderId,leaderMac));assert(LampSyncRadioCrypto::macFromIdentity(identity,localMac));
 assert(configureLampSync(2,leaderId,"0123456789abcdef0123456789abcdef"));const auto saved=Preferences::storage;
 serviceLampSync("Follower",false);assert(!started&&LampEspNow::status().active);
 beacon();serviceLampSync("Follower",false);assert(discoveries==1&&ping==fakeNow);assert(peers[0].radioKnown&&!peers[0].udpKnown);
 bool subscribed=false;for(const auto& sent:FakeRadio::sent){Packet p{};if(LampSyncRadioCrypto::open(sent.data.data(),sent.data.size(),localMac,leaderId,keyBytes,p)&&p.kind==Subscribe)subscribed=true;}assert(subscribed);
 fakeNow+=20;inject(remote(ClockReply,50));serviceLampSync("Follower",false);assert(lampSyncFollowing()&&followingRadio&&receiver.clockReady&&applied==1);
 fakeNow+=40;auto frame=remote(Frame,51);frame.visual.level=210;inject(frame);serviceLampSync("Follower",false);assert(applied==2&&received.level==210);
 inject(frame);serviceLampSync("Follower",false);assert(applied==2); // duplicate cipher/packet cannot replay
 uint8_t encoded[LampSyncRadioCrypto::EnvelopeSize];frame.sequence=52;assert(LampSyncRadioCrypto::seal(frame,identity,keyBytes,encoded,sizeof(encoded),leaderNonce));encoded[sizeof(encoded)-1]^=1;
 FakeRadio::receive(leaderMac,encoded,sizeof(encoded));serviceLampSync("Follower",false);assert(applied==2&&authFailures==1);
 digest(frame,frame.mac);FakeRadio::receive(leaderMac,reinterpret_cast<uint8_t*>(&frame),sizeof(frame));serviceLampSync("Follower",false);assert(applied==2); // plaintext control downgrade rejected
 FakeRadio::scanning=true;serviceLampSync("Follower",false,true);assert(lampSyncFollowing());fakeNow+=220;serviceLampSync("Follower",false,true);assert(lampSyncFollowing()&&!received.audioValid);
 FakeRadio::scanning=false;serviceLampSync("Follower",false);assert(lampSyncFollowing()); // short scan holds clock/control, no blackout fallback
 pauseLampSync();assert(lampSyncPaused()&&!lampSyncFollowing());const auto pausedCount=applied;
 frame=remote(ClockReply,53);inject(frame);serviceLampSync("Follower",false);assert(applied==pausedCount&&!lampSyncFollowing());
 resumeLampSync();fakeNow+=1000;beacon();serviceLampSync("Follower",false);fakeNow+=20;inject(remote(ClockReply,54));serviceLampSync("Follower",false);assert(lampSyncFollowing());
 FakeRadio::channel=6;WiFi.state=WL_CONNECTED;serviceLampSync("Follower",false);serviceLampSync("Follower",false);assert(!lampSyncFollowing()&&started); // AP channel change needs fresh handshake
 serviceLampSync("Follower",true);assert(!LampEspNow::status().active&&!started);assert(Preferences::storage==saved); // resource blocks never rewrite settings
 WiFi.state=0;FakeRadio::associated=true;FakeRadio::channel=6;fakeNow+=1000;serviceLampSync("Follower",false);const auto sets=FakeRadio::channelSets;
 fakeNow+=1000;serviceLampSync("Follower",false);assert(!started&&FakeRadio::channelSets==sets); // association owns channel even before DHCP
 FakeRadio::associated=false;assert(configureLampSync(1,identity,"0123456789abcdef0123456789abcdef"));fakeNow+=1000;serviceLampSync("Leader",false);
 Packet subscribe=packet(Subscribe,"Radio follower");strcpy(subscribe.sender,leaderId);strcpy(subscribe.leader,identity);subscribe.role=2;subscribe.session=800;subscribe.target=nonce;
 LampSyncRadioCrypto::SendNonce followerSeal;uint8_t body[LampSyncRadioCrypto::EnvelopeSize];assert(LampSyncRadioCrypto::seal(subscribe,identity,keyBytes,body,sizeof(body),followerSeal));FakeRadio::receive(leaderMac,body,sizeof(body));
 fakeNow+=40;serviceLampSync("Leader",false);serviceLampSync("Leader",false);bool clock=false,stream=false;
 for(const auto& sent:FakeRadio::sent){Packet p{};if(!LampSyncRadioCrypto::open(sent.data.data(),sent.data.size(),localMac,leaderId,keyBytes,p))continue;if(p.kind==ClockReply&&p.target==800)clock=true;if(p.kind==Frame&&p.target==800&&p.visual.count==2)stream=true;}
 assert(clock&&stream&&sceneConfig.count==2&&!started);
 const String json=lampSyncJson();assert(json.find("\"transport\":\"esp-now\"")!=std::string::npos);assert(json.find("\"address\":\"\"")!=std::string::npos);assert(json.find("aes-gcm-128")!=std::string::npos);assert(json.find("0123456789abcdef0123456789abcdef")==std::string::npos);
 sequence=UINT32_MAX;const auto oldSession=nonce;const auto rollover=packet(Frame,"Leader");assert(rollover.sequence==1&&rollover.session!=oldSession); // no AEAD nonce wrap
 std::cout<<"PASS: offline sealed discovery/subscribe/clock/audio/frame path, replay/tamper/downgrade rejection, short scan holdover, pause/resume, AP/DHCP channel ownership, OTA shutdown/NVS isolation, encrypted coordinator stream and nonce rollover\n";
}
