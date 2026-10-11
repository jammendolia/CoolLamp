"""Actual allocation-free diagnostic formatter: worst bounds and fail-closed JSON."""
from pathlib import Path
import json
import subprocess
import tempfile
from host_compiler import SANITIZERS

ROOT=Path(__file__).resolve().parents[1]
fixture=r'''
#include <cassert>
#include <cstring>
#include <iostream>
#include <cstdlib>
#include <new>
#include <array>
#include <cstdio>
#include <cstdarg>
// Scope the barrier to the actual formatter header. Host test reporting may
// use iostream outside it; any direct printf-family dependency here exits86.
[[noreturn]] inline int forbiddenFormatting(){std::_Exit(86);}
#define printf(...) forbiddenFormatting()
#define fprintf(...) forbiddenFormatting()
#define sprintf(...) forbiddenFormatting()
#define snprintf(...) forbiddenFormatting()
#define vprintf(...) forbiddenFormatting()
#define vfprintf(...) forbiddenFormatting()
#define vsprintf(...) forbiddenFormatting()
#define vsnprintf(...) forbiddenFormatting()
#define asprintf(...) forbiddenFormatting()
#define vasprintf(...) forbiddenFormatting()
#define _snprintf_r(...) forbiddenFormatting()
#define _vsnprintf_r(...) forbiddenFormatting()
inline void guardProbe(unsigned family){
 switch(family){
 case 0:printf("x");break;case 1:fprintf(nullptr,"x");break;
 case 2:sprintf(nullptr,"x");break;case 3:snprintf(nullptr,0,"x");break;
 case 4:vprintf("x",nullptr);break;case 5:vfprintf(nullptr,"x",nullptr);break;
 case 6:vsprintf(nullptr,"x",nullptr);break;case 7:vsnprintf(nullptr,0,"x",nullptr);break;
 case 8:asprintf(nullptr,"x");break;case 9:vasprintf(nullptr,"x",nullptr);break;
 case 10:_snprintf_r(nullptr,nullptr,0,"x");break;case 11:_vsnprintf_r(nullptr,nullptr,0,"x",nullptr);break;
 }
}
#include "LampRuntimeDiagnostic.h"
#undef printf
#undef fprintf
#undef sprintf
#undef snprintf
#undef vprintf
#undef vfprintf
#undef vsprintf
#undef vsnprintf
#undef asprintf
#undef vasprintf
#undef _snprintf_r
#undef _vsnprintf_r
static size_t allocations=0;
void* operator new(std::size_t size){++allocations;if(void* p=std::malloc(size))return p;throw std::bad_alloc();}
void* operator new[](std::size_t size){return ::operator new(size);}
void operator delete(void* p)noexcept{std::free(p);}
void operator delete[](void* p)noexcept{std::free(p);}
void operator delete(void* p,std::size_t)noexcept{std::free(p);}
void operator delete[](void* p,std::size_t)noexcept{std::free(p);}
struct Http {
 uint32_t accepted=1,rejected=2,deadlines=3,cancelled=4,blockedSends=5;
 uint32_t responses=6,responseFailures=7,dispatches=8,maxServiceUs=9,maxDispatchUs=10;
 uint32_t maxReceiveBytes=11,maxSendBytes=12,closeQueueFull=13,maxConnectionMs=14,maxIdleMs=15;
};
int main(int argc,char** argv){
 if(argc>1)guardProbe(unsigned(std::strtoul(argv[1],nullptr,10)));
 using namespace LampRuntimeDiagnostic;
 char identity[13];canonicalIdentity(0x123474b950b2f180ULL,identity);assert(!std::strcmp(identity,"74b950b2f180"));
 canonicalIdentity(0,identity);assert(!std::strcmp(identity,"000000000000"));
 canonicalIdentity(UINT64_MAX,identity);assert(!std::strcmp(identity,"ffffffffffff"));
 // The actual decimal writer covers every digit transition and uint32 bound.
 const uint32_t values[]={0,1,9,10,99,100,999,1000,9999,10000,99999,100000,999999,1000000,
   9999999,10000000,99999999,100000000,999999999,1000000000,2147483648U,UINT32_MAX};
 const char* decimal[]={"0","1","9","10","99","100","999","1000","9999","10000","99999","100000","999999","1000000",
   "9999999","10000000","99999999","100000000","999999999","1000000000","2147483648","4294967295"};
 for(size_t index=0;index<sizeof(values)/sizeof(values[0]);++index){
   char digits[13];std::memset(digits,'x',sizeof(digits));Text writer(digits+1,11);writer.number(values[index]);
   assert(writer.size()==std::strlen(decimal[index])&&!std::strcmp(digits+1,decimal[index]));
   assert(digits[0]=='x'&&digits[12]=='x');
 }
 char shortDigits[11];Text shortWriter(shortDigits,sizeof(shortDigits));shortWriter.number(UINT32_MAX);
 assert(shortWriter.size()==10&&!std::strcmp(shortDigits,"4294967295"));
 char failedDigits[10];Text failedWriter(failedDigits,sizeof(failedDigits));failedWriter.number(UINT32_MAX);
 assert(!failedWriter.size()&&!failedDigits[0]);
 Input input;input.identity="74b950b2f180";input.version="1.15.1";
 input.uptime=1;input.freeHeap=2;input.minHeap=3;input.largestBlock=4;input.loopStack=5;input.closeStack=6;
 input.frames=7;input.maxRender=8;input.mode=9;input.brightness=10;input.leds=11;input.midpoint=12;
 input.updatePhase=13;input.updateError=14;input.channel=15;input.style=16;
 input.closeQueued=17;input.closeAttempts=18;input.closeFailures=19;
 input.closeAborts=20;input.closePending=21;input.closeMaxOwnedMs=22;
 input.power=input.automatic=input.healthy=input.connected=input.scanning=true;
 input.address[0]=192;input.address[1]=168;input.address[2]=1;input.address[3]=2;
 LampRuntimeMetrics::Snapshot metrics;
 uint32_t n=100;
 metrics.loops=n++;metrics.shows=n++;metrics.animationShows=n++;metrics.maxLoopUs=n++;metrics.maxLoopGapUs=n++;
 metrics.maxNetworkServiceUs=n++;metrics.maxBluetoothServiceUs=n++;metrics.maxBeforeRenderUs=n++;
 metrics.maxShowUs=n++;metrics.maxFrameGapUs=n++;metrics.maxAnimationFrameGapUs=n++;metrics.animationGapOverruns=n++;
 metrics.currentWindow={200,201,202,203,204,205,206,207};metrics.lastWindow={300,301,302,303,304,305,306,307};
 Http http;
 std::array<char,Capacity+2> buffer;buffer.fill('x');
 const auto before=allocations;
 const auto size=serialize(buffer.data()+1,Capacity,input,metrics,http);
 assert(size&&size<Capacity&&allocations==before);
 assert(buffer[0]=='x'&&buffer.back()=='x'&&buffer[1+size]==0&&buffer[size]=='\n');
 std::cout<<buffer.data()+1;

 input.identity="ffffffffffffffff";input.version="1234567890.12345";
 input.uptime=input.freeHeap=input.minHeap=input.largestBlock=input.loopStack=input.closeStack=UINT32_MAX;
 input.frames=input.maxRender=input.mode=input.brightness=input.leds=input.midpoint=UINT32_MAX;
 input.updatePhase=input.updateError=input.channel=input.style=UINT32_MAX;
 input.closeQueued=input.closeAttempts=input.closeFailures=input.closeAborts=input.closePending=input.closeMaxOwnedMs=UINT32_MAX;
 input.power=input.automatic=input.healthy=input.connected=input.scanning=false;std::memset(input.address,255,sizeof(input.address));
 static_assert(sizeof(metrics)==112&&sizeof(http)==60,"Fixtures contain only the expected uint32 fields");
 std::memset(static_cast<void*>(&metrics),255,sizeof(metrics));std::memset(static_cast<void*>(&http),255,sizeof(http));
 const auto worstBefore=allocations;
 const auto worst=serialize(buffer.data()+1,Capacity,input,metrics,http);
 if(!worst){char larger[4096];const auto required=serialize(larger,sizeof(larger),input,metrics,http);std::cerr<<"Worst diagnostic requires "<<required+1<<" bytes includingNUL; configured "<<Capacity<<'\n';}
 assert(worst&&worst<Capacity&&allocations==worstBefore);
 assert(buffer[0]=='x'&&buffer.back()=='x'&&buffer[1+worst]==0&&buffer[worst]=='\n');
 std::cout<<buffer.data()+1;
 const auto boundedBefore=allocations;
 for(size_t capacity=0;capacity<=worst;++capacity){
   buffer.fill('x');
   assert(serialize(buffer.data()+1,capacity,input,metrics,http)==0);
   assert(buffer[0]=='x'&&buffer.back()=='x');
   if(capacity)assert(buffer[1]==0);
   assert(buffer[1+capacity]=='x');
 }
 buffer.fill('x');assert(serialize(buffer.data()+1,worst+1,input,metrics,http)==worst);
 assert(!serialize(nullptr,Capacity,input,metrics,http));
 const char* invalid[]={nullptr,"","a\"b","a\\b","a\nb","a\rb","a\tb","/../../","g123456789ab","ABCDEF012345","12345678901234567"};
 for(const auto* literal:invalid){input.identity=literal;input.version="1.15.1";buffer.fill('x');assert(!serialize(buffer.data()+1,Capacity,input,metrics,http)&&buffer[1]==0);}
 input.identity="74b950b2f180";
 for(const auto* literal:invalid){input.version=literal;buffer.fill('x');assert(!serialize(buffer.data()+1,Capacity,input,metrics,http)&&buffer[1]==0);}
 assert(allocations==boundedBefore);
 std::cerr<<"PASS production bounded runtime serializer: exact numeric fields, canonical identity, decimal boundaries, worstU32/16char literals, fail-closed capacities, canaries, no C++ allocation or printf family; worstBytes="<<worst<<" capacity="<<Capacity<<'\n';
}
'''
(ROOT/'.build').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='runtime-diagnostic-',dir=ROOT/'.build') as folder:
    cpp=Path(folder)/'test.cpp';cpp.write_text(fixture);binary=Path(folder)/'test.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,
                    '-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True)
    rows=[json.loads(line) for line in subprocess.check_output([str(binary)],text=True).splitlines()]
    for family in range(12):
        checked=subprocess.run([str(binary),str(family)],capture_output=True)
        assert checked.returncode==86, 'Printf-family barrier did not fail the injected call'
