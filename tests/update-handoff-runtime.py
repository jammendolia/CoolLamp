"""Run production updater dispatch against retained RPC and loop-owned radios."""
from pathlib import Path
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]

ARDUINO = r'''
#pragma once
#include <cstdint>
#include <string>
using String=std::string;
'''

FIXTURE = r'''
#include <cassert>
#include <cstdlib>
#include <cstring>
#include <atomic>
#include <vector>
#include <iostream>
#include "LampUpdate.h"
#include "LampUpdateHandoff.h"
#include "LampUpdateHealth.h"
#include "UpdateManifest.h"
#include "LampControl.h"
size_t responseBytes=0;unsigned responseFrees=0;
void* trackedMalloc(size_t size){assert(!responseBytes);responseBytes=size;return std::malloc(size);}
void trackedFree(void* pointer){
 if(pointer){const auto* bytes=static_cast<const uint8_t*>(pointer);for(size_t i=0;i<responseBytes;++i)assert(bytes[i]==0);
  ++responseFrees;responseBytes=0;std::free(pointer);}
}
#include "LampBleControlWire.h"
LampBleControlWire::Transfer rpc;
LampUpdateStatus status{};
bool cuePower=true;uint8_t cueBrightness=100;
LampControlState getLampControlState(){return {4,cueBrightness,cuePower};}
void setLampUpdateRoute(uint8_t route){status.route=route;}
LampUpdateHandoff handoff;
void* worker=reinterpret_cast<void*>(1);int mux=0;
bool manual=false;
bool explicitRepair=false,attemptAllowed=true,measuredReady=false,attemptConfirmWorks=true;unsigned attemptConfirmCalls=0;
namespace LampUpdateAttempt {bool automaticAllowed(const FirmwareManifest&){return attemptAllowed;}bool confirmHealthy(const FirmwareManifest&){++attemptConfirmCalls;return attemptConfirmWorks;}}
namespace LampFirmwareRelay {bool runningManifest(FirmwareManifest& out){out.size=512;return measuredReady;}}
bool automaticAdmission=true;
bool lampAutomaticUpdateAllowed(){return status.automatic&&automaticAdmission;}
FirmwareManifest candidate{};
bool rolloutAllowed=true,rolloutStorage=true;unsigned rolloutStarts=0;
bool lampRolloutAllowsAutomaticUpdate(const FirmwareManifest&){return rolloutAllowed;}
bool lampRolloutAutomaticUpdateStarted(const FirmwareManifest&){assert(status.phase==UPDATE_CHECKING);++rolloutStarts;return rolloutStorage;}
uint8_t job=0;
std::atomic<bool> healthy{true};
LampUpdateHealth bootHealth;
uint32_t nextCheck=0,restartAt=0;
char attemptedVersion[24]{};
#define portENTER_CRITICAL(pointer) ((void)(pointer))
#define portEXIT_CRITICAL(pointer) ((void)(pointer))
bool busy(uint8_t p){return p==UPDATE_CHECKING||p==UPDATE_DOWNLOADING||p==UPDATE_RESTARTING;}
void fail(uint8_t error){status.phase=UPDATE_ERROR;status.error=error;}
String versionText(const uint16_t* v){return std::to_string(v[0])+"."+std::to_string(v[1])+"."+std::to_string(v[2]);}
uint32_t clockMs=100000;uint32_t millis(){return clockMs;}
uint32_t esp_random(){return 0;}
constexpr int WL_CONNECTED=3;
struct {int state=WL_CONNECTED;int status(){return state;}} WiFi;
struct {unsigned restarts=0;void restart(){++restarts;}} ESP;
bool wifiBusy=false,resetPending=false,resetArmed=false,audioStopWorks=true,audioActive=true;
bool commissionBusy=false;
namespace LampCommission {bool working(){return commissionBusy;}}
namespace LampRollout {void service(uint32_t){}}
bool radioActive=true,callerLive=false;
size_t udpBytes=1460;
unsigned audioStops=0,notifications=0;
bool lampWifiSetupBusy(){return wifiBusy;}
bool lampFactoryResetPending(){return resetPending;}
bool lampFactoryResetArmed(){return resetArmed;}
bool stopLampAudio(){++audioStops;if(!audioStopWorks)return false;audioActive=false;return true;}
bool beginLampBluetoothUpdateRadio(){return true;}
void finishLampBluetoothUpdateRadio(bool){}
enum esp_ota_img_states_t {ESP_OTA_IMG_VALID,ESP_OTA_IMG_PENDING_VERIFY};
constexpr int ESP_OK=0;
esp_ota_img_states_t imageState=ESP_OTA_IMG_VALID;bool confirmWorks=true;unsigned confirmations=0;
const void* esp_ota_get_running_partition(){return worker;}
int esp_ota_get_state_partition(const void*,esp_ota_img_states_t* out){*out=imageState;return ESP_OK;}
int esp_ota_mark_app_valid_cancel_rollback(){++confirmations;return confirmWorks?ESP_OK:-1;}
void xTaskNotifyGive(void* target){
 assert(target==worker);assert(!callerLive);assert(!audioActive);
 assert(!radioActive&&udpBytes==0&&responseBytes==0);
 assert(status.phase==UPDATE_CHECKING&&(job==1||job==2));++notifications;
 // Model a scheduler that immediately runs the HTTPS worker on notification.
 job=0;
}
std::string origin;bool trigger=true;
void serviceLampNetwork(){
 if(trigger&&origin=="http"){callerLive=true;assert(requestLampUpdateCheck());callerLive=false;trigger=false;}
 if(lampUpdateOwnsResources()){udpBytes=0;radioActive=false;}
}
void serviceLampBluetooth(){
 if(trigger&&origin=="ble"){callerLive=true;assert(requestLampUpdateCheck());callerLive=false;trigger=false;}
 rpc.service(7,clockMs,true,lampUpdateOwnsResources());
}
void seedResponse(){
 using namespace LampBleControlWire;
 rpc.reset(7);const uint8_t begin[]={1,1,Begin,1,0,1,Read,0,0},commit[]={1,2,Commit,1,0};
 assert(rpc.begin(begin,sizeof(begin),7,clockMs)&&rpc.consume(commit,sizeof(commit),7,clockMs));
 std::vector<uint8_t> bytes(MaxResponse,123);assert(rpc.finish(200,bytes.data(),bytes.size()));assert(responseBytes==8192);
}
'''

