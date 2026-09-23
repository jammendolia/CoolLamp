#include "LampUpdate.h"
#include "LampAudio.h"
#include "UpdateManifest.h"
#include <WiFi.h>
#include <Preferences.h>
#include "UpdateHttp.h"
#include <esp_ota_ops.h>
#include <esp_app_format.h>
#include <esp_app_desc.h>
#include <mbedtls/sha256.h>
#include <time.h>
#include <atomic>
#include <esp_heap_caps.h>

// Arduino core 3.3.11 normally confirms OTA before setup. Defer until loop is healthy.
extern "C" bool verifyRollbackLater() { return true; }

namespace {
constexpr char ROOT[] = "https://github.com/jammendolia/CoolLamp/releases/";
constexpr uint16_t CURRENT[3] = {LAMP_VERSION_MAJOR, LAMP_VERSION_MINOR, LAMP_VERSION_PATCH};
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
LampUpdateStatus status{};
FirmwareManifest candidate{};
TaskHandle_t worker = nullptr;
bool manual = false;
uint8_t job = 0;
std::atomic<bool> healthy{false};
uint32_t nextCheck = 0, restartAt = 0;
char attemptedVersion[24] = {};

bool busy(uint8_t phase) { return phase == UPDATE_CHECKING || phase == UPDATE_DOWNLOADING || phase == UPDATE_RESTARTING; }
void phase(uint8_t value, uint8_t error = UPDATE_OK) {
  portENTER_CRITICAL(&mux); status.phase = value; status.error = error; portEXIT_CRITICAL(&mux);
}
void fail(uint8_t error) { phase(UPDATE_ERROR, error); }
String versionText(const uint16_t v[3]) { return String(v[0]) + "." + String(v[1]) + "." + String(v[2]); }

bool checkRelease(bool installing = false) {
  UpdateHttp http; int code = 0; int64_t length = 0;
  // Discovery must bypass a cached Latest redirect. Installation rechecks the
  // exact offered release, never a second Latest lookup that could go backward.
  const String path = installing ? String("download/firmware-v") + versionText(candidate.version) + "/coollamp-manifest.txt" :
    String("latest/download/coollamp-manifest.txt?check=") + String(esp_random(), HEX);
  if (!http.open(String(ROOT) + path, code, length)) { fail(UPDATE_NETWORK); return false; }
  char text[256] = {}; size_t used = 0;
  if (code == 200 && (length < 0 || length < sizeof(text))) {
    while (used < sizeof(text) - 1) {
      const int n = http.read(text + used, sizeof(text) - 1 - used);
      if (n < 0) { used = sizeof(text); break; }
      if (!n) break;
      used += n;
    }
  }
  const bool complete = http.complete();
  http.close();
  if (code == 404) {
    if (installing) { fail(UPDATE_MANIFEST); return false; }
    portENTER_CRITICAL(&mux); status.available = false; memset(status.latest, 0, sizeof(status.latest)); portEXIT_CRITICAL(&mux);
    phase(UPDATE_IDLE); return true;
  }
  FirmwareManifest next{};
  if (code != 200 || !complete || used >= sizeof(text) - 1 || strlen(text) != used || !parseFirmwareManifest(text, next)) {
    fail(code == 200 ? UPDATE_MANIFEST : UPDATE_NETWORK); return false;
  }
  if (installing && !sameFirmwareManifest(next, candidate)) { fail(UPDATE_MANIFEST); return false; }
  const auto* target = esp_ota_get_next_update_partition(nullptr);
  if (!target || target->size < 2031616 || next.size > target->size) { fail(UPDATE_PARTITION); return false; }
  const bool newer = firmwareIsNewer(next.version, CURRENT);
  portENTER_CRITICAL(&mux);
  candidate = next; memcpy(status.latest, next.version, sizeof(status.latest));
  status.available = newer; status.progress = 0;
  portEXIT_CRITICAL(&mux);
  phase(newer ? (installing ? UPDATE_CHECKING : UPDATE_AVAILABLE) : UPDATE_IDLE); return true;
}
bool recordAttempt(const String& version) {
  Preferences prefs;
  if (!prefs.begin("coollamp", false)) return false;
  const bool ok = prefs.putString("otaAttempt", version) == version.length(); prefs.end();
  if (ok) strlcpy(attemptedVersion, version.c_str(), sizeof(attemptedVersion));
  return ok;
}
void downloadRelease() {
  phase(UPDATE_DOWNLOADING);
  const FirmwareManifest selected = candidate;
  const String version = versionText(selected.version);
  if (!recordAttempt(version)) { fail(UPDATE_STORAGE); return; }
  UpdateHttp http; int code = 0; int64_t length = 0;
  if (!http.open(String(ROOT) + "download/firmware-v" + version + "/CoolLamp.ino.bin", code, length)) { fail(UPDATE_NETWORK); return; }
  if (code != 200 || length != selected.size) { http.close(); fail(UPDATE_IMAGE); return; }
  const auto* target = esp_ota_get_next_update_partition(nullptr);
  esp_ota_handle_t ota = 0;
  uint8_t buffer[1024], digest[32]; size_t received = 0;
  mbedtls_sha256_context hash; mbedtls_sha256_init(&hash); mbedtls_sha256_starts(&hash, 0);
  bool ok = target && target->size >= 2031616 && esp_ota_begin(target, selected.size, &ota) == ESP_OK;
  const uint32_t started = millis();
  // Prefix may arrive in fragments. Validate before writing the first byte to OTA.
  constexpr size_t PREFIX = sizeof(esp_image_header_t) + sizeof(esp_image_segment_header_t) + sizeof(esp_app_desc_t);
  size_t prefixUsed = 0; uint8_t prefix[PREFIX]; bool headerValid = false;
  while (ok && received < selected.size && millis() - started < 180000) {
    const size_t want = min(sizeof(buffer), size_t(selected.size - received));
    const int n = http.read(reinterpret_cast<char*>(buffer), want);
    if (n <= 0) { ok = false; break; }
    mbedtls_sha256_update(&hash, buffer, n);
    size_t offset = 0;
    if (!headerValid) {
      const size_t take = min(size_t(n), PREFIX - prefixUsed);
      memcpy(prefix + prefixUsed, buffer, take); prefixUsed += take; offset += take;
      if (prefixUsed == PREFIX) {
        esp_image_header_t image; esp_app_desc_t app;
        memcpy(&image, prefix, sizeof(image));
        memcpy(&app, prefix + sizeof(image) + sizeof(esp_image_segment_header_t), sizeof(app));
        headerValid = image.magic == ESP_IMAGE_HEADER_MAGIC && image.chip_id == CONFIG_IDF_FIRMWARE_CHIP_ID && app.magic_word == ESP_APP_DESC_MAGIC_WORD;
        ok = headerValid && esp_ota_write(ota, prefix, PREFIX) == ESP_OK;
      }
    }
    if (ok && headerValid && offset < size_t(n)) ok = esp_ota_write(ota, buffer + offset, n - offset) == ESP_OK;
    received += n;
    portENTER_CRITICAL(&mux); status.progress = received * 100ULL / selected.size; portEXIT_CRITICAL(&mux);
    vTaskDelay(1);
  }
  mbedtls_sha256_finish(&hash, digest); mbedtls_sha256_free(&hash);
  http.close();
  ok = ok && headerValid && received == selected.size && !memcmp(digest, selected.sha256, 32);
  if (!ok) { if (ota) esp_ota_abort(ota); fail(UPDATE_IMAGE); return; }
  if (esp_ota_end(ota) != ESP_OK || esp_ota_set_boot_partition(target) != ESP_OK) { fail(UPDATE_IMAGE); return; }
  phase(UPDATE_RESTARTING);
}
void installRelease() {
  // Keep the manifest and download stack frames separate on this small device.
  // Revalidate the offered version, size and hash before downloading its image.
  if (checkRelease(true) && getLampUpdateStatus().available) downloadRelease();
}
void updateTask(void*) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    portENTER_CRITICAL(&mux); const uint8_t operation = job; job = 0; portEXIT_CRITICAL(&mux);
    if (WiFi.status() != WL_CONNECTED) { fail(UPDATE_OFFLINE); continue; }
    const uint32_t started = millis();
    while (time(nullptr) < 1700000000 && millis() - started < 15000) vTaskDelay(pdMS_TO_TICKS(100));
    if (time(nullptr) < 1700000000) { fail(UPDATE_CLOCK); continue; }
    if (operation == 2) installRelease(); else checkRelease();
  }
}
bool request(uint8_t operation) {
  if (!worker || !healthy) return false;
  portENTER_CRITICAL(&mux);
  if (manual || busy(status.phase) || job) { portEXIT_CRITICAL(&mux); return false; }
  if (operation == 2 && !status.available) { portEXIT_CRITICAL(&mux); return false; }
  job = operation; status.phase = UPDATE_CHECKING; status.error = 0;
  portEXIT_CRITICAL(&mux);
  // request() runs on the loop task. Do not wake HTTPS until DMA is released.
  if (!stopLampAudio()) {
    portENTER_CRITICAL(&mux); job = 0; portEXIT_CRITICAL(&mux);
    fail(UPDATE_MEMORY); return false;
  }
  xTaskNotifyGive(worker); return true;
}
} // namespace

