"""Actual reset-retained attempt ledger with interrupted NVS/boot boundaries."""
from pathlib import Path
import subprocess,tempfile
from host_compiler import SANITIZERS
ROOT=Path(__file__).resolve().parents[1]
nvs=r'''#pragma once
#include <cstdint>
#include <cstddef>
using nvs_handle_t=unsigned;using esp_err_t=int;
constexpr int ESP_OK=0,ESP_ERR_NVS_NOT_FOUND=1,ESP_FAIL=2,NVS_READONLY=0,NVS_READWRITE=1;
int nvs_open(const char*,int,nvs_handle_t*);
int nvs_get_blob(nvs_handle_t,const char*,void*,size_t*);
int nvs_set_blob(nvs_handle_t,const char*,const void*,size_t);
int nvs_commit(nvs_handle_t);void nvs_close(nvs_handle_t);
'''
fixture=r'''
#include <cassert>
#include <cstring>
#include <iostream>
#include <vector>
#include <new>
#include <cstdlib>
#include "LampUpdateAttempt.h"
#include "LampJsonSink.h"
#include "nvs.h"
bool allocationForbidden=false;
void* operator new(size_t size){assert(!allocationForbidden);if(void* p=std::malloc(size))return p;throw std::bad_alloc();}
void* operator new[](size_t size){return ::operator new(size);}
void operator delete(void* p)noexcept{std::free(p);}void operator delete[](void* p)noexcept{std::free(p);}
void operator delete(void* p,size_t)noexcept{std::free(p);}void operator delete[](void* p,size_t)noexcept{std::free(p);}
std::vector<uint8_t> durable,staged;unsigned writes=0,opens=0,reads=0;
bool failOpen=false,failRead=false,failWrite=false,commitThenFail=false,failCommit=false;
int nvs_open(const char* name,int,nvs_handle_t* handle){++opens;assert(!strcmp(name,"lamptrust"));if(failOpen)return ESP_FAIL;*handle=1;return ESP_OK;}
int nvs_get_blob(nvs_handle_t,const char* key,void* out,size_t* n){++reads;assert(!strcmp(key,"otaAttemptV1"));if(failRead)return ESP_FAIL;if(durable.empty())return ESP_ERR_NVS_NOT_FOUND;if(*n<durable.size())return ESP_FAIL;*n=durable.size();memcpy(out,durable.data(),*n);return ESP_OK;}
int nvs_set_blob(nvs_handle_t,const char*,const void* p,size_t n){if(failWrite)return ESP_FAIL;const auto* b=static_cast<const uint8_t*>(p);staged.assign(b,b+n);return ESP_OK;}
int nvs_commit(nvs_handle_t){if(failCommit)return ESP_FAIL;durable=staged;++writes;return commitThenFail?ESP_FAIL:ESP_OK;}
void nvs_close(nvs_handle_t){staged.clear();}
FirmwareManifest artifact(unsigned id){FirmwareManifest value{};value.version[0]=1;value.version[1]=id;value.size=512;value.sha256[0]=id;return value;}
void status(const FirmwareManifest& image,bool ready,unsigned used,unsigned reason){
 using namespace LampUpdateAttempt;const unsigned oldOpens=opens,oldReads=reads,oldWrites=writes;
 allocationForbidden=true;const auto snapshot=captureStatus(image);LampJsonSink count;appendStatus(count,snapshot);allocationForbidden=false;
 assert(snapshot.storageReady==ready&&snapshot.unconfirmedArtifacts==used&&snapshot.candidateReason==reason);
 assert(count.okay()&&count.size()&&opens==oldOpens&&reads==oldReads&&writes==oldWrites);
 const String expected=String("{\"version\":1,\"storageReady\":")+(ready?"true":"false")+",\"unconfirmedArtifacts\":"+String(used)+",\"capacity\":4,\"candidateReason\":"+String(reason)+",\"sameArtifactRequiresManual\":true,\"rollbackProven\":false}";
 assert(statusJson(image)==expected&&count.size()==expected.length());
 String output;assert(output.reserve(count.size()));LampJsonSink write(&output,count.size());
 allocationForbidden=true;appendStatus(write,snapshot);allocationForbidden=false;
 assert(write.okay()&&output==expected&&write.size()==count.size());
 assert(opens==oldOpens&&reads==oldReads&&writes==oldWrites);
 LampJsonSink tooSmall(nullptr,count.size()-1);appendStatus(tooSmall,snapshot);assert(!tooSmall.okay());
}
int main(){using namespace LampUpdateAttempt;const auto a=artifact(15),b=artifact(16);begin();assert(automaticAllowed(a));
 status(a,true,0,0);FirmwareManifest noArtifact{};status(noArtifact,true,0,0); // Legacy read reason does not become admission's InvalidArtifact=4.
 assert(automaticAdmissionReason(a)==Eligible);FirmwareManifest invalid=a;invalid.size=0;assert(automaticAdmissionReason(invalid)==InvalidArtifact&&!automaticAllowed(invalid));
 // Before a commit there is no attempt: cancelled/incomplete image does not consume a slot.
 begin();assert(automaticAllowed(a)&&writes==0);
 failWrite=true;assert(!prepare(a,false)&&automaticAllowed(a)&&durable.empty());failWrite=false;
 failCommit=true;assert(!prepare(a,false)&&automaticAllowed(a)&&durable.empty());failCommit=false;
 // Durable record precedes boot selection. Interruption before/after selection
 // has the same honest unconfirmed state; absence of health never proves rollback.
 assert(prepare(a,false)&&durable.size()==RecordSize&&writes==1);begin();assert(!automaticAllowed(a)&&automaticAllowed(b));
 assert(automaticAdmissionReason(a)==Unconfirmed&&automaticAdmissionReason(b)==Eligible);
 status(a,true,1,1);status(b,true,1,0);
 assert(!prepare(a,false)&&writes==1);assert(prepare(a,true)&&writes==1);
 begin();assert(!automaticAllowed(a)); // Rollback to a supported old image cannot re-offer a forever.
 assert(confirmHealthy(b)&&writes==1&&!automaticAllowed(a)); // Different running bytes cannot clear it.
 failWrite=true;assert(!confirmHealthy(a)&&!automaticAllowed(a));failWrite=false;
 assert(confirmHealthy(a)&&writes==2&&automaticAllowed(a));assert(confirmHealthy(a)&&writes==2);
 commitThenFail=true;assert(prepare(a,false)&&!automaticAllowed(a));commitThenFail=false;begin();assert(!automaticAllowed(a));
 // Owner reset only clears coollamp: this trusted record remains unchanged.
 const auto retained=durable;begin();assert(durable==retained&&!automaticAllowed(a));
 for(unsigned i=16;i<19;++i)assert(prepare(artifact(i),false));
 assert(!automaticAllowed(artifact(20))&&!prepare(artifact(20),true));
 assert(automaticAdmissionReason(artifact(20))==Full);
 status(artifact(20),true,4,2);status(a,true,4,1);
 assert(prepare(a,true)); // Full ledger still allows explicit repair of a recorded artifact.
 assert(confirmHealthy(a)&&automaticAllowed(artifact(20)));
 const auto valid=durable;
 for(size_t i=0;i<valid.size();++i){durable=valid;durable[i]^=1;begin();assert(!automaticAllowed(a)&&!prepare(a,true));}
 durable=valid;failRead=true;begin();assert(!automaticAllowed(a)&&!prepare(a,true));failRead=false;begin();
 failRead=true;begin();assert(automaticAdmissionReason(a)==Unavailable);status(a,false,0,3);failRead=false;begin();
 failOpen=true;assert(!prepare(a,false));failOpen=false;
 // A committed record with unreadable acknowledgement is uncertain and blocks
 // all automatic admission until reload/service; never overwrite a hidden tuple.
 commitThenFail=true;failRead=true;assert(!prepare(a,false)&&!automaticAllowed(b));commitThenFail=false;failRead=false;begin();assert(!automaticAllowed(a));
 durable.pop_back();begin();assert(!automaticAllowed(a)&&!prepare(a,true));
 // Encoding consumes only frozen fields even after another boot loads a new
 // quarantine. It never consults storage or the current candidate again.
 durable.clear();begin();const auto empty=captureStatus(a);assert(prepare(a,false));
 String frozen=lampJsonReply([&](LampJsonSink& out){appendStatus(out,empty);});
 assert(frozen.find("\"unconfirmedArtifacts\":0")!=String::npos&&frozen.find("\"candidateReason\":0")!=String::npos);
 StatusSnapshot malformed=empty;malformed.unconfirmedArtifacts=Capacity+1;LampJsonSink invalidCount;appendStatus(invalidCount,malformed);assert(!invalidCount.okay());
 malformed=empty;malformed.candidateReason=4;LampJsonSink invalidReason;appendStatus(invalidReason,malformed);assert(!invalidReason.okay());
 std::cout<<"PASS production attempt guard:188B CRC,4 exact artifacts, commit-before-select/reboot/rollback quarantine, explicitrepair, no eviction/duplicate writes, healthy exact clear, NVS interruption/read failures, allocation-free frozen3B status, exact legacy JSON/reasons and bounded count/write\n";
}
'''
with tempfile.TemporaryDirectory(prefix='update-attempt-',dir=ROOT/'.build') as folder:
 folder=Path(folder)
 arduino=(ROOT/'tests/sync-stubs/Arduino.h').read_text()+'\nusing portMUX_TYPE=int;\n#define portMUX_INITIALIZER_UNLOCKED 0\n#define portENTER_CRITICAL(p) ((void)(p))\n#define portEXIT_CRITICAL(p) ((void)(p))\n'
 for name,text in [('Arduino.h',arduino),('nvs.h',nvs),('test.cpp',fixture)]: (folder/name).write_text(text)
 binary=folder/'attempt.exe'
 subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,'-I'+str(folder),'-I'+str(ROOT),str(folder/'test.cpp'),str(ROOT/'LampUpdateAttempt.cpp'),'-o',str(binary)],check=True)
 subprocess.run([str(binary)],check=True)
