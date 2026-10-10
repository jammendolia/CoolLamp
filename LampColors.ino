#include <Preferences.h>
#include "LampSync.h"

// Separate, versioned storage preserves the existing Wi-Fi/settings layout.
static LampColor effectColors[LAMP_EFFECT_COUNT];
static bool colorsDirty = false;
static LampEffectOptions effectOptions[LAMP_EFFECT_COUNT];
static bool optionsDirty = false;
static bool appearanceV2[LAMP_EFFECT_COUNT]{};
static bool appearanceSaveReady=false;
static uint32_t appearanceSavedAt=0;
LampColor defaultLampColor(uint8_t mode);
LampEffectOptions defaultEffectOptions(uint8_t mode);
static constexpr size_t AppearanceBytes=24;
static bool appearanceMigrationPending=false;
bool lampAppearanceMigrationPending(){return appearanceMigrationPending;}

// One atomic NVS item per effect; never writes the startup settings item.
// V1 stays readable and serves as lazy migration input. Existing v2 items are
// also refreshed by legacy saves, so an older API cannot leave a stale overlay.
static void appearanceKey(uint8_t mode,char* key){snprintf(key,9,"look%02u",unsigned(mode));}
static void appearanceBytes(uint8_t mode,uint8_t* data){
  const auto c=effectColors[mode-1];const auto o=effectOptions[mode-1];
  const uint8_t value[12]={2,mode,c.enabled,c.r,c.g,c.b,o.speed,o.intensity,o.dual,o.r,o.g,o.b};memcpy(data,value,sizeof(value));
}
// Exact baseline bytes detect edits made by firmware that only knows catalog
// v1. An old firmware save wins for that effect on the next upgrade, without
// discarding unrelated v2 memories or relying on a collision-prone hash.
static void legacyAppearanceBytes(Preferences& prefs,uint8_t mode,uint8_t* out){
  auto c=defaultLampColor(mode);auto o=defaultEffectOptions(mode);uint8_t blob[229]{};
  if(mode<=LAMP_BASE_EFFECT_COUNT){
    size_t length=prefs.getBytesLength("colors");
    if((length==117||length==149||length==153)&&prefs.getBytes("colors",blob,length)==length&&blob[0]==1){bool valid=true;for(size_t i=1;i<length;i+=4)if(blob[i]>1)valid=false;if(valid&&mode<=(length-1)/4){const auto* p=blob+1+(mode-1)*4;c={p[0],p[1],p[2],p[3]};}}
    length=prefs.getBytesLength("effectOptions");
    if((length==223||length==229)&&prefs.getBytes("effectOptions",blob,length)==length&&blob[0]==1&&mode<=(length-1)/6){const auto* p=blob+1+(mode-1)*6;if(p[0]>=1&&p[0]<=100&&p[1]<=100&&p[2]<=1)o={p[0],p[1],p[2],p[3],p[4],p[5]};}
  }else{
    const size_t length=prefs.getBytesLength("audioEffectsV1");
    if((length==21||length==71||length==81||length==91)&&prefs.getBytes("audioEffectsV1",blob,length)==length&&blob[0]==1&&mode<=LAMP_BASE_EFFECT_COUNT+(length-1)/10){const auto* p=blob+1+(mode-LAMP_BASE_EFFECT_COUNT-1)*10;if(p[0]<=1)c={p[0],p[1],p[2],p[3]};if(p[4]>=1&&p[4]<=100&&p[5]<=100&&p[6]<=1)o={p[4],p[5],p[6],p[7],p[8],p[9]};}
  }
  if(mode==LAMP_CUSTOM_SOLID)c.enabled=1;
  const uint8_t bytes[12]={1,mode,c.enabled,c.r,c.g,c.b,o.speed,o.intensity,o.dual,o.r,o.g,o.b};memcpy(out,bytes,sizeof(bytes));
}
static bool validAppearance(const uint8_t* data,uint8_t mode){return data[0]==2&&data[1]==mode&&data[2]<=1&&data[6]>=1&&data[6]<=100&&data[7]<=100&&data[8]<=1&&(mode!=LAMP_CUSTOM_SOLID||data[2]==1);}
void loadLampAppearanceV2(){
  memset(appearanceV2,0,sizeof(appearanceV2));appearanceSaveReady=false;appearanceMigrationPending=false;uint64_t rebases=0;
  Preferences prefs;if(!prefs.begin("coollamp",true))return;
  for(uint8_t mode=1;mode<=LAMP_EFFECT_COUNT;++mode){char key[9];appearanceKey(mode,key);uint8_t data[AppearanceBytes]{},legacy[12]{};legacyAppearanceBytes(prefs,mode,legacy);
    if(prefs.getBytesLength(key)!=sizeof(data)||prefs.getBytes(key,data,sizeof(data))!=sizeof(data)||!validAppearance(data,mode))continue;
    appearanceV2[mode-1]=true;
    if(memcmp(data+12,legacy,sizeof(legacy))){rebases|=uint64_t(1)<<(mode-1);continue;}
    effectColors[mode-1]={data[2],data[3],data[4],data[5]};effectOptions[mode-1]={data[6],data[7],data[8],data[9],data[10],data[11]};appearanceV2[mode-1]=true;
  }prefs.end();
  if(!rebases)return;
  // Record the newer legacy save durably. Without this rebase, a subsequent
  // downgrade returning to the original v1 color could resurrect stale v2 data.
  Preferences migration;if(!migration.begin("coollamp",false)){appearanceMigrationPending=true;return;}
  for(uint8_t mode=1;mode<=LAMP_EFFECT_COUNT;++mode)if(rebases&(uint64_t(1)<<(mode-1))){char key[9];appearanceKey(mode,key);uint8_t record[AppearanceBytes]{},readback[AppearanceBytes]{};appearanceBytes(mode,record);legacyAppearanceBytes(migration,mode,record+12);
    const bool saved=migration.putBytes(key,record,sizeof(record))==sizeof(record);
    const bool reconciled=saved||(migration.getBytesLength(key)==sizeof(readback)&&migration.getBytes(key,readback,sizeof(readback))==sizeof(readback)&&memcmp(record,readback,sizeof(record))==0);
    if(!reconciled)appearanceMigrationPending=true;
  }migration.end();
}
LampAppearanceResult saveLampAppearanceAccepted(uint8_t mode,uint32_t now){
  if(lampSyncFollowing()||mode<1||mode>lampAvailableEffectCount())return LampAppearanceResult::Failed;
  uint8_t data[AppearanceBytes]{},old[AppearanceBytes]{};appearanceBytes(mode,data);char key[9];appearanceKey(mode,key);
  Preferences prefs;if(!prefs.begin("coollamp",false))return LampAppearanceResult::Failed;
  legacyAppearanceBytes(prefs,mode,data+12);
  const bool hadOld=prefs.getBytesLength(key)==sizeof(old)&&prefs.getBytes(key,old,sizeof(old))==sizeof(old);
  const bool same=hadOld&&memcmp(data,old,sizeof(data))==0;
  if(!same&&appearanceSaveReady&&uint32_t(now-appearanceSavedAt)<2000){prefs.end();return LampAppearanceResult::Busy;}
  bool ok=same||prefs.putBytes(key,data,sizeof(data))==sizeof(data);
  LampAppearanceResult result=ok?LampAppearanceResult::Persisted:LampAppearanceResult::Uncertain;
  if(!ok){uint8_t readback[AppearanceBytes]{};const bool read=prefs.getBytesLength(key)==sizeof(readback)&&prefs.getBytes(key,readback,sizeof(readback))==sizeof(readback);
    if(read&&memcmp(readback,data,sizeof(data))==0){ok=true;result=LampAppearanceResult::Persisted;}
    else if(read&&hadOld&&memcmp(readback,old,sizeof(old))==0)result=LampAppearanceResult::Failed;
  }prefs.end();
  if(ok){appearanceV2[mode-1]=true;if(!same){appearanceSavedAt=now;appearanceSaveReady=true;}}return result;
}
bool saveLampAppearanceV2(uint8_t mode,uint32_t now){return saveLampAppearanceAccepted(mode,now)==LampAppearanceResult::Persisted;}

