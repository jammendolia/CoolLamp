# Expanded synchronized groups: protocol 3

Implementation handoff, 10 October 2026. This document covers the expanded-group
extension; its filename follows the product's second group contract. The actual
new radio/LAN packet version is **3**. Existing packet version **2** remains the
nine-position compatibility mode. This code has not been flashed or physically
accepted on twenty lamps.

## Source-backed baseline and changes

`LampSyncProtocol.h` retains the exact 226-byte `Packet` and 83-byte `Visual`
layouts. The 32 spatial scenes and Mirror retain their IDs and their renderer in
`LampGroupScenes.h`. The renderer already distributes high-level scene, phase,
beat and spectrum data locally; sending pixel buffers or new fragments was not
necessary. The new renderer bound is 32 positions, independent of physical style,
LED count, center calibration or follower microphone presence. Existing rising
and falling paths are unchanged.

The previous service generated one frame per follower per transport at 25 Hz.
Increasing eight peers to thirty-one without changing that fan-out would create
775 frame submissions per second on each active interface. Negotiated version 3
instead sends **one 226-byte group frame per active interface every 40 ms**, plus
targeted admission/clock replies. That is 5,650 payload bytes/second/interface for
the frame stream; it excludes radio preambles, MAC overhead, discovery, admission,
retries and unrelated services. These are calculated payload rates, not measured
throughput or RF acceptance.

`LampEspNow.cpp` still has an eight-entry callback receive queue, twelve queued
send items, one in-flight transmission, 200 ms send timeout, and a rotating cache
of eight targeted destinations plus broadcast. The SDK table does not have to
hold thirty-one permanent unicast peers. The expanded subscription table stores
compact route/session hints for thirty-one followers. At most four combined
radio/LAN messages are processed per main-loop pass; callbacks only copy bytes.
Latest broadcast frames replace older queued frames rather than accumulating.

## Negotiation and compatibility

The authenticated group status reports:

```json
{
  "version": 3,
  "protocolVersions": [2, 3],
  "maxMembers": 32,
  "maxSupportedMembers": 32,
  "broadcastFrames": true,
  "coordinatorMigration": false,
  "peerTotal": 31,
  "peerCursor": 0,
  "peerNext": 8,
  "peerTruncated": true
}
```

`maxMembers` is the currently configured group's total position limit, including
the coordinator; in compatibility mode it is nine. `maxSupportedMembers` is
firmware headroom. The phone must validate both the requested protocol and the
target's freshly identity-verified capability before changing membership. A
legacy member cannot join a version-3 group: authenticated packets of the wrong
configured version are rejected and counted by `incompatibleSubscriptions`.
There is no silently truncated spatial playback or automatic compatibility
downgrade. A group formed on new firmware can intentionally use version 2 for old
members.

Private invitations are `CL1-<12 hex identity>-<32 hex key>` for version 2, and
`CL3-<identity>-<key>` for version 3. `POST /api/sync` accepts `protocol=2|3` with
the existing role/leader/key form. Absence of protocol retains the old version-2
operation. `configureLampSync(..., protocol=2)` is the loop-owned implementation.
The mobile group modules parse CL3, negotiate advertised capacities and retain
all thirty-two order IDs; legacy CL1 parsing/request bodies remain unchanged.

Group creation uses version 3 only when a fresh status advertises it. Matching
the destination's protocol is required on final membership readback. A missing
acknowledgment is reconciled by a fresh read, never by replaying the membership
mutation over another route. Moving a member still has separate leave and join
outcomes; a confirmed leave followed by a failed join remains independent and is
reported as partial completion. Card deletion is not membership removal.

## Broadcast admission, replay and position fencing

Version-3 followers still subscribe to a specific coordinator identity and its
advertised boot session. A targeted authenticated `ClockReply` must echo the
outstanding subscription time, arrive within the existing 200 ms RTT bound, and
address the follower's fresh random nonce. This establishes the coordinator boot
session and assigns the follower's own position/count. The follower durably saves
that assignment before following; storage failure leaves the prior receiver
state unchanged and increments `slotSaveFailures`. An unchanged slot does not
write NVS on every clock refresh.

