#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>
// Allocation-free completeness check before publishing an immutable JSON reply.
// It catches failed/truncated Arduino String appends; metadata is never executed.
namespace LampHttpJson {
struct Member {const char* bytes=nullptr;size_t length=0;explicit operator bool()const{return bytes&&length;}};
class Check {
  const char* at_;const char* end_;
  void space(){while(at_<end_&&(*at_==' '||*at_=='\r'||*at_=='\n'||*at_=='\t'))++at_;}
  bool take(char c){space();if(at_==end_||*at_!=c)return false;++at_;return true;}
  bool literal(const char* text){while(*text){if(at_==end_||*at_++!=*text++)return false;}return true;}
  bool string(){
    if(!take('"'))return false;
    while(at_<end_){const uint8_t c=uint8_t(*at_++);if(c=='"')return true;if(c<32)return false;
      if(c=='\\'){if(at_==end_)return false;const char escape=*at_++;if(escape=='u'){for(unsigned i=0;i<4;++i){if(at_==end_)return false;const char h=*at_++;if(!((h>='0'&&h<='9')||(h>='a'&&h<='f')||(h>='A'&&h<='F')))return false;}}else if(escape!='"'&&escape!='\\'&&escape!='/'&&escape!='b'&&escape!='f'&&escape!='n'&&escape!='r'&&escape!='t')return false;}
    }return false;
  }
  bool number(){
    if(at_<end_&&*at_=='-')++at_;
    if(at_==end_)return false;
    if(*at_=='0')++at_;else{if(*at_<'1'||*at_>'9')return false;while(at_<end_&&*at_>='0'&&*at_<='9')++at_;}
    if(at_<end_&&*at_=='.'){++at_;const char* start=at_;while(at_<end_&&*at_>='0'&&*at_<='9')++at_;if(at_==start)return false;}
    if(at_<end_&&(*at_=='e'||*at_=='E')){++at_;if(at_<end_&&(*at_=='+'||*at_=='-'))++at_;const char* start=at_;while(at_<end_&&*at_>='0'&&*at_<='9')++at_;if(at_==start)return false;}
    return true;
  }
  bool value(unsigned depth){
    space();if(at_==end_||depth>16)return false;
    if(*at_=='"')return string();
    if(*at_=='t')return literal("true");
    if(*at_=='f')return literal("false");
    if(*at_=='n')return literal("null");
    if(*at_=='{'||*at_=='['){const bool object=*at_++=='{';const char close=object?'}':']';if(take(close))return true;
      for(;;){if(object&&(!string()||!take(':')))return false;if(!value(depth+1))return false;if(take(close))return true;if(!take(','))return false;}
    }return number();
  }
public:
  Check(const char* bytes,size_t length):at_(bytes),end_(bytes+length){}
  bool complete(){if(!value(0))return false;space();return at_==end_;}
  Member member(const char* name){
    if(!name||!take('{')||take('}'))return {};
    const size_t wanted=strlen(name);
    for(;;){
      space();const char* key=at_;
      if(!string()||!take(':'))return {};
      // Fixed firmware member names are emitted without JSON escapes. Escaped
      // spellings and occurrences inside values never satisfy this check.
      const bool match=key[0]=='"'&&size_t(end_-key)>wanted+1&&
        memcmp(key+1,name,wanted)==0&&key[wanted+1]=='"';
      space();const char* start=at_;
      if(!value(1))return {};
      if(match)return {start,size_t(at_-start)};
      if(take('}'))return {};
      if(!take(','))return {};
    }
  }
  bool requiredKeys(const char* const* names,size_t count){
    if(!take('{'))return false;
    const uint32_t wanted=count==32?UINT32_MAX:(uint32_t(1)<<count)-1;
    uint32_t found=0;
    if(take('}'))return !wanted;
    for(;;){
      space();const char* key=at_;
      if(!string())return false;
      const size_t keyLength=size_t(at_-key)-2;
      if(!take(':'))return false;
      for(size_t i=0;i<count;++i){
        if(!names[i])return false;
        if(strlen(names[i])==keyLength&&!memcmp(key+1,names[i],keyLength))found|=uint32_t(1)<<i;
      }
      if(!value(1))return false;
      if(take('}'))return found==wanted;
      if(!take(','))return false;
    }
  }
  bool arrayCount(size_t& count){
    count=0;
    if(!take('['))return false;
    if(take(']'))return true;
    for(;;){
      if(!value(1))return false;
      ++count;
      if(take(']'))return true;
      if(!take(','))return false;
    }
  }
};
inline bool complete(const char* bytes,size_t length){return bytes&&length&&Check(bytes,length).complete();}
inline Member member(const char* bytes,size_t length,const char* name){
  return complete(bytes,length)?Check(bytes,length).member(name):Member{};
}
inline bool requiredKeys(const char* bytes,size_t length,const char* const* names,size_t count){
  if(!names||count>32||!complete(bytes,length))return false;
  return Check(bytes,length).requiredKeys(names,count);
}
inline bool arrayCount(const char* bytes,size_t length,size_t& count){
  count=0;
  return complete(bytes,length)&&Check(bytes,length).arrayCount(count);
}
}
