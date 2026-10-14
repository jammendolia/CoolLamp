#pragma once
#include "LampRolloutCore.h"
#include "LampControlEndpoint.h"
namespace LampRollout {
// Protected loop-only API; request fields contain no passwords or private keys.
// action: start | arm | arm-reconcile | reserve | accept | health |
// reconcile | release | finish | release-reconcile | cancel | status
// Recovery: renew-proof (target), renew (coordinator), renew-accept (target).
LampControlReply request(const String& action,const String& manifest,const String& command,
  const String& ticket,const String& target,const String& targetBoot,const String& proof);
String statusJson();
void service(uint32_t now); // Owning loop loads/retries storage and expires volatile permits.
}
bool lampRolloutAllowsAutomaticUpdate(const FirmwareManifest& artifact);
// New automatic admission only: exact-artifact checks remain separate.
// 0 ready/independent or unarmed active legacy follower, 1 staged coordination required,
// 2 legacy coordinator bootstrap/coordination,
// 3 storage unavailable, 4 permit/context unavailable/expired/rebooted or volatile legacy pause.
uint8_t lampRolloutAutomaticAdmissionReason();
uint8_t lampRolloutAutomaticAdmissionSnapshotReason(); // Read-only RAM/status: no storage or expiry mutation.
bool lampRolloutAllowsAutomaticAdmission();
// Call after operation ownership is obtained, before the first write/start.
// A failed durable fence must abort the update; eligibility is read-only.
bool lampRolloutAutomaticUpdateStarted(const FirmwareManifest& artifact);
bool lampRolloutPinsMembership();
bool lampRolloutAllowsUnpinnedUpdate();
// Updater-owned preflight: no pending/resource/restart, healthy measured old
// running image, boot-selected partition equals running. Never guessed here.
bool lampRolloutRecoveryPreflight(const FirmwareManifest& pinned);
