#include "LampBluetooth.h"
#include "LampControl.h"
#include "LampConfig.h"
#include "LampUpdate.h"

#if COOL_LAMP_BLE
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLESecurity.h>
#include <host/ble_store.h>
#if !defined(CONFIG_NIMBLE_ENABLED)
#error CoolLamp Bluetooth requires the NimBLE backend shipped with ESP32-C3 Arduino core 3.3.11.
#endif
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

namespace {
constexpr char SERVICE[] = "7b610001-6e2b-4f3d-9a71-28e45c001001";
constexpr char COMMAND[] = "7b610002-6e2b-4f3d-9a71-28e45c001001";
constexpr char STATE[]   = "7b610003-6e2b-4f3d-9a71-28e45c001001";
constexpr char FIRMWARE[] = "7b610004-6e2b-4f3d-9a71-28e45c001001";
constexpr char EFFECT[] = "7b610005-6e2b-4f3d-9a71-28e45c001001";
constexpr char IDENTITY[] = "7b610006-6e2b-4f3d-9a71-28e45c001001";
// Catalog negotiated per connection: 0 = baseline, 37 = legacy app, 38 = outward droplets.
std::atomic<uint8_t> extendedControls{0};
BLECharacteristic* catalogCharacteristic = nullptr;
BLECharacteristic* effectCharacteristic = nullptr;
uint8_t lastEffect[8] = {};
constexpr uint16_t NO_CONNECTION = 0xffff;
struct Command { uint32_t generation; uint8_t length; uint8_t bytes[10]; };
QueueHandle_t commands = nullptr;
BLEServer* server = nullptr;
BLECharacteristic* stateCharacteristic = nullptr;
BLECharacteristic* firmwareCharacteristic = nullptr;
uint8_t lastFirmware[20] = {};
std::atomic<uint16_t> connection{NO_CONNECTION};
std::atomic<uint32_t> generation{0};
std::atomic<bool> secure{false}, knownPeer{false}, pairing{false};
uint32_t pairingStarted = 0;
std::atomic<bool> advertisingDirty{false};
uint32_t revision = 0;
uint8_t lastState[16] = {};

int bondedPeers(ble_addr_t* peers)
{
  int count = 0;
  if (ble_store_util_bonded_peers(peers, &count, CONFIG_BT_NIMBLE_MAX_BONDS) != 0) return 0;
  return count;
}

bool bonded(const ble_addr_t& address)
{
  ble_addr_t peers[CONFIG_BT_NIMBLE_MAX_BONDS];
  const int count = bondedPeers(peers);
  for (int i = 0; i < count; ++i) if (ble_addr_cmp(&peers[i], &address) == 0) return true;
  return false;
}

class Connections final : public BLEServerCallbacks {
  void onConnect(BLEServer* s, ble_gap_conn_desc* event) override {
    uint16_t empty = NO_CONNECTION;
    if (!connection.compare_exchange_strong(empty, event->conn_handle)) {
      s->disconnect(event->conn_handle);
      return;
    }
    secure = false;
    knownPeer = bonded(event->peer_id_addr);
    ++generation;
    extendedControls = false;
    if (!knownPeer && !pairing) s->disconnect(event->conn_handle);
    // Reading the protected state characteristic starts OS-managed pairing.
  }
  void onDisconnect(BLEServer*, ble_gap_conn_desc* event) override {
    if (connection != event->conn_handle) return;
    secure = false;
    knownPeer = false;
    ++generation;
    extendedControls = false;
    connection = NO_CONNECTION;
    advertisingDirty = true;
  }
};

class Security final : public BLESecurityCallbacks {
  bool onSecurityRequest() override { return knownPeer || pairing; }
  uint32_t onPassKeyRequest() override { return 0; }
  void onPassKeyNotify(uint32_t) override {}
  bool onConfirmPIN(uint32_t) override { return false; }
  void onAuthenticationComplete(ble_gap_conn_desc* result) override {
    if (connection != result->conn_handle) return;
    secure = result->sec_state.encrypted && (knownPeer || pairing);
    if (!secure && connection != NO_CONNECTION) {
      if (!knownPeer) ble_store_util_delete_peer(&result->peer_id_addr);
      server->disconnect(connection);
    }
  }
};

class StateReads final : public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic* characteristic, ble_gap_conn_desc*) override {
    // A newly connected older app may read before the loop has refreshed the
    // previous client's extended catalog. Always provide its initial baseline.
    if (extendedControls) return;
    const String cached = characteristic->getValue();
    if (cached.length() != 16) return;
    uint8_t value[16]; memcpy(value, cached.c_str(), sizeof(value));
    if (value[3] > 29) value[3] = 29;
    value[6] = 29;
    characteristic->setValue(value, sizeof(value));
  }
};

