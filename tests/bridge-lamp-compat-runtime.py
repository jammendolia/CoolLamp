"""Actual bridge sender -> unchanged lamp relay/shared OTA receiver, real crypto."""
import ast
import hashlib
import json
from pathlib import Path
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

# Reuse the existing bounded SDK harness and production lamp receiver, without
# importing/running its original runner. Replace only the donor and test main.
relay = ast.parse((ROOT / 'tests/firmware-relay-runtime.py').read_text())
fixture = next(ast.literal_eval(node.value) for node in relay.body if
               isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and
               target.id == 'fixture' for target in node.targets))
ble = ast.parse((ROOT / 'tests/ble-update-runtime.py').read_text())
sdk_scope = {}
exec(compile(ast.Module(body=[node for node in ble.body if isinstance(node, ast.Assign) and
     any(isinstance(target, ast.Name) and target.id in ('SDK', 'FORMAT') for target in node.targets)],
     type_ignores=[]), 'sdk', 'exec'), sdk_scope)
sdk = sdk_scope['SDK'] + '\nconst esp_partition_t* esp_ota_get_running_partition();\nint esp_partition_read(const esp_partition_t*,size_t,void*,size_t);\nstruct esp_app_desc_t;\nint esp_ota_get_partition_description(const esp_partition_t*,esp_app_desc_t*);\n'
format_text = sdk_scope['FORMAT'].replace('uint8_t magic;uint8_t unused[11];',
    'uint8_t magic,segment_count;uint8_t unused[10];').replace('uint8_t tail[10];',
    'uint8_t tail[9],hash_appended;').replace('uint32_t address,length;', 'uint32_t address,data_len;')
arduino = (ROOT / 'tests/sync-stubs/Arduino.h').read_text().replace('  using std::string::string;',
    '  using std::string::string;\n  bool startsWith(const char* s)const{return rfind(s,0)==0;}').replace(
    'inline uint32_t fakeNow=0;', 'using std::min;\ninline uint32_t fakeNow=40000;')
