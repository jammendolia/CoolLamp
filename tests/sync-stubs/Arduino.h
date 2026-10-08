#pragma once
#include <string>
#include <cstring>
#include <cstdio>
#include <cstdint>
class String : public std::string {
public:
  using std::string::string;
  String(const std::string& s):std::string(s){}
  String(unsigned n):std::string(std::to_string(n)){}
  String(unsigned char n):String(unsigned(n)){}
  friend String operator+(const String& a,const String& b){return String(static_cast<const std::string&>(a)+static_cast<const std::string&>(b));}
  friend String operator+(const char* a,const String& b){return String(a)+b;}
  friend String operator+(const String& a,char b){String s=a;s+=b;return s;}
  friend String operator+(const String& a,const char* b){return a+String(b);}
};
inline uint32_t fakeNow=0;
inline uint32_t millis(){return fakeNow;}
inline uint64_t fakeEfuseMac=0xaabbccddeeffULL;
struct ESPClass{uint64_t getEfuseMac(){return fakeEfuseMac;}};
inline ESPClass ESP;

inline size_t fakeStrlcpy(char* out,const char* source,size_t size){const size_t n=strlen(source);if(size){const size_t copy=n<size-1?n:size-1;memcpy(out,source,copy);out[copy]=0;}return n;}
#define strlcpy fakeStrlcpy
