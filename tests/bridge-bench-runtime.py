"""Production local bench artifact/session checks with pinned real crypto.

The injected generated header and image are transparent host fixtures. They
exercise the compile-time opt-in and production validation; they are not a
physical lamp image or evidence of a radio installation.
"""
import ast
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
tree = ast.parse((ROOT / 'tests/espnow-runtime.py').read_text())
nodes = [node for node in tree.body if
         isinstance(node, ast.FunctionDef) and node.name == 'verified_source' or
         isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and
             target.id in ('SOURCE', 'ARCHIVE_SHA', 'PRIMITIVES') for target in node.targets)]
scope = dict(Path=Path, hashlib=hashlib, json=json, tarfile=tarfile)
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'pinned_source', 'exec'), scope)
source = scope['verified_source'](ROOT / '.build/tls-library')

image = bytearray(65584)
image[0], image[1], image[12], image[23] = 0xe9, 1, 5, 1
struct.pack_into('<I', image, 28, 65504)
struct.pack_into('<I', image, 32, 0xabcd5432)
for offset, text in [(507, b'COOLLAMP-PUBLIC-1.15.5\0'),
                     (2048, b'COOLLAMP-TEST-IMAGE-1.15.5"')]:
    image[offset:offset + len(text)] = text
digest = hashlib.sha256(image).hexdigest()
manifest = f'COOLLAMP-OTA-1\n1.15.5\nesp32c3\ndual-ota-2031616\n{len(image)}\n{digest}\n'
generated = '''#pragma once
namespace BridgeBenchFixture {
constexpr char Manifest[] = __MANIFEST__;
constexpr char TargetIdentity[] = "5894af4aec24";
constexpr unsigned char TargetMac[6] = {0x24,0xec,0x4a,0xaf,0x94,0x58};
constexpr unsigned LifetimeMs = 1200000;
}
'''.replace('__MANIFEST__', json.dumps(manifest))


def runtime_fixture():
    """Reuse established SDK mocks, compiling current production helpers."""
    template_tree = ast.parse((ROOT / 'tests/bridge-runtime-contracts.py').read_text())
    extraction = next(node for node in template_tree.body
                      if isinstance(node, ast.FunctionDef) and node.name == 'function')
    runtime = (ROOT / 'bridge/BridgeRuntime.cpp').read_text()
    environment = {'re': re, 'runtime': runtime}
    exec(compile(ast.Module(body=[extraction], type_ignores=[]), 'runtime_extract', 'exec'), environment)
    raw = next(node.value for node in template_tree.body if isinstance(node, ast.Assign)
               and any(isinstance(target, ast.Name) and target.id == 'fixture' for target in node.targets))
    while isinstance(raw, ast.Call):
        raw = raw.func.value
    assert isinstance(raw, ast.Constant) and isinstance(raw.value, str)
    prefix = raw.value.split('void cacheFailurePreservation(){')[0]
    prefix = prefix.replace('#include "Arduino.h"', '#include "Arduino.h"\n'
                            '#include "bridge/BridgeBench.h"\n'
                            '#include "BridgeBenchFixture.generated.h"\n'
                            '#include <fstream>\n#include <iterator>')
    prefix = prefix.replace('BridgeArtifact::Artifact artifact;',
                            'BridgeArtifact::Artifact artifact;\nBridgeBench::Session bench;\n'
                            'uint64_t boot=17;const char* identity="aabbccddeeff";')
    prefix = prefix.replace(' bool validAuth=false;', ' bool validAuth=false,activeClients=false;\n'
                            ' bool hasActiveClients()const{return activeClients;}\n'
                            ' void handleClient(){}void serviceCleanup(){}')
    prefix = prefix.replace(' unsigned binds=0,cancels=0;',
                            ' unsigned binds=0,cancels=0;BridgeDonation::Snapshot evidence;\n'
                            ' unsigned receiveCalls=0,serviceCalls=0;uint32_t receiveNow=0,serviceNow=0;\n'
                            ' bool receive(const uint8_t*,const uint8_t*,size_t,uint32_t at,uint32_t now){++receiveCalls;receiveNow=now;assert(now==millis()&&uint32_t(now-at)<=1500);return true;}\n'
                            ' void service(uint32_t now,bool){++serviceCalls;serviceNow=now;assert(now==millis());}\n'
                            ' BridgeDonation::Snapshot snapshot()const{auto out=evidence;out.sending=active;return out;}')
    prefix = prefix.replace('struct esp_partition_t {uint32_t size=0x3f0000;};',
                            'struct esp_partition_t {uint32_t size=0x3f0000,address=0x410000;};')
    prefix = prefix.replace('namespace LampCommission {bool pending=false,workingFlag=false;unsigned approvals=0;bool physicalPending(){return pending;}bool working(){return workingFlag;}void approvePhysical(){++approvals;}}',
                            'namespace LampCommission {bool pending=false,workingFlag=false;unsigned approvals=0;bool physicalPending(){return pending;}bool working(){return workingFlag;}void approvePhysical(){++approvals;}template<class T>bool receive(const T&){return false;}void service(uint32_t,bool){}}')
    prefix = prefix.replace('namespace BridgeControl {bool workingFlag=false;bool working(){return workingFlag;}}',
                            'namespace BridgeControl {bool workingFlag=false,policyAllowed=true,advance=false;bool working(){return workingFlag;}bool policyChangeAllowed(){return policyAllowed;}void service(uint32_t,bool,bool){if(advance)++fakeNow;}void enqueueReceive(const uint8_t*,const uint8_t*,size_t,uint32_t){}}\n'
                            'namespace BridgeLampLinks {bool valid=true;bool ready(){return valid;}void service(uint32_t,bool){}}\n'
                            'namespace LampEspNow {struct Status{bool active=true,suspended=false;};struct Received{uint8_t source[6]{},data[250]{};uint16_t length=0;uint32_t receivedAt=0;};Status radio;unsigned pendingPackets=0;Status status(){return radio;}void service(uint32_t,bool,bool,bool,bool){}bool receive(Received& message){if(!pendingPackets)return false;--pendingPackets;++fakeNow;message.receivedAt=fakeNow;message.length=1;return true;}}')
    prefix = prefix.replace('namespace BridgeWifiScan {bool scanningFlag=false;bool scanning(){return scanningFlag;}bool working(){return scanningFlag;}}',
                            'namespace BridgeWifiScan {bool scanningFlag=false;bool scanning(){return scanningFlag;}bool working(){return scanningFlag;}void service(uint32_t,bool){}}')
    definitions = '\n'.join(re.search(r'^struct ' + name + r' .*;', runtime, re.M).group(0)
                            for name in ('LegacyConfig', 'Config', 'CacheRecord'))
    names = ('wipe', 'crc', 'busy', 'saveConfig', 'loadConfig', 'readCache', 'nextCacheBank',
             'persistCache', 'beginArtifact', 'benchResourcesReady', 'benchStatus', 'armBench',
             'serviceBench', 'restoreCache', 'startCache', 'loadCache', 'serviceCache',
             'stageWifi', 'serviceWifi', 'buttonService', 'authorized', 'choosePassword',
             'servicePassword', 'ownerWifiStatus')
    helpers = '\n'.join(environment['function'](name) for name in names)
    helpers += '\nuint32_t lastLoopAt=0,maxLoopGap=0;bool serialClockAdvance=false;\n'
    helpers += 'void serialService(){if(serialClockAdvance)++fakeNow;}void displayStatus(uint32_t){}void delay(uint32_t milliseconds){fakeNow+=milliseconds;}\n'
    helpers += environment['function']('service').replace('void service()', 'void productionBridgeService()', 1)
    return prefix.replace('__DEFINITIONS__', definitions).replace('__HELPERS__', helpers) + (
        ROOT / 'tests/bridge-bench-runtime-helpers.cpp').read_text()

