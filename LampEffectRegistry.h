#pragma once
#include <stdint.h>

// Stable local IDs are also persisted settings and protocol identities. Keep
// this dense legacy order even when an effect is temporarily unavailable.
#define LAMP_EFFECT_REGISTRY(X) \
  X(1, "Pacifica", "pacifica", Legacy, General) \
  X(2, "Aurora", "aurora", Atmosphere, General) \
  X(3, "Rain", "rain", Atmosphere, General) \
  X(4, "Fire", "fire", Legacy, General) \
  X(5, "Split fire - rising", "split-fire-rising", SplitFire, General) \
  X(6, "Split fire - falling", "split-fire-falling", SplitFire, General) \
  X(7, "Split fire - rising, reversed colors", "split-fire-rising-reversed-colors", SplitFire, General) \
  X(8, "Blue gas fire", "blue-gas-fire", SplitFire, General) \
  X(9, "Witch fire", "witch-fire", SplitFire, General) \
  X(10, "Purple fire", "purple-fire", SplitFire, General) \
  X(11, "Embers", "embers", Atmosphere, General) \
  X(12, "Lava", "lava", Atmosphere, General) \
  X(13, "Plasma", "plasma", Atmosphere, General) \
  X(14, "Rainbow", "rainbow", Legacy, General) \
  X(15, "Rainbow with glitter", "rainbow-glitter", Legacy, General) \
  X(16, "Confetti", "confetti", Legacy, General) \
  X(17, "Comet collision", "comet-collision", Atmosphere, General) \
  X(18, "Sinelon", "sinelon", Legacy, General) \
  X(19, "BPM", "bpm", Legacy, General) \
  X(20, "Juggle", "juggle", Legacy, General) \
  X(21, "White", "white", Solid, General) \
  X(22, "Red", "red", Solid, General) \
  X(23, "Green", "green", Solid, General) \
  X(24, "Blue", "blue", Solid, General) \
  X(25, "Purple", "purple", Solid, General) \
  X(26, "Pink", "pink", Solid, General) \
  X(27, "Yellow", "yellow", Solid, General) \
  X(28, "Cyan", "cyan", Solid, General) \
  X(29, "Custom solid", "custom-solid", Solid, General) \
  X(30, "Bouncing droplets - rising", "droplets-rising", Spatial, General) \
  X(31, "Lightning storm", "lightning-storm", Spatial, General) \
  X(32, "Color tide", "color-tide", Spatial, General) \
  X(33, "Fireflies", "fireflies", Spatial, General) \
  X(34, "Heartbeat", "heartbeat", Spatial, General) \
  X(35, "Shooting stars", "shooting-stars", Spatial, General) \
  X(36, "Breathing glow", "breathing-glow", Spatial, General) \
  X(37, "Lava blobs", "lava-blobs", Spatial, General) \
  X(38, "Bouncing droplets - falling", "droplets-falling", Spatial, General) \
  X(39, "Sound glow", "sound-glow", Audio, Audio) \
  X(40, "Sound meter", "sound-meter", Audio, Audio) \
  X(41, "Spectrum Rise", "spectrum-rise", Audio, Audio) \
  X(42, "Bass Launch", "bass-launch", Audio, Audio) \
  X(43, "Spectral Embers", "spectral-embers", Audio, Audio) \
  X(44, "Beat Bloom", "beat-bloom", Audio, Audio) \
  X(45, "Three-band Fountain", "three-band-fountain", Audio, Audio) \
  X(46, "VU Meter", "vu-meter", Audio, Audio) \
  X(47, "Rainbow Embers", "rainbow-embers", Audio, Audio) \
  X(48, "Filament", "edison-filament", Edison, Edison) \
  X(49, "Eureka", "edison-eureka", Edison, Edison) \
  X(50, "Orbit", "edison-orbit", Edison, Edison) \
  X(51, "Induction", "edison-induction", Edison, Edison) \
  X(52, "Sound Filament", "edison-sound-filament", Edison, EdisonAudio) \
  X(53, "Aria", "sonata-aria", Sonata, Sonata) \
  X(54, "Duet", "sonata-duet", Sonata, Sonata) \
  X(55, "Cadenza", "sonata-cadenza", Sonata, Sonata)

