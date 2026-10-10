#pragma once
#include "LampSyncProtocol.h"
#include "UpdateManifest.h"

namespace LampRolloutCore {
constexpr uint8_t Version=1;
constexpr uint32_t PermitLifetime=300000;
enum Phase:uint8_t {Empty=0,Ready=1,Reserved=2,Accepted=3,Started=4,Finished=5,Armed=6,RenewReady=7};
enum Result:uint8_t {Ok=0,Duplicate=1,Invalid=2,Busy=3,NotMember=4,CoordinatorLast=5,StorageFailure=6,Stale=7};
struct Group {
  char identity[13]{},leader[13]{},members[32][13]{};
  uint8_t fingerprint[16]{},count=0,role=0,protocol=0;
  uint64_t boot=0;
};
#pragma pack(push,1)
struct alignas(4) Permit {
  uint8_t version=Version,kind=1;
  uint64_t ticket=0,lease=0,targetBoot=0;
  char coordinator[13]{},target[13]{};
  uint8_t fingerprint[16]{};
  FirmwareManifest artifact{};
  uint8_t proof[32]{};
};
struct alignas(4) Health {
  uint8_t version=Version,kind=2;
  uint64_t ticket=0,lease=0,boot=0;
  char coordinator[13]{},target[13]{};
  uint8_t fingerprint[16]{};
  FirmwareManifest artifact{};
  uint8_t proof[32]{};
};
struct alignas(4) RenewPermit {
  uint8_t version=Version,kind=8;
  uint64_t ticket=0,lease=0,targetBoot=0;
  char coordinator[13]{},target[13]{};
  uint8_t fingerprint[16]{};
  FirmwareManifest artifact{};
  uint32_t command=0;
  uint8_t proof[32]{};
};
struct alignas(4) Arming {
  uint8_t version=Version,kind=3;
  uint64_t ticket=0;
  char coordinator[13]{};
  uint8_t fingerprint[16]{};
  uint8_t reserved=0;
  FirmwareManifest artifact{};
  uint8_t proof[32]{};
};
struct ArmingAck {
  uint8_t version=Version,kind=4;
  uint64_t ticket=0,boot=0;
  char coordinator[13]{},target[13]{};
  uint8_t fingerprint[16]{},proof[32]{};
};
struct alignas(4) Release {
  uint8_t version=Version,kind=5;
  uint64_t ticket=0;
  char coordinator[13]{};
  uint8_t fingerprint[16]{};
  uint8_t reserved=0;
  FirmwareManifest artifact{};
  uint8_t proof[32]{};
};
struct alignas(4) Record {
  uint8_t version=Version,phase=Empty,count=0;
  uint64_t ticket=0,lease=0,targetBoot=0;
  uint32_t command=0,completed=0,armed=0,released=0,renewCommand=0;
  char coordinator[13]{},target[13]{},members[32][13]{};
  uint8_t fingerprint[16]{};
  uint8_t reserved[3]{};
  FirmwareManifest artifact{};
};
#pragma pack(pop)
static_assert(sizeof(Record)<=560,"Rollout record must remain fixed and bounded");
static_assert(offsetof(Record,artifact)%4==0&&offsetof(Permit,artifact)%4==0&&offsetof(Health,artifact)%4==0&&offsetof(RenewPermit,artifact)%4==0&&offsetof(Arming,artifact)%4==0&&offsetof(Release,artifact)%4==0,"Manifest references remain naturally aligned on ESP32-C3");
static_assert(sizeof(RenewPermit)*2+8<=1024,"A hex permit fits protected RPC request bounds");
inline void copyManifest(FirmwareManifest& to,const FirmwareManifest& from){memset(&to,0,sizeof(to));memcpy(to.version,from.version,6);to.size=from.size;memcpy(to.sha256,from.sha256,32);}
inline bool validArtifact(const FirmwareManifest& m){uint8_t any=0;for(uint8_t v:m.sha256)any|=v;return m.size>=288&&m.size<=2031616&&any;}
inline bool validGroup(const Group& g){
  if(g.role!=1||g.protocol!=3||!g.boot||!LampSyncWire::id(g.identity)||strcmp(g.identity,g.leader)||!g.count||g.count>32)return false;
  bool self=false;for(unsigned i=0;i<g.count;++i){if(!LampSyncWire::id(g.members[i]))return false;self|=!strcmp(g.identity,g.members[i]);for(unsigned j=0;j<i;++j)if(!strcmp(g.members[i],g.members[j]))return false;}return self;
}
inline unsigned position(const Record& r,const char* id){for(unsigned i=0;i<r.count;++i)if(!strcmp(r.members[i],id))return i;return 32;}
inline uint32_t mask(uint8_t count){return count==32?UINT32_MAX:(uint32_t(1)<<count)-1;}
inline bool validRecord(const Record& r){
  if(r.version!=Version||r.phase>RenewReady||r.count>32||r.reserved[0]||r.reserved[1]||r.reserved[2])return false;
  if(r.phase==Empty)return !r.ticket&&!r.lease&&!r.targetBoot&&!r.count&&!r.command&&!r.completed&&!r.armed&&!r.released&&!r.renewCommand&&!r.coordinator[0]&&!r.target[0];
  if(!r.ticket||!LampSyncWire::id(r.coordinator)||!validArtifact(r.artifact)||!r.count||((r.completed|r.armed|r.released)&~mask(r.count)))return false;
  for(unsigned i=0;i<r.count;++i){if(!LampSyncWire::id(r.members[i]))return false;for(unsigned j=0;j<i;++j)if(!strcmp(r.members[i],r.members[j]))return false;}
  if(r.phase==Ready||r.phase==Reserved||r.phase==Finished){
    const auto self=position(r,r.coordinator);if(self>=32||!(r.armed&(uint32_t(1)<<self))||(r.completed&~r.armed))return false;
    if(r.phase==Finished){if(r.completed!=mask(r.count))return false;}
    else if(r.released||r.completed==mask(r.count))return false;
    if(r.phase==Reserved&&r.armed!=mask(r.count))return false;
  }else if(r.count!=1||r.completed||r.released)return false;
  return (r.phase==Ready||r.phase==Finished||r.phase==Armed)?!r.lease:bool(r.lease&&r.targetBoot&&LampSyncWire::id(r.target)&&position(r,r.target)<32);
}
using Save=bool(*)(const Record&,void*);
class State {
  Record record{};
  Save save=nullptr;void* storage=nullptr;
  Result persist(const Record& next){if(!save||!save(next,storage))return StorageFailure;record=next;return Ok;}
public:
  State(Save writer,void* context):save(writer),storage(context){}
  const Record& state()const{return record;}
  bool load(const Record& next){if(!validRecord(next))return false;record=next;return true;}
  bool matchingGroup(const Group& g)const{return !strcmp(record.coordinator,g.leader)&&!memcmp(record.fingerprint,g.fingerprint,16);}
  bool matchingMembership(const Group& g)const{return matchingGroup(g)&&record.count==g.count&&!memcmp(record.members,g.members,size_t(g.count)*13);}
  Result create(const Group& g,const FirmwareManifest& artifact,uint32_t command,uint64_t ticket){
    if(!validGroup(g)||!validArtifact(artifact)||!command||!ticket)return Invalid;
    if(record.phase!=Empty)return record.command==command&&sameFirmwareManifest(record.artifact,artifact)&&matchingMembership(g)?Duplicate:Busy;
    Record next{};next.phase=Ready;next.ticket=ticket;next.command=command;next.count=g.count;
    memcpy(next.coordinator,g.identity,13);memcpy(next.members,g.members,sizeof(next.members));memcpy(next.fingerprint,g.fingerprint,16);copyManifest(next.artifact,artifact);next.armed=uint32_t(1)<<position(next,g.identity);return persist(next);
  }
  bool arming(Arming& out)const{if(record.phase!=Ready&&record.phase!=Reserved)return false;out={};out.ticket=record.ticket;memcpy(out.coordinator,record.coordinator,13);memcpy(out.fingerprint,record.fingerprint,16);copyManifest(out.artifact,record.artifact);return true;}
  Result arm(const Group& g,const Arming& arm){
    if(g.protocol!=3||!g.role||!g.boot||arm.version!=Version||arm.kind!=3||arm.reserved||!arm.ticket||!LampSyncWire::id(arm.coordinator)||strcmp(arm.coordinator,g.leader)||memcmp(arm.fingerprint,g.fingerprint,16)||!validArtifact(arm.artifact))return Invalid;
    if(record.phase!=Empty)return record.ticket==arm.ticket&&sameFirmwareManifest(record.artifact,arm.artifact)&&matchingGroup(g)?Duplicate:Busy;
    Record next{};next.phase=Armed;next.count=1;next.ticket=arm.ticket;next.armed=1;memcpy(next.coordinator,arm.coordinator,13);memcpy(next.members[0],g.identity,13);memcpy(next.fingerprint,g.fingerprint,16);copyManifest(next.artifact,arm.artifact);return persist(next);
  }
  Result acknowledgeArm(const Group& g,const ArmingAck& ack){
    if(!validGroup(g)||!matchingMembership(g)||ack.version!=Version||ack.kind!=4||ack.ticket!=record.ticket||!ack.boot||!LampSyncWire::id(ack.coordinator)||!LampSyncWire::id(ack.target)||strcmp(ack.coordinator,g.identity)||memcmp(ack.fingerprint,g.fingerprint,16))return Invalid;
    const auto index=position(record,ack.target);if(index>=32)return NotMember;
    if(record.armed&(uint32_t(1)<<index))return Duplicate;
    if(record.phase!=Ready)return Busy;
    Record next=record;next.armed|=uint32_t(1)<<index;return persist(next);
  }
  Result reserve(const Group& g,uint64_t ticket,const char* target,uint64_t boot,uint32_t command,uint64_t lease){
    if(!validGroup(g)||!LampSyncWire::id(target)||!boot||!command||!lease)return Invalid;
    if(record.ticket!=ticket||!matchingMembership(g))return Stale;
    if(record.phase!=Ready)return record.phase==Reserved&&record.command==command&&record.targetBoot==boot&&!strcmp(record.target,target)?Duplicate:Busy;
    if(record.armed!=mask(record.count))return Busy;
    const auto index=position(record,target);if(index>=32)return NotMember;
    if(record.completed&(uint32_t(1)<<index))return Stale;
    const auto self=position(record,g.identity);
    if(index==self&&(record.completed|(uint32_t(1)<<self))!=mask(record.count))return CoordinatorLast;
    Record next=record;next.phase=Reserved;next.command=command;next.renewCommand=0;next.lease=lease;next.targetBoot=boot;memcpy(next.target,target,13);return persist(next);
  }
  bool permit(Permit& out)const{
    if(record.phase!=Reserved)return false;
    out={};out.ticket=record.ticket;out.lease=record.lease;out.targetBoot=record.targetBoot;
    memcpy(out.coordinator,record.coordinator,13);memcpy(out.target,record.target,13);memcpy(out.fingerprint,record.fingerprint,16);copyManifest(out.artifact,record.artifact);return true;
  }
  Result accept(const Group& g,const Permit& permit){
    if(g.protocol!=3||!g.role||permit.version!=Version||permit.kind!=1||!permit.ticket||!permit.lease||permit.targetBoot!=g.boot||!LampSyncWire::id(permit.target)||!LampSyncWire::id(permit.coordinator)||
      strcmp(permit.target,g.identity)||strcmp(permit.coordinator,g.leader)||memcmp(permit.fingerprint,g.fingerprint,16)||!validArtifact(permit.artifact))return Invalid;
    if(record.phase!=Armed)return record.ticket==permit.ticket&&record.lease==permit.lease&&record.targetBoot==g.boot&&sameFirmwareManifest(record.artifact,permit.artifact)&&matchingGroup(g)?Duplicate:Busy;
    if(record.ticket!=permit.ticket||!sameFirmwareManifest(record.artifact,permit.artifact)||!matchingGroup(g))return Stale;
    Record next{};next.phase=Accepted;next.count=1;next.ticket=permit.ticket;next.lease=permit.lease;next.targetBoot=permit.targetBoot;
    memcpy(next.coordinator,permit.coordinator,13);memcpy(next.target,g.identity,13);memcpy(next.members[0],g.identity,13);memcpy(next.fingerprint,g.fingerprint,16);copyManifest(next.artifact,permit.artifact);return persist(next);
  }
  bool eligible(const Group& g,const FirmwareManifest& artifact)const{return record.phase==Accepted&&record.targetBoot==g.boot&&matchingGroup(g)&&!strcmp(record.target,g.identity)&&sameFirmwareManifest(record.artifact,artifact);}
  Result started(const Group& g,const FirmwareManifest& artifact){if(!eligible(g,artifact))return Stale;Record next=record;next.phase=Started;return persist(next);}
  Result prepareRenew(const Group& g){
    if(!matchingGroup(g)||strcmp(record.target,g.identity)||!g.boot||(record.phase!=Accepted&&record.phase!=Started&&record.phase!=RenewReady))return Busy;
    if(record.phase==RenewReady&&record.targetBoot==g.boot)return Duplicate;
    Record next=record;next.phase=RenewReady;next.targetBoot=g.boot;return persist(next);
  }
  bool recovery(Permit& out)const{
    if(record.phase!=RenewReady)return false;
    out={};out.kind=7;out.ticket=record.ticket;out.lease=record.lease;out.targetBoot=record.targetBoot;memcpy(out.coordinator,record.coordinator,13);memcpy(out.target,record.target,13);memcpy(out.fingerprint,record.fingerprint,16);copyManifest(out.artifact,record.artifact);return true;
  }
  Result renew(const Group& g,const Permit& proof,uint32_t command){
    if(!validGroup(g)||!matchingMembership(g)||!command||record.phase!=Reserved||proof.version!=Version||proof.kind!=7||proof.ticket!=record.ticket||proof.lease!=record.lease||!proof.targetBoot||!LampSyncWire::id(proof.target)||!LampSyncWire::id(proof.coordinator)||strcmp(proof.target,record.target)||strcmp(proof.coordinator,record.coordinator)||memcmp(proof.fingerprint,record.fingerprint,16)||!sameFirmwareManifest(proof.artifact,record.artifact))return Invalid;
    if(record.renewCommand==command)return record.targetBoot==proof.targetBoot?Duplicate:Stale;
    Record next=record;next.renewCommand=command;next.targetBoot=proof.targetBoot;return persist(next);
  }
  bool renewedPermit(RenewPermit& out)const{
    if(record.phase!=Reserved||!record.renewCommand)return false;
    out={};out.ticket=record.ticket;out.lease=record.lease;out.targetBoot=record.targetBoot;out.command=record.renewCommand;memcpy(out.coordinator,record.coordinator,13);memcpy(out.target,record.target,13);memcpy(out.fingerprint,record.fingerprint,16);copyManifest(out.artifact,record.artifact);return true;
  }
  Result acceptRenew(const Group& g,const RenewPermit& permit){
    if(permit.version!=Version||permit.kind!=8||!permit.command||permit.ticket!=record.ticket||permit.lease!=record.lease||permit.targetBoot!=g.boot||!matchingGroup(g)||!LampSyncWire::id(permit.target)||!LampSyncWire::id(permit.coordinator)||strcmp(permit.target,g.identity)||strcmp(permit.coordinator,g.leader)||memcmp(permit.fingerprint,g.fingerprint,16)||!sameFirmwareManifest(permit.artifact,record.artifact))return Invalid;
    if(record.command==permit.command&&record.targetBoot==g.boot)return Duplicate;
    if(record.phase!=RenewReady)return Busy;
    Record next=record;next.phase=Accepted;next.command=permit.command;next.targetBoot=g.boot;return persist(next);
  }
  Result complete(const Group& g,const Health& health){
    if(!validGroup(g)||!matchingMembership(g)||health.version!=Version||health.kind!=2||health.ticket!=record.ticket||!LampSyncWire::id(health.target)||!LampSyncWire::id(health.coordinator)||
      strcmp(health.coordinator,g.identity)||memcmp(health.fingerprint,g.fingerprint,16)||!health.boot||!sameFirmwareManifest(health.artifact,record.artifact))return Invalid;
    const auto index=position(record,health.target);if(index>=32)return NotMember;
    if(record.completed&(uint32_t(1)<<index))return Duplicate;
    if(record.phase!=Reserved||record.lease!=health.lease||strcmp(record.target,health.target))return Stale;
    Record next=record;next.completed|=uint32_t(1)<<index;next.lease=0;next.targetBoot=0;memset(next.target,0,13);next.phase=next.completed==mask(next.count)?Finished:Ready;return persist(next);
  }
  bool release(Release& out)const{if(record.phase!=Finished)return false;out={};out.ticket=record.ticket;memcpy(out.coordinator,record.coordinator,13);memcpy(out.fingerprint,record.fingerprint,16);copyManifest(out.artifact,record.artifact);return true;}
  Result finish(const Group& g,const Release& release){
    if(release.reserved||!LampSyncWire::id(release.coordinator))return Invalid;
    if(record.phase==Empty)return release.version==Version&&release.kind==5&&release.ticket&&!strcmp(release.coordinator,g.leader)&&!memcmp(release.fingerprint,g.fingerprint,16)&&validArtifact(release.artifact)?Duplicate:Invalid;
    if(release.version!=Version||release.kind!=5||release.ticket!=record.ticket||!matchingGroup(g)||strcmp(release.coordinator,g.leader)||memcmp(release.fingerprint,g.fingerprint,16)||!sameFirmwareManifest(release.artifact,record.artifact))return Invalid;
    if(record.phase!=Armed&&record.phase!=Started)return Busy;
    return persist(Record{});
  }
  Result acknowledgeRelease(const Group& g,const ArmingAck& ack){
    if(!validGroup(g)||!matchingMembership(g)||record.phase!=Finished||ack.version!=Version||ack.kind!=6||ack.ticket!=record.ticket||!ack.boot||!LampSyncWire::id(ack.coordinator)||!LampSyncWire::id(ack.target)||strcmp(ack.coordinator,g.identity)||memcmp(ack.fingerprint,g.fingerprint,16))return Invalid;
    const auto index=position(record,ack.target);if(index>=32)return NotMember;
    if(record.released&(uint32_t(1)<<index))return Duplicate;
    Record next=record;next.released|=uint32_t(1)<<index;return persist(next);
  }
  // A reserved lease is never reclaimed by a timeout or an unauthenticated
  // cancellation. Members already armed retain their policy until completion.
  Result cancel(const Group& g,uint64_t ticket){if(!matchingGroup(g)||record.ticket!=ticket)return Stale;if(record.phase==Finished){if(record.released!=mask(record.count))return Busy;}else if(record.phase!=Ready||record.armed!=(uint32_t(1)<<position(record,g.identity))||record.completed)return Busy;return persist(Record{});}
};
}
