#include <algorithm>
#include <assert.h>
#include <iostream>
#include <string>
#include <vector>
#include "bridge-wifi-scan-stubs/esp_wifi.h"
const char* WIFI_EVENT = "wifi";
namespace {
esp_event_handler_t handler = nullptr;
void* handlerArg = nullptr;
int starts = 0, stops = 0, cleared = 0, recordGets = 0;
esp_err_t registration = ESP_OK, startResult = ESP_OK, stopResult = ESP_OK, numberResult = ESP_OK, recordResult = ESP_OK;
std::vector<wifi_ap_record_t> sdkRecords;
size_t sdkAt = 0;
wifi_scan_config_t lastConfig{};
}
esp_err_t esp_event_handler_instance_register(esp_event_base_t base, int32_t id, esp_event_handler_t callback, void* arg, esp_event_handler_instance_t* instance) {
 assert(base == WIFI_EVENT && id == WIFI_EVENT_SCAN_DONE);
 if (registration == ESP_OK) { handler = callback; handlerArg = arg; *instance = &starts; }
 return registration;
}
esp_err_t esp_wifi_scan_start(const wifi_scan_config_t* config, bool block) {
 assert(!block); ++starts; lastConfig = *config; sdkAt = 0; return startResult;
}
esp_err_t esp_wifi_scan_stop() { ++stops; return stopResult; }
esp_err_t esp_wifi_clear_ap_list() { ++cleared; sdkRecords.clear(); sdkAt = 0; return ESP_OK; }
esp_err_t esp_wifi_scan_get_ap_num(uint16_t* count) { *count = uint16_t(sdkRecords.size() - sdkAt); return numberResult; }
esp_err_t esp_wifi_scan_get_ap_record(wifi_ap_record_t* record) {
 ++recordGets;
 if (recordResult != ESP_OK || sdkAt == sdkRecords.size()) return ESP_FAIL;
 *record = sdkRecords[sdkAt++]; return ESP_OK;
}
#include "../bridge/BridgeWifiScan.cpp"
namespace {
using namespace BridgeWifiScan;
wifi_ap_record_t ap(const std::string& ssid, int rssi = -40, wifi_auth_mode_t auth = WIFI_AUTH_WPA2_PSK, int channel = 6) {
 wifi_ap_record_t item{}; memcpy(item.ssid, ssid.data(), std::min<size_t>(33, ssid.size()));
 item.rssi = int8_t(rssi); item.authmode = auth; item.primary = uint8_t(channel); return item;
}
void event(bool success = true, uint8_t id = 0) { wifi_event_sta_scan_done_t done{success ? 0u : 1u, uint8_t(sdkRecords.size()), id}; handler(handlerArg, WIFI_EVENT, WIFI_EVENT_SCAN_DONE, &done); }
void start(uint32_t now = 100) {
 assert(begin()); assert(request(now) == RequestResult::Accepted);
 assert(!scanning() && working() && starts == 0); service(now, false);
 assert(scanning() && starts == 1 && snapshot().phase == Phase::Scanning);
 assert(lastConfig.channel == 0 && !lastConfig.ssid && !lastConfig.bssid);
 assert(!lastConfig.show_hidden && lastConfig.scan_type == WIFI_SCAN_TYPE_ACTIVE);
 assert(lastConfig.scan_time.active.max == 120 && lastConfig.home_chan_dwell_time == 30);
}
void finish(uint32_t now = 200) {
 event();
 for (unsigned i = 0; i < 100 && scanning(); ++i) {
  const int before = recordGets; service(now + i, false); assert(recordGets - before <= 4);
 }
 assert(!scanning() && !working() && snapshot().phase == Phase::Ready);
}
}
int main(int argc, char** argv) {
 assert(argc == 2); const std::string scenario = argv[1];
 if (scenario == "normal") {
  start(); sdkRecords = {ap("Garden", -90), ap("Home", -40), ap("Home", -20), ap("home", -25), ap("Home", -35, WIFI_AUTH_OPEN), ap("Enterprise", -22, WIFI_AUTH_ENTERPRISE)};
  char output[JsonCapacity]; const int before = recordGets;
  assert(writeJson(output, sizeof(output)) && snapshot().phase == Phase::Scanning && recordGets == before);
  finish(); const auto& s = snapshot(); assert(s.count == 5 && !s.truncated);
  assert(std::string(s.networks[0].ssid) == "Home" && s.networks[0].rssi == -20);
  assert(!s.networks[1].supported && s.networks[1].secure);
  assert(std::string(s.networks[2].ssid) == "home");
  assert(!s.networks[3].secure && s.networks[3].supported);
  assert(cleared == 1); assert(writeJson(output, sizeof(output))); std::cout << output;
 } else if (scenario == "bounds") {
  start();
  for (unsigned i = 0; i < 400; ++i) sdkRecords.push_back(ap("network" + std::to_string(i), -100 + int(i % 99)));
  finish(); assert(snapshot().count == MaxNetworks && snapshot().truncated && recordGets == 256 && cleared == 1);
  for (uint8_t i = 1; i < snapshot().count; ++i) assert(snapshot().networks[i - 1].rssi >= snapshot().networks[i].rssi);
 } else if (scenario == "malformed") {
  start(); sdkRecords = {ap(""), ap("line\nfeed"), ap("\x7f"), ap("\xc2\x85"), ap("\xc0\xaf"), ap("\xed\xa0\x80"), ap("\xf4\x90\x80\x80"), ap("\xe2\x82"), ap(std::string(33, 'a')), ap("channel", -40, WIFI_AUTH_OPEN, 15), ap("positive", 5), ap("rssi", -128), ap("caf\xc3\xa9"), ap("a\"b\\c"), ap(std::string(32, 'x'))};
  finish(); assert(snapshot().count == 3);
  char output[JsonCapacity]; assert(writeJson(output, sizeof(output))); std::cout << output;
 } else if (scenario == "deadline") {
  start(0xffffff00u); service(uint32_t(0xffffff00u + DeadlineMs - 1), false); assert(scanning());
  service(uint32_t(0xffffff00u + DeadlineMs), false); assert(scanning() && working() && stops == 1 && cleared == 1 && std::string(snapshot().error) == "scan-timeout");
  assert(request(20000) == RequestResult::Unavailable);
  event(false); service(20001, false); assert(!scanning() && !working()); assert(request(20002) == RequestResult::Accepted);
 } else if (scenario == "queued") {
  assert(begin()); assert(request(100) == RequestResult::Accepted); service(101, true);
  assert(starts == 0 && snapshot().phase == Phase::Queued && !scanning() && working());
  assert(request(200) == RequestResult::Busy);
  service(100 + DeadlineMs, true); assert(starts == 0 && stops == 0 && cleared == 0 && snapshot().phase == Phase::Error && !working());
 } else if (scenario == "cancel") {
  start(); cancel(101); assert(stops == 1 && scanning() && working() && request(101) == RequestResult::Unavailable);
  event(false); service(102, false); assert(!scanning() && !working() && request(103) == RequestResult::RateLimited);
  // A completion already queued outside any owner's lease cannot become the
  // next request's success even if it is consumed after that request is queued.
  event(); assert(request(10100) == RequestResult::Accepted); service(10100, false);
  assert(snapshot().phase == Phase::Scanning && starts == 2);
  sdkRecords = {ap("new")}; finish(10101); assert(snapshot().generation == 2 && snapshot().count == 1);
 } else if (scenario == "cancel-queued") {
  assert(begin()); assert(request(100) == RequestResult::Accepted); cancel(101);
  assert(starts == 0 && stops == 0 && cleared == 0 && !working() && std::string(snapshot().error) == "scan-cancelled");
 } else if (scenario == "cancel-completion-race") {
  start(); event(); cancel(101); assert(request(10100) == RequestResult::Unavailable);
  service(10101, false); assert(request(10102) == RequestResult::Accepted);
  service(10102, false); assert(scanning()); sdkRecords = {ap("next")}; finish(10103);
  assert(snapshot().generation == 2 && snapshot().count == 1);
 } else if (scenario == "generation-rollover") {
  assert(begin()); BridgeWifiScan::value.generation = 0xffffffffu;
  assert(request(100) == RequestResult::Accepted && snapshot().generation == 1);
  service(100, false); finish(); assert(snapshot().generation == 1);
 } else if (scenario == "errors") {
  startResult = ESP_ERR_WIFI_STATE; assert(begin()); assert(request(100) == RequestResult::Accepted); service(100, false);
  assert(!scanning() && cleared == 0 && std::string(snapshot().error) == "wifi-busy");
  startResult = ESP_OK; assert(request(10100) == RequestResult::Accepted); service(10100, false);
  numberResult = ESP_FAIL; event(); service(10101, false);
  assert(!scanning() && cleared == 1 && std::string(snapshot().error) == "scan-results-unavailable");
 } else if (scenario == "overflow") {
  start(); for (int i = 0; i < 5; ++i) event(); service(101, false);
  assert(snapshot().phase == Phase::Error && std::string(snapshot().error) == "scan-event-overflow");
 } else if (scenario == "serializer") {
  start(); for (unsigned i = 0; i < MaxNetworks; ++i) sdkRecords.push_back(ap(std::to_string(i) + std::string(30, '\\')));
  finish(); char output[JsonCapacity]; const size_t length = writeJson(output, sizeof(output)); assert(length && length < JsonCapacity);
  std::vector<char> exact(length + 1); assert(writeJson(exact.data(), exact.size()) == length);
  std::vector<char> shortBuffer(length); assert(!writeJson(shortBuffer.data(), shortBuffer.size()) && shortBuffer[0] == 0);
  assert(!writeJson(nullptr, 10)); assert(!writeJson(output, 0)); std::cout << output;
 } else if (scenario == "no-event") {
  start(); service(100 + DeadlineMs, false);
  assert(scanning() && working() && request(1000000) == RequestResult::Unavailable); service(1000000, false); assert(starts == 1);
 } else if (scenario == "stop-failure") {
  start(); stopResult = ESP_FAIL; cancel(101);
  assert(scanning() && working() && snapshot().phase == Phase::Error);
  assert(request(10100) == RequestResult::Unavailable);
  event(false); service(10101, false);
  assert(scanning() && working() && request(10102) == RequestResult::Unavailable && starts == 1);
 } else if (scenario == "registration") {
  registration = ESP_FAIL; assert(!begin()); assert(request(100) == RequestResult::Unavailable && starts == 0);
 } else assert(false);
 return 0;
}
