#include "LampAudio.h"
#include "AudioAnalysis.h"
#include "AudioSpectrum.h"
#include <Preferences.h>
#include <driver/i2s_std.h>
#include <driver/gpio.h>
#include <freertos/semphr.h>
#include <atomic>
#include <new>

namespace {
bool installed = false;
uint8_t gain = 8;
uint16_t gate = 8;
uint16_t scale = 100;
i2s_chan_handle_t receiver = nullptr;
bool receiverEnabled = false;
TaskHandle_t worker = nullptr;
SemaphoreHandle_t finished = nullptr;
int32_t* samples = nullptr;
std::atomic<bool> stopping{false};
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
LampAudioFeatures features{};
uint32_t diagnosticUntil = 0, retryAt = 0;
constexpr size_t FRAMES = 256;
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
    const esp_err_t result = i2s_channel_read(receiver, samples, FRAMES * 8, &bytes, 40);
    if (stopping.load()) break;
    if (result != ESP_OK || !bytes || bytes % 8) {
      error(result == ESP_OK ? ESP_FAIL : result);
      if (++failures >= 5) break;
      continue;
    }
    failures = 0;
    const size_t count = bytes / 8;
    const auto level = analysis.process(samples, count, gain, noiseFloor.cutoff(gate), scale);
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
    const auto bands = spectrum.process(samples,count,level.level,capturedAt);
    const uint8_t heldLevel = peakHold.process(level.level, capturedAt);
    const uint32_t stackFree = uxTaskGetStackHighWaterMark(nullptr);
    portENTER_CRITICAL(&mux);
    ++features.sequence; features.timestamp = capturedAt;
    features.bass=bands.bass; features.mid=bands.mid; features.treble=bands.treble;
    features.beat=bands.beat; features.bassBeat=bands.bassBeat;
    features.noiseFloor=noiseFloor.rms();features.effectiveGate=noiseFloor.cutoff(gate);
    features.effectiveGain = analysis.effectiveGainHundredths(gain);
    features.rms = level.rms; features.peak = level.peak; features.level = heldLevel;
    features.signalSeen |= level.signal; features.valid = true; features.error = 0;
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
  samples = new (std::nothrow) int32_t[FRAMES * 2];
  if (!finished || !samples) { error(ESP_ERR_NO_MEM); releaseReceiver(); return false; }
  xSemaphoreTake(finished, 0);
  i2s_chan_config_t channel = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  channel.dma_desc_num = 4; channel.dma_frame_num = FRAMES;
  esp_err_t result = i2s_new_channel(&channel, nullptr, &receiver);
  if (result == ESP_OK) {
    i2s_std_config_t config{};
    config.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(16000);
    config.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO);
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
  portEXIT_CRITICAL(&mux);
  if (xTaskCreate(capture, "lamp-audio", 4096, nullptr, 1, &worker) != pdPASS) {
    worker = nullptr; error(ESP_ERR_NO_MEM); releaseReceiver(); return false;
  }
  return true;
}
}

void beginLampAudio() {
  Preferences prefs;
  uint8_t data[7]{};
  if (!prefs.begin("coollamp", true)) return;
  const bool v2 = prefs.getBytesLength("audioV2") == sizeof(data);
  const char* key = v2 ? "audioV2" : "audioV1";
  const size_t size = v2 ? 7 : 5;
  const bool ok = prefs.getBytesLength(key) == size && prefs.getBytes(key, data, size) == size;
  prefs.end();
  const uint16_t storedGate = uint16_t(data[3]) | uint16_t(data[4]) << 8;
  const uint16_t storedScale = v2 ? uint16_t(data[5]) | uint16_t(data[6]) << 8 : 100;
  if (ok && data[0] == (v2 ? 2 : 1) && storedScale >= 100 && storedScale <= 400 && data[1] <= 1 && data[2] >= 1 && data[2] <= 64 && storedGate <= 1024) {
    installed = data[1]; gain = data[2]; gate = storedGate; scale = storedScale;
  }
}
bool lampHasMicrophone() { return installed; }
uint16_t lampAudioScale() { return scale; }
bool saveLampAudioConfiguration(bool enabled, uint8_t nextGain, uint16_t nextGate, uint16_t nextScale) {
  if (!nextScale) nextScale = scale;
  if (!nextGain || nextGain > 64 || nextGate > 1024 || nextScale < 100 || nextScale > 400) return false;
  const uint8_t data[7] = {2, uint8_t(enabled), nextGain, uint8_t(nextGate), uint8_t(nextGate >> 8), uint8_t(nextScale), uint8_t(nextScale >> 8)};
  Preferences prefs;
  if (!prefs.begin("coollamp", false)) return false;
  const bool ok = prefs.putBytes("audioV2", data, sizeof(data)) == sizeof(data); prefs.end();
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
  const bool diagnostic = diagnosticUntil && int32_t(diagnosticUntil - now) > 0;
  if (!installed || blocked || (!wanted && !diagnostic)) { stopLampAudio(); return; }
  if (worker && uxSemaphoreGetCount(finished)) {
    stopLampAudio(); retryAt = now + 5000;
  }
  if (!worker && (!retryAt || int32_t(now - retryAt) >= 0)) {
    retryAt = start() ? 0 : now + 5000;
  }
}
void diagnoseLampAudio() { diagnosticUntil = millis() + 10000; }
LampAudioFeatures getLampAudioFeatures() {
  portENTER_CRITICAL(&mux); auto copy = features; portEXIT_CRITICAL(&mux);
  if (!copy.running || uint32_t(millis() - copy.timestamp) > 100) { copy.valid = false; copy.level = 0; }
  return copy;
}
String lampAudioJson() {
  const auto f = getLampAudioFeatures();
  return String("{\"installed\":") + (installed ? "true" : "false") + ",\"liveTuning\":true,\"automaticGain\":true,\"gain\":" + gain + ",\"gate\":" + gate + ",\"scale\":" + scale +
    ",\"running\":" + (f.running ? "true" : "false") + ",\"valid\":" + (f.valid ? "true" : "false") +
    ",\"signalSeen\":" + (f.signalSeen ? "true" : "false") + ",\"level\":" + f.level +
    ",\"noiseFloor\":" + f.noiseFloor + ",\"effectiveGate\":" + f.effectiveGate + ",\"effectiveGain\":" + f.effectiveGain + ",\"rms\":" + f.rms + ",\"peak\":" + f.peak + ",\"blocks\":" + f.sequence +
    ",\"errors\":" + f.errors + ",\"overruns\":" + f.overruns + ",\"stackFree\":" + f.stackFree +
    ",\"bass\":" + f.bass + ",\"mid\":" + f.mid + ",\"treble\":" + f.treble +
    ",\"beat\":" + f.beat + ",\"bassBeat\":" + f.bassBeat +
    ",\"heap\":" + ESP.getFreeHeap() + ",\"frames\":" + lampRenderedFrames +
    ",\"maxRenderUs\":" + lampMaxRenderUs + ",\"error\":" + f.error + "}";
}
