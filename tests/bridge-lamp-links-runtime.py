"""Production bridge serving policy with fault-injected NVS, no radio/device."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
PREFERENCES = r'''#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <string>
#include <map>
#include <vector>
enum PreferenceType {PT_INVALID,PT_BLOB};
struct Preferences {
 enum Failure {None,Unapplied,AppliedButShort,Partial};
 inline static std::map<std::string,std::vector<uint8_t>> storage;
 inline static unsigned opens=0,reads=0,writes=0;
 inline static Failure failure=None;
 inline static bool namespacePresent=false,unavailable=false,failReadOpen=false,failWriteOpen=false,wrongType=false,keyLookupFailure=false,keyReadFailure=false;
 std::string space;
 bool readOnly=true;
 bool begin(const char* name,bool ro){++opens;space=name;readOnly=ro;return !unavailable&&!(ro?failReadOpen:failWriteOpen);}
 void end(){}
 std::string key(const char* name)const{return space+"/"+name;}
 bool isKey(const char* name){++reads;return storage.count(key(name));}
 PreferenceType getType(const char*){++reads;return wrongType?PT_INVALID:PT_BLOB;}
 size_t getBytesLength(const char* name){++reads;auto found=storage.find(key(name));return found==storage.end()?0:found->second.size();}
 size_t getBytes(const char* name,void* out,size_t n){++reads;auto found=storage.find(key(name));if(found==storage.end()||found->second.size()!=n)return 0;memcpy(out,found->second.data(),n);return n;}
 size_t putBytes(const char* name,const void* data,size_t n){if(readOnly)return 0;++writes;namespacePresent=true;const auto* bytes=static_cast<const uint8_t*>(data);if(failure==Unapplied)return 0;if(failure==Partial){storage[key(name)]={bytes,bytes+n-1};return n-1;}storage[key(name)]={bytes,bytes+n};return failure==AppliedButShort?n-1:n;}
};
'''
NVS = r'''#pragma once
#include "Preferences.h"
using nvs_handle_t=unsigned;
constexpr int NVS_READONLY=1,ESP_OK=0,ESP_ERR_NVS_NOT_FOUND=1;
inline int nvs_open(const char*,int,nvs_handle_t* out){if(Preferences::unavailable)return -1;if(!Preferences::namespacePresent)return ESP_ERR_NVS_NOT_FOUND;*out=1;return ESP_OK;}
inline void nvs_close(nvs_handle_t){}
inline int nvs_get_blob(nvs_handle_t,const char* key,void* output,size_t* length){++Preferences::reads;if((output?Preferences::keyReadFailure:Preferences::keyLookupFailure)||Preferences::wrongType)return -1;const auto found=Preferences::storage.find(std::string("bridgelinks/")+key);if(found==Preferences::storage.end())return ESP_ERR_NVS_NOT_FOUND;if(!output){*length=found->second.size();return ESP_OK;}if(*length<found->second.size())return -1;*length=found->second.size();memcpy(output,found->second.data(),*length);return ESP_OK;}
'''
with tempfile.TemporaryDirectory(prefix='coollamp-bridge-links-') as folder:
    folder = Path(folder)
    (folder / 'Preferences.h').write_text(PREFERENCES)
    (folder / 'nvs.h').write_text(NVS)
    arduino = (ROOT / 'tests/control-stubs/Arduino.h').read_text().replace(
        'uint64_t getEfuseMac(){return 0xaabbccddeeffULL;}',
        'uint64_t getEfuseMac(){return 0xaabbccddeeffULL;} uint32_t getFreeHeap(){return fakeFreeHeap;} uint32_t getMaxAllocHeap(){return fakeLargestHeap;}').replace(
        '[[maybe_unused]] inline struct', 'inline uint32_t fakeFreeHeap=65536,fakeLargestHeap=65536;\n[[maybe_unused]] inline struct').replace(
        'bool concat(const char* value,size_t size){append(value,size);return true;}',
        'bool concat(const char* value,size_t size){if(failedConcatLiteral&&strlen(failedConcatLiteral)==size&&!memcmp(value,failedConcatLiteral,size)){++concatFailures;return false;}append(value,size);return true;}')
    (folder / 'Arduino.h').write_text(arduino)
    binary = folder / 'bridge-links.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS,
                    '-I' + str(folder), '-I' + str(ROOT / 'tests/control-stubs'),
                    '-I' + str(ROOT), str(ROOT / 'tests/bridge-lamp-links-runtime.cpp'),
                    str(ROOT / 'bridge/BridgeLampLinks.cpp'), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
