#define ARDUINO 1
#include <Preferences.h>
#include <nvs.h>
#include <Arduino.h>
uint32_t replyFreeHeap=65536,replyLargestBlock=65536;
struct {uint32_t getFreeHeap()const{return replyFreeHeap;}uint32_t getMaxAllocHeap()const{return replyLargestBlock;}} rolloutFixtureEsp;
struct TrackedPreferences:Preferences {
  inline static unsigned opens=0,reads=0;
  inline static bool failOpen=false,failRead=false,failLookup=false,wrongType=false,commitThenShort=false;
  inline static unsigned writes=0;
  bool begin(const char* name,bool readOnly){++opens;return !failOpen&&Preferences::begin(name,readOnly);}
  size_t getBytesLength(const char* key){++reads;return Preferences::getBytesLength(key);}
  size_t getBytes(const char* key,void* out,size_t length){++reads;return failRead?0:Preferences::getBytes(key,out,length);}
  size_t putBytes(const char* key,const void* value,size_t length){++writes;const auto copied=Preferences::putBytes(key,value,length);return commitThenShort&&copied==length?length-1:copied;}
};
esp_err_t rolloutFixtureGetBlob(uint32_t handle,const char* key,void* out,size_t* size){
  ++TrackedPreferences::reads;
  if(TrackedPreferences::failLookup||TrackedPreferences::failRead||TrackedPreferences::wrongType)return -1;
  return nvs_get_blob(handle,key,out,size);
}
#define Preferences TrackedPreferences
#define nvs_get_blob rolloutFixtureGetBlob
#define ESP rolloutFixtureEsp
#include "../LampRollout.cpp"
#undef ESP
#undef nvs_get_blob
#include <cassert>
#include <iostream>
#include <map>

LampSyncGroupContext fixtureGroup{};
bool fixtureHealthy=false,fixtureOwns=false,fixtureRunning=false,fixtureEnforced=false,fixtureRenewSafe=false,fixturePaused=false;
FirmwareManifest fixtureImage{};
bool lampSyncGroupContext(LampSyncGroupContext& out){out=fixtureGroup;return out.role;}
bool lampSyncPaused(){return fixturePaused;}
bool lampBootHealthy(){return fixtureHealthy;}
bool lampUpdateOwnsResources(){return fixtureOwns;}
bool lampRolloutRecoveryPreflight(const FirmwareManifest&){return fixtureRenewSafe&&fixtureHealthy&&!fixtureOwns&&fixtureRunning;}
bool LampFirmwareRelay::runningManifest(FirmwareManifest& out){out=fixtureImage;return fixtureRunning;}
bool UpdatePublisher::enforced(){return fixtureEnforced;}
bool UpdatePublisher::verifyProvisioned(const char*,size_t,Manifest&){return false;}

