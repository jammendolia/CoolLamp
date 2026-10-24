"""Exercise actual loop-owned USB reply handling, without touching USB hardware."""
from pathlib import Path
import os
import subprocess
import tempfile
from host_compiler import SANITIZERS

ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'LampNetwork.ino').read_text()
handler=source[source.index('void serviceLampUSB()'):source.index('\nbool serviceLampOfflineWifi(')]
builder=source[source.index('size_t buildLampRuntimeDiagnostic('):source.index('\n// USB-only recovery/diagnostics.')]
fixture=r'''
#include <cassert>
#include <cstdint>
#include <cstring>
#include <string>
#include <deque>
#include <vector>
#include <iostream>
#include <type_traits>
#include <algorithm>
#include "LampRuntimeDiagnostic.h"
using std::min;
static size_t retainedBytes=0,explicitReleases=0,buildsThisTurn=0;
// Model pinned WString ownership: assigning an empty string preserves an
// existing large buffer; assigning nullptr invalidates/releases it. Accounting
// follows logical Arduino capacity rather than the host std::string allocator.
class String {
  std::string value;
  size_t allocated=0;
  void ensure(size_t length){
    if(length<=22||length<allocated)return;
    const size_t next=(length+16)&~size_t(15);
    retainedBytes+=next-allocated;allocated=next;
  }
  void release(){if(allocated){retainedBytes-=allocated;allocated=0;}value.clear();}
public:
  String()=default;
  String(const char* text):value(text?text:""){ensure(value.size());}
  String(const std::string& text):value(text){ensure(value.size());}
  String(const String& other):value(other.value){ensure(value.size());}
  String(String&& other)noexcept:value(std::move(other.value)),allocated(other.allocated){other.allocated=0;other.value.clear();}
  template<class T,typename std::enable_if<std::is_integral<T>::value,int>::type=0>
  String(T number):String(std::to_string(number)){}
  ~String(){release();}
  String& operator=(const char* text){if(!text){release();++explicitReleases;}else{ensure(strlen(text));value=text;}return *this;}
  String& operator=(const String& other){if(this!=&other){ensure(other.value.size());value=other.value;}return *this;}
  String& operator=(String&& other)noexcept{
    if(this==&other)return *this;
    if(allocated>=other.value.size()&&allocated){value=other.value;other.release();}
    else{release();value=std::move(other.value);allocated=other.allocated;other.allocated=0;other.value.clear();}
    return *this;
  }
  String& operator+=(const String& other){ensure(value.size()+other.value.size());value+=other.value;return *this;}
  String& operator+=(const char* text){ensure(value.size()+strlen(text));value+=text;return *this;}
  const char* c_str()const{return value.c_str();}
  size_t length()const{return value.size();}
  bool isEmpty()const{return value.empty();}
  friend String operator+(const String& a,const String& b){return String(a.value+b.value);}
  friend String operator+(const char* a,const String& b){return String(std::string(a)+b.value);}
  friend String operator+(const String& a,const char* b){return String(a.value+std::string(b));}
};
struct {
  std::deque<char> input;
  std::string output;
  size_t room=0,actualWriteLimit=SIZE_MAX,readsThisTurn=0,drainedRoomAfterWrite=0;
  size_t writesThisTurn=0,requestedThisTurn=0,zeroRoomWrites=0,recoveryRoom=0;
  bool negativeRoom=false;
  void setTxTimeoutMs(uint32_t timeout){assert(timeout==0);}
  int available(){return int(input.size());}
  int read(){assert(!input.empty());++readsThisTurn;const char c=input.front();input.pop_front();return c;}
  int availableForWrite(){return negativeRoom?-1:int(room);}
  size_t write(const uint8_t* bytes,size_t length){
    ++writesThisTurn;requestedThisTurn+=length;assert(length<=64);
    if(!room){++zeroRoomWrites;assert(length==1&&bytes[0]=='\n');if(recoveryRoom)room=recoveryRoom;return 0;}
    const size_t n=min({length,room,actualWriteLimit});output.append(reinterpret_cast<const char*>(bytes),n);room-=n;
    if(drainedRoomAfterWrite)room=drainedRoomAfterWrite;return n;
  }
  size_t print(const String& text){return write(reinterpret_cast<const uint8_t*>(text.c_str()),text.length());}
}Serial;
static unsigned mutationCalls=0;
static int lastControlMode=0;
static bool setupAP=false,lastAPStartOK=true,otaActive=false,PowerOn=true,scanActive=false;
static uint32_t restartAt=0,scanStartedAt=0,scanDuration=120,scanPolls=0;
static int scanCount=0;
static uint8_t Brightness=100;
static String lampAPName="fixture";
constexpr int MODE_SPECTRUM_RISE=41,MODE_VU_METER=46,MODE_SOUND_GLOW=39,MODE_SOUND_METER=40,MODE_FIRE=4,MODE_EDISON_FILAMENT=48;
namespace WifiSetupWire {constexpr uint8_t CONTROL=1;}
static uint32_t nowMillis=12345;
uint32_t millis(){return nowMillis;}
int esp_reset_reason(){return 1;}
struct {size_t getFreeHeap(){return 30000;}}ESP;
struct IP {String toString(){return "192.168.4.1";}};
struct {int getMode(){return 1;}IP softAPIP(){return {};}unsigned softAPgetStationNum(){return 0;}}WiFi;
bool lampRemoteUpdateBusy(){return false;}
bool lampUpdateOwnsResources(){return false;}
void lampWifiSetupCommand(const uint8_t*,size_t,uint32_t,String&){++mutationCalls;}
void beginLampCenterCalibration(){++mutationCalls;}
void beginLampScan(){++mutationCalls;}
void toggleLampSetup(){++mutationCalls;}
void diagnoseLampAudio(){++mutationCalls;}
void adjustLampAudioGain(bool){++mutationCalls;}
void setLampControl(int mode,int,bool){++mutationCalls;lastControlMode=mode;}
bool saveLampAudioConfiguration(bool,int,int){++mutationCalls;return true;}
static std::vector<std::string> builtKinds;
String reply(const char* kind){
  assert(retainedBytes==0); // The prior completed reply must release capacity.
  ++buildsThisTurn;builtKinds.emplace_back(kind);
  return String(std::string("{\"kind\":\"")+kind+"\",\"data\":\""+std::string(2048,kind[0])+"\"}");
}
String lampWifiSetupJson(){return reply("wifi");}
String lampBluetoothStatusJson(){return reply("bluetooth");}
String lampDiagnosticsJson(){return reply("diagnostics");}
String lampCenterCalibrationJson(){return reply("center");}
String lampAudioJson(){return reply("audio");}
struct RuntimeHttp {
 uint32_t accepted=0,rejected=0,deadlines=0,cancelled=0,blockedSends=0,responses=0,responseFailures=0,dispatches=0;
 uint32_t maxServiceUs=0,maxDispatchUs=0,maxReceiveBytes=0,maxSendBytes=0,closeQueueFull=0,maxConnectionMs=0,maxIdleMs=0;
};
static LampRuntimeDiagnostic::Input runtimeInput;
static LampRuntimeMetrics::Snapshot runtimeMetrics;
static RuntimeHttp runtimeHttp;
size_t buildLampRuntimeDiagnostic(char* bytes,size_t capacity){
 assert(retainedBytes==0);++buildsThisTurn;builtKinds.emplace_back("runtime");
 return LampRuntimeDiagnostic::serialize(bytes,capacity,runtimeInput,runtimeMetrics,runtimeHttp);
}
'''
main=r'''
void input(const std::string& commands){Serial.input.insert(Serial.input.end(),commands.begin(),commands.end());}
void turn(size_t room=0,size_t actual=SIZE_MAX,size_t drainedAfterWrite=0){
  Serial.room=room;Serial.actualWriteLimit=actual;Serial.drainedRoomAfterWrite=drainedAfterWrite;Serial.readsThisTurn=0;buildsThisTurn=0;
  Serial.writesThisTurn=Serial.requestedThisTurn=0;const auto before=Serial.output.size();
  serviceLampUSB();assert(Serial.readsThisTurn<=32&&buildsThisTurn<=1&&!mutationCalls);
  assert(Serial.writesThisTurn<=1&&Serial.requestedThisTurn<=64&&Serial.output.size()-before<=64);
}
size_t lines(){return size_t(std::count(Serial.output.begin(),Serial.output.end(),'\n'));}
void drain(size_t expectedLines){for(unsigned i=0;i<10000&&lines()<expectedLines;++i)turn(4096);assert(lines()==expectedLines);}
int main(int argc,char** argv){
  assert(argc==2);const std::string scenario=argv[1];
  runtimeInput.identity="74b950b2f180";runtimeInput.version="1.15.1";runtimeInput.uptime=77;
  runtimeInput.frames=44;runtimeMetrics.currentWindow.sequence=3;runtimeMetrics.currentWindow.maxAnimationGapUs=16000;
  if(scenario=="edison-selectors"){
    // The USB adapter must dispatch the existing IDs exactly; the production
    // control admission suite separately verifies profile/mic/group rejection.
    for(char command='E';command<='I';++command){
      input(std::string(1,command));serviceLampUSB();
      assert(mutationCalls==1&&lastControlMode==48+command-'E');mutationCalls=0;
    }
    input("DJK");turn(0);assert(!mutationCalls&&Serial.input.empty());
  }else if(scenario=="retention-model"){
    String example(std::string(2048,'x'));const size_t bytes=retainedBytes;assert(bytes>=2048);
    example="";assert(example.isEmpty()&&retainedBytes==bytes);
    example=static_cast<const char*>(nullptr);assert(example.isEmpty()&&retainedBytes==0);
  }else if(scenario=="partial-and-release"){
    input("d");turn(0);assert(builtKinds.size()==1&&retainedBytes>=2048&&Serial.output.empty());
    const size_t retained=retainedBytes;
    for(unsigned i=0;i<10;++i)turn(128,0);assert(retainedBytes==retained&&builtKinds.size()==1&&Serial.output.empty());
    for(unsigned i=0;i<1000&&!lines();++i)turn(64,7);
    assert(lines()==1&&retainedBytes==0&&explicitReleases>=1);
    turn(4096);assert(lines()==1&&builtKinds.size()==1&&retainedBytes==0);
    input("d");drain(2);assert(lines()==2&&builtKinds.size()==2&&retainedBytes==0);
  }else if(scenario=="pending-json-fairness"){
    input("pqdju");turn(0);assert(builtKinds.size()==1&&builtKinds[0]=="wifi"&&retainedBytes>=2048);
    for(unsigned i=0;i<10;++i)turn(0);assert(builtKinds.size()==1&&Serial.output.empty());
    for(unsigned i=0;i<10000&&lines()<5;++i)turn(128,11);
    const std::vector<std::string> expected{"wifi","bluetooth","diagnostics","center","audio"};
    assert(builtKinds==expected&&lines()==5&&retainedBytes==0);
    for(unsigned i=0;i<10;++i)turn(4096);assert(lines()==5&&builtKinds==expected);
    for(const auto& kind:expected)assert(Serial.output.find("{\"kind\":\""+kind+"\"")!=std::string::npos);
  }else if(scenario=="coalesced-input-bound"){
    input(std::string(65,'d'));turn(0);assert(Serial.input.size()==33&&builtKinds.size()==1);
    turn(0);assert(Serial.input.size()==1&&builtKinds.size()==1);turn(0);assert(Serial.input.empty()&&builtKinds.size()==1);
    drain(1);assert(lines()==1&&retainedBytes==0);
    drain(2);assert(lines()==2&&builtKinds.size()==2&&retainedBytes==0);
    turn(4096);assert(lines()==2&&builtKinds.size()==2);
  }else if(scenario=="runtime-partial-zero-room"){
    char expected[LampRuntimeDiagnostic::Capacity];const auto length=LampRuntimeDiagnostic::serialize(expected,sizeof(expected),runtimeInput,runtimeMetrics,runtimeHttp);
    assert(length);input("r");turn(0);assert(builtKinds.size()==1&&builtKinds[0]=="runtime"&&retainedBytes==0&&Serial.output.empty());
    runtimeInput.uptime=999;runtimeMetrics.currentWindow.maxAnimationGapUs=200000;
    for(unsigned i=0;i<10;++i)turn(128,0);assert(builtKinds.size()==1&&retainedBytes==0&&Serial.output.empty());
    for(unsigned i=0;i<1000&&!lines();++i){turn(64,7);assert(retainedBytes==0);}
    assert(lines()==1&&Serial.output==std::string(expected,length)); // Immutable first snapshot even though live inputs changed.
    input("r");drain(2);assert(lines()==2&&builtKinds.size()==2&&retainedBytes==0);
    assert(Serial.output.find("\"uptimeMs\":999")!=std::string::npos&&Serial.output.find("\"maxAnimationGapUs\":200000")!=std::string::npos);
  }else if(scenario=="runtime-then-rich-pending"){
    input("r");turn(0);input("d");
    for(unsigned i=0;i<10;++i)turn(0);assert(builtKinds==std::vector<std::string>{"runtime"}&&retainedBytes==0);
    for(unsigned i=0;i<10000&&lines()<2;++i)turn(128,11);
    assert((builtKinds==std::vector<std::string>{"runtime","diagnostics"})&&lines()==2&&retainedBytes==0);
    const auto split=Serial.output.find('\n');assert(split!=std::string::npos);
    assert(Serial.output.substr(0,split).find("\"diagnosticsVersion\":2")!=std::string::npos);
    assert(Serial.output.substr(split+1).find("{\"kind\":\"diagnostics\"")==0);
  }else if(scenario=="rich-then-runtime-pending"){
    input("d");turn(0);input("r");
    for(unsigned i=0;i<10;++i)turn(0);assert(builtKinds==std::vector<std::string>{"diagnostics"}&&retainedBytes>=2048);
    for(unsigned i=0;i<10000&&lines()<2;++i)turn(128,11);
    assert((builtKinds==std::vector<std::string>{"diagnostics","runtime"})&&lines()==2&&retainedBytes==0);
    const auto split=Serial.output.find('\n');assert(split!=std::string::npos);
    assert(Serial.output.substr(0,split).find("{\"kind\":\"diagnostics\"")==0);
    assert(Serial.output.substr(split+1).find("{\"diagnosticsVersion\":2")==0);
  }else if(scenario=="runtime-coalesced-input"){
    input(std::string(65,'r'));turn(0);assert(Serial.input.size()==33&&builtKinds.size()==1&&retainedBytes==0);
    turn(0);assert(Serial.input.size()==1&&builtKinds.size()==1&&retainedBytes==0);
    turn(0);assert(Serial.input.empty()&&builtKinds.size()==1&&retainedBytes==0);
    drain(2);assert(lines()==2&&builtKinds.size()==2&&retainedBytes==0);
  }else if(scenario=="runtime-then-status-text"||scenario=="runtime-then-scan-text"){
    char expected[LampRuntimeDiagnostic::Capacity];const auto length=LampRuntimeDiagnostic::serialize(expected,sizeof(expected),runtimeInput,runtimeMetrics,runtimeHttp);
    assert(length>64);input(scenario=="runtime-then-status-text"?"r?":"rw");
    // CDC can drain while the loop runs: after the partial JSON write, the
    // next availableForWrite call sees ample room for a legacy text line.
    turn(64,SIZE_MAX,4096);assert(Serial.output==std::string(expected,64)&&!lines()&&retainedBytes==0);
    for(unsigned i=0;i<1000&&lines()<2;++i)turn(64,SIZE_MAX,4096);
    assert(lines()==2&&builtKinds==std::vector<std::string>{"runtime"}&&retainedBytes==0);
    const auto split=Serial.output.find('\n');assert(split==length-1&&Serial.output.substr(0,length)==std::string(expected,length));
    const char* prefix=scenario=="runtime-then-status-text"?"reset=":"scan=";
    assert(Serial.output.substr(length).find(prefix)==0);
    turn(4096);assert(lines()==2&&builtKinds.size()==1);
  }else if(scenario=="runtime-invalid-fails-closed"){
    runtimeInput.identity="bad\"identity";input("r");drain(1);
    assert(lines()==1&&retainedBytes==0&&builtKinds.size()==1);
    assert(Serial.output=="{\"diagnosticsVersion\":2,\"error\":\"Runtime snapshot unavailable\"}\n");
  }else if(scenario=="zero-room-idle-expiry-and-recovery"){
    input("d");turn(0);assert(retainedBytes>=2048&&builtKinds.size()==1);
    input("q");nowMillis+=1499;turn(0);assert(retainedBytes>=2048&&!Serial.zeroRoomWrites);
    nowMillis+=1;Serial.recoveryRoom=64;turn(0);
    assert(retainedBytes==0&&Serial.zeroRoomWrites==1&&builtKinds.size()==1&&Serial.output.empty());
    // Zero-room recovery only tried a separator; the abandoned body never
    // replays, and a new snapshot cannot start before separator enqueue.
    nowMillis+=99;turn(0);assert(Serial.zeroRoomWrites==1&&builtKinds.size()==1);
    nowMillis+=1;turn(64);assert(Serial.output=="\n"&&builtKinds.size()==1);
    drain(2);assert((builtKinds==std::vector<std::string>{"diagnostics","bluetooth"})&&retainedBytes==0);
    assert(Serial.output.find("diagnostics")==std::string::npos&&Serial.output.find("bluetooth")!=std::string::npos);
  }else if(scenario=="partial-expiry-newline-no-fragment-mixing"){
    input("r");turn(64);assert(Serial.output.size()==64&&!lines());
    const auto abandoned=Serial.output;input("q");nowMillis+=1500;turn(0);
    assert(builtKinds==std::vector<std::string>{"runtime"}&&Serial.output==abandoned);
    turn(64);assert(Serial.output==abandoned+"\n");
    drain(2);const auto split=Serial.output.find('\n');
    assert(split==64&&Serial.output.substr(split+1).find("{\"kind\":\"bluetooth\"")==0);
    assert((builtKinds==std::vector<std::string>{"runtime","bluetooth"})&&retainedBytes==0);
    input("r");runtimeInput.uptime=999;drain(3);
    assert(Serial.output.find("\"uptimeMs\":999")!=std::string::npos);
  }else if(scenario=="absolute-lifetime-despite-trickle"){
    input("d");turn(64,1);input("q");
    for(unsigned i=0;i<49;++i){nowMillis+=100;turn(64,1);assert(retainedBytes>=2048);}
    const auto prefix=Serial.output;assert(prefix.size()==50&&!lines());
    nowMillis+=100;turn(64);assert(Serial.output==prefix+"\n"&&retainedBytes==0&&builtKinds.size()==1);
    drain(2);assert(Serial.output.substr(51).find("{\"kind\":\"bluetooth\"")==0&&retainedBytes==0);
  }else if(scenario=="expiry-and-recovery-rollover"){
    nowMillis=0xffffff00u;input("d");turn(0);input("r");
    nowMillis+=1499;turn(0);assert(retainedBytes>=2048&&!Serial.zeroRoomWrites);
    nowMillis+=1;turn(0);assert(retainedBytes==0&&Serial.zeroRoomWrites==1);
    nowMillis+=99;turn(0);assert(Serial.zeroRoomWrites==1);
    nowMillis+=1;turn(0);assert(Serial.zeroRoomWrites==2&&builtKinds.size()==1);
    turn(64);assert(Serial.output=="\n");drain(2);
    assert((builtKinds==std::vector<std::string>{"diagnostics","runtime"})&&retainedBytes==0);
  }else if(scenario=="negative-room-is-not-capacity"){
    input("r");Serial.negativeRoom=true;turn(4096);assert(Serial.output.empty()&&!Serial.writesThisTurn);
    nowMillis+=1500;turn(0);assert(Serial.zeroRoomWrites==1&&Serial.output.empty());
    Serial.negativeRoom=false;turn(64);input("r");drain(2); // separator then a newly requested snapshot
  }else if(scenario=="continuous-runtime-does-not-starve-other-reads"){
    input("pqrdju?w");turn(0);
    for(unsigned i=0;i<10000&&lines()<8;++i){input("r");turn(64);}
    assert(lines()==8&&retainedBytes==0);
    assert((builtKinds==std::vector<std::string>{"wifi","bluetooth","runtime","diagnostics","center","audio"}));
    assert(Serial.output.find("reset=")!=std::string::npos&&Serial.output.find("scan=")!=std::string::npos);
  }else assert(false);
  std::cout<<"PASS production USB diagnostics "<<scenario<<": bounded input, immutable partial/backpressured output, mixed pending replies, runtime without JSONbuffer allocation, completed buffer release\n";
}
'''
with tempfile.TemporaryDirectory(prefix='usb-diagnostics-',dir=ROOT/'.build') as folder:
    cpp=Path(folder)/'test.cpp';cpp.write_text(fixture+handler+main);binary=Path(folder)/'test.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',
                    *SANITIZERS,'-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True)
    for scenario in ('edison-selectors','retention-model','partial-and-release','pending-json-fairness','coalesced-input-bound',
                     'runtime-partial-zero-room','runtime-then-rich-pending','rich-then-runtime-pending',
                     'runtime-coalesced-input','runtime-then-status-text','runtime-then-scan-text',
                     'runtime-invalid-fails-closed','zero-room-idle-expiry-and-recovery',
                     'partial-expiry-newline-no-fragment-mixing','absolute-lifetime-despite-trickle',
                     'expiry-and-recovery-rollover','negative-room-is-not-capacity',
                     'continuous-runtime-does-not-starve-other-reads'):
        subprocess.run([str(binary),scenario],check=True,timeout=15)

