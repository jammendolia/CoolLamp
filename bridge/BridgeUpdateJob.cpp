#include "BridgeUpdateJob.h"

#include <stdio.h>
#include <string.h>

namespace BridgeUpdateJob {
namespace {
bool nonzero(const uint8_t* bytes, size_t count) {
  uint8_t any = 0;
  for (size_t i = 0; i < count; ++i) any |= bytes[i];
  return any != 0;
}
uint8_t nibble(char value) {
  return value >= '0' && value <= '9' ? uint8_t(value - '0')
       : value >= 'a' && value <= 'f' ? uint8_t(value - 'a' + 10)
                                      : 0xff;
}
}

uint32_t Ledger::checksum(const Record& input) {
  Record copy = input;
  copy.checksum = 0;
  uint32_t value = ~uint32_t(0);
  const auto* bytes = reinterpret_cast<const uint8_t*>(&copy);
  for (size_t remaining = sizeof(copy); remaining--; ++bytes) {
    value ^= *bytes;
    for (unsigned bit = 0; bit < 8; ++bit)
      value = (value >> 1) ^ (0xedb88320u & uint32_t(-int32_t(value & 1)));
  }
  return ~value;
}

bool Ledger::canonicalId(const char* value, size_t count) {
  if (!value || value[count]) return false;
  uint8_t any = 0, all = 0xff;
  for (size_t i = 0; i < count; ++i) {
    const uint8_t n = nibble(value[i]);
    if (n == 0xff) return false;
    any |= n;
    all &= n;
  }
  return any != 0 && all != 0x0f;
}

bool Ledger::parseTarget(const char* value, uint8_t out[6]) {
  if (!out || !canonicalId(value, 12)) return false;
  // Device identities are the station MAC bytes in reverse display order.
  for (size_t i = 0; i < 6; ++i) {
    const size_t at = 10 - i * 2;
    out[i] = uint8_t((nibble(value[at]) << 4) | nibble(value[at + 1]));
  }
  return !(out[0] & 1) && nonzero(out, 6);
}

bool Ledger::sameArtifact(const Artifact& left, const Artifact& right) {
  return left.version[0] == right.version[0] && left.version[1] == right.version[1] &&
         left.version[2] == right.version[2] && left.size == right.size &&
         left.reserved == right.reserved && !memcmp(left.sha256, right.sha256, sizeof(left.sha256));
}

bool Ledger::sameTuple(const Request& left, const Request& right) {
  return !strcmp(left.jobId, right.jobId) && !strcmp(left.targetId, right.targetId) &&
         !strcmp(left.ownerId, right.ownerId) && left.route == right.route &&
         sameArtifact(left.artifact, right.artifact);
}

bool Ledger::validRequest(const Request& request) {
  if (!canonicalId(request.jobId, 32) || !canonicalId(request.targetId, 12) ||
      !canonicalId(request.ownerId, 12) || request.route != Route::TargetedBridge)
    return false;
  // A targeted bridge job must have two distinct physical participants. An
  // owner/target alias could otherwise make a bridge receipt appear to prove
  // its own installation rather than the selected lamp's installation.
  if (!strcmp(request.targetId, request.ownerId)) return false;
  uint8_t target[6]{};
  if (!parseTarget(request.targetId, target)) return false;
  if ((!request.artifact.version[0] && !request.artifact.version[1] &&
       !request.artifact.version[2]) ||
      request.artifact.size < 288 || request.artifact.size > MaximumImageSize ||
      request.artifact.reserved != 0 || !nonzero(request.artifact.sha256, sizeof(request.artifact.sha256)))
    return false;
  return true;
}

bool Ledger::terminalPhase(Phase phase) {
  return phase == Phase::Succeeded || phase == Phase::Cancelled || phase == Phase::Failed;
}

bool Ledger::loadValid(const Record& value) const {
  if (value.magic != RecordMagic || value.schema != RecordSchema ||
      value.bytes != sizeof(Record) || value.checksum != checksum(value) ||
      value.phase > Phase::Failed || value.error > Error::Cancelled ||
      value.reserved != 0 || value.revision > MaximumRevision)
    return false;
  if (value.phase == Phase::Empty) {
    return value.revision == 0 && value.error == Error::None &&
           !nonzero(reinterpret_cast<const uint8_t*>(value.request.jobId),
                    sizeof(value.request.jobId)) &&
           !nonzero(reinterpret_cast<const uint8_t*>(value.request.targetId),
                    sizeof(value.request.targetId)) &&
           !nonzero(reinterpret_cast<const uint8_t*>(value.request.ownerId),
                    sizeof(value.request.ownerId)) &&
           value.request.route == Route::TargetedBridge &&
           value.request.artifact.size == 0 &&
           !value.request.artifact.version[0] && !value.request.artifact.version[1] &&
           !value.request.artifact.version[2] && value.request.artifact.reserved == 0 &&
           !nonzero(value.request.artifact.sha256,
                    sizeof(value.request.artifact.sha256)) &&
           value.confirmedBytes == 0 &&
           value.totalBytes == 0 && value.createdAt == 0 && value.updatedAt == 0 &&
           value.terminalAt == 0;
  }
  if (!validRequest(value.request) || strcmp(value.request.ownerId, bridgeId_) ||
      value.revision == 0 || value.totalBytes != value.request.artifact.size ||
      value.confirmedBytes > value.totalBytes)
    return false;

  // Millisecond values are diagnostic only: zero is valid, and values from
  // separate boots must never be ordered. Only a nonterminal terminal marker
  // is semantically impossible.
  if (!terminalPhase(value.phase) && value.terminalAt != 0) return false;
  if (value.phase == Phase::Failed) {
    if (value.error == Error::None || value.error == Error::Cancelled) return false;
  } else if (value.phase == Phase::Cancelled) {
    if (value.error != Error::Cancelled) return false;
  } else if (value.error != Error::None) {
    return false;
  }
  if ((value.phase == Phase::Accepted || value.phase == Phase::Offering) &&
      value.confirmedBytes != 0)
    return false;
  if ((value.phase == Phase::AwaitingVerification || value.phase == Phase::Succeeded) &&
      value.confirmedBytes != value.totalBytes)
    return false;
  return true;
}

bool Ledger::save(const Record& input) {
  if (!store_.save) return false;
  Record value = input;
  value.checksum = checksum(value);
  if (!store_.save(store_.context, value)) {
    ready_ = false;
    storageFault_ = true;
    return false;
  }
  record_ = value;
  parseTarget(record_.request.targetId, targetMac_);
  return true;
}

bool Ledger::begin(const char* bridgeId, Store store, uint32_t now) {
  ready_ = false;
  storageFault_ = false;
  store_ = store;
  record_ = {};
  memset(bridgeId_, 0, sizeof(bridgeId_));
  memset(targetMac_, 0, sizeof(targetMac_));
  if (!canonicalId(bridgeId, 12) || !store_.load || !store_.save || !store_.clear)
    return false;
  memcpy(bridgeId_, bridgeId, 13);
  Record loaded{};
  const LoadResult result = store_.load(store_.context, loaded);
  if (result == LoadResult::Fault || (result == LoadResult::Loaded && !loadValid(loaded))) {
    storageFault_ = true;
    return false;
  }
  if (result == LoadResult::Missing) {
    ready_ = true;
    return true;
  }
  record_ = loaded;
  parseTarget(record_.request.targetId, targetMac_);
  ready_ = true;
  // A partial radio session cannot resume safely after bridge boot. Once every
  // byte was receiver-confirmed, however, transfer must never be replayed or
  // relabelled failed merely because the bridge restarted before observing the
  // target's boot proof. Persist the verification boundary and wait for exact
  // target-bound proof.
  if (record_.phase == Phase::Transferring &&
      record_.confirmedBytes == record_.totalBytes)
    return mutate(Phase::AwaitingVerification, Error::None,
                  record_.confirmedBytes, now) == Result::Updated;
  // Persisted millis values are diagnostic only and are never compared across
  // boots.
  if (record_.phase == Phase::Offering || record_.phase == Phase::Transferring)
    return mutate(Phase::Failed, Error::Interrupted, record_.confirmedBytes,
                  now) == Result::Updated;
  return true;
}

bool Ledger::active() const {
  return ready_ && record_.phase != Phase::Empty && !terminalPhase(record_.phase);
}
bool Ledger::terminal() const { return ready_ && terminalPhase(record_.phase); }
bool Ledger::owns(const char* jobId) const {
  return ready_ && record_.phase != Phase::Empty && jobId && !strcmp(record_.request.jobId, jobId);
}
bool Ledger::wantsDonation() const {
  return active() && (record_.phase == Phase::Accepted || record_.phase == Phase::Offering ||
                      record_.phase == Phase::Transferring);
}

size_t Ledger::writeJson(char* output, size_t capacity) const {
  if (!output || !capacity) return 0;
  if (record_.phase == Phase::Empty) {
    const int used = snprintf(output, capacity,
      "{\"contractVersion\":2,\"found\":false,\"storageReady\":%s}",
      ready_ ? "true" : "false");
    return used > 0 && size_t(used) < capacity ? size_t(used) : 0;
  }
  char digest[65]{}, version[24]{}, receipt[160]{}, errorJson[360]{};
  for (unsigned i = 0; i < 32; ++i)
    snprintf(digest + i * 2, 3, "%02x", record_.request.artifact.sha256[i]);
  const int versionUsed = snprintf(version, sizeof(version), "%u.%u.%u",
    record_.request.artifact.version[0], record_.request.artifact.version[1],
    record_.request.artifact.version[2]);
  if (versionUsed <= 0 || size_t(versionUsed) >= sizeof(version)) return 0;
  const bool isTerminal = terminalPhase(record_.phase);
  if (!isTerminal) strcpy(receipt, "null");
  else {
    int receiptUsed = 0;
    if (record_.phase == Phase::Succeeded)
      receiptUsed = snprintf(receipt, sizeof(receipt),
        "{\"outcome\":\"installed\",\"installedVersion\":\"%s\"}", version);
    else if (record_.phase == Phase::Cancelled)
      receiptUsed = snprintf(receipt, sizeof(receipt),
        "{\"outcome\":\"cancelled\",\"installedVersion\":null}");
    else
      receiptUsed = snprintf(receipt, sizeof(receipt),
        "{\"outcome\":\"failed\",\"installedVersion\":null}");
    if (receiptUsed <= 0 || size_t(receiptUsed) >= sizeof(receipt)) return 0;
  }
  if (record_.phase == Phase::Failed) {
    const int errorUsed = snprintf(errorJson, sizeof(errorJson),
      "{\"code\":\"%s\",\"message\":\"%s\"}", errorName(record_.error),
      errorMessage(record_.error));
    if (errorUsed <= 0 || size_t(errorUsed) >= sizeof(errorJson)) return 0;
  } else {
    strcpy(errorJson, "null");
  }
  const int used = snprintf(output, capacity,
    "{\"contractVersion\":2,\"found\":true,\"storageReady\":%s,"
    "\"jobId\":\"%s\",\"targetId\":\"%s\",\"ownerId\":\"%s\","
    "\"route\":\"targeted-bridge\",\"artifact\":{\"version\":\"%s\","
    "\"size\":%lu,\"sha256\":\"%s\"},\"revision\":%lu,\"phase\":\"%s\","
    "\"confirmedBytes\":%lu,\"totalBytes\":%lu,\"terminal\":%s,"
    "\"receipt\":%s,\"error\":%s}",
    ready_ ? "true" : "false", record_.request.jobId, record_.request.targetId,
    record_.request.ownerId, version, static_cast<unsigned long>(record_.request.artifact.size),
    digest, static_cast<unsigned long>(record_.revision), phaseName(record_.phase),
    static_cast<unsigned long>(record_.confirmedBytes),
    static_cast<unsigned long>(record_.totalBytes), isTerminal ? "true" : "false",
    receipt, errorJson);
  return used > 0 && size_t(used) < capacity ? size_t(used) : 0;
}

Result Ledger::start(const Request& request, uint32_t now) {
  if (!ready_) return Result::StorageFault;
  if (!validRequest(request)) return Result::Invalid;
  if (strcmp(request.ownerId, bridgeId_)) return Result::OwnerMismatch;
  if (record_.phase != Phase::Empty) {
    if (!strcmp(record_.request.jobId, request.jobId))
      return sameTuple(record_.request, request) ? Result::Existing : Result::Conflict;
    return Result::Busy;
  }
  Record next{};
  next.revision = 1;
  next.request = request;
  next.phase = Phase::Accepted;
  next.totalBytes = request.artifact.size;
  next.createdAt = next.updatedAt = now;
  return save(next) ? Result::Accepted : Result::StorageFault;
}

Result Ledger::mutate(Phase phase, Error error, uint32_t confirmed, uint32_t now) {
  if (!ready_) return Result::StorageFault;
  Record next = record_;
  if (next.revision >= MaximumRevision) {
    // Once the wire revision space is exhausted, no later snapshot can be
    // represented safely. Fail closed instead of wrapping or reusing it.
    ready_ = false;
    storageFault_ = true;
    return Result::RevisionExhausted;
  }
  ++next.revision;
  next.phase = phase;
  next.error = error;
  next.confirmedBytes = confirmed;
  next.updatedAt = now;
  next.terminalAt = terminalPhase(phase) ? now : 0;
  return save(next) ? Result::Updated : Result::StorageFault;
}

Result Ledger::beginOffering(const char* jobId, uint32_t expectedRevision, uint32_t now) {
  if (!owns(jobId)) return ready_ ? Result::NotFound : Result::StorageFault;
  if (record_.revision != expectedRevision) return Result::StaleRevision;
  if (record_.phase == Phase::Offering || record_.phase == Phase::Transferring)
    return Result::Existing;
  if (record_.phase != Phase::Accepted) return Result::TooLate;
  return mutate(Phase::Offering, Error::None, record_.confirmedBytes, now);
}

Result Ledger::confirmProgress(const char* jobId, uint32_t confirmed, uint32_t now) {
  if (!owns(jobId)) return ready_ ? Result::NotFound : Result::StorageFault;
  if (record_.phase != Phase::Offering && record_.phase != Phase::Transferring)
    return Result::TooLate;
  if (confirmed < record_.confirmedBytes || confirmed > record_.totalBytes)
    return Result::Invalid;
  if (confirmed == record_.confirmedBytes && record_.phase == Phase::Transferring)
    return Result::Existing;
  return mutate(Phase::Transferring, Error::None, confirmed, now);
}

Result Ledger::awaitingVerification(const char* jobId, uint32_t now) {
  if (!owns(jobId)) return ready_ ? Result::NotFound : Result::StorageFault;
  if (record_.phase == Phase::AwaitingVerification) return Result::Existing;
  if (record_.phase != Phase::Transferring ||
      record_.confirmedBytes != record_.totalBytes)
    return Result::TooLate;
  return mutate(Phase::AwaitingVerification, Error::None, record_.confirmedBytes, now);
}

Result Ledger::fail(const char* jobId, Error error, uint32_t now) {
  if (!owns(jobId)) return ready_ ? Result::NotFound : Result::StorageFault;
  if (terminal()) return Result::Existing;
  // At the full receiver-confirmed boundary Finish/commit may already be in
  // flight. Radio loss, timeout, or an absent observer is not exact negative
  // installation proof, so preserve the job for target-bound verification.
  if (record_.phase == Phase::AwaitingVerification ||
      (record_.phase == Phase::Transferring &&
       record_.confirmedBytes == record_.totalBytes))
    return Result::TooLate;
  if (error == Error::None || error == Error::Cancelled) return Result::Invalid;
  return mutate(Phase::Failed, error, record_.confirmedBytes, now);
}

Result Ledger::confirmInstalled(const char* jobId, const InstalledProof& proof, uint32_t now) {
  if (!owns(jobId)) return ready_ ? Result::NotFound : Result::StorageFault;
  if (record_.phase == Phase::Succeeded) return Result::Existing;
  if (record_.phase != Phase::AwaitingVerification ||
      record_.confirmedBytes != record_.totalBytes)
    return Result::TooLate;
  if (proof.reserved != 0 || !proof.installed || !proof.updateInactive ||
      !proof.controlResponsive || !proof.bootSession ||
      !canonicalId(proof.targetId, 12))
    return Result::Invalid;
  if (strcmp(record_.request.targetId, proof.targetId)) return Result::Conflict;
  if (!sameArtifact(record_.request.artifact, proof.artifact)) return Result::Conflict;
  return mutate(Phase::Succeeded, Error::None, record_.totalBytes, now);
}

Result Ledger::cancel(const char* jobId, uint32_t now) {
  if (!owns(jobId)) return ready_ ? Result::NotFound : Result::StorageFault;
  if (record_.phase == Phase::Cancelled) return Result::Existing;
  if (record_.phase == Phase::AwaitingVerification || terminal() ||
      (record_.phase == Phase::Transferring &&
       record_.confirmedBytes == record_.totalBytes))
    return Result::TooLate;
  return mutate(Phase::Cancelled, Error::Cancelled, record_.confirmedBytes, now);
}

Result Ledger::acknowledgeTerminal(const char* jobId, uint32_t expectedRevision) {
  if (!owns(jobId)) return ready_ ? Result::NotFound : Result::StorageFault;
  if (!terminal()) return Result::TooLate;
  if (record_.revision != expectedRevision) return Result::StaleRevision;
  if (!store_.clear(store_.context)) {
    ready_ = false;
    storageFault_ = true;
    return Result::StorageFault;
  }
  record_ = {};
  memset(targetMac_, 0, sizeof(targetMac_));
  return Result::Cleared;
}

const char* Ledger::phaseName(Phase phase) {
  switch (phase) {
    case Phase::Empty: return "empty";
    case Phase::Accepted: return "accepted";
    case Phase::Offering: return "offering";
    case Phase::Transferring: return "transferring";
    case Phase::AwaitingVerification: return "awaiting-verification";
    case Phase::Succeeded: return "succeeded";
    case Phase::Cancelled: return "cancelled";
    case Phase::Failed: return "failed";
  }
  return "invalid";
}

const char* Ledger::errorName(Error error) {
  switch (error) {
    case Error::None: return "none";
    case Error::Invalid: return "invalid";
    case Error::OwnerMismatch: return "owner-mismatch";
    case Error::Conflict: return "conflict";
    case Error::Busy: return "busy";
    case Error::Storage: return "storage";
    case Error::Radio: return "radio";
    case Error::Timeout: return "timeout";
    case Error::Interrupted: return "interrupted";
    case Error::ReceiverRejected: return "receiver-rejected";
    case Error::Read: return "read";
    case Error::Verification: return "verification";
    case Error::Cancelled: return "cancelled";
  }
  return "invalid";
}

const char* Ledger::errorMessage(Error error) {
  switch (error) {
    case Error::None: return "No update error was recorded.";
    case Error::Invalid: return "The update job data was invalid.";
    case Error::OwnerMismatch: return "This bridge is not the selected update owner.";
    case Error::Conflict: return "The update job identifier was reused for different data.";
    case Error::Busy: return "This bridge already owns another update job.";
    case Error::Storage: return "The bridge could not persist the update job.";
    case Error::Radio: return "The bridge lost the target radio connection.";
    case Error::Timeout: return "The target did not respond before the update deadline.";
    case Error::Interrupted: return "The bridge restarted before the transfer finished.";
    case Error::ReceiverRejected: return "The target rejected the exact firmware artifact.";
    case Error::Read: return "The bridge could not read the cached firmware artifact.";
    case Error::Verification: return "The installed firmware could not be verified.";
    case Error::Cancelled: return "The update job was cancelled.";
  }
  return "The bridge reported an unknown update error.";
}

} // namespace BridgeUpdateJob