A group `Frame` uses `target == session` and `position == 255` as the broadcast
marker. The follower accepts it only after targeted admission, for the locked
coordinator session, with a newer sequence, the admitted count, and the admitted
`groupStart` layout/configuration token. It substitutes its own admitted position
before rendering. A broadcast cannot create a subscription or unpause a lamp.
When membership, order or scene settings change, the coordinator restarts the
shared scene token. Followers wait for a new targeted clock reply before adopting
the changed layout; they never render a newly ordered scene using an old slot.

Radio broadcasts use the existing AES-128-GCM primitives with a new, separate
`CoolLamp scene broadcast v3` HMAC-derived key domain bound to the coordinator's
canonical identity. Their envelope magic is `CLN` followed by byte 3. Per-peer
admission retains the old envelope and pair-specific key. Header/session/sequence
and source MAC/canonical identity are authenticated and checked. A different body
cannot reuse a previous nonce; sequence exhaustion rotates the boot/session nonce
and clears admissions. LAN broadcasts retain group HMAC-SHA-256 authentication.
This remains group-holder authentication, as before; it is not a manufacturer
identity or independent publisher signature.

Frames/audio expire at the existing three-second/200 ms bounds. Lost, duplicate,
reordered, stale-session or malformed packets do not extend following. A reboot
requires new targeted admission. Expanded follower beacon periods are
1,000–1,700 ms, and clock subscriptions are 1,100–1,800 ms, with a deterministic
identity phase to reduce synchronized bursts. These timings need RF validation.

## Durable records and offline/paused positions

The old `syncV1` and `groupSceneV1` record layouts are unchanged. New expanded
configuration uses `syncV2`, containing the original membership record, selected
protocol and paused bit. The order uses `groupSceneV2`, a 427-byte version-2 scene
record with thirty-two 13-byte canonical IDs. `groupSlotV1` is a 16-byte follower
position/count/leader record. Old scene records are validated and migrated in RAM
without deleting or rewriting them. Once `syncV2` exists, the new scene record is
authoritative in either negotiated mode, preventing an old v1 layout from
resurrecting after an explicit return to version 2. A downgrade to older firmware
that cannot read these records is not a supported migration; use a reviewed
service/recovery plan rather than promising transparent downgrade.

Admission writes a newly occupied position only after validation and successful
NVS storage. Offline members are not removed or compacted. Reordering cannot drop
a currently subscribed member, and cannot introduce unknown IDs. Every successful
order save is durable at the coordinator; each reachable version-3 member confirms
its assignment during targeted admission. An offline member's confirmation is
pending until it returns, rather than reported as complete. A full thirty-two
position layout remains full even if most positions are offline.

`configureLampSyncPause()` persists expanded pause before changing runtime state;
a failed save does not report success. Pause retains membership and local light
settings across reboot. Group frames and settings do not resume it; only explicit
local/authorized resume clears pause. Legacy pause behavior remains compatible.
Removing an expanded coordinator is rejected while its durable order contains
followers, including offline ones. Fenced coordinator migration/election is not
implemented. Move followers individually, reconcile their outcomes, then remove
their offline order positions before stopping the coordinator.

## Inventory and mobile integration

Group status carries at most eight peer hints per page with `peerCursor`,
`peerNext`, `peerTotal` and `peerTruncated`. `lampSyncJson(cursor,peerLimit=8)`
caps its limit to 1–8 (zero clamps to one). Dedicated group status and the
protected `/api/sync/page` retain the default eight-hint page. The complete state
reply explicitly requests one hint to leave room for the full production update,
audio, effect and appearance status. Its first page honestly reports next cursor
one and truncation when more hints exist; group page endpoint 47 starts at that
cursor and returns up to eight. Every path retains the complete durable order.
These are current, expiring local route hints, not owned cards or a global fleet
inventory. Pagination is a fresh observation, not an immutable topology snapshot:
deduplicate by verified canonical identity, fence the broker boot, refresh on
reconnect, and never infer ownership from a returned hint. The phone's saved
inventory and several verified brokers provide broader coverage. The independent
control mesh still has sixteen local peers and four forwarding hops.

