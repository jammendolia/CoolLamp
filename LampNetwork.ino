#include <WiFi.h>
#include <esp_wifi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <Update.h>
#include <esp_app_format.h>
#include <esp_app_desc.h>
#include "LampSecrets.h"
#include "LampPage.h"

LampSettings lampSettings;
WebServer lampServer(80);
String lampHost;
String lampAPName;
String lampToken;
bool scanActive = false;
String scanResults = "{\"status\":\"idle\",\"networks\":[]}";
bool setupAP = false;
bool lastAPStartOK = false;
bool serverStarted = false;
bool mdnsStarted = false;
bool otaActive = false;
bool otaAccepted = false;
bool otaComplete = false;
uint32_t apLastActivity = 0;
uint32_t setupPulseStart = 0;
bool setupPulseActive = false;
uint32_t restartAt = 0;
uint32_t otaLastActivity = 0;
String otaMessage;
constexpr size_t IMAGE_PREFIX_SIZE = sizeof(esp_image_header_t) + sizeof(esp_image_segment_header_t) + sizeof(esp_app_desc_t);
uint8_t imagePrefix[IMAGE_PREFIX_SIZE];
size_t imagePrefixUsed = 0;
bool imageValidated = false;

const char* const effectNames[] = {
  "Pacifica", "Aurora", "Rain", "Fire", "Split fire", "Split fire - outward",
  "Split fire - reversed colors", "Blue gas fire", "Witch fire", "Purple fire",
  "Embers", "Lava", "Plasma", "Rainbow", "Rainbow with glitter", "Confetti",
  "Comet collision", "Sinelon", "BPM", "Juggle", "White", "Red", "Green",
  "Blue", "Purple", "Pink", "Yellow", "Cyan"
};
static_assert(sizeof(effectNames) / sizeof(effectNames[0]) == MODE_MAX, "Every mode needs a web label");

void loadLampSettings()
{
  LampSettings defaults = {};
  defaults.version = 1;
  defaults.ledCount = DEFAULT_LED_COUNT;
  defaults.milliAmps = MAX_POWER_MILLIAMPS;
  defaults.brightness = 100;
  defaults.startupMode = MODE_FIRE;
  strlcpy(defaults.adminPassword, DEFAULT_ADMIN_PASSWORD, sizeof(defaults.adminPassword));
  lampSettings = defaults;
  Preferences prefs;
  if (!prefs.begin("coollamp", true)) return;
  LampSettings saved = {};
  const bool found = prefs.getBytesLength("settings") == sizeof(saved) &&
                     prefs.getBytes("settings", &saved, sizeof(saved)) == sizeof(saved);
  prefs.end();
  if (!found || saved.version != 1 || saved.ledCount < 1 || saved.ledCount > MAX_LED_COUNT ||
      saved.milliAmps < 100 || saved.milliAmps > 20000 || saved.brightness < 1 ||
      saved.startupMode < 1 || saved.startupMode > MODE_MAX ||
      saved.ssid[32] != '\0' || saved.wifiPassword[63] != '\0' || saved.adminPassword[63] != '\0' ||
      strlen(saved.adminPassword) < 8) return;
  lampSettings = saved;
}

String jsonText(const String& value)
{
  String out = "\"";
  for (size_t i = 0; i < value.length(); i++) {
    const uint8_t c = value[i];
    if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
    else if (c < 32) { char escape[7]; snprintf(escape, sizeof(escape), "\\u%04x", c); out += escape; }
    else out += static_cast<char>(c);
  }
  return out + '"';
}

bool authorizedLampRequest(bool mutation)
{
  lampServer.sendHeader("Cache-Control", "no-store");
  if (!lampServer.authenticate("lamp", lampSettings.adminPassword)) {
    lampServer.requestAuthentication();
    return false;
  }
  if (mutation && lampServer.header("X-Lamp-Token") != lampToken) {
    lampServer.send(403, "text/plain", "Refresh the page and try again.");
    return false;
  }
  apLastActivity = millis();
  return true;
}