TESTS = r'''
int main(int argc,char** argv){
 assert(argc==2);origin=argv[1];seedResponse();
 if(origin=="http"||origin=="ble"){
  nextCheck=clockMs+60000;tick();assert(notifications==0&&audioStops==1&&responseFrees==1);
  assert(!requestLampUpdateCheck()&&!requestLampUpdateInstall()); // reservation excludes duplicates before dispatch
  tick();assert(notifications==1&&job==0);tick();assert(notifications==1);
  // Cleanup preserves consumed-once transaction history across the same connection.
  const uint8_t duplicate[]={1,1,LampBleControlWire::Begin,1,0,1,LampBleControlWire::Read,0,0};
  assert(!rpc.begin(duplicate,sizeof(duplicate),7,clockMs));
 }else if(origin=="automatic"){
  tick();assert(notifications==0&&job==1&&audioStops==1&&responseBytes==8192);
  tick();assert(notifications==0&&responseFrees==1&&!radioActive);
  tick();assert(notifications==1);tick();assert(notifications==1);
 }else if(origin=="install"){
  trigger=false;nextCheck=clockMs+60000;status.phase=UPDATE_AVAILABLE;status.available=true;
  assert(requestLampUpdateInstall()&&job==2&&notifications==0);tick();assert(!notifications);tick();assert(notifications==1);
 }else if(origin=="guards"){
  worker=nullptr;assert(!requestLampUpdateCheck());worker=reinterpret_cast<void*>(1);
  healthy=false;assert(!requestLampUpdateCheck());healthy=true;
  for(bool* guard:{&wifiBusy,&resetPending,&resetArmed,&manual,&commissionBusy}){*guard=true;assert(!requestLampUpdateCheck());*guard=false;}
  for(uint8_t p:{uint8_t(UPDATE_CHECKING),uint8_t(UPDATE_DOWNLOADING),uint8_t(UPDATE_RESTARTING)}){status.phase=p;assert(!requestLampUpdateCheck());}
  status.phase=UPDATE_IDLE;job=1;assert(!requestLampUpdateCheck());job=0;
  assert(!requestLampUpdateInstall());assert(!notifications&&!audioStops&&responseBytes==8192);
 }else if(origin=="audio-failure"){
  trigger=false;nextCheck=clockMs+60000;audioStopWorks=false;
  assert(!requestLampUpdateCheck()&&status.phase==UPDATE_ERROR&&status.error==UPDATE_MEMORY&&job==0);
  tick();tick();assert(!notifications);
  audioStopWorks=true;assert(requestLampUpdateCheck());tick();tick();assert(notifications==1);
 }else if(origin=="manual-exclusion"){
  trigger=false;nextCheck=clockMs+60000;assert(reserveLampManualUpdate()&&manual);
  assert(!requestLampUpdateCheck());assert(!reserveLampManualUpdate());
  releaseLampManualUpdate();assert(requestLampUpdateCheck());assert(!reserveLampManualUpdate());
  tick();tick();assert(notifications==1);
 }else if(origin=="commission-exclusion"){
  trigger=false;nextCheck=clockMs;commissionBusy=true;status.available=true;status.automatic=true;
  assert(!requestLampUpdateCheck()&&!requestLampUpdateInstall()&&!reserveLampManualUpdate());
  tick();tick();assert(!notifications&&!job&&!manual&&!audioStops&&responseBytes==8192);
  // Releasing commissioning allows exactly one ordinary reservation/handoff;
  // a denied request cannot have stolen another owner's Wi-Fi freeze or DMA.
  commissionBusy=false;nextCheck=clockMs+60000;status.automatic=false;
  assert(reserveLampManualUpdate()&&manual&&audioStops==1);releaseLampManualUpdate();
  assert(requestLampUpdateCheck()&&job==1);tick();tick();assert(notifications==1);
 }else if(origin=="health"){
  trigger=false;nextCheck=clockMs+60000;healthy=false;clockMs=0;bootHealth.begin(clockMs);imageState=ESP_OTA_IMG_PENDING_VERIFY;
  for(clockMs=0;clockMs<30000;clockMs+=100){serviceLampUpdater();}assert(!healthy&&!confirmations&&!notifications);
  clockMs=30000;confirmWorks=false;serviceLampUpdater();assert(!healthy&&confirmations==1);
  confirmWorks=true;serviceLampUpdater();assert(healthy&&confirmations==2);assert(requestLampUpdateCheck());tick();tick();assert(notifications==1);
 }else if(origin=="automatic-install"){
  trigger=false;nextCheck=clockMs+60000;status.phase=UPDATE_AVAILABLE;status.available=true;status.automatic=true;
  status.latest[0]=1;status.latest[1]=10;status.latest[2]=2;
  tick();assert(job==2&&!notifications);tick();assert(!notifications);tick();assert(notifications==1);
 }else if(origin=="attempt-health"){
  trigger=false;nextCheck=clockMs+1000000;measuredReady=true;attemptConfirmWorks=false;
  tick();assert(attemptConfirmCalls==1);
  for(unsigned i=0;i<100;++i){clockMs+=100;tick();}assert(attemptConfirmCalls==1);
  clockMs=159999;tick();assert(attemptConfirmCalls==1);clockMs=160000;tick();assert(attemptConfirmCalls==2);
  imageState=ESP_OTA_IMG_PENDING_VERIFY;clockMs=220000;tick();assert(attemptConfirmCalls==2);
 }else if(origin=="attempt-quarantine"){
  trigger=false;nextCheck=clockMs+60000;status.phase=UPDATE_AVAILABLE;status.available=true;status.automatic=true;attemptAllowed=false;
  status.latest[0]=1;status.latest[1]=10;status.latest[2]=2;
  tick();tick();assert(!notifications&&!job&&!audioStops&&!rolloutStarts);
  assert(requestLampUpdateInstall()&&job==2&&explicitRepair);tick();tick();assert(notifications==1);
 }else if(origin=="group-unassigned"||origin=="group-legacy"){
  trigger=false;nextCheck=clockMs+60000;status.phase=UPDATE_AVAILABLE;status.available=true;status.automatic=true;automaticAdmission=false;
  status.latest[0]=1;status.latest[1]=10;status.latest[2]=2;
  tick();tick();assert(!notifications&&!job&&!audioStops&&!rolloutStarts);
  // An explicit Update now remains possible outside an armed ticket. It still
  // must pass the exact-artifact and durable Started fences when one exists.
  assert(requestLampUpdateInstall()&&job==2&&rolloutStarts==1);tick();tick();assert(notifications==1);
 }else if(origin=="rollout-denied"||origin=="rollout-storage"){
  trigger=false;nextCheck=clockMs+60000;status.phase=UPDATE_AVAILABLE;status.available=true;status.automatic=true;
  status.latest[0]=1;status.latest[1]=10;status.latest[2]=2;
  if(origin=="rollout-denied")rolloutAllowed=false;else rolloutStorage=false;
  tick();tick();assert(!notifications&&!job);
  if(origin=="rollout-denied")assert(!audioStops&&!rolloutStarts);else assert(audioStops==1&&rolloutStarts==1&&status.error==UPDATE_STORAGE);
 }else if(origin=="same-version-no-retry"){
  trigger=false;nextCheck=clockMs+60000;status.phase=UPDATE_AVAILABLE;status.available=true;status.automatic=true;
  status.latest[0]=1;status.latest[1]=10;status.latest[2]=2;strcpy(attemptedVersion,"1.10.2");
  tick();tick();assert(!notifications&&!job&&!audioStops);
 }else if(origin=="error-backoff"){
  trigger=false;status.phase=UPDATE_ERROR;status.error=UPDATE_NETWORK;
  tick();assert(nextCheck==clockMs+15UL*60*1000&&!job&&!notifications);
 }else if(origin=="restart"){
  trigger=false;status.phase=UPDATE_RESTARTING;tick();assert(restartAt==clockMs+2000&&!notifications);
  clockMs=restartAt-1;tick();assert(!ESP.restarts);clockMs=restartAt;tick();assert(ESP.restarts==1&&!notifications);
 }else assert(false);
 rpc.reset();std::cout<<"PASS: updater handoff "<<origin<<"\n";
}
'''


