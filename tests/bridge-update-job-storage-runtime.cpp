#include "bridge/BridgeUpdateJobStorage.h"
#include "Preferences.h"

#include <cassert>
#include <cstring>
#include <iostream>

using namespace BridgeUpdateJob;

Request request() {
  Request value{};
  strcpy(value.jobId, "102030405060708090a0b0c0d0e0f001");
  strcpy(value.targetId, "5894af4aec24");
  strcpy(value.ownerId, "8c4856dab734");
  value.artifact.version[0] = 1;
  value.artifact.version[1] = 15;
  value.artifact.version[2] = 10;
  value.artifact.size = 2027408;
  memset(value.artifact.sha256, 0xa5, sizeof(value.artifact.sha256));
  return value;
}

int main() {
  Preferences::reset();
  Ledger first;
  assert(first.begin("8c4856dab734", BridgeUpdateJobStorage::preferences(), 1));
  const Request value = request();
  assert(first.start(value, 2) == Result::Accepted);
  assert(Preferences::writes == 1);
  assert(Preferences::commits == 1);

  Ledger restored;
  assert(restored.begin("8c4856dab734", BridgeUpdateJobStorage::preferences(), 3));
  assert(restored.owns(value.jobId));
  assert(restored.record().revision == 1);
  assert(restored.cancel(value.jobId, 4) == Result::Updated);
  assert(restored.acknowledgeTerminal(value.jobId, 2) == Result::Cleared);
  assert(Preferences::removes == 1);

  Ledger empty;
  assert(empty.begin("8c4856dab734", BridgeUpdateJobStorage::preferences(), 5));
  assert(empty.record().phase == Phase::Empty);
  assert(empty.start(value, 5) == Result::Accepted);

  Preferences::readFault = true;
  Ledger fault;
  assert(!fault.begin("8c4856dab734", BridgeUpdateJobStorage::preferences(), 6));
  assert(fault.storageFault());

  Preferences::readFault = false;
  Preferences::typeFault = true;
  Ledger wrongType;
  assert(!wrongType.begin("8c4856dab734", BridgeUpdateJobStorage::preferences(), 7));
  assert(wrongType.storageFault());

  Preferences::typeFault = false;
  Preferences::storage.at("bridgejob2/jobV2").resize(sizeof(Record) - 1);
  Ledger wrongSize;
  assert(!wrongSize.begin("8c4856dab734", BridgeUpdateJobStorage::preferences(), 8));
  assert(wrongSize.storageFault());

  Preferences::reset();
  Ledger writeFailure;
  assert(writeFailure.begin("8c4856dab734", BridgeUpdateJobStorage::preferences(), 9));
  Preferences::writeFault = true;
  assert(writeFailure.start(value, 10) == Result::StorageFault);
  assert(writeFailure.storageFault());

  Preferences::reset();
  Ledger saveCommitFailure;
  assert(saveCommitFailure.begin("8c4856dab734", BridgeUpdateJobStorage::preferences(), 11));
  Preferences::commitFault = true;
  assert(saveCommitFailure.start(value, 12) == Result::StorageFault);
  assert(saveCommitFailure.storageFault());

  Preferences::reset();
  Ledger eraseFailure;
  assert(eraseFailure.begin("8c4856dab734", BridgeUpdateJobStorage::preferences(), 13));
  assert(eraseFailure.start(value, 14) == Result::Accepted);
  assert(eraseFailure.cancel(value.jobId, 15) == Result::Updated);
  Preferences::removeFault = true;
  assert(eraseFailure.acknowledgeTerminal(value.jobId, 2) == Result::StorageFault);
  assert(eraseFailure.storageFault());

  Preferences::reset();
  Ledger eraseCommitFailure;
  assert(eraseCommitFailure.begin("8c4856dab734", BridgeUpdateJobStorage::preferences(), 16));
  assert(eraseCommitFailure.start(value, 17) == Result::Accepted);
  assert(eraseCommitFailure.cancel(value.jobId, 18) == Result::Updated);
  Preferences::commitFault = true;
  assert(eraseCommitFailure.acknowledgeTerminal(value.jobId, 2) == Result::StorageFault);
  assert(eraseCommitFailure.storageFault());

  Preferences::reset();
  Preferences::unavailable = true;
  Ledger openFailure;
  assert(!openFailure.begin("8c4856dab734", BridgeUpdateJobStorage::preferences(), 19));
  assert(openFailure.storageFault());
  std::cout << "PASS dedicated bridge update-job NVS storage and terminal acknowledgement\n";
}
