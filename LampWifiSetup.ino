#include "LampWifiSetup.h"
#include <atomic>

namespace LampWifiSetup {
enum Phase : uint8_t { IDLE, SCANNING, SCANNED, CONNECTING, CONNECTED, FAILED };
struct Network { char ssid[33]; int16_t rssi; bool open; };
Network networks[16]{};
uint8_t count = 0, error = 0;
uint16_t scanId = 0;
Phase phase = IDLE;
uint32_t started = 0;
WifiSetupWire::Credentials transfer;
char candidateSsid[33]{}, candidatePassword[64]{};
std::atomic<bool> observing{false}, associated{false}, gotIp{false};
std::atomic<uint16_t> disconnectReason{0};
uint8_t lastJoinError=0;

void clearCandidate() {
  memset(candidateSsid, 0, sizeof(candidateSsid));
  volatile char* p = candidatePassword;
  for (size_t i = 0; i < sizeof(candidatePassword); ++i) p[i] = 0;
}
void restoreStation() {
  WiFi.disconnect(false, false);
  WiFi.setAutoReconnect(true);
  WiFi.mode(setupAP ? WIFI_AP_STA : lampSettings.ssid[0] ? WIFI_STA : WIFI_OFF);
  if (lampSettings.ssid[0]) WiFi.begin(lampSettings.ssid, lampSettings.wifiPassword);
}
void fail(uint8_t reason) {
  observing=false;lastJoinError=reason;
  phase = FAILED; error = reason; clearCandidate(); transfer.clear(); restoreStation();
}
}

void beginLampWifiSetupDiagnostics() {
  // Network events run on another task. Only atomics are touched here; no
  // credentials, NVS, Strings, or radio changes are accessed by the callback.
  WiFi.onEvent([](arduino_event_id_t event, arduino_event_info_t info) {
    using namespace LampWifiSetup;
    if(!observing.load())return;
    if(event==ARDUINO_EVENT_WIFI_STA_CONNECTED)associated=true;
    if(event==ARDUINO_EVENT_WIFI_STA_GOT_IP){associated=true;gotIp=true;}
    if(event==ARDUINO_EVENT_WIFI_STA_DISCONNECTED){
      associated=false;
      // ASSOC_LEAVE is also sent by our deliberate pre-join disconnect. Keep
      // meaningful router/driver failures rather than overwriting them with it.
      if(info.wifi_sta_disconnected.reason!=8)disconnectReason=info.wifi_sta_disconnected.reason;
    }
  });
}

