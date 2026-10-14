"""Exercise actual bridge runtime cache/Wi-Fi/button helpers with stateful SDK mocks."""
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
runtime = (ROOT / 'bridge/BridgeRuntime.cpp').read_text(encoding='utf-8')


def function(name):
    """Extract the production definition, skipping braces in strings/comments."""
    found = re.search(r'^(?:bool|void|String|uint\d+_t)\s+' + re.escape(name) + r'\([^\n]*?\)\s*\{', runtime, re.M)
    if found is None:
        raise ValueError('Missing production helper: ' + name)
    opening = runtime.index('{', found.start())
    at, depth, quote = opening + 1, 1, None
    while depth:
        char = runtime[at]
        if quote:
            if char == '\\':
                at += 2
                continue
            if char == quote:
                quote = None
        elif runtime.startswith('//', at):
            at = runtime.index('\n', at)
            continue
        elif runtime.startswith('/*', at):
            at = runtime.index('*/', at) + 2
            continue
        elif char in ('"', "'"):
            quote = char
        elif char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
        at += 1
    return runtime[found.start():at]


definitions = '\n'.join(re.search(r'^struct ' + name + r' .*;', runtime, re.M).group(0)
                        for name in ('LegacyConfig', 'Config', 'CacheRecord'))
helpers = '\n'.join(function(name) for name in (
    'wipe', 'crc', 'busy', 'saveConfig', 'loadConfig', 'readCache', 'nextCacheBank',
    'persistCache', 'beginArtifact', 'restoreCache', 'startCache', 'loadCache',
    'serviceCache', 'stageWifi', 'serviceWifi', 'buttonService', 'authorized',
    'choosePassword', 'servicePassword', 'ownerWifiStatus'))
# The production diagnostic snapshot must stay usable over USB and fleet reads
# without exporting the browser's mutation token or saved credentials.
diagnostic = function('status')
assert all(secret not in diagnostic for secret in ('lampToken', 'config.password', 'config.access', 'config.fleet'))
assert 'WiFi.SSID' not in diagnostic and 'WiFi.RSSI' not in diagnostic
assert 'lampToken' in function('browserStatus')
assert 'ownerWifiStatus' in function('browserStatus')
arduino = (ROOT / 'tests/sync-stubs/Arduino.h').read_text().replace(
    '  using std::string::string;', '  using std::string::string;\n'
    '  bool isEmpty()const{return empty();}\n'
    '  void toCharArray(char* out,size_t n)const{if(n){const size_t take=size()<n-1?size():n-1;memcpy(out,data(),take);out[take]=0;}}')
