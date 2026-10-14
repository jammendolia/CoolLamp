#pragma once
#include "BridgeArtifact.h"
#include "LampFirmwareRelayCrypto.h"

namespace BridgeDonation {
struct Hooks {
 void* context=nullptr;
 bool (*send)(void*,const uint8_t*,size_t,const uint8_t destination[6])=nullptr;
 uint64_t (*random)(void*)=nullptr;
 void (*holdChannel)(void*,uint32_t until)=nullptr;
 // Only new transfer admission; callback executes on the sender owning loop.
 bool (*allowReceiver)(void*,const uint8_t* actualReceiverMac)=nullptr;
 // Optional offer destination, selected before AEAD sealing. No callback
 // preserves broadcast offers; a null callback result suppresses an offer.
 const uint8_t* (*offerTarget)(void*)=nullptr;
};
enum class Result:uint8_t {None,Complete,Rejected,Timeout,RadioLost,ReadError,Cancelled};
struct Snapshot {bool paired=false,sending=false,receiverReady=false;uint32_t written=0,total=0,completed=0,failed=0;Result lastResult=Result::None;};
class Sender {
 public:
 ~Sender();
 Sender()=default;
 Sender(const Sender&)=delete;
 Sender& operator=(const Sender&)=delete;
 bool begin(const uint8_t self[6],const uint8_t fleet[16],uint64_t boot,Hooks);
 bool setArtifact(BridgeArtifact::Artifact*);
 void service(uint32_t now,bool radioAvailable);
 // source must be the radio's actual source MAC, never one supplied by a body.
 bool receive(const uint8_t source[6],const uint8_t* wire,size_t length,uint32_t receivedAt,uint32_t now);
 void cancel();
 bool sending()const{return sending_;}
 Snapshot snapshot()const;
 private:
 bool send(const uint8_t*,size_t,const uint8_t*);
 void stop(Result);
 Hooks hooks_{};
 BridgeArtifact::Artifact* artifact_=nullptr;
 uint8_t self_[6]{},fleet_[16]{},peer_[6]{};
 uint64_t boot_=0,session_=0,offerToken_=0,peerBoot_=0;
 uint32_t sequence_=0,peerSequence_=0,offset_=0,pendingEnd_=0,started_=0,touched_=0,lastSent_=0,lastOffer_=0;
 bool paired_=false,radioAvailable_=false,sending_=false,receiverReady_=false,chunkSent_=false,finishSent_=false,sentOnce_=false,offeredOnce_=false;
 uint32_t completed_=0,failed_=0;
 Result lastResult_=Result::None;
};
}
