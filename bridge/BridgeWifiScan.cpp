#include "BridgeWifiScan.h"
#include <esp_event.h>
#include <esp_wifi.h>
#include <atomic>
#include <stdio.h>
#include <string.h>

namespace BridgeWifiScan {
namespace {
constexpr uint16_t MaxInspectedRecords = 256;
constexpr uint8_t RecordsPerTurn = 4;
constexpr uint8_t EventCapacity = 4;
struct Completion { uint32_t generation; bool success; };
Snapshot value;
Completion events[EventCapacity]{};
std::atomic<uint32_t> head{0}, tail{0}, armed{0};
std::atomic<bool> overflow{false};
esp_event_handler_instance_t eventInstance = nullptr;
bool available = false, active = false, collecting = false, awaitingStop = false;
bool radioUncertain = false;
bool haveRequested = false;
uint32_t requestedAt = 0, lastRequestedAt = 0, stoppingGeneration = 0;
uint16_t remaining = 0, inspected = 0;

void completed(void*, esp_event_base_t base, int32_t id, void* data) {
  if (base != WIFI_EVENT || id != WIFI_EVENT_SCAN_DONE || !data) return;
  const auto& done = *static_cast<const wifi_event_sta_scan_done_t*>(data);
  const uint32_t at = head.load(std::memory_order_relaxed);
  if (at - tail.load(std::memory_order_acquire) >= EventCapacity) {
    overflow.store(true, std::memory_order_release); return;
  }
  // Do not assume scan_id increments for non-blocking scans: the pinned SDK
  // only documents its sequencing for blocking scans. One physical scan owns
  // the radio until its completion drains, including cancellation. Mailbox
  // entries carry that owner's generation, rather than a guessed SDK number.
  events[at % EventCapacity] = {armed.load(std::memory_order_acquire), done.status == 0};
  head.store(at + 1, std::memory_order_release);
}

void clearRecords() {
  // Raw IDF scanning does not set Arduino WIFI_SCANNING_BIT. Core 3.3.11's
  // WiFiScanClass::_scanDone therefore returns without allocating its second
  // full AP array. The driver still owns its documented dynamic AP list.
  esp_wifi_clear_ap_list(); remaining = inspected = 0; collecting = false;
}
void fail(const char* error, bool stop) {
  const bool owned = active;
  armed.store(0, std::memory_order_release);
  if (stop && active && !collecting) {
    // Do not start another scan until this scan's completion has drained. If
    // the driver never reports cancellation, fail closed until bridge restart.
    stoppingGeneration = value.generation;
    awaitingStop = esp_wifi_scan_stop() == ESP_OK;
    if (!awaitingStop) { available = false; radioUncertain = true; }
  }
  if (owned) clearRecords();
  active = false;
  value.phase = Phase::Error; value.error = error;
  value.count = 0;
  for (auto& item : value.networks) item = Network{};
}

bool validSsid(const uint8_t* input, size_t& length) {
  length = 0;
  while (length < 33 && input[length]) ++length;
  if (!length || length > 32) return false;
  size_t i = 0;
  while (i < length) {
    uint32_t cp = input[i++]; unsigned more = 0;
    if (cp >= 0xc2 && cp <= 0xdf) { cp &= 0x1f; more = 1; }
    else if (cp >= 0xe0 && cp <= 0xef) { cp &= 0x0f; more = 2; }
    else if (cp >= 0xf0 && cp <= 0xf4) { cp &= 0x07; more = 3; }
    else if (cp >= 0x80) return false;
    if (i + more > length) return false;
    const unsigned encoded = more;
    while (more--) {
      const uint8_t byte = input[i++];
      if ((byte & 0xc0) != 0x80) return false;
      cp = (cp << 6) | (byte & 0x3f);
    }
    if ((encoded == 1 && cp < 0x80) || (encoded == 2 && cp < 0x800) ||
        (encoded == 3 && cp < 0x10000) || cp > 0x10ffff ||
        (cp >= 0xd800 && cp <= 0xdfff) || cp < 0x20 ||
        (cp >= 0x7f && cp <= 0x9f)) return false;
  }
  return true;
}
bool supported(wifi_auth_mode_t mode) {
  // WiFi.begin(ssid,password) uses personal-network credentials. WEP/WPA1,
  // enterprise/EAP, WAPI, DPP and unknown schemes need a different setup path.
  return mode == WIFI_AUTH_OPEN || mode == WIFI_AUTH_WPA2_PSK ||
      mode == WIFI_AUTH_WPA_WPA2_PSK || mode == WIFI_AUTH_WPA3_PSK ||
      mode == WIFI_AUTH_WPA2_WPA3_PSK;
}
bool precedes(const Network& left, const Network& right) {
  if (left.rssi != right.rssi) return left.rssi > right.rssi;
  const int names = strcmp(left.ssid, right.ssid);
  return names < 0 || (names == 0 && left.authMode < right.authMode);
}
void retain(const wifi_ap_record_t& record) {
  size_t length = 0;
  if (!validSsid(record.ssid, length) || !record.primary || record.primary > 14 || record.rssi > 0 || record.rssi < -127) return;
  Network item;
  memcpy(item.ssid, record.ssid, length); item.ssid[length] = 0;
  item.rssi = record.rssi; item.channel = record.primary;
  item.authMode = uint8_t(record.authmode);
  item.secure = record.authmode != WIFI_AUTH_OPEN;
  item.supported = supported(record.authmode);
  for (uint8_t i = 0; i < value.count; ++i) {
    if (!strcmp(value.networks[i].ssid, item.ssid) && value.networks[i].authMode == item.authMode) {
      if (item.rssi <= value.networks[i].rssi) return;
      for (uint8_t j = i; j + 1 < value.count; ++j) value.networks[j] = value.networks[j + 1];
      --value.count; break;
    }
  }
  uint8_t at = 0;
  while (at < value.count && !precedes(item, value.networks[at])) ++at;
  if (value.count == MaxNetworks) {
    value.truncated = true;
    if (at == MaxNetworks) return;
  } else ++value.count;
  for (uint8_t i = value.count - 1; i > at; --i) value.networks[i] = value.networks[i - 1];
  value.networks[at] = item;
}
const char* phaseName(Phase phase) {
  switch (phase) {
    case Phase::Idle: return "idle";
    case Phase::Queued: return "queued";
    case Phase::Scanning: return "scanning";
    case Phase::Ready: return "ready";
    default: return "error";
  }
}
struct Writer {
  char* data; size_t capacity, used = 0; bool ok = true;
  void append(const char* text) {
    const size_t length = strlen(text);
    if (!ok || length >= capacity - used) { ok = false; return; }
    memcpy(data + used, text, length); used += length; data[used] = 0;
  }
  void quoted(const char* text) {
    append("\"");
    while (*text && ok) {
      char one[3]{*text++, 0, 0};
      if (one[0] == '"' || one[0] == '\\') { one[1] = one[0]; one[0] = '\\'; }
      append(one);
    }
    append("\"");
  }
};
}

bool begin() {
  if (eventInstance) return available;
  available = esp_event_handler_instance_register(WIFI_EVENT, WIFI_EVENT_SCAN_DONE, completed, nullptr, &eventInstance) == ESP_OK;
  if (!available) { value.phase = Phase::Error; value.error = "scan-unavailable"; }
  return available;
}
RequestResult request(uint32_t now) {
  if (value.phase == Phase::Queued || active) return RequestResult::Busy;
  if (!available || awaitingStop) return RequestResult::Unavailable;
  if (haveRequested && uint32_t(now - lastRequestedAt) < RetryIntervalMs) return RequestResult::RateLimited;
  ++value.generation; if (!value.generation) ++value.generation;
  value.phase = Phase::Queued; value.error = ""; value.count = 0; value.truncated = false;
  for (auto& item : value.networks) item = Network{};
  requestedAt = lastRequestedAt = now; haveRequested = true;
  return RequestResult::Accepted;
}
void service(uint32_t now, bool blocked) {
  uint8_t eventBudget = EventCapacity;
  while (eventBudget--) {
    const uint32_t at = tail.load(std::memory_order_relaxed);
    if (at == head.load(std::memory_order_acquire)) break;
    const Completion done = events[at % EventCapacity];
    tail.store(at + 1, std::memory_order_release);
    if (awaitingStop && (!done.generation || done.generation == stoppingGeneration)) {
      awaitingStop = false; clearRecords(); continue;
    }
    if (!active || collecting || done.generation != value.generation) continue;
    if (!done.success) { fail("scan-failed", false); continue; }
    armed.store(0, std::memory_order_release);
    if (esp_wifi_scan_get_ap_num(&remaining) != ESP_OK) { fail("scan-results-unavailable", false); continue; }
    collecting = true;
  }
  if (overflow.exchange(false, std::memory_order_acq_rel) && active) { fail("scan-event-overflow", true); return; }
  if ((value.phase == Phase::Queued || active) && uint32_t(now - requestedAt) >= DeadlineMs) {
    fail("scan-timeout", active); return;
  }
  if (value.phase == Phase::Queued && !blocked && !awaitingStop) {
    wifi_scan_config_t settings{};
    settings.show_hidden = false; settings.scan_type = WIFI_SCAN_TYPE_ACTIVE;
    settings.scan_time.active.min = 30; settings.scan_time.active.max = 120;
    settings.home_chan_dwell_time = 30;
    armed.store(value.generation, std::memory_order_release);
    const esp_err_t result = esp_wifi_scan_start(&settings, false);
    if (result != ESP_OK) { fail(result == ESP_ERR_WIFI_STATE ? "wifi-busy" : "scan-start-failed", false); return; }
    active = true;
    value.phase = Phase::Scanning;
  }
  if (!active || !collecting) return;
  uint8_t budget = RecordsPerTurn;
  while (remaining && budget-- && inspected < MaxInspectedRecords) {
    wifi_ap_record_t record{};
    if (esp_wifi_scan_get_ap_record(&record) != ESP_OK) { fail("scan-results-unavailable", false); return; }
    --remaining; ++inspected; retain(record);
  }
  if (!remaining || inspected == MaxInspectedRecords) {
    if (remaining) value.truncated = true;
    clearRecords(); active = false; value.phase = Phase::Ready;
  }
}
void cancel(uint32_t) {
  if (value.phase == Phase::Queued || active) fail("scan-cancelled", active);
}
bool scanning() { return active || awaitingStop || radioUncertain; }
bool working() { return value.phase == Phase::Queued || scanning(); }
const Snapshot& snapshot() { return value; }
size_t writeJson(char* output, size_t capacity) {
  if (!output || !capacity) return 0;
  output[0] = 0; Writer writer{output, capacity};
  char number[96]; snprintf(number, sizeof(number), "{\"phase\":\"%s\",\"generation\":%lu,\"networks\":[", phaseName(value.phase), static_cast<unsigned long>(value.generation));
  writer.append(number);
  for (uint8_t i = 0; i < value.count; ++i) {
    if (i) writer.append(",");
    writer.append("{\"ssid\":"); writer.quoted(value.networks[i].ssid);
    snprintf(number, sizeof(number), ",\"rssi\":%d,\"channel\":%u,\"secure\":%s,\"supported\":%s}", value.networks[i].rssi, value.networks[i].channel, value.networks[i].secure ? "true" : "false", value.networks[i].supported ? "true" : "false");
    writer.append(number);
  }
  writer.append(value.truncated ? "],\"truncated\":true,\"error\":" : "],\"truncated\":false,\"error\":");
  writer.quoted(value.error); writer.append("}");
  if (!writer.ok) { output[0] = 0; return 0; }
  return writer.used;
}
}
