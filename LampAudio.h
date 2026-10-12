#pragma once
#include <Arduino.h>
class LampJsonSink;

constexpr uint8_t LAMP_AUDIO_SCK = 5, LAMP_AUDIO_WS = 6, LAMP_AUDIO_SD = 7;
extern uint32_t lampRenderedFrames, lampMaxRenderUs;
struct LampAudioFeatures {
  uint32_t sequence, timestamp, errors, overruns, stackFree;
  uint16_t rms, peak, effectiveGain, noiseFloor, effectiveGate;
  uint16_t bass, mid, treble;
  uint32_t beat, bassBeat;
  uint8_t level;
  bool valid, signalSeen, running;
  int error;
};
// All lifecycle/settings calls run on the Arduino loop task. Worker publishes snapshots only.
void beginLampAudio();
bool lampHasMicrophone();
// Owner capture preference is separate from installed hardware/catalog support.
// Missing legacy preference defaults on; malformed preference fails closed.
bool lampMicrophoneEnabled();
bool lampMicrophoneEnabledKnown(); // False after unreadable/corrupt or uncertain storage.
bool saveLampMicrophoneEnabled(bool enabled);
bool lampAudioSaveUncertain(); // Failed persistence whose restoration was not verified.
// Service/manufacturing only: immutable default, retained through user reset.
// Never infer installation from an absent owner/network/bond or silent samples.
bool provisionLampMicrophoneHardware(bool installed);
enum class LampAudioCaptureStatus:uint8_t {Idle=0,Starting=1,Healthy=2,Stale=3,Error=4};
LampAudioCaptureStatus lampAudioCaptureStatus(); // Snapshot-only; never starts a test.
bool saveLampAudioConfiguration(bool enabled, uint8_t gain, uint16_t gate, uint16_t scale = 0);
bool saveLampMicrophoneInstalled(bool enabled); // Preserve existing tuning; applies at reboot.
uint16_t lampAudioScale();
bool tuneLampAudio(uint8_t gain, uint16_t gate, uint16_t scale);
bool adjustLampAudioGain(bool increase); // USB tuning; saves and applies without reboot.
void serviceLampAudio(bool wanted, bool blocked);
bool stopLampAudio(); // Bounded handshake; frees DMA before updater may allocate TLS.
void diagnoseLampAudio();
LampAudioFeatures getLampAudioFeatures();
LampAudioFeatures getLampRenderAudio();
String lampAudioJson();
struct LampAudioJsonSnapshot {
  LampAudioFeatures features{};bool installed=false;uint8_t gain=0;uint16_t gate=0,scale=0;
  uint32_t heap=0,frames=0,maxRender=0;
  bool enabled=false;uint8_t captureStatus=0;bool enabledKnown=false;
};
LampAudioJsonSnapshot captureLampAudioJson();
void appendLampAudioJson(LampJsonSink& out,const LampAudioJsonSnapshot& snapshot);
