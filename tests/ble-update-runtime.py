"""Exercise the production flash receiver with the pinned, real SHA-256 library."""
import argparse
import ast
import hashlib
import json
import re
from pathlib import Path
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--mbedtls-cache', type=Path, default=ROOT/'.build/tls-library')
args = parser.parse_args()
# Reuse only the existing source-verification function, without executing the
# radio runner's argparse or main. The archive and extraction are both checked.
tree = ast.parse((ROOT/'tests/espnow-runtime.py').read_text())
nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'verified_source' or
         isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in
         ('SOURCE', 'ARCHIVE_SHA', 'PRIMITIVES') for target in node.targets)]
scope = dict(Path=Path, hashlib=hashlib, json=json, tarfile=tarfile)
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'verified_source', 'exec'), scope)
source = scope['verified_source'](args.mbedtls_cache)

ARDUINO = '''#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <string>
#include <algorithm>
using String=std::string;
using std::min;
uint32_t millis();
'''
SDK = '''#pragma once
#include <stdint.h>
#include <stddef.h>
constexpr int ESP_OK=0;
constexpr size_t OTA_WITH_SEQUENTIAL_WRITES=size_t(-2);
struct esp_partition_t {size_t size=2031616;};
using esp_ota_handle_t=unsigned;
const esp_partition_t* esp_ota_get_next_update_partition(const void*);
int esp_ota_begin(const esp_partition_t*,size_t,esp_ota_handle_t*);
int esp_ota_write(esp_ota_handle_t,const void*,size_t);
int esp_ota_abort(esp_ota_handle_t);
int esp_ota_end(esp_ota_handle_t);
int esp_ota_set_boot_partition(const esp_partition_t*);
'''
FORMAT = '''#pragma once
#include <stdint.h>
#define ESP_IMAGE_HEADER_MAGIC 0xe9
#define ESP_APP_DESC_MAGIC_WORD 0xabcd5432
#define CONFIG_IDF_FIRMWARE_CHIP_ID 5
struct esp_image_header_t {uint8_t magic;uint8_t unused[11];uint16_t chip_id;uint8_t tail[10];};
struct esp_image_segment_header_t {uint32_t address,length;};
struct esp_app_desc_t {uint32_t magic_word;uint8_t tail[252];};
'''
FIXTURE = r'''
#include <cassert>
#include <cstdio>
#include <vector>
#include <string>
#include "LampBleUpdate.h"
#include "esp_ota_ops.h"
#include "fixture.h"
using namespace LampBleUpdateWire;
uint32_t clockMs=100000;uint32_t millis(){return clockMs;}
unsigned begins=0,aborts=0,ends=0,boots=0,releases=0;bool reserved=false,verified=false,cancelled=false;
bool allowReserve=true,allowBegin=true,allowWrite=true,allowEnd=true,allowBoot=true;
bool commissionBusy=false;
namespace LampCommission {bool working(){return commissionBusy;}}
bool lampUpdateOwnsResources(){return reserved;}
bool partitionPresent=true;esp_partition_t partition;
std::vector<uint8_t> flash;
bool beginLampBluetoothUpdate(){if(!allowReserve||reserved)return false;reserved=true;return true;}
void setLampBluetoothUpdateProgress(uint32_t bytes,uint32_t total){assert(reserved&&bytes<=total);}
void finishLampBluetoothUpdate(bool ok,bool cancel){assert(reserved);reserved=false;++releases;verified=ok;cancelled=cancel;}
const esp_partition_t* esp_ota_get_next_update_partition(const void*){return partitionPresent?&partition:nullptr;}
int esp_ota_begin(const esp_partition_t* p,size_t size,esp_ota_handle_t* out){assert(reserved&&p==&partition&&size==OTA_WITH_SEQUENTIAL_WRITES);++begins;if(!allowBegin)return -1;*out=1;flash.clear();return 0;}
int esp_ota_write(esp_ota_handle_t handle,const void* bytes,size_t size){assert(handle==1&&reserved);if(!allowWrite)return -1;const auto* p=static_cast<const uint8_t*>(bytes);flash.insert(flash.end(),p,p+size);return 0;}
int esp_ota_abort(esp_ota_handle_t handle){assert(handle==1);++aborts;return 0;}
int esp_ota_end(esp_ota_handle_t handle){assert(handle==1&&reserved);++ends;return allowEnd?0:-1;}
int esp_ota_set_boot_partition(const esp_partition_t* p){assert(p==&partition&&ends==1&&reserved);if(!allowBoot)return -1;++boots;return 0;}
uint32_t generation=7,session=11;uint16_t request=0;
void tick(bool bond=true){serviceLampBleUpdate(generation,bond);}
std::vector<uint8_t> packet(unsigned op,unsigned at=0,const uint8_t* bytes=nullptr,size_t size=0){
 const size_t header=op==Manifest?10:op==Data?12:8;std::vector<uint8_t> p(header+size);
 p[0]=1;p[1]=op;put32(p.data()+2,session);put16(p.data()+6,++request);
 if(op==Manifest)put16(p.data()+8,at);
 if(op==Data)put32(p.data()+8,at);
 if(size)memcpy(p.data()+header,bytes,size);
 return p;
}
void enqueue(const std::vector<uint8_t>& p){assert(enqueueLampBleUpdate(p.data(),p.size(),generation));}
void send(unsigned op,unsigned at=0,const uint8_t* bytes=nullptr,size_t size=0){enqueue(packet(op,at,bytes,size));tick();}
std::vector<uint8_t> status(){
 // The real packet keeps the legacy size/version and committed mask in all
 // phases. ESP-NOW firmware relaying continues to consume phase/offset only.
 std::vector<uint8_t> p(21,0xa5);getLampBleUpdateStatus(p.data());assert(p[20]==0xa5);p.resize(20);
 assert(p[0]==1&&(p[3]&DataWriteWithoutResponseFourFlag)&&DataWriteWithoutResponseWindow==4);
 assert(bool(p[3]&CommittedFlag)==(p[1]==Restarting));return p;
}
void start(const std::string& text=manifestText){
 for(size_t at=0;at<text.size();){const auto count=std::min(size_t(13),text.size()-at);send(Manifest,at,reinterpret_cast<const uint8_t*>(text.data()+at),count);at+=count;}
 send(Start);assert(status()[1]==Preparing&&begins==0&&reserved);tick();assert(begins==0);tick();
}
void upload(const uint8_t* bytes=image){for(size_t at=0;at<sizeof(image);){const auto count=std::min(size_t(121),sizeof(image)-at);send(Data,at,bytes+at,count);at+=count;}assert(u32(status().data()+12)==sizeof(image));}
int main(int argc,char** argv){
 assert(argc==2);const std::string test=argv[1];
 if(test=="wire"){
  Queue q;Frame f;for(unsigned i=0;i<8;++i){f.generation=i;assert(q.push(f));}assert(!q.push(f));for(unsigned i=0;i<8;++i){assert(q.pop(f)&&f.generation==i);}assert(!q.pop(f));
  auto p=packet(Data,0,image,232);assert(valid(p.data(),p.size()));p.push_back(0);assert(!valid(p.data(),p.size()));p=packet(Start);assert(valid(p.data(),p.size()));p[0]=2;assert(!valid(p.data(),p.size()));p=packet(Manifest,191,image,1);assert(!valid(p.data(),p.size()));return 0;
 }
 if(test=="commission"){
  commissionBusy=true;assert(!beginLampRadioFirmwareReceiver(9));
  assert(!begins&&!boots&&!reserved&&status()[1]==Idle);
  commissionBusy=false;assert(beginLampRadioFirmwareReceiver(9));
  abortLampRadioFirmwareReceiver();assert(!begins&&!boots&&!reserved&&status()[1]==Idle);return 0;
 }
 if(test=="downgrade"){std::string old=manifestText;old.replace(old.find(fixtureVersion),strlen(fixtureVersion),"0.0.0");send(Manifest,0,reinterpret_cast<const uint8_t*>(old.data()),old.size());send(Start);assert(status()[1]==Error&&status()[2]==Invalid&&!begins&&!reserved);return 0;}
 if(test=="busy"){allowReserve=false;send(Manifest,0,reinterpret_cast<const uint8_t*>(manifestText),strlen(manifestText));send(Start);assert(status()[2]==Busy&&!begins);return 0;}
 if(test=="partition")partition.size=1024;
 if(test=="begin-error")allowBegin=false;
 start(test=="marker"?noMarkerManifest:manifestText);
 if(test=="partition"||test=="begin-error"){assert(status()[2]==Partition&&!reserved&&!boots);return 0;}
 assert(status()[1]==Receiving&&begins==1);
 if(test=="copied-four"){
  for(size_t at=0;at<sizeof(image);at+=128){auto p=packet(Data,at,image+at,128);enqueue(p);memset(p.data(),0,p.size());}
  assert(u32(status().data()+12)==0&&flash.empty()&&!boots);tick();const auto written=status();
  assert(u32(written.data()+12)==sizeof(image)&&u16(written.data()+16)==request&&flash==std::vector<uint8_t>(image,image+sizeof(image))&&!boots);
  send(Finish);assert(boots==1&&verified&&ends==1&&status()[1]==Restarting);return 0;
 }
 if(test=="queue-limit"){
  for(unsigned i=0;i<8;++i)enqueue(packet(Data,i*16,image+i*16,16));
  const auto excess=packet(Data,128,image+128,16);assert(!enqueueLampBleUpdate(excess.data(),excess.size(),generation));
  tick();assert(u32(status().data()+12)==64&&!boots);tick();assert(u32(status().data()+12)==128&&!boots);
  send(Cancel);assert(status()[2]==Cancelled&&aborts==1&&!ends&&!boots);return 0;
 }
 if(test=="bond"||test=="generation"){
  enqueue(packet(Data,0,image,120));if(test=="generation")++generation;tick(test!="bond");assert(!reserved&&aborts==1&&!boots&&flash.empty()&&status()[1]==Idle&&u32(status().data()+8)==0);return 0;
 }
 if(test=="timeout"){clockMs+=30001;tick();assert(status()[2]==Expired&&!reserved&&aborts==1&&!boots);return 0;}
 if(test=="cancel"){send(Data,0,image,200);send(Cancel);assert(status()[2]==Cancelled&&!reserved&&cancelled&&aborts==1&&!boots);return 0;}
 if(test=="offset"){send(Data,1,image,100);assert(status()[2]==Offset&&aborts==1&&!boots);return 0;}
 if(test=="truncated"){send(Data,0,image,200);send(Finish);assert(status()[2]==Image&&aborts==1&&!ends&&!boots);return 0;}
 if(test=="write-error"){allowWrite=false;send(Data,0,image,232);send(Data,232,image+232,100);assert(status()[2]==Image&&!reserved&&aborts==1&&!boots);return 0;}
 std::vector<uint8_t> altered(image,image+sizeof(image));
 if(test=="sha")altered[400]^=1;
 if(test=="chip")altered[12]=9;
 if(test=="header")altered[0]=0;
 if(test=="marker")altered[320]=0;
 if(test=="chip"||test=="header"){send(Data,0,altered.data(),232);send(Data,232,altered.data()+232,100);assert(status()[2]==Image&&!boots&&flash.empty());return 0;}
 upload(altered.data());assert(!boots&&flash.size()==sizeof(image));
 if(test=="end-error")allowEnd=false;
 if(test=="boot-error")allowBoot=false;
 if(test=="success"){
  enqueue(packet(Finish));enqueue(packet(Cancel));enqueue(packet(Data,0,image,1));tick();
  assert(boots==1&&verified&&!reserved&&status()[1]==Restarting&&(status()[3]&CommittedFlag)==1&&aborts==0);
  ++generation;tick(false);clockMs+=40000;tick(false);assert(boots==1&&status()[1]==Restarting);return 0;
 }
 send(Finish);assert(!boots&&!verified&&!reserved&&status()[1]==Error);
 if(test=="sha"||test=="marker")assert(!ends&&aborts==1);
 if(test=="end-error"||test=="boot-error")assert(ends==1);
 puts(test.c_str());
}
'''

