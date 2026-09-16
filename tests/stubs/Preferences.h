#pragma once
#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <vector>
struct Preferences {
  inline static std::map<std::string,std::vector<uint8_t>> storage;
  inline static bool failWrites=false;
  bool begin(const char*,bool) { return true; }
  void end() {}
  size_t getBytesLength(const char* key) { return storage[key].size(); }
  size_t getBytes(const char* key,void* out,size_t length) {
    if(storage[key].size()!=length)return 0;
    memcpy(out,storage[key].data(),length);return length;
  }
  size_t putBytes(const char* key,const void* data,size_t length) {
    if(failWrites)return 0;
    const auto* p=static_cast<const uint8_t*>(data);storage[key]={p,p+length};return length;
  }
};
