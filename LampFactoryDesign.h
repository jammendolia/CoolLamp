#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// Public manufacturing metadata, independent of owner credentials/calibration.
// Byte-only records have the same layout in the USB service and application.
namespace LampFactoryDesign {
constexpr const char* Namespace="lampmodel";
constexpr const char* Key="factoryV2";
struct Model {uint8_t version=1,preconfigured=0;char id[49]{},name[65]{},artwork[33]{},hardware[33]{};};
struct Record {uint8_t version=2,reserved=0;Model model{};char style[33]{};};
static_assert(sizeof(Model)==182&&sizeof(Record)==217,"Factory record layout changed; version it.");
inline bool text(const char* value,size_t size,bool key){
  const size_t length=strnlen(value,size);if(!length||length==size)return false;
  for(size_t i=0;i<length;++i){const uint8_t c=value[i];if(c<32||c==127)return false;if(key&&!((c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-'||c=='.'||c=='_'))return false;}
  if(key)return true;
  for(size_t at=0;at<length;){const uint8_t c=value[at++];if(c<128)continue;unsigned extra=0;uint32_t code=0,minimum=0;
    if(c>=0xc2&&c<=0xdf){extra=1;code=c&31;minimum=0x80;}else if(c>=0xe0&&c<=0xef){extra=2;code=c&15;minimum=0x800;}else if(c>=0xf0&&c<=0xf4){extra=3;code=c&7;minimum=0x10000;}else return false;
    while(extra--){if(at==length)return false;const uint8_t b=value[at++];if((b&0xc0)!=0x80)return false;code=(code<<6)|(b&63);}
    if(code<minimum||code>0x10ffff||(code>=0xd800&&code<=0xdfff))return false;
  }return true;
}
inline bool valid(const Model& value){return value.version==1&&value.preconfigured<=1&&text(value.id,sizeof(value.id),true)&&text(value.name,sizeof(value.name),false)&&text(value.artwork,sizeof(value.artwork),true)&&text(value.hardware,sizeof(value.hardware),true);}
inline bool valid(const Record& value){return value.version==2&&!value.reserved&&value.model.preconfigured==1&&valid(value.model)&&text(value.style,sizeof(value.style),true);}
}
