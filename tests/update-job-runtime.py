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
void* operator new(size_t size){assert(!allocationForbidden);if(void* p=std::malloc(size))return p;throw std::bad_alloc();}
void* operator new[](size_t size){return ::operator new(size);}
void operator delete(void* p)noexcept{std::free(p);}void operator delete[](void* p)noexcept{std::free(p);}
void operator delete(void* p,size_t)noexcept{std::free(p);}void operator delete[](void* p,size_t)noexcept{std::free(p);}

std::vector<uint8_t> durable,staged;unsigned writes=0,reads=0;
bool failOpen=false,failRead=false,failWrite=false,failCommit=false,commitThenFail=false;
int nvs_open(const char* name,int,nvs_handle_t* handle){assert(!strcmp(name,"lamptrust"));if(failOpen)return ESP_FAIL;*handle=1;return ESP_OK;}
int nvs_get_blob(nvs_handle_t,const char* key,void* out,size_t* size){++reads;assert(!strcmp(key,"otaJobV1"));if(failRead)return ESP_FAIL;if(durable.empty())return ESP_ERR_NVS_NOT_FOUND;if(*size<durable.size())return ESP_FAIL;*size=durable.size();memcpy(out,durable.data(),*size);return ESP_OK;}
int nvs_set_blob(nvs_handle_t,const char* key,const void* bytes,size_t size){assert(!strcmp(key,"otaJobV1"));if(failWrite)return ESP_FAIL;const auto* p=static_cast<const uint8_t*>(bytes);staged.assign(p,p+size);return ESP_OK;}
int nvs_commit(nvs_handle_t){if(failCommit)return ESP_FAIL;durable=staged;++writes;return commitThenFail?ESP_FAIL:ESP_OK;}
void nvs_close(nvs_handle_t){staged.clear();}

void digest(unsigned seed,uint8_t out[32]){for(unsigned i=0;i<32;++i)out[i]=uint8_t(seed+i);}
FirmwareManifest artifact(unsigned minor,unsigned seed){FirmwareManifest value{};value.version[0]=1;value.version[1]=minor;value.size=512;digest(seed,value.sha256);return value;}

void assertSnapshot(const char* id,unsigned state,unsigned revision,unsigned size,bool ready=true){
 using namespace LampUpdateJob;const auto value=capture();if(!(value.storageReady==ready&&value.state==state&&value.revision==revision&&value.target.size==size))std::cerr<<"snapshot expected "<<state<<"/"<<revision<<"/"<<size<<"/"<<ready<<" got "<<unsigned(value.state)<<"/"<<value.revision<<"/"<<value.target.size<<"/"<<value.storageReady<<"\n";assert(value.storageReady==ready&&value.state==state&&value.revision==revision&&value.target.size==size);
 if(id)assert(!strcmp(value.jobId,id));
 const auto beforeReads=reads,beforeWrites=writes;allocationForbidden=true;LampJsonSink count;appendJson(count,value);allocationForbidden=false;
 assert(count.okay()&&count.size()&&reads==beforeReads&&writes==beforeWrites);
 String output;assert(output.reserve(count.size()));LampJsonSink sink(&output,count.size());allocationForbidden=true;appendJson(sink,value);allocationForbidden=false;
 assert(sink.okay()&&output.length()==count.size()&&output.find("\"state\":"+String(state))!=String::npos&&reads==beforeReads&&writes==beforeWrites);
}
String jobJson(){const auto snapshot=LampUpdateJob::capture();return lampJsonReply([&](LampJsonSink& out){LampUpdateJob::appendJson(out,snapshot);});}

int main(){using namespace LampUpdateJob;uint8_t aHash[32],bHash[32];digest(3,aHash);digest(9,bHash);
 const char *id1="11111111111111111111111111111111",*id2="22222222222222222222222222222222",*healthy="33333333333333333333333333333333",*next="44444444444444444444444444444444",*finalId="55555555555555555555555555555555",*other="66666666666666666666666666666666",*badReady="77777777777777777777777777777777",*postCommit="88888888888888888888888888888888";
 begin();assertSnapshot(nullptr,None,0,0);
 assert(jobJson()=="{\"version\":1,\"storageReady\":true,\"jobId\":\"\",\"target\":\"0.0.0\",\"sha256\":\"\",\"size\":0,\"state\":0,\"error\":0,\"revision\":0,\"terminal\":false}");
 char aText[65],bText[65];const char hex[]="0123456789abcdef";for(unsigned i=0;i<32;++i){aText[i*2]=hex[aHash[i]>>4];aText[i*2+1]=hex[aHash[i]&15];bText[i*2]=hex[bHash[i]>>4];bText[i*2+1]=hex[bHash[i]&15];}aText[64]=bText[64]=0;
 assert(submit("short","1.16.0",aText)==Invalid);assert(submit("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","1.16.0",aText)==Invalid);aText[3]='A';assert(submit(id1,"1.16.0",aText)==Invalid);aText[3]=hex[aHash[1]&15];
 failOpen=true;assert(submit(id1,"1.16.0",aText)==StorageUnavailable);failOpen=false;assertSnapshot(nullptr,None,0,0);
 assert(submit(id1,"1.16.0",aText)==Submitted);assertSnapshot(id1,Accepted,1,0);assert(writes==1);
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
 assert(jobJson()=="{\"version\":1,\"storageReady\":false,\"jobId\":\"\",\"target\":\"0.0.0\",\"sha256\":\"\",\"size\":0,\"state\":7,\"error\":0,\"revision\":0,\"terminal\":true}");

 begin();assertSnapshot(finalId,Downloading,12,512); // Durable write actually committed before the lost acknowledgement.
 const auto valid=durable;durable[offsetof(Snapshot,state)]=255;begin();assert(!capture().storageReady&&capture().state==Uncertain);
 assert(jobJson()=="{\"version\":1,\"storageReady\":false,\"jobId\":\"\",\"target\":\"0.0.0\",\"sha256\":\"\",\"size\":0,\"state\":7,\"error\":0,\"revision\":0,\"terminal\":true}");durable=valid;begin();
 durable.clear();begin();assert(submit(badReady,"1.16.0",aText)==Submitted);durable[offsetof(Snapshot,state)]=Uncertain;begin();assert(!capture().storageReady&&capture().state==Uncertain);durable.clear();begin();
 LampJsonSink tooSmall(nullptr,1);appendJson(tooSmall,capture());assert(!tooSmall.okay());
 durable.clear();begin();assert(submit(postCommit,"1.16.0",aText)==Submitted);assert(markChecking());assert(markDownloading(a));assert(markCommitting());
 assert(markUncertain());assertSnapshot(postCommit,Uncertain,5,512);assert(reconcileRunning(old));assertSnapshot(postCommit,Uncertain,5,512);
 begin();assert(reconcileRunning(a));assertSnapshot(postCommit,Confirmed,6,512);
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
assert 'lampServer.send(status,"application/json",lampUpdateJson());' in handler
assert 'Update job unavailable.' in handler
assert 'sendLampUpdateJobJson' not in network
