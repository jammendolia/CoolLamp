#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Loop-owned, route-independent execution receipts. Expired IDs are never
// admitted again in this boot: monotonically increasing IDs fence eviction.
namespace LampCommands {
constexpr size_t Slots=8, SnapshotBytes=512;
constexpr uint32_t LifetimeMs=120000;
enum class Outcome:uint8_t {Rejected,Executed,Persisted,SaveFailed,Uncertain};
struct Receipt {
  uint64_t id=0; uint32_t at=0,revision=0; uint16_t status=0;
  uint8_t digest[32]{}; Outcome outcome=Outcome::Rejected;
};
enum class Admission:uint8_t {New,Duplicate,Conflict,Uncertain,Full,Stale};
class Ledger {
  Receipt entries[Slots]{};
  uint8_t snapshot[SnapshotBytes]{};
  uint64_t session=0,highWater=0;
  uint32_t revision=1;
  bool observed=false;
public:
  void begin(uint64_t boot){for(auto& entry:entries)entry={};memset(snapshot,0,sizeof(snapshot));session=boot?boot:1;highWater=0;revision=1;observed=false;}
  uint64_t boot()const{return session;}
  uint64_t nextId()const{return highWater==UINT64_MAX?0:highWater+1;}
  uint32_t currentRevision()const{return revision;}
  bool observe(const uint8_t* bytes,size_t length){
    if(!bytes||length!=SnapshotBytes)return false;
    if(!observed){memcpy(snapshot,bytes,length);observed=true;return true;}
    if(memcmp(snapshot,bytes,length)==0)return true;
    if(revision==UINT32_MAX)return false; // caller rotates boot/session before reuse
    memcpy(snapshot,bytes,length);++revision;return true;
  }
  const Receipt* query(uint64_t boot,uint64_t id,uint32_t now)const{
    if(boot!=session||!id)return nullptr;
    for(const auto& entry:entries)if(entry.id==id&&uint32_t(now-entry.at)<LifetimeMs)return &entry;
    return nullptr;
  }
  Admission admit(uint64_t boot,uint64_t id,uint32_t expected,const uint8_t* digest,uint32_t now,Receipt*& slot){
    slot=nullptr;if(boot!=session)return Admission::Uncertain;
    if(!id||!digest)return Admission::Conflict;
    for(auto& entry:entries)if(entry.id==id){
      if(uint32_t(now-entry.at)>=LifetimeMs)return Admission::Uncertain;
      if(memcmp(entry.digest,digest,32))return Admission::Conflict;
      slot=&entry;return Admission::Duplicate;
    }
    if(id<=highWater)return Admission::Uncertain;
    if(expected!=revision)return Admission::Stale;
    for(auto& entry:entries)if(!entry.id||uint32_t(now-entry.at)>=LifetimeMs){slot=&entry;break;}
    // Retain the last eight terminal receipts for at most two minutes. A full
    // preview lane must not stall the knob/UI. Evicted IDs remain below the
    // high-water fence and return uncertainty; they cannot execute again.
    if(!slot)for(auto& entry:entries)if(entry.status&&(!slot||entry.id<slot->id))slot=&entry;
    if(!slot)return Admission::Full;
    *slot={};slot->id=id;slot->at=now;memcpy(slot->digest,digest,32);highWater=id;
    return Admission::New;
  }
  void finish(Receipt& slot,uint16_t status,Outcome outcome){slot.status=status;slot.outcome=outcome;slot.revision=revision;}
};
}
