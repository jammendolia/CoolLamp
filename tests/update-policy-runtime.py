"""Exercise production policy mutation/load functions against failing NVS."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'LampUpdate.cpp').read_text()
functions=source[source.index('void noteLampUpdateUse()'):]
functions=functions[:functions.index('bool lampRolloutRecoveryPreflight(')]+functions[functions.index('uint32_t lampUpdatePolicyRevision()'):]
load=source[source.index('  Preferences policyPrefs;'):source.index('  configTime(')]
fixture=r'''
#include "LampUpdate.h"
#include <cassert>
#include <time.h>
#include <stdlib.h>
#include <vector>
#include <iostream>
#ifdef _WIN32
int setenv(const char* key,const char* value,int){return _putenv_s(key,value);}
tm* localtime_r(const time_t* value,tm* out){const tm* converted=localtime(value);if(!converted)return nullptr;*out=*converted;return out;}
#endif
struct Preferences {
 protected:uint32_t _handle=1;
 public:
 inline static bool failOpen=false,failWrite=false,commitThenFail=false,failRead=false,failReadAfterWrite=false,failReadOpenAfterWrite=false,otherAfterFailedWrite=false;
 inline static std::vector<uint8_t> bytes;
 inline static unsigned writes=0;
 bool begin(const char*,bool){return !failOpen;}void end(){}
 bool isKey(const char*){return !bytes.empty();}
 size_t getBytesLength(const char*){return bytes.size();}
 size_t getBytes(const char*,void* out,size_t n){if(n<bytes.size())return 0;memcpy(out,bytes.data(),bytes.size());return bytes.size();}
 size_t putBytes(const char*,const void* p,size_t n){
  if(failWrite){if(otherAfterFailedWrite&&!bytes.empty())bytes[6]^=1;if(failReadAfterWrite)failRead=true;if(failReadOpenAfterWrite)failOpen=true;return 0;}
  const auto* b=static_cast<const uint8_t*>(p);bytes.assign(b,b+n);++writes;if(failReadAfterWrite)failRead=true;if(failReadOpenAfterWrite)failOpen=true;return commitThenFail?0:n;
 }
};
using esp_err_t=int;constexpr int ESP_OK=0,ESP_ERR_NVS_NOT_FOUND=1,ESP_FAIL=2;
esp_err_t nvs_get_blob(uint32_t,const char*,void* out,size_t* size){
 if(Preferences::failRead)return ESP_FAIL;
 if(Preferences::bytes.empty())return ESP_ERR_NVS_NOT_FOUND;
 if(*size<Preferences::bytes.size())return ESP_FAIL;
 *size=Preferences::bytes.size();memcpy(out,Preferences::bytes.data(),*size);return ESP_OK;
}
LampUpdateStatus status{};
LampUpdatePolicy::Policy updatePolicy;
uint32_t policyRevision=1,lastUserUse=0;
bool userUseObserved=false,busy=false,healthy=true;
bool policyReadable=true;
bool policySaveUncertain=false;
bool policyNeedsReconcile=false;
uint8_t coordinationReason=0;
uint8_t lampRolloutAutomaticAdmissionReason(){return coordinationReason;}
bool lampUpdateOwnsResources(){return busy;}
int mux=0;void startReceiverCue(){}
#define portENTER_CRITICAL(value) ((void)(value))
#define portEXIT_CRITICAL(value) ((void)(value))
LampUpdateStatus getLampUpdateStatus(){return status;}
time_t clockUnix=0;time_t fakeTime(time_t*){return clockUnix;}
#define time fakeTime
'''
test=r'''
int main(){
 status.automatic=true;assert(lampAutomaticUpdateAllowed());
 for(uint8_t reason=1;reason<=4;++reason){coordinationReason=reason;assert(!lampAutomaticUpdateAllowed());
  const auto json=lampUpdatePolicyJson();assert(json.find("\"groupCoordination\":"+String(reason))!=String::npos&&json.find("\"automaticEligible\":false")!=String::npos);}
 coordinationReason=0;assert(lampAutomaticUpdateAllowed());
 LampUpdatePolicy::Policy next;next.window=true;next.startMinute=0;next.endMinute=60;strcpy(next.timezone,"UTC0");
 Preferences::failOpen=true;assert(!setLampUpdatePolicy(next,1)&&policyRevision==1&&Preferences::writes==0&&!lampUpdatePolicySaveUncertain());Preferences::failOpen=false;
 Preferences::failWrite=true;assert(!setLampUpdatePolicy(next,1)&&policyRevision==1&&Preferences::bytes.empty()&&!lampUpdatePolicySaveUncertain());Preferences::failWrite=false;
 busy=true;assert(!setLampUpdatePolicy(next,1));busy=false;
 assert(!setLampUpdatePolicy(next,0));assert(setLampUpdatePolicy(next,1)&&policyRevision==2&&Preferences::writes==1);
 assert(!lampAutomaticUpdateAllowed()); // Unknown wall time cannot be guessed.
 assert(!setLampUpdatePolicy(next,1)&&Preferences::writes==1); // Lost reply reconciles revision; no stale repeat.
 updatePolicy={};policyRevision=1;reboot();assert(policyRevision==2&&updatePolicy.window&&!lampAutomaticUpdateAllowed());
 clockUnix=1700006400;assert(lampAutomaticUpdateAllowed()); // 2023-11-15 00:00Z.
 clockUnix+=3600;assert(!lampAutomaticUpdateAllowed());
 next.window=false;next.deferDuringUse=true;next.idleSeconds=60;assert(setLampUpdatePolicy(next,2));
 fakeNow=UINT32_MAX-10;noteLampUpdateUse();fakeNow=25;assert(!lampAutomaticUpdateAllowed());fakeNow=60000;assert(lampAutomaticUpdateAllowed()&&!userUseObserved);
 status.automatic=false;assert(!lampAutomaticUpdateAllowed());status.automatic=true;
 Preferences::bytes[2]^=1;reboot();assert(!status.automatic); // Corrupt quiet policy fails closed.
 status.automatic=true;assert(!lampAutomaticUpdateAllowed()); // Opting in cannot silently reinterpret a corrupt window.
 assert(setLampUpdatePolicy(next,policyRevision)&&policyReadable&&lampAutomaticUpdateAllowed());
 const uint32_t revision=policyRevision;const auto prior=Preferences::bytes;
 next.idleSeconds=61;Preferences::failWrite=true;
 assert(!setLampUpdatePolicy(next,revision)&&!lampUpdatePolicySaveUncertain()&&policyRevision==revision&&Preferences::bytes==prior&&updatePolicy.idleSeconds==60);
 Preferences::failWrite=false;Preferences::commitThenFail=true;
 assert(setLampUpdatePolicy(next,revision)&&!lampUpdatePolicySaveUncertain()&&policyRevision==revision+1&&updatePolicy.idleSeconds==61&&policyReadable);
 Preferences::commitThenFail=false;Preferences::failWrite=true;Preferences::failReadAfterWrite=true;next.idleSeconds=62;
 assert(!setLampUpdatePolicy(next,policyRevision)&&lampUpdatePolicySaveUncertain()&&!policyReadable&&!lampAutomaticUpdateAllowed()&&updatePolicy.idleSeconds==61);
 Preferences::failWrite=false;Preferences::failReadAfterWrite=false;Preferences::failRead=false;
 assert(setLampUpdatePolicy(next,policyRevision)&&!lampUpdatePolicySaveUncertain()&&policyReadable&&lampAutomaticUpdateAllowed());
 next.idleSeconds=63;Preferences::commitThenFail=true;Preferences::failReadAfterWrite=true;
 const auto uncertainRevision=policyRevision;
 assert(!setLampUpdatePolicy(next,uncertainRevision)&&lampUpdatePolicySaveUncertain()&&!policyReadable&&policyRevision==uncertainRevision&&updatePolicy.idleSeconds==62);
 const auto writesAtUncertainty=Preferences::writes;
 // Still unreadable: even a new command cannot overwrite unknown durable r+1.
 assert(!setLampUpdatePolicy(next,uncertainRevision)&&lampUpdatePolicySaveUncertain()&&Preferences::writes==writesAtUncertainty);
 Preferences::commitThenFail=false;Preferences::failReadAfterWrite=false;Preferences::failRead=false;
 assert(!setLampUpdatePolicy(next,uncertainRevision)&&Preferences::writes==writesAtUncertainty&&policyRevision==uncertainRevision+1&&updatePolicy.idleSeconds==63&&policyReadable);
 assert(lampUpdatePolicyRevision()==uncertainRevision+1&&lampUpdatePolicyJson().find("\"valid\":true")!=String::npos);
 // A reboot reloads committed bytes rather than replaying the original save.
 reboot();assert(policyRevision==uncertainRevision+1&&updatePolicy.idleSeconds==63&&policyReadable);
 next.idleSeconds=64;Preferences::failWrite=true;Preferences::otherAfterFailedWrite=true;
 assert(!setLampUpdatePolicy(next,policyRevision)&&lampUpdatePolicySaveUncertain()&&!policyReadable);
 Preferences::failWrite=false;Preferences::otherAfterFailedWrite=false;
 assert(!setLampUpdatePolicy(next,0)&&!lampUpdatePolicySaveUncertain()&&!policyReadable);
 assert(setLampUpdatePolicy(next,policyRevision)&&!lampUpdatePolicySaveUncertain()&&policyReadable);
 Preferences::failWrite=true;Preferences::failReadOpenAfterWrite=true;next.idleSeconds=65;
 assert(!setLampUpdatePolicy(next,policyRevision)&&lampUpdatePolicySaveUncertain()&&!policyReadable);
 Preferences::failOpen=false;Preferences::failWrite=false;Preferences::failReadOpenAfterWrite=false;
 assert(setLampUpdatePolicy(next,policyRevision)&&!lampUpdatePolicySaveUncertain()&&policyReadable);
 std::cout<<"PASS production policy: revision CAS, NVS prior/new/ambiguous readback, commit-then-failure, recovery/repair, clock/DST/opt-out/use rollover, staged group admission\n";
}
'''
with tempfile.TemporaryDirectory(prefix='update-policy-',dir=ROOT/'.build') as directory:
    directory=Path(directory)
    (directory/'Arduino.h').write_text((ROOT/'tests/sync-stubs/Arduino.h').read_text())
    (directory/'test.cpp').write_text(fixture+functions+'\nvoid reboot(){\n'+load+'}\n'+test)
    binary=directory/'policy.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,'-I'+str(directory),'-I'+str(ROOT),str(directory/'test.cpp'),str(ROOT/'LampUpdatePolicy.cpp'),'-o',str(binary)],check=True)
    subprocess.run([str(binary)],check=True)
