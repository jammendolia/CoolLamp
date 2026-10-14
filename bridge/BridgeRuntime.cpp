#include "BridgeRuntime.h"
#include "BridgeVersion.h"
#include "BridgeDisplay.h"
#include "BridgePage.h"
#include "BridgeControl.h"
#include "BridgeArtifact.h"
#include "BridgeDonation.h"
#include "BridgeUsbProtocol.h"
#include "BridgeWifiScan.h"
#include "BridgeLampLinks.h"
#ifdef COOLLAMP_BRIDGE_BENCH
#include "BridgeBench.h"
#endif
#include "LampCommission.h"
#include "LampCommissionCrypto.h"
#include "LampControlHttpAdapter.h"
#include "LampJsonSink.h"
#include "LampFirmwareRelay.h"
#include "LampMeshAdapter.h"
#include "LampSyncRadioCrypto.h"
#include "UpdateHttp.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <esp_mac.h>
#include <esp_random.h>
#include <esp_partition.h>
#include <esp_heap_caps.h>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <nvs.h>
#include <atomic>
#include <time.h>

String lampName="CoolLamp Bridge",lampToken;
namespace {
constexpr uint32_t CacheDataOffset=4096,CacheBankSpan=0x1f1000,WifiDeadline=30000;
constexpr unsigned UserButton=0;
enum Job:uint8_t {Idle,Checking,Downloading,Validating,Ready,Failed};
struct LegacyConfig {uint32_t magic=0x31475242,revision=1;char ssid[33]{},password[65]{},access[17]{};uint8_t fleet[16]{};uint8_t trusted=0,offerUpdates=0;uint16_t reserved=0;uint32_t checksum=0;};
struct Config {uint32_t magic=0x32475242,revision=1;char ssid[33]{},password[65]{},access[33]{};uint8_t fleet[16]{};uint8_t trusted=0,offerUpdates=0,ownerPasswordSet=0,reserved=0;uint32_t checksum=0;};
struct CacheRecord {uint32_t magic=0x31484342;uint16_t length=0,reserved=0;char original[288]{};uint32_t checksum=0;};
Config config,pendingConfig;CacheRecord cacheRecord;
LampControlHttpAdapter server(80);
BridgeDisplay display;
BridgeArtifact::Artifact artifact;
BridgeDonation::Sender donor;
#ifdef COOLLAMP_BRIDGE_BENCH
BridgeBench::Session bench;
bool benchResourcesReady();
String benchStatus();
bool armBench(uint32_t now);
void serviceBench(uint32_t now);
#endif
const esp_partition_t* cachePartition=nullptr;
uint8_t self[6]{};char identity[13]{};uint64_t boot=0;
bool accessPoint=false,wifiPending=false,wifiStarted=false,cacheDurable=false,commissionRadio=false;
bool configStorageFault=false,configWriteUncertain=false;
// Committed bank ownership survives a failed refresh. Active candidate readiness
// and uncertain NVS commits must never grant permission to erase that bank.
bool cacheCommitted=false,cacheReusable=false,cacheWriteUncertain=false,validatingCommitted=false,restoringCache=false;
bool buttonDown=false,buttonSuppressed=false,buttonApproval=false;uint32_t buttonAt=0,buttonChanged=0,wifiAt=0,nextCacheCheck=0,lastLoopAt=0,maxLoopGap=0,wifiGenerationAt=0;
std::atomic<uint32_t> wifiIpGeneration{0};
uint32_t comparisonStarted=0,lastCueAt=0;uint8_t comparisonVersion=1,comparisonSymbols[7]{},comparisonSeen=0;bool comparing=false;
char serialInput[1025]{};size_t serialSize=0;bool serialOverflow=false;
std::atomic<uint8_t> job{Idle};std::atomic<uint32_t> downloaded{0},downloadTotal{0};std::atomic<bool> workerDone{false},cancelDownload{false};
TaskHandle_t downloadTask=nullptr;CacheRecord workerRecord;char workerError[48]{};bool workerSuccess=false;
char cacheError[48]{},wifiResult[40]="not-requested";
char scanJson[BridgeWifiScan::JsonCapacity]{};
bool secureApPending=false;uint32_t secureApAt=0;
void wipe(void* memory,size_t n){volatile uint8_t* p=static_cast<volatile uint8_t*>(memory);while(n--)*p++=0;}
uint32_t crc(const void* memory,size_t size){uint32_t value=~uint32_t(0);const auto* p=static_cast<const uint8_t*>(memory);while(size--){value^=*p++;for(unsigned i=0;i<8;++i)value=(value>>1)^(0xedb88320u&uint32_t(-int32_t(value&1)));}return ~value;}
uint64_t nonce(){return (uint64_t(esp_random())<<32|esp_random())|1;}
bool busy(){const auto state=job.load();return state==Checking||state==Downloading||state==Validating;}
bool saveConfig(const Config& input){
 if(configStorageFault||configWriteUncertain)return false;
 Config value=input;value.checksum=crc(&value,offsetof(Config,checksum));Preferences p;if(!p.begin("bridgecfg",false))return false;
 const bool saved=p.putBytes("configV2",&value,sizeof(value))==sizeof(value);p.end();
 if(saved)config=value;else configWriteUncertain=true;
 wipe(&value,sizeof(value));return saved;
}
bool loadConfig(){
 nvs_handle_t handle;const auto opened=nvs_open("bridgecfg",NVS_READONLY,&handle);
 if(opened==ESP_ERR_NVS_NOT_FOUND)return false;
 if(opened!=ESP_OK){configStorageFault=true;return false;}nvs_close(handle);
 Preferences p;if(!p.begin("bridgecfg",true)){configStorageFault=true;return false;}
 if(p.isKey("configV2")){
  Config value{};const bool found=p.getBytesLength("configV2")==sizeof(value)&&p.getBytes("configV2",&value,sizeof(value))==sizeof(value);p.end();
  const bool valid=found&&value.magic==0x32475242&&value.checksum==crc(&value,offsetof(Config,checksum))&&value.ssid[32]==0&&value.password[64]==0&&value.access[32]==0&&value.trusted<=1&&value.offerUpdates<=1&&value.ownerPasswordSet<=1&&value.reserved<=1&&
   (value.ownerPasswordSet?(strlen(value.access)>=8&&strlen(value.access)<=32):(!value.access[0]&&!value.ssid[0]&&!value.trusted&&!value.offerUpdates&&!value.reserved));
  if(valid)config=value;else configStorageFault=true;
  wipe(&value,sizeof(value));return valid;
 }
 if(!p.isKey("configV1")){p.end();return false;}
 LegacyConfig old{};const bool found=p.getBytesLength("configV1")==sizeof(old)&&p.getBytes("configV1",&old,sizeof(old))==sizeof(old);p.end();
 const bool valid=found&&old.magic==0x31475242&&old.checksum==crc(&old,offsetof(LegacyConfig,checksum))&&old.ssid[32]==0&&old.password[64]==0&&old.access[16]==0&&strlen(old.access)==16&&old.trusted<=1&&old.offerUpdates<=1;
 if(!valid){configStorageFault=true;wipe(&old,sizeof(old));return false;}
 Config value{};value.revision=old.revision;memcpy(value.ssid,old.ssid,sizeof(old.ssid));memcpy(value.password,old.password,sizeof(old.password));memcpy(value.fleet,old.fleet,sizeof(old.fleet));value.trusted=old.trusted;value.offerUpdates=old.offerUpdates;
 // Only an untouched, unowned prototype becomes open first-time setup. Any
 // working network, household trust or update preference preserves protection.
 value.ownerPasswordSet=old.ssid[0]||old.trusted||old.offerUpdates;
 value.reserved=value.ownerPasswordSet?1:0; // V2 flag: retained prototype-generated key.
 if(value.ownerPasswordSet)memcpy(value.access,old.access,sizeof(old.access));
 config=value;if(!saveConfig(value)&&!configWriteUncertain)configStorageFault=true;
 wipe(&value,sizeof(value));wipe(&old,sizeof(old));return true;
}
bool copyFleet(void*,uint8_t* out){if(!out||!config.trusted)return false;memcpy(out,config.fleet,16);return true;}
bool servingAllowed(void*,const uint8_t* target){return BridgeLampLinks::allows(target);}
bool donationReceiverAllowed(void*,const uint8_t* target){
 if(!servingAllowed(nullptr,target))return false;
#ifdef COOLLAMP_BRIDGE_BENCH
 if(bench.active())return bench.allowsReceiver(target);
#endif
 return true;
}
#ifdef COOLLAMP_BRIDGE_BENCH
const uint8_t* donationOfferTarget(void*){static constexpr uint8_t broadcast[6]={255,255,255,255,255,255};return bench.active()?bench.targetMac():broadcast;}
#endif
String fleetId(void*){if(!config.trusted)return "";uint8_t bytes[8]{};if(!LampCommissionCrypto::fleetIdentifier(config.fleet,bytes))return "";char text[17]{};for(unsigned i=0;i<8;++i)snprintf(text+2*i,3,"%02x",bytes[i]);wipe(bytes,sizeof(bytes));return String(text);}
bool sendMesh(void*,const uint8_t* data,size_t length){return LampEspNow::enqueue(data,length,nullptr,true);}
void holdMeshChannel(void*,uint32_t until){LampEspNow::holdChannel(until);}
bool sendDonor(void*,const uint8_t* data,size_t length,const uint8_t* target){return LampEspNow::enqueue(data,length,target,true);}
uint64_t randomDonor(void*){return nonce();}
void holdDonor(void*,uint32_t until){LampEspNow::holdChannel(until);}
bool readCache(void* context,uint32_t at,uint8_t* out,size_t n){const uint32_t bank=uint32_t(uintptr_t(context));const uint32_t base=CacheDataOffset+bank*CacheBankSpan;return cachePartition&&bank<=1&&base<cachePartition->size&&at<=BridgeArtifact::MaximumImageSize&&n<=BridgeArtifact::MaximumImageSize-at&&at<=cachePartition->size-base&&n<=cachePartition->size-base-at&&esp_partition_read(cachePartition,base+at,out,n)==ESP_OK;}
void startDonor(){if(!config.trusted)return;BridgeDonation::Hooks hooks;hooks.send=sendDonor;hooks.random=randomDonor;hooks.holdChannel=holdDonor;hooks.allowReceiver=donationReceiverAllowed;
#ifdef COOLLAMP_BRIDGE_BENCH
 hooks.offerTarget=donationOfferTarget;
#endif
 donor.begin(self,config.fleet,boot,hooks);donor.setArtifact(&artifact);}
String descriptor(){String value=String("{\"descriptorVersion\":1,\"deviceId\":\"")+identity+"\",\"role\":\"bridge\",\"deviceRole\":\"bridge\",\"name\":\"CoolLamp Bridge\",\"firmwareVersion\":\""+COOLLAMP_BRIDGE_VERSION+"\",\"model\":{\"id\":\"coollamp.bridge.heltec-wifi-kit32-v3\",\"displayName\":\"CoolLamp Bridge\"},\"capabilities\":[\"mesh-control\",\"trusted-cached-donation\",\"oled-status\",\"bridge-lamp-links-v1\"],\"lightControls\":false,\"groupMember\":false,\"cachedImageTarget\":\"esp32c3\",\"publisherProvisioned\":false}";value.remove(value.length()-1);value+=",\"address\":\""+WiFi.localIP().toString()+"\"}";return value;}
const char* phase(){switch(job.load()){case Checking:return "checking";case Downloading:return "downloading";case Validating:return "validating";case Ready:return "ready";case Failed:return "error";default:return "empty";}}
String status(){const auto radio=LampEspNow::status();const auto ds=donor.snapshot();const auto& meta=artifact.metadata();char version[24]{};if(artifact.ready())snprintf(version,sizeof(version),"%u.%u.%u",meta.image.version[0],meta.image.version[1],meta.image.version[2]);const auto& hm=server.metrics();const auto close=server.closeMetrics();return String("{\"role\":\"bridge\",\"deviceId\":\"")+identity+"\",\"name\":\"CoolLamp Bridge\",\"version\":\""+COOLLAMP_BRIDGE_VERSION+"\",\"passwordSet\":"+(config.ownerPasswordSet?"true":"false")+",\"wifiConnected\":"+(WiFi.status()==WL_CONNECTED?"true":"false")+",\"wifiConfigured\":"+(config.ssid[0]?"true":"false")+",\"wifiSave\":\""+wifiResult+"\",\"setupAp\":"+(accessPoint?"true":"false")+",\"address\":\""+WiFi.localIP().toString()+"\",\"fleetId\":\""+fleetId(nullptr)+"\",\"meshEnabled\":"+(BridgeControl::enabled()?"true":"false")+",\"cache\":{\"phase\":\""+phase()+"\",\"version\":\""+version+"\",\"bytes\":"+String(artifact.ready()?meta.image.size:downloadTotal.load())+",\"written\":"+String(downloaded.load())+",\"durable\":"+(cacheDurable?"true":"false")+",\"error\":\""+cacheError+"\"},\"donation\":{\"enabled\":"+(config.offerUpdates?"true":"false")+",\"sending\":"+(ds.sending?"true":"false")+",\"written\":"+String(ds.written)+",\"total\":"+String(ds.total)+",\"completed\":"+String(ds.completed)+",\"failed\":"+String(ds.failed)+",\"result\":"+String(uint8_t(ds.lastResult))+"},\"channel\":"+String(radio.channel)+",\"heap\":"+String(ESP.getFreeHeap())+",\"oledAvailable\":"+(display.available()?"true":"false")+",\"storageFault\":"+(configStorageFault?"true":"false")+",\"configurationUncertain\":"+(configWriteUncertain?"true":"false")+",\"minimumHeap\":"+String(ESP.getMinFreeHeap())+",\"maxLoopGapMs\":"+String(maxLoopGap)+",\"httpMaxServiceUs\":"+String(hm.maxServiceUs)+",\"radioDropped\":"+String(radio.receiveDropped)+",\"uptimeMs\":"+String(millis())+",\"resetReason\":"+String(uint32_t(esp_reset_reason()))+",\"loopStackMinimumBytes\":"+String(uint32_t(uxTaskGetStackHighWaterMark(nullptr)))+",\"http\":{\"accepted\":"+String(hm.accepted)+",\"responses\":"+String(hm.responses)+",\"responseFailures\":"+String(hm.responseFailures)+",\"deadlines\":"+String(hm.deadlines)+",\"dispatches\":"+String(hm.dispatches)+",\"closePending\":"+String(close.pendingOwned)+",\"closeStackMinimumBytes\":"+String(server.closeTaskStackMinimumBytes())+"}}";}
uint16_t localRead(void*,uint8_t endpoint,uint8_t* out,size_t capacity,size_t& used){String body=endpoint==LampControlEndpoint::Descriptor?descriptor():endpoint==LampControlEndpoint::MeshStatus?BridgeControl::statusJson():status();if(body.length()>capacity)return 507;used=body.length();memcpy(out,body.c_str(),used);return 200;}
bool authorized(bool mutation=false){
 if(!config.ownerPasswordSet){server.send(409,"text/plain","Choose a setup password first.");return false;}
 // The OLED's compact font displays uppercase. Accept the displayed spelling
 // and existing lowercase clients; the password remains exact and unchanged.
 if(!server.authenticate("owner",config.access)&&!server.authenticate("OWNER",config.access)){server.requestAuthentication();return false;}
 if(mutation&&(lampToken.isEmpty()||server.header("X-Lamp-Token")!=lampToken)){server.send(403,"text/plain","Open the bridge page again before making changes.");return false;}
 return true;
}
// The browser gets a boot-scoped mutation token only through an authenticated
// read. USB diagnostics and fleet-relayed snapshots never contain this token.
// Network names and RSSI belong only to the owner's browser snapshot. Read the
// existing station state; this never starts a scan, association or NVS write.
String ownerWifiStatus(){
 const bool associated=WiFi.status()==WL_CONNECTED;
 const String current=associated?WiFi.SSID():String();
 if(current.length()>32)return String();
 const bool connected=associated&&!current.isEmpty();
 const int32_t rssi=connected?WiFi.RSSI():0;
 return lampJsonReply([&](LampJsonSink& json){
  json+="{\"version\":1,\"configured\":";json+=config.ssid[0]?"true":"false";
  json+=",\"savedName\":";json.quote(config.ssid);
  json+=",\"connected\":";json+=connected?"true":"false";
  json+=",\"connectedName\":";json.quote(current);
  json+=",\"rssi\":";if(connected&&rssi>=-127&&rssi<0)json+=rssi;else json+="null";
  json+="}";
 },640);
}
String browserStatus(){
 String value=status();
 if(!LampHttpJson::complete(value.c_str(),value.length()))return String();
 String wifi=config.ownerPasswordSet?ownerWifiStatus():String("null");
 if(wifi.isEmpty())return String();
 value.remove(value.length()-1);value+=",\"token\":\""+lampToken+"\",\"wifi\":"+wifi+"}";
 return LampHttpJson::complete(value.c_str(),value.length())?value:String();
}
void answer(const LampControlReply& reply){server.send(reply.status,reply.status<300?"application/json":"text/plain",reply.body);}
void answerLinks(const LampControlReply& reply){
 if(reply.body.isEmpty()){server.send(507,"text/plain","Bridge reply unavailable. Check the saved result before trying again.");return;}
 server.send(reply.status,LampHttpJson::complete(reply.body.c_str(),reply.body.length())?"application/json":"text/plain",reply.body);
}
void setAp(bool enabled){if(enabled==accessPoint)return;if(enabled){char name[33];snprintf(name,sizeof(name),"CoolLampBridge-%s",identity+8);WiFi.mode(WIFI_AP_STA);accessPoint=WiFi.softAP(name,config.ownerPasswordSet?config.access:nullptr,WiFi.status()==WL_CONNECTED?WiFi.channel():1);if(accessPoint&&LampHttpSocketCleanup::start(4096))server.begin();}else{WiFi.softAPdisconnect(false);accessPoint=false;}}
uint16_t choosePassword(const String& password,const String& confirm,uint32_t now){
 if(config.ownerPasswordSet)return 409;
 if(configStorageFault||configWriteUncertain)return 507;
 if(!accessPoint||config.trusted||config.ssid[0]||busy()||wifiPending||LampCommission::working()||donor.sending()||BridgeWifiScan::working())return 409;
 if(password!=confirm||password.length()<8||password.length()>32)return 400;
 for(size_t i=0;i<password.length();++i)if(uint8_t(password[i])<32||uint8_t(password[i])==127)return 400;
 Config value=config;password.toCharArray(value.access,sizeof(value.access));value.ownerPasswordSet=1;value.revision++;
 const bool saved=saveConfig(value);wipe(&value,sizeof(value));
 if(!saved)return 507;
 // Let the small durable-save reply drain before changing the AP. Missing
 // replies require reconnect with the chosen password, never an automatic save replay.
 secureApPending=true;secureApAt=now+2500;return 200;
}
void servicePassword(uint32_t now){if(secureApPending&&int32_t(now-secureApAt)>=0){secureApPending=false;setAp(false);setAp(true);}}
uint16_t nextCacheBank(){return cacheCommitted?uint16_t(1-cacheRecord.reserved):0;}
bool persistCache(){
 workerRecord.checksum=crc(&workerRecord,offsetof(CacheRecord,checksum));Preferences p;
 if(!p.begin("bridgecache",false))return false;
 const bool ok=p.putBytes("recordV1",&workerRecord,sizeof(workerRecord))==sizeof(workerRecord);p.end();
 if(ok){cacheRecord=workerRecord;cacheCommitted=true;}
 else cacheWriteUncertain=true; // A failed commit may already have replaced NVS.
 return ok;
}
bool manifestRead(UpdateHttp& http,char* out,size_t cap,size_t& used){used=0;while(used<cap-1){const int n=http.read(out+used,cap-1-used);if(n<0)return false;if(!n){out[used]=0;return http.complete()&&used>0;}used+=size_t(n);}return false;}
bool openManifest(const String& url,char* text,size_t& count,FirmwareManifest& manifest){UpdateHttp http;int code=0;int64_t length=-1;if(!http.open(url,code,length,&cancelDownload,60000)||code!=200||length>=288||!manifestRead(http,text,288,count))return false;char copy[288]{};memcpy(copy,text,count);const bool ok=parseFirmwareManifest(copy,manifest);wipe(copy,sizeof(copy));return ok;}
void worker(void*){
 workerSuccess=false;workerError[0]=0;workerRecord={};workerRecord.reserved=nextCacheBank();
 do{
  if(time(nullptr)<1700000000){strcpy(workerError,"Waiting for valid network time");break;}
  char original[288]{};size_t count=0;FirmwareManifest pin{};
  if(!openManifest("https://github.com/jammendolia/CoolLamp/releases/latest/download/coollamp-manifest.txt",original,count,pin)){strcpy(workerError,"Release check failed");break;}
  char base[160];snprintf(base,sizeof(base),"https://github.com/jammendolia/CoolLamp/releases/download/firmware-v%u.%u.%u/",pin.version[0],pin.version[1],pin.version[2]);
  char repeated[288]{};size_t repeatedCount=0;FirmwareManifest confirmed{};
  if(!openManifest(String(base)+"coollamp-manifest.txt",repeated,repeatedCount,confirmed)||!sameFirmwareManifest(pin,confirmed)||count!=repeatedCount||memcmp(original,repeated,count)){strcpy(workerError,"Pinned release changed");break;}
  if(cacheReusable&&cacheRecord.length==count&&!memcmp(cacheRecord.original,original,count)){workerRecord=cacheRecord;downloadTotal=downloaded=pin.size;workerSuccess=true;break;}
  downloadTotal=pin.size;job=Downloading;const uint32_t cacheBase=CacheDataOffset+workerRecord.reserved*CacheBankSpan;
  UpdateHttp http;int code=0;int64_t length=-1;if(!http.open(String(base)+"CoolLamp.ino.bin",code,length,&cancelDownload,180000)||code!=200||length!=pin.size){strcpy(workerError,"Image download failed");break;}
  if(!cachePartition||pin.size>BridgeArtifact::MaximumImageSize||cacheBase+((pin.size+4095)&~uint32_t(4095))>cachePartition->size||esp_partition_erase_range(cachePartition,cacheBase,(pin.size+4095)&~uint32_t(4095))!=ESP_OK){strcpy(workerError,"Cache storage unavailable");break;}
  uint8_t bytes[1024]{};uint32_t at=0;bool good=true;
  while(at<pin.size&&!cancelDownload){const size_t want=min(size_t(sizeof(bytes)),size_t(pin.size-at));const int n=http.read(bytes,want);if(n<=0||esp_partition_write(cachePartition,cacheBase+at,bytes,size_t(n))!=ESP_OK){good=false;break;}at+=uint32_t(n);downloaded=at;vTaskDelay(1);}
  uint8_t extra=0;const int tail=good&&!cancelDownload?http.read(&extra,1):-1;wipe(bytes,sizeof(bytes));
  if(!good||cancelDownload||at!=pin.size||tail!=0||!http.complete()){strcpy(workerError,"Download incomplete; not offered");break;}
  workerRecord.length=uint16_t(count);memcpy(workerRecord.original,original,count);workerSuccess=true;
 }while(false);
 workerDone.store(true,std::memory_order_release);vTaskSuspend(nullptr);
}
bool beginArtifact(const CacheRecord& record){
 BridgeArtifact::Source source;source.read=readCache;source.context=reinterpret_cast<void*>(uintptr_t(record.reserved));source.capacity=BridgeArtifact::MaximumImageSize;
 validatingCommitted=cacheCommitted&&record.reserved==cacheRecord.reserved&&record.length==cacheRecord.length&&!memcmp(record.original,cacheRecord.original,record.length);
 cacheDurable=false;
 const bool ok=artifact.begin(source,record.original,record.length,BridgeArtifact::Trust::HttpsPinnedLegacy);
 if(ok)job=Validating;else{job=Failed;strcpy(cacheError,"Cached image validation failed");}return ok;
}
#ifdef COOLLAMP_BRIDGE_BENCH
bool benchResourcesReady(){
 if(bench.used()||!cacheCommitted||!cacheDurable||cacheRecord.reserved>1||!cachePartition||job!=Ready||!artifact.ready()||artifact.pinned()||downloadTask||cacheWriteUncertain||configStorageFault||configWriteUncertain||!BridgeLampLinks::ready()||!config.ownerPasswordSet||!config.trusted||!config.offerUpdates||secureApPending||wifiPending||BridgeWifiScan::working()||LampCommission::working()||donor.sending()||!BridgeControl::policyChangeAllowed()||server.hasActiveClients())return false;
 const auto radio=LampEspNow::status();if(!radio.active||radio.suspended)return false;
 const auto& original=artifact.metadata();
 if(original.trust!=BridgeArtifact::Trust::HttpsPinnedLegacy||original.image.version[0]!=1||original.image.version[1]!=15||original.image.version[2]!=3||cacheRecord.length!=original.originalLength||memcmp(cacheRecord.original,original.original,cacheRecord.length))return false;
 const uint32_t candidate=CacheDataOffset+uint32_t(1-cacheRecord.reserved)*CacheBankSpan;
 return candidate<=cachePartition->size&&BridgeArtifact::MaximumImageSize<=cachePartition->size-candidate;
}
String benchStatus(){
 String value=bench.statusJson(cacheCommitted?cacheRecord.reserved:2,cachePartition?cachePartition->address:0,benchResourcesReady(),millis());
 if(value.isEmpty())return value;
 char session[17]{};snprintf(session,sizeof(session),"%016llx",static_cast<unsigned long long>(boot));
 value.remove(value.length()-1);value+=String(",\"bridgeId\":\"")+identity+"\",\"boot\":\""+session+"\"}";return value;
}
bool armBench(uint32_t now){
 if(!benchResourcesReady())return false;
 BridgeArtifact::Source source;source.read=readCache;source.context=reinterpret_cast<void*>(uintptr_t(1-cacheRecord.reserved));source.capacity=BridgeArtifact::MaximumImageSize;
 const auto previous=donor.snapshot();donor.cancel();
 if(!bench.arm(artifact,source,cacheRecord.reserved,now,true,previous))return false;
 cacheDurable=false;job=Validating;downloaded=0;downloadTotal=artifact.metadata().image.size;cacheError[0]=0;donor.setArtifact(&artifact);return true;
}
void serviceBench(uint32_t now){
 if(bench.running()){
  bench.service(artifact,donor.snapshot(),now);downloaded=artifact.verifiedBytes();
  cacheDurable=false;job=bench.donating()?Ready:Validating;
 }
 if(bench.needsRestore()){
  donor.cancel();artifact.clear();bench.beginRestore();restoringCache=true;
  if(!beginArtifact(cacheRecord)){bench.restored(false);restoringCache=false;}
 }
}
#endif
void restoreCache(const char* reason,uint32_t now){
 char savedReason[sizeof(cacheError)]{};strncpy(savedReason,reason,sizeof(savedReason)-1);
 donor.cancel();artifact.clear();cacheDurable=false;restoringCache=false;job=Failed;nextCacheCheck=now+300000;
 if(cacheCommitted&&beginArtifact(cacheRecord))restoringCache=true;
 memcpy(cacheError,savedReason,sizeof(cacheError));
}
bool startCache(){
#ifdef COOLLAMP_BRIDGE_BENCH
 // Freeze the validated bank selection before physical USB seeding, across
 // resets as well. A background/manual refresh must never flip recordV1 while
 // the operator is writing the bank reported by bench-status.
 if(!bench.used()||bench.active())return false;
#endif
 if(!config.ownerPasswordSet||secureApPending||BridgeWifiScan::working()||busy()||donor.sending()||artifact.pinned()||LampCommission::working()||BridgeControl::working()||wifiPending||WiFi.status()!=WL_CONNECTED)return false;
 if(cacheWriteUncertain){strcpy(cacheError,"Cache save uncertain; restart bridge");return false;}
 if(time(nullptr)<1700000000){strcpy(cacheError,"Waiting for valid network time");return false;}
 cacheReusable=cacheDurable&&artifact.ready();
 if(!artifact.clear()){strcpy(cacheError,"Cache storage unavailable");job=Failed;return false;}
 donor.cancel();cacheDurable=false;restoringCache=false;downloaded=downloadTotal=0;cancelDownload=false;workerDone=false;workerSuccess=false;cacheError[0]=0;job=Checking;
 if(xTaskCreate(worker,"bridge-cache",16384,nullptr,1,&downloadTask)!=pdPASS){downloadTask=nullptr;restoreCache("Download memory unavailable",millis());return false;}return true;
}
void loadCache(){
 Preferences p;if(!p.begin("bridgecache",true))return;CacheRecord value{};
 const bool present=p.getBytesLength("recordV1")==sizeof(value)&&p.getBytes("recordV1",&value,sizeof(value))==sizeof(value);p.end();
 if(present&&value.magic==0x31484342&&value.reserved<=1&&value.length>0&&value.length<sizeof(value.original)&&value.checksum==crc(&value,offsetof(CacheRecord,checksum))){cacheRecord=workerRecord=value;cacheCommitted=true;beginArtifact(value);}
}
void serviceCache(uint32_t now){
#ifdef COOLLAMP_BRIDGE_BENCH
 // USB arm and packet callbacks may have advanced millis() after the loop's
 // initial sample. Deadlines must follow the newest owned state transition.
 serviceBench(millis());if(bench.running())return;
#endif
 if(workerDone.load(std::memory_order_acquire)&&downloadTask){
  vTaskDelete(downloadTask);downloadTask=nullptr;workerDone=false;
  if(workerSuccess){restoringCache=false;if(!beginArtifact(workerRecord))restoreCache("Cached image validation failed",now);}
  else restoreCache(workerError,now);
 }
 if(job!=Validating)return;
 artifact.service(1024);
 if(artifact.ready()){
  // Loading, reusing or restoring the committed bank needs no new NVS write.
  if(validatingCommitted||persistCache()){
   cacheDurable=true;job=Ready;donor.setArtifact(&artifact);
#ifdef COOLLAMP_BRIDGE_BENCH
   bench.restored(true);
#endif
   if(!restoringCache)nextCacheCheck=now+21600000;
   restoringCache=false;
  }else restoreCache(cacheWriteUncertain?"Cache save uncertain; restart bridge":"Cache metadata save failed",now);
 }else if(artifact.state()==BridgeArtifact::State::Error){
#ifdef COOLLAMP_BRIDGE_BENCH
  bench.restored(false);
#endif
  if(validatingCommitted){cacheDurable=false;job=Failed;restoringCache=false;strcpy(cacheError,"Committed image verification failed");nextCacheCheck=now+300000;}
  else restoreCache("Image verification failed",now);
 }
}
bool stageWifi(const String& ssid,const String& password){if(!config.ownerPasswordSet||configStorageFault||configWriteUncertain||secureApPending||BridgeWifiScan::working()||wifiPending||busy()||donor.sending()||LampCommission::working()||ssid.isEmpty()||ssid.length()>32||password.length()>64||(password.length()&&password.length()<8))return false;pendingConfig=config;ssid.toCharArray(pendingConfig.ssid,sizeof(pendingConfig.ssid));password.toCharArray(pendingConfig.password,sizeof(pendingConfig.password));pendingConfig.revision++;wifiPending=true;wifiStarted=false;strcpy(wifiResult,"connecting");return true;}
void serviceWifi(uint32_t now){if(!wifiPending)return;if(!wifiStarted){wifiStarted=true;wifiAt=now;wifiGenerationAt=wifiIpGeneration.load();WiFi.begin(pendingConfig.ssid,pendingConfig.password);}if(WiFi.status()==WL_CONNECTED&&WiFi.SSID()==pendingConfig.ssid&&wifiIpGeneration.load()!=wifiGenerationAt&&uint32_t(WiFi.localIP())!=0){if(saveConfig(pendingConfig)){strcpy(wifiResult,"saved");configTime(0,0,"pool.ntp.org","time.google.com");nextCacheCheck=now+5000;}else{strcpy(wifiResult,configWriteUncertain?"save-uncertain-restart":"save-failed-previous-kept");WiFi.disconnect(false,false);if(config.ssid[0])WiFi.begin(config.ssid,config.password);}wifiPending=false;wipe(&pendingConfig,sizeof(pendingConfig));}else if(now-wifiAt>=WifiDeadline){strcpy(wifiResult,"failed-previous-kept");wifiPending=false;WiFi.disconnect(false,false);if(config.ssid[0])WiFi.begin(config.ssid,config.password);wipe(&pendingConfig,sizeof(pendingConfig));}}
bool provision(const uint8_t* key){if(!key||!config.ownerPasswordSet||secureApPending||BridgeWifiScan::working()||configStorageFault||configWriteUncertain)return false;uint8_t any=0;for(unsigned i=0;i<16;++i)any|=key[i];if(!any)return false;if(config.trusted)return !memcmp(config.fleet,key,16);Config value=config;memcpy(value.fleet,key,16);value.trusted=1;value.revision++;const bool saved=saveConfig(value);wipe(&value,sizeof(value));if(saved)startDonor();return saved;}
void routes(){
 server.on("/api/bridge/links",HTTP_GET,[]{if(authorized()){server.sendHeader("Cache-Control","no-store");answerLinks({200,BridgeLampLinks::statusJson()});}});
 server.on("/api/bridge/links",HTTP_POST,[]{
  if(!authorized(true))return;
  if(server.arg("deviceId")!=identity){server.send(409,"text/plain","This request belongs to a different bridge.");return;}
  if(!config.trusted){server.send(409,"text/plain","Add this bridge to your household first.");return;}
  answerLinks(BridgeLampLinks::request(server.arg("action"),server.arg("target"),server.arg("requestId"),server.arg("expectedBoot"),server.arg("expectedRevision"),
   donor.sending()||!BridgeControl::policyChangeAllowed()||LampCommission::working()||configStorageFault||configWriteUncertain));
 });
 server.on("/api/bridge/links/receipt",HTTP_POST,[]{
  if(!authorized())return;
  if(server.arg("deviceId")!=identity){server.send(409,"text/plain","This receipt belongs to a different bridge.");return;}
  answerLinks(BridgeLampLinks::receipt(server.arg("requestId"),server.arg("expectedBoot")));
 });
 server.on("/",HTTP_GET,[]{if(!config.ownerPasswordSet||authorized()){server.sendHeader("Cache-Control","no-store");server.send_P(200,"text/html",COOLLAMP_BRIDGE_PAGE);}});
 server.on("/api/bridge/status",HTTP_GET,[]{if(!config.ownerPasswordSet||authorized()){server.sendHeader("Cache-Control","no-store");const String value=browserStatus();server.send(value.isEmpty()?507:200,value.isEmpty()?"text/plain":"application/json",value.isEmpty()?String("Bridge status memory unavailable."):value);}});
 server.on("/api/bridge/password",HTTP_POST,[]{
  if(config.ownerPasswordSet){server.send(409,"text/plain","Setup password is already set. Sign in using it.");return;}
  if(lampToken.isEmpty()||server.header("X-Lamp-Token")!=lampToken){server.send(403,"text/plain","Refresh the setup page before choosing a password.");return;}
  String password=server.arg("password"),confirm=server.arg("confirm");const uint16_t result=choosePassword(password,confirm,millis());wipe(const_cast<char*>(password.c_str()),password.length());wipe(const_cast<char*>(confirm.c_str()),confirm.length());
  if(result==200)server.send(200,"application/json","{\"saved\":true,\"reconnect\":true}");
  else server.send(result,"text/plain",result==400?"Passwords must match and contain 8 to 32 bytes.":result==507?"Password save not confirmed. Reconnect or restart to check saved settings.":"Setup cannot accept a password now. Check its status.");
 });
 server.on("/api/bridge/wifi/scan",HTTP_POST,[]{
  if(!authorized(true))return;
  if(configStorageFault||configWriteUncertain||secureApPending||wifiPending||busy()||donor.sending()||LampCommission::working()||BridgeControl::working()){server.send(409,"text/plain","Bridge is busy. Wait before refreshing Wi-Fi.");return;}
  const auto requested=BridgeWifiScan::request(millis());
  if(requested==BridgeWifiScan::RequestResult::Accepted)server.send(202,"application/json",String("{\"accepted\":true,\"generation\":")+String(BridgeWifiScan::snapshot().generation)+"}");
  else server.send(requested==BridgeWifiScan::RequestResult::RateLimited?429:requested==BridgeWifiScan::RequestResult::Busy?409:503,"text/plain","Wi-Fi list is not available yet. Wait before refreshing.");
 });
 server.on("/api/bridge/wifi/networks",HTTP_GET,[]{if(!authorized())return;const size_t size=BridgeWifiScan::writeJson(scanJson,sizeof(scanJson));if(size)server.send(200,"application/json",String(scanJson));else server.send(507,"text/plain","Wi-Fi list memory unavailable.");wipe(scanJson,sizeof(scanJson));});
 server.on("/api/descriptor",HTTP_GET,[]{if(authorized())server.send(200,"application/json",descriptor());});
 server.on("/api/state",HTTP_GET,[]{if(authorized()){server.sendHeader("Cache-Control","no-store");const String value=browserStatus();server.send(value.isEmpty()?507:200,value.isEmpty()?"text/plain":"application/json",value.isEmpty()?String("Bridge status memory unavailable."):value);}});
 server.on("/api/mesh/status",HTTP_GET,[]{if(authorized())server.send(200,"application/json",BridgeControl::statusJson());});
 server.on("/api/mesh/request",HTTP_POST,[]{if(authorized(true))answer(BridgeControl::request(server.arg("target"),server.arg("requestId"),server.arg("endpoint"),server.arg("method"),server.arg("body"),server.arg("targetBoot")));});
 auto result=[](bool mutation){if(authorized(mutation))answer(BridgeControl::result(server.arg("target"),server.arg("requestId"),server.arg("offset"),server.arg("targetBoot")));};
 server.on("/api/mesh/result",HTTP_POST,[result]{result(true);});server.on("/api/mesh/result",HTTP_GET,[result]{result(false);});
 server.on("/api/bridge/wifi",HTTP_POST,[]{if(!authorized(true))return;const bool ok=stageWifi(server.arg("ssid"),server.arg("password"));server.send(ok?202:409,"application/json",ok?"{\"accepted\":true,\"saved\":false}":"{\"accepted\":false,\"saved\":false}");});
 server.on("/api/bridge/cache/check",HTTP_POST,[]{if(!authorized(true))return;const bool ok=startCache();server.send(ok?202:409,"application/json",ok?"{\"accepted\":true}":"{\"accepted\":false}");});
 server.on("/api/bridge/donation",HTTP_POST,[]{if(!authorized(true))return;const String enabled=server.arg("enabled");if(enabled!="0"&&enabled!="1"){server.send(400,"text/plain","Specify enabled 0 or 1.");return;}Config value=config;value.offerUpdates=enabled=="1";value.revision++;const bool saved=saveConfig(value);wipe(&value,sizeof(value));if(saved&&!config.offerUpdates)donor.cancel();server.send(saved?200:507,"application/json",saved?"{\"saved\":true}":"{\"saved\":false}");});
 server.onNotFound([]{server.send(404,"text/plain","Bridge endpoint unavailable.");});
}
void serialService(){
 unsigned budget=128;
 while(budget--&&Serial.available()){
  const int c=Serial.read();if(c=='\r')continue;
  if(c=='\n'){
#ifdef COOLLAMP_BRIDGE_BENCH
   if(!serialOverflow&&((serialSize==12&&!memcmp(serialInput,"bench-status",12))||(serialSize==9&&!memcmp(serialInput,"bench-arm",9)))){
    if(serialSize==12){const String value=benchStatus();Serial.println(value.isEmpty()?String("{\"error\":\"bench-status-unavailable\"}"):value);}
    else Serial.println(armBench(millis())?"{\"accepted\":true,\"developmentFixture\":true}":"{\"accepted\":false,\"developmentFixture\":true}");
    wipe(serialInput,sizeof(serialInput));serialSize=0;serialOverflow=false;continue;
   }
#endif
   BridgeUsbProtocol::Command command;const bool valid=!serialOverflow&&BridgeUsbProtocol::parse(serialInput,serialSize,command);
   if(!valid)Serial.println("{\"error\":\"invalid-command\"}");
   else if(command.kind==BridgeUsbProtocol::Kind::Status)Serial.println(status());
   else if(command.kind==BridgeUsbProtocol::Kind::Diagnostics){const String value=BridgeControl::diagnosticJson();Serial.println(value.isEmpty()?String("{\"error\":\"diagnostics-unavailable\"}"):value);}
   else if(command.kind==BridgeUsbProtocol::Kind::Setup){setAp(true);Serial.println(accessPoint?"{\"setupAp\":true}":"{\"setupAp\":false}");}
   else if(command.kind==BridgeUsbProtocol::Kind::Cache)Serial.println(startCache()?"{\"accepted\":true}":"{\"accepted\":false}");
   else if(command.kind==BridgeUsbProtocol::Kind::Wifi)Serial.println(stageWifi(command.ssid,command.password)?"{\"accepted\":true,\"saved\":false}":"{\"accepted\":false,\"saved\":false}");
   else if(command.kind==BridgeUsbProtocol::Kind::Trust){
    uint8_t check[8]{};char text[17]{};const bool identified=LampCommissionCrypto::fleetIdentifier(command.fleet,check);for(unsigned i=0;i<8;++i)snprintf(text+2*i,3,"%02x",check[i]);
    const bool sameTarget=!strcmp(command.target,identity),sameFleet=identified&&!strcmp(command.fleetId,text);
    const bool saved=sameTarget&&sameFleet&&!busy()&&!LampCommission::working()&&provision(command.fleet);
    Serial.println(saved?"{\"trustSaved\":true}":"{\"trustSaved\":false}");wipe(check,sizeof(check));wipe(text,sizeof(text));
   }
   BridgeUsbProtocol::erase(&command,sizeof(command));wipe(serialInput,sizeof(serialInput));serialSize=0;serialOverflow=false;
  }else if(serialSize<sizeof(serialInput)-1&&c>=32&&c<=126)serialInput[serialSize++]=char(c);else serialOverflow=true;
 }
}
void buttonService(uint32_t now){const bool down=digitalRead(UserButton)==LOW;if(down!=buttonDown&&now-buttonChanged>=35){buttonChanged=now;buttonDown=down;if(down){buttonAt=now;buttonSuppressed=false;buttonApproval=LampCommission::physicalPending();}else if(!buttonSuppressed){if(LampCommission::physicalPending()){if(buttonApproval&&now-buttonAt<1000)LampCommission::approvePhysical();}else if(now-buttonAt<1000)setAp(!accessPoint);}}if(down&&!buttonSuppressed&&now-buttonAt>=2000){buttonSuppressed=true;if(!LampCommission::physicalPending())setAp(true);}}
void displayStatus(uint32_t now){
 BridgeDisplayStatus view;strcpy(view.title,"CoolLamp Bridge");uint8_t red=0,green=0,blue=0;LampCommission::cue(now,red,green,blue);
 LampCommission::ComparisonSnapshot comparison;
 if(LampCommission::comparisonSnapshot(comparison)){
  strcpy(view.title,"Compare with phone");
  if(comparison.version==2){
   for(unsigned row=0;row<3;++row){char* line=row==0?view.line1:row==1?view.line2:view.line3;const unsigned a=row*2,b=a+1;snprintf(line,22,"%u:%u-%u %u:%u-%u",a+1,1+(comparison.symbols[a]>>2),1+(comparison.symbols[a]&3),b+1,1+(comparison.symbols[b]>>2),1+(comparison.symbols[b]&3));}
   snprintf(view.line4,22,"Check:%u-%u %s",1+(comparison.symbols[6]>>2),1+(comparison.symbols[6]&3),comparison.approvalReady?"PRG:OK":"Wait");
  }else{
   // Match the phone's semantic color labels exactly. One color per line keeps
   // every symbol visible, including the longer white names, within 21 columns.
   static const char* names[16]={"Red","Orange","Yellow","Lime","Green","Mint","Cyan","Sky blue","Blue","Violet","Purple","Magenta","Pink","Warm white","Cool white","White"};
   strcpy(view.title,"Match phone, then PRG");
   for(unsigned row=0;row<4;++row){char* line=row==0?view.line1:row==1?view.line2:row==2?view.line3:view.line4;snprintf(line,22,"%u: %s",row+1,names[comparison.symbols[row]]);}
  }
 }else{
  const auto d=donor.snapshot();
  if(d.sending){strcpy(view.line1,"Updating nearby lamp");view.progressPercent=d.total?int(d.written*100ull/d.total):0;snprintf(view.line2,22,"Written: %d%%",view.progressPercent);}
  else if(busy()){snprintf(view.line1,22,"Cache: %s",phase());view.progressPercent=downloadTotal?int(downloaded.load()*100ull/downloadTotal.load()):0;}
  else if(accessPoint){snprintf(view.line1,22,"Bridge WiFi: %s",identity+8);strcpy(view.line2,"Go to 192.168.4.1");if(config.ownerPasswordSet&&config.reserved)snprintf(view.line3,22,"Key: %s",config.access);else strcpy(view.line3,config.ownerPasswordSet?"Use your password":"Open setup WiFi");strcpy(view.line4,config.ownerPasswordSet?"Web login: OWNER":"Choose password there");}
  else{snprintf(view.line1,22,"WiFi: %s",WiFi.status()==WL_CONNECTED?"connected":"not connected");snprintf(view.line2,22,"Trust: %s",config.trusted?"household joined":"add through app");snprintf(view.line3,22,"Cache: %s",phase());snprintf(view.line4,22,"%s",WiFi.status()==WL_CONNECTED?WiFi.localIP().toString().c_str():"PRG: open setup WiFi");}
 }
 display.show(view);display.loop(now);
}
}

