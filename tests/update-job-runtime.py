"""Durable one-shot Internet update job: idempotence, reboot and commit fences."""

from pathlib import Path
import subprocess
import tempfile

from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]

NVS = r'''#pragma once
#include <cstddef>
#include <cstdint>
using nvs_handle_t=unsigned;using esp_err_t=int;
constexpr int ESP_OK=0,ESP_ERR_NVS_NOT_FOUND=1,ESP_FAIL=2,NVS_READONLY=0,NVS_READWRITE=1;
int nvs_open(const char*,int,nvs_handle_t*);
int nvs_get_blob(nvs_handle_t,const char*,void*,size_t*);
int nvs_set_blob(nvs_handle_t,const char*,const void*,size_t);
int nvs_commit(nvs_handle_t);void nvs_close(nvs_handle_t);
'''

FIXTURE = r'''
#include <cassert>
#include <cstring>
#include <cstdlib>
#include <iostream>
#include <new>
#include <vector>
#include "LampUpdateJob.h"
#include "LampJsonSink.h"
#include "nvs.h"

bool allocationForbidden=false;
const char* lampIdentityText(){return "aabbccddeeff";}
void* operator new(size_t size){assert(!allocationForbidden);if(void* p=std::malloc(size))return p;throw std::bad_alloc();}
void* operator new[](size_t size){return ::operator new(size);}
void operator delete(void* p)noexcept{std::free(p);}void operator delete[](void* p)noexcept{std::free(p);}
void operator delete(void* p,size_t)noexcept{std::free(p);}void operator delete[](void* p,size_t)noexcept{std::free(p);}

std::vector<uint8_t> durable,durableV1,staged;std::string stagedKey;unsigned writes=0,reads=0;
bool failOpen=false,failRead=false,failWrite=false,failCommit=false,commitThenFail=false;
int nvs_open(const char* name,int,nvs_handle_t* handle){assert(!strcmp(name,"lamptrust"));if(failOpen)return ESP_FAIL;*handle=1;return ESP_OK;}
int nvs_get_blob(nvs_handle_t,const char* key,void* out,size_t* size){++reads;if(failRead)return ESP_FAIL;const auto& value=!strcmp(key,"otaJobV2")?durable:!strcmp(key,"otaJobV1")?durableV1:(assert(false),durable);if(value.empty())return ESP_ERR_NVS_NOT_FOUND;if(*size<value.size())return ESP_FAIL;*size=value.size();memcpy(out,value.data(),*size);return ESP_OK;}
int nvs_set_blob(nvs_handle_t,const char* key,const void* bytes,size_t size){assert(!strcmp(key,"otaJobV2"));if(failWrite)return ESP_FAIL;stagedKey=key;const auto* p=static_cast<const uint8_t*>(bytes);staged.assign(p,p+size);return ESP_OK;}
int nvs_commit(nvs_handle_t){if(failCommit)return ESP_FAIL;assert(stagedKey=="otaJobV2");durable=staged;++writes;return commitThenFail?ESP_FAIL:ESP_OK;}
void nvs_close(nvs_handle_t){staged.clear();stagedKey.clear();}

void digest(unsigned seed,uint8_t out[32]){for(unsigned i=0;i<32;++i)out[i]=uint8_t(seed+i);}
FirmwareManifest artifact(unsigned minor,unsigned seed){FirmwareManifest value{};value.version[0]=1;value.version[1]=minor;value.size=512;digest(seed,value.sha256);return value;}
struct LegacyRecord{FirmwareManifest target{};uint32_t revision=0;char jobId[33]{};uint8_t state=0,error=0;bool storageReady=false;};
static_assert(sizeof(LegacyRecord)==84);

void assertSnapshot(const char* id,unsigned state,unsigned revision,unsigned size,bool ready=true){
 using namespace LampUpdateJob;const auto value=capture();if(!(value.storageReady==ready&&value.state==state&&value.revision==revision&&value.target.size==size))std::cerr<<"snapshot expected "<<state<<"/"<<revision<<"/"<<size<<"/"<<ready<<" got "<<unsigned(value.state)<<"/"<<value.revision<<"/"<<value.target.size<<"/"<<value.storageReady<<"\n";assert(value.storageReady==ready&&value.state==state&&value.revision==revision&&value.target.size==size);
 if(id)assert(!strcmp(value.jobId,id));
 const auto beforeReads=reads,beforeWrites=writes;allocationForbidden=true;LampJsonSink count;appendJson(count,value);allocationForbidden=false;
 assert(count.okay()&&count.size()&&reads==beforeReads&&writes==beforeWrites);
 String output;assert(output.reserve(count.size()));LampJsonSink sink(&output,count.size());allocationForbidden=true;appendJson(sink,value);allocationForbidden=false;
 assert(sink.okay()&&output.length()==count.size()&&output.find("\"state\":"+String(state))!=String::npos&&reads==beforeReads&&writes==beforeWrites);
}
String jobJson(){const auto snapshot=LampUpdateJob::capture();return lampJsonReply([&](LampJsonSink& out){LampUpdateJob::appendJson(out,snapshot);});}
String legacyJobJson(){const auto snapshot=LampUpdateJob::capture();return lampJsonReply([&](LampJsonSink& out){LampUpdateJob::appendJson(out,snapshot,false);});}

int main(){using namespace LampUpdateJob;uint8_t aHash[32],bHash[32];digest(3,aHash);digest(9,bHash);
 const char *id1="11111111111111111111111111111111",*id2="22222222222222222222222222222222",*healthy="33333333333333333333333333333333",*next="44444444444444444444444444444444",*finalId="55555555555555555555555555555555",*other="66666666666666666666666666666666",*badReady="77777777777777777777777777777777",*postCommit="88888888888888888888888888888888";
 begin();assertSnapshot(nullptr,None,0,0);
 assert(jobJson()=="{\"version\":2,\"storageReady\":true,\"jobId\":\"\",\"target\":\"0.0.0\",\"sha256\":\"\",\"size\":0,\"state\":0,\"error\":0,\"revision\":0,\"targetId\":\"\",\"ownerId\":\"\",\"route\":0,\"confirmedBytes\":0,\"totalBytes\":0,\"terminal\":false}");
 assert(legacyJobJson()=="{\"version\":1,\"storageReady\":true,\"jobId\":\"\",\"target\":\"0.0.0\",\"sha256\":\"\",\"size\":0,\"state\":0,\"error\":0,\"revision\":0,\"terminal\":false}");
 char aText[65],bText[65];const char hex[]="0123456789abcdef";for(unsigned i=0;i<32;++i){aText[i*2]=hex[aHash[i]>>4];aText[i*2+1]=hex[aHash[i]&15];bText[i*2]=hex[bHash[i]>>4];bText[i*2+1]=hex[bHash[i]&15];}aText[64]=bText[64]=0;
 assert(submit("short","1.16.0",aText)==Invalid);assert(submit("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","1.16.0",aText)==Invalid);aText[3]='A';assert(submit(id1,"1.16.0",aText)==Invalid);aText[3]=hex[aHash[1]&15];
 failOpen=true;assert(submit(id1,"1.16.0",aText)==StorageUnavailable);failOpen=false;assertSnapshot(nullptr,None,0,0);
 assert(submit(id1,"1.16.0",aText)==Submitted);assertSnapshot(id1,Accepted,1,0);assert(writes==1);
 assert(!capture().ownerId[0]&&capture().route==Internet&&jobJson().find("\"targetId\":\"aabbccddeeff\",\"ownerId\":\"aabbccddeeff\"")!=String::npos);
 assert(submit(id1,"1.16.0",aText)==Duplicate&&writes==1);assert(submit(id1,"1.17.0",bText)==Conflict);assert(submit(id2,"1.17.0",bText)==Conflict);
 begin();assertSnapshot(id1,Accepted,1,0);
 assert(markChecking());assertSnapshot(id1,Checking,2,0);const auto a=artifact(16,3);assert(markDownloading(a));assertSnapshot(id1,Downloading,3,512);assert(submit(id1,"1.16.0",aText)==Duplicate);assert(submit(id1,"1.17.0",bText)==Conflict);auto resized=a;resized.size=513;assert(!matches(capture(),resized));begin();
 assert(!markChecking());assertSnapshot(id1,Downloading,3,512);assert(jobJson().find("\"size\":512,\"state\":3")!=String::npos);
 failWrite=true;assert(!markCommitting());failWrite=false;assertSnapshot(nullptr,Uncertain,0,0,false);
 begin();assertSnapshot(id1,Downloading,3,512);commitThenFail=true;assert(!markCommitting());commitThenFail=false;assertSnapshot(nullptr,Uncertain,0,0,false);
 begin();assertSnapshot(id1,Committing,4,512);
 const auto old=artifact(15,1);assert(reconcileRunning(old));assertSnapshot(id1,Uncertain,5,512);
 assert(submit(id2,"1.17.0",bText)==Conflict); // Uncertain commit never gets overwritten.

 durable.clear();writes=0;begin();assert(submit(healthy,"1.16.0",aText)==Submitted);assert(markChecking());assert(markDownloading(a));assert(markCommitting());begin();
 assert(reconcileRunning(a));assertSnapshot(healthy,Confirmed,5,512);assert(submit(healthy,"1.16.0",aText)==Duplicate);assert(submit(healthy,"1.17.0",bText)==Conflict);assert(submit(next,"1.17.0",bText)==Submitted);assertSnapshot(next,Accepted,6,0);
 assert(markChecking());const auto b=artifact(17,9);assert(markDownloading(b));assert(!markFailed(0));assertSnapshot(next,Downloading,8,512);
 assert(markFailed(6));assertSnapshot(next,Failed,9,512);
 assert(submit(finalId,"1.16.0",aText)==Submitted);assertSnapshot(finalId,Accepted,10,0);

 // A storage acknowledgement failure becomes unreadable/uncertain and can
 // never be replayed automatically in this boot. Reboot may recover a record
 // that the storage layer committed before reporting failure.
 assert(markChecking());commitThenFail=true;failRead=true;assert(!markDownloading(a));commitThenFail=false;failRead=false;
 const auto uncertain=capture();assert(!uncertain.storageReady&&uncertain.state==Uncertain&&submit(other,"1.17.0",bText)==StorageUnavailable);
 assertSnapshot(nullptr,Uncertain,0,0,false);
 assert(jobJson()=="{\"version\":2,\"storageReady\":false,\"jobId\":\"\",\"target\":\"0.0.0\",\"sha256\":\"\",\"size\":0,\"state\":7,\"error\":0,\"revision\":0,\"targetId\":\"\",\"ownerId\":\"\",\"route\":0,\"confirmedBytes\":0,\"totalBytes\":0,\"terminal\":true}");

 begin();assertSnapshot(finalId,Downloading,12,512); // Durable write actually committed before the lost acknowledgement.
 const auto valid=durable;durable[offsetof(Snapshot,state)]=255;begin();assert(!capture().storageReady&&capture().state==Uncertain);
 assert(jobJson()=="{\"version\":2,\"storageReady\":false,\"jobId\":\"\",\"target\":\"0.0.0\",\"sha256\":\"\",\"size\":0,\"state\":7,\"error\":0,\"revision\":0,\"targetId\":\"\",\"ownerId\":\"\",\"route\":0,\"confirmedBytes\":0,\"totalBytes\":0,\"terminal\":true}");durable=valid;begin();
 durable=valid;reinterpret_cast<Snapshot*>(durable.data())->target.size=0;reinterpret_cast<Snapshot*>(durable.data())->confirmedBytes=1;reinterpret_cast<Snapshot*>(durable.data())->state=Failed;reinterpret_cast<Snapshot*>(durable.data())->error=1;begin();assert(!capture().storageReady&&capture().state==Uncertain);
 durable=valid;begin();
 durable.clear();begin();assert(submit(badReady,"1.16.0",aText)==Submitted);durable[offsetof(Snapshot,state)]=Uncertain;begin();assert(!capture().storageReady&&capture().state==Uncertain);durable.clear();begin();
 LampJsonSink tooSmall(nullptr,1);appendJson(tooSmall,capture());assert(!tooSmall.okay());
 durable.clear();begin();assert(submit(postCommit,"1.16.0",aText)==Submitted);assert(markChecking());assert(markDownloading(a));assert(markCommitting());
 assert(markUncertain());assertSnapshot(postCommit,Uncertain,5,512);assert(reconcileRunning(old));assertSnapshot(postCommit,Uncertain,5,512);
 begin();assert(reconcileRunning(a));assertSnapshot(postCommit,Confirmed,6,512);

 // V2 acceptance binds the immutable device/owner/route and exact size before
 // acknowledgement. Same-ID reuse with any changed tuple is a conflict.
 durable.clear();durableV1.clear();writes=0;begin();
 assert(submitExact(id2,"aabbccddeeff","aabbccddeeff",Bridge,"1.16.0",aText,512)==Invalid);
 assert(submitExact(id1,"aabbccddeeff","aabbccddeeff",Internet,"1.16.0",aText,512)==Submitted);
 auto exact=capture();assert(exact.target.size==512&&exact.route==Internet&&!exact.ownerId[0]);
 const auto acceptedLegacy=legacyJobJson();assert(acceptedLegacy.find("\"size\":0,\"state\":1")!=String::npos&&acceptedLegacy.find("targetId")==String::npos&&acceptedLegacy.find("route")==String::npos);
 assert(submitExact(id1,"aabbccddeeff","aabbccddeeff",Internet,"1.16.0",aText,512)==Duplicate&&writes==1);
 assert(submitExact(id1,"aabbccddeeff","112233445566",Bridge,"1.16.0",aText,512)==Conflict);
 assert(submitExact(id2,"aabbccddeeff","aabbccddeeff",Internet,"1.16.0",aText,512)==Conflict);
 assert(submitExact(id2,"bad","aabbccddeeff",Internet,"1.16.0",aText,512)==Invalid);
 assert(submitExact(id2,"112233445566","112233445566",Internet,"1.16.0",aText,512)==Invalid);
 assert(submitExact(id2,"aabbccddeeff","112233445566",Internet,"1.16.0",aText,512)==Invalid);

 // A size-less legacy receipt is not the same immutable tuple as a v2 exact
 // artifact, even when the job ID, version and digest happen to match.
 durable.clear();begin();assert(submit(id1,"1.16.0",aText)==Submitted);
 assert(submitExact(id1,"aabbccddeeff","aabbccddeeff",Internet,"1.16.0",aText,512)==Conflict);

 // Confirmed bytes advance only in coarse durable milestones and never move
 // backward. Reboot restores the last persisted milestone without a clock.
 durable.clear();writes=0;begin();auto large=artifact(16,3);large.size=131072;
 char largeHash[65];formatFirmwareHex(large.sha256,32,largeHash);
 assert(submitExact(id1,"aabbccddeeff","112233445566",Bridge,"1.16.0",largeHash,large.size)==Submitted);
 assert(markChecking()&&markDownloading(large));const auto startRevision=capture().revision,startWrites=writes;
 assert(legacyJobJson().find("\"size\":131072,\"state\":3")!=String::npos);
 assert(noteProgress(1024)&&capture().revision==startRevision&&writes==startWrites);
 assert(noteProgress(65536)&&capture().confirmedBytes==65536&&capture().revision==startRevision+1&&writes==startWrites+1);
 assert(!noteProgress(65535));assert(noteProgress(large.size)&&capture().confirmedBytes==large.size);assert(markCommitting());

 // A persisted partial receiver offset cannot be resumed after reboot. It is
 // retained in a terminal needs-attention receipt instead of resetting to zero.
 durable.clear();writes=0;begin();assert(submitExact(id1,"aabbccddeeff","aabbccddeeff",Internet,"1.16.0",largeHash,large.size)==Submitted);
 assert(markChecking()&&markDownloading(large));assert(noteProgress(65536));const auto interruptedRevision=capture().revision;begin();
 assert(capture().state==Failed&&capture().error==Interrupted&&capture().confirmedBytes==65536&&capture().revision==interruptedRevision+1);
 begin();assert(capture().state==Failed&&capture().confirmedBytes==65536); // Terminal across later boots.

 // A Downloading receipt with no confirmed bytes can safely restart from zero.
 durable.clear();begin();assert(submitExact(id1,"aabbccddeeff","aabbccddeeff",Internet,"1.16.0",largeHash,large.size)==Submitted);
 assert(markChecking()&&markDownloading(large));const auto zeroRevision=capture().revision;begin();assert(capture().state==Downloading&&capture().confirmedBytes==0);
 assert(markDownloading(large)&&capture().revision==zeroRevision);

 // Checking is also a safe reboot boundary. Re-admission is idempotent and
 // does not create a synthetic revision before the Internet worker runs.
 durable.clear();begin();assert(submitExact(id1,"aabbccddeeff","aabbccddeeff",Internet,"1.16.0",largeHash,large.size)==Submitted);
 assert(markChecking());const auto checkingRevision=capture().revision;begin();assert(capture().state==Checking);
 assert(markChecking()&&capture().revision==checkingRevision);

 // An installed V1 durable intent migrates once to V2 with the lamp itself as
 // target/Internet owner; the old record remains only as rollback evidence.
 durable.clear();durableV1.clear();writes=0;LegacyRecord legacy{};legacy.target.version[0]=1;legacy.target.version[1]=16;digest(3,legacy.target.sha256);
 legacy.revision=7;strcpy(legacy.jobId,id1);legacy.state=Accepted;legacy.storageReady=true;const auto* legacyBytes=reinterpret_cast<const uint8_t*>(&legacy);durableV1.assign(legacyBytes,legacyBytes+sizeof(legacy));
 begin();const auto migrated=capture();assert(migrated.storageReady&&migrated.state==Accepted&&migrated.revision==7&&migrated.route==Internet&&!migrated.ownerId[0]);
 assert(durable.size()==sizeof(Snapshot)&&writes==1);durableV1.clear();begin();assert(capture().revision==7&&capture().state==Accepted);

 // Legacy Uncertain is post-commit. Preserve its complete receiver offset so
 // reconciliation can confirm the installed image without replaying it.
 durable.clear();durableV1.clear();writes=0;legacy.target=artifact(16,3);legacy.revision=8;strcpy(legacy.jobId,id2);legacy.state=Uncertain;legacy.error=0;legacy.storageReady=true;
 legacyBytes=reinterpret_cast<const uint8_t*>(&legacy);durableV1.assign(legacyBytes,legacyBytes+sizeof(legacy));begin();
 const auto migratedUncertain=capture();assert(migratedUncertain.state==Uncertain&&migratedUncertain.confirmedBytes==legacy.target.size&&migratedUncertain.revision==8);
 assert(reconcileRunning(legacy.target));assert(capture().state==Confirmed&&capture().confirmedBytes==legacy.target.size);

 // Revisions are monotonic within a durable job. Exhaustion fails closed in
 // every same-job transition, including reboot interruption recovery.
 durable.clear();durableV1.clear();begin();assert(submitExact(id1,"aabbccddeeff","aabbccddeeff",Internet,"1.16.0",largeHash,large.size)==Submitted);
 auto* exhausted=reinterpret_cast<Snapshot*>(durable.data());exhausted->revision=UINT32_MAX;begin();assert(!markChecking()&&capture().state==Accepted&&capture().revision==UINT32_MAX);
 exhausted=reinterpret_cast<Snapshot*>(durable.data());exhausted->state=Downloading;exhausted->target=large;exhausted->confirmedBytes=0;begin();assert(!noteProgress(large.size)&&capture().confirmedBytes==0&&capture().revision==UINT32_MAX);
 exhausted=reinterpret_cast<Snapshot*>(durable.data());exhausted->state=Committing;exhausted->confirmedBytes=large.size;begin();assert(!reconcileRunning(large)&&capture().state==Committing&&capture().revision==UINT32_MAX);
 exhausted=reinterpret_cast<Snapshot*>(durable.data());exhausted->state=Downloading;exhausted->confirmedBytes=65536;begin();assert(!capture().storageReady&&capture().state==Uncertain);
 std::cout<<"PASS durable update job: exact tuple validation, persist-before-accept, duplicate idempotence, active conflict, pinned artifact binding, reboot resume, commit uncertainty, exact running confirmation, terminal replacement and bounded allocation-free JSON\n";
}
'''

