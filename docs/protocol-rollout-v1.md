# Bounded staged firmware rollout contract v1

Implemented source: `LampRolloutCore.h`, `LampRollout.cpp`, `LampSync.cpp`, actual
HTTPS updater and donation receiver integration. Client contract helpers:
`mobile/src/rollout.js`. Protected endpoint 51: `POST /api/firmware/rollout`.
Every mutation runs on the owning main-loop path; radio callbacks do not change
rollout state. No new firmware radio transport is created by this service.

## Admission and policy

Only a protocol-3 coordinator can create a ticket. It freezes the exact durable
member order (1–32 identities), pins version/size/SHA-256, and persists the ticket.
Manifest parsing requires the fixed ESP32-C3/dual-OTA artifact contract. When
publisher enforcement is provisioned, the original publisher signature must
verify; unsigned development/legacy manifests are accepted only while the
existing explicitly reported publisher policy permits them. This ticket does
not supply a publisher trust root or permit a donor to invent signed metadata.

The owner controller forwards the ticket's authenticated arming proof to **every
member, including the coordinator** over an identity-verified protected route.
Each receiver durably acknowledges a policy hold. The coordinator cannot reserve
even the first target until all frozen positions acknowledge arming. A receiver
already owning update resources rejects arming. Every grouped lamp conservatively
holds new automatic installation admission unless it has a valid staged permit;
compatibility groups need the explicit supported bootstrap/coordination route.
Before all arming succeeds the controller reports preparation incomplete and
cannot issue even the first lease. Already running transfers finish under their
existing resource ownership; a new ticket cannot interrupt a busy donor/updater.

Once armed, each receiver blocks automatic updates until it has the one exact
per-target permit. Existing receiver opt-in and quiet/in-use policy remain
mandatory; a permit cannot turn them on. HTTPS candidate admission and donor
offer/start admission call `lampRolloutAllowsAutomaticUpdate`. After updater
resource reservation and before first OTA begin/write, both paths durably call
`lampRolloutAutomaticUpdateStarted`; storage failure produces zero image writes.
Manual Update now bypasses the receiver's automatic quiet-window scheduling;
inside an armed rollout it still requires the exact current permit. Manual
HTTPS and BLE use the same durable start fence; unpinned legacy HTTP uploads
are blocked while any rollout hold or ticket is present. Outside rollout,
their existing behavior and publisher policy apply.
`lampRolloutAutomaticAdmissionReason()` reports 0 ready/independent, 1 staged
coordination required, 2 legacy bootstrap/coordination required, 3 storage
unavailable or 4 missing/expired/rebooted permit. It does not read or modify opt-in,
quiet/in-use policy or artifact identity. All three remain independent mandatory
gates. The boolean admission helper delegates to reason zero without recursion.

One coordinator lease is durable at a time. A target permit binds coordinator,
target identity, target synchronization session, ticket, lease, group-key
fingerprint and exact artifact. Coordinator-last requires every follower's
verified postboot health before the coordinator can obtain a permit. Paused or
offline membership remains in the frozen order; automatic service never resumes
a paused follower or discards its position to make progress.

## Protected requests and responses

The form accepts only `action`, `manifest`, `command`, `ticket`, `target`,
`targetBoot`, `proof`. Commands are nonzero decimal uint32, ticket/targetBoot are
sixteen lowercase hex digits, target is twelve lowercase hex identity digits.
Proofs are opaque lowercase hex and must be forwarded unchanged. They are
authenticated with the already provisioned group key; they prove authorized
group transcript consistency, **not** manufacturer or hardware attestation.

