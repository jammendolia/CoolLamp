#include <cassert>
#include <deque>
#include <iostream>
#include <vector>
#include "Preferences.h"
#include "LampEspNow.h"
#include "LampBleUpdate.h"
#include "LampUpdate.h"
#include "LampUpdateAttempt.h"
#include "LampFirmwareRelay.h"
#include "LampFirmwareRelayCrypto.h"
#include "LampRollout.h"
#include "LampSync.h"
#include "UpdatePublisher.h"
#include "bridge/BridgeArtifact.h"
#include "bridge/BridgeDonation.h"
#include "esp_ota_ops.h"
#include "esp_app_format.h"
#include <mbedtls/sha256.h>

using namespace LampFirmwareRelayWire;
const uint8_t bridgeMac[6]={0x34,0xb7,0xda,0x56,0x48,0x8c};
const uint8_t lampMac[6]={0x24,0xec,0x4a,0xaf,0x94,0x58};
const uint8_t fleet[16]={1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16};
const char lampIdentity[]="5894af4aec24",leaderIdentity[]="f0b950b2f180";
const char artifactVersion[]=LAMP_FIRMWARE_VERSION;
bool automatic=true,policyAllowed=true,radioAvailable=true,owned=false,commitHeld=false,verified=false,paused=false;
bool attemptStorage=true,bootMayFail=false;
unsigned begins=0,writes=0,ends=0,boots=0,bootWrites=0,aborts=0,attempts=0,observedOffers=0;
unsigned receiverRequests=0;
bool clockSkewInjected=false,clockSkewProbed=false;
uint32_t skewServiceAt=0,skewReceiveAt=0;
uint8_t route=0;
std::string scenario;
LampSyncGroupContext group{};
esp_partition_t running,nextPartition;
std::vector<uint8_t> image,flash;
struct Packet {std::vector<uint8_t> wire;uint8_t source[6]{},destination[6]{};};
std::deque<Packet> packets;
std::vector<Packet> finishPackets;
BridgeDonation::Sender sender;
BridgeArtifact::Artifact artifact;
bool dataDropped=false,ackDropped=false,finalDropped=false,corrupted=false;
uint64_t seenOfferToken=0;

uint32_t esp_random(){static uint32_t n=17;n=n*1664525+1013904223;return n;}
int esp_read_mac(uint8_t* out,int){memcpy(out,lampMac,6);return 0;}
const esp_partition_t* esp_ota_get_running_partition(){return &running;}
const esp_partition_t* esp_ota_get_next_update_partition(const void*){return &nextPartition;}
int esp_partition_read(const esp_partition_t*,size_t at,void* out,size_t size){if(at>image.size()||size>image.size()-at)return -1;memcpy(out,image.data()+at,size);return 0;}
int esp_ota_get_partition_description(const esp_partition_t*,esp_app_desc_t* out){out->magic_word=ESP_APP_DESC_MAGIC_WORD;return 0;}
int esp_ota_begin(const esp_partition_t*,size_t,esp_ota_handle_t* out){assert(owned);++begins;flash.clear();*out=1;return 0;}
int esp_ota_write(esp_ota_handle_t,const void* bytes,size_t size){assert(owned);++writes;const auto* p=static_cast<const uint8_t*>(bytes);flash.insert(flash.end(),p,p+size);return 0;}
int esp_ota_abort(esp_ota_handle_t){++aborts;return 0;}
int esp_ota_end(esp_ota_handle_t){assert(owned);++ends;return flash.size()==image.size()?0:-1;}
int esp_ota_set_boot_partition(const esp_partition_t*){assert(owned&&flash==image);++bootWrites;if(bootMayFail)return -1;++boots;return 0;}
namespace LampCommission {bool working(){return false;}}
namespace LampUpdateAttempt {
bool automaticAllowed(const FirmwareManifest&){return true;}
bool prepare(const FirmwareManifest&,bool repair){assert(!repair);++attempts;return attemptStorage;}
}
namespace UpdatePublisher {
bool enforced(){return false;}
bool verifyProvisioned(const char*,size_t,Manifest&){return false;}
bool recordEpoch(uint32_t){return false;}
bool retainManifest(const char*,size_t){return false;}
bool format(const Manifest&,char*,size_t,size_t&){return false;}
bool copyRetainedManifest(char*,size_t,size_t&){return false;}
}
bool lampUpdateOwnsResources(){return owned;}
bool reserveLampManualUpdate(){if(owned)return false;owned=true;return true;}
void releaseLampManualUpdate(){if(!commitHeld)owned=false;}
bool beginLampBluetoothUpdateRadio(){return true;}
void finishLampBluetoothUpdateRadio(bool){}
bool beginLampBluetoothUpdate(){return reserveLampManualUpdate();}
void setLampBluetoothUpdateProgress(uint32_t written,uint32_t total){assert(owned&&written<=total);}
void setLampUpdateRoute(uint8_t value){route=value;}
void finishLampBluetoothUpdate(bool good,bool){if(commitHeld)return;owned=false;verified=good;}
void holdLampUpdateCommitUnconfirmed(){assert(owned&&ends==1);commitHeld=true;}
LampUpdateStatus getLampUpdateStatus(){LampUpdateStatus value{};value.automatic=automatic;return value;}
// This adapter supplies opt-in/quiet policy only. The actual group admission
// implementation is compiled below; tests do not reproduce its branch logic.
bool lampAutomaticUpdateAllowed(){return automatic&&policyAllowed&&lampRolloutAllowsAutomaticAdmission();}
bool lampAutomaticUpdateArtifactAllowed(const FirmwareManifest&){return true;}
bool lampAutomaticDonorDiscoveryAllowed(){return true;}
void noteLampAutomaticDonorOffer(const FirmwareManifest&){++observedOffers;}
bool lampSyncGroupContext(LampSyncGroupContext& out){out=group;return group.role;}
uint8_t lampSyncRole(){return group.role;}
bool lampSyncPaused(){return paused;}
bool lampBootHealthy(){return true;}
bool lampRolloutRecoveryPreflight(const FirmwareManifest&){return false;}

