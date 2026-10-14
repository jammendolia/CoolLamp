#include "BridgeDonation.h"
#include <string.h>

namespace BridgeDonation {
namespace {
using namespace LampFirmwareRelayWire;
const uint8_t broadcast[6]={255,255,255,255,255,255};
bool unicast(const uint8_t* p){if(!p||(p[0]&1))return false;uint8_t any=0;for(unsigned i=0;i<6;++i)any|=p[i];return any!=0;}
void erase(void* p,size_t n){volatile uint8_t* b=static_cast<volatile uint8_t*>(p);while(n--)*b++=0;}
void put16(uint8_t* p,uint16_t n){p[0]=uint8_t(n);p[1]=uint8_t(n>>8);}
}
Sender::~Sender(){cancel();erase(fleet_,sizeof(fleet_));}
bool Sender::begin(const uint8_t self[6],const uint8_t fleet[16],uint64_t boot,Hooks hooks){
 cancel();paired_=false;erase(fleet_,sizeof(fleet_));artifact_=nullptr;hooks_={};
 uint8_t any=0;if(fleet)for(unsigned i=0;i<16;++i)any|=fleet[i];
 if(!unicast(self)||!any||!boot||!hooks.send||!hooks.random)return false;
 memcpy(self_,self,6);memcpy(fleet_,fleet,16);boot_=boot;hooks_=hooks;sequence_=0;paired_=true;radioAvailable_=false;offerToken_=0;offeredOnce_=false;lastOffer_=0;completed_=failed_=0;lastResult_=Result::None;return true;
}
bool Sender::setArtifact(BridgeArtifact::Artifact* artifact){
 if(sending_)return false;
 artifact_=artifact;offerToken_=0;offeredOnce_=false;return true;
}
bool Sender::send(const uint8_t* body,size_t n,const uint8_t* destination){
 if(!paired_||!radioAvailable_||sequence_==UINT32_MAX)return false;
 uint8_t wire[250];
 if(!LampFirmwareRelayCrypto::seal(body,n,self_,destination,fleet_,boot_,++sequence_,wire))return false;
 return hooks_.send(hooks_.context,wire,Header+n+Tag,destination);
}
void Sender::stop(Result result){
 if(sending_){if(artifact_)artifact_->release();if(result==Result::Complete)++completed_;else ++failed_;lastResult_=result;}
 sending_=false;receiverReady_=false;chunkSent_=false;finishSent_=false;sentOnce_=false;session_=0;offerToken_=0;offset_=pendingEnd_=0;erase(peer_,sizeof(peer_));peerBoot_=0;peerSequence_=0;
}
void Sender::cancel(){stop(Result::Cancelled);offerToken_=0;}
Snapshot Sender::snapshot()const{
 Snapshot result;result.paired=paired_;result.sending=sending_;result.receiverReady=receiverReady_;result.written=offset_;result.total=artifact_&&artifact_->ready()?artifact_->metadata().image.size:0;result.completed=completed_;result.failed=failed_;result.lastResult=lastResult_;return result;
}
bool Sender::receive(const uint8_t source[6],const uint8_t* wire,size_t length,uint32_t receivedAt,uint32_t now){
 if(!wire||length<4||memcmp(wire,"CLF\1",4))return false;
 if(!paired_||!radioAvailable_||!unicast(source)||!memcmp(source,self_,6)||uint32_t(now-receivedAt)>1500)return true;
 uint8_t body[BodyLimit];size_t count=0;
 if(!LampFirmwareRelayCrypto::open(wire,length,source,self_,fleet_,body,count))return true;
 const uint64_t peerBoot=u64(wire+4);const uint32_t peerSequence=u32(wire+12);
 if(body[0]==Request){
  if(sending_||!artifact_||!artifact_->ready()||!offerToken_||u64(body+41)!=offerToken_||memcmp(body+9,artifact_->metadata().image.sha256,32)||(hooks_.allowReceiver&&!hooks_.allowReceiver(hooks_.context,source))||!artifact_->acquire())return true;
  sending_=true;receiverReady_=chunkSent_=finishSent_=sentOnce_=false;memcpy(peer_,source,6);peerBoot_=peerBoot;peerSequence_=peerSequence;session_=u64(body+1);offerToken_=0;offset_=pendingEnd_=0;started_=touched_=now;return true;
 }
 if(!sending_||memcmp(source,peer_,6)||peerBoot!=peerBoot_||u64(body+1)!=session_||peerSequence<=peerSequence_)return true;
 peerSequence_=peerSequence;
 if(body[0]==Reject){stop(Result::Rejected);return true;}
 if(body[0]!=Ack)return true;
 const uint32_t written=u32(body+9);
 if(body[13]==2&&finishSent_&&offset_==artifact_->metadata().image.size&&written==offset_){stop(Result::Complete);return true;}
 if(body[13]!=1)return true;
 if(!receiverReady_){if(written)return true;receiverReady_=true;sentOnce_=false;touched_=now;return true;}
 if(chunkSent_&&written==pendingEnd_&&offset_<written){offset_=written;chunkSent_=false;sentOnce_=false;touched_=now;}
 return true;
}
void Sender::service(uint32_t now,bool available){
 radioAvailable_=available;
 if(sending_){
  if(!available){stop(Result::RadioLost);return;}
  if(uint32_t(now-started_)>900000||uint32_t(now-touched_)>20000){stop(Result::Timeout);return;}
  if(hooks_.holdChannel)hooks_.holdChannel(hooks_.context,now+5000);
  if(sentOnce_&&uint32_t(now-lastSent_)<750)return;
  uint8_t body[13+DataLimit]{};size_t n=0;
  if(!receiverReady_){body[0]=Ack;put64(body+1,session_);put32(body+9,0);body[13]=0;n=14;}
  else if(offset_==artifact_->metadata().image.size){body[0]=Finish;put64(body+1,session_);n=9;}
  else{
   body[0]=Data;put64(body+1,session_);put32(body+9,offset_);n=artifact_->metadata().image.size-offset_;if(n>DataLimit)n=DataLimit;
   if(!artifact_->read(offset_,body+13,n)){stop(Result::ReadError);return;}n+=13;
  }
  if(send(body,n,peer_)){
   if(body[0]==Data){pendingEnd_=offset_+uint32_t(n-13);chunkSent_=true;}
   if(body[0]==Finish)finishSent_=true;
  }
  // Failed enqueue is also paced; offsets advance only after a sent chunk ACK.
  sentOnce_=true;lastSent_=now;return;
 }
 if(!paired_||!available||!artifact_||!artifact_->ready())return;
 if(offeredOnce_&&uint32_t(now-lastOffer_)<10000)return;
 const auto& metadata=artifact_->metadata();const uint64_t token=hooks_.random(hooks_.context);
 if(!token)return;
 const uint8_t* destination=hooks_.offerTarget?hooks_.offerTarget(hooks_.context):broadcast;
 if(!destination||(!unicast(destination)&&memcmp(destination,broadcast,6)))return;
 uint8_t body[123]{};body[0]=metadata.trust==BridgeArtifact::Trust::PublisherSignature?SignedOffer:Offer;
 for(unsigned i=0;i<3;++i)put16(body+1+2*i,metadata.image.version[i]);
 put32(body+7,metadata.image.size);memcpy(body+11,metadata.image.sha256,32);put64(body+43,token);
 if(body[0]==SignedOffer){put32(body+51,metadata.epoch);put32(body+55,metadata.keyId);memcpy(body+59,metadata.signature,64);}
 if(send(body,body[0]==SignedOffer?sizeof(body):51,destination)){offerToken_=token;offeredOnce_=true;lastOffer_=now;}
}
}
