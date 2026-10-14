#pragma once
// Local USB bench fixture only. Default builds compile no activation, pins,
// alternate cache ownership, or receiver restriction from this module.
#ifdef COOLLAMP_BRIDGE_BENCH
#include <Arduino.h>
#include "BridgeArtifact.h"
#include "BridgeDonation.h"
namespace BridgeBench {
constexpr uint32_t MaximumLifetimeMs=1200000;
enum class Phase:uint8_t {Idle,Verifying,Ready,Sending,RestoreRequired,Restoring,Complete,Failed,Expired};
enum class Outcome:uint8_t {None,Complete,Failed,Expired};
class Session {
 public:
 // Eligible must prove the original public cache and all loop resource guards.
 // Source is the opposite cache bank; neither this class nor Artifact writes it.
 bool arm(BridgeArtifact::Artifact&,BridgeArtifact::Source,uint16_t originalBank,
          uint32_t now,bool eligible,const BridgeDonation::Snapshot&);
 void service(BridgeArtifact::Artifact&,const BridgeDonation::Snapshot&,uint32_t now);
 bool running()const{return phase_==Phase::Verifying||phase_==Phase::Ready||phase_==Phase::Sending;}
 bool active()const{return running()||phase_==Phase::RestoreRequired||phase_==Phase::Restoring;}
 bool donating()const{return phase_==Phase::Ready||phase_==Phase::Sending;}
 bool used()const{return used_;}
 bool needsRestore()const{return phase_==Phase::RestoreRequired;}
 void beginRestore(){if(needsRestore())phase_=Phase::Restoring;}
 void restored(bool successful);
 bool allowsReceiver(const uint8_t* actualMac)const;
 const uint8_t* targetMac()const;
 // Bounds and public artifact identifiers only; no credentials or request data.
 String statusJson(uint16_t currentOriginalBank,uint32_t cachePartitionAddress,
                   bool seedAllowed,uint32_t now)const;
 private:
 void stop(Outcome);
 Phase phase_=Phase::Idle;
 Outcome outcome_=Outcome::None;
 bool used_=false;
 uint16_t originalBank_=0;
 uint32_t armedAt_=0,completedAtArm_=0,failedAtArm_=0;
};
}
#endif
