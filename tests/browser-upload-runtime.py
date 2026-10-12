"""Extract real loop-owned browser handlers; real pinned SHA-256, no hardware."""
import ast
import hashlib
import json
import re
import subprocess
import tarfile
import tempfile
import urllib.parse
import importlib.util
from pathlib import Path
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
tree = ast.parse((ROOT / 'tests/espnow-runtime.py').read_text())
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'verified_source' or
         isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ('SOURCE', 'ARCHIVE_SHA', 'PRIMITIVES') for t in n.targets)]
scope = dict(Path=Path, hashlib=hashlib, json=json, tarfile=tarfile)
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'verified_source', 'exec'), scope)
source = scope['verified_source'](ROOT / '.build/tls-library')
network = (ROOT / 'LampNetwork.ino').read_text()
production = network[network.index('void clearLampBrowserUpload('):network.index('void beginLampNetwork()')]
context = network[network.index('struct LampBrowserUpload {'):network.index('const char* const effectNames[]')]
spec=importlib.util.spec_from_file_location('browser_lifecycle_extract',ROOT/'tests/control-http-adapter.py')
extract=importlib.util.module_from_spec(spec);spec.loader.exec_module(extract)
updater=(ROOT/'LampUpdate.cpp').read_text()
lifecycle='\n'.join(extract.function(updater,name) for name in ('void phase(', 'void startReceiverCue()', 'void beginLampManualUpdateCue()', 'void finishLampManualUpdate(', 'void setLampManualUpdateCueProgress(uint32_t written)', 'void setLampManualUpdateCueProgress(uint32_t written,uint32_t total)'))
version = re.search(r'LAMP_FIRMWARE_VERSION "([^"]+)"', (ROOT / 'LampVersion.h').read_text())[1]
image = bytearray(512)
image[0] = 0xe9
image[12:14] = (5).to_bytes(2, 'little')
image[32:36] = (0xabcd5432).to_bytes(4, 'little')
marker = ('COOLLAMP-PUBLIC-' + version + '\0').encode()
image[300:300 + len(marker)] = marker
manifest = f'COOLLAMP-OTA-1\n{version}\nesp32c3\ndual-ota-2031616\n512\n{hashlib.sha256(image).hexdigest()}\n'
fixture = r'''
#include <cassert>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <map>
#include <vector>
#include <new>
#include "Arduino.h"
#include "LampUpdate.h"
#include "LampControl.h"
#include "LampUpdateAttempt.h"
#include "UpdatePublisher.h"
#include "LampControlHttpAdapter.h"
#include "esp_ota_ops.h"
#include "esp_app_format.h"
#include <mbedtls/sha256.h>
#include "fixture.h"
using std::min;
uint32_t now=1000;uint32_t millis(){return now;}uint32_t esp_random(){return 0x12345678;}
bool auth=true,rollout=true,reserved=false,allowReserve=true,healthy=true,known=true;
bool publisher=false,validSignature=true,storage=true,epochStorage=true,signedWrongArtifact=false,allowBegin=true,allowWrite=true,allowEnd=true,allowBoot=true,samePartition=false,noPartition=false;
unsigned reserves=0,releases=0,begins=0,aborts=0,ends=0,boots=0,attempts=0,retains=0,epochs=0;
std::vector<uint8_t> written;
esp_partition_t target,running;
const esp_partition_t* esp_ota_get_next_update_partition(const void*){return noPartition?nullptr:samePartition?&running:&target;}
const esp_partition_t* esp_ota_get_running_partition(){return &running;}
int esp_ota_begin(const esp_partition_t* p,size_t size,esp_ota_handle_t* out){assert(reserved&&p==&target&&size==OTA_WITH_SEQUENTIAL_WRITES);++begins;if(!allowBegin)return -1;*out=7;return ESP_OK;}
int esp_ota_write(esp_ota_handle_t handle,const void* bytes,size_t size){assert(handle==7&&reserved&&size<=512);if(!allowWrite)return -1;const auto* p=static_cast<const uint8_t*>(bytes);written.insert(written.end(),p,p+size);return ESP_OK;}
int esp_ota_abort(esp_ota_handle_t handle){assert(handle==7);++aborts;return ESP_OK;}
int esp_ota_end(esp_ota_handle_t handle){assert(handle==7&&written.size()==512);++ends;return allowEnd?ESP_OK:-1;}
int esp_ota_set_boot_partition(const esp_partition_t* p){assert(p==&target&&ends==1&&attempts==1&&reserved);++boots;return allowBoot?ESP_OK:-1;}
FirmwareManifest installed{};
namespace LampFirmwareRelay{bool runningManifest(FirmwareManifest& out){out=installed;return known;}}
namespace LampUpdateAttempt{bool prepare(const FirmwareManifest& p,bool repair){assert(ends==1&&!boots&&repair&&p.size==512);++attempts;return storage;}}
namespace UpdatePublisher{
 bool enforced(){return publisher;}
 bool verifyProvisioned(const char* text,size_t size,Manifest& out){assert(size==strlen(text)&&!strcmp(text,signedManifestText));if(!publisher||!validSignature)return false;char copy[288];strlcpy(copy,manifestText,sizeof(copy));assert(parseFirmwareManifest(copy,out.image));if(signedWrongArtifact)out.image.sha256[0]^=1;out.epoch=7;return true;}
 bool retainManifest(const char* text,size_t size){assert(publisher&&size==strlen(text)&&!strcmp(text,signedManifestText)&&ends==1&&!boots);++retains;return storage;}
 bool recordEpoch(uint32_t epoch){assert(epoch==7&&retains==1&&!boots);++epochs;return storage&&epochStorage;}
}
struct Upload{HTTPUploadStatus status=UPLOAD_FILE_START;String name;size_t currentSize=0,totalSize=0;uint8_t buf[512]{};};
struct FormDecoder: LampControlHttpAdapter {
 FormDecoder():LampControlHttpAdapter(80){}
 bool load(const String& wire){return prepareHttpForm(wire);}
 void clear(){clearHttpForm();}
}formDecoder;
struct Server{
 std::map<String,String> fields;Upload part;bool accepted=false,decoded=false;int code=0;String response;
 bool authenticate(const char*,const char*){return auth;}String header(const String&){return fields["token"];}
 String arg(const String& key){return decoded?formDecoder.arg(key):fields[key];}
 bool fieldsAllowed(const char* const* names,size_t count){return decoded?formDecoder.fieldsAllowed(names,count):!fields.count("unexpected");}
 void send(int c,const char*,const String& text){code=c;response=text;}
 Upload& upload(){return part;}void acceptUpload(bool value){accepted=value;}
}lampServer;
struct{char adminPassword[64]="development";}lampSettings;
String lampToken="11111111111111111111111111111111",otaMessage;
String lampIdentity(){return "f0b950b2f180";}String jsonText(const String& text){return String("\"")+text+"\"";}
bool authorizedLampRequest(bool mutation){if(!auth||(mutation&&lampServer.fields["token"]!=lampToken)){lampServer.code=403;return false;}return true;}
bool lampUpdateOwnsResources(){return reserved;}bool lampRolloutAllowsUnpinnedUpdate(){return rollout;}
bool reserveLampManualUpdate(){++reserves;if(reserved||!allowReserve)return false;reserved=true;return true;}
void releaseLampManualUpdate(){if(reserved)++releases;reserved=false;}
bool lampBootHealthy(){return healthy;}
LampUpdateStatus light{};LampUpdateStatus getLampUpdateStatus(){return light;}
LampUpdateStatus& status=light;bool& manual=reserved;bool manualCommitHeld=false,cuePower=true;int mux=0;
#define portENTER_CRITICAL(p) ((void)(p))
#define portEXIT_CRITICAL(p) ((void)(p))
bool busy(uint8_t p){return p==UPDATE_CHECKING||p==UPDATE_DOWNLOADING||p==UPDATE_RESTARTING;}
LampControlState getLampControlState(){return {4,55,cuePower};}
void setLampUpdateRoute(uint8_t route){light.route=route;}
bool legacyEndFails=false;unsigned legacyEnds=0;
struct{bool running=false;bool isRunning(){return running;}void abort(){running=false;}bool begin(size_t,int){running=true;return true;}size_t write(uint8_t*,size_t n){return n;}bool end(bool){++legacyEnds;running=false;return !legacyEndFails;}const char* errorString(){return "fixture";}size_t progress(){return 0;}}Update;
constexpr size_t UPDATE_SIZE_UNKNOWN=size_t(-1);constexpr int U_FLASH=0;
bool otaActive=false,otaAccepted=false,otaComplete=false,browserUploadReplyRejected=false,browserUploadCommitUncertain=false;
uint64_t browserUploadBootSession=1;
uint32_t otaLastActivity=0,restartAt=0;
constexpr size_t IMAGE_PREFIX_SIZE=sizeof(esp_image_header_t)+sizeof(esp_image_segment_header_t)+sizeof(esp_app_desc_t);
uint8_t imagePrefix[IMAGE_PREFIX_SIZE]{};size_t imagePrefixUsed=0;bool imageValidated=false;
bool failContextAllocation=false;void* contextMemory=nullptr;size_t contextBytes=0;unsigned contextsFreed=0;
void* operator new(size_t size,const std::nothrow_t&)noexcept{if(failContextAllocation)return nullptr;void* out=malloc(size);contextMemory=out;contextBytes=size;return out;}
void operator delete(void* ptr)noexcept{if(ptr==contextMemory){for(size_t i=0;i<contextBytes;++i)assert(static_cast<uint8_t*>(ptr)[i]==0);contextMemory=nullptr;++contextsFreed;}free(ptr);}
void operator delete(void* ptr,size_t)noexcept{::operator delete(ptr);}
void operator delete(void* ptr,const std::nothrow_t&)noexcept{::operator delete(ptr);}
'''
test = r'''
String printable(const char* text){String out=text;for(auto& byte:out)if(byte=='\n')byte='|';return out;}
String encoded(const String& text){String out;char escape[4];for(uint8_t byte:text){if((byte>='A'&&byte<='Z')||(byte>='a'&&byte<='z')||(byte>='0'&&byte<='9')||byte=='-'||byte=='.'||byte=='_')out+=char(byte);else{snprintf(escape,sizeof(escape),"%%%02X",byte);out+=escape;}}return out;}
void submitPreparation(const String& forced=String()){
 String wire=forced;
 if(wire.isEmpty())for(const auto& field:lampServer.fields)if(field.first!="token"){if(!wire.empty())wire+='&';wire+=encoded(field.first)+"="+encoded(field.second);}
 if(!formDecoder.load(wire)){formDecoder.clear();lampServer.code=400;return;}
 lampServer.decoded=true;prepareLampBrowserUpload();lampServer.decoded=false;formDecoder.clear();
}
void prepare(){lampServer.fields={{"token",lampToken},{"deviceId",lampIdentity()},{"manifest",printable(manifestText)}};submitPreparation(pageSerializedForm);}
void start(){assert(browserUpload);lampServer.part.name=String("firmware-")+browserUpload->ticket;lampServer.part.status=UPLOAD_FILE_START;receiveLampUpdate();}
void data(size_t at,size_t count,const uint8_t* bytes=image){lampServer.part.status=UPLOAD_FILE_WRITE;lampServer.part.currentSize=count;memcpy(lampServer.part.buf,bytes+at,count);receiveLampUpdate();}
void finish(){lampServer.part.status=UPLOAD_FILE_END;receiveLampUpdate();}
void stop(){lampServer.part.status=UPLOAD_FILE_ABORTED;receiveLampUpdate();}
int main(int argc,char** argv){
 assert(argc==2);const std::string scenario=argv[1];const bool signedCase=scenario=="signed"||scenario=="signed-storage"||scenario=="bad-signature"||scenario=="wrong-signed-artifact"||scenario=="epoch-storage";const unsigned expectedFrees=signedCase?2:1;
 if(scenario=="auth"){auth=false;prepare();assert(lampServer.code==403&&!browserUpload&&!reserves);return 0;}
 if(scenario=="allocation"){failContextAllocation=true;prepare();assert(lampServer.code==503&&!browserUpload&&!reserved);return 0;}
 prepare();assert(lampServer.code==200&&browserUpload&&browserUpload->prepared&&!reserved&&contextMemory);
 if(scenario=="legacy"||scenario=="legacy-enforced"||scenario=="legacy-end-uncertain"){
  if(scenario=="legacy-enforced")publisher=true;
  lampServer.part.name="firmware";lampServer.part.status=UPLOAD_FILE_START;receiveLampUpdate();
  if(scenario=="legacy-enforced"){assert(!reserved&&!reserves&&!Update.running);clearLampBrowserUpload(false);return 0;}
  assert(reserved&&!browserUpload&&contextsFreed==1&&light.phase==UPDATE_DOWNLOADING&&light.receiving);data(0,512);legacyEndFails=scenario=="legacy-end-uncertain";finish();
  assert(reserved&&!Update.running&&!begins&&!boots&&!light.receiving&&!light.cueOn);
  if(legacyEndFails)assert(!otaComplete&&manualCommitHeld&&browserUploadCommitUncertain&&light.phase==UPDATE_ERROR);else assert(otaComplete&&light.phase==UPDATE_RESTARTING);
  finish();stop();assert(reserved&&legacyEnds==1);return 0;
 }
 if(scenario=="pending"){prepare();assert(lampServer.code==409&&!reserves);clearLampBrowserUpload(false);assert(contextsFreed==1);return 0;}
 if(scenario=="expiry"||scenario=="rollover-expiry"){if(scenario=="rollover-expiry")browserUpload->preparedAt=UINT32_MAX-100;now=browserUpload->preparedAt+30000;serviceLampBrowserUpload(now);assert(!browserUpload&&contextsFreed==1&&!reserves);return 0;}
 if(scenario=="expired-start"){lampServer.part.name=String("firmware-")+browserUpload->ticket;now+=30000;receiveLampUpdate();assert(!browserUpload&&contextsFreed==1&&!reserves&&!begins);return 0;}
 if(scenario=="wrong-target"||scenario=="wrong-boot"||scenario=="wrong-token"||scenario=="wrong-ticket"){
  lampServer.part.name=String("firmware-")+browserUpload->ticket;
  if(scenario=="wrong-target"||scenario=="wrong-ticket")lampServer.part.name[40]^=1;
  if(scenario=="wrong-boot")lampToken[0]='2';
  if(scenario=="wrong-token")lampServer.fields["token"]="foreign";
  receiveLampUpdate();assert(!reserves&&!begins&&browserUpload->prepared&&!lampServer.accepted);clearLampBrowserUpload(false);return 0;
 }
 if(scenario=="manifest-bounds"||scenario=="downgrade"||scenario=="signed-rejected"||scenario=="wrong-identity"){
  clearLampBrowserUpload(false);
  if(scenario=="manifest-bounds")lampServer.fields["manifest"]=String(288,'x');
  if(scenario=="downgrade")lampServer.fields["manifest"].replace(lampServer.fields["manifest"].find(fixtureVersion),strlen(fixtureVersion),"0.0.0");
  if(scenario=="signed-rejected")publisher=true;
  if(scenario=="wrong-identity")lampServer.fields["deviceId"]="aabbccddeeff";
  submitPreparation();assert(lampServer.code==400&&!browserUpload&&!reserves);return 0;
 }
 if(scenario=="raw-newline"||scenario=="duplicate-field"||scenario=="oversized-form"||scenario=="bad-percent"||scenario=="ambiguous-separator"){
  clearLampBrowserUpload(false);
  if(scenario=="raw-newline")lampServer.fields["manifest"]=manifestText;
  if(scenario=="ambiguous-separator")lampServer.fields["manifest"]+="|";
  String forced;
  if(scenario=="duplicate-field")forced=String(pageSerializedForm)+"&deviceId="+lampIdentity();
  if(scenario=="oversized-form")forced=String("manifest=")+String(1025,'x');
  if(scenario=="bad-percent")forced="manifest=%0&deviceId=f0b950b2f180";
  submitPreparation(forced);assert(lampServer.code==400&&!browserUpload&&!reserves);return 0;
 }
 if(signedCase){
  clearLampBrowserUpload(false);publisher=true;validSignature=scenario!="bad-signature";signedWrongArtifact=scenario=="wrong-signed-artifact";
  lampServer.fields["manifest"]=printable(signedManifestText);submitPreparation();
  if(scenario=="bad-signature"){assert(lampServer.code==400&&!browserUpload&&!reserves);return 0;}
  assert(lampServer.code==200);
 }
 if(scenario=="partition")target.size=2031615;
 if(scenario=="running-partition")samePartition=true;
 if(scenario=="begin")allowBegin=false;
 if(scenario=="busy")allowReserve=false;
 if(scenario=="rollout")rollout=false;
 if(scenario=="off")cuePower=false;
 start();
 if(scenario=="partition"||scenario=="running-partition"||scenario=="begin"||scenario=="busy"||scenario=="rollout"){assert(!reserved&&!browserUpload&&!boots);return 0;}
 assert(reserved&&browserUpload->accepted&&lampServer.accepted&&light.route==UPDATE_ROUTE_MANUAL_UPLOAD&&light.totalBytes==512&&!light.writtenOffset&&light.phase==UPDATE_DOWNLOADING&&light.receiving&&light.cueOn==cuePower);
 if(scenario=="duplicate-start"){start();assert(reserves==1&&begins==1&&reserved&&browserUpload->accepted);stop();assert(!reserved);return 0;}
 if(scenario=="abort"){stop();assert(!reserved&&!browserUpload&&!boots&&contextsFreed==1&&!light.receiving&&!light.cueOn&&light.phase==UPDATE_ERROR);return 0;}
 if(scenario=="all-interruptions"){
  for(size_t split=0;split<512;++split){
   if(split)data(0,split);
   stop();assert(!browserUpload&&!reserved&&!boots);
   written.clear();otaComplete=otaAccepted=otaActive=false;prepare();start();
  }
  stop();assert(!reserved&&!browserUpload);puts("PASS every file-byte interruption boundary");return 0;
 }
 auto payload=std::vector<uint8_t>(image,image+512);
 if(scenario=="chip")payload[12]=0;
 if(scenario=="header")payload[32]=0;
 if(scenario=="marker")payload[310]^=1;
 if(scenario=="digest")payload[450]^=1;
 if(scenario=="write")allowWrite=false;
 if(scenario=="too-long"){data(0,512);data(0,1);assert(!browserUpload&&!reserved&&!boots);return 0;}
 if(scenario=="truncated"){data(0,511);finish();assert(!browserUpload&&!reserved&&!boots&&!ends);return 0;}
 data(0,200,payload.data());if(browserUpload)data(200,112,payload.data());if(browserUpload)data(312,200,payload.data());
 if(scenario=="end")allowEnd=false;
 if(scenario=="attempt-storage"||scenario=="signed-storage")storage=false;
 if(scenario=="epoch-storage")epochStorage=false;
 if(scenario=="boot")allowBoot=false;
 finish();
 if(scenario=="chip"||scenario=="header"||scenario=="marker"||scenario=="digest"||scenario=="write"||scenario=="end"||scenario=="attempt-storage"||scenario=="signed-storage"||scenario=="wrong-signed-artifact"||scenario=="epoch-storage"){
  assert(!browserUpload&&!reserved&&!otaComplete&&!boots&&contextsFreed==expectedFrees);return 0;
 }
 if(scenario=="boot"){assert(boots==1&&reserved&&!browserUpload&&!otaComplete&&browserUploadCommitUncertain&&manualCommitHeld&&!light.receiving&&!light.cueOn&&light.phase==UPDATE_ERROR&&otaMessage.find("unconfirmed")!=String::npos);finish();assert(boots==1&&reserved);return 0;}
 assert(!browserUpload&&reserved&&otaComplete&&!otaActive&&!browserUploadCommitUncertain&&!light.receiving&&!light.cueOn&&light.phase==UPDATE_RESTARTING&&boots==1&&attempts==1&&ends==1&&written==payload&&light.writtenOffset==512&&contextsFreed==expectedFrees);
 if(scenario=="signed")assert(retains==1&&epochs==1);
 finish();stop();assert(boots==1&&ends==1&&reserved); // Lost final ACK never recommits or cancels selected data.
 lampServer.part.status=UPLOAD_FILE_START;receiveLampUpdate();assert(browserUploadReplyRejected&&boots==1&&reserves==1);
 light.receiving=false;sendLampBrowserUploadStatus();assert(lampServer.code==200&&lampServer.response.find("\"boot\":\"0000000000000001\"")!=String::npos&&lampServer.response.find("11111111")==String::npos);
 printf("PASS production pinned browser %s; transientContextBytes=%zu idlePointerBytes=%zu\n",argv[1],sizeof(LampBrowserUpload),sizeof(browserUpload));
}
'''