LampColor defaultLampColor(uint8_t mode)
{
  if (mode >= 41) return {0,255,80,0};
  if (mode == 3) return {0, 128, 160, 255};
  if (mode == 31) return {1, 190, 215, 255};
  if (mode == 33) return {1, 255, 200, 60};
  return {static_cast<uint8_t>(mode >= LAMP_CUSTOM_SOLID), 255, 60, 110};
}

LampEffectOptions defaultEffectOptions(uint8_t mode) {
  return {50, static_cast<uint8_t>(mode == 31 ? 35 : 100), static_cast<uint8_t>(mode >= 30), 35, 160, 255};
}

void loadLampColors()
{
  for (uint8_t i = 0; i < LAMP_EFFECT_COUNT; ++i) {
    effectColors[i] = defaultLampColor(i + 1);
    effectOptions[i] = defaultEffectOptions(i + 1);
  }
  uint8_t data[1 + LAMP_BASE_EFFECT_COUNT * 4] = {};
  Preferences prefs;
  if (!prefs.begin("coollamp", true)) return;
  // Audio entries live separately: keep the original 38-entry blobs readable by older firmware.
  uint8_t audio[1 + (LAMP_EFFECT_COUNT - LAMP_BASE_EFFECT_COUNT) * 10] = {};
  const size_t audioLength = prefs.getBytesLength("audioEffectsV1");
  if ((audioLength == 21 || audioLength == 71 || audioLength == 81 || audioLength == sizeof(audio)) &&
      prefs.getBytes("audioEffectsV1", audio, audioLength) == audioLength && audio[0] == 1) {
    for (uint8_t i = LAMP_BASE_EFFECT_COUNT; i < LAMP_BASE_EFFECT_COUNT + (audioLength-1)/10; ++i) {
      const auto* p = audio + 1 + (i - LAMP_BASE_EFFECT_COUNT) * 10;
      if (p[0] <= 1) effectColors[i] = {p[0],p[1],p[2],p[3]};
      if (p[4] >= 1 && p[4] <= 100 && p[5] <= 100 && p[6] <= 1)
        effectOptions[i] = {p[4],p[5],p[6],p[7],p[8],p[9]};
    }
  }
  const size_t length = prefs.getBytesLength("colors");
  const bool valid = (length == 117 || length == 149 || length == sizeof(data)) &&
    prefs.getBytes("colors", data, length) == length && data[0] == 1;
  uint8_t options[1 + LAMP_BASE_EFFECT_COUNT * 6] = {};
  const size_t optionsLength = prefs.getBytesLength("effectOptions");
  if ((optionsLength == 223 || optionsLength == sizeof(options)) &&
      prefs.getBytes("effectOptions", options, optionsLength) == optionsLength && options[0] == 1) {
    optionsDirty = optionsLength != sizeof(options);
    for (uint8_t i = 0; i < (optionsLength - 1) / 6; ++i) {
      const auto* p = options + 1 + i * 6;
      if (p[0] >= 1 && p[0] <= 100 && p[1] <= 100 && p[2] <= 1) effectOptions[i] = {p[0],p[1],p[2],p[3],p[4],p[5]};
    }
  }
  prefs.end();
  if (!valid) return;
  const uint8_t count = (length - 1) / 4;
  for (uint8_t i = 0; i < count; ++i) if (data[1 + i * 4] > 1) return;
  for (uint8_t i = 0; i < count; ++i) {
    const uint8_t* c = data + 1 + i * 4;
    effectColors[i] = {c[0], c[1], c[2], c[3]};
  }
  effectColors[LAMP_CUSTOM_SOLID - 1].enabled = 1;
  colorsDirty = count != LAMP_BASE_EFFECT_COUNT;
}