with tempfile.TemporaryDirectory(prefix='coollamp-bridge-bench-') as directory:
    directory = Path(directory)
    arduino = (ROOT / 'tests/sync-stubs/Arduino.h').read_text().replace(
        '  using std::string::string;', '  using std::string::string;\n'
        '  bool isEmpty()const{return empty();}\n'
        '  void remove(size_t at){erase(at);}\n'
        '  void toCharArray(char* out,size_t n)const{if(n){const size_t take=size()<n-1?size():n-1;memcpy(out,data(),take);out[take]=0;}}')
    (directory / 'Arduino.h').write_text(arduino)
    (directory / 'BridgeBenchFixture.generated.h').write_text(generated)
    (directory / 'bench-fixture.bin').write_bytes(image)
    includes = ['-I' + str(directory), '-I' + str(ROOT), '-I' + str(ROOT / 'tests'),
                '-I' + str(source / 'include'), '-I' + str(source / 'library')]
    defines = ['-DARDUINO=1', '-DMBEDTLS_CONFIG_FILE="espnow-host-mbedtls-config.h"']
    objects = []
    for name in scope['PRIMITIVES']:
        output = directory / (name + '.o')
        subprocess.run(['gcc', '-std=c11', *SANITIZERS, *includes, *defines,
                        '-c', str(source / 'library' / (name + '.c')), '-o', str(output)], check=True)
        objects.append(str(output))
    for bench in (False, True):
        binary = directory / ('bridge-bench-enabled.exe' if bench else 'bridge-bench-disabled.exe')
        selected = defines + (['-DCOOLLAMP_BRIDGE_BENCH=1'] if bench else [])
        subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS,
                        *includes, *selected, str(ROOT / 'tests/bridge-bench-runtime.cpp'),
                        str(ROOT / 'bridge/BridgeBench.cpp'),
                        str(ROOT / 'bridge/BridgeArtifact.cpp'),
                        str(ROOT / 'bridge/BridgeDonation.cpp'),
                        str(ROOT / 'LampFirmwareRelayCrypto.cpp'),
                        *objects, '-o', str(binary)], check=True)
        subprocess.run([str(binary), str(directory / 'bench-fixture.bin')], check=True)
    (directory / 'runtime.cpp').write_text(runtime_fixture())
    binary = directory / 'bridge-bench-helpers.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS,
                    *includes, *defines, '-DCOOLLAMP_BRIDGE_BENCH=1',
                    str(directory / 'runtime.cpp'), str(ROOT / 'bridge/BridgeBench.cpp'),
                    str(ROOT / 'bridge/BridgeArtifact.cpp'), *objects, '-o', str(binary)], check=True)
    subprocess.run([str(binary), str(directory / 'bench-fixture.bin')], check=True)
    print('PASS: actual bench artifact/session handlers with compile-time opt-in; '
          'pinned crypto and volatile target fencing; physical installation pending')