namespace BridgeRuntime {
void begin(){Serial.begin(115200);LampHttpSocketCleanup::start(4096);pinMode(UserButton,INPUT_PULLUP);display.begin();esp_read_mac(self,ESP_MAC_WIFI_STA);LampSyncRadioCrypto::identityFromMac(self,identity);boot=nonce();BridgeLampLinks::begin(identity,boot);if(!loadConfig()){if(configStorageFault||!saveConfig(config))strcpy(cacheError,"Bridge settings require recovery");}WiFi.onEvent([](WiFiEvent_t event){if(event==ARDUINO_EVENT_WIFI_STA_GOT_IP)wifiIpGeneration.fetch_add(1);});WiFi.persistent(false);WiFi.mode(WIFI_AP_STA);BridgeWifiScan::begin();char token[33]{};for(unsigned i=0;i<4;++i)snprintf(token+i*8,9,"%08lx",static_cast<unsigned long>(esp_random()));lampToken=token;wipe(token,sizeof(token));WiFi.setAutoReconnect(true);WiFi.setSleep(false);if(config.ssid[0]){WiFi.begin(config.ssid,config.password);configTime(0,0,"pool.ntp.org","time.google.com");}else setAp(true);cachePartition=esp_partition_find_first(esp_partition_type_t(0x40),esp_partition_subtype_t(0),"bridge_cache");BridgeControl::Hooks hooks;hooks.copyFleetKey=copyFleet;hooks.fleetId=fleetId;hooks.send=sendMesh;hooks.holdChannel=holdMeshChannel;hooks.localRead=localRead;hooks.allowRequest=servingAllowed;BridgeControl::begin(self,boot,"CoolLamp Bridge",COOLLAMP_BRIDGE_VERSION,hooks);LampCommission::begin();startDonor();routes();if(LampHttpSocketCleanup::start(4096))server.begin();loadCache();const String hostname=String("coollamp-bridge-")+String(identity+8);MDNS.begin(hostname.c_str());MDNS.addService("http","tcp",80);nextCacheCheck=millis()+15000;Serial.println(status());}
void service(){
 const uint32_t now=millis();if(lastLoopAt&&now-lastLoopAt>maxLoopGap)maxLoopGap=now-lastLoopAt;lastLoopAt=now;
 serialService();buttonService(now);servicePassword(now);serviceWifi(now);serviceCache(now);BridgeLampLinks::service(now,donor.sending()||!BridgeControl::policyChangeAllowed());
 const bool associated=WiFi.status()==WL_CONNECTED,updating=busy();
 BridgeWifiScan::service(now,updating||secureApPending||wifiPending||donor.sending()||LampCommission::working()||BridgeControl::working());
 const bool scanning=BridgeWifiScan::scanning();
 LampEspNow::service(now,false,wifiPending||scanning,associated,!accessPoint&&!associated&&!donor.sending()&&!LampCommission::working()&&!scanning);
 LampEspNow::Received incoming;unsigned budget=4;
 while(budget--&&LampEspNow::receive(incoming)){if(!BridgeWifiScan::working()&&!secureApPending){if(LampCommission::receive(incoming))continue;if(donor.receive(incoming.source,incoming.data,incoming.length,incoming.receivedAt,millis()))continue;}BridgeControl::enqueueReceive(incoming.source,incoming.data,incoming.length,incoming.receivedAt);}
 LampCommission::service(now,updating||secureApPending||wifiPending||scanning||donor.sending());
 BridgeControl::service(now,associated,updating||secureApPending||wifiPending||scanning||donor.sending()||LampCommission::working());
 const bool donorCacheReady=cacheDurable
#ifdef COOLLAMP_BRIDGE_BENCH
  ||bench.donating()
#endif
  ;
 // Requests accepted above carry their processing time. Use a fresh clock so
 // a later callback cannot appear older than a full unsigned timeout period.
 donor.service(millis(),!configStorageFault&&!configWriteUncertain&&config.ownerPasswordSet&&config.offerUpdates&&donorCacheReady&&!updating&&!secureApPending&&!wifiPending&&!scanning&&!LampCommission::working()&&LampEspNow::status().active&&!LampEspNow::status().suspended);
 server.handleClient();server.serviceCleanup();displayStatus(now);
 if(config.trusted&&associated&&!busy()&&!BridgeWifiScan::working()&&!artifact.pinned()&&int32_t(now-nextCacheCheck)>=0){nextCacheCheck=now+300000;startCache();}
 delay(1);
}
}

// Narrow loop-owned adapters allow the existing possession protocol to run on
// an accessory without linking lamp rendering, audio, settings or OTA receivers.
bool lampMeshEnrollmentEligible(){return config.ownerPasswordSet&&!secureApPending&&!BridgeWifiScan::working()&&!config.trusted&&!configStorageFault&&!configWriteUncertain&&!busy()&&!wifiPending;}
bool lampUpdateOwnsResources(){return busy();}
bool beginLampBluetoothUpdateRadio(){if(commissionRadio||!config.ownerPasswordSet||secureApPending||BridgeWifiScan::working()||busy()||donor.sending())return false;commissionRadio=true;return true;}
void finishLampBluetoothUpdateRadio(bool){commissionRadio=false;}
namespace LampFirmwareRelay {bool copyFleetKey(uint8_t* out){return copyFleet(nullptr,out);}bool provisionFleetKey(const uint8_t* key){return provision(key);}String fleetId(){return ::fleetId(nullptr);}bool ownsRadio(){return donor.sending();}}
namespace LampMeshAdapter {bool online(const uint8_t* mac){return BridgeControl::online(mac);}}
