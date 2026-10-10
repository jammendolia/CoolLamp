"""Production updater recovery proof with explicit OTA/resource failures."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'LampUpdate.cpp').read_text();function=source[source.index('bool lampRolloutRecoveryPreflight('):source.index('uint32_t lampUpdatePolicyRevision()')]
fixture=r'''
#include "LampUpdate.h"
#include "LampControl.h"
#include <cassert>
#include <cstring>
#include <iostream>
bool healthy=true,manual=false,commission=false,wifiBusy=false,resetPending=false,resetArmed=false,networkRestart=false;
uint8_t job=0;uint32_t restartAt=0;int mux=0;
LampUpdateStatus status{};
#define portENTER_CRITICAL(value) ((void)(value))
#define portEXIT_CRITICAL(value) ((void)(value))
bool busy(uint8_t phase){return phase==UPDATE_CHECKING||phase==UPDATE_DOWNLOADING||phase==UPDATE_RESTARTING;}
namespace LampCommission{bool working(){return commission;}}
bool lampWifiSetupBusy(){return wifiBusy;}bool lampFactoryResetPending(){return resetPending;}bool lampFactoryResetArmed(){return resetArmed;}
bool lampNetworkRestartPending(){return networkRestart;}
struct esp_partition_t{void* flash_chip=nullptr;unsigned address=0x10000,size=2031616;uint8_t type=0,subtype=16;};
int chip=0;esp_partition_t running{&chip},selected{&chip};bool missingRunning=false,missingSelected=false,stateAvailable=true;
const esp_partition_t* esp_ota_get_running_partition(){return missingRunning?nullptr:&running;}
const esp_partition_t* esp_ota_get_boot_partition(){return missingSelected?nullptr:&selected;}
enum esp_ota_img_states_t{ESP_OTA_IMG_VALID,ESP_OTA_IMG_PENDING_VERIFY,ESP_OTA_IMG_UNDEFINED};
constexpr int ESP_OK=0;esp_ota_img_states_t imageState=ESP_OTA_IMG_VALID;
int esp_ota_get_state_partition(const esp_partition_t* p,esp_ota_img_states_t* out){assert(p==&running);*out=imageState;return stateAvailable?ESP_OK:-1;}
LampControlState control{4,100,true};LampControlState getLampControlState(){return control;}uint8_t lampAvailableEffectCount(){return 38;}
bool measuredAvailable=true;FirmwareManifest measured{{1,15,0},512,{1}},pinned{{1,16,0},512,{2}};
namespace LampFirmwareRelay{bool runningManifest(FirmwareManifest& out){if(!measuredAvailable)return false;out=measured;return true;}}
'''
test=r'''
int main(){
 assert(lampRolloutRecoveryPreflight(pinned));
 for(bool* guard:{&manual,&commission,&wifiBusy,&resetPending,&resetArmed,&status.receiving,&networkRestart}){*guard=true;assert(!lampRolloutRecoveryPreflight(pinned));*guard=false;}
 healthy=false;assert(!lampRolloutRecoveryPreflight(pinned));healthy=true;
 job=2;assert(!lampRolloutRecoveryPreflight(pinned));job=0;restartAt=1;assert(!lampRolloutRecoveryPreflight(pinned));restartAt=0;
 for(auto phase:{UPDATE_CHECKING,UPDATE_DOWNLOADING,UPDATE_RESTARTING}){status.phase=phase;assert(!lampRolloutRecoveryPreflight(pinned));}status.phase=UPDATE_ERROR;
 assert(lampRolloutRecoveryPreflight(pinned)); // Explicit failed attempt, never boot-selected.
 missingRunning=true;assert(!lampRolloutRecoveryPreflight(pinned));missingRunning=false;missingSelected=true;assert(!lampRolloutRecoveryPreflight(pinned));missingSelected=false;
 selected.address=0x200000;assert(!lampRolloutRecoveryPreflight(pinned));selected=running;
 selected.subtype=17;assert(!lampRolloutRecoveryPreflight(pinned));selected=running;selected.flash_chip=nullptr;assert(!lampRolloutRecoveryPreflight(pinned));selected=running;
 stateAvailable=false;assert(!lampRolloutRecoveryPreflight(pinned));stateAvailable=true;
 for(auto state:{ESP_OTA_IMG_PENDING_VERIFY,ESP_OTA_IMG_UNDEFINED}){imageState=state;assert(!lampRolloutRecoveryPreflight(pinned));}imageState=ESP_OTA_IMG_VALID;
 measuredAvailable=false;assert(!lampRolloutRecoveryPreflight(pinned));measuredAvailable=true;
 assert(!lampRolloutRecoveryPreflight(measured));FirmwareManifest misleading=measured;misleading.version[1]=16;assert(!lampRolloutRecoveryPreflight(misleading));
 control.mode=39;assert(!lampRolloutRecoveryPreflight(pinned));control.mode=4;control.brightness=0;assert(!lampRolloutRecoveryPreflight(pinned));
 std::cout<<"PASS production rollout recovery: idle/resource fencing, selected==running partition, VALID health, measured different digest, unavailable/unknown/pending/already-installed refusal\n";
}
'''
with tempfile.TemporaryDirectory(prefix='recovery-preflight-',dir=ROOT/'.build') as folder:
    folder=Path(folder);(folder/'Arduino.h').write_text((ROOT/'tests/sync-stubs/Arduino.h').read_text());cpp=folder/'test.cpp';cpp.write_text(fixture+function+test);binary=folder/'test.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,'-I'+str(folder),'-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True);subprocess.run([str(binary)],check=True)
