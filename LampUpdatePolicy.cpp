#include "LampUpdatePolicy.h"
namespace LampUpdatePolicy {
namespace {
bool number(const char*& p,unsigned min,unsigned max){
 if(*p<'0'||*p>'9')return false;
 unsigned n=0,count=0;do{n=n*10+unsigned(*p++-'0');if(++count>3)return false;}while(*p>='0'&&*p<='9');
 return n>=min&&n<=max;
}
bool name(const char*& p){unsigned n=0;while((*p>='A'&&*p<='Z')||(*p>='a'&&*p<='z')){++p;if(++n>16)return false;}return n>=3;}
bool offset(const char*& p){if(*p=='+'||*p=='-')++p;if(!number(p,0,14))return false;if(*p==':'){++p;if(!number(p,0,59))return false;}return true;}
bool rule(const char*& p){
 if(*p++!='M'||!number(p,1,12)||*p++!='.'||!number(p,1,5)||*p++!='.'||!number(p,0,6))return false;
 if(*p=='/'){++p;if(!number(p,0,23))return false;if(*p==':'){++p;if(!number(p,0,59))return false;}}
 return true;
}
uint32_t crc(const uint8_t* p,size_t n){uint32_t c=~uint32_t(0);while(n--){c^=*p++;for(unsigned i=0;i<8;++i)c=c&1?(c>>1)^0xedb88320:c>>1;}return ~c;}
void put32(uint8_t* p,uint32_t v){for(unsigned i=0;i<4;++i)p[i]=uint8_t(v>>(8*i));}
uint32_t get32(const uint8_t* p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
}
bool validTimezone(const char* text){
 if(!text)return false;
 size_t length=0;while(length<TimezoneCapacity&&text[length])++length;
 if(length==TimezoneCapacity)return false;
 const char* p=text;if(!name(p)||!offset(p))return false;
 if(!*p)return true;
 if(!name(p))return false;
 if(*p!=','&&!offset(p))return false;
 return *p++==','&&rule(p)&&*p++==','&&rule(p)&&!*p;
}
bool valid(const Policy& p){return p.startMinute<1440&&p.endMinute<1440&&(!p.window||p.startMinute!=p.endMinute)&&p.idleSeconds>=1&&p.idleSeconds<=86400&&validTimezone(p.timezone);}
void encode(const Policy& p,uint32_t revision,uint8_t* out){
 memset(out,0,RecordSize);out[0]=1;out[1]=(p.window?1:0)|(p.deferDuringUse?2:0);
 out[2]=p.startMinute;out[3]=p.startMinute>>8;out[4]=p.endMinute;out[5]=p.endMinute>>8;
 put32(out+6,p.idleSeconds);put32(out+10,revision);memcpy(out+14,p.timezone,strlen(p.timezone));
 put32(out+80,crc(out,80));
}
bool decode(const uint8_t* p,size_t n,Policy& out,uint32_t& revision){
 if(!p||n!=RecordSize||p[0]!=1||(p[1]&~3)||p[78]||p[79]||get32(p+80)!=crc(p,80))return false;
 Policy next;next.window=p[1]&1;next.deferDuringUse=p[1]&2;next.startMinute=p[2]|uint16_t(p[3])<<8;next.endMinute=p[4]|uint16_t(p[5])<<8;
 next.idleSeconds=get32(p+6);memcpy(next.timezone,p+14,TimezoneCapacity);const uint32_t r=get32(p+10);
 if(!r||!valid(next))return false;
 // Canonical zero padding rejects ambiguous encodings of the same policy.
 uint8_t normalized[RecordSize];encode(next,r,normalized);if(memcmp(normalized,p,n))return false;
 out=next;revision=r;return true;
}
Eligibility eligibility(const Policy& p,bool automatic,bool clockValid,uint16_t minute,uint32_t now,bool used,uint32_t lastUse){
 if(!valid(p))return InvalidPolicy;
 if(!automatic)return AutomaticDisabled;
 if(p.deferDuringUse&&used&&uint32_t(now-lastUse)<p.idleSeconds*1000UL)return InUse;
 if(!p.window)return Ready;
 if(!clockValid||minute>=1440)return ClockUnknown;
 const bool inside=p.startMinute<p.endMinute?minute>=p.startMinute&&minute<p.endMinute:minute>=p.startMinute||minute<p.endMinute;
 return inside?Ready:OutsideWindow;
}
}
