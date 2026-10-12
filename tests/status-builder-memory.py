"""Exercise production status builders with pinned Arduino String ownership.

Uses the installed ESP32 core 3.3.11 WString.cpp/.h, with allocation/copy
observers only. Platform snapshots are fixtures; serializers are extracted from
production. Host pointer/SSO sizes differ from ESP32-C3, so the report measures
String payload allocation, not target total heap or physical acceptance.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
PINNED_STRING_HASHES = {
    'WString.cpp': '6982868692d7347cb1f951101d14072332803716b27aa001f60c4fc941df93f7',
    'WString.h': 'e17d75d8ab183deb56677de708cca5e73b635e5ecdb5af118ce6f34b9ca6565d',
}
# Captured from these same production fixtures before the count/write change.
# These are output oracles, not another serializer implementation. A field,
# type, ordering or omission regression cannot pass by modifying two builders.
LEGACY_FIXTURE_VERSION = '1.15.1'
LEGACY_PAYLOAD_DIGESTS = {
    'update': '4ea422552c8aa44fa27e651550edf2a757f2926cc48b7d86a327b0d6857bae16',
    'policy': '34c4f64c6d1887d305c20d42426a1ae5807543651aee8ff9be11ac6a628de52e',
    'audio': '43c0f3502a97c66c607d5d20a469d6a03d08431b7da5197e511ea926679ceed9',
    'sync': 'a92111a66adebbf5fab7389e117c3ecc65ad9e4f088088900fc4cb332a79455d',
    'stateSync': '1007be0c77ceb43389d8695c4d886c4dbc58c40a5c7481e7fcf2431cc9b33864',
    'fullState': '2acf8f0b121e09fdd791ee9954484c3ea5c134b62b0097f1b75f43d228f2b9f4',
    'fullDiagnostics': '0d546c70c8da2aa1b106efe5c06b70f5aa687bec8aac84e755447835a06726d3',
    'catalog38': '5a315e0da2e90486c1469943ae2d256bfa6d4e3681d68d9e70fef110bd69a1be',
    'catalog47': '6d5c1d442a250afcc7e88ce59442e152019d46e8c457a8cbca4246a34703b773',
}
spec = importlib.util.spec_from_file_location('control_adapter_extract', ROOT/'tests/control-http-adapter.py')
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


def core_path():
    candidates = [Path(os.environ['COOLLAMP_ARDUINO_CORE'])] if 'COOLLAMP_ARDUINO_CORE' in os.environ else []
    if 'LOCALAPPDATA' in os.environ:
        candidates.append(Path(os.environ['LOCALAPPDATA'])/'Arduino15/packages/esp32/hardware/esp32/3.3.11/cores/esp32')
    candidates.extend([Path.home()/'.arduino15/packages/esp32/hardware/esp32/3.3.11/cores/esp32',
                       Path.home()/'Library/Arduino15/packages/esp32/hardware/esp32/3.3.11/cores/esp32'])
    for value in candidates:
        if (value/'WString.cpp').is_file() and (value/'WString.h').is_file():
            return value
    raise RuntimeError('Pinned ESP32 Arduino core 3.3.11 missing; set COOLLAMP_ARDUINO_CORE to cores/esp32.')


ARDUINO = r'''
#pragma once
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <algorithm>
void* observedMalloc(size_t);void* observedRealloc(void*,size_t);void observedFree(void*);
void observeStringCopy(size_t);
uint32_t fixtureFreeHeap();uint32_t fixtureLargestBlock();
#include "WString.h"
class Print {public:virtual ~Print()=default;virtual size_t write(uint8_t)=0;size_t write(const uint8_t* bytes,size_t count){size_t written=0;for(size_t i=0;i<count;++i)written+=write(bytes[i]);return written;}};
#define portENTER_CRITICAL(value) ((void)(value))
#define portEXIT_CRITICAL(value) ((void)(value))
inline uint32_t millis(){return 1000;}
[[maybe_unused]] inline struct {uint32_t getFreeHeap(){return fixtureFreeHeap();}uint32_t getMinFreeHeap(){return 327680;}uint32_t getMaxAllocHeap(){return fixtureLargestBlock();}uint64_t getEfuseMac(){return 0xaabbccddeeffULL;}} ESP;
'''

PLATFORM = r'''
#include "Arduino.h"
#include "LampAudio.h"
#include "LampUpdate.h"
#include "LampSyncProtocol.h"
#include "LampEspNow.h"
#include "LampHttpJson.h"
#include "LampJsonSink.h"
#include "LampGeometry.h"
#include <atomic>
#include <cassert>
#include <iostream>
#include <string>
#include <functional>
#include <unordered_map>
struct AllocationStats {size_t live=0,peak=0,maxCopy=0,largeCopies=0,calls=0,failures=0;};
AllocationStats stats;
size_t failAllocation=0,syncAllocationCalls=0;
bool syncScope=false,failOnlySync=false,forceMove=false;
size_t heapBudget=327680,largestBudget=327680;
bool accountLiveHeap=false;
uint32_t fixtureFreeHeap(){assert(heapBudget>=stats.live);return uint32_t(heapBudget-(accountLiveHeap?stats.live:0));}uint32_t fixtureLargestBlock(){return uint32_t(largestBudget);}
std::unordered_map<void*,size_t> allocations;
void observeStringCopy(size_t n){stats.maxCopy=std::max(stats.maxCopy,n);if(n>=256)++stats.largeCopies;}
bool denyAllocation(size_t bytes){++stats.calls;if(syncScope)++syncAllocationCalls;const size_t call=failOnlySync?syncAllocationCalls:stats.calls;if((failAllocation&&call==failAllocation&&(!failOnlySync||syncScope))||bytes>largestBudget||stats.live+bytes>heapBudget){++stats.failures;return true;}return false;}
void* observedMalloc(size_t n){if(denyAllocation(n))return nullptr;void* p=std::malloc(n);if(p){allocations[p]=n;stats.live+=n;stats.peak=std::max(stats.peak,stats.live);}return p;}
void* observedRealloc(void* p,size_t n){if(denyAllocation(n))return nullptr;size_t previous=p?allocations.at(p):0;void* next=forceMove?std::malloc(n):std::realloc(p,n);if(next){if(forceMove){stats.peak=std::max(stats.peak,stats.live+n);if(p){std::memcpy(next,p,std::min(previous,n));std::free(p);}}if(p)allocations.erase(p);allocations[next]=n;stats.live=stats.live-previous+n;stats.peak=std::max(stats.peak,stats.live);}return next;}
void observedFree(void* p){if(p){stats.live-=allocations.at(p);allocations.erase(p);}std::free(p);}
bool installed=true,audioRunning=false;uint8_t gain=255;uint16_t gate=65535,scale=65535;
bool lampMicrophoneEnabled(){return false;}bool lampMicrophoneEnabledKnown(){return true;}
LampAudioCaptureStatus lampAudioCaptureStatus(){return LampAudioCaptureStatus::Error;}
uint8_t lampMotionPath=0;bool lampMotionPathSaveUncertain(){return false;}
uint32_t lampRenderedFrames=UINT32_MAX,lampMaxRenderUs=UINT32_MAX;
LampAudioFeatures getLampAudioFeatures(){LampAudioFeatures f{};f.running=audioRunning;f.sequence=f.timestamp=f.errors=f.overruns=UINT32_MAX;f.stackFree=6144;f.rms=f.peak=f.effectiveGain=f.noiseFloor=f.effectiveGate=f.bass=f.mid=f.treble=UINT16_MAX;f.beat=f.bassBeat=UINT32_MAX;f.level=255;f.error=INT32_MIN;return f;}
LampUpdateStatus getLampUpdateStatus(){LampUpdateStatus s{};s.phase=UPDATE_ERROR;s.progress=100;s.error=UPDATE_MEMORY;s.latest[0]=s.latest[1]=s.latest[2]=UINT16_MAX;s.route=UPDATE_ROUTE_MANUAL_UPLOAD;s.checkedAt=UINT32_MAX;s.writtenOffset=s.totalBytes=2031616;return s;}
FirmwareManifest candidate{};unsigned mux=0;
LampUpdateAutomatic::Snapshot automaticView;
struct {LampUpdateAutomatic::Snapshot snapshot(uint32_t){LampUpdateAutomatic::Snapshot out;out.retryInMs=21600000;out.donorWaitMs=30000;return out;}} automaticService;
void* worker=reinterpret_cast<void*>(1);bool healthy=false;
constexpr int MALLOC_CAP_8BIT=1;unsigned heap_caps_get_largest_free_block(int){return 327680;}
unsigned uxTaskGetStackHighWaterMark(void*){return 6144;}
namespace UpdatePublisher {bool enforced(){return false;}}
bool policyReadable=false;LampUpdatePolicy::Policy updatePolicy;uint32_t policyRevision=UINT32_MAX;
LampUpdatePolicy::Eligibility policyEligibility(){return LampUpdatePolicy::InvalidPolicy;}
uint8_t lampRolloutAutomaticAdmissionSnapshotReason(){return 4;}
std::atomic<int> httpStage{INT32_MIN},httpCode{INT32_MIN},httpHost{INT32_MIN},tlsError{INT32_MIN},tlsFlags{INT32_MIN},transportError{INT32_MIN};
namespace LampUpdateAttempt {unsigned mux=0;bool readable=false;uint8_t count=4;int find(const FirmwareManifest&){return 0;}
ATTEMPT_JSON
}
constexpr int WL_CONNECTED=3;
using namespace LampSyncWire;
struct {uint8_t role=1;char leader[13]="aabbccddeeff",key[33]="0123456789abcdef0123456789abcdef";} config;
struct Address {const char* text="192.168.255.254";String toString(){return text;}size_t printTo(Print& out)const{return out.write(reinterpret_cast<const uint8_t*>(text),strlen(text));}};using IPAddress=Address;
bool wifiConnected=false,ipv6Dns=false;
struct {int status(){return wifiConnected?WL_CONNECTED:0;}Address localIP(){return {};}Address gatewayIP(){return {};}Address dnsIP(int i){return {ipv6Dns&&i==0?"ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff":"192.168.255.254"};}int RSSI(){return -128;}unsigned channel(){return 14;}String BSSIDstr(){return "aa:bb:cc:dd:ee:ff";}Address subnetMask(){return {};}unsigned softAPgetStationNum(){return 255;}} WiFi;
struct Peer {Packet info{};bool joined=true;uint32_t seen=1000,subscribed=1000;bool udpKnown=true,radioKnown=true;uint32_t udpSeen=1000,radioSeen=1000;Address ip;uint8_t radioChannel=14;} peers[31];
struct {uint8_t count=32;char order[32][13]{};} sceneConfig;
char identity[13]="aabbccddeeff";bool paused=false,followingRadio=true,started=true,serviceBlocked=false;
uint8_t wireVersion=ExpandedVersion;uint64_t nonce=0x123456789abcdef0ULL;
bool slotSaved=false;struct {char leader[13]{};} followerSlot;
uint32_t slotSaveFailures=UINT32_MAX,incompatibleSubscriptions=UINT32_MAX;
uint32_t receivedPackets=UINT32_MAX,discoveries=UINT32_MAX,authFailures=UINT32_MAX,subscriptionsSent=UINT32_MAX,framesReceived=UINT32_MAX,clockDrops=UINT32_MAX;
bool lampSyncFollowing(){return false;}bool lampRolloutPinsMembership(){return false;}
String lampSyncIncarnation(){return "fefefefefefefefefefefefefefefefe";}
namespace LampEspNow {Status status(){Status s{};s.active=true;s.channel=14;s.received=s.receiveDropped=s.sent=s.sendFailed=s.sendDropped=s.channelChanges=UINT32_MAX;return s;}}
SYNC_JSON_SNAPSHOT;
uint8_t visualScene=32;
Visual lampGroupVisual(){Visual v{};v.scene=visualScene;v.count=sceneConfig.count;v.sceneSpeed=v.sceneIntensity=100;memset(v.scenePrimary,255,3);memset(v.sceneSecondary,255,3);return v;}
bool appendLampSyncJson(String&,uint8_t peerCursor=0,uint8_t peerLimit=8);
'''

HANDLER_PLATFORM = r'''
#include "LampConfig.h"
#include "LampFactory.h"
#include "LampRuntimeMetrics.h"
#define COOL_LAMP_AUDIO_EFFECTS 1
constexpr unsigned LAMP_PROTOCOL_VERSION=1,LAMP_BASE_EFFECT_COUNT=38,MODE_FIRE=4;
LampSettings lampSettings{};
// Fixture globals are already resident in the observed free-heap baseline.
// Avoid counting their persistent storage again; any SDK text conversion is
// still an observed pinned String temporary, including allocation failures.
struct FixtureHost {const char* text="test-host";size_t length()const{return strlen(text);}operator String()const{return String(text);}String operator+(const char* suffix)const{return String(text)+suffix;}FixtureHost& operator=(const char* value){text=value;return *this;}} lampHost;
const char* lampToken="fixturetoken";
const char* lampName="A bounded public fixture lamp name";
uint16_t NUM_LEDS=1024,lampMidpoint=512;uint8_t Mode=4,Brightness=255;bool PowerOn=true;
uint8_t availableEffects=47;bool useCanonicalNames=true;
uint8_t lampAvailableEffectCount(){return availableEffects;}
constexpr uint8_t LAMP_CUSTOM_SOLID=29;bool productionDefaultAppearance=false;
struct Color {uint8_t enabled=1,r=255,g=255,b=255;};using LampColor=Color;
DEFAULT_COLOR_FN
Color getLampColor(uint8_t mode){return productionDefaultAppearance?defaultLampColor(mode):Color{};}
struct Options {uint8_t speed=100,intensity=100,dual=1,r=255,g=255,b=255;};using LampEffectOptions=Options;
DEFAULT_OPTIONS_FN
Options getLampEffectOptions(uint8_t mode){return productionDefaultAppearance?defaultEffectOptions(mode):Options{};}
struct RGB {uint8_t r=255,g=255,b=255;};RGB fountainPaletteColor(unsigned){return {};}RGB renderVuColor(unsigned){return {};}
bool lampCalibrationActive(){return false;}bool lampCalibrationCenter(){return false;}unsigned lampCalibrationPosition(){return NUM_LEDS-1;}
struct {bool enabled=false,random=false;uint8_t category=255;uint32_t seconds=UINT32_MAX;} lampRotation;
String lampStyleJson(){return "{\"version\":1,\"code\":3,\"id\":\"corkscrew\",\"family\":\"corkscrew\"}";}
uint8_t lampStyleCode(){return 3;}const char* lampStyleId(){return "corkscrew";}const char* lampStyleFamily(){return "corkscrew";}
enum wifi_ps_type_t {WIFI_PS_NONE=0};constexpr int ESP_OK=0;
int esp_wifi_get_ps(wifi_ps_type_t* mode){*mode=WIFI_PS_NONE;return ESP_OK;}int esp_reset_reason(){return INT32_MIN;}
bool setupAP=false,scanActive=false;unsigned scanStartedAt=0,scanDuration=UINT32_MAX,scanPolls=UINT32_MAX;int scanCount=INT32_MIN;
String lampTemperatureJson(){return "{\"supported\":true,\"valid\":true,\"celsius\":125.00,\"peakCelsius\":125.00,\"sampleAgeMs\":4294967295,\"error\":null}";}
LampRuntimeMetrics::Snapshot diagnosticMetrics;
const LampRuntimeMetrics::Snapshot& getLampRuntimeMetrics(){return diagnosticMetrics;}
struct FixtureServer {
 HTTP_METRICS;
 Metrics measured{};String body;int status=0;
 std::function<void()> catalogRead;
 template<typename F>void on(const char*,int,F handler){catalogRead=handler;}
 const Metrics& metrics(){return measured;}unsigned closeTaskStackMinimumBytes(){return UINT32_MAX;}
 bool privateControl=false;bool controlActive(){return privateControl;}
 void send(int code,const char*,String&& value){status=code;body=std::move(value);}
 void send(int code,const char*,const char* value){status=code;body=value;}
} lampServer;
constexpr int HTTP_GET=1;
bool authorizedLampRequest(bool){return true;}
EFFECT_NAMES
'''

MAIN = r'''
template<typename F> void measure(const char* name,F f){
  assert(stats.live==0);stats={};
  size_t calls=0;
  {String result=f();assert(result.length());assert(stats.largeCopies==0);
   calls=stats.calls;
   std::cout<<"{\"name\":\""<<name<<"\",\"bytes\":"<<result.length()<<",\"peakStringPayloadBytes\":"<<stats.peak<<",\"largestStringCopyBytes\":"<<stats.maxCopy<<",\"largeCopies\":"<<stats.largeCopies<<",\"allocationFailureCases\":"<<calls<<",\"value\":"<<result.c_str()<<"}\n";}
  assert(stats.live==0&&allocations.empty());
  for(size_t n=1;n<=calls;++n){
    std::cerr<<name<<" injection="<<n<<"/"<<calls<<"\n";
    stats={};failAllocation=n;
    {String failed=f();if(failed.length()){std::cerr<<name<<" did not reject allocation failure "<<n<<"/"<<calls<<": "<<failed.c_str()<<"\n";}assert(stats.failures==1&&failed.length()==0);}
    assert(stats.live==0&&allocations.empty());
  }
  failAllocation=0;
}
template<typename F> void measureHandler(const char* name,F f,bool checkFailures=true){
  assert(stats.live==0);stats={};syncAllocationCalls=0;forceMove=true;
  size_t calls=0;
  {String result=f();if(!result.length())std::cerr<<name<<" rejected at modeled heap="<<heapBudget<<" largest="<<largestBudget<<" peakPayload="<<stats.peak<<"\n";assert(result.length());calls=stats.calls;assert(stats.largeCopies==0);
   std::cout<<"{\"name\":\""<<name<<"\",\"bytes\":"<<result.length()<<",\"peakStringPayloadBytes\":"<<stats.peak<<",\"largestStringCopyBytes\":"<<stats.maxCopy<<",\"largeCopies\":"<<stats.largeCopies<<",\"allocationFailureCases\":"<<(checkFailures?calls:0)<<",\"value\":"<<result.c_str()<<"}\n";}
  assert(stats.live==0&&allocations.empty());
  if(checkFailures&&calls)for(size_t n=1;n<=calls;++n){
    std::cerr<<name<<" injection="<<n<<"/"<<calls<<"\n";
    stats={};syncAllocationCalls=0;failAllocation=n;failOnlySync=false;
    {String failed=f();if(stats.failures!=1||failed.length()){std::cerr<<name<<" failed boundary "<<n<<"/"<<calls<<" failures="<<stats.failures<<" resultBytes="<<failed.length()<<"\n";}assert(stats.failures==1&&failed.length()==0);}
    assert(stats.live==0&&allocations.empty());
  }
  failAllocation=0;failOnlySync=false;forceMove=false;
}
void measureCatalog(const char* name){
  assert(stats.live==0);stats={};forceMove=true;
  size_t calls=0,falseSuccess=0;
  lampServer.catalogRead();assert(lampServer.status==200);
  {String result=std::move(lampServer.body);calls=stats.calls;
   std::cout<<"{\"name\":\""<<name<<"\",\"bytes\":"<<result.length()<<",\"peakStringPayloadBytes\":"<<stats.peak<<",\"largestStringCopyBytes\":"<<stats.maxCopy<<",\"largeCopies\":"<<stats.largeCopies<<",\"allocationFailureCases\":"<<calls<<",\"value\":"<<result.c_str()<<"}\n";}
  assert(stats.live==0&&allocations.empty());
  for(size_t n=1;n<=calls;++n){
    stats={};failAllocation=n;lampServer.catalogRead();assert(stats.failures==1);
#ifdef CATALOG_GUARD_CANARY
    if(lampServer.status==200){++falseSuccess;if(falseSuccess==1)std::cout<<"{\"negativeCatalogCase\":"<<n<<",\"value\":"<<lampServer.body.c_str()<<"}\n";}
#else
    assert(lampServer.status==503&&lampServer.body=="Effect catalog incomplete. Nothing changed.");
#endif
    lampServer.body=static_cast<const char*>(nullptr);assert(stats.live==0&&allocations.empty());
  }
#ifdef CATALOG_GUARD_CANARY
  assert(falseSuccess>0);std::cout<<"{\"negativeCatalogCanary\":\""<<name<<"\",\"falseSuccesses\":"<<falseSuccess<<"}\n";
#else
  assert(!falseSuccess);
#endif
  failAllocation=0;forceMove=false;
}
void measureCatalogLoop255(){
  assert(stats.live==0);stats={};forceMove=true;availableEffects=255;
  lampServer.catalogRead();assert(lampServer.status==503);
  std::cout<<"{\"name\":\"catalogLoop255\",\"status\":"<<lampServer.status<<",\"handlerLoopOnly\":true,\"bytes\":"<<lampServer.body.length()<<"}\n";
  lampServer.body=static_cast<const char*>(nullptr);assert(stats.live==0&&allocations.empty());forceMove=false;
}
void measureLowMemory(){
  // Four durable positions, three small visible hints. The SDK heap/largest
  // values are the observed fixture; only actual pinned String calls are
  // faulted/accounted, so this remains host validation of reply ownership.
  availableEffects=47;heapBudget=16316;largestBudget=7668;accountLiveHeap=true;stats={};
  sendLampState();assert(lampServer.status==503);lampServer.body=static_cast<const char*>(nullptr);
  assert(lampDiagnosticsJson().isEmpty()&&stats.live==0);
  availableEffects=47;sceneConfig.count=4;for(unsigned i=3;i<31;++i)peers[i]={};
  for(unsigned i=0;i<3;++i)snprintf(peers[i].info.name,49,"Fixture %u",i+1);
  for(unsigned i=4;i<32;++i)memset(sceneConfig.order[i],0,13);
  heapBudget=16316;largestBudget=7668;accountLiveHeap=true;
  measureHandler("fourMemberState",[]{sendLampState();if(lampServer.status!=200){lampServer.body=static_cast<const char*>(nullptr);return String();}return std::move(lampServer.body);});
  measureHandler("fourMemberDiagnostics",[]{return lampDiagnosticsJson();});
  availableEffects=47;measureCatalog("lowMemoryCatalog47");
  // CoolLamp2-like public shape uses fabricated names/addresses, not the
  // private diagnostic artifact. Keep maximum counters/tuning as conservative
  // sizing inputs. Test installed audio and unknown/absent audio catalogs.
  NUM_LEDS=134;lampMidpoint=0;Mode=46;Brightness=55;wireVersion=LegacyVersion;visualScene=24;
  lampSettings.ledCount=134;audioRunning=true;wifiConnected=true;
  auto& extra=peers[3];snprintf(extra.info.sender,13,"%012x",4);strcpy(extra.info.name,"Fixture 4");extra.info.role=0;extra.info.version=2;extra.seen=1000;extra.udpKnown=true;extra.udpSeen=1000;
  for(auto& peer:peers)if(peer.info.sender[0])peer.info.version=2;
  // Fixed HTTP diagnostics remove the retained temporary allocation. Prove
  // that the formerly rejected maximal appearance fits without lowering the
  // exact reply reservation or the unchanged SDK/workspace headroom.
  stats={};sendLampState();assert(lampServer.status==200);
  assert(lampServer.body.length()<=largestBudget&&stats.peak<=heapBudget-8704);
  std::cout<<"{\"maxAppearanceLowMemory\":true,\"bytes\":"<<lampServer.body.length()<<",\"peakStringPayloadBytes\":"<<stats.peak<<",\"remainingModeledBytes\":"<<heapBudget-stats.peak<<"}\n";
  lampServer.body=static_cast<const char*>(nullptr);assert(stats.live==0);
  productionDefaultAppearance=true;
  measureHandler("cool2Profile47State",[]{sendLampState();if(lampServer.status!=200){lampServer.body=static_cast<const char*>(nullptr);return String();}return std::move(lampServer.body);});
  measureHandler("cool2Profile47Diagnostics",[]{return lampDiagnosticsJson();});
  availableEffects=38;installed=false;audioRunning=false;
  measureHandler("cool2Profile38State",[]{sendLampState();if(lampServer.status!=200){lampServer.body=static_cast<const char*>(nullptr);return String();}return std::move(lampServer.body);});
  measureHandler("cool2Profile38Diagnostics",[]{return lampDiagnosticsJson();});
  // The latest failed native read left only 15,508 B free and a 7,668 B
  // largest block. Preserve a full IPv6 DNS address and public 32-byte token;
  // the SDK/workspace floor remains 8,704 B after the complete owned reply.
  if(useCanonicalNames){
  availableEffects=47;installed=true;audioRunning=true;heapBudget=15508;
  lampHost="coollamp-abcdef";lampToken="0123456789abcdef0123456789abcdef";
  lampName="Fixture Lamp2";ipv6Dns=true;
  measureHandler("connected47StateHttp",[]{sendLampState();if(lampServer.status!=200){lampServer.body=static_cast<const char*>(nullptr);return String();}assert(stats.peak<=15508-8704);return std::move(lampServer.body);});
  lampServer.privateControl=true;
  measureHandler("connected47StateBle",[]{sendLampState();if(lampServer.status!=200){lampServer.body=static_cast<const char*>(nullptr);return String();}assert(stats.peak<=15508-8704);return std::move(lampServer.body);});
  lampServer.privateControl=false;ipv6Dns=false;
  }
  assert(stats.live==0);heapBudget=327680;largestBudget=327680;accountLiveHeap=false;
}
void checkSinkBounds(){
  assert(stats.live==0);stats={};
  LampJsonSink exact(nullptr,3);assert(exact.concat("abc")&&exact.size()==3);
  assert(!exact.concat('d')&&!exact.okay()&&!exact.size());
  LampJsonSink invalid(nullptr,32);assert(!invalid.concat(nullptr,0)&&!invalid.okay());
  LampJsonSink numbers(nullptr,64);numbers+=INT64_MIN;numbers+=',';numbers+=UINT64_MAX;
  assert(numbers.okay()&&numbers.size()==41&&stats.calls==0);
  unsigned pass=0;
  {String changed=lampJsonReply([&](LampJsonSink& s){++pass;s.concat(pass==1?"{}":"{\"changed\":1}");});assert(changed.isEmpty());}
  assert(pass==2&&stats.live==0);
  {String truncated=lampJsonReply([](LampJsonSink& s){s.concat("{\"x\":");});assert(truncated.isEmpty());}
  {String tooLarge=lampJsonReply([](LampJsonSink& s){s.quote(std::string(8191,'x').c_str());});assert(tooLarge.isEmpty());}
  assert(stats.live==0);
  // Exact core3.3.11 reservation rounding and retained SDK margin are checked
  // before any output allocation, including a fragmented largest block.
  constexpr size_t bytes=102,rounded=(bytes+16)&~size_t(15);
  auto encode=[](LampJsonSink& s){s.quote(std::string(100,'x').c_str());};
  for(const auto budget:{std::pair<size_t,size_t>{rounded+8703,rounded},{rounded+8704,rounded-1}}){
    heapBudget=budget.first;largestBudget=budget.second;stats={};
    {String denied=lampJsonReply(encode);assert(denied.isEmpty()&&stats.calls==0);}assert(stats.live==0);
  }
  heapBudget=rounded+8704;largestBudget=rounded;stats={};
  {String accepted=lampJsonReply(encode);assert(accepted.length()==bytes&&stats.calls==1&&stats.peak==rounded);}assert(stats.live==0);
  heapBudget=327680;largestBudget=327680;
}
// Prove the observer catches the exact StringSumHelper return-copy failure.
String copyCanary(){String s;assert(s.reserve(4096));for(unsigned i=0;i<4096;++i)s+='x';return s+"]}";}
int main(){
  checkSinkBounds();
  {String canary=copyCanary();assert(canary.length()==4098&&stats.largeCopies>=2&&stats.maxCopy>=4096&&stats.peak>=8192);}
  assert(stats.live==0);
  memset(updatePolicy.timezone,'T',63);updatePolicy.timezone[63]=0;updatePolicy.startMinute=updatePolicy.endMinute=65535;updatePolicy.idleSeconds=UINT32_MAX;
  strcpy(sceneConfig.order[0],identity);
  for(unsigned i=0;i<31;++i){auto& p=peers[i];snprintf(p.info.sender,13,"%012x",i+1);p.info.role=2;p.info.version=3;p.info.microphone=1;memset(p.info.name,'"',48);p.info.name[48]=0;strcpy(sceneConfig.order[i+1],p.info.sender);}
  measure("update",[]{const auto snapshot=captureLampUpdateJson();return lampJsonReply([&](LampJsonSink& out){appendLampUpdateJson(out,snapshot);});});measure("policy",[]{return lampUpdatePolicyJson();});measure("audio",[]{return lampAudioJson();});
  measure("sync",[]{return lampSyncJson(0,8);});measure("stateSync",[]{return lampSyncJson(0,1);});
  lampSettings.version=1;lampSettings.ledCount=1024;lampSettings.milliAmps=65535;lampSettings.brightness=255;lampSettings.startupMode=4;memset(lampSettings.ssid,'"',32);lampSettings.ssid[32]=0;
  diagnosticMetrics.loops=diagnosticMetrics.shows=diagnosticMetrics.animationShows=UINT32_MAX;
  diagnosticMetrics.maxLoopUs=diagnosticMetrics.maxLoopGapUs=diagnosticMetrics.maxNetworkServiceUs=diagnosticMetrics.maxBluetoothServiceUs=diagnosticMetrics.maxBeforeRenderUs=UINT32_MAX;
  diagnosticMetrics.maxShowUs=diagnosticMetrics.maxFrameGapUs=diagnosticMetrics.maxAnimationFrameGapUs=diagnosticMetrics.animationGapOverruns=UINT32_MAX;
  for(auto* w:{&diagnosticMetrics.currentWindow,&diagnosticMetrics.lastWindow}){w->sequence=w->startUs=w->endUs=w->observedThroughUs=w->observations=w->animationFrames=w->maxAnimationGapUs=w->animationGapOverruns=UINT32_MAX;}
  HTTP_METRIC_INIT
  measureHandler("fullState",[]{sendLampState();if(lampServer.status!=200){lampServer.body=static_cast<const char*>(nullptr);return String();}return std::move(lampServer.body);});
  measureHandler("fullDiagnostics",[]{return lampDiagnosticsJson();});
  CATALOG_REGISTRATION
  availableEffects=38;measureCatalog("catalog38");
  availableEffects=47;measureCatalog("catalog47");
  measureLowMemory();
  automaticView.internetAttempts=automaticView.donorOffers=UINT16_MAX;automaticView.state=6;automaticView.reason=24;
  measure("compactUpdate",[]{return lampUpdateJson();});
  std::cout<<"{\"snapshotSizes\":{\"firmware\":"<<sizeof(LampUpdateJsonSnapshot)<<",\"audio\":"<<sizeof(LampAudioJsonSnapshot)<<",\"sync\":"<<sizeof(LampSyncJsonSnapshot)<<",\"runtimeMetrics\":"<<sizeof(LampRuntimeMetrics::Snapshot)<<",\"httpMetrics\":"<<sizeof(decltype(lampServer.measured))<<"},\"hostOnly\":true}\n";
}
'''


class StatusBuilderMemoryTests(unittest.TestCase):
    def test_pinned_string_production_builders_move_returned_buffer(self):
        core = core_path()
        for name, expected in PINNED_STRING_HASHES.items():
            self.assertEqual(hashlib.sha256((core/name).read_bytes()).hexdigest(), expected,
                             'This fixture requires the exact pinned core 3.3.11 '+name)
        raw = (core/'WString.cpp').read_text()
        self.assertEqual(raw.count('String::String(const String &value) {'), 1)
        raw = raw.replace('String::String(const String &value) {',
                          'String::String(const String &value) {\n  observeStringCopy(value.length());')
        # The pinned implementation remains intact apart from observers.
        raw = raw.replace('malloc(', 'observedMalloc(').replace('realloc(', 'observedRealloc(').replace('free(', 'observedFree(')
        sources = {name: (ROOT/name).read_text() for name in ['LampSync.cpp', 'LampUpdate.cpp', 'LampAudio.cpp', 'LampUpdateAttempt.cpp', 'UpdateHttp.cpp', 'UpdateHttpDiagnostics.cpp']}
        sources['LampNetwork.ino']=(ROOT/'LampNetwork.ino').read_text()
        sources['LampVersion.h']=(ROOT/'LampVersion.h').read_text()
        current_version=re.search(r'^#define LAMP_FIRMWARE_VERSION "([^"]+)"$',sources['LampVersion.h'],re.MULTILINE)[1]
        bodies = '\n'.join(extract.function(sources[name], signature) for name, signature in [
            ('LampUpdate.cpp', 'String versionText('),
            ('LampUpdate.cpp', 'LampUpdatePolicyJsonSnapshot captureLampUpdatePolicyJson()'),
            ('LampUpdate.cpp', 'void appendLampUpdatePolicyJson('),
            ('LampUpdate.cpp', 'String lampUpdatePolicyJson()'),
            ('UpdateHttp.cpp', 'UpdateHttpDiagnosticsSnapshot captureUpdateHttpDiagnostics()'),
            ('UpdateHttpDiagnostics.cpp', 'void appendUpdateHttpDiagnostics('),
            ('LampUpdate.cpp', 'LampUpdateJsonSnapshot captureLampUpdateJson('),
            ('LampUpdate.cpp', 'void appendLampUpdateJson('), ('LampUpdate.cpp', 'String lampUpdateJson()'),
            ('LampAudio.cpp', 'LampAudioJsonSnapshot captureLampAudioJson()'),
            ('LampAudio.cpp', 'void appendLampAudioJson('), ('LampAudio.cpp', 'String lampAudioJson()'),
            ('LampSync.cpp', 'LampSyncJsonSnapshot captureLampSyncJson('),
            ('LampSync.cpp', 'bool appendLampSyncJson(LampJsonSink& s,'),
            ('LampSync.cpp', 'bool appendLampSyncJson(LampJsonSink& reply,'),
            ('LampSync.cpp', 'bool appendLampSyncJson(String&'), ('LampSync.cpp', 'String lampSyncJson(')])
        network=sources['LampNetwork.ino']
        diagnostic=extract.function(network,'String lampDiagnosticsJson()')
        state=extract.function(network,'void sendLampState()')
        timing='template<class HttpMetrics>\n'+extract.function(network,'void appendLampRuntimeTimingJson(')
        bodies+='\n'+extract.function(network,'String jsonText(')+'\n'+timing+'\n'+extract.function(network,'String lampRuntimeTimingJson()')+'\n'+diagnostic+'\n'+extract.function(network,'bool captureLampNetworkText(')+'\n'+extract.function(network,'struct LampNetworkAddressWriter ')+ ';\n'+extract.function(network,'bool captureLampNetworkAddress(')+'\n'+state
        bodies+='\n'+extract.function(network,'String lampEffectCatalogEntry(')
        catalog_registration=extract.registration(network,'/api/effects','GET')
        server=(ROOT/'LampHttpServer.h').read_text()
        metrics=extract.function(server,'struct Metrics ')
        names=network[network.index('const char* const effectNames[]'):network.index('static_assert(sizeof(effectNames)')]
        platform = PLATFORM.replace('ATTEMPT_JSON','\n'.join(extract.function(sources['LampUpdateAttempt.cpp'],signature) for signature in ['StatusSnapshot captureStatus(', 'void appendStatus(', 'String statusJson(const FirmwareManifest& image)']))
        platform=platform.replace('SYNC_JSON_SNAPSHOT',extract.function((ROOT/'LampSync.h').read_text(),'struct LampSyncJsonSnapshot '))
        colors=(ROOT/'LampColors.ino').read_text();sources['LampColors.ino']=colors
        defaults=HANDLER_PLATFORM.replace('DEFAULT_COLOR_FN',extract.function(colors,'LampColor defaultLampColor(uint8_t mode)\n'))
        defaults=defaults.replace('DEFAULT_OPTIONS_FN',extract.function(colors,'LampEffectOptions defaultEffectOptions(uint8_t mode) {'))
        platform+='\n'+defaults.replace('HTTP_METRICS',metrics).replace('EFFECT_NAMES',names)
        target_output=None
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory/'Arduino.h').write_text(ARDUINO)
            (directory/'WString.h').write_bytes((core/'WString.h').read_bytes())
            (directory/'WString.cpp').write_text(raw)
            (directory/'pgmspace.h').write_text('#pragma once\n#include <cstring>\n#define PSTR(s) (s)\n#define memcpy_P memcpy\n')
            (directory/'esp32-hal-log.h').write_text('#pragma once\n#define log_w(...) ((void)0)\n#define log_e(...) ((void)0)\n')
            (directory/'stdlib_noniso.h').write_text(r'''
#pragma once
#include <cstdio>
inline char* itoa(int v,char* s,int){std::sprintf(s,"%d",v);return s;}
inline char* utoa(unsigned v,char* s,int){std::sprintf(s,"%u",v);return s;}
inline char* ltoa(long v,char* s,int){std::sprintf(s,"%ld",v);return s;}
inline char* ultoa(unsigned long v,char* s,int){std::sprintf(s,"%lu",v);return s;}
inline char* lltoa(long long v,char* s,int){std::sprintf(s,"%lld",v);return s;}
inline char* ulltoa(unsigned long long v,char* s,int){std::sprintf(s,"%llu",v);return s;}
inline char* dtostrf(double v,signed int w,unsigned int p,char* s){std::sprintf(s,"%*.*f",w,int(p),v);return s;}
''')
            cpp, binary = directory/'builders.cpp', directory/'builders'
            metric_init=''.join('lampServer.measured.'+m.group(1)+'=UINT32_MAX;' for m in re.finditer(r'\b([A-Za-z_]\w*)=0\b',metrics))
            combined=platform+'\n'+bodies+'\n'+MAIN.replace('HTTP_METRIC_INIT',metric_init).replace('CATALOG_REGISTRATION',catalog_registration)
            cpp.write_text(combined)
            # The diagnostic authentication fixture reuses this exact extracted
            # source and pinned core, rather than mocking the new encoders.
            if os.environ.get('COOLLAMP_STATUS_FIXTURE_DIR'):
                retained=Path(os.environ['COOLLAMP_STATUS_FIXTURE_DIR']);retained.mkdir(exist_ok=True)
                for artifact in directory.iterdir():
                    if artifact.is_file():shutil.copy2(artifact,retained/artifact.name)
            subprocess.run(['c++', '-std=c++17', '-fno-elide-constructors', '-Wall', '-Wextra', '-Werror',
                            '-Wno-misleading-indentation', '-Wno-sign-compare', '-I'+str(directory), '-I'+str(ROOT),
                            *SANITIZERS, str(cpp), str(directory/'WString.cpp'), '-o', str(binary)], check=True)
            output = subprocess.run([str(binary)], capture_output=True, text=True,timeout=20)
            if output.returncode and os.environ.get('COOLLAMP_KEEP_STATUS_FIXTURE'):
                retained=ROOT/'.build/status-builder-failure';retained.mkdir(exist_ok=True)
                for artifact in directory.iterdir():
                    if artifact.is_file():shutil.copy2(artifact,retained/artifact.name)
            self.assertEqual(output.returncode,0,output.stderr[-2500:])
            # Synthetic canonical names/255 advertised entries exercise the
            # actual read handler's escaping and integer iteration. This is
            # handler completeness only; the real transport's unchanged8KiB
            # response cap separately rejects an oversized future v1 catalog.
            ordinary_names=re.findall(r'"([^"\n]*)"',names)
            unusual_names=ordinary_names+['Future '+str(i) for i in range(48,256)]
            unusual_names[:4]=['Quote" and backslash\\','LF\nCR\rTAB\t','Control\x01\x1f','Future café']
            future_names='const char* const effectNames[]={'+','.join(json.dumps(value,ensure_ascii=False).replace('\\u0001','\\001').replace('\\u001f','\\037') for value in unusual_names)+'};'
            future=combined.replace(names,future_names).replace('availableEffects=47;measureCatalog("catalog47");','availableEffects=47;measureCatalog("catalog47");measureCatalogLoop255();').replace('int main(){','int main(){useCanonicalNames=false;')
            cpp.write_text(future)
            subprocess.run(['c++','-std=c++17','-fno-elide-constructors','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-Wno-sign-compare','-I'+str(directory),'-I'+str(ROOT),*SANITIZERS,str(cpp),str(directory/'WString.cpp'),'-o',str(binary)],check=True)
            future_output=subprocess.run([str(binary)],capture_output=True,text=True,timeout=20)
            self.assertEqual(future_output.returncode,0,future_output.stderr)
            # One additional model uses the target's exact 15-byte SSO array
            # (14 data bytes). All String methods remain pinned; this is a
            # test-local ABI model, not a target heap measurement.
            header=(core/'WString.h').read_text()
            self.assertEqual(header.count('SSOSIZE = sizeof(struct _ptr) + 4 - 1'),1)
            (directory/'WString.h').write_text(header.replace('SSOSIZE = sizeof(struct _ptr) + 4 - 1','SSOSIZE = 15'))
            cpp.write_text(combined)
            subprocess.run(['c++','-std=c++17','-fno-elide-constructors','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-Wno-sign-compare','-I'+str(directory),'-I'+str(ROOT),*SANITIZERS,str(cpp),str(directory/'WString.cpp'),'-o',str(binary)],check=True)
            target_output=subprocess.run([str(binary)],capture_output=True,text=True,timeout=20)
            self.assertEqual(target_output.returncode,0,target_output.stderr[-2500:])
        rows=[json.loads(line) for line in output.stdout.splitlines()]
        snapshot_sizes=next(row['snapshotSizes'] for row in rows if 'snapshotSizes' in row)
        results = [row for row in rows if 'name' in row]
        self.assertEqual([r['name'] for r in results], ['update','policy','audio','sync','stateSync','fullState','fullDiagnostics','catalog38','catalog47','fourMemberState','fourMemberDiagnostics','lowMemoryCatalog47','cool2Profile47State','cool2Profile47Diagnostics','cool2Profile38State','cool2Profile38Diagnostics','connected47StateHttp','connected47StateBle','compactUpdate'])
        compact=results[-1];self.assertLess(compact['bytes'],2048);self.assertEqual(compact['value']['deviceId'],'aabbccddeeff')
        self.assertEqual(compact['value']['automaticService'],dict(version=1,state=6,reason=24,retryInMs=21600000,donorWaitMs=30000,internetAttempts=65535,donorOffers=65535,attention=False,phoneFallback=False,newerSeen=False))
        for result in results:
            nested=result['value'].get('firmware') if isinstance(result['value'],dict) else None
            if isinstance(nested,dict):
                self.assertNotIn('automaticService',nested,result['name']);self.assertNotIn('deviceId',nested,result['name'])
            firmware=result['value'] if result['name'] in ('update','compactUpdate') else nested
            if isinstance(firmware,dict):
                self.assertEqual(firmware['version'],current_version,result['name']+' reports the wrong release version')
                self.assertEqual(firmware['build'],'COOLLAMP-LOCAL-'+current_version,result['name']+' reports the wrong build identity')
        names=re.findall(r'"([^"\n]*)"',names)
        for result in results[7:9]+results[11:12]:
            value=result['value'];self.assertEqual(len(value),38 if result['name']=='catalog38' else 47)
            self.assertEqual([entry['id'] for entry in value],list(range(1,len(value)+1)))
            self.assertEqual([entry['name'] for entry in value],names[:len(value)])
            self.assertTrue(all(set(entry)=={'id','name','category','speed'} and isinstance(entry['speed'],bool) for entry in value))
        future_rows=[json.loads(line) for line in future_output.stdout.splitlines() if '"name":' in line]
        future_catalog=next(row for row in future_rows if row['name']=='catalogLoop255')
        self.assertTrue(future_catalog['handlerLoopOnly'])
        self.assertEqual(future_catalog['status'],503)
        unusual_catalog=next(row for row in future_rows if row['name']=='catalog47')
        self.assertEqual([entry['id'] for entry in unusual_catalog['value']],list(range(1,48)))
        self.assertEqual([entry['name'] for entry in unusual_catalog['value']],unusual_names[:47])
        self.assertEqual(results[0]['value']['latest'], '65535.65535.65535')
        self.assertEqual(results[0]['value']['policy'], results[1]['value'])
        self.assertEqual(results[2]['value']['gain'], 255)
        self.assertEqual(results[2]['value']['error'], -(1 << 31))
        self.assertEqual(len(results[3]['value']['peers']), 8)
        self.assertEqual(results[3]['value']['peers'][0]['name'], '"'*48)
        self.assertEqual(len(results[3]['value']['order']), 32)
        self.assertEqual(len(results[4]['value']['peers']), 1)
        self.assertEqual(results[4]['value']['order'], results[3]['value']['order'])
        for result in results[:5]:
            self.assertEqual(result['largeCopies'], 0)
            self.assertLess(result['largestStringCopyBytes'], 256)
        for result in results[:9]:
            # New bounded negotiation fields are additive. Preserve the exact
            # historical payload oracle after projecting only those fields and
            # the explicitly verified release version/build identity above.
            value=json.loads(json.dumps(result['value']))
            firmware=value if result['name']=='update' else value.get('firmware') if isinstance(value,dict) else None
            if isinstance(firmware,dict):
                firmware['version']=LEGACY_FIXTURE_VERSION
                firmware['build']='COOLLAMP-LOCAL-'+LEGACY_FIXTURE_VERSION
            audio=value if result['name']=='audio' else value.get('audio') if isinstance(value,dict) else None
            if isinstance(audio,dict):
                self.assertEqual(audio['captureVersion'],1)
                self.assertIs(audio['enabled'],False)
                self.assertEqual(audio['captureStatus'],4)
                for key in ['captureVersion','enabled','captureStatus']:audio.pop(key)
            if isinstance(value,dict):
                value.pop('motionPath',None);value.pop('motionVersion',None)
            digest=hashlib.sha256(json.dumps(value,separators=(',',':')).encode()).hexdigest()
            self.assertEqual(digest,LEGACY_PAYLOAD_DIGESTS[result['name']],result['name']+' legacy JSON changed')
        self.assertLess(results[5]['peakStringPayloadBytes'],15696)
        self.assertLess(results[6]['peakStringPayloadBytes'],16096)
        target_results=[json.loads(line) for line in target_output.stdout.splitlines() if '"name":' in line]
        for result in results[16:18]+[r for r in target_results if r['name'].startswith('connected47')]:
            self.assertLessEqual(result['peakStringPayloadBytes'],15508-8704)
            value=result['value'];self.assertEqual(value['dns'][0],'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
            self.assertEqual(value['hostname'],'coollamp-abcdef.local')
            self.assertEqual(len(value['effects']),47);self.assertEqual(len(value['sync']['order']),4)
            self.assertEqual('token' in value,result['name'].endswith('Http'))
        for result in results[9:]:
            self.assertLessEqual(result['peakStringPayloadBytes'],16316-8192)
            if result['name'].startswith('fourMember'):
                self.assertEqual(len(result['value']['sync']['order']),4)
                self.assertLessEqual(result['bytes'],7668)
            if result['name'].startswith('cool2Profile'):
                value=result['value'];sync=value['sync'];self.assertEqual(sync['version'],2)
                self.assertEqual(sync['role'],1);self.assertEqual(sync['scene'],24);self.assertEqual(sync['count'],4)
                self.assertEqual(len(sync['order']),4);self.assertEqual(sync['peerTotal'],4)
                self.assertTrue(all('name' in member for member in sync['order']))
                if result['name'].endswith('State'):
                    self.assertEqual((value['leds'],value['mode'],value['brightness'],value['power']),(134,46,55,True))
                    self.assertEqual(len(value['effects']),47 if '47' in result['name'] else 38)
                else:self.assertEqual(value['render']['leds'],134)
        report = dict(hostOnly=True, hardwareTouched=False, pinnedCoreVersion='3.3.11',
                      pinnedStringHashes={name:hashlib.sha256((core/name).read_bytes()).hexdigest() for name in ['WString.cpp','WString.h']},
                      sources={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in sources},
                      returnElisionDisabled=True, allocationCopyCanaryPassed=True,
                      allSingleAllocationFailureBoundariesReturnEmpty=True,
                      fullHandlerForcedMovingRealloc=True,fullHandlerNewAppendFailureBoundariesReturnFailedRead=True,
                      catalogHandlerSingleAllocationFailuresReturn503=True,
                      exactLegacyPayloadProjectionDigests=True,additiveNegotiationFieldsOnly=['audio.captureVersion','audio.enabled','audio.captureStatus','motionPath','motionVersion'],checkedCountWriteBoundaryCases=True,
                      reportedReleaseVersionVerified=current_version,legacyFixtureVersion=LEGACY_FIXTURE_VERSION,
                      releaseVersionNormalizationOnly=['firmware.version','firmware.build'],
                      catalogUnusualCanonicalNamesRoundTrip=True,catalogUint8MaximumLoopTerminates=True,
                      catalog255FixtureIsHandlerOnly=True,catalog255FixtureStatus=future_catalog['status'],
                      lowMemoryFixture={'freeHeapBytes':16316,'largestBlockBytes':7668,'durableMembers':4},
                      connectedLowMemoryFixture={'freeHeapBytes':15508,'largestBlockBytes':7668,'ipv6DnsPreserved':True,'httpTokenBytes':32,'httpAndPrivateBle':True,'unchangedReplyHeadroomBytes':8704},
                      targetSsoArrayModelBytes=15,targetSsoModelIsNotPhysicalHeap=True,
                      targetSsoModelResults=[{k:v for k,v in r.items() if k!='value'} for r in target_results],
                      snapshotStructBytesHost=snapshot_sizes,snapshotStructSizesAreNotTargetSizes=True,
                      worst32MemberReadRejectedAtLowMemory=True,
                      maximizedFourMemberV2StateAcceptedAtLowMemory=next(row for row in rows if row.get('maxAppearanceLowMemory')),
                      cool2Fixture={'leds':134,'groupVersion':2,'groupCount':4,'role':1,'scene':24,'mode':46,'brightness':55,'publicFabricatedNames':True,'scalarCountersConservative':True,'appearance':'production defaults; target saved appearance unavailable','catalogs':[38,47]},
                      measuredScope='String payload allocation only; host pointer/SSO sizes differ; excludes allocator transient and SDK allocations',
                      results=[dict(**{k:v for k,v in r.items() if k!='value'},
                                    finalReplyReservationBytes=(r['bytes']+16)&~15,
                                    minimumRemainingModeledHeapBytes=(15508 if r['name'].startswith('connected47') else 16316)-r['peakStringPayloadBytes'] if r in results[9:] else None,
                                    payloadSha256=hashlib.sha256(json.dumps(r['value'],separators=(',',':')).encode()).hexdigest()) for r in results])
        (ROOT/'.build').mkdir(exist_ok=True)
        report_path=Path(os.environ.get('COOLLAMP_STATUS_BUILDER_REPORT',str(ROOT/'.build/status-builder-memory.json')))
        report_path.write_text(json.dumps(report, indent=2)+'\n')
        print('PASS: pinned WString production builders return without a >=256-byte String copy, including with NRVO disabled.')
        for result in report['results']:
            print(json.dumps(result))


if __name__ == '__main__':
    unittest.main()
