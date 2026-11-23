"""Fault-aware NVS adapter checks for bridge update jobs."""
from pathlib import Path
import subprocess
import tempfile

from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
PREFERENCES = r'''#pragma once
#include <stddef.h>
#include <stdint.h>
#include <map>
#include <string>
#include <vector>
struct Preferences {
 inline static std::map<std::string,std::vector<uint8_t>> storage;
 inline static bool unavailable=false,readFault=false,typeFault=false,writeFault=false,removeFault=false,commitFault=false;
 inline static unsigned writes=0,removes=0,commits=0;
 static void reset(){storage.clear();unavailable=readFault=typeFault=writeFault=removeFault=commitFault=false;writes=removes=commits=0;}
};
'''
NVS = r'''#pragma once
#include "Preferences.h"
#include <cstring>
using nvs_handle_t=unsigned;
using esp_err_t=int;
constexpr int NVS_READONLY=1,NVS_READWRITE=2,ESP_OK=0,ESP_ERR_NVS_NOT_FOUND=1;
inline std::string openedNamespace;
inline std::string key(const char* value){return openedNamespace+"/"+value;}
inline int nvs_open(const char* name,int mode,nvs_handle_t* handle){
 if(Preferences::unavailable)return -1;
 if(mode==NVS_READONLY){bool found=false;for(const auto& item:Preferences::storage)if(item.first.rfind(std::string(name)+"/",0)==0){found=true;break;}if(!found)return ESP_ERR_NVS_NOT_FOUND;}
 openedNamespace=name;*handle=1;return ESP_OK;
}
inline int nvs_get_blob(nvs_handle_t,const char* name,void* output,size_t* count){
 if(Preferences::readFault)return -2;
 if(Preferences::typeFault)return -3;
 auto found=Preferences::storage.find(key(name));
 if(found==Preferences::storage.end())return ESP_ERR_NVS_NOT_FOUND;
 if(!count||*count<found->second.size())return -4;
 *count=found->second.size();std::memcpy(output,found->second.data(),*count);return ESP_OK;
}
inline int nvs_set_blob(nvs_handle_t,const char* name,const void* input,size_t count){
 ++Preferences::writes;if(Preferences::writeFault)return -5;const auto* bytes=static_cast<const uint8_t*>(input);Preferences::storage[key(name)]={bytes,bytes+count};return ESP_OK;
}
inline int nvs_erase_key(nvs_handle_t,const char* name){
 ++Preferences::removes;if(Preferences::removeFault)return -6;auto found=Preferences::storage.find(key(name));if(found==Preferences::storage.end())return ESP_ERR_NVS_NOT_FOUND;Preferences::storage.erase(found);return ESP_OK;
}
inline int nvs_commit(nvs_handle_t){++Preferences::commits;return Preferences::commitFault?-7:ESP_OK;}
inline void nvs_close(nvs_handle_t){}
'''

with tempfile.TemporaryDirectory(prefix="coollamp-bridge-update-storage-") as folder:
    folder = Path(folder)
    (folder / "Preferences.h").write_text(PREFERENCES)
    (folder / "nvs.h").write_text(NVS)
    binary = folder / "bridge-update-storage.exe"
    subprocess.run(
        [
            "g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", *SANITIZERS,
            "-I" + str(folder), "-I" + str(ROOT),
            str(ROOT / "tests/bridge-update-job-storage-runtime.cpp"),
            str(ROOT / "bridge/BridgeUpdateJob.cpp"),
            str(ROOT / "bridge/BridgeUpdateJobStorage.cpp"),
            "-o", str(binary),
        ],
        check=True,
    )
    subprocess.run([str(binary)], check=True)
