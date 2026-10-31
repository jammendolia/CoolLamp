#include "LampAudio.h"
#include "LampJsonSink.h"
#include "AudioAnalysis.h"
#include "AudioSpectrum.h"
#include "LampNvsBlob.h"
#include "LampModel.h"
#include <driver/i2s_std.h>
#include <driver/gpio.h>
#include <freertos/semphr.h>
#include <atomic>
#include <new>

namespace {
bool installed = false;
bool enabled = true, enabledStored = false, preferenceHealthy = true, saveUncertain = false, recordReadFailed = false;
bool captureWanted = false, capturedSinceStart = false, diagnosticActive = false, retryPending = false;
uint32_t captureStartedAt = 0;
uint8_t gain = 8;
uint16_t gate = 8;
uint16_t scale = 100;
i2s_chan_handle_t receiver = nullptr;
bool receiverEnabled = false;
TaskHandle_t worker = nullptr;
SemaphoreHandle_t finished = nullptr;
int16_t* samples = nullptr;
std::atomic<bool> stopping{false};
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
LampAudioFeatures features{};
uint32_t diagnosticUntil = 0, retryAt = 0;
constexpr size_t FRAMES = 256;
// C3 measurements show 3,412/4,096 bytes unused after sustained capture.
// Keep >1 KiB measured task margin; revalidate after driver/platform changes.
constexpr uint32_t CaptureStackBytes=2048;
constexpr uint32_t CaptureFreshMs = 100, CaptureStartupMs = 2000;
constexpr const char* UseKey = "audioUseV1";
constexpr const char* HardwareKey = "audioHwV1";
bool validFlag(const uint8_t* record) {
  return record[0]==1 && record[1]<=1 && record[2]==0 && record[3]==uint8_t(0x69^record[0]^record[1]^record[2]);
}
void flagRecord(uint8_t* record,bool value) {
  record[0]=1;record[1]=uint8_t(value);record[2]=0;record[3]=uint8_t(0x69^record[0]^record[1]);
}
bool matchesRecord(LampNvsBlobPreferences& prefs,const char* key,const uint8_t* record,size_t length) {
  uint8_t check[7]{};size_t actual=length;
  return length<=sizeof(check) && prefs.readBlob(key,check,actual)==ESP_OK && actual==length && memcmp(check,record,length)==0;
}
// NVS commits one blob atomically. Readback verifies success; a failed write or
// readback restores the exact prior blob/absence before claiming no change.
bool persistRecord(LampNvsBlobPreferences& prefs,const char* key,const uint8_t* record,size_t length) {
  uint8_t previous[7]{};size_t previousLength=sizeof(previous);
  const esp_err_t prior=prefs.readBlob(key,previous,previousLength);const bool existed=prior==ESP_OK;
  if(length>sizeof(previous) || (prior!=ESP_OK && prior!=ESP_ERR_NVS_NOT_FOUND) ||
      (existed && (!previousLength || previousLength>sizeof(previous)))) {recordReadFailed=true;return false;}
  if(prefs.putBytes(key,record,length)==length && matchesRecord(prefs,key,record,length))return true;
  bool restored=false;
  if(existed)restored=matchesRecord(prefs,key,previous,previousLength) ||
    (prefs.putBytes(key,previous,previousLength)==previousLength && matchesRecord(prefs,key,previous,previousLength));
  else {
    size_t probeLength=0;const esp_err_t probe=prefs.readBlob(key,nullptr,probeLength);
    if(probe==ESP_ERR_NVS_NOT_FOUND)restored=true;
    else if(probe==ESP_OK && prefs.remove(key)) {probeLength=0;restored=prefs.readBlob(key,nullptr,probeLength)==ESP_ERR_NVS_NOT_FOUND;}
    // Type mismatches/driver errors never authorize deleting an unknown record.
  }
  saveUncertain=!restored;return false;
}
bool IRAM_ATTR overflow(i2s_chan_handle_t, i2s_event_data_t*, void*) {
  portENTER_CRITICAL_ISR(&mux); ++features.overruns; portEXIT_CRITICAL_ISR(&mux);
  return false;
}
void error(int code) {
  portENTER_CRITICAL(&mux);
  features.error = code; ++features.errors; features.valid = false;
  portEXIT_CRITICAL(&mux);
}
void capture(void*) {
  AudioAnalysis analysis;
  AudioNoiseFloor noiseFloor;
  AudioPeakHold peakHold;
  AudioSpectrum spectrum;
  // Count captured frames, not wall time: queued DMA data may predate a stall.
  size_t warmup = 4800;
  unsigned failures = 0;
  while (!stopping.load()) {
    size_t bytes = 0;
    const esp_err_t result = i2s_channel_read(receiver, samples, FRAMES * sizeof(*samples), &bytes, 40);
    if (stopping.load()) break;
    if (result != ESP_OK || !bytes || bytes>FRAMES*sizeof(*samples) || bytes % sizeof(*samples)) {
      error(result == ESP_OK ? ESP_FAIL : result);
      if (++failures >= 5) break;
      continue;
    }
    failures = 0;
    const size_t count = bytes / sizeof(*samples);
    const auto level = analysis.process<1>(samples, count, gain, noiseFloor.cutoff(gate), scale);
    if (warmup) { warmup = count >= warmup ? 0 : warmup - count; continue; }
    const bool wasCalibrated=noiseFloor.calibrated();
    noiseFloor.observe(level.rms,count);
    if(!wasCalibrated) {
      // DC has settled, but no audio is exposed until room noise is measured.
      // Reset gain/hold once so calibration sound cannot bias the first display.
      if(noiseFloor.calibrated()){analysis.resetGain();peakHold=AudioPeakHold{};}
      continue;
    }
    const uint32_t capturedAt = millis();
    const auto bands = spectrum.process<1>(samples,count,level.level,capturedAt);
    const uint8_t heldLevel = peakHold.process(level.level, capturedAt);
    const uint32_t stackFree = uxTaskGetStackHighWaterMark(nullptr);
    portENTER_CRITICAL(&mux);
    ++features.sequence; features.timestamp = capturedAt;
    features.bass=bands.bass; features.mid=bands.mid; features.treble=bands.treble;
    features.beat=bands.beat; features.bassBeat=bands.bassBeat;
    features.noiseFloor=noiseFloor.rms();features.effectiveGate=noiseFloor.cutoff(gate);
    features.effectiveGain = analysis.effectiveGainHundredths(gain);
    features.rms = level.rms; features.peak = level.peak; features.level = heldLevel;
    features.signalSeen |= level.signal; features.valid = true; features.error = 0; capturedSinceStart = true;
    features.stackFree = stackFree;
    portEXIT_CRITICAL(&mux);
  }
  // Main task owns teardown. Signal only after the last driver/buffer access.
  xSemaphoreGive(finished);
  vTaskSuspend(nullptr);
}
void releaseReceiver() {
  if (receiver) {
    if (receiverEnabled) i2s_channel_disable(receiver);
    i2s_del_channel(receiver); receiver = nullptr; receiverEnabled = false;
  }
  delete[] samples; samples = nullptr;
  // Leave the added pins quiet; never touch existing GPIO0–4.
  gpio_reset_pin(gpio_num_t(LAMP_AUDIO_SCK));
  gpio_reset_pin(gpio_num_t(LAMP_AUDIO_WS));
  gpio_reset_pin(gpio_num_t(LAMP_AUDIO_SD));
  portENTER_CRITICAL(&mux);
  features.running = false; features.valid = false; features.level = 0;
  portEXIT_CRITICAL(&mux);
}
bool start() {
  if (!finished) finished = xSemaphoreCreateBinary();
  samples = new (std::nothrow) int16_t[FRAMES];
  if (!finished || !samples) { error(ESP_ERR_NO_MEM); releaseReceiver(); return false; }
  xSemaphoreTake(finished, 0);
  i2s_chan_config_t channel = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  channel.dma_desc_num = 4; channel.dma_frame_num = FRAMES;
  esp_err_t result = i2s_new_channel(&channel, nullptr, &receiver);
  if (result == ESP_OK) {
    i2s_std_config_t config{};
    config.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(16000);
    config.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO);
    // Analysis already used only each LEFT word's upper 16 bits. Capture those
    // same values directly; retain 32-bit Philips wire slots and 64 BCLK/frame.
    // HW v2's mono macro defaults to BOTH, so explicitly select LEFT.
    config.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
    config.slot_cfg.slot_bit_width = I2S_SLOT_BIT_WIDTH_32BIT;
    config.slot_cfg.ws_width = 32;
    config.slot_cfg.bit_shift = true;
    config.slot_cfg.left_align = true;
    config.slot_cfg.big_endian = false;
    config.slot_cfg.bit_order_lsb = false;
    config.gpio_cfg.mclk = I2S_GPIO_UNUSED;
    config.gpio_cfg.bclk = gpio_num_t(LAMP_AUDIO_SCK);
    config.gpio_cfg.ws = gpio_num_t(LAMP_AUDIO_WS);
    config.gpio_cfg.dout = I2S_GPIO_UNUSED;
    config.gpio_cfg.din = gpio_num_t(LAMP_AUDIO_SD);
    result = i2s_channel_init_std_mode(receiver, &config);
  }
  if (result == ESP_OK) {
    i2s_event_callbacks_t callbacks{};
    callbacks.on_recv_q_ovf = overflow;
    result = i2s_channel_register_event_callback(receiver, &callbacks, nullptr);
  }
  if (result == ESP_OK) {
    // Bias an unplugged/tristated input; this is not proof of microphone presence.
    gpio_set_pull_mode(gpio_num_t(LAMP_AUDIO_SD), GPIO_PULLDOWN_ONLY);
    result = i2s_channel_enable(receiver);
    receiverEnabled = result == ESP_OK;
  }
  if (result != ESP_OK) { error(result); releaseReceiver(); return false; }
  stopping = false;
  portENTER_CRITICAL(&mux);
  features.running = true; features.valid = false; features.signalSeen = false; features.error = 0;
  capturedSinceStart = false;captureStartedAt=millis();
  portEXIT_CRITICAL(&mux);
  if (xTaskCreate(capture, "lamp-audio", CaptureStackBytes, nullptr, 1, &worker) != pdPASS) {
    worker = nullptr; error(ESP_ERR_NO_MEM); releaseReceiver(); return false;
  }
  return true;
}
}

