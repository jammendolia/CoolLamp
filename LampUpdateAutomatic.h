#pragma once
#include <stdint.h>

// Loop-owned, RAM-only scheduling. No packet, credential, artifact or durable
// receipt is stored here. Durable update/rollout fences remain authoritative.
namespace LampUpdateAutomatic {
constexpr uint32_t RetryMs=60000,RetryJitterMs=15000,DonorObservationMs=30000;
constexpr uint32_t DiscoveryMs=6UL*60*60*1000;
enum State:uint8_t {Disabled,Waiting,Internet,DonorSearch,DonorTransfer,Attention,Committing};
enum Reason:uint8_t {Ready,ActiveUse,ClockUnknown,QuietWindow,InvalidPolicy,
 GroupStage,GroupLegacy,GroupStorage,GroupPermit,BootHealth,ControlBusy,Memory,
 InternetUnavailable,InternetFailed,DonorUnavailable,FleetUnpaired,RadioUnavailable,
 LegacyAttempt,ArtifactQuarantine,AttemptStorage,Partition,ManifestRejected,
 UpdaterBusy,StartedLease,CommitUnconfirmed};
struct Snapshot {
 uint32_t retryInMs=0,donorWaitMs=0;
 uint16_t internetAttempts=0,donorOffers=0;
 uint8_t state=Disabled,reason=Ready;
 bool attention=false,phoneFallback=false,newerSeen=false;
};
class Service {
 bool enabled_=false,retryArmed_=false,donors_=false,attention_=false,newer_=false;
 uint32_t retryAt_=0,donorAt_=0;
 uint16_t attempts_=0,offers_=0;
 uint8_t fallback_=Ready;
public:
 void enable(){if(!enabled_){enabled_=true;retryArmed_=false;donors_=false;attention_=false;fallback_=Ready;}}
 void disable(){enabled_=retryArmed_=donors_=attention_=newer_=false;retryAt_=donorAt_=0;attempts_=offers_=0;fallback_=Ready;}
 bool due(uint32_t now)const{return enabled_&&(!retryArmed_||int32_t(now-retryAt_)>=0);}
 bool donorsAllowed()const{return enabled_&&donors_;}
 void discovered(bool newer){newer_=newer;}
 void observedOffer(bool wake){newer_=true;if(offers_!=UINT16_MAX)++offers_;if(wake)retryArmed_=false;}
 void internetStarted(){donors_=false;attention_=false;if(attempts_!=UINT16_MAX)++attempts_;}
 void checked(uint32_t now,bool newer){newer_=newer;donors_=attention_=false;retryArmed_=!newer;retryAt_=now+DiscoveryMs;fallback_=Ready;}
 void fallback(uint32_t now,uint8_t reason,uint32_t jitter){
  if(!donors_){donorAt_=now;donors_=true;}
  fallback_=reason;retryAt_=now+RetryMs+(jitter%(RetryJitterMs+1));retryArmed_=true;
 }
 Snapshot snapshot(uint32_t now)const{
  Snapshot out;out.internetAttempts=attempts_;out.donorOffers=offers_;out.newerSeen=newer_;
  if(!enabled_)return out;
  out.state=Waiting;out.reason=fallback_;
  if(retryArmed_&&int32_t(now-retryAt_)<0)out.retryInMs=retryAt_-now;
  if(donors_){
   const uint32_t elapsed=now-donorAt_;
   out.donorWaitMs=elapsed<DonorObservationMs?DonorObservationMs-elapsed:0;
   out.attention=attention_||(!out.donorWaitMs&&(newer_||attempts_));
   out.state=out.attention?Attention:DonorSearch;out.phoneFallback=out.attention;
  }
  return out;
 }
};
}