LampColor getLampColor(uint8_t mode)
{
  if(lampSyncVisual && mode==lampSyncVisual->mode){const auto* c=lampSyncVisual->primary;return {c[0],c[1],c[2],c[3]};}
  return mode >= 1 && mode <= LAMP_EFFECT_COUNT ? effectColors[mode - 1] : LampColor{0, 0, 0, 0};
}

bool setLampColor(uint8_t mode, uint8_t r, uint8_t g, uint8_t b)
{
  if(lampSyncFollowing()) return false;
  if (mode < 1 || mode > lampAvailableEffectCount()) return false;
  const LampColor next{1, r, g, b};
  const auto old = effectColors[mode - 1];
  colorsDirty |= old.enabled != 1 || old.r != r || old.g != g || old.b != b;
  effectColors[mode - 1] = next;
  return true;
}

bool resetLampColor(uint8_t mode)
{
  if(lampSyncFollowing()) return false;
  if (mode < 1 || mode > lampAvailableEffectCount()) return false;
  const auto next = defaultLampColor(mode);
  const auto old = effectColors[mode - 1];
  colorsDirty |= old.enabled != next.enabled || old.r != next.r || old.g != next.g || old.b != next.b;
  effectColors[mode - 1] = next;
  effectOptions[mode - 1] = defaultEffectOptions(mode);
  optionsDirty = true;
  return true;
}

