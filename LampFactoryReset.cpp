#include "LampFactoryReset.h"
#include "FactoryResetRecord.h"
#include "LampConfig.h"
#include "LampFactory.h"
#include "LampAudio.h"
#include "LampGeometry.h"
#include "LampUpdate.h"
#include "LampWifiSetup.h"
#include <Preferences.h>

namespace {
bool pending=false,armed=false,bondErase=false;
uint32_t restartAt=0;
constexpr const char* RESET_NAMESPACE="coollamp-reset";
constexpr const char* RESET_KEY="pendingV1";
bool writeRecord(const FactoryResetRecord& record) {
  Preferences prefs;if(!prefs.begin(RESET_NAMESPACE,false))return false;
  const bool ok=prefs.putBytes(RESET_KEY,&record,sizeof(record))==sizeof(record);prefs.end();return ok;
}
}
bool lampFactoryResetPending(){return pending;}
bool lampFactoryResetArmed(){return armed;}
void armLampFactoryReset(bool next){armed=next&&!pending&&!lampUpdateOwnsResources();}
bool lampFactoryResetNeedsBondErase(){return bondErase;}
bool requestLampFactoryReset(){
  if(pending||lampUpdateOwnsResources())return false;
  if(!stopLampAudio())return false;
  FactoryResetRecord record;
  const uint16_t midpoint=lampMidpoint<lampSettings.ledCount?lampMidpoint:lampSettings.ledCount-1;
  record.encode(lampSettings.ledCount,lampSettings.milliAmps,midpoint,lampHasMicrophone());
  if(!record.valid()||!writeRecord(record))return false;
  const uint8_t cancel[4]={1,1,WifiSetupWire::CONTROL,2};String response;
  lampWifiSetupCommand(cancel,sizeof(cancel),0,response);
  pending=true;armed=false;restartAt=millis()+1500;
  return true;
}
void serviceLampFactoryReset(){
  if(pending&&int32_t(millis()-restartAt)>=0)ESP.restart();
}
bool recoverLampFactoryReset(){
  FactoryResetRecord record;
  Preferences recovery;
  if(!recovery.begin(RESET_NAMESPACE,true))return true;
  const size_t length=recovery.getBytesLength(RESET_KEY);
  const bool loaded=length==sizeof(record)&&recovery.getBytes(RESET_KEY,&record,sizeof(record))==sizeof(record);
  recovery.end();
  // A malformed marker must never trigger a destructive reset.
  if(!loaded||!record.valid())return true;
  if(record.data[1]==0){
    LampSettings settings{};settings.version=1;
    settings.ledCount=record.leds();settings.milliAmps=record.power();
    settings.brightness=100;settings.startupMode=4;
    strlcpy(settings.adminPassword,LAMP_FACTORY_PASSWORD,sizeof(settings.adminPassword));
    const uint8_t audio[7]={2,record.data[8],8,8,0,100,0};
    const uint8_t geometry[3]={1,uint8_t(record.midpoint()),uint8_t(record.midpoint()>>8)};
    Preferences prefs;if(!prefs.begin("coollamp",false))return false;
    const bool ok=prefs.clear()&&prefs.putBytes("settings",&settings,sizeof(settings))==sizeof(settings)&&
      prefs.putBytes("audioV2",audio,sizeof(audio))==sizeof(audio)&&
      prefs.putBytes("geometryV1",geometry,sizeof(geometry))==sizeof(geometry);
    prefs.end();if(!ok)return false;
    record.encode(record.leds(),record.power(),record.midpoint(),record.data[8],1);
    if(!writeRecord(record))return false;
  }
  bondErase=true;return true;
}
bool completeLampFactoryReset(){
  if(!bondErase)return true;
  Preferences recovery;if(!recovery.begin(RESET_NAMESPACE,false))return false;
  const bool ok=recovery.remove(RESET_KEY);recovery.end();
  if (ok) bondErase=false;
  return ok;
}
