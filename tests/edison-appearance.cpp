#include <cassert>
#include <cstring>
#include <iostream>
#include <map>
#include <string>
#include <vector>
#include <Preferences.h>
#include "../LampControl.h"
#include "../LampSync.h"

bool edison=true,microphone=true,following=false;
uint8_t lampAvailableEffectCount(){return edison?52:microphone?47:38;}
bool lampEffectAvailable(uint8_t mode){return mode>=1&&mode<=52&&(mode<=38||(mode<=47&&microphone)||(mode>=48&&edison&&(mode!=52||microphone)));}
bool lampSyncFollowing(){return following;}
const LampSyncWire::Visual* lampSyncVisual=nullptr;
LampControlState control{48,100,true};
LampControlState getLampControlState(){return control;}
#include "../LampColors.ino"

bool colorIs(uint8_t mode,LampColor expected){const auto c=getLampColor(mode);return !std::memcmp(&c,&expected,sizeof(c));}
bool optionsAre(uint8_t mode,LampEffectOptions expected){const auto o=getLampEffectOptions(mode);return !std::memcmp(&o,&expected,sizeof(o));}
void reload(){loadLampColors();loadLampAppearanceV2();}

int main(){
  static_assert(LAMP_EFFECT_COUNT==47&&LAMP_BASE_EFFECT_COUNT==38&&LAMP_EFFECT_CAPACITY==52);
  // Opaque existing startup/hardware/ownership bytes may never be rewritten.
  Preferences::storage["settings"]={1,17,33,55,89,144};
  Preferences::storage["geometryV1"]={1,81,0};
  Preferences::storage["factoryV2"]={2,12,34,56};
  const auto startup=Preferences::storage["settings"],geometry=Preferences::storage["geometryV1"],factory=Preferences::storage["factoryV2"];
  reload();
  for(uint8_t mode=48;mode<=52;++mode){assert(colorIs(mode,{1,255,150,35}));assert(optionsAre(mode,{50,100,1,255,65,8}));}
  assert(colorIs(41,{0,255,80,0})&&optionsAre(31,{50,35,1,35,160,255}));

  // Construct legacy payloads through production setters/save code, then prove
  // appended edits neither resize nor rewrite any old-format byte.
  assert(setLampColor(38,1,2,3)&&setLampEffectOptions(47,{73,64,0,11,22,33}));
  assert(saveLampColors());
  const auto legacyColors=Preferences::storage["colors"],legacyOptions=Preferences::storage["effectOptions"],legacyAudio=Preferences::storage["audioEffectsV1"];
  assert(legacyColors.size()==153&&legacyOptions.size()==229&&legacyAudio.size()==91);
  const auto colorsWrites=Preferences::keyWrites["colors"],optionWrites=Preferences::keyWrites["effectOptions"],audioWrites=Preferences::keyWrites["audioEffectsV1"];
  assert(setLampColor(48,10,20,30)&&setLampEffectOptions(48,{17,61,1,40,50,60}));
  assert(!Preferences::storage.count("look48")&&saveLampColors());
  const auto record48=Preferences::storage["look48"];
  assert(record48.size()==24&&record48[0]==2&&record48[1]==48);
  assert(Preferences::storage["colors"]==legacyColors&&Preferences::storage["effectOptions"]==legacyOptions&&Preferences::storage["audioEffectsV1"]==legacyAudio);
  assert(Preferences::keyWrites["colors"]==colorsWrites&&Preferences::keyWrites["effectOptions"]==optionWrites&&Preferences::keyWrites["audioEffectsV1"]==audioWrites);
  reload();assert(colorIs(48,{1,10,20,30})&&optionsAre(48,{17,61,1,40,50,60}));

  // A first save failure must retain its dirty admission for a later explicit
  // save, even though no v2 record has ever existed for this effect.
  assert(setLampEffectOptions(49,{99,50,0,70,80,90}));
  Preferences::failKey="look49";assert(!saveLampColors()&&!Preferences::storage.count("look49"));
  Preferences::failKey.clear();assert(saveLampColors());
  reload();assert(optionsAre(49,{99,50,0,70,80,90}));
  assert(setLampColor(50,51,52,53));
  Preferences::failOpen=true;assert(!saveLampColors());Preferences::failOpen=false;
  assert(saveLampColors());reload();assert(colorIs(50,{1,51,52,53}));

  // Reboot after a failed attempted save retains the prior durable value.
  assert(setLampColor(48,77,88,99));Preferences::failKey="look48";
  assert(!saveLampColors());Preferences::failKey.clear();reload();
  assert(colorIs(48,{1,10,20,30}));
  // Commit with a lost success reply remains an honest failed/unconfirmed
  // legacy save outcome; fresh load reconciles the actually written record.
  assert(setLampColor(50,90,91,92));Preferences::commitThenFail=true;
  assert(!saveLampColors());Preferences::commitThenFail=false;reload();
  assert(colorIs(50,{1,90,91,92}));

  assert(setLampColor(51,7,8,9)&&setLampEffectOptions(51,{33,44,0,55,66,77}));
  assert(saveLampAppearanceAccepted(51,100)==LampAppearanceResult::Persisted);
  assert(Preferences::storage["look51"].size()==24);
  assert(setLampColor(51,8,9,10));Preferences::failKey="look51";
  assert(saveLampAppearanceAccepted(51,2100)==LampAppearanceResult::Failed);
  Preferences::failKey.clear();reload();assert(colorIs(51,{1,7,8,9}));
  assert(setLampColor(52,120,121,122));Preferences::failKey="look52";
  assert(saveLampAppearanceAccepted(52,4100)==LampAppearanceResult::Uncertain);
  Preferences::failKey.clear();reload();assert(colorIs(52,{1,255,150,35}));
  assert(setLampColor(52,120,121,122));Preferences::commitThenFail=true;
  assert(saveLampAppearanceAccepted(52,6100)==LampAppearanceResult::Persisted);
  Preferences::commitThenFail=false;reload();assert(colorIs(52,{1,120,121,122}));

  // No old software can supersede an appended lookNN through a legacy slot.
  // Legacy blob edits and a different default-baseline half leave it intact.
  Preferences::storage["audioEffectsV1"][1]=0;
  Preferences::storage["look48"][15]^=0x55;
  reload();assert(colorIs(48,{1,10,20,30})&&!lampAppearanceMigrationPending());
  const auto writes=Preferences::writes;reload();assert(Preferences::writes==writes);
  auto invalid=Preferences::storage["look48"];invalid[7]=101;
  Preferences::storage["look48"]=invalid;reload();assert(colorIs(48,{1,255,150,35}));
  Preferences::storage["look48"]=record48;reload();

  assert(resetLampColor(48)&&saveLampColors());reload();
  assert(colorIs(48,{1,255,150,35})&&optionsAre(48,{50,100,1,255,65,8}));
  assert(!setLampColor(0,1,2,3)&&!setLampColor(53,1,2,3));
  assert(!setLampEffectOptions(53,{50,100,1,1,2,3})&&!resetLampColor(53));
  assert(!setLampEffectOptions(48,{0,100,1,1,2,3})&&!setLampEffectOptions(48,{50,101,1,1,2,3}));
  microphone=false;assert(!setLampColor(52,1,2,3)&&!resetLampColor(52));
  assert(saveLampAppearanceAccepted(52,8100)==LampAppearanceResult::Failed);
  edison=false;assert(!setLampColor(48,1,2,3)&&!setLampEffectOptions(49,{50,100,1,1,2,3}));
  assert(saveLampAppearanceAccepted(48,8100)==LampAppearanceResult::Failed);
  edison=microphone=true;following=true;
  assert(!setLampColor(48,1,2,3)&&!resetLampColor(48)&&!saveLampColors());
  assert(saveLampAppearanceAccepted(48,8100)==LampAppearanceResult::Failed);
  following=false;
  assert(Preferences::storage["settings"]==startup&&Preferences::storage["geometryV1"]==geometry&&Preferences::storage["factoryV2"]==factory);
  std::cout<<"PASS Edison look48..52 roundtrip, first-save failure/retry/reboot, commit/reply-loss reconciliation, capability admission, legacy blob bytes and startup/hardware independence.\n";
}
