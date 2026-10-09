#include "LampMeshCore.h"
#include <stdlib.h>
#include <limits.h>
namespace LampMesh {
using namespace LampMeshWire;
namespace {
bool due(uint32_t now,uint32_t at){return int32_t(now-at)>=0;}
void text(char* out,const char* in,size_t capacity){
 size_t n=in?strlen(in):0;
 if(n>=capacity){n=capacity-1;while(n&&(uint8_t(in[n])&0xc0)==0x80)--n;}
 if(n)memcpy(out,in,n);
 out[n]=0;
}
bool newer(uint32_t a,uint32_t b){return a>b;}// Sequence wrap is prohibited within a boot.
void erase(void* memory,size_t n){volatile uint8_t* p=static_cast<volatile uint8_t*>(memory);while(n--)*p++=0;}
}
Core::~Core(){stop();}
bool Core::begin(const uint8_t* self,const uint8_t* key,uint64_t boot,const Hooks& hooks){
 stop();if(!mac(self)||!key||!boot||boot==lastBoot_||!hooks.send||!hooks.trusted)return false;
 memcpy(self_,self,6);memcpy(key_,key,16);boot_=lastBoot_=boot;hooks_=hooks;enabled_=true;return true;
}
void Core::releaseOrigin(){
 if(origin_.request)erase(origin_.request,origin_.requestSize?origin_.requestSize:1);
 if(origin_.response)erase(origin_.response,origin_.responseSize?origin_.responseSize:1);
 free(origin_.request);free(origin_.response);origin_=Origin{};result_.body=nullptr;result_.length=0;
}
void Core::releaseTarget(){
 if(target_.request)erase(target_.request,target_.requestSize?target_.requestSize:1);
 // The target retains its bounded response allocation rather than reallocating
 // it: realloc may free an unwiped old block containing Wi-Fi or group secrets.
 if(target_.response)erase(target_.response,ResponseLimit);
 free(target_.request);free(target_.response);target_=Target{};
}
void Core::stop(){
 releaseOrigin();releaseTarget();result_=Result{};
 for(auto& peer:peers_)peer=Peer{};
 for(auto& queued:queue_)queued=Queued{};
 memset(usedIds_,0,sizeof(usedIds_));usedIdIndex_=0;
 volatile uint8_t* key=key_;for(unsigned i=0;i<16;++i)key[i]=0;
 enabled_=false;paused_=false;boot_=0;sequence_=nextPresence_=nextSend_=0;queueCount_=queueHead_=turn_=0;hooks_=Hooks{};
}
void Core::setAnnouncement(const char* name,const char* version,bool wifi){text(name_,name,sizeof(name_));text(version_,version,sizeof(version_));wifi_=wifi;}
Peer* Core::find(const uint8_t* address){for(auto& p:peers_)if(same(p.mac,address))return &p;return nullptr;}
const Peer* Core::find(const uint8_t* address)const{for(const auto& p:peers_)if(same(p.mac,address))return &p;return nullptr;}
bool Core::trusted(const uint8_t* address)const{return mac(address)&&(same(address,self_)||hooks_.trusted(hooks_.context,address));}
Peer* Core::admit(const uint8_t* address){
 if(auto p=find(address))return p;
 // Do not evict replay/transaction tombstones for other paired lamps. A full
 // fleet table is a bounded capacity failure, never an invitation to re-admit
 // captured requests from an evicted peer.
 for(auto& p:peers_)if(zeroMac(p.mac)){memcpy(p.mac,address,6);return &p;}
 return nullptr;
}
bool Core::online(const uint8_t* address,uint32_t now)const{const Peer* p=find(address);return p&&p->active&&uint32_t(now-p->lastSeen)<PeerTimeout;}
uint32_t Core::reserve(uint8_t count){
 if(!count||sequence_>UINT32_MAX-count){enabled_=false;fail(Failure::SessionChanged);releaseTarget();queueCount_=0;return 0;}
 const uint32_t first=sequence_+1;sequence_+=count;return first;
}
bool Core::replay(Peer& peer,const Packet& p,uint8_t attempt){
 if(p.boot!=peer.boot&&p.boot!=peer.candidateBoot)return false;
 uint32_t& sequence=p.boot==peer.boot?peer.sequence:peer.candidateSequence;
 uint8_t* attempts=p.boot==peer.boot?peer.attempts:peer.candidateAttempts;
 if(newer(p.sequence,sequence)){
  const uint32_t distance=p.sequence-sequence;
  if(distance>=64)memset(attempts,0,64);
  else for(uint32_t i=1;i<=distance;++i)attempts[(sequence+i)%64]=0;
  sequence=p.sequence;
 }else if(sequence-p.sequence>=64)return false;
 uint8_t& seen=attempts[p.sequence%64];const uint8_t bit=uint8_t(1u<<attempt);if(seen&bit)return false;seen|=bit;return true;
}
bool Core::enqueue(const uint8_t* data,size_t size){
 if(queueCount_==8||!size||size>WireLimit)return false;
 Queued& q=queue_[(queueHead_+queueCount_)%8];memcpy(q.data,data,size);q.size=uint16_t(size);++queueCount_;return true;
}
Packet Core::packet(uint8_t kind,const uint8_t* target,uint64_t targetBoot,uint64_t id,uint32_t seq){
 Packet p;memcpy(p.origin,self_,6);if(target)memcpy(p.target,target,6);p.boot=boot_;p.targetBoot=targetBoot;p.requestId=id;p.sequence=seq?seq:reserve();p.kind=kind;return p;
}
bool Core::emit(Packet& p,const uint8_t* payload,uint8_t attempt){
 uint8_t wire[WireLimit];size_t size=0;return p.sequence&&LampMeshCrypto::seal(p,payload,key_,self_,HopLimit-1,attempt,wire,size)&&enqueue(wire,size);
}
void Core::presence(uint32_t now){
 uint8_t payload[3+48+24]{};const size_t nameSize=strlen(name_),versionSize=strlen(version_);payload[0]=wifi_?1:0;payload[1]=uint8_t(nameSize);payload[2]=uint8_t(versionSize);
 memcpy(payload+3,name_,nameSize);memcpy(payload+3+nameSize,version_,versionSize);Packet p=packet(Presence,nullptr,0,0);p.totalSize=p.payloadSize=uint8_t(3+nameSize+versionSize);
 if(emit(p,payload))nextPresence_=now+PresencePeriod;
}
void Core::challenge(Peer& peer,uint32_t now){
 if(!peer.candidateBoot||peer.challengeAttempt>AttemptLimit)return;
 if(!peer.challengeSequence)peer.challengeSequence=reserve();
 Packet p=packet(Challenge,peer.mac,peer.candidateBoot,peer.challengeSequence,peer.challengeSequence);
 if(emit(p,nullptr,peer.challengeAttempt)){++peer.challengeAttempt;peer.challengeAt=now+RetryPeriod;}
}
void Core::receipt(const Packet& p,uint8_t code,uint16_t status,uint64_t bitmap,uint16_t responseSize){
 uint8_t payload[9];payload[0]=code;put64(payload+1,bitmap);Packet reply=packet(Receipt,p.origin,p.boot,p.requestId);reply.payloadSize=9;reply.status=status;reply.totalSize=responseSize;emit(reply,payload);
}
void Core::fail(Failure reason,uint16_t status){
 const bool executed=result_.executed;releaseOrigin();result_.state=State::Failed;result_.failure=reason;result_.status=status;result_.executed=executed;
}
void Core::clearResult(){if(result_.state==State::Pending||result_.state==State::Executed)return;releaseOrigin();result_=Result{};}
bool Core::startRequest(const uint8_t* target,uint64_t id,const uint8_t* bytes,size_t size,uint32_t now){
 if(!enabled_||paused_||!trusted(target)||same(target,self_)||!id||size>RequestLimit||(size&&!bytes))return false;
 if(result_.state!=State::Idle){
  if(result_.requestId==id&&same(result_.target,target)){
   if(origin_.request&&(origin_.requestSize!=size||memcmp(origin_.request,bytes,size)))return false;
   return true;
  }
  if(result_.state==State::Pending||result_.state==State::Executed)return false;
  clearResult();
 }
 for(uint64_t used:usedIds_)if(used==id)return false;
 result_.requestId=id;memcpy(result_.target,target,6);
 if(!online(target,now)){result_.state=State::Failed;result_.failure=Failure::NoRoute;return true;}
 Peer* peer=find(target);const uint8_t count=fragments(size);origin_.base=reserve(count);if(!origin_.base)return false;
 origin_.request=static_cast<uint8_t*>(malloc(size?size:1));if(!origin_.request){fail(Failure::Capacity,503);return true;}
 if(size)memcpy(origin_.request,bytes,size);
 origin_.requestSize=size;origin_.boot=peer->boot;origin_.started=now;origin_.retryAt=now;
 result_.targetBoot=peer->boot;result_.state=State::Pending;usedIds_[usedIdIndex_++%32]=id;return true;
}
void Core::request(const Packet& p,const uint8_t* payload,uint32_t now){
 Peer* peer=find(p.origin);if(!peer)return;const uint32_t base=p.sequence-p.index;
 const bool sameTransaction=target_.occupied&&same(target_.mac,p.origin)&&target_.boot==p.boot&&target_.id==p.requestId&&target_.base==base;
 if(!sameTransaction){
  if(base<=peer->transaction||p.requestId==peer->requestId){receipt(p,Rejected,409);return;}
  // A later request from the same origin proves it has moved past the old
  // result, even if its final response receipt was lost. Keep the transaction
  // floor but release the old response so sequential controls need no delay.
  if(target_.occupied&&target_.executed&&same(target_.mac,p.origin)&&target_.boot==p.boot)releaseTarget();
  if(target_.occupied){peer->transaction=base;peer->requestId=p.requestId;receipt(p,Busy,409);return;}
  peer->transaction=base;peer->requestId=p.requestId; // Retained even if allocation, execution or ACK fails.
  target_.request=static_cast<uint8_t*>(malloc(p.totalSize?p.totalSize:1));if(!target_.request){receipt(p,Rejected,503);return;}
  target_.occupied=true;target_.boot=p.boot;target_.id=p.requestId;memcpy(target_.mac,p.origin,6);target_.base=base;target_.started=now;target_.requestSize=p.totalSize;target_.count=p.count;
 }
 if(target_.requestSize!=p.totalSize||target_.count!=p.count){if(!target_.executed)releaseTarget();receipt(p,Rejected,409);return;}
 const uint64_t bit=uint64_t(1)<<p.index;const size_t offset=size_t(p.index)*PayloadLimit;
 if(target_.received&bit){
  // Retain the small request until target timeout so duplicate bytes, including
  // duplicates after execution, must match the original transaction exactly.
  if(p.payloadSize&&memcmp(target_.request+offset,payload,p.payloadSize)){if(!target_.executed)releaseTarget();receipt(p,Rejected,409);return;}
 }else{
  if(target_.executed){receipt(p,Rejected,409);return;}
  if(p.payloadSize)memcpy(target_.request+offset,payload,p.payloadSize);
  target_.received|=bit;
 }
 target_.receiptDue=true;
 if(!target_.executed&&target_.received==mask(target_.count)){
  target_.response=static_cast<uint8_t*>(malloc(ResponseLimit));
  if(!target_.response){target_.status=503;target_.responseSize=0;}
  else{
   memset(target_.response,0,ResponseLimit);
   size_t size=0;target_.status=hooks_.execute?hooks_.execute(hooks_.context,p.origin,p.requestId,target_.request,target_.requestSize,target_.response,ResponseLimit,size):503;
   if(size>ResponseLimit||target_.status<100||target_.status>599){target_.status=500;size=0;}
   target_.responseSize=uint16_t(size);
   if(!size){erase(target_.response,ResponseLimit);free(target_.response);target_.response=nullptr;}
  }
  target_.executed=true;target_.responseBase=reserve(fragments(target_.responseSize));target_.retryAt=now;
 }
}
void Core::response(const Packet& p,const uint8_t* payload,uint32_t){
 if((result_.state!=State::Pending&&result_.state!=State::Executed&&result_.state!=State::Complete)||p.requestId!=result_.requestId||!same(p.origin,result_.target)||p.boot!=origin_.boot)return;
 if(!origin_.response){
  origin_.response=static_cast<uint8_t*>(malloc(p.totalSize?p.totalSize:1));if(!origin_.response){fail(Failure::Capacity,503);return;}
  origin_.responseSize=p.totalSize;result_.status=p.status;
 }
 if(origin_.responseSize!=p.totalSize||result_.status!=p.status)return;
 const uint64_t bit=uint64_t(1)<<p.index;const size_t offset=size_t(p.index)*PayloadLimit;
 if(origin_.received&bit){if(p.payloadSize&&memcmp(origin_.response+offset,payload,p.payloadSize))return;}
 else{if(p.payloadSize)memcpy(origin_.response+offset,payload,p.payloadSize);origin_.received|=bit;}
 result_.executed=true;result_.state=State::Executed;origin_.receiptDue=true;
 if(origin_.received==mask(p.count)){result_.state=State::Complete;result_.body=origin_.response;result_.length=origin_.responseSize;}
}
bool Core::receive(const uint8_t* sender,const uint8_t* wire,size_t size,uint32_t now){
 if(!enabled_||paused_||!trusted(sender)||same(sender,self_))return false;
 Packet p;uint8_t payload[PayloadLimit];if(!LampMeshCrypto::open(wire,size,key_,sender,p,payload)||!trusted(p.origin)||same(p.origin,self_)||(!zeroMac(p.target)&&!trusted(p.target)))return false;
 // Validate kind-specific plaintext before admitting a peer or advancing its
 // replay window. Valid tags are insufficient for malformed state transitions.
 if(p.kind==Presence&&(payload[0]>1||payload[1]>48||payload[2]>24||size_t(payload[1])+payload[2]+3!=p.payloadSize))return false;
 if(p.kind==Receipt&&(payload[0]<Receiving||payload[0]>Busy||(payload[0]==Receiving&&(p.status||p.totalSize))||(payload[0]!=Receiving&&!p.status)))return false;
 const bool local=same(p.target,self_);
 if(local&&p.targetBoot!=boot_)return false;
 if(local&&p.kind==Receipt&&p.requestId==result_.requestId&&same(p.origin,result_.target)&&p.boot==origin_.boot&&(u64(payload+1)&~mask(fragments(origin_.requestSize))))return false;
 if(local&&p.kind==ResponseReceipt&&target_.occupied&&same(p.origin,target_.mac)&&p.requestId==target_.id&&(p.totalSize!=target_.responseSize||(u64(payload)&~mask(fragments(target_.responseSize)))))return false;
 Peer* peer=find(p.origin);
 if(!peer){if(p.kind!=Presence&&p.kind!=Challenge)return false;peer=admit(p.origin);if(!peer)return false;}
 if(p.boot==peer->retired[0]||p.boot==peer->retired[1])return false;
 if(p.kind==ChallengeReply&&local&&p.boot==peer->candidateBoot&&p.requestId==peer->challengeSequence){
  if(peer->boot&&peer->boot!=p.boot){peer->retired[1]=peer->retired[0];peer->retired[0]=peer->boot;}
  if(peer->boot!=p.boot){peer->sequence=peer->transaction=0;peer->requestId=0;memset(peer->attempts,0,sizeof(peer->attempts));}
  peer->boot=p.boot;peer->active=true;peer->lastSeen=now;peer->hops=HopLimit-wire[HeaderSize];peer->candidateBoot=0;peer->challengeSequence=0;
  text(peer->name,peer->candidateName,sizeof(peer->name));text(peer->version,peer->candidateVersion,sizeof(peer->version));peer->wifiConnected=peer->candidateWifi;
 }
 if(p.boot!=peer->boot){
  if(p.kind!=Presence&&p.kind!=Challenge)return false;
  if(peer->candidateBoot!=p.boot){peer->candidateBoot=p.boot;peer->candidateSequence=0;memset(peer->candidateAttempts,0,sizeof(peer->candidateAttempts));peer->challengeSequence=0;peer->challengeAttempt=0;peer->challengeAt=now;}
 }
 if(!replay(*peer,p,wire[HeaderSize+1]))return false;
 if(local&&target_.occupied&&uint32_t(now-target_.started)>=TransactionTimeout)releaseTarget();
 if(local&&(result_.state==State::Pending||result_.state==State::Executed)&&uint32_t(now-origin_.started)>=TransactionTimeout)fail(Failure::Deadline);
 if(p.kind==Presence){
  char name[49]{},version[25]{};memcpy(name,payload+3,payload[1]);memcpy(version,payload+3+payload[1],payload[2]);
  if(p.boot==peer->boot&&peer->active){text(peer->name,name,sizeof(peer->name));text(peer->version,version,sizeof(peer->version));peer->wifiConnected=payload[0];peer->lastSeen=now;peer->hops=HopLimit-wire[HeaderSize];}
  else{
   text(peer->candidateName,name,sizeof(peer->candidateName));text(peer->candidateVersion,version,sizeof(peer->candidateVersion));peer->candidateWifi=payload[0];
   if(!peer->candidateBoot||peer->challengeAttempt>AttemptLimit){peer->candidateBoot=p.boot;peer->challengeAttempt=0;peer->challengeSequence=0;peer->challengeAt=now;}
  }
 }
 if(!local&&wire[HeaderSize]){uint8_t forwarded[WireLimit];if(LampMeshCrypto::forward(wire,size,key_,self_,forwarded))enqueue(forwarded,size);}
 if(p.kind==Challenge&&local){Packet reply=packet(ChallengeReply,p.origin,p.boot,p.requestId);emit(reply,nullptr);}
 else if(p.kind==Request&&local&&online(p.origin,now)&&p.boot==peer->boot)request(p,payload,now);
 else if(p.kind==Response&&local&&online(p.origin,now))response(p,payload,now);
 else if(p.kind==Receipt&&local&&(result_.state==State::Pending||result_.state==State::Executed)&&p.requestId==result_.requestId&&same(p.origin,result_.target)&&p.boot==origin_.boot){
  const uint64_t bitmap=u64(payload+1);if(bitmap&~mask(fragments(origin_.requestSize)))return false;
  if(payload[0]==Receiving)origin_.acknowledged|=bitmap;
  else if(payload[0]==Executed){result_.executed=true;result_.state=State::Executed;result_.status=p.status;origin_.acknowledged=mask(fragments(origin_.requestSize));}
  else fail(Failure::Rejected,p.status);
 }
 else if(p.kind==ResponseReceipt&&local&&target_.occupied&&target_.executed&&same(p.origin,target_.mac)&&p.boot==target_.boot&&p.requestId==target_.id&&p.totalSize==target_.responseSize){
  const uint64_t bitmap=u64(payload),complete=mask(fragments(target_.responseSize));
  if(!(bitmap&~complete)){target_.acknowledged|=bitmap;if(target_.acknowledged==complete)releaseTarget();}
 }
 return true;
}
bool Core::sendOrigin(uint32_t now){
 if(origin_.receiptDue&&(result_.state==State::Executed||result_.state==State::Complete)){
  uint8_t payload[8];put64(payload,origin_.received);Packet p=packet(ResponseReceipt,result_.target,origin_.boot,result_.requestId);p.payloadSize=8;p.totalSize=uint16_t(origin_.responseSize);
  if(emit(p,payload)){origin_.receiptDue=false;return true;}return false;
 }
 if(result_.state!=State::Pending||origin_.attempt>AttemptLimit||!due(now,origin_.retryAt))return false;
 const uint8_t count=fragments(origin_.requestSize);
 while(origin_.index<count&&(origin_.acknowledged&(uint64_t(1)<<origin_.index)))++origin_.index;
 if(origin_.index==count){origin_.index=0;++origin_.attempt;origin_.retryAt=now+RetryPeriod;return false;}
 const uint8_t i=origin_.index;Packet p=packet(Request,result_.target,origin_.boot,result_.requestId,origin_.base+i);p.index=i;p.count=count;p.totalSize=uint16_t(origin_.requestSize);p.payloadSize=uint8_t(fragmentSize(origin_.requestSize,i));
 if(emit(p,origin_.request+size_t(i)*PayloadLimit,origin_.attempt)){++origin_.index;return true;}return false;
}
bool Core::sendTarget(uint32_t now){
 if(!target_.occupied)return false;
 if(target_.receiptDue){
  Packet original;memcpy(original.origin,target_.mac,6);original.boot=target_.boot;original.requestId=target_.id;
  const uint8_t before=queueCount_;receipt(original,target_.executed?Executed:Receiving,target_.executed?target_.status:0,target_.received,target_.executed?target_.responseSize:0);
  if(queueCount_!=before){target_.receiptDue=false;return true;}return false;
 }
 if(!target_.executed||!target_.responseBase||target_.attempt>AttemptLimit||!due(now,target_.retryAt))return false;
 const uint8_t count=fragments(target_.responseSize);
 while(target_.index<count&&(target_.acknowledged&(uint64_t(1)<<target_.index)))++target_.index;
 if(target_.index==count){target_.index=0;++target_.attempt;target_.retryAt=now+RetryPeriod;return false;}
 const uint8_t i=target_.index;Packet p=packet(Response,target_.mac,target_.boot,target_.id,target_.responseBase+i);p.index=i;p.count=count;p.totalSize=target_.responseSize;p.status=target_.status;p.payloadSize=uint8_t(fragmentSize(target_.responseSize,i));
 if(emit(p,target_.response?target_.response+size_t(i)*PayloadLimit:nullptr,target_.attempt)){++target_.index;return true;}return false;
}
void Core::service(uint32_t now,bool allowSend){
 if(!enabled_)return;
 if(!allowSend){
  if(!paused_){if(result_.state==State::Pending||result_.state==State::Executed||result_.state==State::Complete)fail(Failure::Unavailable,503);else releaseOrigin();releaseTarget();queueCount_=0;queueHead_=0;}paused_=true;return;
 }
 if(paused_){paused_=false;nextPresence_=now;}
 for(auto& peer:peers_){
  if(peer.active&&uint32_t(now-peer.lastSeen)>=PeerTimeout)peer.active=false;
  if(peer.candidateBoot&&due(now,peer.challengeAt)&&peer.challengeAttempt<=AttemptLimit&&queueCount_<4)challenge(peer,now);
 }
 if((result_.state==State::Pending||result_.state==State::Executed)&&uint32_t(now-origin_.started)>=TransactionTimeout)fail(Failure::Deadline);
 if(target_.occupied&&uint32_t(now-target_.started)>=TransactionTimeout)releaseTarget();
 if((result_.state==State::Pending||result_.state==State::Executed)){const Peer* target=find(result_.target);if(target&&target->active&&target->boot!=origin_.boot)fail(Failure::SessionChanged);}
 if(due(now,nextPresence_)&&queueCount_<4)presence(now);
 if(queueCount_<4){if(turn_++&1){if(!sendOrigin(now))sendTarget(now);}else if(!sendTarget(now))sendOrigin(now);}
 if(queueCount_&&due(now,nextSend_)){
  Queued& q=queue_[queueHead_];if(hooks_.send(hooks_.context,q.data,q.size)){queueHead_=(queueHead_+1)%8;--queueCount_;nextSend_=now+12;}
 }
}
}