// Scan asynchronously so effects and HTTP requests continue while the radio scans.
void serviceLampScan()
{
  if (!scanActive) return;
  const int count = WiFi.scanComplete();
  if (count == WIFI_SCAN_RUNNING) return;
  scanActive = false;
  if (count < 0) {
    esp_wifi_scan_stop();
    scanResults = "{\"status\":\"failed\",\"networks\":[]}";
  } else {
    // WiFi exposes result indexes as uint8_t. Bound both work and response size.
    int selected[32];
    int used = 0;
    for (int i = 0; i < count && i < 256; ++i) {
      const String ssid = WiFi.SSID(i);
      if (ssid.isEmpty()) continue;
      bool duplicate = false;
      for (int j = 0; j < used; ++j) {
        if (WiFi.SSID(selected[j]) == ssid && WiFi.encryptionType(selected[j]) == WiFi.encryptionType(i)) {
          if (WiFi.RSSI(i) > WiFi.RSSI(selected[j])) selected[j] = i;
          duplicate = true; break;
        }
      }
      if (duplicate) continue;
      if (used < 32) selected[used++] = i;
      else {
        int weakest = 0;
        for (int j = 1; j < used; ++j) if (WiFi.RSSI(selected[j]) < WiFi.RSSI(selected[weakest])) weakest = j;
        if (WiFi.RSSI(i) > WiFi.RSSI(selected[weakest])) selected[weakest] = i;
      }
    }
    for (int i = 0; i < used; ++i) for (int j = i + 1; j < used; ++j) {
      if (WiFi.RSSI(selected[j]) > WiFi.RSSI(selected[i])) { int swap = selected[i]; selected[i] = selected[j]; selected[j] = swap; }
    }
    scanResults = "{\"status\":\"complete\",\"networks\":[";
    for (int i = 0; i < used; ++i) {
      if (i) scanResults += ',';
      const int index = selected[i];
      scanResults += "{\"ssid\":" + jsonText(WiFi.SSID(index));
      scanResults += ",\"rssi\":" + String(WiFi.RSSI(index));
      scanResults += ",\"open\":" + String(WiFi.encryptionType(index) == WIFI_AUTH_OPEN ? "true" : "false") + "}";
    }
    scanResults += "]}";
  }
  WiFi.scanDelete();
}

void startLampScan()
{
  if (!authorizedLampRequest(true)) return;
  if (otaActive) { lampServer.send(409, "text/plain", "Wait for the firmware upload to finish."); return; }
  if (!scanActive) {
    WiFi.setScanTimeout(20000);
    scanActive = WiFi.scanNetworks(true, false, false, 120) == WIFI_SCAN_RUNNING;
    scanResults = scanActive ? "{\"status\":\"scanning\",\"networks\":[]}" : "{\"status\":\"failed\",\"networks\":[]}";
  }
  lampServer.send(202, "application/json", scanResults);
}

bool readNumber(const char* name, uint32_t low, uint32_t high, uint32_t& result)
{
  const String value = lampServer.arg(name);
  if (value.isEmpty() || value.length() > 6) return false;
  result = 0;
  for (size_t i = 0; i < value.length(); i++) {
    if (value[i] < '0' || value[i] > '9') return false;
    result = result * 10 + value[i] - '0';
  }
  return result >= low && result <= high;
}

void sendLampState()
{
  if (!authorizedLampRequest(false)) return;
  String state = "{\"token\":" + jsonText(lampToken);
  state += ",\"mode\":" + String(Mode) + ",\"brightness\":" + String(Brightness);
  state += ",\"leds\":" + String(NUM_LEDS) + ",\"milliamps\":" + String(lampSettings.milliAmps);
  state += ",\"power\":" + String(PowerOn ? "true" : "false");
  state += ",\"ssid\":" + jsonText(lampSettings.ssid);
  state += ",\"connected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false");
  state += ",\"address\":" + jsonText(WiFi.localIP().toString());
  state += ",\"hostname\":" + jsonText(lampHost + ".local") + ",\"effects\":[";
  for (size_t i = 0; i < MODE_MAX; i++) { if (i) state += ','; state += jsonText(effectNames[i]); }
  state += "]}";
  lampServer.send(200, "application/json", state);
}

