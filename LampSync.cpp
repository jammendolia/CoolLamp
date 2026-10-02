#include "LampSync.h"
#include "LampAudio.h"
#include <WiFi.h>
#include <WiFiUdp.h>
#include <Preferences.h>
#include <esp_system.h>
#include <mbedtls/md.h>

using namespace LampSyncWire;
namespace {
struct Config { uint8_t version=1,role=0; char leader[13]{},key[33]{}; } config;
struct Peer { Packet info{}; IPAddress ip; uint32_t seen=0,subscribed=0; bool joined=false; } peers[MaxPeers];
WiFiUDP udp;
IPAddress bound;
bool started=false,paused=false;
char identity[13]{};
uint64_t nonce=0;
uint32_t sequence=0,lastBeacon=0,lastFrame=0,lastSubscribe=0,ping=0;
Receiver receiver;
Visual received{};
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
  receiver.reset();nonce=randomSession();lastSubscribe=0;
}
Packet packet(Kind kind,const String& name){
  Packet p{};memcpy(p.magic,"CLSY",4);p.version=1;p.kind=kind;p.role=config.role;p.microphone=lampHasMicrophone();
  strlcpy(p.sender,identity,sizeof(p.sender));strlcpy(p.leader,config.leader,sizeof(p.leader));strlcpy(p.name,name.c_str(),sizeof(p.name));
  p.session=nonce;p.sequence=++sequence;p.time=millis();return p;
}
void send(Packet& p,IPAddress ip){if(p.kind!=Discover)digest(p,p.mac);if(udp.beginPacket(ip,Port)){udp.write(reinterpret_cast<uint8_t*>(&p),sizeof(p));udp.endPacket();}}
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
}
const Visual* lampSyncVisual=nullptr;
bool lampSyncFollowing(){return lampSyncVisual!=nullptr;}
void beginLampSync(){
  snprintf(identity,sizeof(identity),"%012llx",ESP.getEfuseMac()&0xffffffffffffULL);
  Preferences prefs;
  if(prefs.begin("coollamp",true)){Config saved{};if(prefs.getBytesLength("syncV1")==sizeof(saved)&&prefs.getBytes("syncV1",&saved,sizeof(saved))==sizeof(saved)&&saved.version==1&&saved.role<=2&&saved.leader[12]==0&&saved.key[32]==0&&(!saved.role||(id(saved.leader)&&decodeKey(saved.key,keyBytes))))config=saved;prefs.end();}
  nonce=randomSession();
}
bool configureLampSync(uint8_t role,const String& leader,const String& key){
  Config next{};next.role=role;uint8_t decoded[16]{};
  if(role>2)return false;
  if(role){if(leader.length()!=12||!id(leader.c_str())||!decodeKey(key.c_str(),decoded)||(role==1&&leader!=identity)||(role==2&&leader==identity))return false;strlcpy(next.leader,leader.c_str(),sizeof(next.leader));strlcpy(next.key,key.c_str(),sizeof(next.key));}
  Preferences prefs;if(!prefs.begin("coollamp",false))return false;const bool ok=prefs.putBytes("syncV1",&next,sizeof(next))==sizeof(next);prefs.end();if(!ok)return false;
  clearFollower();config=next;memcpy(keyBytes,decoded,16);paused=false;sequence=0;for(auto& p:peers)p.joined=false;return true;
}
void pauseLampSync(){if(config.role==2){paused=true;clearFollower();}}
void resumeLampSync(){paused=false;clearFollower();}
String lampSyncInvite(){return config.role==1?String("CL1-")+config.leader+"-"+config.key:String();}
uint32_t lampSyncRenderTime(uint32_t local){return lampSyncFollowing()?local+receiver.offset:local;}
uint32_t lampSyncEffectClock(uint32_t local){
  if(!lampSyncFollowing())return local;
  const uint32_t delta=lampSyncRenderTime(millis())-frameTime;
  return received.clock+(delta<Timeout?uint32_t(uint64_t(delta)*(received.mode>38?256:rate(received.speed))/256):0);
}
void serviceLampSync(const String& name,bool blocked){
  const uint32_t now=millis();
  if(blocked||WiFi.status()!=WL_CONNECTED){if(started){udp.stop();started=false;}if(receiver.locked)clearFollower();return;}
  const auto ip=WiFi.localIP();
  if(started&&ip!=bound){udp.stop();started=false;clearFollower();}
  if(!started){started=udp.begin(Port);if(!started)return;bound=ip;lastBeacon=now-2000;}
  if(receiver.locked&&receiver.stale(now))clearFollower();
  if(lampSyncVisual&&uint32_t(now-receiver.last)>AudioTimeout){received.audioValid=0;received.level=0;}
  // Four packets per pass bounds CPU time even on a noisy LAN.
  for(unsigned n=0;n<4;++n){
    const int size=udp.parsePacket();if(!size)break;
    Packet p{};const auto source=udp.remoteIP();const int read=udp.read(reinterpret_cast<uint8_t*>(&p),sizeof(p));udp.clear();
    if(size!=sizeof(p)||read!=sizeof(p)||!valid(p,size)||!strcmp(p.sender,identity))continue;
    if(p.kind==Discover){auto* item=peer(p.sender,now);if(item && (!item->joined || uint32_t(now-item->subscribed)>=Timeout)){item->info=p;item->ip=source;item->seen=now;}continue;}
    if(!config.role||strcmp(p.leader,config.leader)||!authenticated(p))continue;
    if(config.role==1&&p.kind==Subscribe&&p.target==nonce&&p.role==2){
      auto* item=peer(p.sender,now,true);if(!item)continue;item->info=p;item->ip=source;item->seen=now;item->subscribed=now;item->joined=true;
      auto reply=packet(ClockReply,name);reply.target=p.session;reply.echo=p.time;captureLampSyncVisual(reply.visual);send(reply,source);
    }else if(config.role==2&&!paused&&(p.kind==Frame||p.kind==ClockReply)&&p.role==1&&!strcmp(p.sender,config.leader)){
      if(!receiver.locked&&p.kind!=ClockReply)continue;
      if(p.kind==ClockReply&&(p.echo!=ping||uint32_t(now-ping)>200))continue;
      if(!receiver.accept(p,now,nonce))continue;
      if(p.kind==ClockReply)receiver.clock(p.time,p.echo,now);
      received=p.visual;frameTime=p.time;lampSyncVisual=&received;applyLampSyncControl(&received);
    }
  }
  if(now-lastBeacon>=2000){lastBeacon=now;auto p=packet(Discover,name);IPAddress broadcast=ip;const auto mask=WiFi.subnetMask();for(unsigned i=0;i<4;++i)broadcast[i]=ip[i]|uint8_t(~mask[i]);send(p,broadcast);}
  if(config.role==2&&!paused&&now-lastSubscribe>=1000){
    lastSubscribe=now;
    for(auto& p:peers)if(!strcmp(p.info.sender,config.leader)&&p.info.role==1&&uint32_t(now-p.seen)<PeerTimeout){auto request=packet(Subscribe,name);request.target=p.info.session;ping=request.time;send(request,p.ip);break;}
  }
  if(config.role==1&&now-lastFrame>=40){
    lastFrame=now;auto p=packet(Frame,name);captureLampSyncVisual(p.visual);
    for(auto& item:peers)if(item.joined&&uint32_t(now-item.subscribed)<Timeout){p.target=item.info.session;send(p,item.ip);}
  }
}
String lampSyncJson(){
  const uint32_t now=millis();unsigned members=0;for(auto& p:peers)if(p.joined&&uint32_t(now-p.subscribed)<Timeout)++members;
  String s="{\"version\":1,\"role\":"+String(config.role)+",\"leader\":"+quote(config.leader)+",\"paused\":"+(paused?"true":"false")+",\"active\":"+(lampSyncFollowing()?"true":"false")+",\"members\":"+String(members)+",\"peers\":[";
  bool comma=false;for(auto& p:peers)if(p.info.sender[0]&&uint32_t(now-p.seen)<PeerTimeout){if(comma)s+=',';comma=true;s+="{\"id\":"+quote(p.info.sender)+",\"name\":"+quote(p.info.name)+",\"address\":"+quote(p.ip.toString().c_str())+",\"role\":"+String(p.info.role)+",\"microphone\":"+(p.info.microphone?"true":"false")+"}";}
  return s+"]}";
}
