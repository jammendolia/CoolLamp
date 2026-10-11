"""Run production updater dispatch against retained RPC and loop-owned radios."""
from pathlib import Path
import re
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
#include <ctime>
#include <vector>
#include <iostream>
#include "LampUpdate.h"
#include "LampUpdateHandoff.h"
#include "LampUpdateHealth.h"
#include "LampUpdateControlPolicy.h"
#include "UpdateManifest.h"
#include "LampControl.h"
size_t responseBytes=0;unsigned responseFrees=0,ownedReleases=0,workerAllocations=0;
void* trackedMalloc(size_t size){assert(!responseBytes);responseBytes=size;return std::malloc(size);}
void trackedFree(void* pointer){
 if(pointer){const auto* bytes=static_cast<const uint8_t*>(pointer);for(size_t i=0;i<responseBytes;++i)assert(bytes[i]==0);
  ++responseFrees;responseBytes=0;std::free(pointer);}
}
#include "LampBleControlWire.h"
void releaseOwned(void* owner,size_t size){
 assert(owner&&size==8192&&responseBytes==size);
 LampBleControlWire::zero(owner,size);
 trackedFree(owner);++ownedReleases;
}
LampBleControlWire::Transfer rpc;
LampUpdateStatus status{};
bool cuePower=true;uint8_t cueBrightness=100;
LampControlState getLampControlState(){return {4,cueBrightness,cuePower};}
void setLampUpdateRoute(uint8_t route){status.route=route;}
LampUpdateHandoff handoff;
using TaskHandle_t=void*;
struct StaticTask_t {uint8_t opaque[348];}; // Exact pinned C3 ELF size, not host RTOS.
void* worker=nullptr;int mux=0;
std::atomic<bool> workerFinished{false};
bool taskCreateWorks=true,tlsLive=false;unsigned taskCreations=0,taskDeletes=0,tlsDestructs=0;
bool manual=false;
bool explicitRepair=false,attemptAllowed=true,measuredReady=false,attemptConfirmWorks=true;unsigned attemptConfirmCalls=0;
bool jobBackground=false,backgroundPriorAvailable=false,backgroundReadDeferred=false;
std::atomic<bool> backgroundActive{false},cancelBackground{false},backgroundDeferred{false};
bool controlIdle=true;size_t freeHeap=65536,largestHeap=65536;
constexpr unsigned MALLOC_CAP_8BIT=1;
size_t heap_caps_get_free_size(unsigned){return freeHeap;}
size_t heap_caps_get_largest_free_block(unsigned){return largestHeap;}
bool lampControlTrafficIdle(uint32_t){return controlIdle;}
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
void phase(uint8_t value,uint8_t error=UPDATE_OK){status.phase=value;status.error=error;}
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
void serviceLampUpdatePolicy(uint32_t){}
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
const void* esp_ota_get_running_partition(){return reinterpret_cast<void*>(1);}
int esp_ota_get_state_partition(const void*,esp_ota_img_states_t* out){*out=imageState;return ESP_OK;}
int esp_ota_mark_app_valid_cancel_rollback(){++confirmations;return confirmWorks?ESP_OK:-1;}
void xTaskNotifyGive(void* target){
 assert(target==worker);assert(!callerLive);assert(!audioActive);
 assert(!radioActive&&udpBytes==0&&responseBytes==0);
 assert(responseFrees==1&&ownedReleases<=1);
 assert(status.phase==UPDATE_CHECKING&&(job==1||job==2));++notifications;
 // Model a scheduler that immediately runs the HTTPS worker on notification.
 job=0;
}
constexpr int pdPASS=1;
int xTaskCreate(void(*function)(void*),const char*,size_t stack,void* argument,unsigned priority,void** out){
 assert(function&&!argument&&priority==1&&out==&worker&&!worker);
 assert(stack==8192&&!callerLive&&!audioActive&&!radioActive&&udpBytes==0&&responseBytes==0);
 ++taskCreations;
 if(!taskCreateWorks)return 0;
 assert(freeHeap>=stack+sizeof(StaticTask_t)&&largestHeap>=stack+sizeof(StaticTask_t));
 freeHeap-=stack+sizeof(StaticTask_t);largestHeap-=stack+sizeof(StaticTask_t);
 *out=reinterpret_cast<void*>(uintptr_t(taskCreations));return pdPASS;
}
void vTaskDelete(void* target){
 assert(target&&target!=worker&&workerFinished&&!tlsLive);
 ++taskDeletes;freeHeap+=8192+sizeof(StaticTask_t);largestHeap+=8192+sizeof(StaticTask_t);
}
constexpr int pdTRUE=1,portMAX_DELAY=-1;int pdMS_TO_TICKS(int ms){return ms;}
struct WorkerDone{};unsigned workerWaits=0;bool cancelInside=false,deferInside=false;
void ulTaskNotifyTake(int,int){if(workerWaits++){assert(workerFinished&&!tlsLive);throw WorkerDone{};}}
bool clockValid=true,cancelDuringClock=false;
void vTaskDelay(int ms){clockMs+=ms;if(cancelDuringClock)cancelBackground=true;}
std::time_t fixtureTime(void*){return clockValid?1700000001:0;}
unsigned checks=0,installs=0;bool checkWasBackground=false;uint32_t checkBudget=0;
struct TlsOwner {
 void* memory=nullptr;
 TlsOwner(){assert(!tlsLive&&!responseBytes&&!audioActive&&!radioActive);memory=std::malloc(16384);assert(memory);tlsLive=true;++workerAllocations;}
 ~TlsOwner(){std::free(memory);tlsLive=false;++tlsDestructs;}
};
bool checkRelease(bool installing=false,bool background=false,uint32_t budget=LampUpdateControlPolicy::BackgroundBudgetMs){
 TlsOwner tls;
 assert(!installing);++checks;checkWasBackground=background;checkBudget=budget;
 if(cancelInside)cancelBackground=true;
 if(background&&(cancelBackground.load()||deferInside)){backgroundReadDeferred=true;return false;}
 status.phase=status.available?UPDATE_AVAILABLE:UPDATE_IDLE;return true;
}
void installRelease(){TlsOwner tls;++installs;status.phase=UPDATE_RESTARTING;}
std::string origin;bool trigger=true;
void serviceLampNetwork(){
 if(trigger&&origin=="http"){callerLive=true;assert(requestLampUpdateCheck());callerLive=false;trigger=false;}
 if(lampUpdateOwnsResources()){udpBytes=0;radioActive=false;}
}
void serviceLampBluetooth(){
 if(trigger&&origin=="ble"){callerLive=true;assert(requestLampUpdateCheck());callerLive=false;trigger=false;}
 rpc.service(7,clockMs,true,lampUpdateOwnsResources());
}
void seedResponse(bool owned=false){
 using namespace LampBleControlWire;
 rpc.reset(7);const uint8_t begin[]={1,1,Begin,1,0,1,Read,0,0},commit[]={1,2,Commit,1,0};
 assert(rpc.begin(begin,sizeof(begin),7,clockMs)&&rpc.consume(commit,sizeof(commit),7,clockMs));
 if(owned){
  auto* bytes=static_cast<uint8_t*>(trackedMalloc(MaxResponse));memset(bytes,123,MaxResponse);
  assert(rpc.finishOwned(200,bytes,MaxResponse,bytes,releaseOwned));
 }else{
  std::vector<uint8_t> bytes(MaxResponse,123);assert(rpc.finish(200,bytes.data(),bytes.size()));
 }
 assert(responseBytes==8192&&responseFrees==0&&ownedReleases==0);
}
'''

TESTS = r'''
int main(int argc,char** argv){
 assert(argc==2);const std::string label=argv[1];origin=label;
 const bool owned=origin=="http-owned"||origin=="ble-owned"||origin=="automatic-owned";
 if(owned)origin.erase(origin.size()-6);
 seedResponse(owned);
 const auto runWorker=[&](uint8_t operation){
  assert(worker&&notifications);job=operation;workerWaits=0;
  try{updateTask(nullptr);}catch(const WorkerDone&){}
  assert(workerFinished&&!tlsLive&&job==0);
 };
 if(origin=="worker-lifecycle"||origin=="worker-install-reap"){
  trigger=false;nextCheck=clockMs+1000000;
  const auto idleFree=freeHeap,idleLargest=largestHeap;
  assert(!worker&&!taskCreations&&!workerFinished);
  for(unsigned i=0;i<10;++i){tick();getLampUpdateStatus();}assert(!taskCreations);
  if(origin=="worker-install-reap"){status.available=true;status.phase=UPDATE_AVAILABLE;}
  const uint8_t operation=origin=="worker-install-reap"?2:1;
  assert(request(operation));tick();assert(!worker&&!taskCreations);tick();
  assert(worker&&taskCreations==1&&freeHeap==idleFree-8192-sizeof(StaticTask_t));
  runWorker(operation);
  assert(taskDeletes==0&&tlsDestructs==1&&lampUpdateOwnsResources());
  // Status may already say Available/Idle/Error while the completed task's
  // handle is still valid. Every updater route must wait for loop-owned reap.
  assert(!requestLampUpdateCheck()&&!reserveLampManualUpdate()&&lampRemoteUpdateBusy());
  const auto completed=getLampUpdateStatus();(void)completed;assert(taskDeletes==0);
  tick();assert(!worker&&!workerFinished&&taskDeletes==1&&freeHeap==idleFree&&largestHeap==idleLargest);
  if(operation==2){assert(installs==1&&restartAt);clockMs=restartAt;tick();assert(ESP.restarts==1&&!worker);}
  else {
   assert(!lampUpdateOwnsResources()&&requestLampUpdateCheck());tick();tick();
   assert(taskCreations==2&&notifications==2);runWorker(1);tick();
   assert(taskDeletes==2&&checks==2&&tlsDestructs==2&&!worker&&freeHeap==idleFree);
  }
 }else if(origin=="worker-create-failure"||origin=="install-create-failure"){
  trigger=false;nextCheck=clockMs+1000000;taskCreateWorks=false;
  const auto idleFree=freeHeap;
  if(origin=="install-create-failure"){status.available=true;status.phase=UPDATE_AVAILABLE;}
  assert(request(origin=="install-create-failure"?2:1));tick();tick();
  assert(taskCreations==1&&!worker&&!notifications&&!job&&!backgroundActive&&!lampUpdateOwnsResources());
  assert(status.phase==UPDATE_ERROR&&status.error==UPDATE_MEMORY&&!checks&&!installs&&freeHeap==idleFree);
  taskCreateWorks=true;assert(requestLampUpdateCheck());tick();tick();runWorker(1);tick();
  assert(taskCreations==2&&taskDeletes==1&&checks==1&&!worker);
 }else if(origin=="background-late-memory"||origin=="background-late-largest"||origin=="background-exact-worker-budget"){
  trigger=false;nextCheck=clockMs+1000000;
  const size_t workerBytes=8192+sizeof(StaticTask_t);
  freeHeap=LampUpdateControlPolicy::MinBackgroundFree+workerBytes;
  largestHeap=LampUpdateControlPolicy::MinBackgroundLargest+workerBytes;
  assert(request(1,false,true));tick();
  if(origin=="background-late-memory")--freeHeap;
  if(origin=="background-late-largest")--largestHeap;
  tick();
  if(origin=="background-exact-worker-budget"){
   assert(taskCreations==1&&worker&&freeHeap==LampUpdateControlPolicy::MinBackgroundFree&&largestHeap==LampUpdateControlPolicy::MinBackgroundLargest);
   runWorker(1);tick();assert(taskDeletes==1&&!worker&&checks==1);
  }else{
   assert(!worker&&!taskCreations&&!notifications&&!job&&backgroundDeferred&&!backgroundActive);
   assert(status.phase==UPDATE_IDLE&&status.error==UPDATE_OK);
  }
 }else if(origin=="worker-cancel-before-tls"){
  trigger=false;nextCheck=clockMs+1000000;assert(request(1,false,true));tick();tick();
  cancelBackground=true;runWorker(1);
  assert(!checks&&!tlsDestructs&&backgroundDeferred&&status.phase==UPDATE_IDLE&&lampUpdateOwnsResources());
  controlIdle=false;tick();assert(taskDeletes==1&&!worker&&taskCreations==1);
 }else if(origin=="manual-receiver-no-worker"){
  trigger=false;nextCheck=clockMs+1000000;
  assert(beginLampBluetoothUpdate()&&manual);tick();tick();assert(!worker&&!taskCreations&&!requestLampUpdateCheck());
  finishLampBluetoothUpdate(false,true);tick();assert(!worker&&!taskCreations&&!lampUpdateOwnsResources());
 }else if(origin=="http"||origin=="ble"){
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
  worker=reinterpret_cast<void*>(1);assert(!requestLampUpdateCheck());worker=nullptr;
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
 }else if(origin=="background-defer"){
  trigger=false;const auto pending=nextCheck;controlIdle=false;
  tick();assert(nextCheck==pending&&!job&&!audioStops&&status.phase==UPDATE_IDLE);
  const size_t workerBytes=8192+sizeof(StaticTask_t);
  controlIdle=true;freeHeap=LampUpdateControlPolicy::MinBackgroundFree+workerBytes-1;tick();assert(nextCheck==pending&&!job&&!audioStops);
  freeHeap=LampUpdateControlPolicy::MinBackgroundFree+workerBytes;largestHeap=LampUpdateControlPolicy::MinBackgroundLargest+workerBytes-1;tick();assert(nextCheck==pending&&!job&&!audioStops);
  largestHeap=LampUpdateControlPolicy::MinBackgroundLargest+workerBytes;tick();assert(job==1&&jobBackground&&backgroundActive&&audioStops==1);
  // Recent traffic fences the queued check before its worker owns TLS.
  controlIdle=false;tick();assert(cancelBackground&&backgroundActive);tick();assert(!notifications&&!taskCreations&&!worker);
  assert(!backgroundActive&&backgroundDeferred&&status.phase==UPDATE_IDLE&&status.error==UPDATE_OK&&!checks);
  tick();assert(nextCheck==clockMs&&!job&&status.phase==UPDATE_IDLE);
 }else if(origin=="background-cancel"||origin=="background-memory"||origin=="manual-noncancel"||origin=="install-noncancel"){
  trigger=false;nextCheck=clockMs+60000;status.available=true;status.phase=UPDATE_AVAILABLE;
  const bool background=origin=="background-cancel"||origin=="background-memory";
  assert(request(origin=="install-noncancel"?2:1,false,background));
  tick();tick();assert(worker&&notifications==1);job=origin=="install-noncancel"?2:1;
  cancelInside=origin=="background-cancel"||origin=="manual-noncancel";
  deferInside=origin=="background-memory";if(origin=="install-noncancel")cancelBackground=true;
  try{updateTask(nullptr);}catch(const WorkerDone&){}
  if(background){assert(!backgroundActive&&backgroundDeferred&&status.phase==UPDATE_AVAILABLE&&status.error==UPDATE_OK&&checks==1&&checkWasBackground&&checkBudget==6000);}
  else if(origin=="manual-noncancel"){assert(!backgroundDeferred&&status.phase==UPDATE_AVAILABLE&&checks==1&&!checkWasBackground);}
  else assert(!backgroundDeferred&&installs==1&&status.phase==UPDATE_RESTARTING);
 }else if(origin=="background-offline"||origin=="background-clock"||origin=="background-clock-cancel"){
  trigger=false;nextCheck=clockMs+60000;assert(request(1,false,true));
  tick();tick();assert(worker&&notifications==1);job=1;
  const auto started=clockMs;
  if(origin=="background-offline")WiFi.state=0;
  else{clockValid=false;cancelDuringClock=origin=="background-clock-cancel";}
  try{updateTask(nullptr);}catch(const WorkerDone&){}
  assert(!backgroundActive&&!checks);
  if(origin=="background-clock-cancel")assert(backgroundDeferred&&status.phase==UPDATE_IDLE&&status.error==UPDATE_OK&&clockMs-started==100);
  else assert(!backgroundDeferred&&status.phase==UPDATE_ERROR&&status.error==(origin=="background-offline"?UPDATE_OFFLINE:UPDATE_CLOCK)&&clockMs-started==(origin=="background-offline"?0:6000));
 }else if(origin=="automatic-install-control"){
  trigger=false;nextCheck=clockMs+60000;status.phase=UPDATE_AVAILABLE;status.available=true;status.automatic=true;
  status.latest[0]=1;status.latest[1]=10;status.latest[2]=2;controlIdle=false;
  tick();tick();assert(!job&&!audioStops&&!rolloutStarts&&status.phase==UPDATE_AVAILABLE);
  controlIdle=true;tick();assert(job==2&&audioStops==1&&rolloutStarts==1&&!jobBackground);
  // Once admitted, new traffic cannot cancel installation or select another route.
  controlIdle=false;tick();tick();assert(!cancelBackground&&notifications==1);job=2;
  try{updateTask(nullptr);}catch(const WorkerDone&){}
  assert(installs==1&&status.phase==UPDATE_RESTARTING&&!backgroundDeferred);
 }else assert(false);
 rpc.reset();
 assert(responseBytes==0&&responseFrees==1&&ownedReleases==unsigned(owned));
  assert(workerAllocations<=notifications&&tlsDestructs==workerAllocations&&!tlsLive);
 std::cout<<"PASS: updater handoff "<<label<<"\n";
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
        worker = source[source.index('void updateTask(void*)'):source.index('bool request(uint8_t operation')]
        initialization=source[source.index('void beginLampUpdater()'):source.index('LampUpdateStatus getLampUpdateStatus()')]
        self.assertNotIn('xTaskCreate', initialization)
        # Use the actual production loop ordering. The handoff depends on these
        # resource owners running before serviceLampUpdater; changing that order
        # must fail this regression rather than silently weaken the guarantee.
        loop = (ROOT/'CoolLamp.ino').read_text()
        sequence = loop[loop.index('  serviceLampNetwork();',loop.index('void loop()')):loop.index('  serviceLampFactoryReset();',loop.index('void loop()'))]
        # Timing instrumentation can surround the real owning service calls;
        # preserve their exact order and multiplicity in the production loop.
        calls = re.findall(r'(?:serviceLampNetwork|serviceLampBluetooth|LampRollout::service|serviceLampUpdater)\([^;]*?\);', sequence)
        self.assertEqual(calls, ['serviceLampNetwork();','serviceLampBluetooth();','LampRollout::service(millis());','serviceLampUpdater();'])
        sequence = '\n'.join(calls)
        with tempfile.TemporaryDirectory(prefix='lamp-update-handoff-') as directory:
            directory = Path(directory)
            (directory/'Arduino.h').write_text(ARDUINO)
            # Intercept only the production Transfer's two allocator calls in
            # a test-local copy. malloc/free preprocessor macros also rewrite
            # libstdc++'s C compatibility wrappers on Linux, even if cstdlib
            # was included earlier; no system declarations should be changed.
            wire = (ROOT/'LampBleControlWire.h').read_text()
            self.assertEqual(wire.count('malloc(size)'),1)
            # Keep a semantic check on the real compatibility owner: its
            # release callback must wipe before freeing, and the hook must
            # still cover exactly one production allocation/free site.
            release = wire[wire.index('static void releaseCopied('):wire.index('bool finishPayload(')]
            self.assertIn('zero(bytes,size);free(bytes);', release)
            self.assertEqual(wire.count('free(bytes)'),1)
            (directory/'LampBleControlWire.h').write_text(
                wire.replace('malloc(size)','trackedMalloc(size)').replace('free(bytes)','trackedFree(bytes)'))
            cpp, binary = directory/'test.cpp', directory/'test'
            cpp.write_text(FIXTURE+cue+'\n#define time fixtureTime\n'+worker+'\n#undef time\n'+request+public+ownership+service+'\nvoid tick(){\n'+sequence+'}\n'+TESTS)
            subprocess.run(['c++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,
                            '-I'+str(directory),'-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True)
            for scenario in ('http','ble','automatic','install','guards','audio-failure',
                             'manual-exclusion','commission-exclusion','health','automatic-install','attempt-quarantine','attempt-health','group-unassigned','group-legacy','rollout-denied','rollout-storage','same-version-no-retry',
                             'error-backoff','restart','background-defer','background-cancel','background-memory','manual-noncancel','install-noncancel',
                             'background-offline','background-clock','background-clock-cancel','automatic-install-control',
                             'http-owned','ble-owned','automatic-owned',
                             'worker-lifecycle','worker-install-reap','worker-create-failure','install-create-failure',
                             'background-late-memory','background-late-largest','background-exact-worker-budget',
                             'worker-cancel-before-tls','manual-receiver-no-worker'):
                subprocess.run([str(binary),scenario],check=True)


if __name__=='__main__':
    unittest.main()