class UpdateHandoffTests(unittest.TestCase):
    def test_actual_request_and_service_order(self):
        source = (ROOT/'LampUpdate.cpp').read_text()
        request = source[source.index('bool request(uint8_t operation'):source.index('} // namespace')]
        cue=source[source.index('void startReceiverCue()'):source.index('void fail(uint8_t error)')]
        public = source[source.index('LampUpdateStatus getLampUpdateStatus()'):source.index('bool setLampAutoUpdate')]
        ownership = source[source.index('bool lampRemoteUpdateBusy()'):source.index('void serviceLampUpdater()')]
        service = source[source.index('void serviceLampUpdater()'):source.index('void getLampUpdatePacket(')]
        # Use the actual production loop ordering. The handoff depends on these
        # resource owners running before serviceLampUpdater; changing that order
        # must fail this regression rather than silently weaken the guarantee.
        loop = (ROOT/'CoolLamp.ino').read_text()
        sequence = loop[loop.index('  serviceLampNetwork();',loop.index('void loop()')):loop.index('  serviceLampFactoryReset();',loop.index('void loop()'))]
        self.assertEqual(sequence.split(), ['serviceLampNetwork();','serviceLampBluetooth();','LampRollout::service(millis());','serviceLampUpdater();'])
        with tempfile.TemporaryDirectory(prefix='lamp-update-handoff-') as directory:
            directory = Path(directory)
            (directory/'Arduino.h').write_text(ARDUINO)
            # Intercept only the production Transfer's two allocator calls in
            # a test-local copy. malloc/free preprocessor macros also rewrite
            # libstdc++'s C compatibility wrappers on Linux, even if cstdlib
            # was included earlier; no system declarations should be changed.
            wire = (ROOT/'LampBleControlWire.h').read_text()
            self.assertEqual(wire.count('malloc(size)'),1)
            self.assertEqual(wire.count('free(response)'),1)
            (directory/'LampBleControlWire.h').write_text(
                wire.replace('malloc(size)','trackedMalloc(size)').replace('free(response)','trackedFree(response)'))
            cpp, binary = directory/'test.cpp', directory/'test'
            cpp.write_text(FIXTURE+cue+request+public+ownership+service+'\nvoid tick(){\n'+sequence+'}\n'+TESTS)
            subprocess.run(['c++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,
                            '-I'+str(directory),'-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True)
            for scenario in ('http','ble','automatic','install','guards','audio-failure',
                             'manual-exclusion','commission-exclusion','health','automatic-install','attempt-quarantine','attempt-health','group-unassigned','group-legacy','rollout-denied','rollout-storage','same-version-no-retry',
                             'error-backoff','restart'):
                subprocess.run([str(binary),scenario],check=True)


if __name__=='__main__':
    unittest.main()
