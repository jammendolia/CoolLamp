#pragma once

#include <stddef.h>
#include <stdint.h>

namespace BridgeUpdateJob {

constexpr uint32_t RecordMagic = 0x324a5542; // BUJ2
constexpr uint16_t RecordSchema = 2;
constexpr uint32_t MaximumImageSize = 2031616;
constexpr uint32_t MaximumRevision = 0xfffffffeu;
constexpr size_t JsonCapacity = 768;

enum class Route : uint8_t { TargetedBridge = 1 };
enum class Phase : uint8_t {
  Empty = 0,
  Accepted,
  Offering,
  Transferring,
  AwaitingVerification,
  Succeeded,
  Cancelled,
  Failed,
};
enum class Error : uint8_t {
  None = 0,
  Invalid,
  OwnerMismatch,
  Conflict,
  Busy,
  Storage,
  Radio,
  Timeout,
  Interrupted,
  ReceiverRejected,
  Read,
  Verification,
  Cancelled,
};
enum class LoadResult : uint8_t { Missing, Loaded, Fault };
enum class Result : uint8_t {
  Accepted,
  Existing,
  Updated,
  Cleared,
  Invalid,
  OwnerMismatch,
  Conflict,
  Busy,
  NotFound,
  StaleRevision,
  TooLate,
  StorageFault,
  RevisionExhausted,
};

struct Artifact {
  uint32_t size = 0;
  uint16_t version[3]{};
  uint16_t reserved = 0;
  uint8_t sha256[32]{};
};

// This tuple is immutable for the lifetime of a job. ownerId makes route
// selection deterministic: a request addressed to any other bridge is rejected.
struct Request {
  char jobId[33]{};
  char targetId[13]{};
  char ownerId[13]{};
  Route route = Route::TargetedBridge;
  Artifact artifact{};
};

// Installation is authoritative only after an observer has identified the
// exact artifact, seen it booted outside update mode, and reached its normal
// control surface. This deliberately cannot be satisfied by echoing the
// request artifact alone.
struct InstalledProof {
  Artifact artifact{};
  char targetId[13]{};
  uint64_t bootSession = 0;
  bool installed = false;
  bool updateInactive = false;
  bool controlResponsive = false;
  uint8_t reserved = 0;
};

struct Record {
  uint32_t magic = RecordMagic;
  uint16_t schema = RecordSchema;
  uint16_t bytes = sizeof(Record);
  uint32_t revision = 0;
  Request request{};
  Phase phase = Phase::Empty;
  Error error = Error::None;
  uint16_t reserved = 0;
  uint32_t confirmedBytes = 0;
  uint32_t totalBytes = 0;
  uint32_t createdAt = 0;
  uint32_t updatedAt = 0;
  uint32_t terminalAt = 0;
  uint32_t checksum = 0;
};
static_assert(sizeof(Artifact) == 44, "Persisted artifact layout changed");
static_assert(sizeof(Request) == 104, "Persisted immutable tuple layout changed");
static_assert(sizeof(Record) == 144, "Persisted update-job layout changed");

struct Store {
  void* context = nullptr;
  LoadResult (*load)(void*, Record&) = nullptr;
  bool (*save)(void*, const Record&) = nullptr;
  bool (*clear)(void*) = nullptr;
};

class Ledger {
 public:
  bool begin(const char* bridgeId, Store, uint32_t now);
  bool ready() const { return ready_; }
  bool storageFault() const { return storageFault_; }
  const Record& record() const { return record_; }
  bool active() const;
  bool terminal() const;
  bool owns(const char* jobId) const;
  bool wantsDonation() const;
  const uint8_t* targetMac() const { return targetMac_; }
  // Canonical bounded projection consumed by the app/HTTP adapter. Returns
  // zero rather than truncating when the caller's buffer is too small.
  size_t writeJson(char* output, size_t capacity) const;

  Result start(const Request&, uint32_t now);
  Result beginOffering(const char* jobId, uint32_t expectedRevision, uint32_t now);
  Result confirmProgress(const char* jobId, uint32_t confirmedBytes, uint32_t now);
  Result awaitingVerification(const char* jobId, uint32_t now);
  Result fail(const char* jobId, Error, uint32_t now);
  Result confirmInstalled(const char* jobId, const InstalledProof&, uint32_t now);
  Result cancel(const char* jobId, uint32_t now);
  Result acknowledgeTerminal(const char* jobId, uint32_t expectedRevision);

  static bool validRequest(const Request&);
  static bool sameTuple(const Request&, const Request&);
  static bool sameArtifact(const Artifact&, const Artifact&);
  static bool terminalPhase(Phase);
  static const char* phaseName(Phase);
  static const char* errorName(Error);
  static const char* errorMessage(Error);

 private:
  Result mutate(Phase, Error, uint32_t confirmedBytes, uint32_t now);
  bool save(const Record&);
  bool loadValid(const Record&) const;
  static uint32_t checksum(const Record&);
  static bool canonicalId(const char*, size_t);
  static bool parseTarget(const char*, uint8_t out[6]);

  Store store_{};
  Record record_{};
  char bridgeId_[13]{};
  uint8_t targetMac_[6]{};
  bool ready_ = false;
  bool storageFault_ = false;
};

} // namespace BridgeUpdateJob
