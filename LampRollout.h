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
void service(uint32_t now); // Owning loop expires volatile permits across rollover.
}
bool lampRolloutAllowsAutomaticUpdate(const FirmwareManifest& artifact);
// New automatic admission only: exact-artifact checks remain separate.
// 0 ready/independent, 1 staged coordination required, 2 legacy bootstrap,
// 3 storage unavailable, 4 permit unavailable/expired/rebooted.
uint8_t lampRolloutAutomaticAdmissionReason();
bool lampRolloutAllowsAutomaticAdmission();
// Call after operation ownership is obtained, before the first write/start.
// A failed durable fence must abort the update; eligibility is read-only.
bool lampRolloutAutomaticUpdateStarted(const FirmwareManifest& artifact);
bool lampRolloutPinsMembership();
bool lampRolloutAllowsUnpinnedUpdate();
// Updater-owned preflight: no pending/resource/restart, healthy measured old
// running image, boot-selected partition equals running. Never guessed here.
bool lampRolloutRecoveryPreflight(const FirmwareManifest& pinned);