bool enqueue(const uint8_t* bytes,size_t size,const uint8_t* source,const uint8_t* destination){assert(size<=250);Packet p;p.wire.assign(bytes,bytes+size);memcpy(p.source,source,6);memcpy(p.destination,destination,6);packets.push_back(p);return true;}
namespace LampEspNow {
bool enqueue(const uint8_t* bytes,size_t size,const uint8_t* destination,bool){return ::enqueue(bytes,size,lampMac,destination);}
Status status(){Status value;value.active=radioAvailable;value.channel=11;return value;}
void holdChannel(uint32_t){}
}
// The cache carries the current production-version artifact. Simulate a lamp
// running an older relay version; actual flash receiver still validates its
// pinned full image, SHA, chip and public marker through production code.
#undef LAMP_FIRMWARE_VERSION
#undef LAMP_VERSION_PATCH
#define LAMP_FIRMWARE_VERSION "1.15.3"
#define LAMP_VERSION_PATCH 3
#include "LampFirmwareRelay.cpp"
#include "LampRollout.cpp"

bool bridgeSend(void*,const uint8_t* bytes,size_t size,const uint8_t* destination){
 // This fixture has one actual lamp receiver. A competing authenticated
 // request must never cause data/acceptance traffic to a second MAC.
 assert(destination[0]==255||!memcmp(destination,lampMac,6));
 return enqueue(bytes,size,bridgeMac,destination);
}
uint64_t nonce(void*){static uint64_t value=0xabcdef0123456789;return ++value;}
bool cacheRead(void*,uint32_t at,uint8_t* out,size_t n){if(at>image.size()||n>image.size()-at)return false;memcpy(out,image.data()+at,n);return true;}

