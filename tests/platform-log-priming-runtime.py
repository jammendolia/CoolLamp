"""Execute the production startup guard with observable public API fixtures.

The fixtures replace POSIX/VFS platform calls, not the guard logic. SDK control
flow was separately verified in the exact target ELF; host success does not
measure target heap, memory pressure, console timing, or native phone behavior.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]

MAIN = r'''
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <limits>
#include "LampPlatformLogPriming.h"
namespace Fixture {
struct Event {int kind;int descriptor;size_t bytes;};
Event events[8]{};
size_t count=0,zeroWrites=0,usbCalls=0;
ssize_t stdoutResult=0,stderrResult=0;
void reset(ssize_t first,ssize_t second){
  count=zeroWrites=usbCalls=0;stdoutResult=first;stderrResult=second;
}
}
ssize_t lampFixturePosixWrite(int descriptor,const void* data,size_t bytes){
  assert(Fixture::count<8);
  assert(descriptor==STDOUT_FILENO||descriptor==STDERR_FILENO);
  assert(data!=nullptr&&static_cast<const char*>(data)[0]=='\0'&&bytes==0);
  Fixture::events[Fixture::count++]={1,descriptor,bytes};
  ++Fixture::zeroWrites;
  return descriptor==STDOUT_FILENO?Fixture::stdoutResult:Fixture::stderrResult;
}
void usb_serial_jtag_vfs_use_nonblocking(){
  assert(Fixture::count<8);
  Fixture::events[Fixture::count++]={2,-1,0};++Fixture::usbCalls;
}
int main(){
  const ssize_t results[]={0,-1,-7,1,7,std::numeric_limits<ssize_t>::min(),std::numeric_limits<ssize_t>::max()};
  size_t tested=0;
  for(ssize_t first:results)for(ssize_t second:results){
    Fixture::reset(first,second);
    const bool primed=primeLampPlatformLogLocks();
    assert(primed==(first==0&&second==0));
    assert(Fixture::zeroWrites==2);
    assert(Fixture::usbCalls==EXPECT_USB);
    assert(Fixture::count==2+EXPECT_USB);
    if(EXPECT_USB)assert(Fixture::events[0].kind==2);
    assert(Fixture::events[EXPECT_USB].kind==1&&Fixture::events[EXPECT_USB].descriptor==STDOUT_FILENO);
    assert(Fixture::events[EXPECT_USB+1].kind==1&&Fixture::events[EXPECT_USB+1].descriptor==STDERR_FILENO);
    ++tested;
  }
  // Both descriptors are attempted even if the first fails. Repeating the
  // guard calls only the same zero-byte public APIs; it emits no payload.
  Fixture::reset(0,0);assert(primeLampPlatformLogLocks());assert(primeLampPlatformLogLocks());
  assert(Fixture::zeroWrites==4&&Fixture::usbCalls==2*EXPECT_USB);
  std::cout<<"{\"outcomeCombinations\":"<<tested<<",\"secondaryPrimeExpected\":"<<EXPECT_USB
           <<",\"bothDescriptorsAlwaysAttempted\":true,\"bytesEmitted\":0}"<<std::endl;
}
'''


class PlatformLogPrimingTests(unittest.TestCase):
    def test_production_guard_zero_bytes_order_and_failures(self):
        reports = []
        # Pinned standard console, primary-only, USB-primary, both USB options,
        # and a non-ESP host compile exercise the actual conditional header.
        configurations = [
            ('pinned-uart-with-secondary-usb', 1, 0, 1, 1),
            ('uart-only', 1, 0, 0, 0),
            ('usb-primary', 1, 1, 0, 1),
            ('both-usb-options', 1, 1, 1, 1),
            ('non-esp-posix', 0, 0, 0, 0),
        ]
        for label, esp32, primary, secondary, expect_usb in configurations:
            with self.subTest(configuration=label), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                (directory/'unistd.h').write_text(
                    '#pragma once\n#include <cstddef>\n#include <sys/types.h>\n'
                    '#define STDOUT_FILENO 1\n#define STDERR_FILENO 2\n'
                    '#define write lampFixturePosixWrite\n'
                    'ssize_t lampFixturePosixWrite(int,const void*,size_t);\n')
                (directory/'sdkconfig.h').write_text(
                    '#pragma once\n#define CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG '+str(primary)+'\n'
                    '#define CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG '+str(secondary)+'\n')
                (directory/'driver').mkdir()
                (directory/'driver/usb_serial_jtag_vfs.h').write_text(
                    '#pragma once\nvoid usb_serial_jtag_vfs_use_nonblocking();\n')
                source, binary = directory/'guard.cpp', directory/'guard'
                source.write_text(MAIN)
                defines = ['-DEXPECT_USB='+str(expect_usb)] + (['-DESP32=1'] if esp32 else [])
                subprocess.run(['c++', '-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror',
                                *SANITIZERS, *defines, '-I'+str(directory), '-I'+str(ROOT),
                                str(source), '-o', str(binary)], check=True)
                output = subprocess.run([str(binary)], capture_output=True, text=True, timeout=10)
                self.assertEqual(output.returncode, 0, output.stderr[-2500:])
                result = json.loads(output.stdout)
                self.assertEqual(result['outcomeCombinations'], 49)
                self.assertEqual(result['bytesEmitted'], 0)
                reports.append(dict(configuration=label, **result))
        report = dict(hostOnly=True, hardwareTouched=False, productionFunction='primeLampPlatformLogLocks',
                      productionSourceSha256=hashlib.sha256((ROOT/'LampPlatformLogPriming.h').read_bytes()).hexdigest(),
                      noPayloadEmitted=True, syscallFailuresReturnFalse=True,
                      positiveUnexpectedReturnRejected=True, bothDescriptorsAttemptedOnFailure=True,
                      secondaryPrimePrecedesWrites=True, configurations=reports,
                      limitations='Platform calls are fixtures. Physical SDK mutex allocation, heap margin, native connection, and animation acceptance remain separate.')
        (ROOT/'.build').mkdir(exist_ok=True)
        (ROOT/'.build/platform-log-priming-runtime.json').write_text(json.dumps(report, indent=2)+'\n')

    def test_guard_runs_before_persistence_audio_or_radio_startup(self):
        source = (ROOT/'CoolLamp.ino').read_text()
        self.assertIn('#include "LampPlatformLogPriming.h"', source)
        setup = source[source.index('void setup() {'):source.index('\nvoid loop()')]
        priming = setup.index('primeLampPlatformLogLocks()')
        self.assertLess(setup.index('Serial.setTxTimeoutMs(0)'), priming)
        for later in ('delay(3000)', 'recoverLampFactoryReset()', 'beginLampAudio()', 'loadLampSettings()',
                      'beginLampSync()', 'beginLampNetwork()', 'beginLampBluetooth()'):
            if later in setup:
                self.assertLess(priming, setup.index(later), later)
        loop = source[source.index('\nvoid loop()'):]
        self.assertNotIn('primeLampPlatformLogLocks()', loop)


if __name__ == '__main__':
    unittest.main()
