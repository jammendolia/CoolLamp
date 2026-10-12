"""Production HTTPS inactive-image handler: retryable failures versus commit fence.

SDK/TLS/SHA operations are injected at their failure boundaries. Real crypto
acceptance is covered by the existing publisher/relay suites, not this fixture.
"""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('automatic_download_extract',ROOT/'tests/control-http-adapter.py')
extract=importlib.util.module_from_spec(spec);spec.loader.exec_module(extract)
source=(ROOT/'LampUpdate.cpp').read_text()
functions='\n'.join(extract.function(source,name) for name in ('bool recordAttempt(', 'void downloadRelease()'))
fixture=r'''
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
#include "LampUpdate.h"
using std::min;
constexpr char ROOT[]="https://fixture.invalid/";
LampUpdateStatus status;FirmwareManifest candidate{};
uint32_t candidateEpoch=0;char signedCandidate[16]="signed";char attemptedVersion[24]{};
bool explicitRepair=false,workerCommitFence=false;
int mux=0;
#define portENTER_CRITICAL(p) ((void)(p))
#define portEXIT_CRITICAL(p) ((void)(p))
String versionText(const uint16_t* v){return String(v[0])+"."+String(v[1])+"."+String(v[2]);}
void phase(uint8_t p,uint8_t error=UPDATE_OK){status.phase=p;status.error=error;}
void fail(uint8_t e){phase(UPDATE_ERROR,e);}
void vTaskDelay(int){++fakeNow;}
std::string scenario;unsigned begins=0,writes=0,ends=0,aborts=0,prepares=0,legacyWrites=0,boots=0,publisherWrites=0;
size_t imageWritten=0;bool ledger=false;
constexpr int ESP_OK=0,ESP_IMAGE_HEADER_MAGIC=0xe9,CONFIG_IDF_FIRMWARE_CHIP_ID=5,ESP_APP_DESC_MAGIC_WORD=0x123456;
struct esp_image_header_t {uint8_t magic=ESP_IMAGE_HEADER_MAGIC;uint16_t chip_id=CONFIG_IDF_FIRMWARE_CHIP_ID;};
struct esp_image_segment_header_t {uint32_t value=0;};
struct esp_app_desc_t {uint32_t magic_word=ESP_APP_DESC_MAGIC_WORD;};
struct Partition {size_t size=2031616;} target;
using esp_ota_handle_t=unsigned;
const Partition* esp_ota_get_next_update_partition(void*){return &target;}
int esp_ota_begin(const Partition*,size_t,esp_ota_handle_t* out){++begins;*out=1;return scenario=="begin-failure"?-1:0;}
int esp_ota_write(esp_ota_handle_t,const void*,size_t n){++writes;if(scenario=="write-failure")return -1;imageWritten+=n;return 0;}
int esp_ota_abort(esp_ota_handle_t){++aborts;return 0;}
int esp_ota_end(esp_ota_handle_t){++ends;assert(imageWritten==candidate.size);return scenario=="end-failure"?-1:0;}
int esp_ota_set_boot_partition(const Partition*){assert(ledger&&legacyWrites==1&&ends==1);++boots;return scenario=="boot-selection-failure"?-1:0;}
struct Preferences {
 bool begin(const char* name,bool){assert(!strcmp(name,"coollamp"));return true;}
 size_t putString(const char* key,const String& v){assert(!strcmp(key,"otaAttempt")&&ledger&&ends==1&&imageWritten==candidate.size);++legacyWrites;return scenario=="legacy-storage-failure"?0:v.length();}
 void end(){}
};
namespace UpdatePublisher {
 bool retainManifest(const char*,size_t){++publisherWrites;assert(ends==1);return scenario!="publisher-storage-failure";}
 bool recordEpoch(uint32_t){return true;}
}
namespace LampUpdateAttempt {
 bool prepare(const FirmwareManifest& image,bool){++prepares;assert(ends==1&&image.size==imageWritten&&workerCommitFence);ledger=true;return scenario!="attempt-storage-failure";}
}
struct mbedtls_sha256_context {};
void mbedtls_sha256_init(mbedtls_sha256_context*){}void mbedtls_sha256_free(mbedtls_sha256_context*){}
int mbedtls_sha256_starts(mbedtls_sha256_context*,int){return 0;}
int mbedtls_sha256_update(mbedtls_sha256_context*,const uint8_t*,size_t){return 0;}
int mbedtls_sha256_finish(mbedtls_sha256_context*,uint8_t* digest){memset(digest,0,32);digest[0]=scenario=="hash-failure"?4:3;return 0;}
struct UpdateHttp {
 uint8_t bytes[512]{};size_t at=0;
 bool open(const String&,int& code,int64_t& length){
  code=200;length=scenario=="wrong-size"?511:512;
  esp_image_header_t header;esp_app_desc_t description;
  if(scenario=="wrong-chip")header.chip_id=6;
  memcpy(bytes,&header,sizeof(header));memcpy(bytes+sizeof(header)+sizeof(esp_image_segment_header_t),&description,sizeof(description));
  return scenario!="network-open-failure";
 }
 bool memoryFailure(){return false;}
 int read(char* out,size_t n){if(scenario=="lost-body"&&at)return -1;const size_t count=min(n,size_t(7));memcpy(out,bytes+at,count);at+=count;return int(count);}
 void close(){}
};
'''
main=r'''
int main(int argc,char** argv){assert(argc==2);scenario=argv[1];candidate.version[0]=1;candidate.version[1]=16;candidate.size=512;candidate.sha256[0]=3;
 if(scenario=="publisher-storage-failure")candidateEpoch=1;
 downloadRelease();
 if(scenario=="success"){assert(status.phase==UPDATE_RESTARTING&&workerCommitFence&&boots==1&&legacyWrites==1&&prepares==1&&status.writtenOffset==512);}
 else{assert(status.phase==UPDATE_ERROR);if(scenario=="attempt-storage-failure"||scenario=="legacy-storage-failure"||scenario=="boot-selection-failure"){assert(workerCommitFence&&ledger&&prepares==1);assert(boots==unsigned(scenario=="boot-selection-failure"));}
 else{assert(!workerCommitFence&&!prepares&&!legacyWrites&&!boots);}}
 if(scenario=="network-open-failure"||scenario=="wrong-size")assert(!begins&&!aborts&&!writes);
 if(scenario=="lost-body"||scenario=="wrong-chip"||scenario=="write-failure"||scenario=="hash-failure")assert(aborts==1);
 if(scenario=="publisher-storage-failure")assert(publisherWrites==1&&!ledger);
 std::cout<<"PASS production HTTPS commit boundary "<<scenario<<"\n";
}
'''
with tempfile.TemporaryDirectory(prefix='automatic-download-',dir=ROOT/'.build') as path:
    path=Path(path);(path/'Arduino.h').write_text((ROOT/'tests/sync-stubs/Arduino.h').read_text())
    (path/'fixture.cpp').write_text(fixture+functions+'\n'+main)
    binary=path/'test.exe'
    subprocess.run(['c++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,'-I'+str(path),'-I'+str(ROOT),str(path/'fixture.cpp'),'-o',str(binary)],check=True)
    for scenario in ('success','network-open-failure','wrong-size','lost-body','wrong-chip','begin-failure','write-failure','hash-failure','end-failure','publisher-storage-failure','attempt-storage-failure','legacy-storage-failure','boot-selection-failure'):
        subprocess.run([str(binary),scenario],check=True)
