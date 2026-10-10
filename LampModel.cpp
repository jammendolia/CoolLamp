#include "LampModel.h"
#include <Preferences.h>
#include <cstring>
namespace LampModel {
namespace {
Record model;
bool text(const char* value,size_t size,bool key){
  const size_t length=strnlen(value,size);if(!length||length==size)return false;
  for(size_t i=0;i<length;++i){const uint8_t c=value[i];if(c<32||c==127)return false;if(key&&!((c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-'||c=='.'||c=='_'))return false;}
  if(key)return true;
  for(size_t at=0;at<length;){const uint8_t c=value[at++];if(c<128)continue;unsigned extra=0;uint32_t code=0,minimum=0;
    if(c>=0xc2&&c<=0xdf){extra=1;code=c&31;minimum=0x80;}else if(c>=0xe0&&c<=0xef){extra=2;code=c&15;minimum=0x800;}else if(c>=0xf0&&c<=0xf4){extra=3;code=c&7;minimum=0x10000;}else return false;
    while(extra--){if(at==length)return false;const uint8_t b=value[at++];if((b&0xc0)!=0x80)return false;code=(code<<6)|(b&63);}
    if(code<minimum||code>0x10ffff||(code>=0xd800&&code<=0xdfff))return false;
  }return true;
}
String quote(const char* value){String out="\"";for(;*value;++value){if(*value=='"'||*value=='\\')out+='\\';out+=*value;}return out+'"';}
}
bool valid(const Record& value){return value.version==1&&value.preconfigured<=1&&text(value.id,sizeof(value.id),true)&&text(value.name,sizeof(value.name),false)&&text(value.artwork,sizeof(value.artwork),true)&&text(value.hardware,sizeof(value.hardware),true);}
void begin(){
  model={};strcpy(model.id,"custom");strcpy(model.name,"CoolLamp");strcpy(model.artwork,"generic");strcpy(model.hardware,"unspecified");
  Preferences prefs;if(!prefs.begin("lampmodel",true))return;Record saved{};
  const bool loaded=prefs.getBytesLength("descriptorV1")==sizeof(saved)&&prefs.getBytes("descriptorV1",&saved,sizeof(saved))==sizeof(saved);prefs.end();if(loaded&&valid(saved))model=saved;
}
const Record& current(){return model;}
bool provision(const Record& value){if(!valid(value))return false;Preferences prefs;if(!prefs.begin("lampmodel",false))return false;const bool ok=prefs.putBytes("descriptorV1",&value,sizeof(value))==sizeof(value);prefs.end();if(ok)model=value;return ok;}
String json(){return String("{\"version\":1,\"id\":")+quote(model.id)+",\"displayName\":"+quote(model.name)+",\"artworkFamily\":"+quote(model.artwork)+",\"hardwareRevision\":"+quote(model.hardware)+",\"preconfigured\":"+(model.preconfigured?"true":"false")+"}";}
}