void beginLampAudio() {
  LampNvsBlobPreferences prefs;
  uint8_t data[7]{};
  // Boot-only writable open can create a genuinely missing namespace. Verify
  // both legacy keys after it succeeds; any open/read failure stays closed.
  if (!prefs.begin("coollamp", true) && !prefs.begin("coollamp", false)) {enabled=false;preferenceHealthy=false;return;}
  size_t lengthV1=0,lengthV2=0;
  const esp_err_t foundV1=prefs.readBlob("audioV1",nullptr,lengthV1),foundV2=prefs.readBlob("audioV2",nullptr,lengthV2);
  if((foundV1!=ESP_OK && foundV1!=ESP_ERR_NVS_NOT_FOUND) || (foundV2!=ESP_OK && foundV2!=ESP_ERR_NVS_NOT_FOUND)) {enabled=false;preferenceHealthy=false;prefs.end();return;}
  const bool legacyAbsent=foundV1==ESP_ERR_NVS_NOT_FOUND && foundV2==ESP_ERR_NVS_NOT_FOUND;
  const bool v2 = foundV2==ESP_OK && lengthV2==sizeof(data);
  const char* key = v2 ? "audioV2" : "audioV1";
  const size_t size = v2 ? 7 : 5;
  size_t actual=size;const bool ok=(v2?lengthV2:lengthV1)==size && prefs.readBlob(key,data,actual)==ESP_OK && actual==size;
  uint8_t use[4]{};actual=sizeof(use);const esp_err_t foundUse=prefs.readBlob(UseKey,use,actual);
  if(foundUse!=ESP_ERR_NVS_NOT_FOUND) {
    const bool valid=foundUse==ESP_OK && actual==sizeof(use) && validFlag(use);
    enabled=valid && use[1];enabledStored=valid;preferenceHealthy=valid;
  }
  prefs.end();
  const uint16_t storedGate = uint16_t(data[3]) | uint16_t(data[4]) << 8;
  const uint16_t storedScale = v2 ? uint16_t(data[5]) | uint16_t(data[6]) << 8 : 100;
  if (ok && data[0] == (v2 ? 2 : 1) && storedScale >= 100 && storedScale <= 400 && data[1] <= 1 && data[2] >= 1 && data[2] <= 64 && storedGate <= 1024) {
    installed = data[1]; gain = data[2]; gate = storedGate; scale = storedScale;
  }
  // Only a verified absence of BOTH old records permits factory defaults.
  // Existing malformed records are preserved, never replaced by heuristics.
  if(legacyAbsent) {
    LampNvsBlobPreferences factory;uint8_t hardware[4]{};
    if(factory.begin("lampmodel",true)) {
      actual=sizeof(hardware);const esp_err_t foundHardware=factory.readBlob(HardwareKey,hardware,actual);
      if(foundHardware==ESP_OK && actual==sizeof(hardware) && validFlag(hardware))installed=hardware[1];
      else if(foundHardware==ESP_ERR_NVS_NOT_FOUND)installed=LampModel::defaultMicrophoneInstalled();
      factory.end();
    }
  }
}
bool lampHasMicrophone() { return installed; }
bool lampMicrophoneEnabled() { return enabled && preferenceHealthy; }
bool lampMicrophoneEnabledKnown() { return preferenceHealthy; }
bool lampAudioSaveUncertain() { return saveUncertain; }
bool provisionLampMicrophoneHardware(bool nextInstalled) {
  saveUncertain=false;recordReadFailed=false;if(worker || receiver)return false;uint8_t hardware[4]{};flagRecord(hardware,nextInstalled);
  LampNvsBlobPreferences prefs;if(!prefs.begin("lampmodel",false))return false;
  uint8_t previous[4]{};size_t actual=sizeof(previous);const esp_err_t found=prefs.readBlob(HardwareKey,previous,actual);
  if(found!=ESP_ERR_NVS_NOT_FOUND) {
    const bool same=found==ESP_OK && actual==sizeof(previous) && validFlag(previous) && memcmp(previous,hardware,sizeof(hardware))==0;
    prefs.end();return same; // No overwriting corrupt, unreadable or conflicting factory identity.
  }
  const bool ok=persistRecord(prefs,HardwareKey,hardware,sizeof(hardware));prefs.end();return ok;
}
bool saveLampMicrophoneEnabled(bool nextEnabled) {
  saveUncertain=false;recordReadFailed=false;
  if(enabledStored && preferenceHealthy && nextEnabled==enabled)return true;
  if(!stopLampAudio())return false;
  uint8_t data[4]{};flagRecord(data,nextEnabled);
  LampNvsBlobPreferences prefs;if(!prefs.begin("coollamp",false)) {enabled=false;preferenceHealthy=false;return false;}
  uint8_t previous[4]{};size_t actual=sizeof(previous);const esp_err_t found=prefs.readBlob(UseKey,previous,actual);
  if(found!=ESP_ERR_NVS_NOT_FOUND && (found!=ESP_OK || actual!=sizeof(previous) || previous[0]!=1)) {enabled=false;preferenceHealthy=false;prefs.end();return false;}
  const bool ok=persistRecord(prefs,UseKey,data,sizeof(data));prefs.end();
  if(!ok) {if(saveUncertain||recordReadFailed){enabled=false;preferenceHealthy=false;}return false;}
  enabled=nextEnabled;enabledStored=true;preferenceHealthy=true;
  if(!enabled){diagnosticActive=false;diagnosticUntil=0;captureWanted=false;}
  return true;
}
uint16_t lampAudioScale() { return scale; }
bool saveLampMicrophoneInstalled(bool enabled){return saveLampAudioConfiguration(enabled,gain,gate,scale);}
bool saveLampAudioConfiguration(bool enabled, uint8_t nextGain, uint16_t nextGate, uint16_t nextScale) {
  saveUncertain=false;recordReadFailed=false;
  if (!nextScale) nextScale = scale;
  if (!nextGain || nextGain > 64 || nextGate > 1024 || nextScale < 100 || nextScale > 400) return false;
  if(!stopLampAudio())return false;
  const uint8_t data[7] = {2, uint8_t(enabled), nextGain, uint8_t(nextGate), uint8_t(nextGate >> 8), uint8_t(nextScale), uint8_t(nextScale >> 8)};
  LampNvsBlobPreferences prefs;
  if (!prefs.begin("coollamp", false)) return false;
  const bool ok = persistRecord(prefs,"audioV2",data,sizeof(data)); prefs.end();
  // Apply at reboot so catalogs and BLE capability negotiation stay consistent.
  return ok;
}
bool stopLampAudio() {
  if (!worker) return true;
  stopping = true;
  if (xSemaphoreTake(finished, pdMS_TO_TICKS(250)) != pdTRUE) return false;
  vTaskDelete(worker); worker = nullptr;
  releaseReceiver(); return true;
}
bool tuneLampAudio(uint8_t nextGain, uint16_t nextGate, uint16_t nextScale) {
  if (!installed || nextGain<1 || nextGain>64 || nextGate>1024 || nextScale<100 || nextScale>400) return false;
  if (nextGain==gain && nextGate==gate && nextScale==scale) return true;
  // Worker reads configuration without a lock: stop before applying new values.
  if (!stopLampAudio() || !saveLampAudioConfiguration(installed,nextGain,nextGate,nextScale)) return false;
  gain=nextGain;gate=nextGate;scale=nextScale;
  return true;
}
bool adjustLampAudioGain(bool increase) {
  const uint8_t next = increase ? (gain >= 32 ? 64 : gain * 2) : (gain <= 2 ? 1 : gain / 2);
  if (next == gain) return true;
  // Stop the worker before changing its configuration; service resumes capture.
  if (!stopLampAudio() || !saveLampAudioConfiguration(installed, next, gate)) return false;
  gain = next;
  return true;
}
void serviceLampAudio(bool wanted, bool blocked) {
  const uint32_t now = millis();
  const bool diagnostic = diagnosticActive && int32_t(diagnosticUntil - now) > 0;
  if(diagnosticActive && !diagnostic)diagnosticActive=false;
  captureWanted=installed && lampMicrophoneEnabled() && !blocked && (wanted || diagnostic);
  if (!captureWanted) { stopLampAudio(); return; }
  if (worker && uxSemaphoreGetCount(finished)) {
    stopLampAudio(); retryAt = now + 5000;retryPending=true;
  }
  if (!worker && (!retryPending || int32_t(now - retryAt) >= 0)) {
    // Deadline zero is valid at rollover, not an invitation to retry early.
    retryPending=!start();retryAt=retryPending?now+5000:0;
  }
}
void diagnoseLampAudio() { if(installed && lampMicrophoneEnabled()){diagnosticActive=true;diagnosticUntil = millis() + 10000;} }
LampAudioCaptureStatus lampAudioCaptureStatus() {
  if(!installed || !enabled || !captureWanted)return preferenceHealthy?LampAudioCaptureStatus::Idle:LampAudioCaptureStatus::Error;
  if(!preferenceHealthy)return LampAudioCaptureStatus::Error;
  portENTER_CRITICAL(&mux);const auto copy=features;const bool sampled=capturedSinceStart;const uint32_t started=captureStartedAt;portEXIT_CRITICAL(&mux);
  if(copy.error)return LampAudioCaptureStatus::Error;
  if(!copy.running || stopping.load())return LampAudioCaptureStatus::Idle;
  const uint32_t now=millis();
  if(!sampled)return uint32_t(now-started)<=CaptureStartupMs?LampAudioCaptureStatus::Starting:LampAudioCaptureStatus::Stale;
  return copy.valid && uint32_t(now-copy.timestamp)<=CaptureFreshMs?LampAudioCaptureStatus::Healthy:LampAudioCaptureStatus::Stale;
}
LampAudioFeatures getLampAudioFeatures() {
  portENTER_CRITICAL(&mux); auto copy = features; portEXIT_CRITICAL(&mux);
  if (!copy.running || uint32_t(millis() - copy.timestamp) > CaptureFreshMs) { copy.valid = false; copy.level = 0; }
  return copy;
}
LampAudioJsonSnapshot captureLampAudioJson() {
  return {getLampAudioFeatures(),installed,gain,gate,scale,ESP.getFreeHeap(),lampRenderedFrames,lampMaxRenderUs,lampMicrophoneEnabled(),uint8_t(lampAudioCaptureStatus()),lampMicrophoneEnabledKnown()};
}
void appendLampAudioJson(LampJsonSink& out,const LampAudioJsonSnapshot& snapshot) {
  const auto& f=snapshot.features;
  const auto add=[&](const auto& value){out.concat(value);};
  add("{\"installed\":");
  add((snapshot.installed?"true":"false"));add(",\"liveTuning\":true,\"automaticGain\":true,\"gain\":");add(snapshot.gain);
  add(",\"captureVersion\":1,\"enabled\":");add(snapshot.enabledKnown?(snapshot.enabled?"true":"false"):"null");add(",\"captureStatus\":");add(snapshot.captureStatus);
  add(",\"gate\":");add(snapshot.gate);add(",\"scale\":");add(snapshot.scale);
  add(",\"running\":");add((f.running?"true":"false"));add(",\"valid\":");add((f.valid?"true":"false"));
  add(",\"signalSeen\":");add((f.signalSeen?"true":"false"));add(",\"level\":");add(f.level);
  add(",\"noiseFloor\":");add(f.noiseFloor);add(",\"effectiveGate\":");add(f.effectiveGate);add(",\"effectiveGain\":");add(f.effectiveGain);
  add(",\"rms\":");add(f.rms);add(",\"peak\":");add(f.peak);add(",\"blocks\":");add(f.sequence);
  add(",\"errors\":");add(f.errors);add(",\"overruns\":");add(f.overruns);add(",\"stackFree\":");add(f.stackFree);
  add(",\"bass\":");add(f.bass);add(",\"mid\":");add(f.mid);add(",\"treble\":");add(f.treble);
  add(",\"beat\":");add(f.beat);add(",\"bassBeat\":");add(f.bassBeat);
  add(",\"heap\":");add(snapshot.heap);add(",\"frames\":");add(snapshot.frames);
  add(",\"maxRenderUs\":");add(snapshot.maxRender);add(",\"error\":");add(f.error);add('}');
}
String lampAudioJson() {
  const auto snapshot=captureLampAudioJson();
  return lampJsonReply([&](LampJsonSink& out){appendLampAudioJson(out,snapshot);});
}