with tempfile.TemporaryDirectory(prefix='browser-upload-', dir=ROOT / '.build') as folder:
    folder = Path(folder)
    sdk = '''#pragma once
#include <stddef.h>
#include <stdint.h>
constexpr int ESP_OK=0;constexpr size_t OTA_WITH_SEQUENTIAL_WRITES=size_t(-2);struct esp_partition_t{size_t size=2031616;};using esp_ota_handle_t=unsigned;
const esp_partition_t* esp_ota_get_next_update_partition(const void*);const esp_partition_t* esp_ota_get_running_partition();
int esp_ota_begin(const esp_partition_t*,size_t,esp_ota_handle_t*);int esp_ota_write(esp_ota_handle_t,const void*,size_t);
int esp_ota_abort(esp_ota_handle_t);int esp_ota_end(esp_ota_handle_t);int esp_ota_set_boot_partition(const esp_partition_t*);
'''
    receiver = ast.parse((ROOT / 'tests/ble-update-runtime.py').read_text())
    constants = {}
    exec(compile(ast.Module(body=[n for n in receiver.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'FORMAT' for t in n.targets)], type_ignores=[]), 'format', 'exec'), constants)
    for name, text in [('esp_ota_ops.h', sdk),
                       ('esp_app_format.h', constants['FORMAT']), ('sha-config.h', '#define MBEDTLS_SHA256_C\n#define MBEDTLS_PLATFORM_C\n'),
                       ('fixture.h', 'const uint8_t image[]={' + ','.join(map(str, image)) + '};\nconst char manifestText[]=' + json.dumps(manifest) + ';\nconst char fixtureVersion[]=' + json.dumps(version) + ';\nconst char pageSerializedForm[]=' + json.dumps(urllib.parse.urlencode({'deviceId': 'f0b950b2f180', 'manifest': manifest.replace('\n', '|')})) + ';\nconst char signedManifestText[]=' + json.dumps(manifest.replace('COOLLAMP-OTA-1\n','COOLLAMP-OTA-2\n') + '7\n00000042\n' + '0'*128 + '\n') + ';'),
                       ('test.cpp', fixture + lifecycle + context + production + test)]:
        (folder / name).write_text(text)
    includes = ['-I' + str(folder), '-I' + str(ROOT / 'tests/http-server-stubs'), '-I' + str(ROOT), '-I' + str(source / 'include'), '-I' + str(source / 'library')]
    defines = ['-DMBEDTLS_CONFIG_FILE="sha-config.h"']
    objects = []
    for name in ('sha256', 'platform_util', 'platform'):
        out = folder / (name + '.o')
        subprocess.run(['gcc', '-std=c11', *SANITIZERS, *includes, *defines, '-c', str(source / 'library' / (name + '.c')), '-o', str(out)], check=True)
        objects.append(str(out))
    binary = folder / 'browser.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-misleading-indentation', *SANITIZERS, *includes, *defines, str(folder / 'test.cpp'), *objects, '-o', str(binary)], check=True)
    scenarios = ('auth', 'allocation', 'legacy', 'legacy-enforced', 'legacy-end-uncertain', 'off', 'pending', 'expiry', 'rollover-expiry', 'expired-start', 'wrong-target', 'wrong-ticket', 'wrong-boot', 'wrong-token',
                 'manifest-bounds', 'downgrade', 'signed-rejected', 'wrong-identity', 'raw-newline', 'duplicate-field', 'oversized-form', 'bad-percent', 'ambiguous-separator', 'signed', 'signed-storage', 'bad-signature', 'wrong-signed-artifact', 'epoch-storage', 'partition', 'running-partition',
                 'begin', 'busy', 'rollout', 'duplicate-start', 'abort', 'all-interruptions', 'chip', 'header', 'marker', 'digest', 'write',
                 'too-long', 'truncated', 'end', 'attempt-storage', 'boot', 'success')
    for scenario in scenarios:
        subprocess.run([str(binary), scenario], check=True)
    print(f'PASS {len(scenarios)} production browser scenarios + every file-byte interruption; actual HTTP form adapter, exact canonical signed bytes, pinned real SHA-256, SDK/publisher/storage hooks mocked; no hardware')