fixture = r'''
#include "Arduino.h"
#include "bridge/BridgeArtifact.h"
#include "LampJsonSink.h"
#include <algorithm>
#include <atomic>
#include <cassert>
#include <cstddef>
#include <iostream>
#include <map>
#include <vector>
#include <time.h>
using std::min;
constexpr uint32_t CacheDataOffset=4096,CacheBankSpan=0x1f1000,WifiDeadline=30000;
constexpr unsigned UserButton=0;
enum Job:uint8_t {Idle,Checking,Downloading,Validating,Ready,Failed};
__DEFINITIONS__
Config config,pendingConfig;CacheRecord cacheRecord,workerRecord;
String lampToken;
struct OwnerServer {
 bool validAuth=false;
 unsigned challenges=0,denied=0,setupRequired=0;
 String suppliedToken;
 bool authenticate(const char* name,const char* password){assert((String(name)=="owner"||String(name)=="OWNER")&&password==config.access);return validAuth;}
 String header(const String& name)const{assert(name=="X-Lamp-Token");return suppliedToken;}
 void requestAuthentication(){++challenges;}
 void send(unsigned code,const char* type,const char*){assert((code==403||code==409)&&String(type)=="text/plain");if(code==409)++setupRequired;else ++denied;}
} server;
BridgeArtifact::Artifact artifact;
struct Donor {
 bool active=false;
 unsigned binds=0,cancels=0;
 bool sending()const{return active;}
 void cancel(){active=false;artifact.release();++cancels;}
 bool setArtifact(BridgeArtifact::Artifact*){++binds;return true;}
} donor;
bool accessPoint=false,wifiPending=false,wifiStarted=false,cacheDurable=false,commissionRadio=false;
bool configStorageFault=false,configWriteUncertain=false;
bool cacheCommitted=false,cacheReusable=false,cacheWriteUncertain=false,validatingCommitted=false,restoringCache=false;
bool buttonDown=false,buttonSuppressed=false,buttonApproval=false;
uint32_t buttonAt=0,buttonChanged=0,wifiAt=0,nextCacheCheck=0,wifiGenerationAt=0;
std::atomic<uint32_t> wifiIpGeneration{0};
std::atomic<uint8_t> job{Idle};
std::atomic<uint32_t> downloaded{0},downloadTotal{0};
std::atomic<bool> workerDone{false},cancelDownload{false};
using TaskHandle_t=void*;
TaskHandle_t downloadTask=nullptr;
char workerError[48]{},cacheError[48]{},wifiResult[40]="not-requested";
bool workerSuccess=false;
bool preferenceOpenFail=false,preferenceWriteOpenFail=false,preferenceReadFail=false,preferenceFailBefore=false,preferenceFailAfter=false;
unsigned preferenceWrites=0;
std::map<std::string,std::vector<uint8_t>> preferences;
constexpr int ESP_OK=0,NVS_READONLY=0,ESP_ERR_NVS_NOT_FOUND=1;
using nvs_handle_t=uintptr_t;
int namespaceOpenResult=ESP_OK;
unsigned namespaceOpens=0,namespaceCloses=0;
int nvs_open(const char* name,int mode,nvs_handle_t* handle){assert(std::string(name)=="bridgecfg"&&mode==NVS_READONLY);++namespaceOpens;if(namespaceOpenResult==ESP_OK)*handle=17;return namespaceOpenResult;}
void nvs_close(nvs_handle_t handle){assert(handle==17);++namespaceCloses;}
struct Preferences {
 std::string ns;
 bool begin(const char* value,bool readOnly){ns=value;return !preferenceOpenFail&&(readOnly||!preferenceWriteOpenFail);}
 void end(){}
 std::string key(const char* name)const{return ns+":"+name;}
 bool isKey(const char* name){return preferences.count(key(name))!=0;}
 size_t putBytes(const char* name,const void* data,size_t n){++preferenceWrites;if(preferenceFailBefore)return 0;const auto* bytes=static_cast<const uint8_t*>(data);preferences[key(name)]={bytes,bytes+n};return preferenceFailAfter?0:n;}
 size_t getBytesLength(const char* name){const auto found=preferences.find(key(name));return found==preferences.end()?0:found->second.size();}
 size_t getBytes(const char* name,void* out,size_t n){const auto found=preferences.find(key(name));if(preferenceReadFail||found==preferences.end()||found->second.size()!=n)return 0;memcpy(out,found->second.data(),n);return n;}
};
struct esp_partition_t {uint32_t size=0x3f0000;};
esp_partition_t partition;
const esp_partition_t* cachePartition=&partition;
std::vector<uint8_t> flash(partition.size,0xff);
unsigned flashReads=0;
int esp_partition_read(const esp_partition_t* part,uint32_t at,void* out,size_t n){++flashReads;if(at>part->size||n>part->size-at||at>flash.size()||n>flash.size()-at)return -1;memcpy(out,flash.data()+at,n);return 0;}
namespace LampCommission {bool pending=false,workingFlag=false;unsigned approvals=0;bool physicalPending(){return pending;}bool working(){return workingFlag;}void approvePhysical(){++approvals;}}
namespace BridgeControl {bool workingFlag=false;bool working(){return workingFlag;}}
namespace BridgeWifiScan {bool scanningFlag=false;bool scanning(){return scanningFlag;}bool working(){return scanningFlag;}}
bool secureApPending=false;
uint32_t secureApAt=0;
std::vector<bool> apTransitions;
constexpr int LOW=0,WL_CONNECTED=3;
bool physicalDown=false;
int digitalRead(unsigned pin){assert(pin==UserButton);return physicalDown?LOW:1;}
void setAp(bool on){accessPoint=on;apTransitions.push_back(on);}
struct WiFiMock {
 int state=WL_CONNECTED;
 uint32_t address=0x01010101;
 String connectedSsid="old",lastBegin;
 int32_t signal=-55;
 unsigned begins=0,disconnects=0;
 int status()const{return state;}
 uint32_t localIP()const{return address;}
 String SSID()const{return connectedSsid;}
 int32_t RSSI()const{return signal;}
 void begin(const char* ssid,const char*){++begins;lastBegin=ssid;}
 void disconnect(bool,bool){++disconnects;state=0;address=0;}
} WiFi;
void configTime(int,int,const char*,const char*){}
bool taskCreation=true;
unsigned taskDeletes=0;
constexpr int pdPASS=1;
void worker(void*){}
int xTaskCreate(void(*)(void*),const char*,unsigned,void*,unsigned,TaskHandle_t* handle){if(!taskCreation)return 0;*handle=reinterpret_cast<void*>(1);return pdPASS;}
void vTaskDelete(TaskHandle_t){++taskDeletes;}
time_t bridgeTestTime(time_t*){return 1800000000;}
#define time bridgeTestTime
__HELPERS__
#undef time

std::vector<uint8_t> image(unsigned patch){
 std::vector<uint8_t> bytes(65584);bytes[0]=0xe9;bytes[1]=1;bytes[12]=5;bytes[23]=1;
 bytes[28]=0xe0;bytes[29]=0xff;bytes[32]=0x32;bytes[33]=0x54;bytes[34]=0xcd;bytes[35]=0xab;
 char marker[64];snprintf(marker,sizeof(marker),"COOLLAMP-PUBLIC-1.15.%u",patch);memcpy(bytes.data()+507,marker,strlen(marker)+1);return bytes;
}
CacheRecord record(unsigned bank,unsigned patch){
 auto bytes=image(patch);const uint32_t base=CacheDataOffset+bank*CacheBankSpan;std::copy(bytes.begin(),bytes.end(),flash.begin()+base);
 uint8_t hash[32];assert(mbedtls_sha256(bytes.data(),bytes.size(),hash,0)==0);char digest[65]{};for(unsigned i=0;i<32;++i)snprintf(digest+2*i,3,"%02x",hash[i]);
 CacheRecord value;value.reserved=uint16_t(bank);const int n=snprintf(value.original,sizeof(value.original),"COOLLAMP-OTA-1\n1.15.%u\nesp32c3\ndual-ota-2031616\n65584\n%s\n",patch,digest);assert(n>0);value.length=uint16_t(n);value.checksum=crc(&value,offsetof(CacheRecord,checksum));return value;
}
void reset(){
 donor.cancel();assert(artifact.clear());donor={};config={};config.ownerPasswordSet=1;strcpy(config.access,"ABCDEFGHIJKLMNOP");pendingConfig={};cacheRecord={};workerRecord={};preferences.clear();preferenceOpenFail=preferenceWriteOpenFail=preferenceReadFail=preferenceFailBefore=preferenceFailAfter=false;preferenceWrites=0;
 configStorageFault=configWriteUncertain=false;namespaceOpenResult=ESP_OK;namespaceOpens=namespaceCloses=0;
 cacheCommitted=cacheDurable=cacheReusable=cacheWriteUncertain=validatingCommitted=restoringCache=false;
 wifiPending=wifiStarted=accessPoint=commissionRadio=false;buttonDown=buttonSuppressed=buttonApproval=physicalDown=false;buttonAt=buttonChanged=wifiAt=wifiGenerationAt=nextCacheCheck=0;wifiIpGeneration=0;
 LampCommission::pending=LampCommission::workingFlag=BridgeControl::workingFlag=BridgeWifiScan::scanningFlag=false;LampCommission::approvals=0;secureApPending=false;secureApAt=0;apTransitions.clear();
 downloaded=downloadTotal=0;workerDone=cancelDownload=false;workerSuccess=false;downloadTask=nullptr;taskCreation=true;taskDeletes=0;job=Idle;WiFi={};partition.size=0x3f0000;cachePartition=&partition;flash.assign(partition.size,0xff);fakeNow=100000;
 memset(cacheError,0,sizeof(cacheError));memset(workerError,0,sizeof(workerError));
}
void settle(){for(unsigned i=0;i<1000&&job==Validating;++i){serviceCache(fakeNow);++fakeNow;}assert(job!=Validating);}
void committed(unsigned bank=0){
 cacheRecord=record(bank,4);preferences["bridgecache:recordV1"]={reinterpret_cast<const uint8_t*>(&cacheRecord),reinterpret_cast<const uint8_t*>(&cacheRecord)+sizeof(cacheRecord)};loadCache();settle();assert(job==Ready&&cacheCommitted&&cacheDurable&&artifact.ready());assert(preferenceWrites==0);
}
void finishWorker(bool success,const CacheRecord& result,const char* reason="Download incomplete; not offered"){
 workerRecord=result;workerSuccess=success;strncpy(workerError,reason,sizeof(workerError)-1);workerDone.store(true,std::memory_order_release);serviceCache(fakeNow);settle();
}
void cacheFailurePreservation(){
 reset();committed(0);const auto oldPreferences=preferences["bridgecache:recordV1"];const auto oldBytes=image(4);assert(nextCacheBank()==1);
 taskCreation=false;assert(!startCache());settle();assert(cacheCommitted&&cacheDurable&&artifact.ready()&&nextCacheBank()==1&&preferenceWrites==0);assert(preferences["bridgecache:recordV1"]==oldPreferences);
 taskCreation=true;assert(startCache());assert(!artifact.ready()&&!cacheDurable&&cacheReusable);finishWorker(false,{});assert(cacheCommitted&&cacheDurable&&artifact.ready()&&artifact.metadata().image.version[2]==4&&nextCacheBank()==1);assert(preferences["bridgecache:recordV1"]==oldPreferences);
 auto newRecord=record(1,5);flash[CacheDataOffset+CacheBankSpan+1000]^=1;assert(startCache());finishWorker(true,newRecord);assert(cacheCommitted&&cacheDurable&&artifact.ready()&&artifact.metadata().image.version[2]==4&&nextCacheBank()==1);assert(preferences["bridgecache:recordV1"]==oldPreferences);assert(std::equal(oldBytes.begin(),oldBytes.end(),flash.begin()+CacheDataOffset));
 // If the committed image is damaged, ownership still protects its bank and
 // a subsequent check downloads into the other bank rather than reusing it.
 flash[CacheDataOffset+1000]^=1;assert(startCache());finishWorker(false,{});assert(job==Failed&&cacheCommitted&&!cacheDurable&&!artifact.ready()&&nextCacheBank()==1);assert(startCache());assert(!cacheReusable);newRecord=record(1,5);finishWorker(true,newRecord);assert(cacheDurable&&cacheRecord.reserved==1&&artifact.metadata().image.version[2]==5&&nextCacheBank()==0&&preferenceWrites==1);
}
void cacheCommitAndUncertainty(){
 for(bool after:{false,true}){
  reset();committed(0);const auto before=preferences["bridgecache:recordV1"];const auto newRecord=record(1,5);assert(startCache());preferenceFailBefore=!after;preferenceFailAfter=after;finishWorker(true,newRecord);
  assert(cacheCommitted&&cacheDurable&&cacheWriteUncertain&&artifact.ready()&&artifact.metadata().image.version[2]==4&&cacheRecord.reserved==0&&nextCacheBank()==1);assert(!startCache());assert(preferenceWrites==1);
  if(after)assert(preferences["bridgecache:recordV1"]!=before);else assert(preferences["bridgecache:recordV1"]==before);
  // A restart resolves the durable record without erasing either flash bank.
  donor.cancel();artifact.clear();cacheCommitted=cacheDurable=cacheWriteUncertain=false;cacheRecord={};preferenceFailBefore=preferenceFailAfter=false;loadCache();settle();assert(cacheCommitted&&cacheDurable&&artifact.ready());assert(cacheRecord.reserved==unsigned(after));assert(artifact.metadata().image.version[2]==(after?5:4));
 }
 reset();committed(1);auto newRecord=record(0,5);assert(startCache());preferenceOpenFail=true;finishWorker(true,newRecord);assert(!cacheWriteUncertain&&cacheDurable&&cacheCommitted&&cacheRecord.reserved==1&&nextCacheBank()==0);preferenceOpenFail=false;assert(startCache());finishWorker(true,newRecord);assert(cacheRecord.reserved==0&&cacheDurable&&artifact.ready());
}
void cacheReadBounds(){
 reset();uint8_t out[4];assert(readCache(nullptr,0,out,4));assert(readCache(reinterpret_cast<void*>(1),0,out,4));const unsigned allowedCalls=flashReads;assert(!readCache(reinterpret_cast<void*>(2),0,out,4));assert(!readCache(nullptr,BridgeArtifact::MaximumImageSize-1,out,4));assert(!readCache(nullptr,UINT32_MAX,out,4));partition.size=4096;assert(!readCache(nullptr,0,out,4));partition.size=CacheDataOffset+2;assert(!readCache(nullptr,3,out,4));assert(flashReads==allowedCalls);
}
void wifiFreshnessPersistenceAndDeadline(){
 reset();strcpy(config.ssid,"old");strcpy(config.password,"old-pass");assert(!stageWifi("", ""));assert(!stageWifi("new","short"));assert(stageWifi("new","new-pass"));assert(!stageWifi("another","new-pass"));serviceWifi(fakeNow);assert(wifiPending&&WiFi.lastBegin=="new"&&preferenceWrites==0&&String(config.ssid)=="old");
 WiFi.connectedSsid="new";serviceWifi(fakeNow+10);assert(wifiPending&&preferenceWrites==0);wifiIpGeneration++;WiFi.connectedSsid="old";serviceWifi(fakeNow+20);assert(wifiPending&&preferenceWrites==0);WiFi.connectedSsid="new";WiFi.address=0;serviceWifi(fakeNow+30);assert(wifiPending);WiFi.address=1;serviceWifi(fakeNow+40);assert(!wifiPending&&String(config.ssid)=="new"&&preferenceWrites==1&&String(wifiResult)=="saved");
 reset();strcpy(config.ssid,"old");strcpy(config.password,"old-pass");fakeNow=UINT32_MAX-1000;assert(stageWifi("new","new-pass"));serviceWifi(fakeNow);serviceWifi(fakeNow+WifiDeadline);assert(!wifiPending&&preferenceWrites==0&&String(config.ssid)=="old"&&WiFi.lastBegin=="old"&&String(wifiResult)=="failed-previous-kept");
 reset();strcpy(config.ssid,"old");strcpy(config.password,"old-pass");assert(stageWifi("new","new-pass"));serviceWifi(fakeNow);wifiIpGeneration++;WiFi.connectedSsid="new";preferenceFailBefore=true;serviceWifi(fakeNow+100);assert(!wifiPending&&String(config.ssid)=="old"&&WiFi.lastBegin=="old"&&configWriteUncertain&&String(wifiResult)=="save-uncertain-restart");
}
void buttonApprovalStartsInsideSession(){
 reset();physicalDown=true;buttonService(100);LampCommission::pending=true;physicalDown=false;buttonService(200);assert(LampCommission::approvals==0);
 physicalDown=true;buttonService(300);physicalDown=false;buttonService(400);assert(LampCommission::approvals==1);buttonService(401);assert(LampCommission::approvals==1);
 physicalDown=true;buttonService(500);buttonService(2600);physicalDown=false;buttonService(2700);assert(LampCommission::approvals==1);
 reset();physicalDown=true;buttonService(100);physicalDown=false;buttonService(110);assert(!accessPoint);buttonService(200);assert(accessPoint&&LampCommission::approvals==0);
}
Config configuration(const char* ssid="old"){
 Config value;strcpy(value.ssid,ssid);strcpy(value.password,"test-password");strcpy(value.access,"ABCDEFGHIJKLMNOP");value.ownerPasswordSet=1;return value;
}
void configStorageFaultsPreserveRecords(){
 reset();namespaceOpenResult=ESP_ERR_NVS_NOT_FOUND;assert(!loadConfig()&&!configStorageFault&&namespaceOpens==1&&namespaceCloses==0&&preferenceWrites==0);assert(saveConfig(configuration()));
 reset();assert(!loadConfig()&&!configStorageFault&&namespaceCloses==1);assert(saveConfig(configuration()));
 reset();namespaceOpenResult=-9;assert(!loadConfig()&&configStorageFault&&namespaceCloses==0);namespaceOpenResult=ESP_OK;assert(!saveConfig(configuration())&&preferenceWrites==0);
 reset();preferenceOpenFail=true;assert(!loadConfig()&&configStorageFault&&namespaceCloses==1);preferenceOpenFail=false;assert(!saveConfig(configuration())&&preferenceWrites==0);
 for(unsigned failure=0;failure<4;++failure){
  reset();assert(saveConfig(configuration()));auto& persisted=preferences["bridgecfg:configV2"];
  if(failure==0)persisted[offsetof(Config,checksum)]^=1;
  if(failure==1)persisted.pop_back();
  if(failure==2)preferenceReadFail=true;
  if(failure==3){Config value=configuration();value.access[32]=1;value.checksum=crc(&value,offsetof(Config,checksum));persisted.assign(reinterpret_cast<const uint8_t*>(&value),reinterpret_cast<const uint8_t*>(&value)+sizeof(value));}
  const auto before=persisted;const unsigned writes=preferenceWrites;strcpy(config.ssid,"memory-kept");assert(!loadConfig()&&configStorageFault&&String(config.ssid)=="memory-kept");preferenceReadFail=false;
  assert(!saveConfig(configuration("replacement"))&&preferenceWrites==writes&&persisted==before);
 }
 reset();preferenceOpenFail=true;assert(!saveConfig(configuration())&&!configWriteUncertain&&preferenceWrites==0);
}
void configUncertainWriteAndRestart(){
 for(bool after:{false,true}){
  reset();const auto baseline=configuration();assert(saveConfig(baseline));const auto oldBytes=preferences["bridgecfg:configV2"];
  auto candidate=configuration("new");candidate.trusted=1;candidate.fleet[0]=1;candidate.revision++;
  preferenceFailBefore=!after;preferenceFailAfter=after;assert(!saveConfig(candidate)&&configWriteUncertain&&String(config.ssid)=="old"&&!config.trusted);
  const unsigned writes=preferenceWrites;preferenceFailBefore=preferenceFailAfter=false;assert(!saveConfig(configuration("third"))&&preferenceWrites==writes);
  if(after)assert(preferences["bridgecfg:configV2"]!=oldBytes);else assert(preferences["bridgecfg:configV2"]==oldBytes);
  config={};configStorageFault=configWriteUncertain=false;assert(loadConfig()&&!configStorageFault&&!configWriteUncertain);
  assert(String(config.ssid)==(after?"new":"old")&&config.trusted==unsigned(after));
 }
}
LegacyConfig legacyConfiguration(bool network,bool trusted,bool offers){
 LegacyConfig value;value.revision=7;strcpy(value.access,"ABCDEFGHIJKLMNOP");
 if(network){strcpy(value.ssid,"saved-home");strcpy(value.password,"saved-network-pass");}
 value.trusted=trusted;value.offerUpdates=offers;
 if(trusted)for(unsigned i=0;i<16;++i)value.fleet[i]=uint8_t(i+1);
 value.checksum=crc(&value,offsetof(LegacyConfig,checksum));return value;
}
void storeLegacy(const LegacyConfig& value){
 static_assert(sizeof(LegacyConfig)==148&&offsetof(LegacyConfig,checksum)==144,"Legacy persisted layout changed");
 preferences["bridgecfg:configV1"]={reinterpret_cast<const uint8_t*>(&value),reinterpret_cast<const uint8_t*>(&value)+sizeof(value)};
}
void legacyMigrationAndV2Authority(){
 for(unsigned mask=0;mask<8;++mask){
  reset();config={};const auto old=legacyConfiguration(mask&1,mask&2,mask&4);storeLegacy(old);const auto original=preferences["bridgecfg:configV1"];
  assert(loadConfig()&&!configStorageFault&&!configWriteUncertain&&preferenceWrites==1);
  assert(config.magic==0x32475242&&config.revision==old.revision&&String(config.ssid)==old.ssid&&String(config.password)==old.password&&!memcmp(config.fleet,old.fleet,16));
  assert(config.trusted==old.trusted&&config.offerUpdates==old.offerUpdates&&config.ownerPasswordSet==bool(mask));
  assert(config.reserved==(mask?1:0));
  assert(String(config.access)==(mask?"ABCDEFGHIJKLMNOP":"")&&preferences["bridgecfg:configV1"]==original&&preferences.count("bridgecfg:configV2"));
  config={};const unsigned writes=preferenceWrites;assert(loadConfig()&&preferenceWrites==writes&&config.ownerPasswordSet==bool(mask));
 }
 // A malformed authoritative V2 record never resurrects valid V1 credentials.
 for(unsigned failure=0;failure<5;++failure){
  reset();storeLegacy(legacyConfiguration(true,true,true));Config newer=configuration("new-home");newer.checksum=crc(&newer,offsetof(Config,checksum));
  auto& current=preferences["bridgecfg:configV2"];current={reinterpret_cast<const uint8_t*>(&newer),reinterpret_cast<const uint8_t*>(&newer)+sizeof(newer)};
  if(failure==0)current[offsetof(Config,checksum)]^=1;
  if(failure==1)current.pop_back();
  if(failure==2)preferenceReadFail=true;
  if(failure==3){newer.ownerPasswordSet=0;newer.checksum=crc(&newer,offsetof(Config,checksum));current={reinterpret_cast<const uint8_t*>(&newer),reinterpret_cast<const uint8_t*>(&newer)+sizeof(newer)};}
  if(failure==4){newer.reserved=2;newer.checksum=crc(&newer,offsetof(Config,checksum));current={reinterpret_cast<const uint8_t*>(&newer),reinterpret_cast<const uint8_t*>(&newer)+sizeof(newer)};}
  const auto v2=current,v1=preferences["bridgecfg:configV1"];strcpy(config.ssid,"memory-kept");assert(!loadConfig()&&configStorageFault&&String(config.ssid)=="memory-kept");
  assert(preferenceWrites==0&&preferences["bridgecfg:configV1"]==v1&&current==v2);
 }
 for(unsigned failure=0;failure<4;++failure){
  reset();config={};auto old=legacyConfiguration(true,true,true);storeLegacy(old);auto& bytes=preferences["bridgecfg:configV1"];
  if(failure==0)bytes[offsetof(LegacyConfig,checksum)]^=1;
  if(failure==1)bytes.pop_back();
  if(failure==2)preferenceReadFail=true;
  if(failure==3){old.access[15]=0;old.checksum=crc(&old,offsetof(LegacyConfig,checksum));storeLegacy(old);}
  const auto original=bytes;assert(!loadConfig()&&configStorageFault&&!preferenceWrites&&bytes==original&&!preferences.count("bridgecfg:configV2"));
 }
}
void migrationCommitFailuresFenceAndPreserve(){
 for(unsigned failure=0;failure<3;++failure){
  reset();config={};const auto old=legacyConfiguration(true,true,true);storeLegacy(old);const auto original=preferences["bridgecfg:configV1"];
  if(failure==0)preferenceWriteOpenFail=true;
  if(failure==1)preferenceFailBefore=true;
  if(failure==2)preferenceFailAfter=true;
  assert(loadConfig()&&(configStorageFault||configWriteUncertain));
  assert(config.ownerPasswordSet&&String(config.access)==old.access&&String(config.ssid)==old.ssid&&config.trusted&&config.offerUpdates&&!memcmp(config.fleet,old.fleet,16));
  assert(preferences["bridgecfg:configV1"]==original);const unsigned writes=preferenceWrites;
  preferenceWriteOpenFail=preferenceFailBefore=preferenceFailAfter=false;assert(!saveConfig(configuration("replacement"))&&preferenceWrites==writes);
  config={};configStorageFault=configWriteUncertain=false;assert(loadConfig()&&config.ownerPasswordSet&&String(config.ssid)==old.ssid&&!configStorageFault&&!configWriteUncertain);
  assert(preferences["bridgecfg:configV1"]==original);
 }
 reset();config={};storeLegacy(legacyConfiguration(false,false,false));const auto freshLegacy=preferences["bridgecfg:configV1"];
 preferenceWriteOpenFail=true;assert(loadConfig()&&configStorageFault&&!config.ownerPasswordSet&&preferences["bridgecfg:configV1"]==freshLegacy);
 accessPoint=true;assert(choosePassword("12345678","12345678",fakeNow)==507&&!secureApPending&&preferences["bridgecfg:configV1"]==freshLegacy);
}
void firstPasswordDurableSaveAndTransition(){
 for(unsigned length:{8u,32u}){
  reset();config={};accessPoint=true;fakeNow=UINT32_MAX-1000;const String chosen(std::string(length,'P'));
  assert(choosePassword(chosen,chosen,fakeNow)==200&&config.ownerPasswordSet&&!config.reserved&&String(config.access)==chosen&&secureApPending&&secureApAt==fakeNow+2500&&preferenceWrites==1);
  const auto saved=preferences["bridgecfg:configV2"];assert(choosePassword(chosen,chosen,fakeNow+1)==409&&preferenceWrites==1&&preferences["bridgecfg:configV2"]==saved);
  servicePassword(fakeNow+2499);assert(secureApPending&&apTransitions.empty());servicePassword(fakeNow+2500);assert(!secureApPending&&apTransitions==std::vector<bool>({false,true})&&accessPoint);
  servicePassword(fakeNow+100000);assert(apTransitions.size()==2);
  config={};assert(loadConfig()&&config.ownerPasswordSet&&String(config.access)==chosen&&preferenceWrites==1);
 }
 reset();config={};accessPoint=true;
 for(const String& invalid:{String("short"),String(std::string(33,'x')),String(std::string("1234567\0",8)),String("1234567\n"),String("1234567\x7f")}){
  assert(choosePassword(invalid,invalid,fakeNow)==400&&!preferenceWrites&&!config.ownerPasswordSet&&!secureApPending);
 }
 assert(choosePassword("12345678","12345679",fakeNow)==400&&!preferenceWrites);
 for(unsigned blocked=0;blocked<8;++blocked){
  reset();config={};accessPoint=true;
  if(blocked==0)accessPoint=false;
  if(blocked==1)config.trusted=1;
  if(blocked==2)strcpy(config.ssid,"home");
  if(blocked==3)job=Checking;
  if(blocked==4)wifiPending=true;
  if(blocked==5)LampCommission::workingFlag=true;
  if(blocked==6)donor.active=true;
  if(blocked==7)BridgeWifiScan::scanningFlag=true;
  assert(choosePassword("12345678","12345678",fakeNow)==409&&!preferenceWrites&&!secureApPending&&!config.ownerPasswordSet);
 }
 for(unsigned failure=0;failure<5;++failure){
  reset();config={};accessPoint=true;
  if(failure==0)configStorageFault=true;
  if(failure==1)configWriteUncertain=true;
  if(failure==2)preferenceWriteOpenFail=true;
  if(failure==3)preferenceFailBefore=true;
  if(failure==4)preferenceFailAfter=true;
  assert(choosePassword("12345678","12345678",fakeNow)==507&&!config.ownerPasswordSet&&!secureApPending&&apTransitions.empty());
  if(failure>=3){assert(configWriteUncertain);preferenceFailBefore=preferenceFailAfter=false;const unsigned writes=preferenceWrites;assert(choosePassword("12345678","12345678",fakeNow)==507&&preferenceWrites==writes);}
  if(failure==4){config={};configStorageFault=configWriteUncertain=false;assert(loadConfig()&&config.ownerPasswordSet&&String(config.access)=="12345678");}
 }
}
void ownerAuthorizationAndBootToken(){
 server={};config.ownerPasswordSet=1;lampToken="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
 assert(!authorized()&&!authorized(true)&&server.challenges==2&&server.denied==0);
 server.validAuth=true;assert(authorized()&&!authorized(true)&&server.denied==1);
 server.suppliedToken="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";assert(!authorized(true)&&server.denied==2);
 server.suppliedToken=lampToken;assert(authorized(true));
 lampToken="cccccccccccccccccccccccccccccccc";assert(!authorized(true)&&server.denied==3);
 server.suppliedToken=lampToken;assert(authorized(true));
 lampToken="";server.suppliedToken="";assert(!authorized(true)&&server.denied==4);
 config.ownerPasswordSet=0;server={};server.validAuth=true;lampToken=server.suppliedToken="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
 assert(!authorized()&&!authorized(true)&&server.setupRequired==2&&!server.challenges&&!server.denied);
}
void ownerWifiSnapshot(){
 reset();strcpy(config.ssid,"Home \"quoted\" \\ path\n");strcpy(config.password,"never-export-network-password");strcpy(config.access,"never-export-owner-password");
 WiFi.connectedSsid="Current <tag>";WiFi.signal=-67;const auto writes=preferenceWrites,begins=WiFi.begins,disconnects=WiFi.disconnects;
 const String reply=ownerWifiStatus();assert(reply.length()<=640&&LampHttpJson::complete(reply.c_str(),reply.length()));
 assert(reply.find("Home \\\"quoted\\\" \\\\ path\\u000a")!=std::string::npos&&reply.find("Current <tag>")!=std::string::npos&&reply.find("\"rssi\":-67")!=std::string::npos);
 assert(reply.find("never-export")==std::string::npos&&preferenceWrites==writes&&WiFi.begins==begins&&WiFi.disconnects==disconnects&&!BridgeWifiScan::working());
 WiFi.state=0;const String disconnected=ownerWifiStatus();assert(disconnected.find("\"configured\":true")!=std::string::npos&&disconnected.find("\"connected\":false")!=std::string::npos&&disconnected.find("\"connectedName\":\"\"")!=std::string::npos&&disconnected.find("\"rssi\":null")!=std::string::npos);
 WiFi.state=WL_CONNECTED;WiFi.signal=0;assert(ownerWifiStatus().find("\"rssi\":null")!=std::string::npos);
 memset(config.ssid,1,32);config.ssid[32]=0;WiFi.connectedSsid=String(32,'\x01');assert(ownerWifiStatus().length()<=640);
 WiFi.connectedSsid=String(33,'x');assert(ownerWifiStatus().isEmpty());
}
int main(){cacheFailurePreservation();cacheCommitAndUncertainty();cacheReadBounds();wifiFreshnessPersistenceAndDeadline();buttonApprovalStartsInsideSession();configStorageFaultsPreserveRecords();configUncertainWriteAndRestart();legacyMigrationAndV2Authority();migrationCommitFailuresFenceAndPreserve();firstPasswordDurableSaveAndTransition();ownerAuthorizationAndBootToken();ownerWifiSnapshot();std::cout<<"PASS actual bridge runtime helpers: cache/Wi-Fi/button regressions, V1 migration/V2 authority and storage fences, durable first password/exact validation/AP transition, owner auth/boot tokens/diagnostic redaction, bounded escaped owner-only Wi-Fi snapshot with side-effect-free reads\n";}
'''.replace('__DEFINITIONS__', definitions).replace('__HELPERS__', helpers)

