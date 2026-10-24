"""Production compact handlers/adapter with pinned core3.3.11 String allocation.

Radio/LED/clock are fixtures. Actual parse/admission/ledger/partial setters and
receipt/revision serializers execute; this measures String payload allocations,
not SDK or physical heap. The unchanged8704-byte margin remains independent.
"""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('status_memory',ROOT/'tests/status-builder-memory.py')
memory=importlib.util.module_from_spec(spec);spec.loader.exec_module(memory)
extract=memory.extract.function
core=memory.core_path()
for name,expected in memory.PINNED_STRING_HASHES.items():
    assert hashlib.sha256((core/name).read_bytes()).hexdigest()==expected
tree=ast.parse((ROOT/'tests/espnow-runtime.py').read_text())
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='verified_source' or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('SOURCE','ARCHIVE_SHA','PRIMITIVES') for t in n.targets)]
scope=dict(Path=Path,hashlib=hashlib,json=json,tarfile=tarfile)
exec(compile(ast.Module(body=nodes,type_ignores=[]),'verified_source','exec'),scope)
crypto=scope['verified_source'](ROOT/'.build/tls-library')
experience=(ROOT/'LampExperience.ino').read_text();colors=(ROOT/'LampColors.ino').read_text()
network=(ROOT/'LampNetwork.ino').read_text()
functions='\n'.join(extract(experience,name) for name in ['bool commandHexParse(', 'bool commandRevisionParse(', 'void observeLampAppearance(', 'String receiptJson(', 'void commandDigest(', 'bool admitLampCommand(', 'void finishLampCommand(', 'String lampRevisionJson()', 'void handleLampStatePatch()'])
fields='\n'.join(line for line in experience.splitlines() if line.startswith('const char* const lightCommandFields') or line.startswith('const char* const commandFields'))
defaults='\n'.join(extract(colors,name) for name in ['static uint8_t appendedAppearanceBit(', 'LampColor defaultLampColor(uint8_t mode)\n','LampEffectOptions defaultEffectOptions(uint8_t mode) {','bool setLampColor(', 'bool resetLampColor(', 'bool setLampEffectOptions('])
platform=r'''
#include "Arduino.h"
#include "LampControlHttpAdapter.h"
#include "LampControl.h"
#include "LampCommandLedger.h"
#include "LampEffectSchema.h"
#include <mbedtls/sha256.h>
LampControlHttpAdapter lampServer(80);String lampToken="private-token";
uint32_t esp_random(){return 123;}
LampCommands::Ledger lightCommands;
uint16_t NUM_LEDS=205;uint8_t Mode=4,Brightness=100;bool PowerOn=true;
constexpr uint8_t MODE_MAX=LAMP_EFFECT_CAPACITY;
bool following=false,calibrating=false,updating=false,resetting=false;uint8_t scene=0;
bool lampHasMicrophone(){return true;}bool lampMicrophoneEnabled(){return true;}
bool lampEdisonProfileMatches(){return false;}bool lampSyncFollowing(){return following;}
bool lampCalibrationActive(){return calibrating;}bool lampUpdateOwnsResources(){return updating;}
bool lampFactoryResetPending(){return resetting;}uint8_t lampGroupScene(){return scene;}
uint8_t lampSyncRole(){return 0;}bool lampSyncPaused(){return false;}
uint8_t lampSyncProtocol(){return LampSyncWire::ExpandedVersion;}
bool leaveLampSceneForEffect(){return true;}void pauseLampSync(){}void syncLampKnob(){}void noteLampUpdateUse(){}
struct CRGB {inline static int Black=0;};int* leds=nullptr;void fill_solid(int*,uint16_t,int){}
struct {void setBrightness(uint8_t){}} FastLED;
LampColor effectColors[LAMP_EFFECT_CAPACITY]{};LampEffectOptions effectOptions[LAMP_EFFECT_CAPACITY]{};bool colorsDirty=false,optionsDirty=false;
uint8_t appendedAppearanceDirty=0;
LampColor getLampColor(uint8_t mode){return effectColors[mode-1];}
LampEffectOptions getLampEffectOptions(uint8_t mode){return effectOptions[mode-1];}
struct RGB {uint8_t r,g,b;};RGB lampVuColors[3]{},lampFountainColors[3]{};bool lampFountainCustom=false;
String lampIdentity(){return "aabbccddeeff";}
bool authorizedLampRequest(bool){return true;}
'''
main=r'''
String envelope(uint64_t id,uint32_t revision){
 char text[200];snprintf(text,sizeof(text),"target=aabbccddeeff&scope=lamp&bootSession=0000000000000063&commandId=%016llx&expectedRevision=%u",(unsigned long long)id,revision);return String(text);
}
int main(){
 lampServer.on("/api/state/patch",HTTP_POST,handleLampStatePatch);
 for(unsigned i=0;i<LAMP_EFFECT_CAPACITY;++i){effectColors[i]=defaultLampColor(i+1);effectOptions[i]=defaultEffectOptions(i+1);}
 lightCommands.begin(99);observeLampAppearance();heapBudget=16316;largestBudget=2048;accountLiveHeap=true;forceMove=true;
 stats={};{String read=lampRevisionJson();assert(read.length()&&read.length()<=512);assert(stats.peak<=528);std::cout<<"{\"name\":\"revision\",\"bytes\":"<<read.length()<<",\"peakStringPayloadBytes\":"<<stats.peak<<"}\n";}assert(!stats.live);
 size_t maximumPeak=0;
 for(unsigned i=0;i<3;++i){
  assert(!stats.live);stats={};String form=envelope(i+1,lightCommands.currentRevision());
  form+=i==0?"&mode=46&brightness=85":i==1?"&mode=4&brightness=86&r=255&g=254&b=253&speed=100&intensity=100&dual=1&r2=255&g2=254&b2=253":"&brightness=000087";
  {auto result=lampServer.executeControl(42,true,form,true);assert(result.status==200&&result.body.length()<=512);assert(stats.largeCopies==0);assert(heapBudget-stats.peak>=8704);maximumPeak=std::max(maximumPeak,stats.peak);std::cout<<"{\"name\":\"statePatch\",\"formBytes\":"<<form.length()<<",\"receiptBytes\":"<<result.body.length()<<",\"peakStringPayloadBytes\":"<<stats.peak<<",\"remainingModeledHeapBytes\":"<<heapBudget-stats.peak<<"}\n";}
  form=static_cast<const char*>(nullptr);assert(!stats.live);
 }
 // Maximal hostile form exercises actual bounded decoding/temporary copies
 // before its rejection; no setter or ledger ID is consumed by invalid form.
 stats={};{String form=envelope(4,lightCommands.currentRevision());form+="&brightness=";while(form.length()<1024)form+='0';
  const auto before=Brightness;auto result=lampServer.executeControl(42,true,form,true);assert(result.status==400&&Brightness==before&&heapBudget-stats.peak>=8704);maximumPeak=std::max(maximumPeak,stats.peak);std::cout<<"{\"name\":\"hostile1024\",\"peakStringPayloadBytes\":"<<stats.peak<<",\"remainingModeledHeapBytes\":"<<heapBudget-stats.peak<<"}\n";}
 assert(!stats.live);
 // Every maximum-width receipt outcome is actually encoded with the pinned
 // allocator, including uncertainty and a complete revision rollover value.
 for(auto outcome:{LampCommands::Outcome::Rejected,LampCommands::Outcome::Executed,LampCommands::Outcome::Persisted,LampCommands::Outcome::SaveFailed,LampCommands::Outcome::Uncertain}){
  stats={};LampCommands::Receipt receipt;receipt.id=UINT64_MAX;receipt.revision=UINT32_MAX;receipt.status=599;receipt.outcome=outcome;
  {String result=receiptJson(&receipt,UINT64_MAX,UINT64_MAX);assert(result.length()&&result.length()<=512&&stats.peak<=528);std::cout<<"{\"name\":\"receipt\",\"bytes\":"<<result.length()<<",\"peakStringPayloadBytes\":"<<stats.peak<<"}\n";}assert(!stats.live);
 }
 assert(maximumPeak<4096);assert(!stats.live&&allocations.empty());
}
'''
server=r'''
#pragma once
#include <Arduino.h>
#include <functional>
enum HTTPMethod {HTTP_ANY,HTTP_GET,HTTP_POST};
class LampHttpServer {
protected:virtual bool prepareHttpForm(const String&){return true;}virtual void clearHttpForm(){}
public:using THandlerFunction=std::function<void()>;explicit LampHttpServer(uint16_t){}
 void on(const char*,HTTPMethod,THandlerFunction,THandlerFunction={}){}
 String arg(const String&)const{return {};}bool hasArg(const String&)const{return false;}size_t args()const{return 0;}String argName(size_t)const{return {};}
 String uri()const{return {};}String header(const String&)const{return {};}
 bool authenticate(const char*,const char*){return false;}void sendHeader(const String&,const String&,bool=false){}
 void send(int,const char*,const String&){}void send(int,const char*,String&&){}
};
'''
with tempfile.TemporaryDirectory(prefix='compact-light-',dir=ROOT/'.build') as temp:
    folder=Path(temp)
    arduino=memory.ARDUINO.replace('inline uint32_t millis(){return 1000;}','inline uint32_t millis(){return 1000;}\ninline size_t strlcpy(char* target,const char* source,size_t capacity){const size_t n=strlen(source);if(capacity){const size_t count=std::min(n,capacity-1);memcpy(target,source,count);target[count]=0;}return n;}')
    (folder/'Arduino.h').write_text(arduino)
    header=(core/'WString.h').read_text().replace('SSOSIZE = sizeof(struct _ptr) + 4 - 1','SSOSIZE = 15')
    (folder/'WString.h').write_text(header)
    raw=(core/'WString.cpp').read_text().replace('String::String(const String &value) {','String::String(const String &value) {\n observeStringCopy(value.length());')
    raw=raw.replace('malloc(','observedMalloc(').replace('realloc(','observedRealloc(').replace('free(','observedFree(')
    (folder/'WString.cpp').write_text(raw)
    (folder/'pgmspace.h').write_text('#pragma once\n#include <cstring>\n#define PSTR(s) (s)\n#define memcpy_P memcpy\n')
    (folder/'esp32-hal-log.h').write_text('#pragma once\n#define log_w(...) ((void)0)\n#define log_e(...) ((void)0)\n')
    (folder/'stdlib_noniso.h').write_text('''#pragma once
#include <cstdio>
inline char* itoa(int v,char* s,int){std::sprintf(s,"%d",v);return s;}inline char* utoa(unsigned v,char* s,int){std::sprintf(s,"%u",v);return s;}
inline char* ltoa(long v,char* s,int){std::sprintf(s,"%ld",v);return s;}inline char* ultoa(unsigned long v,char* s,int){std::sprintf(s,"%lu",v);return s;}
inline char* lltoa(long long v,char* s,int){std::sprintf(s,"%lld",v);return s;}inline char* ulltoa(unsigned long long v,char* s,int){std::sprintf(s,"%llu",v);return s;}
inline char* dtostrf(double v,signed int w,unsigned int p,char* s){std::sprintf(s,"%*.*f",w,int(p),v);return s;}
''')
    (folder/'LampHttpServer.h').write_text(server)
    (folder/'crypto-config.h').write_text('#pragma once\n#define MBEDTLS_PLATFORM_C\n#define MBEDTLS_SHA256_C\n')
    includes=['-I'+str(folder),'-I'+str(ROOT),'-I'+str(crypto/'include')];define=['-DMBEDTLS_CONFIG_FILE="crypto-config.h"']
    objects=[]
    for name in ['sha256','platform_util','platform']:
        out=folder/(name+'.o');subprocess.run(['gcc','-std=c11',*includes,*define,'-c',str(crypto/'library'/(name+'.c')),'-o',str(out)],check=True);objects.append(str(out))
    allocation=memory.PLATFORM[:memory.PLATFORM.index('bool installed=')]
    cpp=folder/'compact.cpp'
    cpp.write_text(allocation+platform+defaults+'\n'+(ROOT/'LampControl.ino').read_text()+'\n'+extract(network,'bool readNumber(')+'\n'+fields+'\n'+functions+main)
    exe=folder/'compact.exe'
    subprocess.run(['g++','-std=c++17','-fno-elide-constructors','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-Wno-sign-compare',*SANITIZERS,*includes,*define,str(cpp),str(folder/'WString.cpp'),*objects,'-o',str(exe)],check=True)
    output=subprocess.check_output([str(exe)],text=True)
    results=[json.loads(line) for line in output.splitlines()]
    report=dict(hostOnly=True,hardwareTouched=False,pinnedCoreVersion='3.3.11',sdkWorkspaceMarginBytes=8704,captureAllowanceBytes=2048,receiptReservationBytes=528,targetSsoArrayModelBytes=15,measuredScope='String payload only; excludes allocator metadata and SDK allocations',results=results,sources={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['LampExperience.ino','LampControlResourcePolicy.h','LampControlHttpAdapter.h','LampControl.ino','LampColors.ino']})
    (ROOT/'.build/compact-light-memory.json').write_text(json.dumps(report,indent=2)+'\n')
    print(output,end='');print('PASS production compact handlers with pinned String and retained8704-byteSDKmargin.')
