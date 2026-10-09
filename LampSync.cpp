#include "LampSync.h"
#include "LampAudio.h"
#include "LampEspNow.h"
#include "LampSyncRadioCrypto.h"
#include "LampFirmwareRelay.h"
#include <WiFi.h>
#include <WiFiUdp.h>
#include <Preferences.h>
#include <esp_system.h>
#include <esp_wifi.h>
#include <mbedtls/md.h>

using namespace LampSyncWire;
namespace {
struct Config { uint8_t version=1,role=0; char leader[13]{},key[33]{}; } config;
struct Peer {
  Packet info{}; IPAddress ip; uint8_t radioMac[6]{},radioChannel=0;
  uint32_t seen=0,subscribed=0,udpSeen=0,radioSeen=0,udpSubscribed=0,radioSubscribed=0,probeAt=0;
  bool probed=false;
  bool joined=false,udpKnown=false,radioKnown=false;
  LampSyncRadioCrypto::SendNonce lastRadioSend;
} peers[MaxPeers];
WiFiUDP udp;
IPAddress bound;
bool started=false,paused=false;
bool serviceBlocked=false;
uint32_t receivedPackets=0,discoveries=0,authFailures=0,subscriptionsSent=0,framesReceived=0,clockDrops=0;
char identity[13]{};
uint64_t nonce=0;
uint32_t sequence=0,lastBeacon=0,lastFrame=0,lastSubscribe=0,ping=0;
uint32_t lastRadioBeacon=0;
bool followingRadio=false;
Receiver receiver;
Visual received{};
struct SceneConfig {
  uint8_t version=1,count=1,scene=0,speed=50,intensity=85;
  uint8_t primary[3]{70,220,255},secondary[3]{255,65,170};
  char order[9][13]{};
} sceneConfig;
uint32_t sceneStart=0,sceneBeatAt=0,sceneBeat=0,lastAudioBeat=0;
uint8_t sceneBeatLevel=0;
uint32_t sceneMotion=0,sceneMotionAt=0,sceneMotionFraction=0;
bool validScene(const SceneConfig& s) {
  if(s.version!=1||s.count<1||s.count>9||s.scene>SceneCount||s.speed<1||s.speed>100||s.intensity>100)return false;
  bool self=false;
  for(unsigned i=0;i<s.count;++i){
    if(!id(s.order[i]))return false;
    self|=!strcmp(s.order[i],identity);
    for(unsigned j=0;j<i;++j)if(!strcmp(s.order[i],s.order[j]))return false;
  }
  return self;
}
bool saveScene(const SceneConfig& next) {
  Preferences prefs;if(!prefs.begin("coollamp",false))return false;
  const bool ok=prefs.putBytes("groupSceneV1",&next,sizeof(next))==sizeof(next);prefs.end();
  if(ok){sceneConfig=next;sceneStart=millis()+300;sceneBeatAt=0;sceneBeatLevel=0;sceneMotion=0;sceneMotionAt=sceneStart;sceneMotionFraction=0;}
  return ok;
}
unsigned positionOf(const char* id) {for(unsigned i=0;i<sceneConfig.count;++i)if(!strcmp(sceneConfig.order[i],id))return i;return 9;}
bool admitPosition(const char* id) {
  if(positionOf(id)<9)return true;
  if(sceneConfig.count>=9)return false;
  auto next=sceneConfig;strlcpy(next.order[next.count++],id,13);return saveScene(next);
}
void addScene(Visual& v,const char* id) {
  v.scene=sceneConfig.scene;v.position=positionOf(id);v.count=sceneConfig.count;
  v.sceneSpeed=sceneConfig.speed;v.sceneIntensity=sceneConfig.intensity;
  memcpy(v.scenePrimary,sceneConfig.primary,3);memcpy(v.sceneSecondary,sceneConfig.secondary,3);
  v.groupMotion=sceneMotion;v.groupMotionAt=sceneMotionAt;
  v.groupStart=sceneStart;v.groupBeatAt=sceneBeatAt;v.groupBeat=sceneBeat;v.groupBeatLevel=sceneBeatLevel;
}
uint32_t frameTime=0;
uint8_t keyBytes[16]{};
uint64_t randomSession(){uint64_t v=uint64_t(esp_random())<<32|esp_random();return v?v:1;}
bool decodeKey(const char* key,uint8_t* out) {
  if(strlen(key)!=32)return false;
  for(unsigned i=0;i<16;++i){unsigned value=0;for(unsigned j=0;j<2;++j){char c=key[i*2+j];if(c>='0'&&c<='9')value=value*16+c-'0';else if(c>='a'&&c<='f')value=value*16+c-'a'+10;else return false;}out[i]=value;}
  return true;
}
void digest(const Packet& p,uint8_t* out){mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),keyBytes,sizeof(keyBytes),reinterpret_cast<const uint8_t*>(&p),offsetof(Packet,mac),out);}
bool authenticated(const Packet& p){uint8_t hash[32];digest(p,hash);uint8_t diff=0;for(unsigned i=0;i<32;++i)diff|=hash[i]^p.mac[i];return diff==0;}
void clearFollower(){
  if(lampSyncVisual){lampSyncVisual=nullptr;applyLampSyncControl(nullptr);}
  receiver.reset();nonce=randomSession();lastSubscribe=0;followingRadio=false;LampEspNow::holdChannel(0);
}
Packet packet(Kind kind,const String& name){
  // Each AEAD nonce is session+sequence. Never wrap a sequence within a session.
  if(sequence==UINT32_MAX){clearFollower();sequence=0;for(auto& item:peers){item.joined=false;item.lastRadioSend={};}}
  Packet p{};memcpy(p.magic,"CLSY",4);p.version=2;p.kind=kind;p.role=config.role;p.microphone=lampHasMicrophone();
  strlcpy(p.sender,identity,sizeof(p.sender));strlcpy(p.leader,config.leader,sizeof(p.leader));strlcpy(p.name,name.c_str(),sizeof(p.name));
  p.session=nonce;p.sequence=++sequence;p.time=millis();return p;
}
void send(Packet& p,IPAddress ip){if(!started)return;if(p.kind!=Discover)digest(p,p.mac);if(udp.beginPacket(ip,Port)){udp.write(reinterpret_cast<uint8_t*>(&p),sizeof(p));udp.endPacket();}}
bool sendRadio(Packet& p,Peer* destination=nullptr) {
  if(p.kind==Discover)return LampEspNow::enqueue(reinterpret_cast<const uint8_t*>(&p),sizeof(p));
  if(!destination||!destination->radioKnown)return false;
  uint8_t sealed[LampSyncRadioCrypto::EnvelopeSize];
  if(!LampSyncRadioCrypto::seal(p,destination->info.sender,keyBytes,sealed,sizeof(sealed),destination->lastRadioSend))return false;
  return LampEspNow::enqueue(sealed,sizeof(sealed),destination->radioMac,p.kind!=Frame);
}
Peer* peer(const char* id,uint32_t now,bool subscribing=false){
  for(auto& p:peers)if(!strcmp(p.info.sender,id))return &p;
  for(auto& p:peers)if(!p.info.sender[0]||uint32_t(now-p.seen)>PeerTimeout){p=Peer{};return &p;}
  // An unrelated discovery cannot monopolize capacity needed by our coordinator
  // or by an authenticated member. Never evict a live subscribed follower.
  if(subscribing || (config.role==2 && !strcmp(id,config.leader))) {
    for(auto& p:peers)if(!p.joined || uint32_t(now-p.subscribed)>=Timeout){p=Peer{};return &p;}
  }
  return nullptr;
}
String quote(const char* value){String s="\"";for(size_t i=0;value[i];++i){const uint8_t c=value[i];if(c=='"'||c=='\\')s+='\\';if(c>=32)s+=char(c);}return s+'"';}
void locate(Peer& item,const Packet& p,uint32_t now,bool radio,const uint8_t* mac,uint8_t channel,IPAddress source) {
  item.info=p;item.seen=now;
  if(radio){memcpy(item.radioMac,mac,6);item.radioChannel=channel;item.radioSeen=now;item.radioKnown=true;}
  else {item.ip=source;item.udpSeen=now;item.udpKnown=true;}
}
void receivePacket(Packet& p,uint32_t now,bool radio,const uint8_t* mac,uint8_t channel,IPAddress source,const String& name) {
  if(!valid(p,sizeof(p))||!strcmp(p.sender,identity))return;
  if(p.kind==Discover){
    if(p.role==1&&strcmp(p.leader,p.sender))return;
    ++discoveries;auto* item=peer(p.sender,now);
    if(item&&(!item->joined||uint32_t(now-item->subscribed)>=Timeout))locate(*item,p,now,radio,mac,channel,source);
    if(radio&&item&&config.role==2&&!paused&&!receiver.locked&&p.role==1&&!strcmp(p.sender,config.leader)&&
      (!item->probed||now-item->probeAt>=1200)) {
      // Discovery is public. An unauthenticated beacon cannot indefinitely pin
      // acquisition to the wrong channel by extending its handshake window.
      item->probed=true;item->probeAt=now;LampEspNow::holdChannel(now+450);lastSubscribe=now-1000;
    }
    return;
  }
  if(!config.role||strcmp(p.leader,config.leader))return;
  if(!authenticated(p)){++authFailures;return;}
  if(config.role==1&&p.kind==Subscribe&&p.target==nonce&&p.role==2){
    auto* item=peer(p.sender,now,true);if(!item||!admitPosition(p.sender))return;
    locate(*item,p,now,radio,mac,channel,source);item->subscribed=now;item->joined=true;
    if(radio)item->radioSubscribed=now;else item->udpSubscribed=now;
    auto reply=packet(ClockReply,name);reply.target=p.session;reply.echo=p.time;captureLampSyncVisual(reply.visual);addScene(reply.visual,p.sender);
    if(radio)sendRadio(reply,item);else send(reply,source);
  }else if(config.role==2&&!paused&&(p.kind==Frame||p.kind==ClockReply)&&p.role==1&&!strcmp(p.sender,config.leader)){
    if(!receiver.locked&&p.kind!=ClockReply)return;
    if(p.kind==ClockReply&&(p.echo!=ping||uint32_t(now-ping)>200)){++clockDrops;return;}
    if(!receiver.accept(p,now,nonce))return;
    if(p.kind==ClockReply)receiver.clock(p.time,p.echo,now);
    followingRadio=radio;
    auto* item=peer(p.sender,now);if(item)locate(*item,p,now,radio,mac,channel,source);
    received=p.visual;frameTime=p.time;lampSyncVisual=&received;applyLampSyncControl(&received);++framesReceived;
  }
}
}
const Visual* lampSyncVisual=nullptr;
bool lampSyncFollowing(){return lampSyncVisual!=nullptr;}
bool leaveLampSceneForEffect(){
  if(config.role!=1||!sceneConfig.scene)return true;
  auto next=sceneConfig;next.scene=0;return saveScene(next);
}
void beginLampSync(){
  LampEspNow::stop();followingRadio=false;
  snprintf(identity,sizeof(identity),"%012llx",ESP.getEfuseMac()&0xffffffffffffULL);
  Preferences prefs;
  if(prefs.begin("coollamp",true)){Config saved{};if(prefs.getBytesLength("syncV1")==sizeof(saved)&&prefs.getBytes("syncV1",&saved,sizeof(saved))==sizeof(saved)&&saved.version==1&&saved.role<=2&&saved.leader[12]==0&&saved.key[32]==0&&(!saved.role||(id(saved.leader)&&decodeKey(saved.key,keyBytes))))config=saved;prefs.end();}
  strlcpy(sceneConfig.order[0],identity,13);
  if(prefs.begin("coollamp",true)){SceneConfig saved{};if(prefs.getBytesLength("groupSceneV1")==sizeof(saved)&&prefs.getBytes("groupSceneV1",&saved,sizeof(saved))==sizeof(saved)&&validScene(saved))sceneConfig=saved;prefs.end();}
  sceneStart=millis()+300;sceneMotionAt=sceneStart;
  nonce=randomSession();
}
bool configureLampSync(uint8_t role,const String& leader,const String& key){
  Config next{};next.role=role;uint8_t decoded[16]{};
  if(role>2)return false;
  if(role){if(leader.length()!=12||!id(leader.c_str())||!decodeKey(key.c_str(),decoded)||(role==1&&leader!=identity)||(role==2&&leader==identity))return false;strlcpy(next.leader,leader.c_str(),sizeof(next.leader));strlcpy(next.key,key.c_str(),sizeof(next.key));}
  Preferences prefs;if(!prefs.begin("coollamp",false))return false;const bool ok=prefs.putBytes("syncV1",&next,sizeof(next))==sizeof(next);prefs.end();if(!ok)return false;
  clearFollower();config=next;memcpy(keyBytes,decoded,16);paused=false;sequence=0;for(auto& p:peers)p=Peer{};LampEspNow::stop();return true;
}
bool configureLampScene(uint8_t scene,uint8_t speed,uint8_t intensity,const uint8_t* primary,const uint8_t* secondary) {
  if(config.role!=1||scene>SceneCount||speed<1||speed>100||intensity>100)return false;
  // These scenes require sound; do not silently offer a nonfunctional scene.
  if(sceneNeedsAudio(scene)&&!lampHasMicrophone())return false;
  auto next=sceneConfig;next.scene=scene;next.speed=speed;next.intensity=intensity;
  memcpy(next.primary,primary,3);memcpy(next.secondary,secondary,3);
  return saveScene(next);
}
bool configureLampOrder(const String& order) {
  if(config.role!=1||order.length()<12||order.length()>116||(order.length()+1)%13)return false;
  auto next=sceneConfig;next.count=(order.length()+1)/13;
  for(unsigned i=0;i<next.count;++i){
    if(i&&order.c_str()[i*13-1]!=',')return false;
    memcpy(next.order[i],order.c_str()+i*13,12);next.order[i][12]=0;
    if(positionOf(next.order[i])>=9)return false;
  }
  if(!validScene(next))return false;
  // Connected followers cannot disappear from the spatial layout.
  for(const auto& p:peers)if(p.joined&&uint32_t(millis()-p.subscribed)<Timeout){
    bool found=false;for(unsigned i=0;i<next.count;++i)found|=!strcmp(p.info.sender,next.order[i]);if(!found)return false;
  }
  return saveScene(next);
}
Visual lampGroupVisual() {
  if(lampSyncVisual)return *lampSyncVisual;
  Visual v{};if(config.role==1){captureLampSyncVisual(v);addScene(v,identity);}return v;
}
uint8_t lampGroupScene(){return lampSyncVisual?lampSyncVisual->scene:config.role==1?sceneConfig.scene:0;}
void pauseLampSync(){if(config.role==2){paused=true;clearFollower();}}
void resumeLampSync(){paused=false;clearFollower();}
String lampSyncInvite(){return config.role==1?String("CL1-")+config.leader+"-"+config.key:String();}
uint32_t lampSyncRenderTime(uint32_t local){return lampSyncFollowing()?local+receiver.offset:local;}
uint32_t lampSyncEffectClock(uint32_t local){
  if(!lampSyncFollowing())return local;
  const uint32_t delta=lampSyncRenderTime(millis())-frameTime;
  return received.clock+(delta<Timeout?uint32_t(uint64_t(delta)*(received.mode>38?256:rate(received.speed))/256):0);
}
void serviceLampSync(const String& name,bool blocked,bool scanning){
  const uint32_t now=millis();
  serviceBlocked=blocked;
  const bool connected=WiFi.status()==WL_CONNECTED;
  wifi_ap_record_t association{};
  const bool associated=connected||esp_wifi_sta_get_ap_info(&association)==ESP_OK;
  if(blocked){LampFirmwareRelay::suspend();if(started){udp.stop();started=false;}LampEspNow::service(now,true,scanning,associated,false);if(receiver.locked)clearFollower();return;}
  if(LampFirmwareRelay::ownsRadio()){
    if(started){udp.stop();started=false;}if(receiver.locked)clearFollower();
    LampEspNow::holdChannel(now+5000);LampEspNow::service(now,false,scanning,associated,false);
    LampEspNow::Received message;for(unsigned n=0;n<4&&LampEspNow::receive(message);++n)LampFirmwareRelay::receive(message);
    LampFirmwareRelay::service(now);LampEspNow::service(now,false,scanning,associated,false);return;
  }
  const auto ip=WiFi.localIP();
  if(started&&(!connected||ip!=bound)){udp.stop();started=false;if(receiver.locked&&!followingRadio)clearFollower();}
  if(connected&&!started){started=udp.begin(Port);if(started){bound=ip;lastBeacon=now-2000;}}
  LampEspNow::service(now,false,scanning,associated,config.role!=1&&!receiver.locked);
  const auto radio=LampEspNow::status();
  // Short Wi-Fi scans/reconnection attempts suspend the one shared radio. Keep
  // the authenticated clock/visual through the existing 3s holdover; audio
  // expires after 200ms. A real channel move requires a fresh subscription.
  if(receiver.locked&&followingRadio&&radio.active&&!radio.suspended){
    for(const auto& item:peers)if(!strcmp(item.info.sender,config.leader)&&item.radioKnown&&item.radioChannel!=radio.channel){clearFollower();break;}
  }
  if(receiver.locked&&receiver.stale(now))clearFollower();
  if(lampSyncVisual&&uint32_t(now-receiver.last)>AudioTimeout){received.audioValid=0;received.level=0;}
  // Four packets total per pass; alternate transports so neither can starve
  // authentication/clock traffic on the other. Callback work is only copying.
  static bool radioTurn=false;
  for(unsigned n=0;n<4;++n){
    Packet p{};LampEspNow::Received message;radioTurn=!radioTurn;
    bool fromRadio=radioTurn&&LampEspNow::receive(message);
    int size=fromRadio?0:started?udp.parsePacket():0;
    if(!fromRadio&&!size)fromRadio=LampEspNow::receive(message);
    if(!fromRadio&&!size)break;
    ++receivedPackets;
    if(fromRadio){
      if(LampFirmwareRelay::receive(message))continue;
      if(now-message.receivedAt>200)continue;
      char sender[13];if(!LampSyncRadioCrypto::identityFromMac(message.source,sender))continue;
      if(message.length==sizeof(p)&&!memcmp(message.data,"CLSY",4)){
        memcpy(&p,message.data,sizeof(p));if(!valid(p,sizeof(p))||p.kind!=Discover||strcmp(p.sender,sender))continue;
      }else if(!config.role||!LampSyncRadioCrypto::open(message.data,message.length,message.source,identity,keyBytes,p)){++authFailures;continue;}
      receivePacket(p,now,true,message.source,message.channel,IPAddress(),name);
    }else{
      const auto source=udp.remoteIP();const int read=udp.read(reinterpret_cast<uint8_t*>(&p),sizeof(p));udp.clear();
      if(size==sizeof(p)&&read==sizeof(p))receivePacket(p,now,false,nullptr,0,source,name);
    }
  }
  if(config.role==1){
    const auto audio=getLampAudioFeatures();
    if(int32_t(now-sceneMotionAt)>=0){
      const uint32_t dt=now-sceneMotionAt;
      const uint64_t advance=uint64_t(dt)*(256+(audio.valid?audio.level:0))+sceneMotionFraction;
      sceneMotion+=advance/256;sceneMotionFraction=advance%256;sceneMotionAt=now;
    }
    if(audio.valid&&audio.beat!=lastAudioBeat){
      lastAudioBeat=audio.beat;
      if(audio.level){++sceneBeat;sceneBeatAt=now+120;sceneBeatLevel=audio.level;}
    }
  }
  if(started&&now-lastBeacon>=2000){lastBeacon=now;auto p=packet(Discover,name);IPAddress broadcast=ip;const auto mask=WiFi.subnetMask();for(unsigned i=0;i<4;++i)broadcast[i]=ip[i]|uint8_t(~mask[i]);send(p,broadcast);}
  if(radio.active&&!radio.suspended&&now-lastRadioBeacon>=250){lastRadioBeacon=now;auto p=packet(Discover,name);sendRadio(p);}
  if(config.role==2&&!paused&&now-lastSubscribe>=1000){
    lastSubscribe=now;
    for(auto& p:peers)if(!strcmp(p.info.sender,config.leader)&&p.info.role==1&&uint32_t(now-p.seen)<PeerTimeout){
      auto request=packet(Subscribe,name);request.target=p.info.session;ping=request.time;++subscriptionsSent;
      if(p.radioKnown&&now-p.radioSeen<PeerTimeout&&(!receiver.locked||followingRadio))sendRadio(request,&p);
      if(p.udpKnown&&now-p.udpSeen<PeerTimeout&&(!receiver.locked||!followingRadio))send(request,p.ip);
      break;
    }
  }
  if(config.role==1&&now-lastFrame>=40){
    lastFrame=now;auto p=packet(Frame,name);captureLampSyncVisual(p.visual);
    for(auto& item:peers)if(item.joined&&uint32_t(now-item.subscribed)<Timeout){
      p.target=item.info.session;addScene(p.visual,item.info.sender);
      if(item.radioKnown&&item.radioSubscribed&&now-item.radioSubscribed<Timeout)sendRadio(p,&item);
      if(item.udpKnown&&item.udpSubscribed&&now-item.udpSubscribed<Timeout)send(p,item.ip);
    }
  }
  LampFirmwareRelay::service(now);
  LampEspNow::service(now,false,scanning,associated,config.role!=1&&!receiver.locked);
}
String lampSyncJson(){
  const uint32_t now=millis();unsigned members=0;for(auto& p:peers)if(p.joined&&uint32_t(now-p.subscribed)<Timeout)++members;
  const auto radio=LampEspNow::status();
  const char* transport=lampSyncFollowing()?(followingRadio?"esp-now":"udp"):
    started&&radio.active&&!radio.suspended?"hybrid":started?"udp":radio.active&&!radio.suspended?"esp-now":"none";
  String s="{\"version\":2,\"role\":"+String(config.role)+",\"leader\":"+quote(config.leader)+",\"paused\":"+(paused?"true":"false")+",\"active\":"+(lampSyncFollowing()?"true":"false")+",\"members\":"+String(members)+",\"peers\":[";
  bool comma=false;for(auto& p:peers)if(p.info.sender[0]&&uint32_t(now-p.seen)<PeerTimeout){
    if(comma)s+=',';
    comma=true;
    const bool udpLive=started&&p.udpKnown&&now-p.udpSeen<PeerTimeout,radioLive=p.radioKnown&&now-p.radioSeen<PeerTimeout;
    const char* link=udpLive&&radioLive?"hybrid":radioLive?"esp-now":"udp";
    s+="{\"id\":"+quote(p.info.sender)+",\"name\":"+quote(p.info.name)+",\"address\":"+quote(udpLive?p.ip.toString().c_str():"");
    s+=",\"role\":"+String(p.info.role)+",\"microphone\":"+(p.info.microphone?"true":"false")+",\"transport\":"+quote(link)+",\"channel\":"+String(unsigned(radioLive?p.radioChannel:0))+"}";
  }
  s+="]";
  s+=",\"transport\":"+quote(transport)+",\"radio\":{\"available\":"+(radio.active&&!radio.suspended?"true":"false");
  s+=",\"channel\":"+String(radio.channel)+",\"seeking\":"+(radio.seeking?"true":"false")+",\"security\":\"aes-gcm-128\"";
  s+=",\"received\":"+String(radio.received)+",\"receiveDropped\":"+String(radio.receiveDropped)+",\"sent\":"+String(radio.sent);
  s+=",\"sendFailed\":"+String(radio.sendFailed)+",\"sendDropped\":"+String(radio.sendDropped)+",\"channelChanges\":"+String(radio.channelChanges)+"}";
  s+=",\"network\":{\"listening\":"+String(started?"true":"false")+",\"blocked\":"+String(serviceBlocked?"true":"false");
  s+=",\"received\":"+String(receivedPackets)+",\"discoveries\":"+String(discoveries)+",\"authenticationFailures\":"+String(authFailures);
  s+=",\"subscriptions\":"+String(subscriptionsSent)+",\"frames\":"+String(framesReceived)+",\"clockDrops\":"+String(clockDrops)+"}";
  s+=",\"sceneCount\":"+String(SceneCount);
  const auto v=lampGroupVisual();
  s+=",\"scene\":"+String(v.scene)+",\"position\":"+String(v.position)+",\"count\":"+String(v.count)+",\"sceneSpeed\":"+String(v.sceneSpeed)+",\"sceneIntensity\":"+String(v.sceneIntensity);
  s+=",\"scenePrimary\":["+String(v.scenePrimary[0])+","+String(v.scenePrimary[1])+","+String(v.scenePrimary[2])+"],\"sceneSecondary\":["+String(v.sceneSecondary[0])+","+String(v.sceneSecondary[1])+","+String(v.sceneSecondary[2])+"]";
  s+=",\"order\":[";
  if(config.role==1)for(unsigned i=0;i<sceneConfig.count;++i){
    if(i)s+=",";
    const char* label=!strcmp(sceneConfig.order[i],identity)?"This lamp":sceneConfig.order[i];bool online=!strcmp(sceneConfig.order[i],identity);
    for(const auto& p:peers)if(!strcmp(p.info.sender,sceneConfig.order[i])){label=p.info.name;online=p.joined&&uint32_t(now-p.subscribed)<Timeout;break;}
    s+="{\"id\":"+quote(sceneConfig.order[i])+",\"name\":"+quote(label)+",\"online\":"+(online?"true":"false")+"}";
  }
  return s+"]}";

}

uint8_t lampSyncRole(){return config.role;}
bool lampSyncPaused(){return paused;}
