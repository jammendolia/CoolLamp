#pragma once
#include <Arduino.h>

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
bool saveLampAudioConfiguration(bool enabled, uint8_t gain, uint16_t gate, uint16_t scale = 0);
uint16_t lampAudioScale();
bool tuneLampAudio(uint8_t gain, uint16_t gate, uint16_t scale);
bool adjustLampAudioGain(bool increase); // USB tuning; saves and applies without reboot.
void serviceLampAudio(bool wanted, bool blocked);
bool stopLampAudio(); // Bounded handshake; frees DMA before updater may allocate TLS.
void diagnoseLampAudio();
LampAudioFeatures getLampAudioFeatures();
String lampAudioJson();