namespace LampEffects {
constexpr uint8_t BaseCount=38,LegacyCount=47,Count=55;
enum class Family:uint8_t {Unknown,Legacy,Atmosphere,SplitFire,Solid,Spatial,Audio,Edison,Sonata};
enum class Requirement:uint8_t {General,Audio,Edison,EdisonAudio,Sonata};
struct Entry {const char* name;const char* key;};
// Separate packed traits avoid per-entry pointer alignment padding. The name
// and key pointers replace the former independent catalog/schema tables.
inline constexpr Entry entries[]={
#define LAMP_EFFECT_ENTRY(id,name,key,family,requirement) {name,key},
  LAMP_EFFECT_REGISTRY(LAMP_EFFECT_ENTRY)
#undef LAMP_EFFECT_ENTRY
};
inline constexpr uint8_t traits[]={
#define LAMP_EFFECT_TRAIT(id,name,key,family,requirement) uint8_t(uint8_t(Family::family)|(uint8_t(Requirement::requirement)<<4)),
  LAMP_EFFECT_REGISTRY(LAMP_EFFECT_TRAIT)
#undef LAMP_EFFECT_TRAIT
};
constexpr bool denseIds(){
  constexpr uint8_t ids[]={
#define LAMP_EFFECT_ID(id,name,key,family,requirement) id,
    LAMP_EFFECT_REGISTRY(LAMP_EFFECT_ID)
#undef LAMP_EFFECT_ID
  };
  for(uint8_t i=0;i<Count;++i)if(ids[i]!=i+1)return false;
  return sizeof(ids)==Count;
}
static_assert(sizeof(entries)/sizeof(entries[0])==Count&&sizeof(traits)==Count&&denseIds(),"Keep stable local effect IDs dense and complete");
inline constexpr const Entry* find(uint8_t id){return id>=1&&id<=Count?&entries[id-1]:nullptr;}
inline constexpr const char* name(uint8_t id){const auto* entry=find(id);return entry?entry->name:"unknown";}
inline constexpr const char* key(uint8_t id){const auto* entry=find(id);return entry?entry->key:"unknown";}
inline constexpr Family family(uint8_t id){return find(id)?Family(traits[id-1]&15):Family::Unknown;}
inline constexpr Requirement requirement(uint8_t id){return find(id)?Requirement(traits[id-1]>>4):Requirement::General;}
inline constexpr bool needsAudio(uint8_t id){return find(id)&&(requirement(id)==Requirement::Audio||requirement(id)==Requirement::EdisonAudio);}
inline constexpr bool needsEdison(uint8_t id){return find(id)&&(requirement(id)==Requirement::Edison||requirement(id)==Requirement::EdisonAudio);}
inline constexpr bool needsSonata(uint8_t id){return find(id)&&requirement(id)==Requirement::Sonata;}
struct Availability {bool microphone,following,edison;uint8_t role;bool captureEnabled;bool sonata=false;};
inline constexpr uint8_t catalogCount(const Availability& context){
  return context.sonata&&context.role==0?Count:context.edison&&context.role==0?(context.microphone?52:51):
    context.microphone||context.following?LegacyCount:BaseCount;
}
inline constexpr bool available(uint8_t id,const Availability& context){
  if(!find(id))return false;
  switch(requirement(id)){
    case Requirement::General:return true;
    // Followers render remote audio even without a local microphone.
    case Requirement::Audio:return context.microphone||context.following;
    // Region effects remain standalone; legacy Mirror cannot negotiate them.
    case Requirement::Edison:return context.edison&&context.role==0;
    case Requirement::EdisonAudio:return context.edison&&context.role==0&&context.microphone&&context.captureEnabled;
    case Requirement::Sonata:return context.sonata&&context.role==0;
  }
  return false;
}
}
#undef LAMP_EFFECT_REGISTRY
