#pragma once
#include <stddef.h>
#include <stdint.h>

// All functions except the private SDK event callback belong to the main loop.
// Reads never scan, connect, change the radio mode, or write settings.
namespace BridgeWifiScan {
constexpr size_t MaxNetworks = 20;
constexpr size_t JsonCapacity = 4096;
constexpr uint32_t DeadlineMs = 15000;
constexpr uint32_t RetryIntervalMs = 10000;
enum class Phase : uint8_t { Idle, Queued, Scanning, Ready, Error };
enum class RequestResult : uint8_t { Accepted, Busy, RateLimited, Unavailable };
struct Network {
  char ssid[33]{};
  int8_t rssi = -127;
  uint8_t channel = 0;
  bool secure = false;
  bool supported = false;
  // Used only to distinguish the same SSID advertised with different security.
  uint8_t authMode = 0;
};
struct Snapshot {
  Phase phase = Phase::Idle;
  uint32_t generation = 0;
  Network networks[MaxNetworks]{};
  uint8_t count = 0;
  bool truncated = false;
  const char* error = "";
};
bool begin();
RequestResult request(uint32_t now);
void service(uint32_t now, bool blocked);
void cancel(uint32_t now);
// Radio lease includes cancellation drain and an uncertain failed stop. The
// latter remains quarantined until restart, even though the public phase is Error.
bool scanning();
// Includes an accepted queued request as well as its physical radio lease. Use
// this to defer new conflicting work, but not as service()'s own blocked input.
bool working();
const Snapshot& snapshot();
// Returns bytes excluding NUL, or zero on insufficient capacity; output is then
// empty. JsonCapacity accommodates the complete worst-case retained snapshot.
size_t writeJson(char* output, size_t capacity);
}