Version-3 order entries carry canonical `id` and `online`; names are resolved
from the phone's owned inventory instead of repeating thirty-two escaped labels
in every state reply. New UI integration should merge these IDs with its own
verified model/name/artwork records and preserve offline placeholders. `online`
indicates a fresh subscription, not an execution acknowledgment or measured
synchronization quality. Count/microphone/model capability checks belong to the
target/group model; a coordinator-only read cannot certify every member's health.

Control-mesh reach remains distinct from scene-stream reach. Expanded synchronized
frames require direct coordinator overlap on a compatible channel or working LAN
broadcast reachability. ESP-NOW cannot cross incompatible channels, and UDP cannot
bypass client isolation. There is no multi-hop scene forwarding in this extension.

## Software evidence and resource bounds

The repository runner `tests/espnow-runtime.py --mbedtls-cache .build/tls-library`
builds the real `LampSync.cpp`, `LampSyncRadioCrypto.cpp` and `LampEspNow.cpp`
handlers against the SHA-verified pinned Mbed TLS sources. Existing legacy suites
pass. `sync-expanded-runtime.cpp` exercises thirty-one distinct follower
identities, thirty-one actual adapter destinations with the driver cache at most
nine, old/new incompatibility, single broadcast cadence, every-byte broadcast
tampering, separate key domains, failed admission/save, persistent pause/reboot,
boot/layout replay fencing, missing/offline positions and ordering, plus all
thirty-two scenes at twenty/thirty-two positions and 1/3/205/1024-LED geometry.
The fixture exercises deterministic host service behavior; it does not emulate
radio airtime, RF loss, phone OS lifetime or wall-clock MCU rendering cost.

Measured host structure sizes: packet 226 bytes; visual 83; compact peer 176;
31-peer table 5,456; scene record 427; follower slot 16. Production static asserts
limit each peer to 192 bytes (table at most 5,952) and scene config to 432 bytes.
The encrypted frame remains 226 bytes, below the supported 250-byte radio bound;
there are no new streaming fragments or pixel buffers.

`tests/control-http-adapter.py` extracts the actual state/group serializers and
production update/audio producers and checks the real 8,192-byte BLE response
ceiling with all 47 effects/colors/options, 32 order identities, 31 local hints
but one returned in complete state, and 48-byte fully escaped peer names.
An earlier 7,202-byte fixture had incomplete update/audio mocks and was not a
valid complete-state budget: real rich producers measured above the response
ceiling with eight hints. The complete-state one-hint budget and exact final
measurement are recorded in the main resource handoff. The radio fixture proves
default eight/requested one, next-cursor continuation and identical full order.
Allocator high-water marks still require the main resource/physical gate.
The focused mobile group/discovery/lighting suites pass
including negotiated 32 limits, incarnation fencing and safe legacy fallback. The overall mobile
production build and actual firmware flash/OTA-slot/stack report belong to the
main implementation handoff, not this host-size evidence.

## Confirmed group dissolution

New firmware advertises `sync.dissolutionV1:true` and an opaque sixteen-character
lowercase hex `sync.session` for both compatibility protocol 2 and expanded 3.
The token is a synchronization session, rotates after a prune/reboot/sequence
retirement, and must not be presented as stable hardware identity.
`sync.incarnation` is a stable, nonsecret 32-character lowercase hex group
identity: the first 128 bits of HMAC-SHA256 with the saved random group key over
`CoolLamp group incarnation v1` followed by the twelve-byte coordinator identity.
It survives reboot/prune/order changes and changes when a group is recreated with
a new key. It conveys no reusable group authority and is absent when independent.
`POST /api/group/remove` (protected endpoint 52 over BLE/HTTP) accepts exactly
`target`, `order` and `session`. `order` is the complete expected comma-separated
durable order. The coordinator compares the exact order and current session,
saves removal of that one non-coordinator identity, then rotates the session so
a delayed old Subscribe cannot resurrect the departed member. Invalid requests
return 400, conflicting snapshots 409, failed persistence 500. A target already
absent returns 200 with `alreadyAbsent:true`, an idempotent absence check.
Version-3 ordinary ordering cannot shorten membership, including offline slots.