bool saveLampColors()
{
  if(lampSyncFollowing()) return false;
  if (!colorsDirty && !optionsDirty) return true;
  uint8_t data[1 + LAMP_BASE_EFFECT_COUNT * 4] = {1};
  for (uint8_t i = 0; i < LAMP_BASE_EFFECT_COUNT; ++i) {
    const auto c = effectColors[i];
    data[1 + i * 4] = c.enabled; data[2 + i * 4] = c.r;
    data[3 + i * 4] = c.g; data[4 + i * 4] = c.b;
  }
  Preferences prefs;
  if (!prefs.begin("coollamp", false)) return false;
  const bool saved = !colorsDirty || prefs.putBytes("colors", data, sizeof(data)) == sizeof(data);
  uint8_t options[1 + LAMP_BASE_EFFECT_COUNT * 6] = {1};
  for (uint8_t i = 0; i < LAMP_BASE_EFFECT_COUNT; ++i) {
    const auto o = effectOptions[i]; uint8_t* p = options + 1 + i * 6;
    p[0]=o.speed;p[1]=o.intensity;p[2]=o.dual;p[3]=o.r;p[4]=o.g;p[5]=o.b;
  }
  const bool savedOptions = !optionsDirty || prefs.putBytes("effectOptions", options, sizeof(options)) == sizeof(options);
  uint8_t audio[1 + (LAMP_EFFECT_COUNT - LAMP_BASE_EFFECT_COUNT) * 10] = {1};
  for (uint8_t i = LAMP_BASE_EFFECT_COUNT; i < LAMP_EFFECT_COUNT; ++i) {
    auto* p = audio + 1 + (i - LAMP_BASE_EFFECT_COUNT) * 10;
    const auto c = effectColors[i]; const auto o = effectOptions[i];
    p[0]=c.enabled;p[1]=c.r;p[2]=c.g;p[3]=c.b;
    p[4]=o.speed;p[5]=o.intensity;p[6]=o.dual;p[7]=o.r;p[8]=o.g;p[9]=o.b;
  }
  const bool savedAudio = prefs.putBytes("audioEffectsV1", audio, sizeof(audio)) == sizeof(audio);
  bool savedV2=true;
  for(uint8_t mode=1;mode<=LAMP_EFFECT_COUNT;++mode)if(appearanceV2[mode-1]){
    char key[9];appearanceKey(mode,key);uint8_t current[AppearanceBytes]{},old[AppearanceBytes]{};appearanceBytes(mode,current);legacyAppearanceBytes(prefs,mode,current+12);
    const bool same=prefs.getBytesLength(key)==sizeof(old)&&prefs.getBytes(key,old,sizeof(old))==sizeof(old)&&memcmp(old,current,sizeof(old))==0;
    if(!same)savedV2=(prefs.putBytes(key,current,sizeof(current))==sizeof(current))&&savedV2;
  }
  prefs.end();
  if (!savedAudio||!savedV2) return false;
  if (saved) colorsDirty = false;
  if (savedOptions) optionsDirty = false;
  return saved && savedOptions;
}

LampEffectOptions getLampEffectOptions(uint8_t mode) {
  if(lampSyncVisual && mode==lampSyncVisual->mode){const auto& v=*lampSyncVisual;return {v.speed,v.intensity,v.dual,v.secondary[0],v.secondary[1],v.secondary[2]};}
  return mode >= 1 && mode <= LAMP_EFFECT_COUNT ? effectOptions[mode - 1] : defaultEffectOptions(1);
}
bool setLampEffectOptions(uint8_t mode, LampEffectOptions o) {
  if(lampSyncFollowing()) return false;
  if (mode < 1 || mode > lampAvailableEffectCount() || o.speed < 1 || o.speed > 100 || o.intensity > 100 || o.dual > 1) return false;
  const auto old = effectOptions[mode - 1];
  optionsDirty |= old.speed!=o.speed || old.intensity!=o.intensity || old.dual!=o.dual || old.r!=o.r || old.g!=o.g || old.b!=o.b;
  effectOptions[mode - 1] = o; return true;
}
void getLampEffectPacket(uint8_t* out) {
  const auto mode = getLampControlState().mode; const auto o = getLampEffectOptions(mode);
  const uint8_t packet[8]={1,mode,o.speed,o.intensity,o.dual,o.r,o.g,o.b};
  memcpy(out,packet,sizeof(packet));
}
