#pragma once
#include "Arduino.h"
#include <map>
#include <vector>
struct Preferences {
  inline static std::map<std::string,std::vector<uint8_t>> storage;
  inline static std::map<std::string,String> strings;
  inline static bool failOpen=false,failWrites=false;
  inline static unsigned writes=0;
  bool begin(const char*,bool){return !failOpen;}
  void end(){}
  size_t putBytes(const char* key,const void* data,size_t length){
    if(failWrites)return 0;
    const auto* bytes=static_cast<const uint8_t*>(data);storage[key]={bytes,bytes+length};++writes;return length;
  }
  size_t putString(const char* key,const String& value){if(failWrites)return 0;strings[key]=value;++writes;return value.length();}
};
