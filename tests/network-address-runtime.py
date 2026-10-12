"""Exercise bounded network-address capture against the pinned ESP32 core.

The core IPAddress/Print/Stream/String implementation and headers are compiled
unchanged except allocation observation. SDK address/netif types and platform
utilities are host fixtures. This is a host contract check, not target heap or
physical network acceptance.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
PINNED_HASHES = {
    'IPAddress.cpp': '8d1eb538c8bd48b1474f5d600bebc3a15d0baea62be620da0c7bed68e1cbb001',
    'IPAddress.h': '3e851ff0443a9020dbfc55019f30fe2a16504d8143debb4eaaace8993f25c92b',
    'Print.cpp': '6dfd0f784179bb455904c8159ab2e507be8a866c8f1e3c2d8335c7ff5600a045',
    'Print.h': 'de14357219b20be15634d1ce5a28da22e0bf101b9afd2b0277b41f91a81f49d0',
    'StreamString.cpp': '3eb698b6e8c3cd5c5448b288a878fe3a4a08b92057a7cfdfcf0fb4fed5a71d74',
    'StreamString.h': '6a728f9a800ad67e618d19bb8f2a5df15d693c3b5d4d1c48e91000e3a1aa8c25',
    'Stream.cpp': 'c132fcbe9510316ae366795fd106118111aaa41c8f03ad5f8f9cc4dcbcafd65d',
    'Stream.h': 'b7e4835a173c28b4e7eae09072536c304b45c3d47e00f77c4094ac83bde8391e',
    'Printable.h': '2776d6006579f188010c4039ce6fa2361ce0457ae0b1b6a1b91fa18028f903e9',
    'WString.cpp': '6982868692d7347cb1f951101d14072332803716b27aa001f60c4fc941df93f7',
    'WString.h': 'e17d75d8ab183deb56677de708cca5e73b635e5ecdb5af118ce6f34b9ca6565d',
}
spec = importlib.util.spec_from_file_location('network_adapter_extract', ROOT/'tests/control-http-adapter.py')
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


def core_path():
    candidates = [Path(os.environ['COOLLAMP_ARDUINO_CORE'])] if 'COOLLAMP_ARDUINO_CORE' in os.environ else []
    if 'LOCALAPPDATA' in os.environ:
        candidates.append(Path(os.environ['LOCALAPPDATA'])/'Arduino15/packages/esp32/hardware/esp32/3.3.11/cores/esp32')
    candidates.extend([Path.home()/'.arduino15/packages/esp32/hardware/esp32/3.3.11/cores/esp32',
                       Path.home()/'Library/Arduino15/packages/esp32/hardware/esp32/3.3.11/cores/esp32'])
    for path in candidates:
        if (path/'IPAddress.cpp').is_file():
            return path
    raise RuntimeError('Pinned ESP32 Arduino core 3.3.11 missing; set COOLLAMP_ARDUINO_CORE to cores/esp32.')


ARDUINO = r'''
#pragma once
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <cstdarg>
#include <ctime>
#include "WString.h"
#include "Print.h"
#include "Stream.h"
void* observedMalloc(size_t);void* observedRealloc(void*,size_t);void observedFree(void*);
inline unsigned long millis(){static unsigned long clock=0;return ++clock;}
'''

MAIN = r'''
#include "Arduino.h"
#include "IPAddress.h"
#include "lwip/netif.h"
#include <cassert>
#include <new>
#include <iostream>
netif interfaceFixture{nullptr,{'s','t'},2};netif* netif_list=&interfaceFixture;
bool forbidAllocations=false;
size_t allocationCalls=0,captureCalls=0,sizeBoundaryChecks=0,invalidInputs=0;
void* observedMalloc(size_t size){++allocationCalls;assert(!forbidAllocations);return std::malloc(size);}
void* observedRealloc(void* value,size_t size){++allocationCalls;assert(!forbidAllocations);return std::realloc(value,size);}
void observedFree(void* value){std::free(value);}
void* operator new(size_t size){++allocationCalls;assert(!forbidAllocations);void* result=std::malloc(size);if(!result)throw std::bad_alloc();return result;}
void* operator new[](size_t size){return ::operator new(size);}
void operator delete(void* value)noexcept{std::free(value);}
void operator delete[](void* value)noexcept{std::free(value);}
void operator delete(void* value,size_t)noexcept{std::free(value);}
void operator delete[](void* value,size_t)noexcept{std::free(value);}
PRODUCTION
void verify(const IPAddress& address,const char* canonical=nullptr){
  const String oldText=address.toString();
  if(canonical)assert(oldText==canonical);
  assert(oldText.length()>0&&oldText.length()<=39);
  for(size_t capacity=0;capacity<=64;++capacity){
    uint8_t buffer[96];memset(buffer,0xa5,sizeof(buffer));
    const size_t before=allocationCalls;
    forbidAllocations=true;
    const bool ok=captureLampNetworkAddress(reinterpret_cast<char*>(buffer+16),capacity,address);
    forbidAllocations=false;
    ++captureCalls;++sizeBoundaryChecks;
    assert(allocationCalls==before);
    assert(ok==(capacity>oldText.length()));
    for(size_t i=0;i<16;++i)assert(buffer[i]==0xa5);
    for(size_t i=16+capacity;i<sizeof(buffer);++i)assert(buffer[i]==0xa5);
    if(capacity){
      assert(memchr(buffer+16,0,capacity));
      const size_t used=strlen(reinterpret_cast<const char*>(buffer+16));
      assert(used==std::min<size_t>(oldText.length(),capacity-1));
      assert(memcmp(buffer+16,oldText.c_str(),used)==0);
    }
    if(ok)assert(strcmp(reinterpret_cast<const char*>(buffer+16),oldText.c_str())==0);
  }
  forbidAllocations=true;
  assert(!captureLampNetworkAddress(nullptr,0,address));
  forbidAllocations=false;++captureCalls;
}
int main(){
  struct Case{const char* input;const char* canonical;};
  const Case cases[]={
    {"192.168.1.222","192.168.1.222"},{"255.255.255.255","255.255.255.255"},
    {"0.0.0.0","0.0.0.0"},{"001.002.003.004","1.2.3.4"},
    {"FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF","ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"},
    {"0000:0000:0000:0000:0000:0000:0000:0000","::"},
    {"2001:0DB8:0000:0000:0001:0000:0000:0001","2001:db8::1:0:0:1"},
    {"2001:db8:0:1:0:0:0:1","2001:db8:0:1::1"},
    {"1:0:2:3:4:5:6:7","1:0:2:3:4:5:6:7"},
    {"1:2:3:4:5:6::","1:2:3:4:5:6::"},
    {"::1","::1"},{"fe80::abcd:1%st2","fe80::abcd:1"},
    {"::ffff:c000:201","::ffff:c000:201"}
  };
  for(const Case& item:cases){IPAddress address;assert(address.fromString(item.input));verify(address,item.canonical);}
  IPAddress zoned;assert(zoned.fromString("fe80::abcd:1%st2"));assert(zoned.zone()==3);
  assert(zoned.toString(false)=="fe80::abcd:1");assert(zoned.toString(true)=="fe80::abcd:1%st2");
  // A long legacy String proves that the observation hook is active before
  // entering the allocation-forbidden production capture path.
  IPAddress longAddress;assert(longAddress.fromString(cases[4].input));
  const size_t before=allocationCalls;{const String old=longAddress.toString();assert(old.length()==39);}
  assert(allocationCalls>before);
  uint32_t random=0x90237d31;
  for(size_t count=0;count<1024;++count){
    uint8_t bytes[16];for(uint8_t& byte:bytes){random=random*1664525U+1013904223U;byte=uint8_t(random>>24);}
    // Periodically generate zero fields/runs to exercise canonical compression.
    if(count%3==0){const size_t first=(count/3)%8,last=std::min<size_t>(8,first+1+(count%7));memset(bytes+first*2,0,(last-first)*2);}
    const IPAddress ipv6(IPv6,bytes,uint8_t(count));verify(ipv6);
    const IPAddress ipv4(bytes[0],bytes[1],bytes[2],bytes[3]);verify(ipv4);
  }
  const char* invalid[]={"999.1.1.1","1..2.3","1.2.3.","1.2.3.4.5",":::","1::2::3","1:2:3:4:5:6:7:8:9","gggg::1","12345::1"};
  for(const char* text:invalid){IPAddress address;assert(!address.fromString(text));++invalidInputs;}
  // Overflow, embedded NUL, and an explicitly cancelled writer are terminal:
  // later writes cannot silently resume or step beyond the endpoint.
  char endpoint[4]={'x','x','x','x'};
  forbidAllocations=true;
  LampNetworkAddressWriter overflow(endpoint,3);assert(overflow.write('a')==1);assert(overflow.write('b')==1);
  assert(overflow.write('c')==0&&!overflow.good);assert(overflow.write('d')==0);assert(overflow.used==2&&endpoint[2]==0&&endpoint[3]=='x');
  LampNetworkAddressWriter embedded(endpoint,3);assert(embedded.write(0)==0&&!embedded.good);assert(embedded.write('a')==0&&embedded.used==0);
  LampNetworkAddressWriter cancelled(endpoint,3);cancelled.good=false;assert(cancelled.write('a')==0&&cancelled.used==0);
  forbidAllocations=false;
  std::cout<<"{\"captureCalls\":"<<captureCalls<<",\"sizeBoundaryChecks\":"<<sizeBoundaryChecks
           <<",\"invalidInputs\":"<<invalidInputs<<",\"randomAddressPairs\":1024,\"maximumCanonicalBytes\":39}"<<std::endl;
}
'''


class NetworkAddressRuntimeTests(unittest.TestCase):
    def test_actual_core_formatter_allocation_free_bounded_capture(self):
        core = core_path()
        for name, expected in PINNED_HASHES.items():
            self.assertEqual(hashlib.sha256((core/name).read_bytes()).hexdigest(), expected,
                             'Pinned ESP32 core source changed: '+name)
        source = (ROOT/'LampNetwork.ino').read_text()
        definitions = extract.function(source, 'struct LampNetworkAddressWriter ')+';\n'+extract.function(source, 'bool captureLampNetworkAddress(')
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name in PINNED_HASHES:
                text = (core/name).read_text()
                if name.endswith('.cpp'):
                    # Only allocation observation; no formatter/parser/String
                    # implementation is replaced by a host surrogate.
                    for operation in ['malloc', 'realloc', 'free']:
                        text = re.sub(r'\b'+operation+r'\(', 'observed'+operation.title()+'(', text)
                    if name == 'IPAddress.cpp':
                        text = '#include "Arduino.h"\n'+text
                (directory/name).write_text(text)
            (directory/'Arduino.h').write_text(ARDUINO)
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
            (directory/'sdkconfig.h').write_text('#pragma once\n#define CONFIG_LWIP_IPV6 1\n#define LWIP_IPV6_SCOPES 1\n')
            (directory/'lwip').mkdir()
            (directory/'lwip/ip_addr.h').write_text(r'''
#pragma once
#include <cstdint>
#define IP6_NO_ZONE 0
#define IPADDR_TYPE_V4 0
#define IPADDR_TYPE_V6 6
struct ip_addr_t {uint8_t type;union{struct{uint32_t addr[4];uint8_t zone;}ip6;struct{uint32_t addr;}ip4;}u_addr;};
''')
            (directory/'esp_netif_ip_addr.h').write_text(r'''
#pragma once
#include <cstdint>
struct esp_ip6_addr_t {uint32_t addr[4];uint8_t zone;};
enum esp_ip6_addr_type_t{ESP_IP6_ADDR_IS_UNKNOWN};
inline esp_ip6_addr_type_t esp_netif_ip6_get_addr_type(esp_ip6_addr_t*){return ESP_IP6_ADDR_IS_UNKNOWN;}
''')
            (directory/'lwip/netif.h').write_text('#pragma once\nstruct netif{netif* next;char name[2];unsigned char num;};\nextern netif* netif_list;\n')
            cpp, binary = directory/'network-address.cpp', directory/'network-address'
            cpp.write_text(MAIN.replace('PRODUCTION', definitions))
            subprocess.run(['c++', '-std=c++17', '-fno-elide-constructors', '-Wall', '-Wextra', '-Werror',
                            '-Wno-misleading-indentation', '-Wno-sign-compare', '-I'+str(directory), *SANITIZERS,
                            str(cpp), *[str(directory/name) for name in PINNED_HASHES if name.endswith('.cpp')],
                            '-o', str(binary)], check=True)
            output = subprocess.run([str(binary)], capture_output=True, text=True, timeout=30)
            self.assertEqual(output.returncode, 0, output.stderr[-2500:])
        results = json.loads(output.stdout)
        self.assertEqual(results['sizeBoundaryChecks'], (13+1024*2)*65)
        report = dict(hostOnly=True, hardwareTouched=False, pinnedCoreVersion='3.3.11',
                      pinnedCoreHashes=PINNED_HASHES,
                      productionSourceSha256=hashlib.sha256((ROOT/'LampNetwork.ino').read_bytes()).hexdigest(),
                      productionFunctions=['LampNetworkAddressWriter', 'captureLampNetworkAddress'],
                      actualCoreImplementationCompiled=['IPAddress', 'Print', 'Stream', 'StreamString', 'WString'],
                      allocationObservationOnly=True, allCapturesAllocationFree=True,
                      exactLegacyToStringDefaultZoneFalse=True, ipv6AndIpv4CanonicalFormattingPreserved=True,
                      everyDestinationCapacityZeroThrough64=True, overflowAndCancellationTerminal=True,
                      canariesIntact=True, invalidInputsRejectedByActualParser=True,
                      physicalAcceptance=False, results=results)
        (ROOT/'.build').mkdir(exist_ok=True)
        (ROOT/'.build/network-address-runtime.json').write_text(json.dumps(report, indent=2)+'\n')
        print('PASS: bounded capture matches actual core IPAddress.toString() without allocation; all endpoint canaries intact.')
        print(json.dumps(results))


if __name__ == '__main__':
    unittest.main()
