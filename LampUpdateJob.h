#pragma once

#include <Arduino.h>
#include "UpdateManifest.h"

class LampJsonSink;

// Durable, user-started Internet update ownership. A submitted tuple is
// persisted before the HTTP request is acknowledged; after that the lamp, not
// the phone, owns manifest verification, download, commit and reconciliation.
namespace LampUpdateJob {

constexpr size_t JobIdCapacity = 32;

enum State : uint8_t {
  None,
  Accepted,
  Checking,
  Downloading,
  Committing,
  Confirmed,
  Failed,
  Uncertain,
};

enum SubmitResult : uint8_t {
  Submitted,
  Duplicate,
  Conflict,
  Invalid,
  StorageUnavailable,
};

struct Snapshot {
  FirmwareManifest target{};
  uint32_t revision = 0;
  char jobId[JobIdCapacity + 1]{};
  uint8_t state = None;
  uint8_t error = 0;
  bool storageReady = false;
};

static_assert(sizeof(Snapshot) == 84, "Update job snapshot layout changed");

void begin();
SubmitResult submit(const char* jobId, const char* version, const char* sha256);
bool advance(uint8_t state, uint8_t error = 0, const FirmwareManifest* artifact = nullptr);
inline bool markChecking(){return advance(Checking);}
inline bool markDownloading(const FirmwareManifest& artifact){return advance(Downloading,0,&artifact);}
inline bool markCommitting(){return advance(Committing);}
inline bool markFailed(uint8_t error){return advance(Failed,error);}
inline bool markUncertain(){return advance(Uncertain);}
bool matches(const Snapshot& job, const FirmwareManifest& artifact);
bool reconcileRunning(const FirmwareManifest& running);
Snapshot capture();
void appendJson(LampJsonSink& out, const Snapshot& snapshot);

} // namespace LampUpdateJob