void beginLampUpdater() {
  Preferences prefs;
  if (prefs.begin("coollamp", true)) {
    status.automatic = prefs.getBool("autoUpdate", false);
    const String attempted = prefs.getString("otaAttempt", "");
    strlcpy(attemptedVersion, attempted.c_str(), sizeof(attemptedVersion)); prefs.end();
  }
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
  if (xTaskCreate(updateTask, "lamp-update", 8192, nullptr, 1, &worker) != pdPASS) { worker = nullptr; fail(UPDATE_MEMORY); }
  nextCheck = millis() + 60000 + esp_random() % 30000;
}
LampUpdateStatus getLampUpdateStatus() {
  portENTER_CRITICAL(&mux); const auto copy = status; portEXIT_CRITICAL(&mux); return copy;
}
bool requestLampUpdateCheck() { return request(1); }
bool requestLampUpdateInstall() { return request(2); }
bool setLampAutoUpdate(bool enabled) {
  if (lampRemoteUpdateBusy()) return false;
  Preferences prefs;
  if (!prefs.begin("coollamp", false)) return false;
  const bool saved = prefs.putBool("autoUpdate", enabled) == 1; prefs.end();
  if (saved) { portENTER_CRITICAL(&mux); status.automatic = enabled; portEXIT_CRITICAL(&mux); }
  return saved;
}
bool lampRemoteUpdateBusy() { return busy(getLampUpdateStatus().phase); }
bool lampUpdateOwnsResources() {
  portENTER_CRITICAL(&mux); const bool result = manual || busy(status.phase); portEXIT_CRITICAL(&mux);
  return result;
}
bool reserveLampManualUpdate() {
  if (!healthy) return false;
  portENTER_CRITICAL(&mux);
  const bool ok = !manual && !busy(status.phase) && !job;
  if (ok) manual = true;
  portEXIT_CRITICAL(&mux);
  if (ok && !stopLampAudio()) { releaseLampManualUpdate(); return false; }
  return ok;
}
void releaseLampManualUpdate() { portENTER_CRITICAL(&mux); manual = false; portEXIT_CRITICAL(&mux); }
void serviceLampUpdater() {
  const uint32_t now = millis();
  if (!healthy && now >= 30000) {
    esp_ota_img_states_t state;
    const auto* running = esp_ota_get_running_partition();
    if (esp_ota_get_state_partition(running, &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY) {
      if (esp_ota_mark_app_valid_cancel_rollback() != ESP_OK) return;
    }
    healthy = true;
  }
  const auto current = getLampUpdateStatus();
  static uint8_t previousPhase = UPDATE_IDLE;
  if (current.phase == UPDATE_ERROR && previousPhase != UPDATE_ERROR) nextCheck = now + 15UL * 60 * 1000 + esp_random() % 60000;
  previousPhase = current.phase;
  if (current.phase == UPDATE_RESTARTING) {
    if (!restartAt) restartAt = now + 2000;
    if (static_cast<int32_t>(now - restartAt) >= 0) ESP.restart();
    return;
  }
  if (WiFi.status() != WL_CONNECTED || manual || busy(current.phase)) return;
  if (current.automatic && current.available && current.phase == UPDATE_AVAILABLE &&
      versionText(current.latest) != attemptedVersion && now > 60000) {
    if (requestLampUpdateInstall()) return;
  }
  if (static_cast<int32_t>(now - nextCheck) >= 0) {
    if (requestLampUpdateCheck()) nextCheck = now + 6UL * 60 * 60 * 1000 + esp_random() % 300000;
  }
}
void getLampUpdatePacket(uint8_t* out) {
  const auto s = getLampUpdateStatus(); memset(out, 0, 20);
  out[0] = 1; out[1] = s.phase; out[2] = s.automatic; out[3] = WiFi.status() == WL_CONNECTED;
  out[4] = s.progress; out[5] = s.error;
  for (unsigned i = 0; i < 3; ++i) {
    out[6+i*2] = CURRENT[i]; out[7+i*2] = CURRENT[i] >> 8;
    out[12+i*2] = s.latest[i]; out[13+i*2] = s.latest[i] >> 8;
  }
  out[18] = s.available;
}
String lampUpdateJson() {
  const auto s = getLampUpdateStatus();
  return String("{\"version\":\"") + LAMP_FIRMWARE_VERSION + "\",\"build\":\"" +
#ifdef COOL_LAMP_PUBLIC_RELEASE
    "COOLLAMP-PUBLIC-" LAMP_FIRMWARE_VERSION +
#else
    "COOLLAMP-LOCAL-" LAMP_FIRMWARE_VERSION +
#endif
    "\",\"latest\":\"" + versionText(s.latest) +
    "\",\"phase\":" + s.phase + ",\"progress\":" + s.progress + ",\"error\":" + s.error +
    ",\"automatic\":" + (s.automatic ? "true" : "false") + ",\"available\":" + (s.available ? "true" : "false") +
    ",\"wifi\":" + (WiFi.status() == WL_CONNECTED ? "true" : "false") +
    ",\"freeHeap\":" + String(ESP.getFreeHeap()) +
    ",\"largestBlock\":" + String(heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)) +
    ",\"workerStackFree\":" + String(worker ? uxTaskGetStackHighWaterMark(worker) : 0) +
    ",\"loopStackFree\":" + String(uxTaskGetStackHighWaterMark(nullptr)) + updateHttpDiagnostics() + "}";
}
