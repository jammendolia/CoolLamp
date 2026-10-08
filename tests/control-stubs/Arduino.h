#pragma once
#include <cstdint>
#include <cstring>
#include <string>
#include <type_traits>
#include <cctype>
struct String:std::string {
  using std::string::string;using std::string::operator=;
  String(const std::string& value):std::string(value){}
  String& operator=(const char* value){
    if(value)std::string::operator=(value);
    else {std::string empty;empty.swap(*this);}
    return *this;
  }
  template<class T,typename std::enable_if<std::is_integral<T>::value,int>::type=0>
  String(T value):std::string(std::to_string(value)){}
  bool isEmpty()const{return empty();}
  bool reserve(size_t size){std::string::reserve(size);return true;}
  bool concat(char value){push_back(value);return true;}
  bool concat(const char* value,size_t size){append(value,size);return true;}
  void trim(){while(!empty()&&std::isspace(uint8_t(front())))erase(begin());while(!empty()&&std::isspace(uint8_t(back())))pop_back();}
};
inline size_t strlcpy(char* target,const char* source,size_t capacity){
  const size_t size=strlen(source);if(capacity){const size_t copy=size<capacity-1?size:capacity-1;memcpy(target,source,copy);target[copy]=0;}return size;
}
[[maybe_unused]] inline struct {uint64_t getEfuseMac(){return 0xaabbccddeeffULL;}} ESP;
uint32_t millis();
