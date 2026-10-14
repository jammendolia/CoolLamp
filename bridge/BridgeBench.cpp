#include "BridgeBench.h"
#ifdef COOLLAMP_BRIDGE_BENCH
#include "BridgeBenchFixture.generated.h"
#include <cstdio>
#include <cstring>
namespace BridgeBench {
static_assert(BridgeBenchFixture::LifetimeMs>0&&BridgeBenchFixture::LifetimeMs<=MaximumLifetimeMs,"Bench lifetime must be bounded");
bool Session::arm(BridgeArtifact::Artifact& image,BridgeArtifact::Source source,uint16_t bank,uint32_t now,bool eligible,const BridgeDonation::Snapshot& sender){
 if(!eligible||used_||active()||bank>1||sender.sending||image.pinned())return false;
 used_=true;originalBank_=bank;armedAt_=now;completedAtArm_=sender.completed;failedAtArm_=sender.failed;
 phase_=Phase::Verifying;outcome_=Outcome::None;
 if(!image.begin(source,BridgeBenchFixture::Manifest,sizeof(BridgeBenchFixture::Manifest)-1,BridgeArtifact::Trust::LocalPhysicalBench))stop(Outcome::Failed);
 // An accepted one-shot can fail validation. The caller restores its public
 // bank and reports the failure; it never silently arms a replacement image.
 return true;
}
void Session::stop(Outcome outcome){outcome_=outcome;phase_=Phase::RestoreRequired;}
void Session::service(BridgeArtifact::Artifact& image,const BridgeDonation::Snapshot& sender,uint32_t now){
 if(!running())return;
 if(uint32_t(now-armedAt_)>=BridgeBenchFixture::LifetimeMs){stop(Outcome::Expired);return;}
 if(phase_==Phase::Verifying){image.service(1024);if(image.state()==BridgeArtifact::State::Error)stop(Outcome::Failed);else if(image.ready())phase_=Phase::Ready;return;}
 if(sender.completed!=completedAtArm_){stop(Outcome::Complete);return;}
 if(sender.failed!=failedAtArm_||!image.ready()){stop(Outcome::Failed);return;}
 if(sender.sending)phase_=Phase::Sending;
 else if(phase_==Phase::Sending)stop(Outcome::Failed);
}
void Session::restored(bool success){
 if(phase_!=Phase::Restoring)return;
 phase_=success?(outcome_==Outcome::Complete?Phase::Complete:outcome_==Outcome::Expired?Phase::Expired:Phase::Failed):Phase::Failed;
}
const uint8_t* Session::targetMac()const{return BridgeBenchFixture::TargetMac;}
bool Session::allowsReceiver(const uint8_t* mac)const{return donating()&&mac&&!memcmp(mac,targetMac(),6);}
String Session::statusJson(uint16_t bank,uint32_t partitionAddress,bool eligible,uint32_t now)const{
 const char* phases[]={"idle","verifying","ready","sending","restore-required","restoring","complete","failed","expired"};
 FirmwareManifest pin{};char copy[sizeof(BridgeBenchFixture::Manifest)]{};memcpy(copy,BridgeBenchFixture::Manifest,sizeof(copy));
 if(!parseFirmwareManifest(copy,pin))return String();
 char digest[65]{};for(unsigned i=0;i<32;++i)snprintf(digest+2*i,3,"%02x",pin.sha256[i]);
 const bool validBank=bank<=1&&partitionAddress;
 char original[16]="null",seed[16]="null",offset[24]="null";
 if(validBank){snprintf(original,sizeof(original),"%u",unsigned(bank));snprintf(seed,sizeof(seed),"%u",unsigned(1-bank));snprintf(offset,sizeof(offset),"%lu",static_cast<unsigned long>(partitionAddress+4096+uint32_t(1-bank)*0x1f1000));}
 const uint32_t elapsed=used_?uint32_t(now-armedAt_):0;
 const uint32_t remaining=running()&&elapsed<BridgeBenchFixture::LifetimeMs?BridgeBenchFixture::LifetimeMs-elapsed:0;
 char body[768]{};const int n=snprintf(body,sizeof(body),"{\"version\":1,\"developmentFixture\":true,\"phase\":\"%s\",\"active\":%s,\"oneShotUsed\":%s,\"seedAllowed\":%s,\"cacheHeldForBench\":%s,\"target\":\"%s\",\"originalBank\":%s,\"seedBank\":%s,\"seedFlashOffset\":%s,\"firmwareVersion\":\"1.15.5\",\"bytes\":%lu,\"sha256\":\"%s\",\"lifetimeMs\":%lu,\"remainingMs\":%lu,\"durable\":false,\"trust\":\"local-physical-bench\"}",phases[unsigned(phase_)],active()?"true":"false",used_?"true":"false",eligible&&!used_?"true":"false",!used_||active()?"true":"false",BridgeBenchFixture::TargetIdentity,original,seed,offset,static_cast<unsigned long>(pin.size),digest,static_cast<unsigned long>(BridgeBenchFixture::LifetimeMs),static_cast<unsigned long>(remaining));
 if(n<=0||size_t(n)>=sizeof(body))return String();
 String out;if(!out.reserve(size_t(n))||!out.concat(body,size_t(n)))return String();return out;
}
}
#endif