start = fixture.index('// Compile the actual sender and recipient')
end = fixture.index('#undef LAMP_FIRMWARE_VERSION', start)
fixture = fixture[:start] + r'''
#include "bridge/BridgeArtifact.h"
#include "bridge/BridgeDonation.h"
namespace Donor {
BridgeArtifact::Artifact artifact;
BridgeDonation::Sender sender;
bool read(void*,uint32_t at,uint8_t* out,size_t n){if(at>installed.size()||n>installed.size()-at)return false;memcpy(out,installed.data()+at,n);return true;}
bool send(void*,const uint8_t* bytes,size_t n,const uint8_t* destination){return LampEspNow::enqueue(bytes,n,destination,true);}
uint64_t random(void*){return (uint64_t(esp_random())<<32|esp_random())|1;}
void begin(){
 assert(artifact.begin({nullptr,read,uint32_t(installed.size())},pinnedManifest,strlen(pinnedManifest),BridgeArtifact::Trust::HttpsPinnedLegacy));
 assert(sender.begin(addresses[0],fleetKey,random(nullptr),{nullptr,send,random,nullptr}));assert(sender.setArtifact(&artifact));
}
void service(uint32_t now){artifact.service(4096);sender.service(now,radioAvailable);}
bool receive(const LampEspNow::Received& message){return sender.receive(message.source,message.data,message.length,message.receivedAt,fakeNow);}
}
''' + fixture[end:]
fixture = fixture[:fixture.index('int main(')] + r'''
int main(int argc,char** argv){
 assert(argc==2);scenarioName=argv[1];side=0;Donor::begin();side=1;Recipient::begin();
 assert(Recipient::control(true,scenarioName=="wrong-fleet"?String("key=ffffffffffffffffffffffffffffffff"):String("key=")+String(keyHex)).status==200);
 if(scenarioName=="auto-off")automatic=false;
 if(scenarioName=="quiet-window")policyAllowed=false;
 if(scenarioName=="rollout-denied")rolloutAllowed=false;
 if(scenarioName=="attempt-quarantine")attemptAllowed=false;
 if(scenarioName=="commission")commissionBusy=true;
 dropAck=scenarioName=="lost-ack";dropData=scenarioName=="lost-data";dropFinish=scenarioName=="lost-finish-ack";corrupt=scenarioName=="corrupt";
 for(unsigned i=0;i<160000;++i){
  side=0;Donor::service(fakeNow);deliver();side=1;Recipient::service(fakeNow);deliver();
  if(scenarioName=="auto-disabled-midway"&&flash.size()>1000)automatic=false;
  if(scenarioName=="radio-lost"&&flash.size()>1000)radioAvailable=false;
  ++fakeNow;
  if(boots&&!Donor::sender.sending())break;
 }
 const bool expected=scenarioName=="success"||scenarioName=="lost-ack"||scenarioName=="lost-data"||scenarioName=="lost-finish-ack";
 if(expected){assert(boots==1&&ends==1&&verified&&flash==installed&&begins==1);assert(Donor::sender.snapshot().completed==1&&!Donor::artifact.pinned());if(dropAck)assert(ackDropped);if(dropData)assert(dataDropped);if(dropFinish)assert(finishDropped);}
 else{assert(!boots&&!verified);if(scenarioName=="auto-off"||scenarioName=="wrong-fleet"||scenarioName=="quiet-window"||scenarioName=="rollout-denied"||scenarioName=="attempt-quarantine"||scenarioName=="commission")assert(!begins);}
 std::cout<<"PASS bridge -> production lamp "<<scenarioName<<" begins="<<begins<<" boots="<<boots<<"\n";
}
'''
version = (ROOT / 'LampVersion.h').read_text().split('LAMP_FIRMWARE_VERSION "')[1].split('"')[0]
image = bytearray(65584)
image[0:2] = bytes([0xe9, 1])
image[12:14] = (5).to_bytes(2, 'little')
image[23] = 1
image[28:32] = (65504).to_bytes(4, 'little')
image[32:36] = (0xabcd5432).to_bytes(4, 'little')
marker = ('COOLLAMP-PUBLIC-' + version + '\0').encode()
image[300:300 + len(marker)] = marker
manifest = f'COOLLAMP-OTA-1\n{version}\nesp32c3\ndual-ota-2031616\n{len(image)}\n{hashlib.sha256(image).hexdigest()}\n'
key = bytes(range(1, 17))
with tempfile.TemporaryDirectory(prefix='coollamp-bridge-lamp-') as folder:
    folder = Path(folder)
    files = {'Arduino.h': arduino, 'Preferences.h': (ROOT / 'tests/stubs/Preferences.h').read_text(),
        'esp_ota_ops.h': sdk, 'esp_app_format.h': format_text,
        'esp_system.h': '#pragma once\n#include <stdint.h>\nuint32_t esp_random();\n',
        'esp_wifi.h': '#pragma once\n',
        'esp_mac.h': '#pragma once\n#include <stdint.h>\nconstexpr int ESP_MAC_WIFI_STA=0;\nint esp_read_mac(uint8_t*,int);\n',
        'fixture.h': 'const uint8_t image[]={' + ','.join(map(str, image)) + '};\nconst uint8_t fleetKey[]={' + ','.join(map(str, key)) + '};\nconst char keyHex[]=' + json.dumps(key.hex()) + ';\nconst char pinnedManifest[]=' + json.dumps(manifest) + ';\n',
        'fixture.cpp': fixture}
    for name, content in files.items():
        (folder / name).write_text(content)
    includes = ['-I' + str(folder), '-I' + str(ROOT), '-I' + str(ROOT / 'tests'),
                '-I' + str(source / 'include'), '-I' + str(source / 'library')]
    defines = ['-DMBEDTLS_CONFIG_FILE="espnow-host-mbedtls-config.h"', '-DCOOL_LAMP_PUBLIC_RELEASE=1']
    objects = []
    for name in scope['PRIMITIVES']:
        output = folder / (name + '.o')
        subprocess.run(['gcc', '-std=c11', *SANITIZERS, *includes, *defines, '-c',
            str(source / 'library' / (name + '.c')), '-o', str(output)], check=True)
        objects.append(str(output))
    output = folder / 'bridge-lamp.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS, *includes,
        *defines, str(folder / 'fixture.cpp'), str(ROOT / 'bridge/BridgeArtifact.cpp'),
        str(ROOT / 'bridge/BridgeDonation.cpp'), str(ROOT / 'LampFirmwareRelayCrypto.cpp'),
        str(ROOT / 'LampBleUpdate.cpp'), *objects, '-o', str(output)], check=True)
    for scenario in ['success', 'lost-data', 'lost-ack', 'lost-finish-ack', 'wrong-fleet',
                     'auto-off', 'quiet-window', 'rollout-denied', 'attempt-quarantine',
                     'commission', 'corrupt', 'auto-disabled-midway', 'radio-lost']:
        subprocess.run([str(output), scenario], check=True)
