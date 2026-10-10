#define ARDUINO 1
#include "firmware-relay-fixture.h"
#include "../LampSync.cpp"
#include "../LampGroupScenes.h"
#include <esp_now.h>
#include <cassert>
#include <iostream>
#include <vector>

bool lampHasMicrophone(){return true;}
LampAudioFeatures getLampAudioFeatures(){LampAudioFeatures a{};a.valid=true;a.level=180;a.beat=3;return a;}
unsigned applied=0;
void applyLampSyncControl(const Visual* v){if(v)++applied;}
void captureLampSyncVisual(Visual& v){v={};v.mode=46;v.power=1;v.brightness=100;v.speed=50;v.audioValid=1;v.level=180;v.bass=100;v.mid=40;v.treble=70;}
void injectUdp(Packet p){digest(p,p.mac);const auto* b=reinterpret_cast<const uint8_t*>(&p);WiFiUDP::incoming.emplace_back(b,b+sizeof(p));}
void handle(Packet p){digest(p,p.mac);receivePacket(p,fakeNow,false,nullptr,0,IPAddress(192,168,1,3),"Fixture");}
Packet subscription(const char* name,uint64_t boot,uint64_t target){
  auto p=packet(Subscribe,"Member");strcpy(p.sender,name);p.role=2;p.session=boot;p.target=target;return p;
}
int main(){
  const String key="0123456789abcdef0123456789abcdef";
  fakeEfuseMac=0xaabbccddee00ULL;fakeNow=1000;WiFi.state=WL_CONNECTED;beginLampSync();
  assert(configureLampSync(1,identity,key,3));serviceLampSync("Leader",false);
  const uint64_t leaderBoot=nonce;char leader[13];strcpy(leader,identity);uint8_t leaderMac[6];assert(LampSyncRadioCrypto::macFromIdentity(leader,leaderMac));
  auto old=subscription("112233445566",100,leaderBoot);old.version=2;handle(old);
  assert(sceneConfig.count==1&&incompatibleSubscriptions==1);
  std::vector<Packet> clocks;
  for(unsigned member=0;member<31;++member){
    char id[13];snprintf(id,sizeof(id),"11223344%04x",16+member*2);
    auto request=subscription(id,1000+member,leaderBoot);
    if(member==9){Preferences::failWrites=true;handle(request);assert(sceneConfig.count==10);Preferences::failWrites=false;}
    handle(request);assert(sceneConfig.count==member+2);
    Packet reply{};memcpy(&reply,WiFiUDP::outgoing.back().data(),sizeof(reply));
    assert(reply.kind==ClockReply&&reply.visual.position==member+1&&reply.target==1000+member);clocks.push_back(reply);
  }
  assert(sceneConfig.count==32);const auto durable=Preferences::storage["groupSceneV2"];
  assert(durable.size()==sizeof(SceneConfig));
  auto overflow=subscription("5566778899aa",9000,leaderBoot);handle(overflow);assert(sceneConfig.count==32&&Preferences::storage["groupSceneV2"]==durable);
  const uint8_t primary[]={70,220,255},secondary[]={255,65,170};
  assert(configureLampScene(32,50,85,primary,secondary));
  String order;
  for(unsigned pos=32;pos--;) {if(order.length())order+=',';order+=sceneConfig.order[pos];}
  assert(order.length()==415&&configureLampOrder(order));
  assert(positionOf(leader)==31);assert(!configureLampSync(0,"","",3));assert(!configureLampSync(1,leader,key,2));
  // Confirm every durable position in the new order with fresh targeted replies.
  for(unsigned member=0;member<31;++member){auto req=subscription(clocks[member].sender,1000+member,leaderBoot); // replace reply sender with member ID
    snprintf(req.sender,13,"11223344%04x",16+member*2);handle(req);
    memcpy(&clocks[member],WiFiUDP::outgoing.back().data(),sizeof(Packet));
    assert(clocks[member].visual.position==30-member&&clocks[member].visual.count==32);
  }
  WiFiUDP::outgoing.clear();fakeNow+=40;serviceLampSync("Leader",false);
  Packet broadcast{};unsigned frames=0;
  for(const auto& bytes:WiFiUDP::outgoing){Packet p{};memcpy(&p,bytes.data(),sizeof(p));if(p.kind==Frame){broadcast=p;++frames;}}
  assert(frames==1&&broadcast.version==3&&broadcast.target==leaderBoot&&broadcast.visual.position==BroadcastPosition&&broadcast.visual.count==32);
  assert(authenticated(broadcast));
  uint8_t encoded[LampSyncRadioCrypto::EnvelopeSize],tampered[LampSyncRadioCrypto::EnvelopeSize];
  LampSyncRadioCrypto::SendNonce sealedNonce;
  assert(LampSyncRadioCrypto::sealBroadcast(broadcast,keyBytes,encoded,sizeof(encoded),sealedNonce));
  Packet decoded{};assert(LampSyncRadioCrypto::openBroadcast(encoded,sizeof(encoded),leaderMac,keyBytes,decoded));
  assert(!LampSyncRadioCrypto::open(encoded,sizeof(encoded),leaderMac,"112233440010",keyBytes,decoded));
  for(unsigned i=0;i<sizeof(encoded);++i){memcpy(tampered,encoded,sizeof(encoded));tampered[i]^=1;assert(!LampSyncRadioCrypto::openBroadcast(tampered,sizeof(tampered),leaderMac,keyBytes,decoded));}
  auto changed=broadcast;changed.visual.level++;assert(!LampSyncRadioCrypto::sealBroadcast(changed,keyBytes,tampered,sizeof(tampered),sealedNonce));
  const auto page=lampSyncJson();assert(page.find("\"peerTotal\":31")!=std::string::npos&&page.find("\"peerNext\":8")!=std::string::npos);
  const auto compact=lampSyncJson(0,1);assert(compact.find("\"peerNext\":1")!=std::string::npos&&compact.find("\"peerTruncated\":true")!=std::string::npos);
  assert(compact.substr(compact.find("\"order\":"))==page.substr(page.find("\"order\":"))&&sceneConfig.count==32);
  assert(lampSyncJson(0,0)==compact&&lampSyncJson(0,255)==page);
  assert(lampSyncJson(1).find("\"peerCursor\":1")!=std::string::npos&&lampSyncJson(1).find("\"peerNext\":9")!=std::string::npos);
  assert(page.length()<8192&&lampSyncJson(24).find("\"peerNext\":0")!=std::string::npos);
  // Offline positions retain their exact order and do not compact on timeout.
  fakeNow+=8000;serviceLampSync("Leader",false);assert(sceneConfig.count==32&&positionOf(leader)==31);
  beginLampSync();assert(wireVersion==3&&sceneConfig.count==32&&positionOf(leader)==31);

  // Exercise the actual admission/render handler for all 31 separate identities.
  // Each receives the same single broadcast; no follower microphone is needed.
  for(unsigned member=0;member<31;++member){
    Preferences::storage.clear();config=Config{};sceneConfig=SceneConfig{};
    fakeEfuseMac=0x112233440010ULL+member*2;fakeNow=1040;beginLampSync();
    assert(configureLampSync(2,leader,key,3));const auto localBoot=nonce;
    auto reply=clocks[member];reply.target=localBoot;ping=reply.echo=1000;
    const auto before=applied;handle(broadcast);assert(applied==before); // broadcast never establishes a subscription
    Preferences::failWrites=true;handle(reply);assert(!receiver.locked&&applied==before);Preferences::failWrites=false;
    handle(reply);assert(receiver.locked&&slotSaved&&followerSlot.position==30-member);
    const auto slot=Preferences::storage["groupSlotV1"];
    auto next=broadcast;next.sequence=reply.sequence+1;handle(next);
    assert(lampSyncVisual&&lampSyncVisual->count==32&&lampSyncVisual->position==30-member&&lampSyncVisual->audioValid);
    const auto after=applied;handle(next);assert(applied==after); // duplicates cannot refresh the receipt or clock
    next.sequence++;next.visual.groupStart++;handle(next);assert(applied==after); // reordered layout waits for targeted confirmation
    next.visual.groupStart--;next.session++;next.target=next.session;handle(next);assert(applied==after); // wrong boot/session
    next.session--;next.target=next.session;
    Preferences::failWrites=true;assert(!configureLampSyncPause(true)&&!paused&&lampSyncFollowing());Preferences::failWrites=false;
    pauseLampSync();handle(next);assert(!lampSyncFollowing()&&paused);assert(Preferences::storage["groupSlotV1"]==slot);
    beginLampSync();assert(paused&&config.role==2&&!lampSyncFollowing());
    resumeLampSync();assert(!lampSyncFollowing());handle(next);assert(!lampSyncFollowing()); // needs new follower nonce
    fakeNow+=4000;serviceLampSync("Follower",false);assert(config.role==2&&Preferences::storage["groupSlotV1"]==slot);
    beginLampSync();assert(config.role==2&&wireVersion==3&&slotSaved&&followerSlot.position==30-member);
    // Renderer covers every scene at all 32 positions, odd/mixed geometry and wrap.
    for(unsigned count:{20U,32U})for(unsigned scene=1;scene<=32;++scene)for(unsigned position=0;position<count;++position){
      auto visual=broadcast.visual;visual.position=position;visual.count=count;visual.scene=scene;
      for(uint16_t leds:{1,3,205,1024}){const auto h=LampGroupScenes::height(leds/2,leds,0);const auto a=LampGroupScenes::pixel(visual,h,2000),b=LampGroupScenes::pixel(visual,h,2000);assert(a.r==b.r&&a.g==b.g&&a.b==b.b);(void)LampGroupScenes::pixel(visual,h,UINT32_MAX-10);}
    }
  }
  // Actual callback/radio adapter path with 31 distinct targeted destinations.
  // The driver table remains broadcast + eight rotating cached destinations.
  Preferences::storage.clear();config=Config{};fakeEfuseMac=0xaabbccddee00ULL;fakeNow=20000;WiFi.state=0;beginLampSync();
  assert(configureLampSync(1,identity,key,3));serviceLampSync("Radio leader",false);
  FakeRadio::sent.clear();assert(LampSyncRadioCrypto::macFromIdentity(identity,leaderMac));
  for(unsigned member=0;member<31;++member){
    char id[13];uint8_t mac[6];snprintf(id,13,"11223344%04x",16+member*2);assert(LampSyncRadioCrypto::macFromIdentity(id,mac));
    auto request=subscription(id,6000+member,nonce);LampSyncRadioCrypto::SendNonce previous;
    assert(LampSyncRadioCrypto::seal(request,identity,keyBytes,encoded,sizeof(encoded),previous));
    FakeRadio::receive(mac,encoded,sizeof(encoded));fakeNow+=10;serviceLampSync("Radio leader",false);serviceLampSync("Radio leader",false);
    assert(FakeRadio::peers.size()<=9);
  }
  for(unsigned pass=0;pass<30;++pass){fakeNow+=2;serviceLampSync("Radio leader",false);}
  assert(sceneConfig.count==32);
  for(unsigned member=0;member<31;++member){
    char id[13];snprintf(id,13,"11223344%04x",16+member*2);bool confirmed=false;
    for(const auto& sent:FakeRadio::sent){Packet p{};if(LampSyncRadioCrypto::open(sent.data.data(),sent.data.size(),leaderMac,id,keyBytes,p)&&p.kind==ClockReply&&p.target==6000+member)confirmed=true;}
    assert(confirmed);
  }
  unsigned radioFrames=0;
  for(const auto& sent:FakeRadio::sent){Packet p{};if(LampSyncRadioCrypto::openBroadcast(sent.data.data(),sent.data.size(),leaderMac,keyBytes,p)){++radioFrames;for(auto byte:sent.destination)assert(byte==255);}}
  assert(radioFrames>0&&radioFrames<=12);
  // An explicit return to compatibility mode must read the newest versioned
  // layout/settings; an old groupSceneV1 cannot resurrect a previous room.
  fakeNow+=8000;serviceLampSync("Radio leader",false);
  assert(!configureLampOrder(identity));
  while(sceneConfig.count>1){String expected;for(unsigned i=0;i<sceneConfig.count;++i){if(i)expected+=',';expected+=sceneConfig.order[i];}
    char session[17];snprintf(session,sizeof(session),"%016llx",static_cast<unsigned long long>(nonce));assert(removeLampGroupMember(sceneConfig.order[sceneConfig.count-1],expected,session).status==200);}
  assert(configureLampSync(1,identity,key,2));
  assert(configureLampScene(8,60,80,primary,secondary));beginLampSync();
  assert(wireVersion==2&&sceneConfig.count==1&&sceneConfig.scene==8);
  std::cout<<"PASS: 32 durable positions, old/new rejection, single authenticated broadcast, all31 nonce-bound follower handlers and radio destinations, storage failures, boot/layout fencing, durable pause/reboot, offline order, bounded paging and 20/32 mixed-geometry scenes\n";
  std::cout<<"BUDGET: Packet="<<sizeof(Packet)<<" Visual="<<sizeof(Visual)<<" Peer="<<sizeof(Peer)<<" peers="<<sizeof(peers)<<" Scene="<<sizeof(SceneConfig)<<" followerSlot="<<sizeof(FollowerSlot)<<" maximum tested sync JSON="<<page.length()<<"\n";
  // Explicit confirmed dissolution: exact durable order/session fence, one
  // failed write cannot prune, retired Subscribe cannot resurrect a departure.
  Preferences::storage.clear();config=Config{};fakeEfuseMac=0xaabbccddee00ULL;fakeNow=50000;beginLampSync();assert(configureLampSync(1,identity,key,3));
  const auto originalSession=nonce;auto member=subscription("112233445566",111,nonce);handle(member);auto other=subscription("223344556677",222,nonce);handle(other);assert(sceneConfig.count==3);
  const String incarnation=lampSyncIncarnation();assert(incarnation.length()==32&&incarnation!=key&&lampSyncJson().find(String("\"incarnation\":\"")+incarnation+"\"")!=String::npos);
  String expected=String(identity)+",112233445566,223344556677";char session[17];snprintf(session,sizeof(session),"%016llx",static_cast<unsigned long long>(nonce));
  fixtureRolloutPins=true;assert(!configureLampSync(0,"","",3));assert(!configureLampOrder(expected));assert(removeLampGroupMember("112233445566",expected,session).status==409);auto pinned=subscription("334455667788",333,nonce);handle(pinned);assert(sceneConfig.count==3);fixtureRolloutPins=false;
  assert(!configureLampOrder(String(identity)+",223344556677"));
  assert(removeLampGroupMember("112233445566",expected,"0000000000000001").status==409);
  assert(removeLampGroupMember(identity,expected,session).status==400);Preferences::failWrites=true;assert(removeLampGroupMember("112233445566",expected,session).status==500);assert(sceneConfig.count==3&&nonce==originalSession);Preferences::failWrites=false;
  assert(removeLampGroupMember("112233445566",expected,session).status==200);assert(sceneConfig.count==2&&nonce!=originalSession);handle(member);assert(sceneConfig.count==2);assert(!configureLampSync(0,"","",3));
  assert(removeLampGroupMember("112233445566",expected,session).status==200);expected=String(identity)+",223344556677";snprintf(session,sizeof(session),"%016llx",static_cast<unsigned long long>(nonce));
  assert(removeLampGroupMember("223344556677",expected,session).status==200&&sceneConfig.count==1);assert(lampSyncIncarnation()==incarnation);beginLampSync();assert(sceneConfig.count==1&&lampSyncIncarnation()==incarnation);assert(configureLampSync(0,"","",3));assert(lampSyncIncarnation().length()==0);
  assert(configureLampSync(1,identity,"ffeeddccbbaa99887766554433221100",3));assert(lampSyncIncarnation().length()==32&&lampSyncIncarnation()!=incarnation);
  const auto recreatedStorage=Preferences::storage;const String fresh=lampSyncIncarnation();
  assert(!configureLampSync(0,"","",3,incarnation)&&config.role==1&&Preferences::storage==recreatedStorage);
  for(const char* malformed:{"aa","FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"})assert(!configureLampSync(0,"","",3,malformed)&&Preferences::storage==recreatedStorage);
  assert(configureLampSync(0,"","",3,fresh));
  std::cout<<"PASS: confirmed dissolution prune CAS, storage failure, absent idempotence, retired subscriptions, last-follower coordinator-stop and reboot persistence\n";
}
