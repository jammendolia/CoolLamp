#include "LampGeometry.h"
#include "LampNvsBlob.h"
uint16_t lampMidpoint = 0;
uint8_t lampMotionPath = 0;
namespace {
bool motionUncertain=false;
bool readMotion(LampNvsBlobPreferences& prefs,LampMotionPathRecord& record,bool& exists){
  size_t length=sizeof(record);
  const auto result=prefs.readBlob(LAMP_MOTION_PATH_KEY,&record,length);
  exists=result!=ESP_ERR_NVS_NOT_FOUND;
  if(!exists){record.encode(0);return true;}
  return result==ESP_OK&&length==sizeof(record)&&record.valid();
}
bool sameMotion(LampNvsBlobPreferences& prefs,const LampMotionPathRecord& expected,bool expectedExists){
  LampMotionPathRecord actual;bool exists=false;
  return readMotion(prefs,actual,exists)&&exists==expectedExists&&
    (!exists||!memcmp(actual.data,expected.data,sizeof(actual.data)));
}
}
void loadLampGeometry() {
  lampMidpoint = 0;
  lampMotionPath=0;motionUncertain=false;
  uint8_t path=0;if(readStoredLampMotionPath(path))lampMotionPath=path;
  else motionUncertain=true; // Safe rendering fallback is not a durable setting.
  Preferences prefs;
  if (!prefs.begin("coollamp", true)) return;
  uint8_t data[3]{};
  const bool ok = prefs.getBytesLength("geometryV1") == sizeof(data) &&
    prefs.getBytes("geometryV1", data, sizeof(data)) == sizeof(data);
  prefs.end();
  const uint16_t saved = uint16_t(data[1]) | uint16_t(data[2]) << 8;
  if (ok && data[0] == 1 && saved < 1024) lampMidpoint = saved;
}
bool saveLampGeometry(uint16_t midpoint, uint16_t count) {
  if (!count || count > 1024 || midpoint >= count) return false;
  const uint8_t data[3] = {1, uint8_t(midpoint), uint8_t(midpoint >> 8)};
  Preferences prefs;
  if (!prefs.begin("coollamp", false)) return false;
  const bool ok = prefs.putBytes("geometryV1", data, sizeof(data)) == sizeof(data);
  prefs.end();
  if (ok) lampMidpoint = midpoint;
  return ok;
}
bool readStoredLampMotionPath(uint8_t& path){
  path=0;LampNvsBlobPreferences prefs;
  // A writable open distinguishes a missing key from an unavailable store;
  // only an empty namespace may be created. No user record is written here.
  if(!prefs.begin(LAMP_MOTION_PATH_NAMESPACE,false))return false;
  LampMotionPathRecord record;bool exists=false;
  const bool valid=readMotion(prefs,record,exists);prefs.end();
  if(valid)path=record.path();
  return valid;
}
bool saveLampMotionPath(uint8_t path){
  if(path>1)return false;
  LampNvsBlobPreferences prefs;if(!prefs.begin(LAMP_MOTION_PATH_NAMESPACE,false)){motionUncertain=true;return false;}
  LampMotionPathRecord old,next;bool existed=false;
  if(!readMotion(prefs,old,existed)){motionUncertain=true;prefs.end();return false;}
  if(existed&&old.path()==path){lampMotionPath=path;motionUncertain=false;prefs.end();return true;}
  next.encode(path);
  const bool committed=prefs.putBytes(LAMP_MOTION_PATH_KEY,&next,sizeof(next))==sizeof(next);
  if(committed&&sameMotion(prefs,next,true)){lampMotionPath=path;motionUncertain=false;prefs.end();return true;}
  // At most one compensating write/remove. A failed API may have committed;
  // preserve the verified old record (including its absence) before returning.
  if(existed)prefs.putBytes(LAMP_MOTION_PATH_KEY,&old,sizeof(old));
  else prefs.remove(LAMP_MOTION_PATH_KEY);
  const bool restored=sameMotion(prefs,old,existed);
  motionUncertain=!restored;
  if(restored)lampMotionPath=old.path();
  prefs.end();return false;
}
bool lampMotionPathSaveUncertain(){return motionUncertain;}