with tempfile.TemporaryDirectory(prefix="update-job-", dir=ROOT / ".build") as folder:
    folder = Path(folder)
    arduino = (ROOT / "tests/sync-stubs/Arduino.h").read_text()
    arduino += "\nusing portMUX_TYPE=int;\n#define portMUX_INITIALIZER_UNLOCKED 0\n#define portENTER_CRITICAL(p) ((void)(p))\n#define portEXIT_CRITICAL(p) ((void)(p))\n"
    for name, text in (("Arduino.h", arduino), ("nvs.h", NVS), ("test.cpp", FIXTURE)):
        (folder / name).write_text(text)
    binary = folder / "update-job.exe"
    subprocess.run([
        "g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", *SANITIZERS,
        "-I" + str(folder), "-I" + str(ROOT), str(folder / "test.cpp"),
        str(ROOT / "LampUpdateJob.cpp"), "-o", str(binary)
    ], check=True)
    subprocess.run([str(binary)], check=True)

network = (ROOT / "LampNetwork.ino").read_text()
handler = network[network.index('void serveLampUpdateJob()'):network.index('\nvoid beginLampNetwork()', network.index('void serveLampUpdateJob()'))]
assert 'lampUpdateJson(contractV2)' in handler
assert 'argView("updateJobContract")' in handler
assert 'Update job unavailable.' in handler
assert 'sendLampUpdateJobJson' not in network
assert "route[0]!='1'||route[1]" in handler
assert 'submitLampUpdateJob(' in handler and 'LampUpdateJob::submitBound(' not in handler
assert 'durable.route==LampUpdateJob::Internet' in (ROOT / "LampUpdate.cpp").read_text()