class Writes final : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic, ble_gap_conn_desc* event) override {
    if (!secure || connection != event->conn_handle) return;
    const String value = characteristic->getValue();
    // Protocol frames fit the minimum BLE MTU. No long/prepared writes.
    const size_t expected = value.length() >= 3 ? (uint8_t(value[2]) == 6 ? 7 : uint8_t(value[2]) == 11 ? 10 : 4) : 4;
    if (value.length() != expected) {
      server->disconnect(event->conn_handle);
      return;
    }
    Command command{};
    command.generation = generation;
    command.length = value.length();
    memcpy(command.bytes, value.c_str(), command.length);
    // Never change FastLED, Preferences, or Wi-Fi state on the Bluetooth task.
    if (xQueueSend(commands, &command, 0) != pdTRUE) server->disconnect(event->conn_handle);
  }
};

Connections connectionCallbacks;
Security securityCallbacks;
Writes writeCallbacks;
StateReads stateReadCallbacks;

void updateAdvertising()
{
  auto* advertising = BLEDevice::getAdvertising();
  advertising->stop();
  BLEAdvertisementData data;
  BLEAdvertisementData response;
  data.setFlags(0x06);
  // Outside enrollment, omit the service and name so Find my lamp only lists
  // lamps deliberately put into pairing mode. Saved phones connect by device ID.
  if (pairing) {
    data.setCompleteServices(BLEUUID(SERVICE));
    response.setName("CoolLamp");
  }
  advertising->setAdvertisementData(data);
  advertising->setScanResponseData(response);
  ble_addr_t peers[CONFIG_BT_NIMBLE_MAX_BONDS];
  if (connection == NO_CONNECTION && (pairing || bondedPeers(peers) > 0)) advertising->start();
}

void publish(uint8_t id, uint8_t result, bool acknowledge)
{
  const uint8_t visibleCount = extendedControls ? extendedControls.load() : 29;
  uint8_t effect[8]; getLampEffectPacket(effect);
  if (effect[1] > visibleCount) effect[1] = 29;
  if (memcmp(effect,lastEffect,sizeof(effect))) {
    memcpy(lastEffect,effect,sizeof(effect)); effectCharacteristic->setValue(effect,sizeof(effect));
    if (secure && extendedControls) effectCharacteristic->notify();
  }
  const auto state = getLampControlState();
  const auto color = getLampColor(state.mode);
  const uint8_t visibleMode = state.mode > visibleCount ? 29 : state.mode;
  const bool changed = lastState[6] != visibleCount || lastState[3] != visibleMode || lastState[4] != state.brightness || lastState[5] != state.power ||
    lastState[12] != color.enabled || lastState[13] != color.r || lastState[14] != color.g || lastState[15] != color.b;
  if (!changed && !acknowledge && lastState[0]) return;
  if (changed) ++revision;
  uint8_t value[16] = {LAMP_PROTOCOL_VERSION, id, result, visibleMode, state.brightness,
    static_cast<uint8_t>(state.power), visibleCount, 63};
  value[12] = color.enabled; value[13] = color.r; value[14] = color.g; value[15] = color.b;
  for (int i = 0; i < 4; ++i) value[8 + i] = revision >> (8 * i);
  memcpy(lastState, value, sizeof(value));
  stateCharacteristic->setValue(value, sizeof(value));
  if (secure && (changed || acknowledge)) stateCharacteristic->notify();
}
} // namespace

void beginLampBluetooth(const String& name)
{
  commands = xQueueCreate(8, sizeof(Command));
  if (!commands) return;
  BLEDevice::init(name);
  BLEDevice::setSecurityCallbacks(&securityCallbacks);
  BLESecurity::setAuthenticationMode(ESP_LE_AUTH_REQ_SC_BOND);
  BLESecurity::setCapability(ESP_IO_CAP_NONE);
  BLESecurity::setKeySize(16);
  BLESecurity::setInitEncryptionKey();
  BLESecurity::setRespEncryptionKey();
  server = BLEDevice::createServer();
  server->setCallbacks(&connectionCallbacks);
  server->advertiseOnDisconnect(false);
  BLEService* service = server->createService(SERVICE);
  auto* command = service->createCharacteristic(COMMAND, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_ENC);
  auto* identity = service->createCharacteristic(IDENTITY, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_READ_ENC);
  identity->setValue(lampIdentity().c_str());
  catalogCharacteristic = service->createCharacteristic("7b610007-6e2b-4f3d-9a71-28e45c001001", BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_READ_ENC);
  catalogCharacteristic->setValue("{}");
  command->setCallbacks(&writeCallbacks);
  stateCharacteristic = service->createCharacteristic(STATE, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_READ_ENC | BLECharacteristic::PROPERTY_NOTIFY);
  stateCharacteristic->setCallbacks(&stateReadCallbacks);
  firmwareCharacteristic = service->createCharacteristic(FIRMWARE, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_READ_ENC | BLECharacteristic::PROPERTY_NOTIFY);
  effectCharacteristic = service->createCharacteristic(EFFECT, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_READ_ENC | BLECharacteristic::PROPERTY_NOTIFY);
  getLampEffectPacket(lastEffect); effectCharacteristic->setValue(lastEffect, sizeof(lastEffect));
  getLampUpdatePacket(lastFirmware);
  firmwareCharacteristic->setValue(lastFirmware, sizeof(lastFirmware));
  // NimBLE creates the notification subscription descriptor automatically.
  publish(0, 0, false);
  service->start();
  updateAdvertising();
}

