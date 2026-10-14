#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
// Privileged local USB setup only. This parser never authorizes HTTP trust.
namespace BridgeUsbProtocol {
enum class Kind:uint8_t {Invalid,Status,Setup,Cache,Wifi,Trust,Diagnostics};
struct Command {Kind kind=Kind::Invalid;char ssid[33]{},password[65]{},target[13]{},fleetId[17]{};uint8_t fleet[16]{};};
inline void erase(void* memory,size_t n){volatile uint8_t* p=static_cast<volatile uint8_t*>(memory);while(n--)*p++=0;}
inline int hex(char c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;}
inline bool decode(const char* text,size_t length,uint8_t* out,size_t cap,size_t& n,bool printable){n=0;if(length%2||length/2>cap)return false;for(size_t i=0;i<length;i+=2){const int a=hex(text[i]),b=hex(text[i+1]);if(a<0||b<0)return false;const uint8_t value=uint8_t(a*16+b);if(printable&&(value<32||value==127))return false;out[n++]=value;}return true;}
inline bool parse(const char* text,size_t length,Command& out){
 out={};if(!text||!length||length>1024||memchr(text,0,length))return false;
 const char* words[4]{};size_t sizes[4]{},count=0,at=0;
 while(at<length){if(count==4||text[at]==' ')return false;const size_t start=at;while(at<length&&text[at]!=' '){if(uint8_t(text[at])<32||uint8_t(text[at])>126)return false;++at;}words[count]=text+start;sizes[count++]=at-start;if(at<length)++at;}
 auto equal=[&](const char* expected){return sizes[0]==strlen(expected)&&!memcmp(words[0],expected,sizes[0]);};
 if(count==1){out.kind=equal("status")?Kind::Status:equal("setup")?Kind::Setup:equal("cache")?Kind::Cache:equal("diagnostics")?Kind::Diagnostics:Kind::Invalid;return out.kind!=Kind::Invalid;}
 if(equal("wifi")&&count==3){size_t a=0,b=0;if(!decode(words[1],sizes[1],reinterpret_cast<uint8_t*>(out.ssid),32,a,true)||!a)return false;if(sizes[2]==1&&words[2][0]=='-')b=0;else if(!decode(words[2],sizes[2],reinterpret_cast<uint8_t*>(out.password),64,b,true))return false;if(b&&b<8)return false;out.kind=Kind::Wifi;return true;}
 if(equal("trust")&&count==4&&sizes[1]==12&&sizes[2]==16&&sizes[3]==32){for(size_t i=0;i<sizes[1];++i)if(hex(words[1][i])<0)return false;for(size_t i=0;i<sizes[2];++i)if(hex(words[2][i])<0)return false;size_t n=0;if(!decode(words[3],sizes[3],out.fleet,16,n,false)||n!=16)return false;uint8_t any=0;for(uint8_t b:out.fleet)any|=b;if(!any)return false;memcpy(out.target,words[1],12);memcpy(out.fleetId,words[2],16);out.kind=Kind::Trust;return true;}
 return false;
}
}
