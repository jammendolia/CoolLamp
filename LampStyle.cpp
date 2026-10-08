#include "LampStyle.h"
#include <Arduino.h>
#include <Preferences.h>

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
LampPhysicalStyle getLampStyle(){return current;}
uint8_t lampStyleCode(){return static_cast<uint8_t>(current);}
const char* lampStyleId(){
  switch(current){
    case LampPhysicalStyle::Helix:return "helix";
    case LampPhysicalStyle::LargeHelix:return "large-helix";
    case LampPhysicalStyle::Corkscrew:return "corkscrew";
    default:return "unspecified";
  }
}
const char* lampStyleFamily(){
  switch(current){
    case LampPhysicalStyle::Helix:
    case LampPhysicalStyle::LargeHelix:return "helix";
    case LampPhysicalStyle::Corkscrew:return "corkscrew";
    default:return "unspecified";
  }
}
String lampStyleJson(){
  return String("{\"version\":1,\"code\":")+String(lampStyleCode())+",\"id\":\""+lampStyleId()+"\",\"family\":\""+lampStyleFamily()+"\"}";
}
bool configureLampStyle(uint8_t code){
  if(!valid(code))return false;
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