# Compile the actual r builder as well: its efuse identity used to enter
# snprintf before the otherwise-bounded serializer. Mock only SDK getters.
builder_fixture=r'''
#include <cassert>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <cstdarg>
#include <cstdlib>
[[noreturn]] inline int forbiddenFormatting(){std::_Exit(86);}
#define printf(...) forbiddenFormatting()
#define fprintf(...) forbiddenFormatting()
#define sprintf(...) forbiddenFormatting()
#define snprintf(...) forbiddenFormatting()
#define vprintf(...) forbiddenFormatting()
#define vfprintf(...) forbiddenFormatting()
#define vsprintf(...) forbiddenFormatting()
#define vsnprintf(...) forbiddenFormatting()
#define _snprintf_r(...) forbiddenFormatting()
#define _vsnprintf_r(...) forbiddenFormatting()
#include "LampRuntimeDiagnostic.h"
static LampRuntimeDiagnostic::Input values;
static LampRuntimeMetrics::Snapshot snapshot;
static uint64_t efuse=0x123474b950b2f180ULL;
#define LAMP_FIRMWARE_VERSION values.version
struct {
 uint64_t getEfuseMac(){return efuse;}
 uint32_t getFreeHeap(){return values.freeHeap;}
 uint32_t getMinFreeHeap(){return values.minHeap;}
 uint32_t getMaxAllocHeap(){return values.largestBlock;}
}ESP;
uint32_t millis(){return values.uptime;}
uint32_t uxTaskGetStackHighWaterMark(void*){return values.loopStack;}
constexpr int WL_CONNECTED=3;
struct IP {uint8_t operator[](unsigned index)const{return values.address[index];}};
struct {
 int status(){return values.connected?WL_CONNECTED:0;}
 uint32_t channel(){return values.channel;}
 IP localIP(){return {};}
}WiFi;
uint32_t& lampRenderedFrames=values.frames;
uint32_t& lampMaxRenderUs=values.maxRender;
uint32_t& Mode=values.mode;
uint32_t& Brightness=values.brightness;
uint32_t& NUM_LEDS=values.leds;
uint32_t& lampMidpoint=values.midpoint;
bool& PowerOn=values.power;
bool& scanActive=values.scanning;
bool lampBootHealthy(){return values.healthy;}
uint32_t lampStyleCode(){return values.style;}
struct Update {uint32_t phase,error;bool automatic;};
Update getLampUpdateStatus(){return {values.updatePhase,values.updateError,values.automatic};}
const LampRuntimeMetrics::Snapshot& getLampRuntimeMetrics(){return snapshot;}
namespace LampHttpSocketCleanup {
struct Metrics {uint32_t queued,closeAttempts,closeFailures,aborts,pendingOwned,maxOwnedMs;};
Metrics metrics(){return {values.closeQueued,values.closeAttempts,values.closeFailures,values.closeAborts,values.closePending,values.closeMaxOwnedMs};}
}
struct Http {
 uint32_t accepted=7,rejected=0,deadlines=0,cancelled=0,blockedSends=0,responses=0,responseFailures=0,dispatches=0;
 uint32_t maxServiceUs=0,maxDispatchUs=0,maxReceiveBytes=0,maxSendBytes=0,closeQueueFull=0,maxConnectionMs=0,maxIdleMs=0;
};
struct {uint32_t closeTaskStackMinimumBytes(){return values.closeStack;}Http metrics(){return {};}}lampServer;
'''
builder_main=r'''
int main(){
 values.identity="74b950b2f180";values.version="1.15.1";values.uptime=88;values.freeHeap=1;
 values.minHeap=1;values.largestBlock=1;values.loopStack=2400;values.closeStack=1000;
 values.frames=99;values.mode=4;values.power=true;values.brightness=100;values.leds=134;
 values.closeQueued=123;values.connected=true;values.address[0]=192;values.address[1]=168;values.address[2]=1;values.address[3]=2;
 char expected[LampRuntimeDiagnostic::Capacity],actual[LampRuntimeDiagnostic::Capacity];
 const auto length=LampRuntimeDiagnostic::serialize(expected,sizeof(expected),values,snapshot,Http{});
 assert(length&&buildLampRuntimeDiagnostic(actual,sizeof(actual))==length&&!std::strcmp(actual,expected));
 // One-byte heap getters simulate pressure without weakening the r contract.
 // The production builder cannot use String/lampIdentity or printf here.
 values.version="bad\"version";assert(!buildLampRuntimeDiagnostic(actual,sizeof(actual))&&!actual[0]);
 values.version="1.15.1";efuse=0;assert(buildLampRuntimeDiagnostic(actual,sizeof(actual))&&std::strstr(actual,"\"deviceId\":\"000000000000\""));
}
'''
with tempfile.TemporaryDirectory(prefix='usb-runtime-builder-',dir=ROOT/'.build') as folder:
    cpp=Path(folder)/'test.cpp';cpp.write_text(builder_fixture+builder+builder_main);binary=Path(folder)/'test.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,
                    '-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True)
    subprocess.run([str(binary)],check=True,timeout=15)
