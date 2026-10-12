#pragma once
#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <vector>
enum PreferenceType {PT_INVALID,PT_BLOB};
struct Preferences {
protected:
  uint32_t _handle=0;
public:
  inline static std::map<std::string,std::vector<uint8_t>> storage;
  inline static bool failWrites=false;
  bool begin(const char*,bool) { return true; }
  void end() {}
  bool isKey(const char* key){return storage.count(key)!=0;}
  PreferenceType getType(const char* key){return isKey(key)?PT_BLOB:PT_INVALID;}
  bool remove(const char* key){if(failWrites)return false;return storage.erase(key)>0;}
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