using namespace LampRolloutCore;
using Store=std::map<std::string,std::vector<uint8_t>>;
std::map<std::string,Store> fixtures;
std::string selected;
char memberIds[32][13]{};
void select(unsigned index,bool reboot=false){
  if(!selected.empty())fixtures[selected]=Preferences::storage;
  selected=memberIds[index];Preferences::storage=fixtures[selected];
  LampRollout::coordinator=State(LampRollout::save,LampRollout::coordinatorKey);
  LampRollout::receiver=State(LampRollout::save,LampRollout::receiverKey);
  LampRollout::loaded=false;LampRollout::loadAttempted=false;LampRollout::loadAttemptAt=0;LampRollout::acceptedAt=0;LampRollout::windowOpen=false;
  fixtureGroup={};fixtureGroup.role=index?2:1;fixtureGroup.protocol=3;fixtureGroup.boot=1000+index+(reboot?10000:0);
  strcpy(fixtureGroup.identity,memberIds[index]);strcpy(fixtureGroup.leader,memberIds[0]);
  fixtureGroup.count=index?1:32;
  if(index)strcpy(fixtureGroup.members[0],memberIds[index]);else memcpy(fixtureGroup.members,memberIds,sizeof(memberIds));
  memset(fixtureGroup.key,17,sizeof(fixtureGroup.key));fixtureOwns=fixturePaused=false;
}
String field(const LampControlReply& response,const char* name){const String needle=String("\"")+name+"\":\"";const auto start=response.body.find(needle);assert(start!=std::string::npos);const auto end=response.body.find('"',start+needle.length());assert(end!=std::string::npos);return response.body.substr(start+needle.length(),end-start-needle.length());}
LampControlReply call(const String& action,const String& proof="",const String& command="",const String& ticket="",const String& target="",const String& boot="",const String& manifest=""){
  return LampRollout::request(action,manifest,command,ticket,target,boot,proof);
}
String manifestText(){return String("COOLLAMP-OTA-1\n2.0.1\nesp32c3\ndual-ota-2031616\n1024\n")+String(64,'1')+"\n";}
void legacyAdmission(){
  selected.clear();fixtures.clear();Preferences::storage.clear();select(1);fixtureGroup.protocol=LampSyncWire::LegacyVersion;
  // Admission reads the real current synchronization identity/context. It
  // never changes membership, optics, paused playback or a durable record.
  const auto oldGroup=fixtureGroup;const auto unloadedOpens=Preferences::opens,unloadedReads=Preferences::reads;
  assert(lampRolloutAutomaticAdmissionSnapshotReason()==3&&Preferences::opens==unloadedOpens&&Preferences::reads==unloadedReads);
  assert(lampRolloutAutomaticAdmissionReason()==0&&lampRolloutAllowsAutomaticAdmission());
  const String expected="{\"version\":1,\"storageReady\":true,\"distributedAutomaticService\":false,\"requiresPhoneOrCoordinatorOrchestration\":true,\"coordinatorLast\":true,\"ticket\":\"0000000000000000\",\"lease\":\"0000000000000000\",\"phase\":0,\"members\":0,\"armedMask\":0,\"completedMask\":0,\"releasedMask\":0,\"target\":\"\",\"receiverTicket\":\"0000000000000000\",\"receiverLease\":\"0000000000000000\",\"receiverPhase\":0,\"permitLifetimeMs\":300000,\"uncertainLease\":false}";
  assert(LampRollout::statusJson()==expected);
  const auto snapshotOpens=Preferences::opens,snapshotReads=Preferences::reads,snapshotWrites=Preferences::writes;
  replyFreeHeap=0;assert(LampRollout::statusJson().empty()&&call("status").status==507);replyFreeHeap=65536;
  replyLargestBlock=0;assert(LampRollout::statusJson().empty()&&call("status").status==507);replyLargestBlock=65536;
  assert(Preferences::opens==snapshotOpens&&Preferences::reads==snapshotReads&&Preferences::writes==snapshotWrites&&LampRollout::statusJson()==expected);
  Record widest{};widest.phase=Reserved;widest.count=32;widest.ticket=widest.lease=widest.targetBoot=UINT64_MAX;widest.command=UINT32_MAX;
  widest.armed=UINT32_MAX;widest.completed=UINT32_MAX>>1;memcpy(widest.members,memberIds,sizeof(memberIds));
  strcpy(widest.coordinator,memberIds[0]);strcpy(widest.target,memberIds[31]);copyManifest(widest.artifact,fixtureImage);
  assert(LampRollout::coordinator.load(widest));const auto widestJson=LampRollout::statusJson();
  assert(widestJson.length()<=640&&LampHttpJson::complete(widestJson.c_str(),widestJson.length()));
  assert(widestJson.find("\"ticket\":\"ffffffffffffffff\"")!=String::npos&&widestJson.find("\"armedMask\":4294967295")!=String::npos&&widestJson.find("\"completedMask\":2147483647")!=String::npos&&widestJson.find("\"uncertainLease\":true")!=String::npos);
  assert(LampRollout::coordinator.load(Record{})&&LampRollout::statusJson()==expected);
  // A serialization failure after a durable start/arm never claims nothing
  // happened and never erases/reissues that ticket. Duplicate readback recovers.
  select(0);assert(lampRolloutAutomaticAdmissionReason()==1);replyFreeHeap=0;
  const auto startedWithoutReply=call("start","","777","","","",manifestText());
  assert(startedWithoutReply.status==507&&startedWithoutReply.body.find("\"uncertain\":true")!=String::npos);
  const auto originalTicket=LampRollout::coordinator.state().ticket;assert(originalTicket&&LampRollout::coordinator.state().phase==Ready);
  replyFreeHeap=65536;const auto recovered=call("start","","777","","","",manifestText());
  assert(recovered.status==200&&LampRollout::coordinator.state().ticket==originalTicket);
  const auto originalArm=field(recovered,"arm");select(1);replyFreeHeap=0;
  assert(call("arm",originalArm).status==507); // The durable arm precedes failed response allocation; it is not undone.
  const auto armedTicket=LampRollout::receiver.state().ticket;
  const auto uncertainDuplicate=LampRollout::result(Duplicate);
  assert(uncertainDuplicate.status==507&&uncertainDuplicate.body.find("\"persisted\":null")!=String::npos&&LampRollout::receiver.state().ticket==armedTicket);
  replyFreeHeap=65536;assert(LampRollout::result(Duplicate).status==200);
  selected.clear();fixtures.clear();Preferences::storage.clear();select(1);fixtureGroup.protocol=LampSyncWire::LegacyVersion;assert(lampRolloutAutomaticAdmissionReason()==0);
  fixturePaused=true;
  assert(lampRolloutAutomaticAdmissionSnapshotReason()==4&&!lampRolloutAllowsAutomaticAdmission()&&fixturePaused);
  // A paused legacy member waits for an explicit resume, while manual exact
  // artifact requests retain their previous behavior outside any ticket.
  assert(lampRolloutAllowsAutomaticUpdate(fixtureImage)&&lampRolloutAutomaticUpdateStarted(fixtureImage)&&fixturePaused);
  fixturePaused=false;assert(lampRolloutAllowsAutomaticAdmission());
  const auto opens=Preferences::opens,reads=Preferences::reads,writes=Preferences::writes;
  Preferences::failWrites=true;
  assert(lampRolloutAutomaticAdmissionSnapshotReason()==0);
  assert(lampRolloutAllowsAutomaticUpdate(fixtureImage)&&lampRolloutAutomaticUpdateStarted(fixtureImage));
  assert(!lampRolloutPinsMembership()&&!memcmp(&oldGroup,&fixtureGroup,sizeof(oldGroup)));
  assert(opens==Preferences::opens&&reads==Preferences::reads&&writes==Preferences::writes);
  Preferences::failWrites=false;
  // The saved protocol-2 configuration and individual receiver boot still
  // qualify after reboot; no implicit protocol/group upgrade is performed.
  select(1,true);fixtureGroup.protocol=LampSyncWire::LegacyVersion;
  assert(lampRolloutAutomaticAdmissionReason()==0&&lampRolloutAutomaticUpdateStarted(fixtureImage));
  const auto valid=fixtureGroup;
  const auto rejected=[&]{const auto reason=lampRolloutAutomaticAdmissionSnapshotReason();assert((reason==3||reason==4)&&!lampRolloutAllowsAutomaticUpdate(fixtureImage)&&!lampRolloutAutomaticUpdateStarted(fixtureImage));};
  fixtureGroup.boot=0;rejected();fixtureGroup=valid;
  fixtureGroup.identity[0]='X';rejected();fixtureGroup=valid;
  fixtureGroup.leader[0]='X';rejected();fixtureGroup=valid;
  memcpy(fixtureGroup.leader,fixtureGroup.identity,13);rejected();fixtureGroup=valid;
  fixtureGroup.members[0][0]='X';rejected();fixtureGroup=valid;
  fixtureGroup.count=0;rejected();fixtureGroup=valid;
  fixtureGroup.role=3;rejected();fixtureGroup=valid;
  for(const auto protocol:{uint8_t(0),uint8_t(1),uint8_t(4),uint8_t(255)}){fixtureGroup.protocol=protocol;rejected();}fixtureGroup=valid;
  // A coordinator may still be updated explicitly outside a ticket, but it
  // cannot restart automatically before verified follower health.
  select(0);fixtureGroup.protocol=LampSyncWire::LegacyVersion;
  assert(lampRolloutAutomaticAdmissionReason()==2&&!lampRolloutAllowsAutomaticAdmission());
  assert(lampRolloutAllowsAutomaticUpdate(fixtureImage)&&lampRolloutAutomaticUpdateStarted(fixtureImage));
  select(1);fixtureGroup.protocol=LampSyncWire::LegacyVersion;assert(lampRolloutAutomaticAdmissionReason()==0);
  // Orphaned receiver/coordinator tickets remain authoritative even if the
  // synchronization context is now legacy or independent. No replay bypass.
  Record orphan{};orphan.phase=Armed;orphan.count=1;orphan.ticket=99;orphan.armed=1;
  strcpy(orphan.coordinator,fixtureGroup.leader);strcpy(orphan.members[0],fixtureGroup.identity);copyManifest(orphan.artifact,fixtureImage);
  for(const auto phase:{Armed,Accepted,Started,RenewReady}){
    orphan.phase=phase;orphan.lease=phase==Armed?0:88;orphan.targetBoot=phase==Armed?0:fixtureGroup.boot;
    if(phase==Armed)memset(orphan.target,0,13);else strcpy(orphan.target,fixtureGroup.identity);
    assert(LampRollout::receiver.load(orphan));rejected();
    fixtureGroup.role=0;rejected();fixtureGroup.role=2;
    assert(LampRollout::receiver.load(Record{}));
  }
  Record reserved{};reserved.phase=Reserved;reserved.count=2;reserved.ticket=99;reserved.lease=88;reserved.targetBoot=fixtureGroup.boot;reserved.armed=3;
  strcpy(reserved.coordinator,fixtureGroup.leader);strcpy(reserved.target,fixtureGroup.identity);
  strcpy(reserved.members[0],fixtureGroup.leader);strcpy(reserved.members[1],fixtureGroup.identity);copyManifest(reserved.artifact,fixtureImage);
  assert(LampRollout::coordinator.load(reserved));rejected();fixtureGroup.role=0;rejected();fixtureGroup.role=2;
  // Failure to write/remove a hold must not open admission. A restored valid
  // hold survives reboot; corrupt/read-failed storage never means empty.
  assert(LampRollout::save(reserved,LampRollout::coordinatorKey));
  Preferences::failWrites=true;assert(!LampRollout::save(Record{},LampRollout::coordinatorKey));rejected();Preferences::failWrites=false;
  select(1,true);fixtureGroup.protocol=LampSyncWire::LegacyVersion;assert(lampRolloutAutomaticAdmissionReason()==4);rejected();
  select(1,true);fixtureGroup.protocol=LampSyncWire::LegacyVersion;Preferences::failRead=true;
  assert(lampRolloutAutomaticAdmissionReason()==3&&!lampRolloutAllowsAutomaticUpdate(fixtureImage)&&!lampRolloutAutomaticUpdateStarted(fixtureImage));Preferences::failRead=false;
  for(auto* fault:{&Preferences::failLookup,&Preferences::wrongType}){
    select(1,true);fixtureGroup.protocol=LampSyncWire::LegacyVersion;*fault=true;
    assert(lampRolloutAutomaticAdmissionReason()==3&&!lampRolloutAllowsAutomaticUpdate(fixtureImage)&&!lampRolloutAutomaticUpdateStarted(fixtureImage));
    *fault=false;assert(lampRolloutAutomaticAdmissionReason()==4);rejected();
  }
  Preferences::storage["rolloutC1"][0]=99;LampRollout::loaded=false;
  assert(lampRolloutAutomaticAdmissionReason()==3&&!lampRolloutAllowsAutomaticUpdate(fixtureImage)&&!lampRolloutAutomaticUpdateStarted(fixtureImage));
  Preferences::storage.clear();LampRollout::loaded=false;Preferences::failOpen=true;
  assert(lampRolloutAutomaticAdmissionReason()==3&&!lampRolloutAllowsAutomaticUpdate(fixtureImage)&&!lampRolloutAutomaticUpdateStarted(fixtureImage));Preferences::failOpen=false;
  assert(lampRolloutAutomaticAdmissionReason()==4); // A prior in-RAM hold is not silently retired by disappearance.
  selected.clear();fixtures.clear();Preferences::storage.clear();select(1,true);fixtureGroup.protocol=LampSyncWire::LegacyVersion;
  assert(lampRolloutAutomaticAdmissionReason()==0); // A fresh boot with verified absent records remains compatible.
  // NVS may report a short/failed write after actually committing. A prior
  // Empty RAM view is never permission to move groups or admit an update.
  selected.clear();fixtures.clear();Preferences::storage.clear();select(0);
  Preferences::commitThenShort=true;
  const auto unconfirmedStart=call("start","","999","","","",manifestText());
  assert(unconfirmedStart.status==500&&unconfirmedStart.body.find("\"result\":6,\"persisted\":null,\"uncertain\":true")!=String::npos);
  assert(!LampRollout::loaded&&LampRollout::coordinator.state().phase==Empty&&lampRolloutPinsMembership());
  Preferences::commitThenShort=false;fixtureGroup.protocol=LampSyncWire::LegacyVersion;fixtureGroup.role=2;
  strcpy(fixtureGroup.identity,memberIds[1]);fixtureGroup.count=1;strcpy(fixtureGroup.members[0],memberIds[1]);
  assert(lampRolloutAutomaticAdmissionReason()==4&&LampRollout::coordinator.state().phase==Ready);rejected();
  fixtureGroup.protocol=LampSyncWire::ExpandedVersion;fixtureGroup.role=1;strcpy(fixtureGroup.identity,memberIds[0]);fixtureGroup.count=32;memcpy(fixtureGroup.members,memberIds,sizeof(memberIds));
  const auto persistedStart=call("start","","999","","","",manifestText());assert(persistedStart.status==200);const auto committedArm=field(persistedStart,"arm");
  select(1);Preferences::commitThenShort=true;const auto unconfirmedArm=call("arm",committedArm);
  assert(unconfirmedArm.status==500&&unconfirmedArm.body.find("\"persisted\":null,\"uncertain\":true")!=String::npos);
  assert(!LampRollout::loaded&&LampRollout::receiver.state().phase==Empty&&lampRolloutPinsMembership());
  Preferences::commitThenShort=false;fixtureGroup.protocol=LampSyncWire::LegacyVersion;
  assert(lampRolloutAutomaticAdmissionReason()==4&&LampRollout::receiver.state().phase==Armed);rejected();
  selected.clear();fixtures.clear();Preferences::storage.clear();
}
void portable(){
  struct Storage {Record saved{};bool fail=false;unsigned writes=0;} storage;
  auto writer=[](const Record& r,void* value){auto& s=*static_cast<Storage*>(value);if(s.fail)return false;s.saved=r;++s.writes;return true;};
  State state(writer,&storage);Group g{};g.role=1;g.protocol=3;g.boot=123;g.count=32;
  strcpy(g.identity,memberIds[0]);strcpy(g.leader,memberIds[0]);memcpy(g.members,memberIds,sizeof(memberIds));memset(g.fingerprint,42,16);
  auto m=fixtureImage;storage.fail=true;assert(state.create(g,m,1,2)==StorageFailure&&state.state().phase==Empty);storage.fail=false;
  assert(state.create(g,m,1,2)==Ok);assert(state.create(g,m,1,3)==Duplicate);assert(state.reserve(g,2,memberIds[1],5,2,6)==Busy);
  for(unsigned i=1;i<32;++i){ArmingAck ack{};ack.ticket=2;ack.boot=3;strcpy(ack.coordinator,memberIds[0]);strcpy(ack.target,memberIds[i]);memcpy(ack.fingerprint,g.fingerprint,16);
    storage.fail=true;assert(state.acknowledgeArm(g,ack)==StorageFailure);storage.fail=false;assert(state.acknowledgeArm(g,ack)==Ok);const auto writes=storage.writes;assert(state.acknowledgeArm(g,ack)==Duplicate&&storage.writes==writes);}
  assert(state.reserve(g,2,memberIds[0],123,2,6)==CoordinatorLast);
  for(unsigned i=1;i<32;++i){storage.fail=true;assert(state.reserve(g,2,memberIds[i],100+i,i+1,100+i)==StorageFailure&&state.state().phase==Ready);storage.fail=false;
    assert(state.reserve(g,2,memberIds[i],100+i,i+1,100+i)==Ok);const auto writes=storage.writes;
    assert(state.reserve(g,2,memberIds[i],100+i,i+1,999)==Duplicate&&storage.writes==writes);assert(state.reserve(g,2,memberIds[0],123,999,999)==Busy);
    Permit permit{};assert(state.permit(permit));State receiver(writer,&storage);Group target=g;target.role=2;target.count=1;strcpy(target.identity,memberIds[i]);target.boot=100+i;
    assert(receiver.accept(target,permit)==Busy);Arming arming{};assert(state.arming(arming));assert(receiver.arm(target,arming)==Ok);
    auto wrong=permit;wrong.targetBoot++;assert(receiver.accept(target,wrong)==Invalid);wrong=permit;wrong.artifact.sha256[0]^=1;assert(receiver.accept(target,wrong)==Stale);
    wrong=permit;memset(wrong.target,'a',sizeof(wrong.target));assert(receiver.accept(target,wrong)==Invalid);wrong=permit;memset(wrong.coordinator,'a',sizeof(wrong.coordinator));assert(receiver.accept(target,wrong)==Invalid);
    storage.fail=true;assert(receiver.accept(target,permit)==StorageFailure&&receiver.state().phase==Armed);storage.fail=false;assert(receiver.accept(target,permit)==Ok);
    assert(receiver.eligible(target,m));target.boot++;assert(!receiver.eligible(target,m));target.boot--;storage.fail=true;assert(receiver.started(target,m)==StorageFailure);storage.fail=false;assert(receiver.started(target,m)==Ok);
    Health health{};health.ticket=2;health.lease=permit.lease;health.boot=target.boot+1;strcpy(health.coordinator,g.identity);strcpy(health.target,target.identity);memcpy(health.fingerprint,g.fingerprint,16);copyManifest(health.artifact,m);
    wrong=permit;Group reordered=g;std::swap(reordered.members[0],reordered.members[1]);assert(state.complete(reordered,health)==Invalid);
    auto bad=health;bad.lease++;assert(state.complete(g,bad)==Stale);bad=health;bad.ticket++;assert(state.complete(g,bad)==Invalid);
    storage.fail=true;assert(state.complete(g,health)==StorageFailure&&state.state().phase==Reserved);storage.fail=false;assert(state.complete(g,health)==Ok);assert(state.complete(g,health)==Duplicate);
    assert(state.state().completed&(uint32_t(1)<<i));}
  assert(state.reserve(g,2,memberIds[0],123,99,100)==Ok);Health self{};self.ticket=2;self.lease=100;self.boot=124;strcpy(self.coordinator,g.identity);strcpy(self.target,g.identity);memcpy(self.fingerprint,g.fingerprint,16);copyManifest(self.artifact,m);
  assert(state.complete(g,self)==Ok&&state.state().phase==Finished&&state.state().completed==UINT32_MAX);Release release{};assert(state.release(release));
  Record corrupt=state.state();corrupt.version++;State reboot(writer,&storage);assert(!reboot.load(corrupt));assert(reboot.load(state.state()));assert(reboot.cancel(g,2)==Busy);
  corrupt=state.state();corrupt.completed=0;assert(!reboot.load(corrupt));corrupt=state.state();memset(corrupt.target,'a',sizeof(corrupt.target));corrupt.phase=Empty;corrupt.ticket=corrupt.lease=0;assert(!reboot.load(corrupt));
  for(unsigned i=0;i<32;++i){ArmingAck ack{};ack.kind=6;ack.ticket=2;ack.boot=4;strcpy(ack.coordinator,g.identity);strcpy(ack.target,memberIds[i]);memcpy(ack.fingerprint,g.fingerprint,16);assert(reboot.acknowledgeRelease(g,ack)==Ok);assert(reboot.acknowledgeRelease(g,ack)==Duplicate);}
  assert(reboot.cancel(g,2)==Ok);
}
int main(){
  for(unsigned i=0;i<32;++i)snprintf(memberIds[i],13,"11223344%04x",i*2);
  fixtureImage={};fixtureImage.version[0]=2;fixtureImage.version[2]=1;fixtureImage.size=1024;memset(fixtureImage.sha256,0x11,32);portable();legacyAdmission();
  fakeNow=UINT32_MAX-100;select(0);
  const auto untouchedOpens=Preferences::opens,untouchedReads=Preferences::reads;
  assert(call("status").status==500&&LampRollout::statusJson().find("\"storageReady\":false")!=String::npos);
  assert(lampRolloutAutomaticAdmissionSnapshotReason()==3&&lampRolloutPinsMembership());
  assert(Preferences::opens==untouchedOpens&&Preferences::reads==untouchedReads&&!LampRollout::loaded);
  fixtureOwns=true;LampRollout::service(fakeNow);assert(Preferences::opens==untouchedOpens&&!LampRollout::loadAttempted);fixtureOwns=false;
  Preferences::failOpen=true;LampRollout::service(fakeNow);assert(Preferences::opens==untouchedOpens+1);
  fakeNow+=999;LampRollout::service(fakeNow);assert(Preferences::opens==untouchedOpens+1);
  assert(call("status").status==500&&lampRolloutAutomaticAdmissionSnapshotReason()==3&&Preferences::opens==untouchedOpens+1);
  fakeNow+=1;LampRollout::service(fakeNow);assert(Preferences::opens==untouchedOpens+2);
  Preferences::failOpen=false;fakeNow+=1000;LampRollout::service(fakeNow);assert(LampRollout::loaded&&call("status").status==200);
  fakeNow=100;select(0);fixtureEnforced=true;assert(call("start","","1","","","",manifestText()).status==400);fixtureEnforced=false;
  assert(lampRolloutAutomaticAdmissionReason()==1&&!lampRolloutAllowsAutomaticAdmission());fixtureGroup.role=0;assert(lampRolloutAllowsAutomaticAdmission());fixtureGroup.role=1;
  fixtureGroup.protocol=2;assert(lampRolloutAutomaticAdmissionReason()==2);fixtureGroup.protocol=3;
  fixtureOwns=true;assert(call("start","","1","","","",manifestText()).status==409&&LampRollout::coordinator.state().phase==Empty);fixtureOwns=false;
  Preferences::failWrites=true;assert(call("start","","1","","","",manifestText()).status==500);Preferences::failWrites=false;
  auto start=call("start","","1","","","",manifestText());assert(start.status==200);const auto arm=field(start,"arm"),ticket=field(start,"ticket");
  assert(lampRolloutPinsMembership());
  assert(!lampRolloutAllowsAutomaticUpdate(fixtureImage));assert(call("reserve","","2",ticket,memberIds[1],LampRollout::number(1001)).status==409);
  for(unsigned i=0;i<32;++i){select(i);assert(call("accept",String(sizeof(Permit)*2,'0')).status==400);
    auto wrong=arm;wrong[wrong.length()-1]=wrong.back()=='a'?'b':'a';assert(call("arm",wrong).status==400);
    Preferences::failWrites=true;assert(call("arm",arm).status==500);Preferences::failWrites=false;
    const auto ack=call("arm",arm);assert(ack.status==200);assert(!lampRolloutAllowsAutomaticUpdate(fixtureImage));const auto proof=field(ack,"armAck");
    select(0);assert(call("arm-reconcile",proof).status==200);}
  select(0);assert(call("reserve","","2",ticket,memberIds[0],LampRollout::number(1000)).status==409);
  for(unsigned i=1;i<32;++i){select(0);const auto reservation=call("reserve","",String(i+1),ticket,memberIds[i],LampRollout::number(1000+i));assert(reservation.status==200);
    const auto permit=field(reservation,"permit");assert(permit.length()==sizeof(Permit)*2);assert(call("cancel","","",ticket).status==409);
    select(i);auto wrong=permit;wrong[0]='f';assert(call("accept",wrong).status==400);assert(call("accept",permit).status==200);
    assert(lampRolloutAllowsAutomaticUpdate(fixtureImage));auto other=fixtureImage;other.sha256[0]^=1;assert(!lampRolloutAllowsAutomaticUpdate(other));
    assert(lampRolloutAllowsAutomaticAdmission());
    fakeNow+=PermitLifetime;
    const auto statusOpens=Preferences::opens,statusReads=Preferences::reads;
    assert(LampRollout::windowOpen&&lampRolloutAutomaticAdmissionSnapshotReason()==4);
    assert(call("status").status==200&&!LampRollout::statusJson().empty()&&lampRolloutPinsMembership());
    assert(LampRollout::windowOpen&&Preferences::opens==statusOpens&&Preferences::reads==statusReads);
    assert(!lampRolloutAllowsAutomaticUpdate(fixtureImage));assert(call("accept",permit).status==200);assert(!lampRolloutAllowsAutomaticUpdate(fixtureImage)); // duplicate does not renew expiry
    assert(lampRolloutAutomaticAdmissionReason()==4);
    // Explicit renewal holds exactly the original lease; external update HAL
    // preflight is separately tested by production updater/OTA fixture suites.
    fixtureHealthy=fixtureRunning=true;fixtureRenewSafe=false;assert(call("renew-proof").status==409);fixtureRenewSafe=true;
    Preferences::failWrites=true;assert(call("renew-proof").status==500);Preferences::failWrites=false;
    auto recovery=field(call("renew-proof"),"recovery");select(0);assert(LampRollout::load());const auto lease=LampRollout::coordinator.state().lease;Preferences::failWrites=true;assert(call("renew",recovery,String(1000+i)).status==500);Preferences::failWrites=false;
    auto renewal=call("renew",recovery,String(1000+i));assert(renewal.status==200);assert(LampRollout::coordinator.state().lease==lease);
    const auto renewed=field(renewal,"renewPermit");assert(call("renew",recovery,String(1000+i)).status==200);select(i);Preferences::failWrites=true;assert(call("renew-accept",renewed).status==500);Preferences::failWrites=false;
    assert(call("renew-accept",renewed).status==200);const auto accepted=LampRollout::acceptedAt;fakeNow+=50;assert(call("renew-accept",renewed).status==200&&LampRollout::acceptedAt==accepted);
    Preferences::failWrites=true;assert(!lampRolloutAutomaticUpdateStarted(fixtureImage));Preferences::failWrites=false;
    fixtureOwns=true;assert(lampRolloutAutomaticUpdateStarted(fixtureImage));assert(lampRolloutAllowsAutomaticUpdate(fixtureImage));select(i,true);assert(!lampRolloutAllowsAutomaticUpdate(fixtureImage));
    if(i==1){fixtureRenewSafe=false;assert(call("renew-proof").status==409&&LampRollout::receiver.state().phase==Started);fixtureRenewSafe=true;
      const auto proof=field(call("renew-proof"),"recovery");select(0);const auto grant=field(call("renew",proof,"2001"),"renewPermit");select(i,true);assert(call("renew-accept",grant).status==200);fixtureOwns=true;assert(lampRolloutAutomaticUpdateStarted(fixtureImage));fixtureOwns=false;}
    fixtureHealthy=false;fixtureRunning=true;assert(call("health").status==409);fixtureHealthy=true;fixtureRunning=false;assert(call("health").status==409);fixtureRunning=true;
    auto proof=field(call("health"),"health");select(0);auto bad=proof;bad.back()=bad.back()=='a'?'b':'a';assert(call("reconcile",bad).status==400);assert(call("reconcile",proof).status==200);assert(call("reconcile",proof).status==200);
  }
  select(0);auto reserve=call("reserve","","100",ticket,memberIds[0],LampRollout::number(1000));assert(reserve.status==200);assert(call("accept",field(reserve,"permit")).status==200);
  fixtureOwns=true;assert(lampRolloutAutomaticUpdateStarted(fixtureImage));fixtureOwns=false;fixtureHealthy=fixtureRunning=true;const auto self=field(call("health"),"health");assert(call("reconcile",self).status==200);
  const auto release=field(call("release"),"release");assert(call("cancel","","",ticket).status==409);
  for(unsigned i=0;i<32;++i){select(i,true);const auto ack=call("finish",release);assert(ack.status==200);assert(call("finish",release).status==200);assert(lampRolloutAllowsAutomaticUpdate(fixtureImage));select(0);assert(call("release-reconcile",field(ack,"releaseAck")).status==200);}
  select(0);assert(call("cancel","","",ticket).status==200);
  assert(!lampRolloutPinsMembership());
  // A rebooted Accepted permit never renews itself; stale target boots, wrong
  // group keys, malformed durable storage and uint32 clock wrap fail closed.
  selected.clear();fixtures.clear();Preferences::storage.clear();select(0);start=call("start","","1","","","",manifestText());const auto newArm=field(start,"arm");select(1);assert(call("arm",newArm).status==200);
  fixtureGroup.key[0]^=1;assert(call("arm",newArm).status==400);fixtureGroup.key[0]^=1;
  Permit wrap{};wrap.ticket=LampRollout::receiver.state().ticket;wrap.lease=99;wrap.targetBoot=fixtureGroup.boot;strcpy(wrap.coordinator,fixtureGroup.leader);strcpy(wrap.target,fixtureGroup.identity);copyManifest(wrap.artifact,fixtureImage);
  {LampRollout::Context context;memcpy(wrap.fingerprint,context.group.fingerprint,16);assert(LampRollout::sign(&wrap,offsetof(Permit,proof),wrap.proof,context));}
  fakeNow=UINT32_MAX-1000;assert(call("accept",LampRollout::hex(&wrap,sizeof(wrap))).status==200);fakeNow=1000;LampRollout::service(fakeNow);assert(lampRolloutAllowsAutomaticUpdate(fixtureImage));fakeNow=300000;LampRollout::service(fakeNow);assert(!lampRolloutAllowsAutomaticUpdate(fixtureImage));fakeNow=UINT32_MAX-999;assert(!lampRolloutAllowsAutomaticUpdate(fixtureImage));
  auto bytes=Preferences::storage["rolloutR1"];bytes[0]=99;Preferences::storage["rolloutR1"]=bytes;LampRollout::loaded=false;assert(!lampRolloutAllowsAutomaticUpdate(fixtureImage));assert(call("status").status==500);
  assert(lampRolloutAutomaticAdmissionReason()==3);
  std::cout<<"Rollout production handlers:unarmed legacy follower admission, legacy coordinator hold, unknown/context/orphan/storage fences, 32-member arming/lease/coordinator-last, durable storage failures, HMAC tampering, expiry/rollover, reboot health, release passed; record "<<sizeof(Record)<<" permit "<<sizeof(Permit)<<" health "<<sizeof(Health)<<" context "<<sizeof(LampRollout::Context)<<" bytes\n";
}
