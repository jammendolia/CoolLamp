#include "LampRollout.h"
#include "LampSync.h"
#include "LampUpdate.h"
#include "LampControlResourcePolicy.h"
#include "LampHttpJson.h"
#include "LampFirmwareRelay.h"
#include "UpdatePublisher.h"
#include <Preferences.h>
#include <nvs.h>
#include <esp_system.h>
#include <mbedtls/md.h>

namespace LampRollout {
namespace {
using namespace LampRolloutCore;
void zero(void* value,size_t size){volatile uint8_t* p=static_cast<volatile uint8_t*>(value);while(size--)*p++=0;}
bool loaded=false;
bool save(const Record& record,void* name){
  Preferences prefs;bool ok=false;
  if(prefs.begin("coollamp",false)){ok=prefs.putBytes(static_cast<const char*>(name),&record,sizeof(record))==sizeof(record);prefs.end();}
  // A reported failure may follow a durable commit. Invalidate the RAM-only
  // absence proof until loop-owned direct NVS readback resolves that hold.
  if(!ok)loaded=false;
  return ok;
}
char coordinatorKey[]="rolloutC1",receiverKey[]="rolloutR1";
State coordinator(save,coordinatorKey),receiver(save,receiverKey);
bool loadAttempted=false;
uint32_t loadAttemptAt=0;
uint32_t acceptedAt=0;
bool windowOpen=false;
class RolloutPreferences:public Preferences {
public:
  bool snapshot(const char* key,Record& record,bool& absent){
    size_t size=sizeof(record);const auto error=nvs_get_blob(_handle,key,&record,&size);
    absent=error==ESP_ERR_NVS_NOT_FOUND;
    return absent||(error==ESP_OK&&size==sizeof(record));
  }
};
bool load(){
  if(loaded)return true;
  RolloutPreferences prefs;if(!prefs.begin("coollamp",true))return false;
  bool ok=true;const char* keys[]={coordinatorKey,receiverKey};
  for(const auto* key:keys){
    // Convenience size reads map both absence and storage/type failures to
    // zero. Only an explicit NOT_FOUND can prove there is no durable hold.
    Record record{};bool absent=false;if(!prefs.snapshot(key,record,absent)){ok=false;break;}if(absent)continue;
    if(!(key==coordinatorKey?coordinator.load(record):receiver.load(record))){ok=false;break;}}
  prefs.end();loaded=ok;return ok;
}
struct Context {
  Group group{};uint8_t key[16]{};
  Context(){
    LampSyncGroupContext raw{};
    lampSyncGroupContext(raw);group.role=raw.role;group.protocol=raw.protocol;group.count=raw.count;group.boot=raw.boot;
    memcpy(key,raw.key,sizeof(key));
    memcpy(group.identity,raw.identity,13);memcpy(group.leader,raw.leader,13);memcpy(group.members,raw.members,sizeof(group.members));
    if(raw.role){uint8_t hash[32]{};constexpr char domain[]="CoolLamp rollout group v1";
      uint8_t body[sizeof(domain)-1+12];memcpy(body,domain,sizeof(domain)-1);memcpy(body+sizeof(domain)-1,raw.leader,12);
      if(!mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),key,16,body,sizeof(body),hash))memcpy(group.fingerprint,hash,16);
      zero(hash,sizeof(hash));}
    zero(raw.key,sizeof(raw.key));
  }
  ~Context(){zero(key,sizeof(key));}
};
static_assert(sizeof(Context)<=512,"Rollout group context is bounded without duplicate member arrays");
bool emptyRecords(){return coordinator.state().phase==Empty&&receiver.state().phase==Empty;}
bool validLegacyContext(const Group& group){
  if(group.protocol!=LampSyncWire::LegacyVersion||!group.boot||!LampSyncWire::id(group.identity)||!LampSyncWire::id(group.leader))return false;
  return group.role==1?!strcmp(group.identity,group.leader):
    group.role==2&&strcmp(group.identity,group.leader)&&group.count==1&&!strcmp(group.members[0],group.identity);
}
uint64_t random(){uint64_t value=uint64_t(esp_random())<<32|esp_random();return value?value:1;}
bool hexRead(const String& text,uint8_t* out,size_t size){if(text.length()!=size*2)return false;for(size_t i=0;i<size;++i){unsigned byte=0;for(unsigned j=0;j<2;++j){char c=text[i*2+j];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;byte=byte*16+(c<='9'?c-'0':c-'a'+10);}out[i]=byte;}return true;}
String hex(const void* bytes,size_t size){const auto* p=static_cast<const uint8_t*>(bytes);const char* digits="0123456789abcdef";String out;if(!out.reserve(size*2))return String();for(size_t i=0;i<size;++i){out+=digits[p[i]>>4];out+=digits[p[i]&15];}return out;}
[[maybe_unused]] String number(uint64_t value){char buffer[17];snprintf(buffer,sizeof(buffer),"%016llx",static_cast<unsigned long long>(value));return String(buffer);}
bool number(const String& text,uint64_t& value){if(text.length()!=16)return false;value=0;for(size_t i=0;i<text.length();++i){const char c=text[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;value=(value<<4)|(c<='9'?c-'0':c-'a'+10);}return value!=0;}
bool commandNumber(const String& text,uint32_t& value){if(!text.length()||text.length()>10)return false;uint64_t parsed=0;for(size_t i=0;i<text.length();++i){const char c=text[i];if(c<'0'||c>'9')return false;parsed=parsed*10+c-'0';if(parsed>UINT32_MAX)return false;}value=parsed;return value!=0;}
bool sign(void* body,size_t size,uint8_t* proof,const Context& context){return context.group.role&&mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),context.key,16,static_cast<const uint8_t*>(body),size,proof)==0;}
bool verify(void* body,size_t size,const uint8_t* proof,const Context& context){uint8_t expected[32]{};if(!sign(body,size,expected,context))return false;uint8_t diff=0;for(unsigned i=0;i<32;++i)diff|=expected[i]^proof[i];zero(expected,sizeof(expected));return !diff;}
LampControlReply replyUnavailable(){return {507,"{\"version\":1,\"error\":\"rollout-reply-memory\",\"persisted\":null,\"uncertain\":true}"};}
String checkedReply(const char* prefix,size_t length,const String* state=nullptr){
  const size_t suffix=state?state->length()+1:0;
  if(!length||length>1024||suffix>1024-length)return String();
  const size_t size=length+suffix;
  if(!LampControlResourcePolicy::readReplyReady(ESP.getFreeHeap(),ESP.getMaxAllocHeap(),size))return String();
  String out;
  if(!out.reserve(size)||!out.concat(prefix,length)||(state&&(!out.concat(*state)||!out.concat('}')))||out.length()!=size||!LampHttpJson::complete(out.c_str(),size))return String();
  return out;
}
LampControlReply proofReply(const char* name,const void* bytes,size_t size,uint8_t flags=1,const String* state=nullptr){
  const String proof=hex(bytes,size);if(proof.length()!=size*2)return replyUnavailable();
  char head[48];const int used=snprintf(head,sizeof(head),"{\"version\":1,\"%s\":\"",name);
  if(used<=0||size_t(used)>=sizeof(head))return replyUnavailable();
  const char* persisted=flags&1?",\"persisted\":true":"",*readback=flags&2?",\"controlReadbackRequired\":true":"",*tail=state?",\"state\":":"}";
  const size_t wanted=size_t(used)+proof.length()+1+strlen(persisted)+strlen(readback)+strlen(tail);
  String prefix;if(wanted>1024||!prefix.reserve(wanted)||!prefix.concat(head,size_t(used))||!prefix.concat(proof)||!prefix.concat('"')||!prefix.concat(persisted)||!prefix.concat(readback)||!prefix.concat(tail)||prefix.length()!=wanted)return replyUnavailable();
  const String body=checkedReply(prefix.c_str(),prefix.length(),state);
  return body.length()?LampControlReply{200,body}:replyUnavailable();
}
LampControlReply result(Result outcome){
  const uint16_t status=outcome==Ok||outcome==Duplicate?200:outcome==StorageFailure?500:outcome==Invalid?400:409;
  const String state=statusJson();if(!state.length())return replyUnavailable();
  const bool uncertain=outcome==StorageFailure;
  char prefix[80];const int used=snprintf(prefix,sizeof(prefix),"{\"version\":1,\"result\":%u,\"persisted\":%s%s,\"state\":",unsigned(outcome),uncertain?"null":outcome==Ok||outcome==Duplicate?"true":"false",uncertain?",\"uncertain\":true":"");
  String body=used>0&&size_t(used)<sizeof(prefix)?checkedReply(prefix,size_t(used),&state):String();
  return !body.length()?replyUnavailable():LampControlReply{status,body};
}
bool manifest(const String& text,FirmwareManifest& image){
  if(!text.length()||text.length()>512)return false;
  char bytes[513]{};memcpy(bytes,text.c_str(),text.length());
  UpdatePublisher::Manifest signedImage{};
  bool ok=UpdatePublisher::verifyProvisioned(bytes,text.length(),signedImage);
  if(ok)copyManifest(image,signedImage.image);
  else if(!UpdatePublisher::enforced())ok=parseFirmwareManifest(bytes,image);
  zero(bytes,sizeof(bytes));return ok&&validArtifact(image);
}
}
String statusJson(){
  const bool ready=loaded;const auto& c=coordinator.state();const auto& r=receiver.state();
  // One fixed stack scratch, then one checked owned reply. All fields and
  // their order match the original wire contract; no persistent buffer or
  // template encoder copies are retained. The stack budget includes 640B.
  char bytes[640];
  const int used=snprintf(bytes,sizeof(bytes),"{\"version\":1,\"storageReady\":%s,\"distributedAutomaticService\":false,\"requiresPhoneOrCoordinatorOrchestration\":true,\"coordinatorLast\":true,\"ticket\":\"%016llx\",\"lease\":\"%016llx\",\"phase\":%u,\"members\":%u,\"armedMask\":%lu,\"completedMask\":%lu,\"releasedMask\":%lu,\"target\":\"%s\",\"receiverTicket\":\"%016llx\",\"receiverLease\":\"%016llx\",\"receiverPhase\":%u,\"permitLifetimeMs\":%lu,\"uncertainLease\":%s}",
    ready?"true":"false",static_cast<unsigned long long>(c.ticket),static_cast<unsigned long long>(c.lease),unsigned(c.phase),unsigned(c.count),
    static_cast<unsigned long>(c.armed),static_cast<unsigned long>(c.completed),static_cast<unsigned long>(c.released),c.target,
    static_cast<unsigned long long>(r.ticket),static_cast<unsigned long long>(r.lease),unsigned(r.phase),static_cast<unsigned long>(PermitLifetime),c.phase==Reserved?"true":"false");
  return used>0&&size_t(used)<sizeof(bytes)?checkedReply(bytes,size_t(used)):String();
}
void service(uint32_t now){
  if(!loaded&&!lampUpdateOwnsResources()&&(!loadAttempted||uint32_t(now-loadAttemptAt)>=1000)){
    loadAttempted=true;loadAttemptAt=now;load();
  }
  if(windowOpen&&uint32_t(now-acceptedAt)>=PermitLifetime)windowOpen=false;
}
LampControlReply request(const String& action,const String& imageText,const String& commandText,const String& ticketText,const String& target,const String& targetBootText,const String& proofText){
  if(action=="status"){const String body=statusJson();return !body.length()?replyUnavailable():LampControlReply{loaded?uint16_t(200):uint16_t(500),body};}
  if(!load())return result(StorageFailure);
  Context context;
  if(context.group.protocol!=3||!context.group.role)return result(Invalid);
  if(action=="renew-proof"){
    if(!lampRolloutRecoveryPreflight(receiver.state().artifact))return result(Busy);
    const auto outcome=receiver.prepareRenew(context.group);if(outcome!=Ok&&outcome!=Duplicate)return result(outcome);
    windowOpen=false;Permit proof{};if(!receiver.recovery(proof)||!sign(&proof,offsetof(Permit,proof),proof.proof,context))return result(Invalid);
    return proofReply("recovery",&proof,sizeof(proof),3);
  }
  if(action=="renew-accept"){
    RenewPermit permit{};if(!hexRead(proofText,reinterpret_cast<uint8_t*>(&permit),sizeof(permit))||!verify(&permit,offsetof(RenewPermit,proof),permit.proof,context))return result(Invalid);
    const auto outcome=receiver.acceptRenew(context.group,permit);if(outcome==Ok){acceptedAt=millis();windowOpen=true;}return result(outcome);
  }
  if(action=="arm"){
    Arming arming{};if(lampUpdateOwnsResources()||!hexRead(proofText,reinterpret_cast<uint8_t*>(&arming),sizeof(arming))||!verify(&arming,offsetof(Arming,proof),arming.proof,context))return result(Invalid);
    const auto outcome=receiver.arm(context.group,arming);if(outcome!=Ok&&outcome!=Duplicate)return result(outcome);
    ArmingAck ack{};ack.ticket=arming.ticket;ack.boot=context.group.boot;memcpy(ack.coordinator,context.group.leader,13);memcpy(ack.target,context.group.identity,13);memcpy(ack.fingerprint,context.group.fingerprint,16);
    if(!sign(&ack,offsetof(ArmingAck,proof),ack.proof,context))return result(Invalid);
    return proofReply("armAck",&ack,sizeof(ack));
  }
  if(action=="health"){
    const auto& r=receiver.state();FirmwareManifest running{};
    if((r.phase!=Started&&r.phase!=Accepted)||!receiver.matchingGroup(context.group)||!lampBootHealthy()||
      !LampFirmwareRelay::runningManifest(running)||!sameFirmwareManifest(running,r.artifact))return result(Busy);
    Health health{};health.ticket=r.ticket;health.lease=r.lease;health.boot=context.group.boot;
    memcpy(health.coordinator,r.coordinator,13);memcpy(health.target,context.group.identity,13);memcpy(health.fingerprint,r.fingerprint,16);copyManifest(health.artifact,r.artifact);
    if(!sign(&health,offsetof(Health,proof),health.proof,context))return result(Invalid);
    return proofReply("health",&health,sizeof(health),2);
  }
  if(action=="accept"){
    Permit permit{};if(!hexRead(proofText,reinterpret_cast<uint8_t*>(&permit),sizeof(permit))||!verify(&permit,offsetof(Permit,proof),permit.proof,context))return result(Invalid);
    const auto outcome=receiver.accept(context.group,permit);if(outcome==Ok){acceptedAt=millis();windowOpen=true;}return result(outcome);
  }
  if(action=="finish"){
    Release release{};if(lampUpdateOwnsResources()||!hexRead(proofText,reinterpret_cast<uint8_t*>(&release),sizeof(release))||!verify(&release,offsetof(Release,proof),release.proof,context))return result(Invalid);
    FirmwareManifest running{};if(receiver.state().phase==Started&&(!lampBootHealthy()||!LampFirmwareRelay::runningManifest(running)||!sameFirmwareManifest(running,release.artifact)))return result(Busy);
    const auto outcome=receiver.finish(context.group,release);if(outcome!=Ok&&outcome!=Duplicate)return result(outcome);
    ArmingAck ack{};ack.kind=6;ack.ticket=release.ticket;ack.boot=context.group.boot;memcpy(ack.coordinator,context.group.leader,13);memcpy(ack.target,context.group.identity,13);memcpy(ack.fingerprint,context.group.fingerprint,16);
    if(!sign(&ack,offsetof(ArmingAck,proof),ack.proof,context))return result(Invalid);
    return proofReply("releaseAck",&ack,sizeof(ack));
  }
  if(context.group.role!=1)return result(Invalid);
  if(action=="renew"){
    Permit proof{};uint32_t command=0;if(!commandNumber(commandText,command)||!hexRead(proofText,reinterpret_cast<uint8_t*>(&proof),sizeof(proof))||!verify(&proof,offsetof(Permit,proof),proof.proof,context))return result(Invalid);
    const auto outcome=coordinator.renew(context.group,proof,command);if(outcome!=Ok&&outcome!=Duplicate)return result(outcome);
    RenewPermit permit{};if(!coordinator.renewedPermit(permit)||!sign(&permit,offsetof(RenewPermit,proof),permit.proof,context))return result(Invalid);
    return proofReply("renewPermit",&permit,sizeof(permit));
  }
  if(action=="arm-reconcile"){
    ArmingAck ack{};if(!hexRead(proofText,reinterpret_cast<uint8_t*>(&ack),sizeof(ack))||!verify(&ack,offsetof(ArmingAck,proof),ack.proof,context))return result(Invalid);
    return result(coordinator.acknowledgeArm(context.group,ack));
  }
  if(action=="release-reconcile"){
    ArmingAck ack{};if(!hexRead(proofText,reinterpret_cast<uint8_t*>(&ack),sizeof(ack))||!verify(&ack,offsetof(ArmingAck,proof),ack.proof,context))return result(Invalid);
    return result(coordinator.acknowledgeRelease(context.group,ack));
  }
  if(action=="release"){
    Release release{};if(!coordinator.release(release)||!sign(&release,offsetof(Release,proof),release.proof,context))return result(Busy);
    return proofReply("release",&release,sizeof(release));
  }
  if(action=="reconcile"){
    Health health{};if(!hexRead(proofText,reinterpret_cast<uint8_t*>(&health),sizeof(health))||!verify(&health,offsetof(Health,proof),health.proof,context))return result(Invalid);
    return result(coordinator.complete(context.group,health));
  }
  uint32_t command=0;uint64_t ticket=0;
  if(action=="start"){
    // A newly pinned coordinator must not interrupt an existing updater/donor.
    // Duplicates may still reconcile the already durable ticket.
    if(coordinator.state().phase==Empty&&(lampUpdateOwnsResources()||receiver.state().phase!=Empty))return result(Busy);
    FirmwareManifest image{};if(!commandNumber(commandText,command)||!manifest(imageText,image))return result(Invalid);
    const auto outcome=coordinator.create(context.group,image,command,random());if(outcome!=Ok&&outcome!=Duplicate)return result(outcome);
    Arming arming{};if(!coordinator.arming(arming)||!sign(&arming,offsetof(Arming,proof),arming.proof,context))return result(Busy);
    const String state=statusJson();if(!state.length())return replyUnavailable();
    return proofReply("arm",&arming,sizeof(arming),1,&state);
  }
  if(!number(ticketText,ticket))return result(Invalid);
  if(action=="cancel"){
    if(coordinator.state().phase!=Finished&&receiver.state().phase!=Empty)return result(Busy);
    return result(coordinator.cancel(context.group,ticket));
  }
  if(action=="reserve"){
    uint64_t targetBoot=0;if(!commandNumber(commandText,command)||!number(targetBootText,targetBoot)||target.length()!=12)return result(Invalid);
    const auto outcome=coordinator.reserve(context.group,ticket,target.c_str(),targetBoot,command,random());
    if(outcome!=Ok&&outcome!=Duplicate)return result(outcome);
    Permit permit{};if(!coordinator.permit(permit)||!sign(&permit,offsetof(Permit,proof),permit.proof,context))return result(Invalid);
    const String state=statusJson();return state.length()?proofReply("permit",&permit,sizeof(permit),1,&state):replyUnavailable();
  }
  return result(Invalid);
}
bool artifactFence(const FirmwareManifest& artifact,bool start){
  if(!load())return false;
  Context context;
  // An unarmed legacy follower can update individually without changing its
  // saved group. Old/orphaned tickets and unknown protocols never confer this
  // fallback, including explicit manual starts after a membership mismatch.
  if(!context.group.role)return emptyRecords();
  if(context.group.protocol==LampSyncWire::LegacyVersion)return emptyRecords()&&validLegacyContext(context.group);
  if(context.group.protocol!=LampSyncWire::ExpandedVersion)return false;
  const auto& r=receiver.state();
  if(r.phase!=Empty){
    if(!receiver.matchingGroup(context.group))return false;
    if(r.phase==Started)return lampUpdateOwnsResources()&&sameFirmwareManifest(r.artifact,artifact);
    service(millis());if(!windowOpen)return false;
    return start?receiver.started(context.group,artifact)==Ok:receiver.eligible(context.group,artifact);
  }
  // This exact-artifact fallback serves explicit manual updates outside a ticket.
  // New automatic admission separately requires a staged permit for every group.
  return coordinator.state().phase==Empty||coordinator.state().phase==Finished;
}
bool allows(const FirmwareManifest& artifact){return artifactFence(artifact,false);}
bool started(const FirmwareManifest& artifact){return artifactFence(artifact,true);}
}
bool lampRolloutAllowsAutomaticUpdate(const FirmwareManifest& artifact){return LampRollout::allows(artifact);}
uint8_t lampRolloutAutomaticAdmissionReason(){
  if(!LampRollout::load())return 3;
  LampRollout::service(millis());
  return lampRolloutAutomaticAdmissionSnapshotReason();
}
uint8_t lampRolloutAutomaticAdmissionSnapshotReason(){
  using namespace LampRolloutCore;
  if(!LampRollout::loaded)return 3;
  LampRollout::Context context;const auto& r=LampRollout::receiver.state();const auto& c=LampRollout::coordinator.state();
  if(!context.group.role)return r.phase==Empty&&c.phase==Empty?0:4;
  if(context.group.protocol==LampSyncWire::LegacyVersion){
    if(!LampRollout::validLegacyContext(context.group)||!LampRollout::emptyRecords())return 4;
    // Existing protocol-2 playback remains supported after an individual
    // follower reboot. A legacy coordinator still needs explicit coordination
    // because it cannot prove all follower boots healthy or update last.
    // Legacy pause is volatile. Defer automatic reboot instead of resuming a
    // paused member; explicit manual updates retain their existing contract.
    return context.group.role==2?(lampSyncPaused()?4:0):2;
  }
  if(context.group.protocol!=LampSyncWire::ExpandedVersion)return 4;
  if(r.phase==Empty)return 1;
  if(!LampRollout::windowOpen||uint32_t(millis()-LampRollout::acceptedAt)>=PermitLifetime||r.phase!=Accepted||r.targetBoot!=context.group.boot||!LampRollout::receiver.matchingGroup(context.group)||strcmp(r.target,context.group.identity))return 4;
  if(context.group.role==1&&(c.phase!=Reserved||c.ticket!=r.ticket||c.lease!=r.lease||strcmp(c.target,context.group.identity)))return 4;
  return 0;
}
bool lampRolloutAllowsAutomaticAdmission(){return lampRolloutAutomaticAdmissionReason()==0;}
bool lampRolloutAutomaticUpdateStarted(const FirmwareManifest& artifact){return LampRollout::started(artifact);}
bool lampRolloutPinsMembership(){return !LampRollout::loaded||LampRollout::coordinator.state().phase!=LampRolloutCore::Empty||LampRollout::receiver.state().phase!=LampRolloutCore::Empty;}
bool lampRolloutAllowsUnpinnedUpdate(){return !lampRolloutPinsMembership();}