void deliver(){
 while(!packets.empty()){
  Packet p=packets.front();packets.pop_front();
  const bool toLamp=!memcmp(p.source,bridgeMac,6);
  uint8_t plain[BodyLimit]{};size_t n=0;
  const bool opened=LampFirmwareRelayCrypto::open(p.wire.data(),p.wire.size(),p.source,p.destination,fleet,plain,n);
  assert(opened||scenario=="wrong-fleet");
  if(opened&&toLamp&&plain[0]==Offer)seenOfferToken=u64(plain+43);
  if(opened&&!toLamp&&plain[0]==Request)++receiverRequests;
  if(toLamp&&plain[0]==Data&&scenario=="lost-data"&&!dataDropped){dataDropped=true;continue;}
  if(!toLamp&&plain[0]==Ack&&plain[13]==1&&u32(plain+9)>0&&scenario=="lost-ack"&&!ackDropped){ackDropped=true;continue;}
  if(!toLamp&&plain[0]==Ack&&plain[13]==2&&scenario=="lost-final-ack"&&!finalDropped){finalDropped=true;continue;}
  if(toLamp&&plain[0]==Data&&u32(plain+9)==402&&scenario=="corrupt"){
   plain[13]^=0x40;corrupted=true;
   assert(LampFirmwareRelayCrypto::seal(plain,n,p.source,p.destination,fleet,u64(p.wire.data()+4),u32(p.wire.data()+12),p.wire.data()));
  }
  if(toLamp){
   if(plain[0]==Finish)finishPackets.push_back(p);
   LampEspNow::Received received{};received.length=p.wire.size();memcpy(received.data,p.wire.data(),p.wire.size());memcpy(received.source,p.source,6);received.channel=11;received.receivedAt=fakeNow;
   // Sync captures its service timestamp before draining radio packets. A
   // real receive handler samples millis() again after crypto/other work.
   // Advance only that SDK clock; do not copy or alter relay timeout logic.
   const bool everyReceive=scenario=="receive-clock-skew"||scenario=="receive-clock-skew-rollover";
   if(everyReceive||(scenario=="offer-clock-skew"&&plain[0]==Offer&&!clockSkewInjected)){
    if(!clockSkewInjected){skewServiceAt=fakeNow;skewReceiveAt=fakeNow+1;clockSkewInjected=true;}
    ++fakeNow;
   }
   assert(LampFirmwareRelay::receive(received));
  }else assert(sender.receive(p.source,p.wire.data(),p.wire.size(),fakeNow,fakeNow));
 }
}
void seedSettings(){
 // Representative opaque records prove donor/rollout handlers do not rewrite
 // user records. This fixture does not claim a real MCU boot/migration test.
 const std::vector<std::string> keys={"syncV1","syncV2","groupSceneV1","groupSlotV1","settings","ledCount","midpoint","startup","colors","audio","wifi"};
 for(size_t i=0;i<keys.size();++i)Preferences::storage[keys[i]]={uint8_t(i+1),0,1,2,184,46,100};
 Preferences::storage["fleetKeyV1"]={fleet,fleet+16};
}
int main(int argc,char** argv){
 assert(argc==2);scenario=argv[1];seedSettings();const auto before=Preferences::storage;
 group.role=2;group.protocol=2;group.boot=0x123456789abcdef;group.count=1;
 strcpy(group.identity,lampIdentity);strcpy(group.leader,leaderIdentity);strcpy(group.members[0],lampIdentity);memset(group.key,17,16);
 paused=scenario=="paused";const bool pausedBefore=paused;
 if(scenario=="coordinator"){group.role=1;strcpy(group.leader,lampIdentity);}
 if(scenario=="expanded-no-permit")group.protocol=3;
 if(scenario=="auto-off")automatic=false;
 if(scenario=="attempt-storage")attemptStorage=false;
 if(scenario=="boot-error-selected")bootMayFail=true;
 if(scenario=="storage-unavailable")Preferences::storage["rolloutR1"]={99};
 image.resize(65584);image[0]=0xe9;image[1]=1;image[12]=5;image[23]=1;put32(image.data()+28,65504);put32(image.data()+32,0xabcd5432);
 const std::string currentVersion=artifactVersion;
 const std::string publicMarker="COOLLAMP-PUBLIC-"+currentVersion;memcpy(image.data()+300,publicMarker.c_str(),publicMarker.size()+1);
 uint8_t hash[32];assert(mbedtls_sha256(image.data(),image.size(),hash,0)==0);char digest[65]{};for(unsigned i=0;i<32;++i)snprintf(digest+2*i,3,"%02x",hash[i]);
 const std::string manifest="COOLLAMP-OTA-1\n"+currentVersion+"\nesp32c3\ndual-ota-2031616\n65584\n"+digest+"\n";
 assert(artifact.begin({nullptr,cacheRead,uint32_t(image.size())},manifest.data(),manifest.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));
 while(artifact.state()==BridgeArtifact::State::Verifying)artifact.service(173);
 assert(artifact.ready());
 LampFirmwareRelay::begin();
 if(scenario=="active-rollout"){
  LampRolloutCore::Group staged{};staged.role=2;staged.protocol=3;staged.boot=group.boot;staged.count=1;strcpy(staged.identity,lampIdentity);strcpy(staged.leader,leaderIdentity);strcpy(staged.members[0],lampIdentity);memset(staged.fingerprint,42,16);
  LampRolloutCore::Arming arm{};arm.ticket=99;strcpy(arm.coordinator,leaderIdentity);memset(arm.fingerprint,42,16);arm.artifact=artifact.metadata().image;
  assert(LampRollout::receiver.arm(staged,arm)==LampRolloutCore::Ok);
 }
 const auto admissionRecords=Preferences::storage;
 uint8_t donorFleet[16];memcpy(donorFleet,fleet,16);if(scenario=="wrong-fleet")donorFleet[0]^=0x80;
 assert(sender.begin(bridgeMac,donorFleet,0x23456789abcdef,{nullptr,bridgeSend,nonce,nullptr}));assert(sender.setArtifact(&artifact));
 auto freshSender=[&](){assert(sender.begin(bridgeMac,donorFleet,nonce(nullptr),{nullptr,bridgeSend,nonce,nullptr}));assert(sender.setArtifact(&artifact));};
 if(scenario=="startup-gate"){
  fakeNow=34999;sender.service(fakeNow,true);deliver();LampFirmwareRelay::service(fakeNow);deliver();
  assert(LampFirmwareRelay::discoverySnapshot(fakeNow).state==0&&!receiverRequests&&!begins&&!writes);
  assert(observedOffers==0); // An otherwise valid newer offer does not bypass startup.
  fakeNow=35000;freshSender();
 }
 if(scenario=="startup-after-rollover"||scenario=="long-uptime-offer"){
  // Prime through the actual service, as a lamp running since boot would do.
  fakeNow=40000;LampFirmwareRelay::service(fakeNow);
  fakeNow=scenario=="startup-after-rollover"?10:uint32_t(INT32_MAX)+1234;
  assert(LampFirmwareRelay::discoverySnapshot(fakeNow).retryInMs==0);
 }
 if(scenario=="retry-zero-deadline"){
  fakeNow=UINT32_MAX-59999;sender.service(fakeNow,true);deliver();
  assert(LampFirmwareRelay::discoverySnapshot(fakeNow).state==1);
  LampFirmwareRelay::suspend();
  const auto retry=LampFirmwareRelay::discoverySnapshot(fakeNow);
  std::cerr<<"Zero-deadline probe: suspended="<<fakeNow<<"ms retryIn="<<retry.retryInMs<<"ms\n";
  assert(retry.state==0&&retry.retryInMs>=60000&&retry.retryInMs<=60001);
  ++fakeNow;freshSender();sender.service(fakeNow,true);deliver();
  assert(LampFirmwareRelay::discoverySnapshot(fakeNow).state==0&&!receiverRequests&&!begins);
  fakeNow=1;LampFirmwareRelay::service(fakeNow);
  assert(LampFirmwareRelay::discoverySnapshot(fakeNow).retryInMs==0);
 }
 if(scenario=="rollover")fakeNow=UINT32_MAX-20000;
 if(scenario=="receive-clock-skew-rollover")fakeNow=UINT32_MAX-200;
 bool completed=false,interrupted=false,contended=false;
 for(unsigned step=0;step<200000;++step){
  const uint32_t serviceAt=fakeNow;
  LampRollout::service(serviceAt);sender.service(serviceAt,radioAvailable);deliver();
  if(clockSkewInjected&&!clockSkewProbed)assert(LampFirmwareRelay::discoverySnapshot(fakeNow).state==1);
  LampFirmwareRelay::service(serviceAt);
  if(clockSkewInjected&&!clockSkewProbed){
   clockSkewProbed=true;const auto after=LampFirmwareRelay::discoverySnapshot(fakeNow);
   std::cerr<<"Clock-skew probe: captured service="<<skewServiceAt<<"ms receive="<<skewReceiveAt
            <<"ms delta="<<uint32_t(skewReceiveAt-skewServiceAt)<<"ms state="<<unsigned(after.state)
            <<" expected AwaitDonor=1; unsigned stale age="<<uint32_t(serviceAt-skewReceiveAt)<<"ms\n";
   assert(after.state==1&&"A newly accepted donor must survive a stale caller timestamp");
  }
  deliver();
  if(clockSkewProbed)assert(receiverRequests>0&&"The accepted offer must produce a receiver Request");
  if(scenario=="auto-disabled-midway"&&flash.size()>1000)automatic=false;
  if(scenario=="radio-lost"&&flash.size()>1000)radioAvailable=false;
  if(!interrupted&&flash.size()>1000&&(scenario=="receiver-reboot-midway"||scenario=="bridge-reboot-midway")){
   interrupted=true;
   if(scenario=="receiver-reboot-midway"){
    // Exercise actual relay/receiver release and fresh boot-session setup.
    // This does not emulate startup or esp_ota bootloader execution.
    LampFirmwareRelay::suspend();LampFirmwareRelay::begin();
   }else{
    assert(sender.begin(bridgeMac,donorFleet,0x987654321,{nullptr,bridgeSend,nonce,nullptr}));
    // A restarted bridge does not revive the old pinned sender session.
    assert(!artifact.pinned()&&!sender.sending());
   }
  }
  if(!contended&&flash.size()>1000&&scenario=="second-receiver"){
   contended=true;const auto beforeContending=sender.snapshot();
   const uint8_t other[6]={0x24,0xec,0x4a,0xaf,0x94,0x60};
   uint8_t body[49]{Request},sealed[250]{};put64(body+1,0xfedcba);memcpy(body+9,artifact.metadata().image.sha256,32);put64(body+41,seenOfferToken);
   assert(LampFirmwareRelayCrypto::seal(body,sizeof(body),other,bridgeMac,fleet,0x1234,1,sealed));
   assert(sender.receive(other,sealed,Header+sizeof(body)+Tag,fakeNow,fakeNow));
   assert(sender.sending()&&sender.snapshot().written==beforeContending.written&&artifact.pinned());
  }
  if(boots&&sender.snapshot().completed){completed=true;break;}
  if((corrupted||!radioAvailable||!automatic||commitHeld)&&!sender.sending()&&!LampFirmwareRelay::ownsRadio())break;
  if(interrupted&&!sender.sending()&&!LampFirmwareRelay::ownsRadio())break;
  ++fakeNow;
 }
 const bool shouldComplete=scenario=="success"||scenario=="lost-data"||scenario=="lost-ack"||scenario=="lost-final-ack"||scenario=="duplicate-finish"||scenario=="rollover"||scenario=="second-receiver"||scenario=="offer-clock-skew"||scenario=="receive-clock-skew"||scenario=="receive-clock-skew-rollover"||scenario=="startup-gate"||scenario=="startup-after-rollover"||scenario=="long-uptime-offer"||scenario=="retry-zero-deadline";
 if(shouldComplete){
  assert(completed&&boots==1&&bootWrites==1&&begins==1&&ends==1&&verified&&flash==image&&route==UPDATE_ROUTE_DONATION);
  assert(sender.snapshot().completed==1&&!artifact.pinned());
  if(scenario=="offer-clock-skew"||scenario=="receive-clock-skew"||scenario=="receive-clock-skew-rollover")assert(clockSkewInjected&&clockSkewProbed&&receiverRequests>0);
  if(scenario=="lost-data")assert(dataDropped);
  if(scenario=="lost-ack")assert(ackDropped);
  if(scenario=="lost-final-ack")assert(finalDropped);
  if(scenario=="second-receiver")assert(contended);
  if(scenario=="duplicate-finish"){
   assert(!finishPackets.empty());const Packet final=finishPackets.back();
   for(unsigned i=0;i<4;++i){packets.push_back(final);deliver();serviceLampRadioFirmwareReceiver();}
   assert(boots==1&&bootWrites==1&&ends==1&&begins==1);
  }
 }else{
  assert(!boots&&!verified);
  if(scenario=="paused"||scenario=="coordinator"||scenario=="expanded-no-permit"||scenario=="active-rollout"||scenario=="storage-unavailable"||scenario=="auto-off"||scenario=="wrong-fleet")assert(!begins&&!writes&&!ends&&!bootWrites);
  if(scenario=="corrupt")assert(corrupted&&begins==1&&!ends&&!bootWrites);
  if(scenario=="receiver-reboot-midway"||scenario=="bridge-reboot-midway")assert(interrupted&&begins==1&&!ends&&!bootWrites&&!owned&&aborts==1&&!artifact.pinned());
  if(scenario=="attempt-storage"||scenario=="boot-error-selected"){
   assert(ends==1&&attempts==1&&commitHeld&&owned&&bootWrites==unsigned(bootMayFail));
   const auto writesBefore=writes;abortLampRadioFirmwareReceiver();releaseLampManualUpdate();assert(!beginLampRadioFirmwareReceiver(222));
   assert(owned&&commitHeld&&writes==writesBefore&&bootWrites==unsigned(bootMayFail));
  }
 }
 for(const auto& entry:before){assert(Preferences::storage.count(entry.first)&&Preferences::storage[entry.first]==entry.second);}
 for(const char* key:{"rolloutC1","rolloutR1"}){
  const auto existing=admissionRecords.find(key);
  if(existing!=admissionRecords.end())assert(Preferences::storage[key]==existing->second);
 }
 assert(group.role==(scenario=="coordinator"?1:2)&&group.protocol==(scenario=="expanded-no-permit"?3:2)&&paused==pausedBefore);
 std::cout<<"PASS bridge -> actual grouped receiver "<<scenario<<": begins="<<begins<<" bootSelections="<<bootWrites<<" membership/settings retained\n";
}
