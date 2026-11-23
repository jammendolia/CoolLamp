#include "bridge/BridgeUpdateJob.h"

#include <cassert>
#include <cstring>
#include <iostream>
#include <string>

using namespace BridgeUpdateJob;

struct MemoryStore {
  bool present = false;
  bool loadFault = false;
  bool saveFault = false;
  bool clearFault = false;
  unsigned loads = 0;
  unsigned saves = 0;
  Record value{};
};

LoadResult load(void* context, Record& out) {
  auto& store = *static_cast<MemoryStore*>(context);
  ++store.loads;
  if (store.loadFault) return LoadResult::Fault;
  if (!store.present) return LoadResult::Missing;
  out = store.value;
  return LoadResult::Loaded;
}
bool save(void* context, const Record& value) {
  auto& store = *static_cast<MemoryStore*>(context);
  ++store.saves;
  if (store.saveFault) return false;
  store.value = value;
  store.present = true;
  return true;
}
bool clear(void* context) {
  auto& store = *static_cast<MemoryStore*>(context);
  if (store.clearFault) return false;
  store.present = false;
  store.value = {};
  return true;
}
Store hooks(MemoryStore& store) { return {&store, load, save, clear}; }

uint32_t recordChecksum(const Record& input) {
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

void reseal(MemoryStore& store) { store.value.checksum = recordChecksum(store.value); }

Request request(const char* owner = "8c4856dab734") {
  Request value{};
  strcpy(value.jobId, "102030405060708090a0b0c0d0e0f001");
  strcpy(value.targetId, "5894af4aec24");
  strcpy(value.ownerId, owner);
  value.route = Route::TargetedBridge;
  value.artifact.version[0] = 1;
  value.artifact.version[1] = 15;
  value.artifact.version[2] = 10;
  value.artifact.size = 2027408;
  for (unsigned i = 0; i < sizeof(value.artifact.sha256); ++i)
    value.artifact.sha256[i] = uint8_t(i + 1);
  return value;
}

InstalledProof installedProof(const Request& selected) {
  InstalledProof proof{};
  proof.artifact = selected.artifact;
  strcpy(proof.targetId, selected.targetId);
  proof.bootSession = 0x1020304050607080ULL;
  proof.installed = proof.updateInactive = proof.controlResponsive = true;
  return proof;
}

void startAndOwnership() {
  MemoryStore firstStore, secondStore;
  Ledger first, second;
  assert(first.begin("8c4856dab734", hooks(firstStore), 1));
  assert(second.begin("1029384756a0", hooks(secondStore), 1));
  const Request selected = request();
  assert(first.start(selected, 10) == Result::Accepted);
  assert(first.start(selected, 11) == Result::Existing);
  assert(firstStore.saves == 1); // Lost reply retry never repeats the mutation.
  assert(second.start(selected, 10) == Result::OwnerMismatch);
  assert(!secondStore.present);

  Request reused = selected;
  reused.artifact.version[2] = 11;
  assert(first.start(reused, 12) == Result::Conflict);
  Request other = selected;
  strcpy(other.jobId, "112030405060708090a0b0c0d0e0f001");
  assert(first.start(other, 12) == Result::Busy);

  const uint8_t expected[6] = {0x24, 0xec, 0x4a, 0xaf, 0x94, 0x58};
  assert(!memcmp(first.targetMac(), expected, sizeof(expected)));
  assert(first.record().revision == 1 && first.record().phase == Phase::Accepted);
  char json[JsonCapacity]{};
  const size_t jsonBytes = first.writeJson(json, sizeof(json));
  assert(jsonBytes && jsonBytes == strlen(json));
  const std::string projection(json);
  for (const char* required : {"\"contractVersion\":2", "\"jobId\":\"102030405060708090a0b0c0d0e0f001\"",
       "\"targetId\":\"5894af4aec24\"", "\"ownerId\":\"8c4856dab734\"",
       "\"route\":\"targeted-bridge\"", "\"phase\":\"accepted\"",
       "\"confirmedBytes\":0", "\"totalBytes\":2027408", "\"terminal\":false",
       "\"receipt\":null", "\"error\":null"})
    assert(projection.find(required) != std::string::npos);
  char shortJson[32]{};
  assert(first.writeJson(shortJson, sizeof(shortJson)) == 0);
  std::cout << "PASS selected owner is deterministic and start is idempotent\n";
}

void transferAndReceipt() {
  MemoryStore store;
  Ledger ledger;
  const Request selected = request();
  assert(ledger.begin(selected.ownerId, hooks(store), 1));
  assert(ledger.start(selected, 10) == Result::Accepted);
  assert(ledger.beginOffering(selected.jobId, 0, 11) == Result::StaleRevision);
  assert(ledger.beginOffering(selected.jobId, 1, 11) == Result::Updated);
  assert(ledger.awaitingVerification(selected.jobId, 11) == Result::TooLate);
  assert(ledger.confirmProgress(selected.jobId, 1000, 12) == Result::Updated);
  assert(ledger.confirmProgress(selected.jobId, 999, 13) == Result::Invalid);
  assert(ledger.confirmProgress(selected.jobId, 1000, 13) == Result::Existing);
  assert(ledger.confirmProgress(selected.jobId, selected.artifact.size + 1, 13) == Result::Invalid);
  assert(ledger.awaitingVerification(selected.jobId, 13) == Result::TooLate);
  assert(ledger.confirmProgress(selected.jobId, selected.artifact.size, 14) == Result::Updated);
  const uint32_t fullTransferRevision = ledger.record().revision;
  for (uint8_t code = uint8_t(Error::None); code <= uint8_t(Error::Cancelled);
       ++code) {
    assert(ledger.fail(selected.jobId, Error(code), 15 + code) == Result::TooLate);
    assert(ledger.record().phase == Phase::Transferring);
    assert(ledger.record().revision == fullTransferRevision);
  }
  assert(ledger.cancel(selected.jobId, 40) == Result::TooLate);
  assert(ledger.record().phase == Phase::Transferring);
  assert(ledger.record().revision == fullTransferRevision);
  assert(ledger.awaitingVerification(selected.jobId, 41) == Result::Updated);
  assert(ledger.cancel(selected.jobId, 42) == Result::TooLate);

  InstalledProof proof = installedProof(selected);
  InstalledProof incomplete = proof;
  incomplete.controlResponsive = false;
  assert(ledger.confirmInstalled(selected.jobId, incomplete, 16) == Result::Invalid);
  InstalledProof noBootSession = proof;
  noBootSession.bootSession = 0;
  assert(ledger.confirmInstalled(selected.jobId, noBootSession, 16) == Result::Invalid);
  InstalledProof wrongTarget = proof;
  strcpy(wrongTarget.targetId, "5894af4aec26");
  assert(ledger.confirmInstalled(selected.jobId, wrongTarget, 16) == Result::Conflict);
  InstalledProof wrong = proof;
  wrong.artifact.sha256[0] ^= 0xff;
  assert(ledger.confirmInstalled(selected.jobId, wrong, 17) == Result::Conflict);
  assert(ledger.confirmInstalled(selected.jobId, proof, 18) == Result::Updated);
  assert(ledger.terminal() && ledger.record().phase == Phase::Succeeded);
  assert(ledger.record().confirmedBytes == selected.artifact.size);
  const uint32_t revision = ledger.record().revision;
  char terminalJson[JsonCapacity]{};
  assert(ledger.writeJson(terminalJson, sizeof(terminalJson)));
  const std::string successProjection(terminalJson);
  assert(successProjection.find("\"receipt\":{\"outcome\":\"installed\",\"installedVersion\":\"1.15.10\"}") != std::string::npos);
  assert(successProjection.find("\"error\":null") != std::string::npos);
  assert(ledger.acknowledgeTerminal(selected.jobId, revision - 1) == Result::StaleRevision);
  assert(ledger.acknowledgeTerminal(selected.jobId, revision) == Result::Cleared);
  assert(!ledger.active() && ledger.record().phase == Phase::Empty && !store.present);
  std::cout << "PASS monotonic transfer, postboot verification, terminal receipt and acknowledgement\n";
}

void partialTransferMayTerminate() {
  const Request selected = request();

  MemoryStore failedStore;
  Ledger failed;
  assert(failed.begin(selected.ownerId, hooks(failedStore), 1));
  assert(failed.start(selected, 2) == Result::Accepted);
  assert(failed.beginOffering(selected.jobId, 1, 3) == Result::Updated);
  assert(failed.confirmProgress(selected.jobId, 4096, 4) == Result::Updated);
  assert(failed.fail(selected.jobId, Error::Timeout, 5) == Result::Updated);
  assert(failed.record().phase == Phase::Failed);
  assert(failed.record().error == Error::Timeout);
  assert(failed.record().confirmedBytes == 4096);

  MemoryStore cancelledStore;
  Ledger cancelled;
  assert(cancelled.begin(selected.ownerId, hooks(cancelledStore), 1));
  assert(cancelled.start(selected, 2) == Result::Accepted);
  assert(cancelled.beginOffering(selected.jobId, 1, 3) == Result::Updated);
  assert(cancelled.confirmProgress(selected.jobId, 4096, 4) == Result::Updated);
  assert(cancelled.cancel(selected.jobId, 5) == Result::Updated);
  assert(cancelled.record().phase == Phase::Cancelled);
  assert(cancelled.record().error == Error::Cancelled);
  assert(cancelled.record().confirmedBytes == 4096);
  std::cout << "PASS live partial transfer may still fail or cancel\n";
}

void rebootAndFaults() {
  MemoryStore store;
  const Request selected = request();
  {
    Ledger ledger;
    assert(ledger.begin(selected.ownerId, hooks(store), 1));
    assert(ledger.start(selected, 10) == Result::Accepted);
    assert(ledger.beginOffering(selected.jobId, 1, 11) == Result::Updated);
    assert(ledger.confirmProgress(selected.jobId, 4096, 12) == Result::Updated);
  }
  Ledger recovered;
  assert(recovered.begin(selected.ownerId, hooks(store), 20));
  assert(recovered.terminal() && !recovered.active());
  assert(recovered.record().phase == Phase::Failed);
  assert(recovered.record().error == Error::Interrupted);
  assert(recovered.record().confirmedBytes == 4096);
  assert(recovered.record().revision == 4);
  char interruptedJson[JsonCapacity]{};
  assert(recovered.writeJson(interruptedJson, sizeof(interruptedJson)));
  const std::string interrupted(interruptedJson);
  assert(interrupted.find("\"receipt\":{\"outcome\":\"failed\",\"installedVersion\":null}") != std::string::npos);
  assert(interrupted.find("\"error\":{\"code\":\"interrupted\"") != std::string::npos);

  MemoryStore offeringStore;
  {
    Ledger offering;
    assert(offering.begin(selected.ownerId, hooks(offeringStore), 1));
    assert(offering.start(selected, 2) == Result::Accepted);
    assert(offering.beginOffering(selected.jobId, 1, 3) == Result::Updated);
  }
  Ledger offeringRecovered;
  assert(offeringRecovered.begin(selected.ownerId, hooks(offeringStore), 4));
  assert(offeringRecovered.record().phase == Phase::Failed);
  assert(offeringRecovered.record().error == Error::Interrupted);
  assert(offeringRecovered.record().confirmedBytes == 0);
  assert(offeringRecovered.record().revision == 3);

  MemoryStore completeStore;
  {
    Ledger complete;
    assert(complete.begin(selected.ownerId, hooks(completeStore), 1));
    assert(complete.start(selected, 2) == Result::Accepted);
    assert(complete.beginOffering(selected.jobId, 1, 3) == Result::Updated);
    assert(complete.confirmProgress(selected.jobId, selected.artifact.size, 4) ==
           Result::Updated);
  }
  Ledger completeRecovered;
  assert(completeRecovered.begin(selected.ownerId, hooks(completeStore), 5));
  assert(completeRecovered.active() && !completeRecovered.wantsDonation());
  assert(completeRecovered.record().phase == Phase::AwaitingVerification);
  assert(completeRecovered.record().confirmedBytes == selected.artifact.size);
  assert(completeRecovered.record().revision == 4);
  assert(completeRecovered.cancel(selected.jobId, 6) == Result::TooLate);
  const uint32_t verificationRevision = completeRecovered.record().revision;
  for (uint8_t code = uint8_t(Error::None); code <= uint8_t(Error::Cancelled);
       ++code) {
    assert(completeRecovered.fail(selected.jobId, Error(code), 7 + code) ==
           Result::TooLate);
    assert(completeRecovered.record().phase == Phase::AwaitingVerification);
    assert(completeRecovered.record().revision == verificationRevision);
  }
  Ledger verificationRecovered;
  assert(verificationRecovered.begin(selected.ownerId, hooks(completeStore), 40));
  assert(verificationRecovered.active() && !verificationRecovered.wantsDonation());
  assert(verificationRecovered.record().phase == Phase::AwaitingVerification);
  assert(verificationRecovered.record().revision == verificationRevision);
  InstalledProof wrongTarget = installedProof(selected);
  strcpy(wrongTarget.targetId, "5894af4aec26");
  assert(verificationRecovered.confirmInstalled(selected.jobId, wrongTarget, 41) ==
         Result::Conflict);
  assert(verificationRecovered.record().phase == Phase::AwaitingVerification);
  assert(verificationRecovered.record().revision == verificationRevision);
  const InstalledProof exact = installedProof(selected);
  assert(verificationRecovered.confirmInstalled(selected.jobId, exact, 42) ==
         Result::Updated);
  assert(verificationRecovered.terminal() &&
         verificationRecovered.record().phase == Phase::Succeeded);

  MemoryStore completeStorageFault;
  {
    Ledger complete;
    assert(complete.begin(selected.ownerId, hooks(completeStorageFault), 1));
    assert(complete.start(selected, 2) == Result::Accepted);
    assert(complete.beginOffering(selected.jobId, 1, 3) == Result::Updated);
    assert(complete.confirmProgress(selected.jobId, selected.artifact.size, 4) ==
           Result::Updated);
  }
  completeStorageFault.saveFault = true;
  Ledger failedPromotion;
  assert(!failedPromotion.begin(selected.ownerId, hooks(completeStorageFault), 5));
  assert(failedPromotion.storageFault() && !failedPromotion.ready());
  assert(completeStorageFault.value.phase == Phase::Transferring);

  MemoryStore ambiguous;
  Ledger unsafe;
  assert(unsafe.begin(selected.ownerId, hooks(ambiguous), 1));
  ambiguous.saveFault = true;
  assert(unsafe.start(selected, 2) == Result::StorageFault);
  assert(!unsafe.ready() && unsafe.storageFault());

  MemoryStore corrupt = store;
  corrupt.value.checksum ^= 1;
  Ledger rejected;
  assert(!rejected.begin(selected.ownerId, hooks(corrupt), 30));
  assert(rejected.storageFault());

  MemoryStore zeroClock;
  Ledger zero;
  assert(zero.begin(selected.ownerId, hooks(zeroClock), 0));
  assert(zero.start(selected, 0) == Result::Accepted);
  assert(zero.cancel(selected.jobId, 0) == Result::Updated);
  char cancelledJson[JsonCapacity]{};
  assert(zero.writeJson(cancelledJson, sizeof(cancelledJson)));
  const std::string cancelled(cancelledJson);
  assert(cancelled.find("\"receipt\":{\"outcome\":\"cancelled\",\"installedVersion\":null}") != std::string::npos);
  assert(cancelled.find("\"error\":null") != std::string::npos);
  Ledger zeroRestored;
  assert(zeroRestored.begin(selected.ownerId, hooks(zeroClock), 0));
  assert(zeroRestored.terminal() && zeroRestored.record().terminalAt == 0);
  std::cout << "PASS reboot interrupts partial transfer, preserves full transfer for target verification, and storage faults fail closed\n";
}

void validation() {
  MemoryStore store;
  Ledger ledger;
  assert(ledger.begin("8c4856dab734", hooks(store), 1));
  for (const char* invalid : {"", "ABC030405060708090a0b0c0d0e0f001",
                              "00000000000000000000000000000000"}) {
    Request value = request();
    strncpy(value.jobId, invalid, sizeof(value.jobId) - 1);
    assert(ledger.start(value, 2) == Result::Invalid);
  }
  Request badTarget = request();
  strcpy(badTarget.targetId, "5894af4aec25"); // multicast station byte
  assert(ledger.start(badTarget, 2) == Result::Invalid);
  Request selfOwned = request("5894af4aec24");
  assert(ledger.start(selfOwned, 2) == Result::Invalid);
  Request badHash = request();
  memset(badHash.artifact.sha256, 0, sizeof(badHash.artifact.sha256));
  assert(ledger.start(badHash, 2) == Result::Invalid);
  Request reservedArtifact = request();
  reservedArtifact.artifact.reserved = 1;
  assert(ledger.start(reservedArtifact, 2) == Result::Invalid);
  std::cout << "PASS canonical immutable tuple validation\n";
}

void persistedInvariantsAndRevisionLimit() {
  const Request selected = request();
  MemoryStore base;
  Ledger source;
  assert(source.begin(selected.ownerId, hooks(base), 1));
  assert(source.start(selected, 2) == Result::Accepted);

  const auto rejected = [&](auto corrupt) {
    MemoryStore invalid = base;
    corrupt(invalid.value);
    reseal(invalid);
    Ledger restored;
    assert(!restored.begin(selected.ownerId, hooks(invalid), 3));
    assert(restored.storageFault());
  };
  rejected([](Record& value) { value.reserved = 1; });
  rejected([](Record& value) { value.revision = MaximumRevision + 1u; });
  rejected([](Record& value) { value.confirmedBytes = 1; });
  rejected([](Record& value) { value.terminalAt = 1; });
  rejected([](Record& value) { value.error = Error::Radio; });
  rejected([](Record& value) {
    value.phase = Phase::AwaitingVerification;
    value.confirmedBytes = value.totalBytes - 1;
  });
  rejected([](Record& value) {
    value.phase = Phase::Failed;
    value.error = Error::None;
  });
  rejected([](Record& value) {
    value.phase = Phase::Cancelled;
    value.error = Error::Timeout;
  });

  MemoryStore exhausted = base;
  exhausted.value.revision = MaximumRevision;
  reseal(exhausted);
  Ledger atLimit;
  assert(atLimit.begin(selected.ownerId, hooks(exhausted), 4));
  assert(atLimit.beginOffering(selected.jobId, MaximumRevision, 5) ==
         Result::RevisionExhausted);
  assert(!atLimit.ready() && atLimit.storageFault());
  assert(exhausted.value.revision == MaximumRevision);
  std::cout << "PASS persisted semantic invariants and revision exhaustion fail closed\n";
}

void emitContractSnapshots() {
  const Request selected = request();
  const auto emit = [](const Ledger& ledger) {
    char json[JsonCapacity]{};
    assert(ledger.writeJson(json, sizeof(json)));
    std::cout << json << '\n';
  };

  MemoryStore acceptedStore;
  Ledger accepted;
  assert(accepted.begin(selected.ownerId, hooks(acceptedStore), 1));
  assert(accepted.start(selected, 2) == Result::Accepted);
  emit(accepted);

  MemoryStore successStore;
  Ledger success;
  assert(success.begin(selected.ownerId, hooks(successStore), 1));
  assert(success.start(selected, 2) == Result::Accepted);
  assert(success.beginOffering(selected.jobId, 1, 3) == Result::Updated);
  assert(success.confirmProgress(selected.jobId, selected.artifact.size, 4) ==
         Result::Updated);
  assert(success.awaitingVerification(selected.jobId, 5) == Result::Updated);
  InstalledProof proof = installedProof(selected);
  assert(success.confirmInstalled(selected.jobId, proof, 6) == Result::Updated);
  emit(success);

  MemoryStore interruptedStore;
  {
    Ledger transfer;
    assert(transfer.begin(selected.ownerId, hooks(interruptedStore), 1));
    assert(transfer.start(selected, 2) == Result::Accepted);
    assert(transfer.beginOffering(selected.jobId, 1, 3) == Result::Updated);
    assert(transfer.confirmProgress(selected.jobId, 4096, 4) == Result::Updated);
  }
  Ledger interrupted;
  assert(interrupted.begin(selected.ownerId, hooks(interruptedStore), 5));
  emit(interrupted);

  MemoryStore cancelledStore;
  Ledger cancelled;
  assert(cancelled.begin(selected.ownerId, hooks(cancelledStore), 1));
  assert(cancelled.start(selected, 2) == Result::Accepted);
  assert(cancelled.cancel(selected.jobId, 3) == Result::Updated);
  emit(cancelled);
}

int main(int argc, char** argv) {
  if (argc == 2 && !strcmp(argv[1], "--json")) {
    emitContractSnapshots();
    return 0;
  }
  startAndOwnership();
  transferAndReceipt();
  partialTransferMayTerminate();
  rebootAndFaults();
  validation();
  persistedInvariantsAndRevisionLimit();
  std::cout << "PASS bridge update job v2 core\n";
}
