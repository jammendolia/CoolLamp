#pragma once

#include <Arduino.h>
#include "UpdateManifest.h"

class LampJsonSink;

// Durable, user-started Internet update ownership. A submitted tuple is
// persisted before the HTTP request is acknowledged; after that the lamp, not
// the phone, owns manifest verification, download, commit and reconciliation.
namespace LampUpdateJob {

constexpr size_t JobIdCapacity = 32;
constexpr size_t ParticipantIdCapacity = 12;
constexpr uint32_t ProgressGranularity = 64 * 1024;

enum Route : uint8_t {
  NoRoute,
  Internet,
  Bridge,
};

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

struct Submission {
  const char *jobId,*targetId,*ownerId,*version,*sha256;
  uint32_t size;
  uint8_t route;
};

// Receiver bytes are not resumable across reboot in this firmware. Preserve
// the last confirmed offset and surface a terminal needs-attention receipt.
constexpr uint8_t Interrupted = 9;

struct Snapshot {
  FirmwareManifest target{};
  uint32_t revision = 0;
  char jobId[JobIdCapacity + 1]{};
  uint8_t state = None;
  uint8_t error = 0;
  bool storageReady = false;
  uint32_t confirmedBytes = 0;
  char ownerId[ParticipantIdCapacity + 1]{};
  uint8_t route = NoRoute;
};

static_assert(sizeof(Snapshot) == 104, "Update job snapshot layout changed");

void begin();
SubmitResult submitBound(const Submission& submission);
SubmitResult submit(const char* jobId,const char* version,const char* sha256);
SubmitResult submitExact(const char* jobId,const char* targetId,const char* ownerId,
                         uint8_t route,const char* version,const char* sha256,uint32_t size);
bool advance(uint8_t state, uint8_t error = 0, const FirmwareManifest* artifact = nullptr,
             uint32_t confirmedBytes = 0);
inline bool markChecking(){return advance(Checking);}
inline bool markDownloading(const FirmwareManifest& artifact){return advance(Downloading,0,&artifact);}
inline bool noteProgress(uint32_t confirmedBytes){return advance(Downloading,0,nullptr,confirmedBytes);}
inline bool markCommitting(){return advance(Committing);}
inline bool markFailed(uint8_t error){return advance(Failed,error);}
inline bool markUncertain(){return advance(Uncertain);}
bool matches(const Snapshot& job, const FirmwareManifest& artifact);
inline bool reconcileRunning(const FirmwareManifest& running){return advance(UINT8_MAX,0,&running);}
Snapshot capture();
void appendJson(LampJsonSink& out,const Snapshot& snapshot,bool contractV2=true);

} // namespace LampUpdateJob