| Action | Destination and required fields | Durable outcome |
| --- | --- | --- |
| `start` | Coordinator: exact `manifest`, `command` | Pins ticket/order; returns `arm` |
| `arm` | Each verified member: `proof=arm` | Saves policy hold; returns `armAck` |
| `arm-reconcile` | Coordinator: `proof=armAck` | Saves acknowledged-member mask |
| `reserve` | Coordinator: `ticket,target,targetBoot,command` | Saves sole lease; returns `permit` |
| `accept` | Exact target/current session: `proof=permit` | Saves permit; opens five-minute start window |
| `renew-proof` | Same target; updater-owned recovery preflight | Saves renew-ready for current boot; returns `recovery` |
| `renew` | Coordinator: `proof=recovery,command` | Keeps same sole lease/target/image; returns `renewPermit` |
| `renew-accept` | Same target/current session: `proof=renewPermit` | Saves new command; opens one fresh start window |
| `health` | Exact installed target, no supplied success fields | Returns authenticated running-image/health proof |
| `reconcile` | Coordinator: `proof=health` | Saves completion and releases lease |
| `release` | Finished coordinator | Returns retained completion release proof |
| `finish` | Each verified member: `proof=release` | Clears hold; returns `releaseAck` |
| `release-reconcile` | Coordinator: `proof=releaseAck` | Saves released-member mask |
| `cancel` | Coordinator: `ticket` | Retires fully released ticket, or unarmed preparation |
| `status` | Either member | Read-only state and honest uncertainty |

`health` uses the actual incrementally measured `runningManifest` and
`lampBootHealthy()` gate. It refuses caller-provided booleans, unmeasured/wrong
hashes, unavailable retained publisher metadata when enforced, or unhealthy
boots. The controller must also obtain a fresh verified target identity and
control snapshot (`controlReadbackRequired:true`) before forwarding health.
Shared-key proofs cannot attest a compromised member's firmware; publisher
verification and direct target/identity health checks remain separate safeguards.

Phase values: 0 empty, 1 ready, 2 reserved, 3 accepted, 4 started, 5 finished,
6 armed, 7 renew-ready. Results: 0 saved, 1 duplicate, 2 invalid, 3 busy, 4 not-member,
5 coordinator-last, 6 storage-failure, 7 stale. Storage failures do not change
in-memory state. Status exposes uint32 `armedMask`, `completedMask`,
`releasedMask`, exact ticket/lease/target, receiver phase, `storageReady`, and
`uncertainLease`. Bits refer to the frozen order; 32 members use all unsigned
bits. A finished ticket remains available until every release acknowledgment is
durable, so lost final replies cannot erase the ability to regenerate release.

Proof kinds and packed sizes: Permit/Health kinds 1/2: 144 bytes each;
Arming/Release kinds 3/5: 116; ArmingAck/ReleaseAck kinds 4/6: 92;
Recovery kind 7: 144; RenewPermit kind 8: 148. All HMACs cover
the exact version/kind-bound structure preceding the final 32-byte proof. Native
`FirmwareManifest` padding is explicitly zeroed before transport/storage;
zero reserved bytes keep nested manifests and their objects naturally aligned.
These are a fixed ESP32-C3 protocol, not arbitrary executable metadata. Maximum
proof is 296 hex characters; signed manifest text is at most 512 bytes. Forms still
obey the existing 1,024-byte protected RPC request ceiling; replies are bounded
well below 8,192. Client helpers check the *encoded* form bound.

## Interruption and recovery

A missing execution reply is uncertain. Request status and direct target state
first; never move an attempted installation automatically to another route.
Duplicate arming/permit/reconciliation do not rewrite storage; duplicate permit
acceptance does not renew lifetime. Start permission expires after 300,000 ms
using rollover-safe monotonic elapsed time. A reboot forgets its volatile start
window, so a saved accepted permit cannot silently resume. Started permits remain
durable and block new automatic images until installed health is reconciled.

Lease expiry, receiver reboot, failed transfer and offline position do **not**
release a possibly executed lease or admit the next member. If the image actually
installed, use measured health reconciliation. Explicit renewal is implemented
for the **same target, same artifact and existing lease** after an expired or
conclusively failed transfer. Obtain a fresh protected target identity/control
snapshot, ask that target for `renew-proof`, forward its authenticated proof with
a new command to coordinator `renew`, then forward `renewPermit` to that same
target's `renew-accept`. Duplicate commands never extend the window; an accepted
or Started record cannot renew itself. No target change, lease timeout reclaim or
automatic boot selection is permitted.

