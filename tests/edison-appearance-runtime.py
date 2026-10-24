"""Exercise production LampColors persistence with targeted NVS interruptions."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
PREFERENCES = r'''
#pragma once
#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <vector>
struct Preferences {
  inline static std::map<std::string,std::vector<uint8_t>> storage;
  inline static std::map<std::string,unsigned> keyWrites;
  inline static std::string failKey;
  inline static bool failOpen=false,commitThenFail=false;
  inline static unsigned writes=0;
  bool begin(const char*,bool){return !failOpen;}
  void end(){}
  size_t getBytesLength(const char* key){auto found=storage.find(key);return found==storage.end()?0:found->second.size();}
  size_t getBytes(const char* key,void* data,size_t length){auto found=storage.find(key);if(found==storage.end()||found->second.size()!=length)return 0;memcpy(data,found->second.data(),length);return length;}
  size_t putBytes(const char* key,const void* data,size_t length){
    if(failKey==key)return 0;
    const auto* bytes=static_cast<const uint8_t*>(data);storage[key]={bytes,bytes+length};++writes;++keyWrites[key];return commitThenFail?0:length;
  }
};
'''
with tempfile.TemporaryDirectory(prefix='coollamp-edison-appearance-') as directory:
    folder = Path(directory)
    (folder/'Preferences.h').write_text(PREFERENCES)
    executable = folder/'edison-appearance.exe'
    subprocess.run(['g++','-std=c++17','-Os','-Wall','-Wextra','-Werror',*SANITIZERS,
                    '-I',str(folder),'-I',str(ROOT),str(ROOT/'tests/edison-appearance.cpp'),
                    '-o',str(executable)],check=True)
    subprocess.run([str(executable)],check=True)
