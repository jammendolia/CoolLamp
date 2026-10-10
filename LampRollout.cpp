#include "LampRollout.h"
#include "LampSync.h"
#include "LampUpdate.h"
#include "LampFirmwareRelay.h"
#include "UpdatePublisher.h"
#include <Preferences.h>
#include <esp_system.h>
#include <mbedtls/md.h>

namespace LampRollout {
namespace {
using namespace LampRolloutCore;
void zero(void* value,size_t size){volatile uint8_t* p=static_cast<volatile uint8_t*>(value);while(size--)*p++=0;}
bool save(const Record& record,void* name){Preferences prefs;if(!prefs.begin("coollamp",false))return false;const bool ok=prefs.putBytes(static_cast<const char*>(name),&record,sizeof(record))==sizeof(record);prefs.end();return ok;}
char coordinatorKey[]="rolloutC1",receiverKey[]="rolloutR1";
State coordinator(save,coordinatorKey),receiver(save,receiverKey);
bool loaded=false;
uint32_t acceptedAt=0;
bool windowOpen=false;
bool load(){
  if(loaded)return true;
  Preferences prefs;if(!prefs.begin("coollamp",true))return false;
  bool ok=true;const char* keys[]={coordinatorKey,receiverKey};
  for(const auto* key:keys){const auto length=prefs.getBytesLength(key);if(!length)continue;
    Record record{};if(length!=sizeof(record)||prefs.getBytes(key,&record,sizeof(record))!=sizeof(record)){ok=false;break;}
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
uint64_t random(){uint64_t value=uint64_t(esp_random())<<32|esp_random();return value?value:1;}
bool hexRead(const String& text,uint8_t* out,size_t size){if(text.length()!=size*2)return false;for(size_t i=0;i<size;++i){unsigned byte=0;for(unsigned j=0;j<2;++j){char c=text[i*2+j];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;byte=byte*16+(c<='9'?c-'0':c-'a'+10);}out[i]=byte;}return true;}
String hex(const void* bytes,size_t size){const auto* p=static_cast<const uint8_t*>(bytes);const char* digits="0123456789abcdef";String out;if(!out.reserve(size*2))return String();for(size_t i=0;i<size;++i){out+=digits[p[i]>>4];out+=digits[p[i]&15];}return out;}
String number(uint64_t value){char buffer[17];snprintf(buffer,sizeof(buffer),"%016llx",static_cast<unsigned long long>(value));return String(buffer);}
bool number(const String& text,uint64_t& value){if(text.length()!=16)return false;value=0;for(size_t i=0;i<text.length();++i){const char c=text[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;value=(value<<4)|(c<='9'?c-'0':c-'a'+10);}return value!=0;}
bool commandNumber(const String& text,uint32_t& value){if(!text.length()||text.length()>10)return false;uint64_t parsed=0;for(size_t i=0;i<text.length();++i){const char c=text[i];if(c<'0'||c>'9')return false;parsed=parsed*10+c-'0';if(parsed>UINT32_MAX)return false;}value=parsed;return value!=0;}
bool sign(void* body,size_t size,uint8_t* proof,const Context& context){return context.group.role&&mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),context.key,16,static_cast<const uint8_t*>(body),size,proof)==0;}
bool verify(void* body,size_t size,const uint8_t* proof,const Context& context){uint8_t expected[32]{};if(!sign(body,size,expected,context))return false;uint8_t diff=0;for(unsigned i=0;i<32;++i)diff|=expected[i]^proof[i];zero(expected,sizeof(expected));return !diff;}
LampControlReply result(Result outcome){
  const uint16_t status=outcome==Ok||outcome==Duplicate?200:outcome==StorageFailure?500:outcome==Invalid?400:409;
  return {status,String("{\"version\":1,\"result\":")+String(unsigned(outcome))+",\"persisted\":"+(outcome==Ok||outcome==Duplicate?"true":"false")+",\"state\":"+statusJson()+"}"};
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
  const bool ready=load();const auto& c=coordinator.state();const auto& r=receiver.state();
  return String("{\"version\":1,\"storageReady\":")+(ready?"true":"false")+",\"distributedAutomaticService\":false,\"requiresPhoneOrCoordinatorOrchestration\":true,\"coordinatorLast\":true,\"ticket\":\""+number(c.ticket)+"\",\"lease\":\""+number(c.lease)+"\",\"phase\":"+String(c.phase)+",\"members\":"+String(c.count)+",\"armedMask\":"+String(c.armed)+",\"completedMask\":"+String(c.completed)+",\"releasedMask\":"+String(c.released)+",\"target\":\""+c.target+"\",\"receiverTicket\":\""+number(r.ticket)+"\",\"receiverLease\":\""+number(r.lease)+"\",\"receiverPhase\":"+String(r.phase)+",\"permitLifetimeMs\":"+String(PermitLifetime)+",\"uncertainLease\":"+(c.phase==Reserved?"true":"false")+"}";
}
void service(uint32_t now){if(windowOpen&&uint32_t(now-acceptedAt)>=PermitLifetime)windowOpen=false;}
LampControlReply request(const String& action,const String& imageText,const String& commandText,const String& ticketText,const String& target,const String& targetBootText,const String& proofText){
  if(!load())return result(StorageFailure);
  Context context;
  if(action=="status")return {200,statusJson()};
  if(context.group.protocol!=3||!context.group.role)return result(Invalid);
  if(action=="renew-proof"){
    if(!lampRolloutRecoveryPreflight(receiver.state().artifact))return result(Busy);
    const auto outcome=receiver.prepareRenew(context.group);if(outcome!=Ok&&outcome!=Duplicate)return result(outcome);
    windowOpen=false;Permit proof{};if(!receiver.recovery(proof)||!sign(&proof,offsetof(Permit,proof),proof.proof,context))return result(Invalid);
    return {200,String("{\"version\":1,\"recovery\":\"")+hex(&proof,sizeof(proof))+"\",\"persisted\":true,\"controlReadbackRequired\":true}"};
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
    return {200,String("{\"version\":1,\"armAck\":\"")+hex(&ack,sizeof(ack))+"\",\"persisted\":true}"};
  }
  if(action=="health"){
    const auto& r=receiver.state();FirmwareManifest running{};
    if((r.phase!=Started&&r.phase!=Accepted)||!receiver.matchingGroup(context.group)||!lampBootHealthy()||
      !LampFirmwareRelay::runningManifest(running)||!sameFirmwareManifest(running,r.artifact))return result(Busy);
    Health health{};health.ticket=r.ticket;health.lease=r.lease;health.boot=context.group.boot;
    memcpy(health.coordinator,r.coordinator,13);memcpy(health.target,context.group.identity,13);memcpy(health.fingerprint,r.fingerprint,16);copyManifest(health.artifact,r.artifact);
    if(!sign(&health,offsetof(Health,proof),health.proof,context))return result(Invalid);
    return {200,String("{\"version\":1,\"health\":\"")+hex(&health,sizeof(health))+"\",\"controlReadbackRequired\":true}"};
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
    return {200,String("{\"version\":1,\"releaseAck\":\"")+hex(&ack,sizeof(ack))+"\",\"persisted\":true}"};
  }
  if(context.group.role!=1)return result(Invalid);
  if(action=="renew"){
    Permit proof{};uint32_t command=0;if(!commandNumber(commandText,command)||!hexRead(proofText,reinterpret_cast<uint8_t*>(&proof),sizeof(proof))||!verify(&proof,offsetof(Permit,proof),proof.proof,context))return result(Invalid);
    const auto outcome=coordinator.renew(context.group,proof,command);if(outcome!=Ok&&outcome!=Duplicate)return result(outcome);
    RenewPermit permit{};if(!coordinator.renewedPermit(permit)||!sign(&permit,offsetof(RenewPermit,proof),permit.proof,context))return result(Invalid);
    return {200,String("{\"version\":1,\"renewPermit\":\"")+hex(&permit,sizeof(permit))+"\",\"persisted\":true}"};
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
    return {200,String("{\"version\":1,\"release\":\"")+hex(&release,sizeof(release))+"\",\"persisted\":true}"};
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
    return {200,String("{\"version\":1,\"arm\":\"")+hex(&arming,sizeof(arming))+"\",\"persisted\":true,\"state\":"+statusJson()+"}"};
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
    return {200,String("{\"version\":1,\"permit\":\"")+hex(&permit,sizeof(permit))+"\",\"persisted\":true,\"state\":"+statusJson()+"}"};
  }
  return result(Invalid);
}
bool allows(const FirmwareManifest& artifact){
  if(!load())return false;
  Context context;if(!context.group.role||context.group.protocol!=3)return true;
  const auto& r=receiver.state();
  if(r.phase!=Empty){
    if(!receiver.matchingGroup(context.group))return false;
    if(r.phase==Started)return lampUpdateOwnsResources()&&sameFirmwareManifest(r.artifact,artifact);
    service(millis());return windowOpen&&receiver.eligible(context.group,artifact);
  }
  // This exact-artifact fallback serves explicit manual updates outside a ticket.
  // New automatic admission separately requires a staged permit for every group.
  return coordinator.state().phase==Empty||coordinator.state().phase==Finished;
}
bool started(const FirmwareManifest& artifact){
  if(!load())return false;
  Context context;if(!context.group.role||context.group.protocol!=3)return true;
  const auto& r=receiver.state();if(r.phase==Empty)return coordinator.state().phase==Empty||coordinator.state().phase==Finished;
  if(r.phase==Started)return lampUpdateOwnsResources()&&sameFirmwareManifest(r.artifact,artifact);
  service(millis());if(!windowOpen)return false;
  return receiver.started(context.group,artifact)==Ok;
}
}
bool lampRolloutAllowsAutomaticUpdate(const FirmwareManifest& artifact){return LampRollout::allows(artifact);}
uint8_t lampRolloutAutomaticAdmissionReason(){
  using namespace LampRolloutCore;
  if(!LampRollout::load())return 3;
  LampRollout::Context context;const auto& r=LampRollout::receiver.state();const auto& c=LampRollout::coordinator.state();
  if(!context.group.role)return r.phase==Empty&&c.phase==Empty?0:4;
  if(context.group.protocol!=LampSyncWire::ExpandedVersion)return 2;
  if(r.phase==Empty)return 1;
  LampRollout::service(millis());
  if(!LampRollout::windowOpen||r.phase!=Accepted||r.targetBoot!=context.group.boot||!LampRollout::receiver.matchingGroup(context.group)||strcmp(r.target,context.group.identity))return 4;
  if(context.group.role==1&&(c.phase!=Reserved||c.ticket!=r.ticket||c.lease!=r.lease||strcmp(c.target,context.group.identity)))return 4;
  return 0;
}
bool lampRolloutAllowsAutomaticAdmission(){return lampRolloutAutomaticAdmissionReason()==0;}
bool lampRolloutAutomaticUpdateStarted(const FirmwareManifest& artifact){return LampRollout::started(artifact);}
bool lampRolloutPinsMembership(){return !LampRollout::load()||LampRollout::coordinator.state().phase!=LampRolloutCore::Empty||LampRollout::receiver.state().phase!=LampRolloutCore::Empty;}
bool lampRolloutAllowsUnpinnedUpdate(){return !lampRolloutPinsMembership();}