normal,worst=rows
assert normal['diagnosticsVersion']==2 and normal['deviceId']=='74b950b2f180' and normal['firmwareVersion']=='1.15.1'
for key,value in {'uptimeMs':1,'freeHeap':2,'minFreeHeap':3,'largestFreeBlock':4,'loopStackMinimumBytes':5,'httpCloseStackMinimumBytes':6}.items():
    assert normal[key]==value
assert normal['render']=={'frames':7,'maxRenderUs':8,'power':True,'mode':9,'brightness':10,'leds':11,'midpoint':12}
assert normal['firmware']=={'version':'1.15.1','phase':13,'error':14,'automatic':True,'bootHealthy':True}
assert normal['wifi']=={'connected':True,'address':'192.168.1.2','channel':15}
assert normal['scan']=={'active':True} and normal['lampStyle']=={'code':16}
cleanup_keys=['queued','attempts','failures','aborts','pendingOwned','maxOwnedMs']
assert [normal['socketCleanup'][key] for key in cleanup_keys]==list(range(17,23))
assert all(worst['socketCleanup'][key]==0xffffffff for key in cleanup_keys)
timing=normal['timing'];assert timing['version']==1 and timing['animationGapTargetUs']==100000
keys=['loops','shows','animationShows','maxLoopUs','maxLoopGapUs','maxNetworkServiceUs','maxBluetoothServiceUs','maxBeforeRenderUs','maxShowUs','maxFrameGapUs','maxAnimationFrameGapUs','animationGapOverruns']
assert [timing[key] for key in keys]==list(range(100,112))
window_keys=['sequence','startUs','endUs','observedThroughUs','observations','animationFrames','maxAnimationGapUs','animationGapOverruns']
assert timing['windows']['durationUs']==5000000
assert [timing['windows']['current'][key] for key in window_keys]==list(range(200,208))
assert [timing['windows']['last'][key] for key in window_keys]==list(range(300,308))
http_keys=['accepted','rejected','deadlines','cancelled','blockedSends','responses','responseFailures','dispatches','maxServiceUs','maxDispatchUs','maxReceiveBytes','maxSendBytes','closeQueueFull','maxConnectionMs','maxIdleMs']
assert [timing['http'][key] for key in http_keys]==list(range(1,16))
assert worst['render']['frames']==0xffffffff and worst['render']['power'] is False
assert worst['wifi']['address']=='255.255.255.255'
assert all(worst['timing'][key]==0xffffffff for key in keys)
assert all(worst['timing']['http'][key]==0xffffffff for key in http_keys)
assert all(worst['timing']['windows']['current'][key]==0xffffffff for key in window_keys)
assert all(worst['timing']['windows']['last'][key]==0xffffffff for key in window_keys)
for private in ('ssid','token','password','fleetKey','body'):
    assert '"'+private+'"' not in json.dumps(normal)
print('PASS production support snapshot JSON: complete typed fields, windows/HTTP counters and no private data surface')
