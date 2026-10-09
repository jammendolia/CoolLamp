#pragma once
#include "LampMeshCrypto.h"
namespace LampMesh {
constexpr unsigned MaxPeers=16;
constexpr uint32_t PresencePeriod=4000,PeerTimeout=15000,TransactionTimeout=15000,RetryPeriod=350;
struct Hooks {
 void* context=nullptr;
 bool (*trusted)(void*,const uint8_t*)=nullptr;
 bool (*send)(void*,const uint8_t*,size_t)=nullptr;
 uint16_t (*execute)(void*,const uint8_t*,uint64_t,const uint8_t*,size_t,uint8_t*,size_t,size_t&)=nullptr;
};
struct Peer {
 uint8_t mac[6]{};uint64_t boot=0,candidateBoot=0,retired[2]{};
 uint32_t lastSeen=0,sequence=0,transaction=0;uint64_t requestId=0;
 uint8_t attempts[64]{},hops=0;bool active=false;
 uint32_t candidateSequence=0;uint8_t candidateAttempts[64]{};
 char name[49]{},version[25]{};bool wifiConnected=false;
 // Tentative announcements only become authoritative after a live challenge.
 uint32_t challengeSequence=0,challengeAt=0;uint8_t challengeAttempt=0;
 char candidateName[49]{},candidateVersion[25]{};bool candidateWifi=false;
};
enum class State:uint8_t {Idle,Pending,Executed,Complete,Failed};
enum class Failure:uint8_t {None,NoRoute,Deadline,Rejected,Unavailable,SessionChanged,Capacity};
struct Result {
 State state=State::Idle;Failure failure=Failure::None;
 uint8_t target[6]{};uint64_t requestId=0,targetBoot=0;
 uint16_t status=0;const uint8_t* body=nullptr;size_t length=0;
 // False means no execution receipt was observed; it does not prove that a
 // mutation was never executed. Lost receipts make deadline failures uncertain.
 bool executed=false;
};
class Core {
 public:
 Core()=default;~Core();Core(const Core&)=delete;Core& operator=(const Core&)=delete;
 bool begin(const uint8_t* self,const uint8_t* fleetKey,uint64_t boot,const Hooks& hooks);
 void stop();
 void setAnnouncement(const char* name,const char* version,bool wifiConnected);
 bool receive(const uint8_t* physicalSender,const uint8_t* wire,size_t size,uint32_t now);
 void service(uint32_t now,bool allowSend=true);
 bool startRequest(const uint8_t* target,uint64_t requestId,const uint8_t* request,size_t size,uint32_t now);
 const Result& result()const{return result_;}
 void clearResult();
 const Peer* peers()const{return peers_;}
 bool online(const uint8_t* mac,uint32_t now)const;
 bool active()const{return enabled_;}
 bool working()const{return queueCount_||target_.occupied||result_.state==State::Pending||result_.state==State::Executed;}
 private:
 struct Queued {uint8_t data[LampMeshWire::WireLimit]{};uint16_t size=0;};
 struct Origin {
 uint8_t* request=nullptr;uint8_t* response=nullptr;size_t requestSize=0,responseSize=0;
 uint64_t boot=0,received=0,acknowledged=0;
 uint32_t base=0,started=0,retryAt=0;uint8_t index=0,attempt=0;bool receiptDue=false;
 } origin_;
 struct Target {
 uint8_t mac[6]{};uint64_t boot=0,id=0,received=0,acknowledged=0;
 uint32_t base=0,responseBase=0,started=0,retryAt=0;
 uint16_t requestSize=0,responseSize=0,status=0;
 uint8_t count=0,index=0,attempt=0;uint8_t* request=nullptr;uint8_t* response=nullptr;
 bool occupied=false,executed=false,receiptDue=false;
 } target_;
 uint8_t self_[6]{},key_[16]{};uint64_t boot_=0,lastBoot_=0;uint32_t sequence_=0,nextPresence_=0,nextSend_=0;
 Hooks hooks_{};bool enabled_=false,paused_=false;
 Peer peers_[MaxPeers]{};Queued queue_[8]{};uint8_t queueHead_=0,queueCount_=0,turn_=0;
 char name_[49]{},version_[25]{};bool wifi_=false;Result result_{};
 uint64_t usedIds_[32]{};uint8_t usedIdIndex_=0;
 Peer* find(const uint8_t* mac);const Peer* find(const uint8_t* mac)const;
 Peer* admit(const uint8_t* mac);bool trusted(const uint8_t* mac)const;
 uint32_t reserve(uint8_t count=1);bool replay(Peer&,const LampMeshWire::Packet&,uint8_t attempt);
 bool enqueue(const uint8_t* data,size_t size);
 bool emit(LampMeshWire::Packet&,const uint8_t* payload,uint8_t attempt=0);
 LampMeshWire::Packet packet(uint8_t kind,const uint8_t* target,uint64_t targetBoot,uint64_t requestId,uint32_t sequence=0);
 void presence(uint32_t now);void challenge(Peer&,uint32_t now);void receipt(const LampMeshWire::Packet&,uint8_t code,uint16_t status=0,uint64_t bitmap=0,uint16_t responseSize=0);
 void request(const LampMeshWire::Packet&,const uint8_t*,uint32_t now);
 void response(const LampMeshWire::Packet&,const uint8_t*,uint32_t now);
 void releaseOrigin();void releaseTarget();void fail(Failure reason,uint16_t status=0);
 bool sendOrigin(uint32_t now);bool sendTarget(uint32_t now);
};
}