The owner controller must first dispatch departure to the **target**, then read a
fresh identity-verified target snapshot confirming saved independent/moved state.
Only that confirmation authorizes prune; a broker delivery ACK or last-seen
inventory entry does not. The authenticated prune call is the owner's assertion
of that read; firmware does not claim an independent distributed target attestation.
Concurrent new membership must be handled as a fresh operation after conflicting
order/session/readback, never guessed from radio presence.

`Groups.dissolve(id)` performs sequential follower departures and coordinator
prunes, preserving local power/effect/colors/geometry/microphone/startup settings.
It demotes the coordinator only after a fresh durable order contains self alone.
Offline/unauthorized/unconfirmed targets return `phase:'dissolution-pending'`,
`coordinatorStopped:false`, and per-target pending records; snapshots expose
`pendingRemovalIds`. Reopening removal reads retained order again; no offline
position is silently removed. A concurrent added position remains explicitly
pending. `stopCoordinating` uses this negotiated workflow. Older firmware without
the contract retains its old demotion behavior; callers requiring complete
confirmed dissolution must use `dissolve`, which explicitly rejects that firmware.

Follower `leave` and `move` release target/destination connections before source
cleanup. A confirmed last follower departure prunes and demotes the source;
destination join failure still cleans the source and reports the target's honest
independent state. Unreachable source cleanup returns `sourceCleanup.pending:true`
and preserves its visible order. All removal paths permit a one-member source;
any two-lamp creation minimum belongs exclusively to creation UX.

`Groups` accepts `loadRemovalIntents` and `saveRemovalIntents` callbacks (synchronous
or Promise-returning). The shipped client wires them to `LampStore`'s existing
phone inventory storage at `coollamp-group-removals-v1`. The version-1 record is
`{version:2,sources:[{source,targets,dissolve,incarnation}]}` with canonical IDs and
the nonsecret group fingerprint only: at most
64 sources, at most 31 target IDs per source and 32,768 UTF-8 bytes. No group key,
invitation, password, route address or phone authority is retained. Malformed or
over-limit records fail closed; the model never silently evicts another pending
removal or an owned lamp. Version-1 records migrate in memory to an unknown
incarnation (`''`), retain all target IDs, and cannot authorize a current group's
departure/prune/demotion. No fresh fingerprint is inferred from coordinator ID,
name, radio session or the current order.

Intent is saved before the first departure. Confirmed target prune clears only
that target; direct dissolution retains its coordinator intent until demotion and
fresh readback. Storage failure leaves the original durable intent visibly
pending. If the final phone save fails after demotion, reopening removal verifies
the independent coordinator and clears intent without repeating the demotion.
An already stopped coordinator cannot clear unreachable follower confirmation.
`reconcileRemovals(source)` resumes a saved explicit dissolution, or freshly reads
each prior leave/move target before source cleanup. A target still following the
source remains pending. App startup and refresh never automatically replay a
mutation. Integrations omitting both callbacks report
`removalIntentStorage:'session'`; the actual shipped construction uses durable
callbacks. Snapshots also report `loading`, `ready` or `failed` and
`dissolutionPending`, allowing the redesigned UI to show honest stored work.

A retained dissolution uses only its original saved target set. Concurrent new
members are reported as `pendingAdditionalIds`/`needsReconfirmation`; ordinary
retry never promotes those IDs into authorized departures. A recreated or unknown
group returns `needsReconfirmation:true` before mutation and preserves the intent.
The snapshot also exposes `removalNeedsReconfirmation`. The concrete UI integration
is to refresh the current coordinator, show its current members and request a new
explicit removal approval, then call
`dissolve(id,{reconfirm:true,expectedIncarnation:reviewedSync.incarnation})`.
`expectedIncarnation` is mandatory and must match the fresh verified response
before intent is saved or any lamp changes. New departure/demotion commands also
send the optional `expectedIncarnation` field on `/api/sync`; the main-loop
`configureLampSync(...,expectedIncarnation)` checks exact 32-character lowercase
hex and the current fingerprint immediately before mutation. Recreating a group
after the last phone read but before command execution therefore rejects the
stale command without persistence or membership changes. HTTP/BLE/mesh share the
same handler; malformed fences return 400 and a conflicting fingerprint 409.
Legacy omission retains its existing behavior. Ordinary saved-intent retry continues
to use `reconcileRemovals`; its generic retry confirmation does not authorize a
new group. Reconfirmation retains unresolved original target IDs rather than
silently dropping them. Each target still following this coordinator must match
the newly authorized incarnation before automatic departure; an old-incarnation
target remains pending until an explicit fresh per-lamp departure is confirmed.

