#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Version 2 adds ordered group scenes; all members must update. It is a fixed-size little-endian wire format, independent of LED geometry.
// No IP credentials, access passwords, PCM audio or per-pixel data go on the wire.
namespace LampSyncWire {
constexpr uint16_t Port = 49732;
constexpr unsigned MaxPeers = 8;
constexpr uint8_t SceneCount = 18;
inline bool sceneNeedsAudio(uint8_t scene){return scene==3||scene==4||scene==7||scene==16||scene==17;}
constexpr uint32_t Timeout = 3000, AudioTimeout = 200, PeerTimeout = 7000;
enum Kind : uint8_t { Discover = 1, Subscribe = 2, Frame = 3, ClockReply = 4 };
#pragma pack(push,1)
struct Visual {
  uint32_t groupStart, groupBeatAt, groupBeat, groupMotion, groupMotionAt;
  uint8_t scene, position, count, sceneSpeed, sceneIntensity, scenePrimary[3], sceneSecondary[3], groupBeatLevel;
  uint32_t clock, beat, bassBeat;
  uint16_t bass, mid, treble;
  uint8_t mode, brightness, power, audioValid, level;
  uint8_t speed, intensity, dual, primary[4], secondary[3], vu[9], fountain[9];
};
struct Packet {
  char magic[4];
  uint8_t version, kind, role, microphone;
  char sender[13], leader[13], name[49];
  uint64_t session, target;
  uint32_t sequence, time, echo;
  Visual visual;
  uint8_t mac[32];
};
#pragma pack(pop)
static_assert(sizeof(Packet) < 256, "Keep LAN traffic bounded");
inline bool id(const char* s) {
  for(unsigned i=0;i<12;++i)if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return false;
  return s[12]==0;
}
inline bool newer(uint32_t a,uint32_t b) { return int32_t(a-b)>0; }
inline uint32_t rate(uint8_t speed) { return speed<=50?32+uint32_t(speed)*224/50:256+uint32_t(speed-50)*768/50; }
inline bool validVisual(const Visual& v) {
  return v.scene<=SceneCount&&v.count<=9&&v.position<(v.count?v.count:1)&&(!v.scene||(v.count&&v.sceneSpeed>=1&&v.sceneSpeed<=100&&v.sceneIntensity<=100))&&v.mode>=1&&v.mode<=47&&v.brightness&&v.power<=1&&v.audioValid<=1&&v.speed>=1&&v.speed<=100&&v.intensity<=100&&v.dual<=1&&v.primary[0]<=1;
}
inline bool valid(const Packet& p,size_t length) {
  return length==sizeof(Packet)&&memcmp(p.magic,"CLSY",4)==0&&p.version==2&&p.kind>=Discover&&p.kind<=ClockReply&&
    p.role<=2&&p.microphone<=1&&id(p.sender)&&p.name[48]==0&&
    (p.kind==Discover||(id(p.leader)&&p.session&&p.target&&(p.kind==Subscribe||validVisual(p.visual))));
}
// Tracks a single authenticated subscription. A new nonce is required on reconnect.
struct Receiver {
  uint64_t session=0;
  uint32_t sequence=0,last=0,offset=0;
  bool locked=false,clockReady=false;
  void reset(){*this=Receiver{};}
  bool accept(const Packet& p,uint32_t now,uint64_t nonce) {
    if(p.target!=nonce || (locked&&(p.session!=session||!newer(p.sequence,sequence))))return false;
    session=p.session;sequence=p.sequence;last=now;locked=true;return true;
  }
  void clock(uint32_t remote,uint32_t sent,uint32_t now) {
    const uint32_t rtt=now-sent;
    if(rtt>200)return;
    const uint32_t candidate=remote+rtt/2-now;
    if(!clockReady){offset=candidate;clockReady=true;}
    else {const int32_t error=int32_t(candidate-offset);offset+=error>5?5:error< -5?-5:error;}
  }
  bool stale(uint32_t now)const{return !locked||uint32_t(now-last)>Timeout;}
};
}