image = bytearray(512)
image[0] = 0xe9
image[12:14] = (5).to_bytes(2, 'little')
image[32:36] = (0xabcd5432).to_bytes(4, 'little')
version = re.search(r'LAMP_FIRMWARE_VERSION "([^"]+)"', (ROOT/'LampVersion.h').read_text())[1]
marker = ('COOLLAMP-PUBLIC-'+version+'\0').encode()
image[300:300+len(marker)] = marker
assert len(image) == 512
manifest = f'COOLLAMP-OTA-1\n{version}\nesp32c3\ndual-ota-2031616\n512\n{hashlib.sha256(image).hexdigest()}\n'
no_marker = image.copy()
no_marker[320] = 0
no_marker_manifest = manifest.replace(hashlib.sha256(image).hexdigest(), hashlib.sha256(no_marker).hexdigest())
with tempfile.TemporaryDirectory(prefix='coollamp-ble-update-') as folder:
    folder = Path(folder)
    for name, text in [('Arduino.h', ARDUINO), ('esp_ota_ops.h', SDK), ('esp_app_format.h', FORMAT),
                       ('fixture.h', 'const uint8_t image[]={'+','.join(map(str, image))+'};\nconst char manifestText[]='+json.dumps(manifest)+';\nconst char fixtureVersion[]='+json.dumps(version)+';\nconst char noMarkerManifest[]='+json.dumps(no_marker_manifest)+';'),
                       ('test.cpp', FIXTURE), ('sha-config.h', '#pragma once\n#define MBEDTLS_SHA256_C\n#define MBEDTLS_PLATFORM_C\n')]:
        (folder/name).write_text(text)
    include = ['-I'+str(folder), '-I'+str(ROOT), '-I'+str(source/'include'), '-I'+str(source/'library')]
    defines = ['-DMBEDTLS_CONFIG_FILE="sha-config.h"']
    objects = []
    for name in ['sha256', 'platform_util', 'platform']:
        output = folder/(name+'.o')
        subprocess.run(['gcc', '-std=c11', *SANITIZERS, *include, *defines, '-c', str(source/'library'/f'{name}.c'), '-o', str(output)], check=True)
        objects.append(str(output))
    binary = folder/'test.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS, *include, *defines,
                    str(folder/'test.cpp'), str(ROOT/'LampBleUpdate.cpp'), *objects, '-o', str(binary)], check=True)
    scenarios = ['wire', 'commission', 'success', 'copied-four', 'queue-limit', 'sha', 'chip', 'header', 'marker', 'downgrade', 'busy', 'partition',
                 'begin-error', 'bond', 'generation', 'timeout', 'cancel', 'offset', 'truncated', 'write-error', 'end-error', 'boot-error']
    for scenario in scenarios:
        subprocess.run([str(binary), scenario], check=True)
    print(f'PASS: {len(scenarios)} production BLE receiver scenarios with pinned real SHA-256')