print('PASS actual USB runtime builder: canonical identity, SDK getter ownership, low-heap snapshot and no printf-family dependency')

# Exercise the installed pinned SDK write body, rather than duplicating its
# retry loop. Its disconnected FIFO policy can report one byte without host
# delivery; the lamp handler must use this attempt only for a line separator.
core_roots=[]
if os.environ.get('LOCALAPPDATA'):
    core_roots.append(Path(os.environ['LOCALAPPDATA'])/'Arduino15/packages/esp32/hardware/esp32/3.3.11/cores/esp32/HWCDC.cpp')
core_roots.extend((Path.home()/'.arduino15/packages/esp32/hardware/esp32/3.3.11/cores/esp32/HWCDC.cpp',
                   ROOT/'.build/arduino-data/packages/esp32/hardware/esp32/3.3.11/cores/esp32/HWCDC.cpp'))
core_path=next((path for path in core_roots if path.is_file()),None)
if core_path:
    core_source=core_path.read_text()
    core_write=core_source[core_source.index('size_t HWCDC::write(const uint8_t *buffer, size_t size)'):core_source.index('\nsize_t HWCDC::write(uint8_t c)')]
    assert 'Serial.setTxTimeoutMs(0)' in handler
    assert 'Serial.setTxTimeoutMs(0)' in (ROOT/'CoolLamp.ino').read_text()
    core_fixture=r'''
#include <cassert>
#include <cstdint>
#include <cstddef>
static void* tx_ring_buf=reinterpret_cast<void*>(1);
static void* tx_lock=reinterpret_cast<void*>(1);
static uint32_t tx_timeout_ms=0;
constexpr uint32_t portTICK_PERIOD_MS=1;
constexpr int pdPASS=1,pdTRUE=1;
static bool connected=true,plugged=true,allowLock=true;
static unsigned sends=0,kicks=0,gives=0,flushes=0,failBeforeSuccess=100;
static bool disconnected=false;
int xSemaphoreTake(void*,uint32_t ticks){assert(!ticks);return allowLock?pdPASS:0;}
void xSemaphoreGive(void*){++gives;}
size_t xRingbufferGetMaxItemSize(void*){return 256;}
int xRingbufferSend(void*,void* buffer,size_t length,uint32_t ticks){
 assert(!ticks&&length==1&&static_cast<uint8_t*>(buffer)[0]=='\n');
 return ++sends>failBeforeSuccess?pdTRUE:0;
}
void hw_cdc_enable_tx_intr(){++kicks;}
void flushTXBuffer(const uint8_t* buffer,size_t length){assert(buffer&&length==1&&buffer[0]=='\n');++flushes;}
class HWCDC {
public:
 static bool isCDC_Connected(){return !disconnected;}
 static bool isPlugged(){return plugged;}
 size_t write(const uint8_t*,size_t);
};
'''
    core_main=r'''
int main(){
 HWCDC port;const uint8_t separator='\n';
 // Full connected TX ring: exactly20 zero-tick attempts, each recovery kick
 // reached, no queued/body bytes or inferred receipt.
 assert(port.write(&separator,1)==0&&sends==20&&kicks==20&&gives==1&&!flushes);
 sends=kicks=gives=0;failBeforeSuccess=3;
 assert(port.write(&separator,1)==1&&sends==4&&kicks==4&&gives==1&&!flushes);
 // The disconnected SDK path reports1 even when the FIFO mock does not
 // deliver anything. This is why handler comments call it enqueue progress.
 sends=kicks=gives=0;disconnected=true;
 assert(port.write(&separator,1)==1&&!sends&&kicks==1&&gives==1&&flushes==1);
 sends=kicks=gives=flushes=0;disconnected=false;plugged=false;failBeforeSuccess=100;
 assert(port.write(&separator,1)==0&&sends==20&&kicks==20&&gives==1&&flushes==1&&!connected);
 sends=kicks=gives=flushes=0;allowLock=false;
 assert(port.write(&separator,1)==0&&!sends&&!kicks&&!gives&&!flushes);
}
'''
    with tempfile.TemporaryDirectory(prefix='usb-pinned-hwcdc-',dir=ROOT/'.build') as folder:
        cpp=Path(folder)/'test.cpp';cpp.write_text(core_fixture+core_write+core_main);binary=Path(folder)/'test.exe'
        subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,str(cpp),'-o',str(binary)],check=True)
        subprocess.run([str(binary)],check=True,timeout=3)
    print('PASS installed Arduino3.3.11 HWCDC write body: zero-tick lock/ring calls,20-attempt full-ring recovery cap, disconnected/unplugged semantics and no delivery claim')
else:
    print('SKIP installed HWCDC extraction: Arduino3.3.11 SDK source is unavailable; production-handler and runtime-builder checks above still ran')
