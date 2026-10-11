"""Production timing tracker and actual output wrappers; host only, no I/O."""
from pathlib import Path
import json
import subprocess
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / 'CoolLamp.ino').read_text()
wrappers = source[source.index('const LampRuntimeMetrics::Snapshot& getLampRuntimeMetrics()'):]
network = (ROOT / 'LampNetwork.ino').read_text()
timing_json = network[network.index('String lampRuntimeTimingJson()'):network.index('String lampDiagnosticsJson()')]
fixture = r'''
#include "LampRuntimeMetrics.h"
#include <cassert>
#include <iostream>
uint32_t nowUs = 0;
uint32_t micros(){return nowUs;}
static LampRuntimeMetrics::Tracker lampRuntimeMetrics;
struct {
  uint8_t lastBrightness = 99;
  unsigned calls = 0;
  void show(){++calls;nowUs += 5300;}
  void show(uint8_t brightness){lastBrightness = brightness;show();}
} FastLED;
'''
test = r'''
int main(){
  lampShowFrame(LampRuntimeMetrics::FrameKind::Signal);
  assert(FastLED.calls == 1 && FastLED.lastBrightness == 99);
  nowUs += 20;
  lampShowFrame(0,LampRuntimeMetrics::FrameKind::Update);
  assert(FastLED.calls == 2 && FastLED.lastBrightness == 0);
  nowUs += 5000000;
  lampShowFrame(100,LampRuntimeMetrics::FrameKind::Animation);
  nowUs += 16000;
  lampShowFrame(23,LampRuntimeMetrics::FrameKind::Animation);
  const auto snapshot = getLampRuntimeMetrics();
  assert(snapshot.shows == 4 && snapshot.animationShows == 2);
  assert(snapshot.maxFrameGapUs == 5005300);
  assert(snapshot.maxAnimationFrameGapUs == 21300);
  assert(snapshot.maxShowUs == 5300 && FastLED.lastBrightness == 23);
  std::cout << "PASS actual FastLED wrapper: output brightness unchanged, completed-output intervals and show duration captured\n";
}
'''
json_fixture = r'''
#include <string>
#include <type_traits>
#include <cstring>
class String : public std::string {
public:
  using std::string::string;
  String(const std::string& value):std::string(value){}
  template<class T, typename std::enable_if<std::is_integral<T>::value,int>::type=0>
  String(T number):std::string(std::to_string(number)){}
};
struct {
  struct Metrics {
    uint32_t accepted=0,rejected=0,deadlines=0,cancelled=0,blockedSends=0;
    uint32_t responses=0,responseFailures=0,dispatches=0,maxServiceUs=0,maxDispatchUs=0;
    uint32_t maxReceiveBytes=0,maxSendBytes=0,closeQueueFull=0,maxConnectionMs=0,maxIdleMs=0;
  } value;
  const Metrics& metrics()const{return value;}
} lampServer;
'''
json_test = r'''
int main(){
  lampRuntimeMetrics.show(LampRuntimeMetrics::FrameKind::Animation,0,100);
  lampRuntimeMetrics.show(LampRuntimeMetrics::FrameKind::Animation,400000,100);
  for(uint32_t now=416000;now<=10016000;now+=16000)lampRuntimeMetrics.show(LampRuntimeMetrics::FrameKind::Animation,now,100);
  const auto before=getLampRuntimeMetrics();
  const auto output=lampRuntimeTimingJson();
  assert(!std::memcmp(&before,&getLampRuntimeMetrics(),sizeof(before)));
  std::cout<<output;
}
'''

# Integration guard: the original public counters remain intact; every output
# in these renderer paths goes through the instrumented wrapper. HTTP handler
# output is checked by the transport suite owned by that implementation.
loop = source[source.index('void loop() {'):source.index('const LampRuntimeMetrics::Snapshot& getLampRuntimeMetrics()')]
assert loop.index('LoopScope') < loop.index('serviceLampNetwork()')
assert loop.index('Service::BeforeRender') < loop.index('renderLampCalibration()')
assert '++lampRenderedFrames' in loop and 'lampMaxRenderUs = max(' in loop
assert 'FastLED.show(' not in loop
for name in ('LampPlayback.ino', 'LampUpdateCue.ino'):
    assert 'FastLED.show(' not in (ROOT / name).read_text()

(ROOT / '.build').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='runtime-metrics-', dir=ROOT / '.build') as directory:
    directory = Path(directory)
    for name, cpp in [('tracker', ROOT / 'tests/runtime-metrics.cpp'), ('wrapper', directory / 'wrapper.cpp')]:
        if name == 'wrapper':
            cpp.write_text(fixture + wrappers + test)
        binary = directory / (name + '.exe')
        subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS,
                        '-I' + str(ROOT), str(cpp), '-o', str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
    cpp=directory/'json.cpp';binary=directory/'json.exe'
    cpp.write_text(fixture+json_fixture+wrappers+timing_json+json_test)
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,
                    '-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True)
    value=json.loads(subprocess.check_output([str(binary)],text=True))
    assert value['maxAnimationFrameGapUs']==400000 and value['animationGapOverruns']==1
    windows=value['windows'];assert windows['durationUs']==5000000
    assert windows['last']['sequence']==2 and windows['last']['startUs']==5000000 and windows['last']['endUs']==10000000
    assert windows['last']['maxAnimationGapUs']==16000 and windows['last']['animationGapOverruns']==0 and windows['last']['animationFrames']>300
    assert windows['current']['sequence']==3 and windows['current']['animationFrames']==2
    assert windows['current']['maxAnimationGapUs']==16000 and windows['current']['observedThroughUs']==10016000
    print('PASS actual diagnostic timing JSON: current/last window fields, precise stable maximum, pure serialization, unchanged boot startup evidence')
