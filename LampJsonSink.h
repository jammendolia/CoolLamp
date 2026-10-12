#pragma once
#ifndef COOLLAMP_JSON_SINK_H
#define COOLLAMP_JSON_SINK_H
#include <Arduino.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <type_traits>
#include "LampControlResourcePolicy.h"
#include "LampHttpJson.h"

// One bounded encoder is evaluated first in count mode, then against one owned
// String reservation. No full static scratch buffer or growing response copy.
// Callers capture worker-owned/clock snapshots before creating the encoder.
class LampJsonSink {
  String* output_;size_t maximum_,used_=0;bool good_=true;
public:
  explicit LampJsonSink(String* output=nullptr,size_t maximum=8192):output_(output),maximum_(maximum){}
  void fail(){good_=false;}
  bool okay()const{return good_;}size_t size()const{return good_?used_:0;}
  bool concat(const char* value,size_t length){
    if(!good_||!value||length>maximum_-used_){fail();return false;}
    if(output_&&!output_->concat(value,length)){fail();return false;}
    used_+=length;return true;
  }
  bool concat(const char* value){return value?concat(value,strlen(value)):(fail(),false);}
  bool concat(const String& value){return value.length()?concat(value.c_str(),value.length()):good_;}
  bool concat(char value){return concat(&value,1);}
  template<class T,typename std::enable_if<std::is_integral<T>::value&&!std::is_same<T,char>::value,int>::type=0>
  bool concat(T value){
    char digits[21];size_t at=sizeof(digits);const bool negative=std::is_signed<T>::value&&value<0;
    uint64_t magnitude=negative?uint64_t(-(int64_t(value)+1))+1:uint64_t(value);
    do{digits[--at]=char('0'+magnitude%10);magnitude/=10;}while(magnitude);
    if(negative)digits[--at]='-';
    return concat(digits+at,sizeof(digits)-at);
  }
  template<class T>LampJsonSink& operator+=(const T& value){concat(value);return *this;}
  template<class T>LampJsonSink& operator=(const T& value){
    if(used_){fail();return *this;}concat(value);return *this;
  }
  bool quote(const char* value){
    if(!value){fail();return false;}concat('"');
    const char* begin=value;
    for(;*value;++value){const uint8_t c=*value;if(c=='"'||c=='\\'||c<32){
      concat(begin,size_t(value-begin));
      if(c<32){const char hex[]="0123456789abcdef";const char escaped[]={'\\','u','0','0',hex[c>>4],hex[c&15]};concat(escaped,sizeof(escaped));}
      else {concat('\\');concat(char(c));}begin=value+1;
    }}concat(begin,size_t(value-begin));concat('"');return good_;
  }
  bool quote(const String& value){return quote(value.length()?value.c_str():"");}
};
inline void clearLampJson(String& value){
  volatile char* bytes=const_cast<char*>(value.c_str());for(size_t i=0;i<value.length();++i)bytes[i]=0;
  value=static_cast<const char*>(nullptr);
}
template<class Encoder>String lampJsonReply(const Encoder& encode,size_t maximum=8192){
  LampJsonSink count(nullptr,maximum);encode(count);const size_t size=count.size();
  if(!size||!LampControlResourcePolicy::readReplyReady(ESP.getFreeHeap(),ESP.getMaxAllocHeap(),size))return String();
  String result;if(!result.reserve(size))return String();
  LampJsonSink write(&result,size);encode(write);
  if(!write.okay()||write.size()!=size||result.length()!=size||!LampHttpJson::complete(result.c_str(),size)){clearLampJson(result);return String();}
  return result;
}
#endif