void saveLampConfiguration()
{
  if (!authorizedLampRequest(true)) return;
  uint32_t count, powerLimit, brightness, mode;
  if (!readNumber("leds", 1, MAX_LED_COUNT, count) || !readNumber("milliamps", 100, 20000, powerLimit) ||
      !readNumber("brightness", 1, 255, brightness) || !readNumber("mode", 1, MODE_MAX, mode)) {
    lampServer.send(400, "text/plain", "Check LED count, power limit, brightness, and effect."); return;
  }
  LampSettings next = lampSettings;
  next.ledCount = count; next.milliAmps = powerLimit; next.brightness = brightness; next.startupMode = mode;
  const String ssid = lampServer.arg("ssid");
  const String wifiPass = lampServer.arg("wifiPassword");
  const String adminPass = lampServer.arg("adminPassword");
  if (ssid.length() > 32 || wifiPass.length() > 63 || (!wifiPass.isEmpty() && wifiPass.length() < 8) ||
      (!adminPass.isEmpty() && (adminPass.length() < 8 || adminPass.length() > 63))) {
    lampServer.send(400, "text/plain", "Wi-Fi passwords need 8–63 characters; access passwords need 8–63. Network names are at most 32 bytes."); return;
  }
  if (lampServer.arg("forgetWifi") == "1") {
    memset(next.ssid, 0, sizeof(next.ssid)); memset(next.wifiPassword, 0, sizeof(next.wifiPassword));
  } else {
    if (ssid != String(next.ssid) && !ssid.isEmpty() && wifiPass.isEmpty() && lampServer.arg("openNetwork") != "1") {
      lampServer.send(400, "text/plain", "Enter the new network password or select the password-free network option."); return;
    }
    memset(next.ssid, 0, sizeof(next.ssid)); strlcpy(next.ssid, ssid.c_str(), sizeof(next.ssid));
    if (ssid.isEmpty() || lampServer.arg("openNetwork") == "1") memset(next.wifiPassword, 0, sizeof(next.wifiPassword));
    else if (!wifiPass.isEmpty()) { memset(next.wifiPassword, 0, sizeof(next.wifiPassword)); strlcpy(next.wifiPassword, wifiPass.c_str(), sizeof(next.wifiPassword)); }
  }
  if (!adminPass.isEmpty()) { memset(next.adminPassword, 0, sizeof(next.adminPassword)); strlcpy(next.adminPassword, adminPass.c_str(), sizeof(next.adminPassword)); }
  Preferences prefs;
  if (!prefs.begin("coollamp", false)) { lampServer.send(500, "text/plain", "Could not open saved settings. Nothing changed."); return; }
  const bool saved = prefs.putBytes("settings", &next, sizeof(next)) == sizeof(next);
  prefs.end();
  if (!saved) { lampServer.send(500, "text/plain", "Settings could not be saved. Please retry."); return; }
  lampServer.send(200, "text/plain", "Saved. Restarting… If needed, hold the knob for three seconds to reopen setup. On home Wi-Fi, use http://" + lampHost + ".local/");
  restartAt = millis() + 1200;
}

void failLampUpdate(const String& message)
{
  if (Update.isRunning()) Update.abort();
  otaAccepted = false; otaActive = false; otaComplete = false; otaMessage = message;
}

