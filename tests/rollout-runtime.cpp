#define ARDUINO 1
#include "../LampRollout.cpp"
#include <cassert>
#include <iostream>
#include <map>

LampSyncGroupContext fixtureGroup{};
bool fixtureHealthy=false,fixtureOwns=false,fixtureRunning=false,fixtureEnforced=false,fixtureRenewSafe=false;
FirmwareManifest fixtureImage{};
bool lampSyncGroupContext(LampSyncGroupContext& out){out=fixtureGroup;return out.role;}
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
  LampRollout::loaded=false;LampRollout::acceptedAt=0;LampRollout::windowOpen=false;
  fixtureGroup={};fixtureGroup.role=index?2:1;fixtureGroup.protocol=3;fixtureGroup.boot=1000+index+(reboot?10000:0);
  strcpy(fixtureGroup.identity,memberIds[index]);strcpy(fixtureGroup.leader,memberIds[0]);
  fixtureGroup.count=index?1:32;
  if(index)strcpy(fixtureGroup.members[0],memberIds[index]);else memcpy(fixtureGroup.members,memberIds,sizeof(memberIds));
  memset(fixtureGroup.key,17,sizeof(fixtureGroup.key));fixtureOwns=false;
}
String field(const LampControlReply& response,const char* name){const String needle=String("\"")+name+"\":\"";const auto start=response.body.find(needle);assert(start!=std::string::npos);const auto end=response.body.find('"',start+needle.length());assert(end!=std::string::npos);return response.body.substr(start+needle.length(),end-start-needle.length());}
LampControlReply call(const String& action,const String& proof="",const String& command="",const String& ticket="",const String& target="",const String& boot="",const String& manifest=""){
  return LampRollout::request(action,manifest,command,ticket,target,boot,proof);
}
String manifestText(){return String("COOLLAMP-OTA-1\n2.0.1\nesp32c3\ndual-ota-2031616\n1024\n")+String(64,'1')+"\n";}
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
  fixtureImage={};fixtureImage.version[0]=2;fixtureImage.version[2]=1;fixtureImage.size=1024;memset(fixtureImage.sha256,0x11,32);portable();
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
    fakeNow+=PermitLifetime;assert(!lampRolloutAllowsAutomaticUpdate(fixtureImage));assert(call("accept",permit).status==200);assert(!lampRolloutAllowsAutomaticUpdate(fixtureImage)); // duplicate does not renew expiry
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
  std::cout<<"Rollout production handlers:32-member arming/lease/coordinator-last, durable storage failures, HMAC tampering, expiry/rollover, reboot health, release passed; record "<<sizeof(Record)<<" permit "<<sizeof(Permit)<<" health "<<sizeof(Health)<<" context "<<sizeof(LampRollout::Context)<<" bytes\n";
}
