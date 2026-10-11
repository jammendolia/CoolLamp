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
#include "WString.h"
#define portENTER_CRITICAL(value) ((void)(value))
#define portEXIT_CRITICAL(value) ((void)(value))
inline uint32_t millis(){return 1000;}
[[maybe_unused]] inline struct {uint32_t getFreeHeap(){return 327680;}uint32_t getMinFreeHeap(){return 327680;}uint32_t getMaxAllocHeap(){return 327680;}uint64_t getEfuseMac(){return 0xaabbccddeeffULL;}} ESP;
'''

PLATFORM = r'''
#include "Arduino.h"
#include "LampAudio.h"
#include "LampUpdate.h"
#include "LampSyncProtocol.h"
#include "LampHttpJson.h"
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
std::unordered_map<void*,size_t> allocations;
void observeStringCopy(size_t n){stats.maxCopy=std::max(stats.maxCopy,n);if(n>=256)++stats.largeCopies;}
bool denyAllocation(){++stats.calls;if(syncScope)++syncAllocationCalls;const size_t call=failOnlySync?syncAllocationCalls:stats.calls;if(failAllocation&&call==failAllocation&&(!failOnlySync||syncScope)){++stats.failures;return true;}return false;}
void* observedMalloc(size_t n){if(denyAllocation())return nullptr;void* p=std::malloc(n);if(p){allocations[p]=n;stats.live+=n;stats.peak=std::max(stats.peak,stats.live);}return p;}
void* observedRealloc(void* p,size_t n){if(denyAllocation())return nullptr;size_t previous=p?allocations.at(p):0;void* next=forceMove?std::malloc(n):std::realloc(p,n);if(next){if(forceMove){stats.peak=std::max(stats.peak,stats.live+n);if(p){std::memcpy(next,p,std::min(previous,n));std::free(p);}}if(p)allocations.erase(p);allocations[next]=n;stats.live=stats.live-previous+n;stats.peak=std::max(stats.peak,stats.live);}return next;}
void observedFree(void* p){if(p){stats.live-=allocations.at(p);allocations.erase(p);}std::free(p);}
bool installed=true;uint8_t gain=255;uint16_t gate=65535,scale=65535;
uint32_t lampRenderedFrames=UINT32_MAX,lampMaxRenderUs=UINT32_MAX;
LampAudioFeatures getLampAudioFeatures(){LampAudioFeatures f{};f.sequence=f.timestamp=f.errors=f.overruns=UINT32_MAX;f.stackFree=6144;f.rms=f.peak=f.effectiveGain=f.noiseFloor=f.effectiveGate=f.bass=f.mid=f.treble=UINT16_MAX;f.beat=f.bassBeat=UINT32_MAX;f.level=255;f.error=INT32_MIN;return f;}
LampUpdateStatus getLampUpdateStatus(){LampUpdateStatus s{};s.phase=UPDATE_ERROR;s.progress=100;s.error=UPDATE_MEMORY;s.latest[0]=s.latest[1]=s.latest[2]=UINT16_MAX;s.route=UPDATE_ROUTE_MANUAL_UPLOAD;s.checkedAt=UINT32_MAX;s.writtenOffset=s.totalBytes=2031616;return s;}
FirmwareManifest candidate{};unsigned mux=0;
void* worker=reinterpret_cast<void*>(1);bool healthy=false;
constexpr int MALLOC_CAP_8BIT=1;unsigned heap_caps_get_largest_free_block(int){return 327680;}
unsigned uxTaskGetStackHighWaterMark(void*){return 6144;}
namespace UpdatePublisher {bool enforced(){return false;}}
bool policyReadable=false;LampUpdatePolicy::Policy updatePolicy;uint32_t policyRevision=UINT32_MAX;
LampUpdatePolicy::Eligibility policyEligibility(){return LampUpdatePolicy::InvalidPolicy;}
uint8_t lampRolloutAutomaticAdmissionSnapshotReason(){return 4;}
std::atomic<int> httpStage{INT32_MIN},httpCode{INT32_MIN},httpHost{INT32_MIN},tlsError{INT32_MIN},tlsFlags{INT32_MIN},transportError{INT32_MIN};
namespace LampUpdateAttempt {constexpr unsigned Capacity=4;unsigned mux=0;bool readable=false;uint8_t count=4;int find(const FirmwareManifest&){return 0;}
ATTEMPT_JSON
}
constexpr int WL_CONNECTED=3;
using namespace LampSyncWire;
struct {uint8_t role=1;char leader[13]="aabbccddeeff",key[33]="0123456789abcdef0123456789abcdef";} config;
struct Address {String toString(){return "192.168.255.254";}};
struct {int status(){return 0;}Address localIP(){return {};}Address gatewayIP(){return {};}Address dnsIP(int){return {};}int RSSI(){return -128;}unsigned channel(){return 14;}String BSSIDstr(){return "aa:bb:cc:dd:ee:ff";}Address subnetMask(){return {};}unsigned softAPgetStationNum(){return 255;}} WiFi;
struct Peer {Packet info{};bool joined=true;uint32_t seen=1000,subscribed=1000;bool udpKnown=true,radioKnown=true;uint32_t udpSeen=1000,radioSeen=1000;Address ip;uint8_t radioChannel=14;} peers[31];
struct {uint8_t count=32;char order[32][13]{};} sceneConfig;
char identity[13]="aabbccddeeff";bool paused=false,followingRadio=true,started=true,serviceBlocked=false;
uint8_t wireVersion=ExpandedVersion;uint64_t nonce=0x123456789abcdef0ULL;
bool slotSaved=false;struct {char leader[13]{};} followerSlot;
uint32_t slotSaveFailures=UINT32_MAX,incompatibleSubscriptions=UINT32_MAX;
uint32_t receivedPackets=UINT32_MAX,discoveries=UINT32_MAX,authFailures=UINT32_MAX,subscriptionsSent=UINT32_MAX,framesReceived=UINT32_MAX,clockDrops=UINT32_MAX;
bool lampSyncFollowing(){return false;}bool lampRolloutPinsMembership(){return false;}
String lampSyncIncarnation(){return "fefefefefefefefefefefefefefefefe";}
namespace LampEspNow {struct Status {bool active=true,suspended=false,seeking=false;uint8_t channel=14;uint32_t received=UINT32_MAX,receiveDropped=UINT32_MAX,sent=UINT32_MAX,sendFailed=UINT32_MAX,sendDropped=UINT32_MAX,channelChanges=UINT32_MAX;};Status status(){return {};}}
Visual lampGroupVisual(){Visual v{};v.scene=32;v.count=32;v.sceneSpeed=v.sceneIntensity=100;memset(v.scenePrimary,255,3);memset(v.sceneSecondary,255,3);return v;}
bool appendLampSyncJson(String&,uint8_t peerCursor=0,uint8_t peerLimit=8);
'''

HANDLER_PLATFORM = r'''
#include "LampConfig.h"
#include "LampFactory.h"
#include "LampRuntimeMetrics.h"
#define COOL_LAMP_AUDIO_EFFECTS 1
constexpr unsigned LAMP_PROTOCOL_VERSION=1,LAMP_BASE_EFFECT_COUNT=38,MODE_FIRE=4;
LampSettings lampSettings{};
String lampHost="test-host",lampToken="fixturetoken";
const char* lampName="A bounded public fixture lamp name";
uint16_t NUM_LEDS=1024,lampMidpoint=512;uint8_t Mode=4,Brightness=255;bool PowerOn=true;
uint8_t availableEffects=47;
uint8_t lampAvailableEffectCount(){return availableEffects;}
struct Color {uint8_t enabled=1,r=255,g=255,b=255;};Color getLampColor(uint8_t){return {};}
struct Options {uint8_t speed=100,intensity=100,dual=1,r=255,g=255,b=255;};Options getLampEffectOptions(uint8_t){return {};}
struct RGB {uint8_t r=255,g=255,b=255;};RGB fountainPaletteColor(unsigned){return {};}RGB renderVuColor(unsigned){return {};}
bool lampCalibrationActive(){return false;}bool lampCalibrationCenter(){return false;}unsigned lampCalibrationPosition(){return NUM_LEDS-1;}
unsigned lampSplitCount(uint16_t,uint16_t){return 512;}
struct {bool enabled=false,random=false;uint8_t category=255;uint32_t seconds=UINT32_MAX;} lampRotation;
String lampStyleJson(){return "{\"version\":1,\"code\":3,\"id\":\"corkscrew\",\"family\":\"corkscrew\"}";}
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
 bool controlActive(){return false;}
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
    stats={};failAllocation=n;
    {String failed=f();if(failed.length()){std::cerr<<name<<" did not reject allocation failure "<<n<<"/"<<calls<<": "<<failed.c_str()<<"\n";}assert(stats.failures==1&&failed.length()==0);}
    assert(stats.live==0&&allocations.empty());
  }
  failAllocation=0;
}
template<typename F> void measureHandler(const char* name,F f,bool checkFailures=true){
  assert(stats.live==0);stats={};syncAllocationCalls=0;forceMove=true;
  size_t calls=0;
  {String result=f();assert(result.length());calls=syncAllocationCalls;
   std::cout<<"{\"name\":\""<<name<<"\",\"bytes\":"<<result.length()<<",\"peakStringPayloadBytes\":"<<stats.peak<<",\"largestStringCopyBytes\":"<<stats.maxCopy<<",\"largeCopies\":"<<stats.largeCopies<<",\"allocationFailureCases\":"<<(checkFailures?calls:0)<<",\"value\":"<<result.c_str()<<"}\n";}
  assert(stats.live==0&&allocations.empty());
  if(checkFailures&&calls)for(size_t n=1;n<=calls;++n){
    stats={};syncAllocationCalls=0;failAllocation=n;failOnlySync=true;
    {String failed=f();assert(stats.failures==1&&failed.length()==0);}
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
  lampServer.catalogRead();assert(lampServer.status==200);
  size_t count=0;assert(LampHttpJson::arrayCount(lampServer.body.c_str(),lampServer.body.length(),count)&&count==255);
  std::cout<<"{\"name\":\"catalogLoop255\",\"bytes\":"<<lampServer.body.length()<<",\"handlerLoopOnly\":true,\"value\":"<<lampServer.body.c_str()<<"}\n";
  lampServer.body=static_cast<const char*>(nullptr);assert(stats.live==0&&allocations.empty());forceMove=false;
}
// Prove the observer catches the exact StringSumHelper return-copy failure.
String copyCanary(){String s;assert(s.reserve(4096));for(unsigned i=0;i<4096;++i)s+='x';return s+"]}";}
int main(){
  {String canary=copyCanary();assert(canary.length()==4098&&stats.largeCopies>=2&&stats.maxCopy>=4096&&stats.peak>=8192);}
  assert(stats.live==0);
  memset(updatePolicy.timezone,'T',63);updatePolicy.timezone[63]=0;updatePolicy.startMinute=updatePolicy.endMinute=65535;updatePolicy.idleSeconds=UINT32_MAX;
  strcpy(sceneConfig.order[0],identity);
  for(unsigned i=0;i<31;++i){auto& p=peers[i];snprintf(p.info.sender,13,"%012x",i+1);p.info.role=2;p.info.version=3;p.info.microphone=1;memset(p.info.name,'"',48);p.info.name[48]=0;strcpy(sceneConfig.order[i+1],p.info.sender);}
  measure("update",[]{return lampUpdateJson();});measure("policy",[]{return lampUpdatePolicyJson();});measure("audio",[]{return lampAudioJson();});
  measure("sync",[]{return lampSyncJson(0,8);});measure("stateSync",[]{return lampSyncJson(0,1);});
  lampSettings.version=1;lampSettings.ledCount=1024;lampSettings.milliAmps=65535;lampSettings.brightness=255;lampSettings.startupMode=4;memset(lampSettings.ssid,'"',32);lampSettings.ssid[32]=0;
  diagnosticMetrics.loops=diagnosticMetrics.shows=diagnosticMetrics.animationShows=UINT32_MAX;
  diagnosticMetrics.maxLoopUs=diagnosticMetrics.maxLoopGapUs=diagnosticMetrics.maxNetworkServiceUs=diagnosticMetrics.maxBluetoothServiceUs=diagnosticMetrics.maxBeforeRenderUs=UINT32_MAX;
  diagnosticMetrics.maxShowUs=diagnosticMetrics.maxFrameGapUs=diagnosticMetrics.maxAnimationFrameGapUs=diagnosticMetrics.animationGapOverruns=UINT32_MAX;
  for(auto* w:{&diagnosticMetrics.currentWindow,&diagnosticMetrics.lastWindow}){w->sequence=w->startUs=w->endUs=w->observedThroughUs=w->observations=w->animationFrames=w->maxAnimationGapUs=w->animationGapOverruns=UINT32_MAX;}
  HTTP_METRIC_INIT
  measureHandler("legacyFullState",[]{sendLampStateLegacy();assert(lampServer.status==200);return std::move(lampServer.body);},false);
  measureHandler("fullState",[]{sendLampState();if(lampServer.status!=200){lampServer.body=static_cast<const char*>(nullptr);return String();}return std::move(lampServer.body);});
  measureHandler("legacyFullDiagnostics",[]{return lampDiagnosticsJsonLegacy();},false);
  measureHandler("fullDiagnostics",[]{return lampDiagnosticsJson();});
  CATALOG_REGISTRATION
  availableEffects=38;measureCatalog("catalog38");
  availableEffects=47;measureCatalog("catalog47");
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
        sources = {name: (ROOT/name).read_text() for name in ['LampSync.cpp', 'LampUpdate.cpp', 'LampAudio.cpp', 'LampUpdateAttempt.cpp', 'UpdateHttp.cpp']}
        sources['LampNetwork.ino']=(ROOT/'LampNetwork.ino').read_text()
        bodies = '\n'.join(extract.function(sources[name], signature) for name, signature in [
            ('LampUpdate.cpp', 'String versionText('), ('LampUpdate.cpp', 'String lampUpdatePolicyJson()'),
            ('UpdateHttp.cpp', 'String updateHttpDiagnostics()'), ('LampUpdate.cpp', 'String lampUpdateJson()'),
            ('LampAudio.cpp', 'String lampAudioJson()'), ('LampSync.cpp', 'String quote('),
            ('LampSync.cpp', 'bool appendLampSyncJson('), ('LampSync.cpp', 'String lampSyncJson(')])
        bodies=bodies.replace('bool appendLampSyncJson(String& s,','bool appendLampSyncJsonImplementation(String& s,')
        bodies+='\nbool appendLampSyncJson(String& s,uint8_t cursor,uint8_t limit){const bool previous=syncScope;syncScope=true;const bool okay=appendLampSyncJsonImplementation(s,cursor,limit);syncScope=previous;return okay;}\n'
        network=sources['LampNetwork.ino']
        diagnostic=extract.function(network,'String lampDiagnosticsJson()')
        state=extract.function(network,'void sendLampState()')
        old_diagnostic=diagnostic.replace('String lampDiagnosticsJson()','String lampDiagnosticsJsonLegacy()').replace('out += ",\\\"sync\\\":";if(!appendLampSyncJson(out))return String();','out += ",\\\"sync\\\":";out += lampSyncJson(0,8);')
        old_state=state.replace('void sendLampState()','void sendLampStateLegacy()').replace('state += ",\\\"sync\\\":";if(!appendLampSyncJson(state,0,1)){lampServer.send(503,"text/plain","State response memory unavailable. Nothing changed.");return;}','state += ",\\\"sync\\\":";state += lampSyncJson(0,1);')
        self.assertNotIn('appendLampSyncJson',old_diagnostic)
        self.assertNotIn('appendLampSyncJson',old_state)
        bodies+='\n'+extract.function(network,'String jsonText(')+'\n'+extract.function(network,'String lampRuntimeTimingJson()')+'\n'+diagnostic+'\n'+old_diagnostic+'\n'+state+'\n'+old_state
        bodies+='\n'+extract.function(network,'String lampEffectCatalogEntry(')
        catalog_registration=extract.registration(network,'/api/effects','GET')
        server=(ROOT/'LampHttpServer.h').read_text()
        metrics=extract.function(server,'struct Metrics ')
        names=network[network.index('const char* const effectNames[]'):network.index('static_assert(sizeof(effectNames)')]
        platform = PLATFORM.replace('ATTEMPT_JSON', extract.function(sources['LampUpdateAttempt.cpp'], 'String statusJson(const FirmwareManifest& image)'))
        platform+='\n'+HANDLER_PLATFORM.replace('HTTP_METRICS',metrics).replace('EFFECT_NAMES',names)
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
            subprocess.run(['c++', '-std=c++17', '-fno-elide-constructors', '-Wall', '-Wextra', '-Werror',
                            '-Wno-misleading-indentation', '-Wno-sign-compare', '-I'+str(directory), '-I'+str(ROOT),
                            *SANITIZERS, str(cpp), str(directory/'WString.cpp'), '-o', str(binary)], check=True)
            output = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(output.returncode,0,output.stderr)
            # Disable only the new canonical-name fence in a private copy of
            # the actual handler. Pinned String failures must then demonstrate
            # a syntactically valid wrong catalog, proving the positive sweep
            # is not satisfied solely by the transport's syntax validator.
            self.assertIn('!nameMatches(name,effectNames[mode-1])',combined)
            canary=combined.replace('!nameMatches(name,effectNames[mode-1])','false').replace('const auto nameMatches=[]','[[maybe_unused]] const auto nameMatches=[]').replace('const auto name=LampHttpJson','[[maybe_unused]] const auto name=LampHttpJson')
            cpp.write_text(canary)
            subprocess.run(['c++','-std=c++17','-DCATALOG_GUARD_CANARY=1','-fno-elide-constructors','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-Wno-sign-compare','-I'+str(directory),'-I'+str(ROOT),*SANITIZERS,str(cpp),str(directory/'WString.cpp'),'-o',str(binary)],check=True)
            negative=subprocess.run([str(binary)],capture_output=True,text=True)
            self.assertEqual(negative.returncode,0,negative.stderr)
            # Synthetic canonical names/255 advertised entries exercise the
            # actual read handler's escaping and integer iteration. This is
            # handler completeness only; the real transport's unchanged8KiB
            # response cap separately rejects an oversized future v1 catalog.
            ordinary_names=re.findall(r'"([^"\n]*)"',names)
            unusual_names=ordinary_names+['Future '+str(i) for i in range(48,256)]
            unusual_names[:4]=['Quote" and backslash\\','LF\nCR\rTAB\t','Control\x01\x1f','Future café']
            future_names='const char* const effectNames[]={'+','.join(json.dumps(value,ensure_ascii=False).replace('\\u0001','\\001').replace('\\u001f','\\037') for value in unusual_names)+'};'
            future=combined.replace(names,future_names).replace('availableEffects=47;measureCatalog("catalog47");','availableEffects=47;measureCatalog("catalog47");measureCatalogLoop255();')
            cpp.write_text(future)
            subprocess.run(['c++','-std=c++17','-fno-elide-constructors','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-Wno-sign-compare','-I'+str(directory),'-I'+str(ROOT),*SANITIZERS,str(cpp),str(directory/'WString.cpp'),'-o',str(binary)],check=True)
            future_output=subprocess.run([str(binary)],capture_output=True,text=True)
            self.assertEqual(future_output.returncode,0,future_output.stderr)
        results = [json.loads(line) for line in output.stdout.splitlines()]
        self.assertEqual([r['name'] for r in results], ['update','policy','audio','sync','stateSync','legacyFullState','fullState','legacyFullDiagnostics','fullDiagnostics','catalog38','catalog47'])
        negative_rows=[json.loads(line) for line in negative.stdout.splitlines()]
        canary_cases=[r for r in negative_rows if 'negativeCatalogCase' in r]
        self.assertEqual(len(canary_cases),2)
        names=re.findall(r'"([^"\n]*)"',names)
        for result in results[-2:]:
            value=result['value'];self.assertEqual(len(value),38 if result['name']=='catalog38' else 47)
            self.assertEqual([entry['id'] for entry in value],list(range(1,len(value)+1)))
            self.assertEqual([entry['name'] for entry in value],names[:len(value)])
            self.assertTrue(all(set(entry)=={'id','name','category','speed'} and isinstance(entry['speed'],bool) for entry in value))
            legacy_success=next(r for r in negative_rows if r.get('name')==result['name'])
            self.assertEqual(value,legacy_success['value'])
        for row in canary_cases:self.assertNotEqual([entry['name'] for entry in row['value']],names[:len(row['value'])])
        future_rows=[json.loads(line) for line in future_output.stdout.splitlines()]
        future_catalog=next(row for row in future_rows if row['name']=='catalogLoop255')
        self.assertTrue(future_catalog['handlerLoopOnly'])
        self.assertEqual(len(future_catalog['value']),255)
        self.assertEqual([entry['id'] for entry in future_catalog['value']],list(range(1,256)))
        self.assertEqual([entry['name'] for entry in future_catalog['value']],unusual_names)
        self.assertGreater(future_catalog['bytes'],8192) # No new transport capability is claimed.
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
        self.assertEqual(results[5]['value'],results[6]['value'])
        self.assertEqual(results[7]['value'],results[8]['value'])
        # State grows later while formatting appearance arrays; removing its
        # earlier compact Sync buffer need not reduce that separate peak.
        self.assertLessEqual(results[6]['peakStringPayloadBytes'],results[5]['peakStringPayloadBytes'])
        self.assertLess(results[8]['peakStringPayloadBytes'],results[7]['peakStringPayloadBytes'])
        report = dict(hostOnly=True, hardwareTouched=False, pinnedCoreVersion='3.3.11',
                      pinnedStringHashes={name:hashlib.sha256((core/name).read_bytes()).hexdigest() for name in ['WString.cpp','WString.h']},
                      sources={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in sources},
                      returnElisionDisabled=True, allocationCopyCanaryPassed=True,
                      allSingleAllocationFailureBoundariesReturnEmpty=True,
                      fullHandlerForcedMovingRealloc=True,fullHandlerNewAppendFailureBoundariesReturnFailedRead=True,
                      catalogHandlerSingleAllocationFailuresReturn503=True,
                      catalogNegativeNameFenceCanaryFalseSuccesses=[r['falseSuccesses'] for r in negative_rows if 'negativeCatalogCanary' in r],
                      catalogUnusualCanonicalNamesRoundTrip=True,catalogUint8MaximumLoopTerminates=True,
                      catalog255FixtureIsHandlerOnly=True,catalog255FixtureBytes=future_catalog['bytes'],
                      measuredScope='String payload allocation only; host pointer/SSO sizes differ; excludes allocator transient and SDK allocations',
                      results=[dict(**{k:v for k,v in r.items() if k!='value'},
                                    payloadSha256=hashlib.sha256(json.dumps(r['value'],separators=(',',':')).encode()).hexdigest()) for r in results])
        (ROOT/'.build').mkdir(exist_ok=True)
        report_path=Path(os.environ.get('COOLLAMP_STATUS_BUILDER_REPORT',str(ROOT/'.build/status-builder-memory.json')))
        report_path.write_text(json.dumps(report, indent=2)+'\n')
        print('PASS: pinned WString production builders return without a >=256-byte String copy, including with NRVO disabled.')
        for result in report['results']:
            print(json.dumps(result))


if __name__ == '__main__':
    unittest.main()