void receiveLampUpdate()
{
  HTTPUpload& upload = lampServer.upload();
  if (upload.status == UPLOAD_FILE_START) {
    otaComplete = false; otaAccepted = false; otaMessage = "Update did not finish.";
    imagePrefixUsed = 0; imageValidated = false;
    if (!lampServer.authenticate("lamp", lampSettings.adminPassword) || lampServer.header("X-Lamp-Token") != lampToken) {
      otaMessage = "Not authorized. Refresh the setup page and sign in."; return;
    }
    otaAccepted = true; otaActive = true; otaLastActivity = millis();
  } else if (upload.status == UPLOAD_FILE_WRITE && otaAccepted) {
    otaLastActivity = millis();
    size_t offset = 0;
    if (!imageValidated) {
      const size_t needed = IMAGE_PREFIX_SIZE - imagePrefixUsed;
      const size_t take = upload.currentSize < needed ? upload.currentSize : needed;
      memcpy(imagePrefix + imagePrefixUsed, upload.buf, take);
      imagePrefixUsed += take; offset += take;
      if (imagePrefixUsed < IMAGE_PREFIX_SIZE) return;
      esp_image_header_t header; esp_app_desc_t app;
      memcpy(&header, imagePrefix, sizeof(header));
      memcpy(&app, imagePrefix + sizeof(header) + sizeof(esp_image_segment_header_t), sizeof(app));
      if (header.magic != ESP_IMAGE_HEADER_MAGIC || header.chip_id != CONFIG_IDF_FIRMWARE_CHIP_ID || app.magic_word != ESP_APP_DESC_MAGIC_WORD) {
        failLampUpdate("Choose an ESP32-C3 application .ino.bin file, not a bootloader or merged image."); return;
      }
      if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH)) { failLampUpdate("Cannot start update: " + String(Update.errorString())); return; }
      imageValidated = true;
      if (Update.write(imagePrefix, IMAGE_PREFIX_SIZE) != IMAGE_PREFIX_SIZE) { failLampUpdate("Could not write firmware header."); return; }
    }
    if (offset < upload.currentSize && Update.write(upload.buf + offset, upload.currentSize - offset) != upload.currentSize - offset) {
      failLampUpdate("Firmware write failed: " + String(Update.errorString()));
    }
  } else if (upload.status == UPLOAD_FILE_END && otaAccepted) {
    if (!imageValidated || !Update.end(true)) { failLampUpdate("Firmware verification failed. Existing firmware remains selected."); return; }
    otaComplete = true; otaActive = false; otaMessage = "Firmware verified. Restarting…";
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    failLampUpdate("Upload interrupted. Existing firmware remains selected.");
  }
}

