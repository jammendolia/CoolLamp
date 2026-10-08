#include "LampFactoryReset.h"
#include "FactoryResetRecord.h"
#include "LampConfig.h"
#include "LampFactory.h"
#include "LampAudio.h"
#include "LampGeometry.h"
#include "LampStyle.h"
#include "LampUpdate.h"
#include "LampWifiSetup.h"
#include <Preferences.h>
#include <cstring>

namespace {
bool pending=false,armed=false,bondErase=false;
uint32_t restartAt=0;
constexpr const char* RESET_NAMESPACE="coollamp-reset";
constexpr const char* RESET_KEY="pendingV1";
constexpr const char* STYLE_KEY="styleV1";

// The original pendingV1 bytes remain unchanged. A separate snapshot reaches
// CLEARING before any settings are erased, so phase-zero retries retain style.
struct ResetStyleRecord {
  uint8_t data[14]{};
  void encode(const FactoryResetRecord& reset,uint8_t style,uint8_t phase) {
    data[0]=1;data[1]=phase;data[2]=style;
    FactoryResetRecord normalized;
    normalized.encode(reset.leds(),reset.power(),reset.midpoint(),reset.data[8]);
    memcpy(data+3,normalized.data,sizeof(normalized.data));
    data[13]=0x3c;for(unsigned i=0;i<13;++i)data[13]^=data[i];
  }
  bool valid() const {
    uint8_t check=0x3c;for(unsigned i=0;i<13;++i)check^=data[i];
    FactoryResetRecord reset;memcpy(reset.data,data+3,sizeof(reset.data));
    return data[0]==1&&data[1]<=1&&data[2]<=uint8_t(LampPhysicalStyle::Corkscrew)&&
      data[13]==check&&reset.valid()&&reset.data[1]==0;
  }
  bool matches(const FactoryResetRecord& reset) const {
    FactoryResetRecord normalized;
    normalized.encode(reset.leds(),reset.power(),reset.midpoint(),reset.data[8]);
    return memcmp(data+3,normalized.data,sizeof(normalized.data))==0;
  }
};
bool readStoredStyle(uint8_t& style) {
  style=0;
  // Recovery runs before beginLampStyle(), so read the persisted scalar rather
  // than its as-yet uninitialized runtime cache. A missing namespace is valid.
  Preferences prefs;if(!prefs.begin("coollamp",false))return false;
  if(prefs.getType("lampStyle")==PT_U8){
    const uint8_t value=prefs.getUChar("lampStyle",255);
    if(value<=uint8_t(LampPhysicalStyle::Corkscrew))style=value;
  }
  prefs.end();return true;
}
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
  if(!record.valid())return false;
  uint8_t style;if(!readStoredStyle(style))return false;
  Preferences recovery;if(!recovery.begin(RESET_NAMESPACE,false))return false;
  FactoryResetRecord existing;
  const size_t length=recovery.getBytesLength(RESET_KEY);
  if(length==sizeof(existing)){
    const bool loaded=recovery.getBytes(RESET_KEY,&existing,sizeof(existing))==sizeof(existing);
    if(!loaded||existing.valid()){recovery.end();return false;}
  }
  // Always replace an orphan snapshot before starting a new transaction. A
  // prepared snapshot is never trusted by recovery until refreshed from NVS.
  ResetStyleRecord snapshot;snapshot.encode(record,style,0);
  const bool saved=recovery.putBytes(STYLE_KEY,&snapshot,sizeof(snapshot))==sizeof(snapshot)&&
    recovery.putBytes(RESET_KEY,&record,sizeof(record))==sizeof(record);
  recovery.end();if(!saved)return false;
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
  ResetStyleRecord snapshot;
  const bool hasSnapshot=recovery.isKey(STYLE_KEY);
  const bool validSnapshot=hasSnapshot&&recovery.getType(STYLE_KEY)==PT_BLOB&&
    recovery.getBytesLength(STYLE_KEY)==sizeof(snapshot)&&
    recovery.getBytes(STYLE_KEY,&snapshot,sizeof(snapshot))==sizeof(snapshot)&&snapshot.valid();
  recovery.end();
  // A malformed marker must never trigger a destructive reset.
  if(!loaded||!record.valid())return true;
  if(record.data[1]==0){
    if(hasSnapshot&&!validSnapshot)return false;
    // Legacy pendingV1 records have no snapshot. Prepared or unrelated records
    // can be stale, so only a matching CLEARING record is retry authority.
    if(!validSnapshot||snapshot.data[1]==0||!snapshot.matches(record)){
      uint8_t style;if(!readStoredStyle(style))return false;
      snapshot.encode(record,style,1);
      Preferences styles;if(!styles.begin(RESET_NAMESPACE,false))return false;
      const bool saved=styles.putBytes(STYLE_KEY,&snapshot,sizeof(snapshot))==sizeof(snapshot);
      styles.end();if(!saved)return false;
    }
    LampSettings settings{};settings.version=1;
    settings.ledCount=record.leds();settings.milliAmps=record.power();
    settings.brightness=100;settings.startupMode=4;
    strlcpy(settings.adminPassword,LAMP_FACTORY_PASSWORD,sizeof(settings.adminPassword));
    const uint8_t audio[7]={2,record.data[8],8,8,0,100,0};
    const uint8_t geometry[3]={1,uint8_t(record.midpoint()),uint8_t(record.midpoint()>>8)};
    Preferences prefs;if(!prefs.begin("coollamp",false))return false;
    const bool ok=prefs.clear()&&prefs.putBytes("settings",&settings,sizeof(settings))==sizeof(settings)&&
      prefs.putBytes("audioV2",audio,sizeof(audio))==sizeof(audio)&&
      prefs.putBytes("geometryV1",geometry,sizeof(geometry))==sizeof(geometry)&&
      (snapshot.data[2]==0||prefs.putUChar("lampStyle",snapshot.data[2])==sizeof(uint8_t));
    prefs.end();if(!ok)return false;
    record.encode(record.leds(),record.power(),record.midpoint(),record.data[8],1);
    if(!writeRecord(record))return false;
  }
  bondErase=true;return true;
}
bool completeLampFactoryReset(){
  if(!bondErase)return true;
  Preferences recovery;if(!recovery.begin(RESET_NAMESPACE,false))return false;
  // Remove the snapshot first: interruption leaves a phase-one marker, which
  // never clears settings again, rather than a reusable CLEARING orphan.
  const bool ok=(!recovery.isKey(STYLE_KEY)||recovery.remove(STYLE_KEY))&&
    (!recovery.isKey(RESET_KEY)||recovery.remove(RESET_KEY));recovery.end();
  if (ok) bondErase=false;
  return ok;
}