void setLampPairingWindow(bool open)
{
  pairing = open && server;
  pairingStarted = millis();
  // Make room for a new phone if the owner opens pairing while one is connected.
  if (pairing && connection != NO_CONNECTION) {
    secure = false;
    ++generation;
    extendedControls = false;
    server->disconnect(connection);
  }
  advertisingDirty = true;
}

bool lampPairingOpen() { return pairing; }
bool lampBluetoothReady() { return BLEDevice::getInitialized() && server; }

void forgetLampPhones()
{
  if (!pairing || !server) return;
  secure = false;
  knownPeer = false;
  ++generation;
  if (connection != NO_CONNECTION) server->disconnect(connection);
  ble_addr_t peers[CONFIG_BT_NIMBLE_MAX_BONDS];
  const int count = bondedPeers(peers);
  for (int i = 0; i < count; ++i) ble_store_util_delete_peer(&peers[i]);
  advertisingDirty = true;
}

void serviceLampBluetooth()
{
  if (!server) return;
  ble_gap_conn_desc peer{};
  const bool paired = pairing && secure && connection != NO_CONNECTION &&
    ble_gap_conn_find(connection, &peer) == 0 && peer.sec_state.bonded;
  if (paired || (pairing && millis() - pairingStarted >= 120000)) {
    pairing = false;
    advertisingDirty = true;
  }
  if (advertisingDirty.exchange(false)) updateAdvertising();
  Command command{};
  // Bound work per frame; app waits for each application-level acknowledgment.
  if (xQueueReceive(commands, &command, 0) == pdTRUE && secure && command.generation == generation) {
    const uint8_t version = command.bytes[0], id = command.bytes[1], op = command.bytes[2], value = command.bytes[3];
    auto state = getLampControlState();
    uint8_t result = 0;
    if (version != LAMP_PROTOCOL_VERSION || id == 0) result = 1;
    else if (lampIsUpdating() && op != 5 && op != 12) result = 3;
    else {
      switch (op) {
        case 1: if (value > 1) result = 2; else setLampControl(state.mode, state.brightness, value); break;
        case 2: if (!setLampControl(state.mode, value, state.power)) result = 2; break;
        case 3: if (!setLampControl(value, state.brightness, state.power)) result = 2; break;
        case 4: if (value) result = 2; else if (!saveLampDefaults()) result = 4; break;
        case 5: if (value) result = 2; break;
        case 6: if (!setLampColor(value, command.bytes[4], command.bytes[5], command.bytes[6])) result = 2; break;
        case 7: if (!resetLampColor(value)) result = 2; break;
        case 11: if (!extendedControls || !setLampEffectOptions(value, {command.bytes[4],command.bytes[5],command.bytes[6],command.bytes[7],command.bytes[8],command.bytes[9]})) result=2; break;
        case 12: if (value == 1) extendedControls=37; else if (value == 2) extendedControls=38; else if (value == 3) extendedControls=LAMP_EFFECT_COUNT; else result=2; break;
        case 13: if (value < 1 || value > LAMP_EFFECT_COUNT) result=2; else catalogCharacteristic->setValue(lampEffectCatalogEntry(value).c_str()); break;
        case 8: if (value) result = 2; else if (!requestLampUpdateCheck()) result = 3; break;
        case 9: if (value) result = 2; else if (!requestLampUpdateInstall()) result = 3; break;
        case 10: if (value > 1) result = 2; else if (!setLampAutoUpdate(value)) result = 4; break;
        default: result = 2;
      }
    }
    publish(id, result, true);
  } else {
    // Detect changes from the knob and HTTP without making those paths know BLE.
    publish(0, 0, false);
  }
  uint8_t firmware[20]; getLampUpdatePacket(firmware);
  if (memcmp(firmware, lastFirmware, sizeof(firmware))) {
    memcpy(lastFirmware, firmware, sizeof(firmware));
    firmwareCharacteristic->setValue(firmware, sizeof(firmware));
    if (secure) firmwareCharacteristic->notify();
  }
}
#else
void beginLampBluetooth(const String&) {}
void serviceLampBluetooth() {}
void setLampPairingWindow(bool) {}
bool lampPairingOpen() { return false; }
bool lampBluetoothReady() { return false; }
void forgetLampPhones() {}
#endif