void beginLampNetwork()
{
  const uint64_t mac = ESP.getEfuseMac();
  char suffix[7]; snprintf(suffix, sizeof(suffix), "%02X%02X%02X", static_cast<uint8_t>(mac >> 24), static_cast<uint8_t>(mac >> 32), static_cast<uint8_t>(mac >> 40));
  lampHost = String("coollamp-") + suffix; lampHost.toLowerCase();
  lampAPName = String("CoolLamp-") + suffix;
  char token[33]; snprintf(token, sizeof(token), "%08lx%08lx%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random(), (unsigned long)esp_random(), (unsigned long)esp_random());
  lampToken = token;
  const char* headers[] = {"X-Lamp-Token"};
  lampServer.collectHeaders(headers, 1);
  lampServer.on("/", HTTP_GET, []() {
    if (!authorizedLampRequest(false)) return;
    lampServer.sendHeader("X-Content-Type-Options", "nosniff");
    lampServer.sendHeader("X-Frame-Options", "DENY");
    lampServer.send_P(200, "text/html; charset=utf-8", LAMP_PAGE);
  });
  lampServer.on("/api/state", HTTP_GET, sendLampState);
  lampServer.on("/api/scan", HTTP_POST, startLampScan);
  lampServer.on("/api/scan", HTTP_GET, []() {
    if (!authorizedLampRequest(false)) return;
    lampServer.send(200, "application/json", scanResults);
  });
  lampServer.on("/api/config", HTTP_POST, saveLampConfiguration);
  lampServer.on("/api/preview", HTTP_POST, []() {
    if (!authorizedLampRequest(true)) return;
    uint32_t mode, brightness;
    if (!readNumber("mode", 1, MODE_MAX, mode) || !readNumber("brightness", 1, 255, brightness)) { lampServer.send(400, "text/plain", "Invalid effect or brightness."); return; }
    Mode = mode; Brightness = brightness; PowerOn = true;
    rotaryEncoder.setEncoderValue(Mode);
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    lampServer.send(200, "text/plain", "Preview applied. Save settings to keep it after restart.");
  });
  lampServer.on("/api/power", HTTP_POST, []() {
    if (!authorizedLampRequest(true)) return;
    uint32_t on;
    if (!readNumber("on", 0, 1, on)) { lampServer.send(400, "text/plain", "Invalid power value."); return; }
    PowerOn = on; FastLED.setBrightness(PowerOn ? Brightness : 0); FastLED.show();
    lampServer.send(200, "text/plain", PowerOn ? "Light on." : "Light off.");
  });
  lampServer.on("/update", HTTP_POST, []() {
    if (!authorizedLampRequest(true)) return;
    lampServer.send(otaComplete ? 200 : 400, "text/plain", otaMessage);
    if (otaComplete) restartAt = millis() + 1200;
  }, receiveLampUpdate);
  lampServer.onNotFound([]() { lampServer.send(404, "text/plain", "Not found."); });
  WiFi.persistent(false);
  WiFi.setHostname(lampHost.c_str());
  if (lampSettings.ssid[0]) {
    WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
    WiFi.begin(lampSettings.ssid, lampSettings.wifiPassword);
  } else WiFi.mode(WIFI_OFF);
}

void toggleLampSetup()
{
  if (setupAP) {
    WiFi.softAPdisconnect(true); setupAP = false;
    WiFi.mode(lampSettings.ssid[0] ? WIFI_STA : WIFI_OFF);
  } else {
    WiFi.mode(lampSettings.ssid[0] ? WIFI_AP_STA : WIFI_AP);
    setupAP = WiFi.softAP(lampAPName.c_str(), lampSettings.adminPassword);
    lastAPStartOK = setupAP;
    apLastActivity = millis();
  }
  setupPulseStart = millis(); setupPulseActive = true;
}

bool pollLampButton()
{
  static bool raw = HIGH, stable = HIGH, held = false;
  static uint32_t changedAt = 0, pressedAt = 0;
  const uint32_t now = millis();
  const bool reading = digitalRead(DI_ENCODER_SW);
  if (reading != raw) { raw = reading; changedAt = now; }
  if (raw != stable && now - changedAt >= 30) {
    stable = raw;
    if (stable == LOW) { pressedAt = now; held = false; }
    else if (!held) {
      if (now - pressedAt >= 3000) { toggleLampSetup(); held = true; }
      else return true;
    }
  }
  if (stable == LOW && !held && now - pressedAt >= 3000) { held = true; toggleLampSetup(); }
  return false;
}

bool lampSetupPulse()
{
  if (setupPulseActive && millis() - setupPulseStart >= 1000) setupPulseActive = false;
  return setupPulseActive;
}

bool lampIsUpdating() { return otaActive; }

// USB-only recovery/diagnostics. No credentials are included in replies.
void serviceLampUSB()
{
  static bool statusPending = false;
  while (Serial.available()) {
    const char command = Serial.read();
    if (command == '?') statusPending = true;
    if (command == 'a' && !otaActive) { toggleLampSetup(); statusPending = true; }
  }
  if (statusPending) {
    String status = "reset=" + String(static_cast<int>(esp_reset_reason())) + " uptime=" + String(millis());
    status += " ap=" + String(setupAP) + " apOK=" + String(lastAPStartOK) + " mode=" + String(static_cast<int>(WiFi.getMode()));
    status += " ssid=" + lampAPName + " ip=" + WiFi.softAPIP().toString() + " heap=" + String(ESP.getFreeHeap()) + "\n";
    if (Serial.availableForWrite() >= static_cast<int>(status.length())) {
      Serial.write(reinterpret_cast<const uint8_t*>(status.c_str()), status.length());
      statusPending = false;
    }
  }
}

void serviceLampNetwork()
{
  serviceLampUSB();
  serviceLampScan();
  const uint32_t now = millis();
  if (restartAt && static_cast<int32_t>(now - restartAt) >= 0) ESP.restart();
  if (otaActive && now - otaLastActivity > 30000) failLampUpdate("Upload timed out.");
  if (setupAP && !otaActive && now - apLastActivity > 600000) {
    WiFi.softAPdisconnect(true); setupAP = false;
    WiFi.mode(lampSettings.ssid[0] ? WIFI_STA : WIFI_OFF);
  }
  const bool connected = WiFi.status() == WL_CONNECTED;
  if ((setupAP || connected) && !serverStarted) { lampServer.begin(); serverStarted = true; }
  if (!setupAP && !connected && serverStarted) { lampServer.stop(); serverStarted = false; }
  if (connected && !mdnsStarted) { mdnsStarted = MDNS.begin(lampHost.c_str()); if (mdnsStarted) MDNS.addService("http", "tcp", 80); }
  if (!connected && mdnsStarted) { MDNS.end(); mdnsStarted = false; }
  if (serverStarted) lampServer.handleClient();
}