bool lampWifiSetupBusy() { return LampWifiSetup::phase == LampWifiSetup::CONNECTING || LampWifiSetup::phase == LampWifiSetup::SCANNING; }
void resetLampWifiSetupTransfer() { LampWifiSetup::transfer.clear(); }
String lampWifiSetupJson() {
  using namespace LampWifiSetup;
  const bool online = WiFi.status() == WL_CONNECTED;
  String reply = String("{\"version\":1,\"phase\":") + unsigned(phase) + ",\"error\":" + error +
    ",\"firmware\":\"" LAMP_FIRMWARE_VERSION "\",\"leds\":" + lampSettings.ledCount +
    ",\"scanId\":" + scanId + ",\"count\":" + count + ",\"connected\":" + (online ? "true" : "false") +
    ",\"ssid\":" + jsonText(phase == CONNECTING ? String(candidateSsid) : String(lampSettings.ssid)) +
    ",\"address\":" + jsonText(online ? WiFi.localIP().toString() : String("0.0.0.0")) +
    ",\"hostname\":" + jsonText(lampHost + ".local") + ",\"deviceId\":" + jsonText(lampIdentity()) +
    ",\"usingDefaultPassword\":" + (lampUsesFactoryPassword(lampSettings.adminPassword) ? "true" : "false");
  // Compact diagnostics keep even escaped 32-byte SSIDs within the GATT
  // attribute size: [last join error, Wi-Fi reason, associated, got IPv4].
  reply += String(",\"join\":[") + lastJoinError + "," + disconnectReason.load() + "," +
    unsigned(associated.load()) + "," + unsigned(gotIp.load()) + "]}";
  return reply;
}
void captureLampWifiSetupNetwork(uint8_t index, const String& ssid, int rssi, bool open) {
  using namespace LampWifiSetup;
  if (phase != SCANNING || index >= 16 || ssid.isEmpty() || ssid.length() > 32) return;
  auto& network = networks[count];
  strlcpy(network.ssid, ssid.c_str(), sizeof(network.ssid));
  network.rssi = rssi; network.open = open; ++count;
}
void finishLampWifiSetupScan(bool success) {
  using namespace LampWifiSetup;
  if (phase != SCANNING) return;
  phase = success ? SCANNED : FAILED; error = success ? 0 : 1;
  if (!setupAP && !lampSettings.ssid[0]) WiFi.mode(WIFI_OFF);
}
uint8_t lampWifiSetupCommand(const uint8_t* frame, size_t size, uint32_t owner, String& reply) {
  using namespace LampWifiSetup;
  if (!WifiSetupWire::validFrame(frame, size)) { transfer.clear(); return 2; }
  const uint8_t op = frame[2], value = frame[3];
  if (op == WifiSetupWire::CONTROL && value == 0) { reply = lampWifiSetupJson(); return 0; }
  if (lampIsUpdating() || lampUpdateOwnsResources() || lampFactoryResetPending()) return 3;
  if (op == WifiSetupWire::CONTROL && value == 2) {
    observing=false;
    transfer.clear();
    if (phase == CONNECTING) { clearCandidate(); restoreStation(); }
    if (phase == SCANNING) { esp_wifi_scan_stop(); WiFi.scanDelete(); scanActive = false; restoreStation(); }
    phase = IDLE; error = 0; reply = lampWifiSetupJson(); return 0;
  }
  if (phase == CONNECTING || (phase == SCANNING && op != WifiSetupWire::CONTROL)) return 3;
  if (op == WifiSetupWire::CONTROL) {
    if (scanActive || phase == SCANNING) return 3;
    transfer.clear(); count = 0; ++scanId; error = 0; phase = SCANNING; started = millis();
    WiFi.mode(setupAP ? WIFI_AP_STA : WIFI_STA);
    beginLampScan();
    if (!scanActive) finishLampWifiSetupScan(false);
    reply = lampWifiSetupJson(); return 0;
  }
  if (op == WifiSetupWire::NETWORK) {
    if (phase != SCANNED || value >= count) return 2;
    const auto& network = networks[value];
    reply = String("{\"version\":1,\"scanId\":") + scanId + ",\"index\":" + value +
      ",\"ssid\":" + jsonText(network.ssid) + ",\"rssi\":" + network.rssi +
      ",\"open\":" + (network.open ? "true" : "false") + "}";
    return 0;
  }
  if (op == WifiSetupWire::BEGIN) return transfer.begin(frame, size, owner, millis()) ? 0 : 2;
  if (op == WifiSetupWire::CHUNK) return transfer.append(frame, size, owner, millis()) ? 0 : 2;
  if (!transfer.complete(owner, millis()) || scanActive) { transfer.clear(); return 2; }
  memcpy(candidateSsid, transfer.bytes, transfer.ssidSize); candidateSsid[transfer.ssidSize] = 0;
  memcpy(candidatePassword, transfer.bytes + transfer.ssidSize, transfer.passwordSize); candidatePassword[transfer.passwordSize] = 0;
  transfer.clear(); error = 0; phase = CONNECTING; started = millis();
  observing=false;lastJoinError=0;disconnectReason=0;associated=false;gotIp=false;
  WiFi.setAutoReconnect(false); WiFi.disconnect(false, false);
  WiFi.mode(setupAP ? WIFI_AP_STA : WIFI_STA);
  observing=true;WiFi.begin(candidateSsid, candidatePassword);
  reply = lampWifiSetupJson(); return 0;
}
void serviceLampWifiSetup() {
  using namespace LampWifiSetup;
  if (transfer.ssidSize && uint32_t(millis() - transfer.touched) >= 20000) transfer.clear();
  if (phase == SCANNING && uint32_t(millis() - started) >= 25000) {
    esp_wifi_scan_stop(); WiFi.scanDelete(); scanActive = false; finishLampWifiSetupScan(false);
  }
  if (phase != CONNECTING) return;
  if (WiFi.status() == WL_CONNECTED && WiFi.SSID() == candidateSsid && WiFi.localIP() != IPAddress(0, 0, 0, 0)) {
    LampSettings next = lampSettings;
    memset(next.ssid, 0, sizeof(next.ssid)); memset(next.wifiPassword, 0, sizeof(next.wifiPassword));
    strlcpy(next.ssid, candidateSsid, sizeof(next.ssid)); strlcpy(next.wifiPassword, candidatePassword, sizeof(next.wifiPassword));
    Preferences prefs;
    if (!prefs.begin("coollamp", false)) { fail(3); return; }
    const bool saved = prefs.putBytes("settings", &next, sizeof(next)) == sizeof(next); prefs.end();
    if (!saved) { fail(3); return; }
    observing=false;lampSettings = next; phase = CONNECTED; error = 0; clearCandidate(); WiFi.setAutoReconnect(true);
  } else if (uint32_t(millis() - started) >= 35000) fail(2);
}
