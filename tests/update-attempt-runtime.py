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
#include "LampUpdateAttempt.h"
#include "nvs.h"
std::vector<uint8_t> durable,staged;unsigned writes=0;
bool failOpen=false,failRead=false,failWrite=false,commitThenFail=false,failCommit=false;
int nvs_open(const char* name,int,nvs_handle_t* handle){assert(!strcmp(name,"lamptrust"));if(failOpen)return ESP_FAIL;*handle=1;return ESP_OK;}
int nvs_get_blob(nvs_handle_t,const char* key,void* out,size_t* n){assert(!strcmp(key,"otaAttemptV1"));if(failRead)return ESP_FAIL;if(durable.empty())return ESP_ERR_NVS_NOT_FOUND;if(*n<durable.size())return ESP_FAIL;*n=durable.size();memcpy(out,durable.data(),*n);return ESP_OK;}
int nvs_set_blob(nvs_handle_t,const char*,const void* p,size_t n){if(failWrite)return ESP_FAIL;const auto* b=static_cast<const uint8_t*>(p);staged.assign(b,b+n);return ESP_OK;}
int nvs_commit(nvs_handle_t){if(failCommit)return ESP_FAIL;durable=staged;++writes;return commitThenFail?ESP_FAIL:ESP_OK;}
void nvs_close(nvs_handle_t){staged.clear();}
FirmwareManifest artifact(unsigned id){FirmwareManifest value{};value.version[0]=1;value.version[1]=id;value.size=512;value.sha256[0]=id;return value;}
int main(){using namespace LampUpdateAttempt;const auto a=artifact(15),b=artifact(16);begin();assert(automaticAllowed(a));
 // Before a commit there is no attempt: cancelled/incomplete image does not consume a slot.
 begin();assert(automaticAllowed(a)&&writes==0);
 failWrite=true;assert(!prepare(a,false)&&automaticAllowed(a)&&durable.empty());failWrite=false;
 failCommit=true;assert(!prepare(a,false)&&automaticAllowed(a)&&durable.empty());failCommit=false;
 // Durable record precedes boot selection. Interruption before/after selection
 // has the same honest unconfirmed state; absence of health never proves rollback.
 assert(prepare(a,false)&&durable.size()==RecordSize&&writes==1);begin();assert(!automaticAllowed(a)&&automaticAllowed(b));
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
 assert(prepare(a,true)); // Full ledger still allows explicit repair of a recorded artifact.
 assert(confirmHealthy(a)&&automaticAllowed(artifact(20)));
 const auto valid=durable;
 for(size_t i=0;i<valid.size();++i){durable=valid;durable[i]^=1;begin();assert(!automaticAllowed(a)&&!prepare(a,true));}
 durable=valid;failRead=true;begin();assert(!automaticAllowed(a)&&!prepare(a,true));failRead=false;begin();
 failOpen=true;assert(!prepare(a,false));failOpen=false;
 // A committed record with unreadable acknowledgement is uncertain and blocks
 // all automatic admission until reload/service; never overwrite a hidden tuple.
 commitThenFail=true;failRead=true;assert(!prepare(a,false)&&!automaticAllowed(b));commitThenFail=false;failRead=false;begin();assert(!automaticAllowed(a));
 durable.pop_back();begin();assert(!automaticAllowed(a)&&!prepare(a,true));
 std::cout<<"PASS production attempt guard:188B CRC,4 exact artifacts, commit-before-select/reboot/rollback quarantine, explicitrepair, no eviction/duplicate writes, healthy exact clear, NVS interruption/read failures\n";
}
'''
with tempfile.TemporaryDirectory(prefix='update-attempt-',dir=ROOT/'.build') as folder:
 folder=Path(folder)
 arduino=(ROOT/'tests/sync-stubs/Arduino.h').read_text()+'\nusing portMUX_TYPE=int;\n#define portMUX_INITIALIZER_UNLOCKED 0\n#define portENTER_CRITICAL(p) ((void)(p))\n#define portEXIT_CRITICAL(p) ((void)(p))\n'
 for name,text in [('Arduino.h',arduino),('nvs.h',nvs),('test.cpp',fixture)]: (folder/name).write_text(text)
 binary=folder/'attempt.exe'
 subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,'-I'+str(folder),'-I'+str(ROOT),str(folder/'test.cpp'),str(ROOT/'LampUpdateAttempt.cpp'),'-o',str(binary)],check=True)
 subprocess.run([str(binary)],check=True)
