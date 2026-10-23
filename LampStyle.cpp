#include "LampStyle.h"
#include <Arduino.h>
#include <Preferences.h>
#include "LampModel.h"
#include "LampJsonSink.h"
#include "LampEffectSchema.h"
#include <cstring>

namespace {
LampPhysicalStyle current=LampPhysicalStyle::Unspecified;
bool saved=false;
constexpr const char* key="lampStyle";
bool valid(uint8_t code){return code<=static_cast<uint8_t>(LampPhysicalStyle::Corkscrew);}
}

// Setup/loop own this scalar. No automatic inference or migration writes:
// older, missing and corrupt records remain explicitly unclassified.
void beginLampStyle() {
  current=LampPhysicalStyle::Unspecified;saved=false;
  Preferences preferences;
  if(!preferences.begin("coollamp",true))return;
  if(preferences.getType(key)==PT_U8){
    const uint8_t code=preferences.getUChar(key,255);
    if(valid(code)){current=static_cast<LampPhysicalStyle>(code);saved=true;}
  }
  preferences.end();
}
LampPhysicalStyle getLampStyle(){
  if(!LampModel::locked())return current;
  const char* const id=LampModel::factoryStyle();
  return !strcmp(id,"helix")?LampPhysicalStyle::Helix:!strcmp(id,"large-helix")?LampPhysicalStyle::LargeHelix:!strcmp(id,"corkscrew")?LampPhysicalStyle::Corkscrew:LampPhysicalStyle::Unspecified;
}
uint8_t lampStyleCode(){return static_cast<uint8_t>(getLampStyle());}
const char* lampStyleId(){
  switch(getLampStyle()){
    case LampPhysicalStyle::Helix:return "helix";
    case LampPhysicalStyle::LargeHelix:return "large-helix";
    case LampPhysicalStyle::Corkscrew:return "corkscrew";
    default:return "unspecified";
  }
}
const char* lampStyleFamily(){
  switch(getLampStyle()){
    case LampPhysicalStyle::Helix:
    case LampPhysicalStyle::LargeHelix:return "helix";
    case LampPhysicalStyle::Corkscrew:return "corkscrew";
    default:return "unspecified";
  }
}
bool lampStyleLocked(){return LampModel::locked();}
bool lampStyleSupportsEffect(uint8_t localId,bool scene){return LampEffectSchema::compatible(LampEffectSchema::styles(localId,scene),LampModel::factoryAvailable()?LampModel::factoryStyle():lampStyleId());}
void appendLampStyleJson(LampJsonSink& out){
  out+="{\"version\":1,\"code\":";out+=lampStyleCode();out+=",\"id\":";out.quote(lampStyleId());out+=",\"family\":";out.quote(lampStyleFamily());out+=",\"locked\":";out+=lampStyleLocked()?"true":"false";
  if(LampModel::factoryAvailable()){out+=",\"factoryStyle\":";out.quote(LampModel::factoryStyle());out+=",\"model\":";LampModel::appendJson(out);}
  else if(lampStyleLocked())out+=",\"factoryStatus\":\"unavailable\"";
  out+='}';
}
String lampStyleJson(){return lampJsonReply(appendLampStyleJson);}
bool configureLampStyle(uint8_t code){
  if(lampStyleLocked()||!valid(code))return false;
  if(saved&&code==lampStyleCode())return true;
  Preferences preferences;
  if(!preferences.begin("coollamp",false))return false;
  // Preferences commits a single typed NVS item before acknowledging success.
  // Update the runtime classification only after the complete save succeeds.
  const bool written=preferences.putUChar(key,code)==sizeof(uint8_t);
  preferences.end();
  if(written){current=static_cast<LampPhysicalStyle>(code);saved=true;}
  return written;
}