tree = ast.parse((ROOT / 'tests/espnow-runtime.py').read_text())
nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'verified_source' or
         isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in
         ('SOURCE', 'ARCHIVE_SHA', 'PRIMITIVES') for target in node.targets)]
scope = dict(Path=Path, hashlib=hashlib, json=json, tarfile=tarfile)
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'pinned_source', 'exec'), scope)
source = scope['verified_source'](ROOT / '.build/tls-library')
with tempfile.TemporaryDirectory(prefix='coollamp-bridge-runtime-') as folder:
    folder = Path(folder)
    (folder / 'Arduino.h').write_text(arduino)
    (folder / 'fixture.cpp').write_text(fixture)
    includes = ['-I' + str(folder), '-I' + str(ROOT), '-I' + str(ROOT / 'tests'),
                '-I' + str(source / 'include'), '-I' + str(source / 'library')]
    defines = ['-DMBEDTLS_CONFIG_FILE="espnow-host-mbedtls-config.h"']
    objects = []
    for name in scope['PRIMITIVES']:
        output = folder / (name + '.o')
        subprocess.run(['gcc', '-std=c11', *SANITIZERS, *includes, *defines, '-c',
                        str(source / 'library' / (name + '.c')), '-o', str(output)], check=True)
        objects.append(str(output))
    output = folder / 'bridge-runtime.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS, *includes,
                    *defines, str(folder / 'fixture.cpp'), str(ROOT / 'bridge/BridgeArtifact.cpp'),
                    *objects, '-o', str(output)], check=True)
    subprocess.run([str(output)], check=True)
