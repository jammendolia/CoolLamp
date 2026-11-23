#include "LampUpdateJob.h"
#include "LampJsonSink.h"
#include "LampTrustStorage.h"

namespace LampUpdateJob {
namespace {
constexpr char Key[]="otaJobV1";
Snapshot current{};portMUX_TYPE mux=portMUX_INITIALIZER_UNLOCKED;

bool validId(const char* text){
  if(!text)return false;
  for(size_t i=0;i<JobIdCapacity;++i){const uint8_t c=text[i];if(uint8_t(c-'0')>9&&uint8_t(c-'a')>5)return false;}return !text[JobIdCapacity];
}
__attribute__((noinline)) bool validTarget(const FirmwareManifest& target){
  if(!target.version[0]&&!target.version[1]&&!target.version[2])return false;
  uint8_t digest=0;for(uint8_t byte:target.sha256)digest|=byte;return digest;
}
bool active(uint8_t state){return (state>=Accepted&&state<=Committing)||state==Uncertain;}
__attribute__((noinline)) bool valid(const Snapshot& value){
  if(!value.storageReady||value.state==None||value.state>Uncertain||
     !validId(value.jobId)||!value.revision||!validTarget(value.target)||((value.state==Failed)!=bool(value.error)))return false;
  if(value.state<=Checking)return !value.target.size;
  if(value.state==Failed&&!value.target.size)return true;
  return value.target.size>=288&&value.target.size<=2031616;
}
void unreadable(){portENTER_CRITICAL(&mux);current={};current.state=Uncertain;portEXIT_CRITICAL(&mux);}
bool save(const Snapshot& next){
  if(!valid(next))return false;
  const auto written=LampTrustStorage::write(Key,&next,sizeof(next));if(written!=LampTrustStorage::Complete){if(written==LampTrustStorage::Uncertain)unreadable();return false;}
  portENTER_CRITICAL(&mux);current=next;portEXIT_CRITICAL(&mux);return true;
}
}
bool advance(uint8_t state,uint8_t error,const FirmwareManifest* artifact){
  Snapshot next=capture();if(!next.storageReady||next.state<Accepted||next.state>Committing||
    (next.state==Committing&&state!=Uncertain)||next.revision==UINT32_MAX)return false;
  if((state==Failed)!=bool(error))return false;
  if(artifact){if(!matches(next,*artifact)||artifact->size<288||artifact->size>2031616)return false;next.target=*artifact;}
  next.state=state;next.error=error;++next.revision;return save(next);
}

void begin(){Snapshot next{};const auto read=LampTrustStorage::read(Key,&next,sizeof(next));if(read==LampTrustStorage::Error||(read==LampTrustStorage::Found&&!valid(next))){next={};next.state=Uncertain;}else if(read==LampTrustStorage::Absent)next.storageReady=true;portENTER_CRITICAL(&mux);current=next;portEXIT_CRITICAL(&mux);}
SubmitResult submit(const char* jobId,const char* version,const char* sha256){
  Snapshot next{};if(!validId(jobId)||!parseFirmwareVersion(version,next.target.version)||!parseFirmwareSha256(sha256,next.target.sha256))return Invalid;
  if(!validTarget(next.target))return Invalid;
  const Snapshot prior=capture();if(!prior.storageReady)return StorageUnavailable;
  if(prior.state!=None&&!strcmp(prior.jobId,jobId)){next.target.size=prior.target.size;return matches(prior,next.target)?Duplicate:Conflict;}
  if(active(prior.state))return Conflict;
  memcpy(next.jobId,jobId,sizeof(next.jobId));next.revision=prior.revision==UINT32_MAX?1:prior.revision+1;next.state=Accepted;next.storageReady=true;return save(next)?Submitted:StorageUnavailable;
}
bool matches(const Snapshot& job,const FirmwareManifest& artifact){return !memcmp(job.target.version,artifact.version,sizeof(artifact.version))&&!memcmp(job.target.sha256,artifact.sha256,sizeof(artifact.sha256))&&(!job.target.size||job.target.size==artifact.size);}
bool reconcileRunning(const FirmwareManifest& running){
  Snapshot next=capture();if(!next.storageReady||next.state==None||next.state==Confirmed||next.state==Failed)return next.storageReady;
  if(matches(next,running)){next.target=running;next.state=Confirmed;next.error=0;}else if(next.state==Committing){next.state=Uncertain;next.error=0;}else return true;
  if(next.revision==UINT32_MAX)return false;
  ++next.revision;return save(next);
}
Snapshot capture(){portENTER_CRITICAL(&mux);const Snapshot value=current;portEXIT_CRITICAL(&mux);return value;}
void appendJson(LampJsonSink& out,const Snapshot& value){
  if(value.storageReady?(value.state!=None&&!valid(value)):value.state!=Uncertain){out.fail();return;}
  char digest[65]={},body[272];
  if(value.storageReady&&value.state!=None)formatFirmwareHex(value.target.sha256,32,digest);
  const int used=snprintf(body,sizeof(body),"{\"version\":1,\"storageReady\":%s,\"jobId\":\"%s\",\"target\":\"%u.%u.%u\",\"sha256\":\"%s\",\"size\":%lu,\"state\":%u,\"error\":%u,\"revision\":%lu,\"terminal\":%s}",
    value.storageReady?"true":"false",value.jobId,unsigned(value.target.version[0]),unsigned(value.target.version[1]),unsigned(value.target.version[2]),digest,static_cast<unsigned long>(value.target.size),unsigned(value.state),unsigned(value.error),static_cast<unsigned long>(value.revision),value.state>=Confirmed?"true":"false");
  if(used<0||size_t(used)>=sizeof(body)){out.fail();return;}out.concat(body,size_t(used));
}
}