`lampRolloutRecoveryPreflight` is owned by the production updater. Before signing
a recovery proof it verifies no active/pending job, manual reservation, restart,
receiver resource ownership, commissioning or network-reset conflict; a healthy
loop and control state; and the selected boot partition exactly equals the
running partition by chip/address/size/type/subtype. The SDK must explicitly report
the running image `ESP_OTA_IMG_VALID`, and the incrementally measured public
running image must differ from the pinned artifact. A selected inactive image,
pending validation, unknown partition state, incomplete measurement or busy
updater refuses renewal. Legacy bootloader images without a VALID OTA state need
an explicit bootstrap/service verification route before this recovery can be used.
The target durably enters renew-ready before producing proof, and the coordinator
durably updates only the existing lease's target boot/renew command. Storage
failure at any boundary preserves the prior fence. Wrong membership/order
prevents reservation/completion/renewal.
Do not dissolve or modify a group during a rollout; doing so fences the ticket
and needs explicit operator reconciliation rather than silently replacing it.
`lampRolloutPinsMembership` supplies the protected-handler guard. The owning loop
calls `LampRollout::service(now)` so an expired start window cannot reopen after
the monotonic clock wraps.

An unarmed preparation can be cancelled only before any member hold is saved.
After arming, held members require completion/release; no unauthenticated timeout
clears their durable policy. Automatic receiver opt-out always remains effective
and may intentionally leave a rollout waiting. The controller must display the
waiting member and its policy instead of changing opt-in. Manually overriding an
update is explicit and must not be presented as this staged automatic workflow.

## Software evidence and remaining gates

`tests/espnow-runtime.py --mbedtls-cache .build/tls-library` compiles the **actual**
rollout handlers/state machine against SHA-verified production Mbed TLS HMAC
primitives. The 32-member fixture covers all arming/lease/coordinator-last steps,
exact-artifact rejection, storage failure at create/arm/reserve/accept/start/
completion, duplicate and lost-response state reads, HMAC tampering, expired and
rebooted permits, same-lease renewal and its storage/duplicate boundaries,
measured-image/boot-health gating, and all release acknowledgments. Production
updater fixtures separately exercise selected/running partition and VALID-state
recovery preflight rather than treating the rollout fixture's external HAL mock
as proof of those SDK checks.
Updater/donation fixtures separately verify the durable Started hook executes
after resource reservation and before any image writes. Client tests exercise
unknown versions/phases, unsigned 32-bit masks, strict proofs/session fields,
bounded commands and URL-encoded request limits.

One packed NVS record is 552 bytes; two records consume 1,104 static bytes plus
existing State callback fields. Group context is statically bounded to 512 bytes
without retaining two duplicate member arrays; no
image buffers or radio-fragment queues are allocated here. The integrated firmware
build/OTA-slot and MCU stack/heap evidence belongs to the main implementation
handoff; this host test is not a physical resource or throughput measurement.

Status truthfully advertises `distributedAutomaticService:false` and
`requiresPhoneOrCoordinatorOrchestration:true`. The production state machine and
update admission hooks are implemented. A durable autonomous coordinator scheduler
that distributes arming/permits/health over radio is **further implementation**,
not a manufacturing prerequisite. The redesigned app also needs to integrate the
explicit orchestration surface and native lifetime handling before offering a
complete unattended fleet workflow. Phone background lifetime is never assumed.

Physical acceptance: keep router/SSID/channel fixed; use one three-lamp canary
group first, then twenty mixed lamps. Record exact pinned artifact/hash and
canonical identity/control snapshots. Keep automatic opt-out on one lamp and
prove no first lease until it explicitly accepts policy; test arming interruption,
offline members, wrong target sessions, power loss before/after Started, transfer
loss and missing final ACK. Measure actual running digest/healthy control after
each follower restart before admitting the next, and coordinator restart last.
Verify the room never has two staged targets updating simultaneously, paused
members retain settings, and interrupted release can resume from durable masks.
Bootloader rollback, real phone foreground/reconnect, power/thermal margins and
RF availability remain separate unpassed physical/native gates. No real lamp
was flashed, reset or reconfigured by these host fixtures.
