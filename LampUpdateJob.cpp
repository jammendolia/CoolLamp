#include "LampUpdateJob.h"
#include "LampJsonSink.h"
#include "LampTrustStorage.h"
#include "LampConfig.h"

namespace LampUpdateJob {
namespace {
constexpr char Key[]="otaJobV2",LegacyKey[]="otaJobV1";
Snapshot current{};portMUX_TYPE mux=portMUX_INITIALIZER_UNLOCKED;

struct LegacySnapshot {
  FirmwareManifest target{};
  uint32_t revision=0;
  char jobId[JobIdCapacity+1]{};
  uint8_t state=None,error=0;
  bool storageReady=false;
};
static_assert(sizeof(LegacySnapshot)==84,"Legacy update job layout changed");
static_assert(offsetof(LegacySnapshot,target)==offsetof(Snapshot,target)&&offsetof(LegacySnapshot,revision)==offsetof(Snapshot,revision)&&offsetof(LegacySnapshot,jobId)==offsetof(Snapshot,jobId)&&offsetof(LegacySnapshot,state)==offsetof(Snapshot,state)&&offsetof(LegacySnapshot,error)==offsetof(Snapshot,error)&&offsetof(LegacySnapshot,storageReady)==offsetof(Snapshot,storageReady)&&offsetof(Snapshot,confirmedBytes)==sizeof(LegacySnapshot),"Legacy update prefix changed");

bool validHex(const char* text,uint8_t length,bool zeroAllowed){
 if(!text)return false;
 uint8_t nonzero=0;
 while(length--){const uint8_t c=*text++;if(uint8_t(c-'0')>9&&uint8_t(c-'a')>5)return false;nonzero|=c^'0';}
 return !*text&&(zeroAllowed||nonzero);
}
__attribute__((noinline)) bool validTarget(const FirmwareManifest& target){
  if(!target.version[0]&&!target.version[1]&&!target.version[2])return false;
  uint8_t digest=0;for(uint8_t byte:target.sha256)digest|=byte;return digest;
}
bool active(uint8_t state){return (state>=Accepted&&state<=Committing)||state==Uncertain;}
__attribute__((noinline)) bool valid(const Snapshot& value){
  if(!value.storageReady||value.state==None||value.state>Uncertain||
     !validHex(value.jobId,JobIdCapacity,true)||(value.route!=Internet&&(value.route!=Bridge||!validHex(value.ownerId,ParticipantIdCapacity,false)))||
     (value.route==Internet&&value.ownerId[0])||
     !value.revision||!validTarget(value.target)||((value.state==Failed)!=bool(value.error)))return false;
  if(value.confirmedBytes>value.target.size||(value.target.size&&(value.target.size<288||value.target.size>2031616)))return false;
  if(value.state<=Checking)return !value.confirmedBytes;
  if(value.state==Failed&&!value.target.size)return true;
  if(!value.target.size)return false;
  if(value.state==Committing||value.state==Confirmed)return value.confirmedBytes==value.target.size;
  return true;
}
void unreadable(){portENTER_CRITICAL(&mux);current={};current.state=Uncertain;portEXIT_CRITICAL(&mux);}
bool save(const Snapshot& next){
  if(!valid(next))return false;
  const auto written=LampTrustStorage::write(Key,&next,sizeof(next));if(written!=LampTrustStorage::Complete){if(written==LampTrustStorage::Uncertain)unreadable();return false;}
  portENTER_CRITICAL(&mux);current=next;portEXIT_CRITICAL(&mux);return true;
}
}
bool advance(uint8_t state,uint8_t error,const FirmwareManifest* artifact,uint32_t confirmed){
  Snapshot next=capture();
  if(state==Downloading&&!artifact){
    if(!next.storageReady||next.state!=Downloading||!next.target.size||confirmed>next.target.size||confirmed<next.confirmedBytes)return false;
    if(confirmed==next.confirmedBytes||(confirmed<next.target.size&&confirmed-next.confirmedBytes<ProgressGranularity))return true;
    if(next.revision==UINT32_MAX)return false;
    next.confirmedBytes=confirmed;++next.revision;return save(next);
  }
  if(state==UINT8_MAX){
    if(!artifact)return false;
    if(!next.storageReady||next.state==None||next.state==Confirmed||next.state==Failed)return next.storageReady;
    if(matches(next,*artifact)){next.target=*artifact;next.confirmedBytes=artifact->size;next.state=Confirmed;next.error=0;}
    else if(next.state==Committing){next.state=Uncertain;next.error=0;}else return true;
    if(next.revision==UINT32_MAX)return false;
    ++next.revision;return save(next);
  }
  if(!next.storageReady||next.state<Accepted||next.state>Committing||next.revision==UINT32_MAX)return false;
  if(state==next.state&&state==Checking&&!error&&!artifact)return true;
  if(state==next.state&&state==Downloading&&artifact&&next.confirmedBytes==0&&matches(next,*artifact))return true;
  if(!((state==next.state+1&&state<=Committing)||(state==Failed&&next.state<Committing)||(state==Uncertain&&next.state==Committing)))return false;
  if((state==Failed)!=bool(error))return false;
  if(artifact){if(!matches(next,*artifact)||artifact->size<288||artifact->size>2031616)return false;next.target=*artifact;}
  if(state==Downloading)next.confirmedBytes=0;
  if(state==Committing)next.confirmedBytes=next.target.size;
  next.state=state;next.error=error;++next.revision;return save(next);
}

void begin(){
 Snapshot next{};const auto read=LampTrustStorage::read(Key,&next,sizeof(next));
 if(read==LampTrustStorage::Found){if(!valid(next)){unreadable();return;}}
 else if(read==LampTrustStorage::Error){unreadable();return;}
 else{
  const auto old=LampTrustStorage::read(LegacyKey,&next,sizeof(LegacySnapshot));
  if(old==LampTrustStorage::Error){unreadable();return;}
  if(old==LampTrustStorage::Absent)next.storageReady=true;
  else{
   next.route=Internet;
   if(next.target.size&&(next.state==Committing||next.state==Confirmed||next.state==Uncertain))next.confirmedBytes=next.target.size;
   if(next.state<=Checking&&next.target.size){unreadable();return;}
   if(!save(next)){unreadable();return;}
   return;
  }
 }
 portENTER_CRITICAL(&mux);current=next;portEXIT_CRITICAL(&mux);
 if(next.storageReady&&next.state==Downloading&&next.confirmedBytes){
  if(next.revision==UINT32_MAX){unreadable();return;}
  next.state=Failed;next.error=Interrupted;++next.revision;if(!save(next))unreadable();
 }
}
SubmitResult submitBound(const Submission& submission){
 const char* jobId=submission.jobId,*targetId=submission.targetId,*ownerId=submission.ownerId;uint8_t route=submission.route;const uint32_t size=submission.size;
 FirmwareManifest target{};const char* local=lampIdentityText();
 if(!validHex(jobId,JobIdCapacity,true)||!parseFirmwareVersion(submission.version,target.version)||!parseFirmwareSha256(submission.sha256,target.sha256)||!validTarget(target))return Invalid;
 if(targetId){
   if(strcmp(targetId,local)||!validHex(ownerId,ParticipantIdCapacity,false)||(route!=Internet&&route!=Bridge)||
     (route==Internet?strcmp(targetId,ownerId):!strcmp(targetId,ownerId))||size<288||size>2031616)return Invalid;
  target.size=size;
 }else{ownerId=local;route=Internet;}
 Snapshot next=capture();if(!next.storageReady)return StorageUnavailable;
 if(next.state!=None&&!strcmp(next.jobId,jobId)){
  const bool exactSize=target.size;
  if(!target.size)target.size=next.target.size;
  return matches(next,target)&&(!exactSize||next.target.size==target.size)&&next.route==route&&
    (route==Internet||!strcmp(next.ownerId,ownerId))?Duplicate:Conflict;
 }
 if(active(next.state))return Conflict;
 const uint32_t revision=next.revision;next={};next.target=target;memcpy(next.jobId,jobId,sizeof(next.jobId));if(route==Bridge)memcpy(next.ownerId,ownerId,sizeof(next.ownerId));next.route=route;
 next.revision=revision==UINT32_MAX?1:revision+1;next.state=Accepted;next.storageReady=true;
 return save(next)?Submitted:StorageUnavailable;
}
SubmitResult submit(const char* jobId,const char* version,const char* sha256){return submitBound({jobId,nullptr,nullptr,version,sha256,0,NoRoute});}
SubmitResult submitExact(const char* jobId,const char* targetId,const char* ownerId,uint8_t route,const char* version,const char* sha256,uint32_t size){return submitBound({jobId,targetId,ownerId,version,sha256,size,route});}
bool matches(const Snapshot& job,const FirmwareManifest& artifact){return !memcmp(job.target.version,artifact.version,sizeof(artifact.version))&&!memcmp(job.target.sha256,artifact.sha256,sizeof(artifact.sha256))&&(!job.target.size||job.target.size==artifact.size);}
Snapshot capture(){portENTER_CRITICAL(&mux);const Snapshot value=current;portEXIT_CRITICAL(&mux);return value;}
void appendJson(LampJsonSink& out,const Snapshot& value,bool contractV2){
  if(value.storageReady?(value.state!=None&&!valid(value)):value.state!=Uncertain){out.fail();return;}
  char digest[65]={},body[400];const char* local=value.storageReady&&value.state!=None?lampIdentityText():"";
  if(value.storageReady&&value.state!=None)formatFirmwareHex(value.target.sha256,32,digest);
  int used=snprintf(body,sizeof(body),"{\"version\":%u,\"storageReady\":%s,\"jobId\":\"%s\",\"target\":\"%u.%u.%u\",\"sha256\":\"%s\",\"size\":%lu,\"state\":%u,\"error\":%u,\"revision\":%lu",
    contractV2?2:1,value.storageReady?"true":"false",value.jobId,unsigned(value.target.version[0]),unsigned(value.target.version[1]),unsigned(value.target.version[2]),digest,static_cast<unsigned long>(!contractV2&&value.state<=Checking?0:value.target.size),unsigned(value.state),unsigned(value.error),static_cast<unsigned long>(value.revision));
  if(used>=0&&size_t(used)<sizeof(body))used+=contractV2?
    snprintf(body+used,sizeof(body)-used,",\"targetId\":\"%s\",\"ownerId\":\"%s\",\"route\":%u,\"confirmedBytes\":%lu,\"totalBytes\":%lu,\"terminal\":%s}",local,value.route==Bridge?value.ownerId:local,unsigned(value.route),static_cast<unsigned long>(value.confirmedBytes),static_cast<unsigned long>(value.target.size),value.state>=Confirmed?"true":"false"):
    snprintf(body+used,sizeof(body)-used,",\"terminal\":%s}",value.state>=Confirmed?"true":"false");
  if(used<0||size_t(used)>=sizeof(body)){out.fail();return;}out.concat(body,size_t(used));
}
}