The production sync fixture checks prune order/session conflicts, save failure,
idempotent absence, retired subscription replay, last-follower coordinator stop
and persistence after reboot. Mobile fixtures additionally check followers-first
ordering, local-state preservation, offline pending/retry, one-member removal,
last-follower moves with failed/successful destination joins, lost prune/stop ACKs,
unconfirmed target reads, concurrent additions, app restart, bounds/malformed
storage and storage failures before departure/after prune/after final stop,
stable fingerprint across reboot/prune, recreated-group rejection, unknown v1
migration and concurrent newcomer reconfirmation.
Real phone/RF dissolution
acceptance remains pending.

## Physical twenty-lamp acceptance: pending

Prepare twenty actual lamps, then thirty-two if available, with mixed physical
styles and odd LED counts. Keep the existing router/SSID/channel configuration
fixed. The canonical acceptance thresholds and observation duration are in
[`experience-physical-acceptance.md`](experience-physical-acceptance.md); use that
procedure for pass/fail, rather than independent numerical gates in this contract.
Record canonical identities, firmware digest/partition, group protocol,
position, calibration and microphone presence. Use one suitable coordinating
microphone; followers must pass sound playback without microphones. Hardware
installation, resets and credential changes require the user's separate approval.

1. Compare a version-2 nine-lamp baseline and a version-3 twenty-lamp group under
   the same topology. Record sustained minimum/free/largest heap, loop and audio
   task stack high-water marks, main-loop latency and packet-drop counters for
   the canonical observation window. Require no watchdog/reset, heap drift or leaked subscriptions;
   retain at least the measured baseline's accepted margin and define numeric MCU
   stack/heap gates from that baseline before authorizing fleet rollout.
2. Measure target-confirmed power/brightness control latency on real iPhone and
   Android phones using the canonical command count/latency gates on the intended
   local route. Report uncertainty separately from
   failures; no missing receipt may become confirmed success.
3. Film Portal, Prism split and shared beat/audio scenes with an independent
   high-frame-rate reference. Measure inter-lamp skew, visible availability and
   sustained frame starvation beyond the existing three-second fallback bound
   against the canonical gates. Report RF packet loss separately from visible
   dropout; these are acceptance targets, not achieved values.
4. Remove power from intermediate ordered members; preserve all positions and
   offline placeholders. Pause selected followers, reboot them, and confirm group
   controls do not resume them. Reorder with an offline member, restore it and
   verify its durable fresh assignment before synchronized playback.
5. Hold router settings constant while testing Wi-Fi loss, unchanged-channel BLE
   control, short scans, DHCP delay, control mesh forwarding, and group-stream
   recovery as separate variables. A genuine three-node control route does not
   certify synchronized scenes beyond direct coordinator overlap. Repeat coexistence
   with authorized firmware preflight/donation/phone transfer; update ownership
   must suspend streaming safely and recover afterward.
6. Lose the coordinator, verify follower fallback to saved local light within the
   existing timeout, then restore the same identity and verify fresh boot/session
   admission. Attempt coordinator removal and an old-member join; both must report
   explicit incompatibility/protection. Repeat the entire run at thirty-two lamps
   without changing the negotiated limit to conceal capacity or RF failures.

Only after these measurements pass should the app promise a twenty-lamp coherent
room. Native phone interoperability, RF range, diffuser cue accessibility, power
and thermal margins, updater coexistence and production rollout remain separate
acceptance gates.
