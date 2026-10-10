# Update contracts added on 10 October 2026

This is a source contract and software-validation record. It does not authorize a release, production signing, lamp flash, router change or native store submission. The visual prototype remains illustrative. The integration/build ledger records the final combined image and digest separately; do not use the generated signing fixtures as firmware for a lamp.

## Baseline and preserved behavior

At initial inspection, source was firmware 1.14.0 on Arduino ESP32 3.3.11, ESP32-C3, NimBLE and the repository's reduced-buffer pinned Mbed TLS build. The integrated implementation is version 1.15.0. `tools/build-firmware.cjs` uses `esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=no_fs`. The pinned `no_fs.csv` contains NVS at `0x9000`/`0x5000`, OTA metadata at `0xe000`/`0x2000`, app0 at `0x10000`/`0x1f0000`, app1 at `0x200000`/`0x1f0000`, and coredump at `0x3f0000`/`0x10000`. Each OTA slot is **2,031,616 bytes**.

Already present and retained: explicit persistent automatic-update opt-in, default off; exact offered-version HTTPS manifest revalidation; full image hash/chip/SDK validation before inactive-image boot selection; one updater resource owner; protected bonded BLE receiver; four-frame bounded data windows with written-offset acknowledgments; and a distinct authenticated same-channel firmware-donation service. Generic multi-hop control mesh carries no firmware uploads. A Wi-Fi association or control-mesh sighting does not prove an update route.

Legacy BLE `Start=2` retains disconnect-aborts-transfer behavior. Existing OTA-1 manifests and their separate fleet/HTTPS trust remain available on unprovisioned firmware. Publisher-signed mode is explicitly reported and requires immutable provisioned **public** keys; none is invented in this checkout.

## Lamp-resident quiet policy v1

`LampUpdatePolicy.h/.cpp` validates and encodes one 84-byte, versioned, canonical CRC32-protected record under `coollamp/updatePolicyV1`. Policy saves replace that single blob, advance a persisted revision only after successful NVS write, and reject stale expected revision, exhausted revision, malformed fields and updater ownership conflicts. The loop owns mutations. Defaults preserve prior automatic behavior: no window and no use deferral; automatic opt-in remains a separate existing setting.

Fields are `window`, `startMinute`, `endMinute`, `timezone`, `deferDuringUse`, `idleSeconds`, plus read-only `revision`. Minutes are 0–1439; enabled intervals must differ and are half-open. An overnight 22:00–06:00 interval is `[1320,1440) ∪ [0,360)`. Idle deferral is 1–86,400 seconds. Normal user control and physical knob activity call `noteLampUpdateUse()`; group playback frames do not become continuous owner interaction.

Timezone is a bounded 63-character POSIX TZ string with explicit DST transition rules when DST is present. Accepted examples: `UTC0`, `CST6CDT,M3.2.0/2,M11.1.0/2`, `CET-1CEST,M3.5.0/2,M10.5.0/3`, `IST-5:30`. This is not an IANA timezone database; the native app must resolve its chosen timezone into supported explicit rules and update changed civil-time rules. Abbreviations require 3–16 ASCII letters; offsets use ±0–14 hours with optional minutes; DST rules use `Mmonth.week.weekday[/hour[:minute]]`. Unknown timezone forms are rejected, never guessed.

Window admission requires UTC time at least 1,700,000,000 and a successful local-time conversion. With unknown wall time, an enabled window waits. Use deferral uses rollover-safe monotonic elapsed time, clears an elapsed use marker, and restarts without an invented civil clock. Policy storage-open/read/corruption failures set `policy.valid=false` and disable automatic admission; toggling automatic opt-in cannot activate an unreadable placeholder. A failed write reopens read-only storage: confirmed exact new bytes accept the save, confirmed prior bytes/absence report failure, and unreadable or different bytes report uncertainty. Before returning revision/JSON or accepting another save, uncertainty reconciles a valid stored record into accepted policy/TZ/revision. A stale RAM revision therefore cannot overwrite a durably committed revision after a lost storage acknowledgement. Unreadable storage blocks further saves; known corrupt storage requires deliberate owner repair. Reconnect reads `/api/firmware` policy/revision before composing another save; it never treats a lost reply as permission to overwrite a newer policy.

Automatic admission also checks group coordination independently of the quiet policy. An independent lamp follows its existing opt-in policy. Every grouped lamp, including a paused follower, waits for a verified staged lease; the coordinator needs its coordinator-last permit. A version-2/legacy group waits for an explicit bootstrap/coordinated migration rather than silently installing concurrently. This gate covers automatic HTTPS and receiving donation; it does not disable ordinary donors or explicit manual Update now outside an armed ticket. Once an install owns resources, permit expiry does not cancel a potentially executed operation. Manual and automatic starts still require exact-artifact eligibility and a durable Started fence when a ticket exists.

`policy.eligibility` remains the quiet-policy result. Additive `policy.groupCoordination` is 0 for independent/valid staged admission, 1 for a required stage, 2 for legacy bootstrap/coordination, 3 for unavailable rollout storage, and 4 for an unavailable, expired, rebooted or mismatched permit. `policy.automaticEligible` is true only when both policy and coordination permit new admission. The app parser exposes these as `automaticAdmission` and returns null for earlier v2 snapshots lacking the fields. A ready admission is not proof that the discovered HTTPS artifact or donor offer matches the lease; the existing artifact fence verifies that separately before mutation.

`lampAutomaticUpdateAllowed()` gates both HTTPS automatic admission and donation offer/receiver admission. Manual **Update now** overrides the quiet/use policy while respecting authorization and updater ownership. Window expiry does not abort a valid installation already writing; explicit opt-out still stops unfinished donation as before. Response eligibility codes: ready 0, automatic disabled 1, active use 2, clock unknown 3, outside window 4, invalid policy 5.

Authenticated `/api/firmware/policy` is integrated through the common firmware control adapter. Its identity, boot, request and receipt fencing follows the new command contract. A successful reply denotes persisted policy, not installed firmware. `/api/firmware` additionally exposes policy, publisher enforcement, resume limits, and boot-health gate. Follow the common protocol document for the exact form envelope rather than bypassing target fencing.

The unified JSON contract advertises `updateContractVersion=2`, receiver-only `route` (0 none, 1 internet, 2 direct Bluetooth, 3 donation, 4 unpinned service upload), actual `writtenOffset`, pinned `totalBytes` (0 unknown), and `checkedAt` in the current boot's millis clock. Route describes the last receiver operation, not generic phone connectivity. `parseUpdateStatusV2` exposes these bounded fields without inferring internet viability from Wi-Fi association or installed/control health from transfer percentage. Every reconnect verifies fresh identity/boot/state and treats older/malformed snapshots through negotiated legacy compatibility.

## Publisher-signed artifact v2

`UpdatePublisher.h/.cpp` verifies P256 ECDSA with SHA-256 using the actual pinned Mbed TLS primitives already available for commissioning. An OTA-2 manifest is nine canonical LF-terminated lines, no optional whitespace or executable metadata, within a 288-byte buffer. The largest valid canonical text is 280 bytes, with maximum version components/size/security epoch:

```text
COOLLAMP-OTA-2
major.minor.patch
esp32c3
dual-ota-2031616
decimal-image-bytes
64-lowercase-hex-image-sha256
decimal-security-epoch
8-lowercase-hex-key-id
128-lowercase-hex-signature-r-then-s
```

The signature covers the exact UTF-8/ASCII bytes of the first **eight** lines, including their trailing LF. Signature is raw 32-byte `r` followed by 32-byte `s`, matching WebCrypto P256 ECDSA; it is not DER. Version components are canonical 0–65,535. Size is 288–2,031,616. Epoch is 1–4,294,967,294; the maximum uint32 value is reserved for fail-closed storage state. Key ID zero is invalid.

The pinned helper accepts explicit `--publisher-trust=<public-only JSON path>`. `tools/publisher-trust.cjs` rejects unknown/private fields, malformed/off-curve public points, duplicate IDs, more than four keys, invalid epoch ranges and an uncovered initial floor; it stages only a generated immutable public header and combines provisioning with the existing flavor flags. Exact original JSON and generated-header SHA-256 provenance is recorded in `.build/publisher-trust-{flavor}.json`. Default builds keep their existing flags and no publisher root.

The JSON shape is `{version:1,minimumEpoch:1,keys:[{id:"00000042",firstEpoch:1,lastEpoch:9,publicKey:"04...128 lowercase hex coordinate digits..."}]}`; real IDs/epochs/keys require explicit production review. Lower-level service/test builds can select a public-only header with `COOL_LAMP_PUBLISHER_TRUST_CONFIG`, declaring up to four `UpdatePublisher::TrustedKey` entries and `publisherMinimumEpoch`. Unknown/duplicate key IDs, malformed public points, signatures, wrong chip/layout, old epoch, old firmware and ambiguous/corrupted text fail verification. A normal signed repair can reinstall the current version; arbitrary older firmware requires an explicitly controlled service/recovery route.

Provisioned HTTPS mode requests `coollamp-manifest-v2.txt`, while legacy mode keeps `coollamp-manifest.txt`. Installation rereads the exact offered release/version URL and requires unchanged artifact **and signed metadata**. Do not replace Latest after approval. BLE accepts signed text through the existing bounded manifest-fragment path. Provisioned receivers reject unsigned metadata before erasing/reserving the update image. The raw legacy HTTP-upload path is blocked under publisher enforcement until a signed-upload contract exists.

After SHA/SDK image validation, original signed text is retained under `lamptrust/pubManifestV2` and the security floor advances under `lamptrust/pubEpochV1`, before boot selection. These values live outside the user-reset namespace. A storage failure prevents boot selection. An interruption after the epoch ratchet but before boot selection may require a signed repair at that or a later epoch; it must not silently lower trust. Compiler public roots survive user reset, as do retained trust records. They are immutable to the user-control protocol, not hardware immutable: Secure Boot/eFuse provisioning and a physically protected bootloader have not been established here.

Key rotation uses overlapping approved immutable public slots and explicit epoch validity ranges in a new trusted firmware. Never activate a development key. Production requires a reviewed offline authority/key-rotation process, custody of production private keys outside the repo, provisioned public key IDs/epoch ranges, signed immutable release assets, a compromised-key recovery authority/service procedure and Secure Boot policy where hardware attack resistance is required. Compromise of a currently permitted signing key cannot be solved by household/fleet authentication. This checkout supplies no fabricated production trust policy or private key.

`tools/development-signing-fixture.cjs` creates a new ephemeral **test** key, canonical manifest and synthetic image under ignored `.build/publisher-fixtures`; `--relay` creates a full synthetic donor fixture in its own subdirectory. Its private key is untracked and is never an embedded/app trust root or release artifact. Production activation remains blocked until the external public-key/signing prerequisites are reviewed and supplied.

## Signed firmware donation

The existing AEAD, peer MAC, boot/session/sequence, same-fleet and explicit receiver automatic-policy checks remain. A new body kind `SignedOffer=7` is additive; older parsers reject it safely. The body is exactly 123 bytes, yielding a **155-byte** encrypted radio packet within the existing 250-byte transport limit:

| Bytes | Meaning |
| --- | --- |
| 0 | Kind 7 |
| 1–6 | Three uint16 little-endian version components |
| 7–10 | uint32 little-endian image size |
| 11–42 | Image SHA-256 |
| 43–50 | Nonzero uint64 donor offer token |
| 51–54 | uint32 security epoch |
| 55–58 | uint32 publisher key ID |
| 59–122 | Original raw P256 signature |

A donor incrementally measures its actual running public image. It retrieves original retained signed metadata, verifies its publisher signature and requires exact installed version, measured size and hash match. It reconstructs canonical metadata carrying the **original** signature; it never signs a running image with a household key. Missing original metadata or a mismatch makes the signed donor unavailable. Provisioned receivers reject unsigned offers, reconstruct and verify the signed metadata before requesting/reserving a receiver, then verify transferred bytes again. A malicious same-fleet donor cannot forge publisher authority. Existing Data/Ack/Finish shapes and bounded retries remain unchanged. Signed manifest text uses at most two queued manifest fragments plus Start in the eight-frame queue.

`LampFirmwareRelay::runningManifest(out)` reports the verified measured installed artifact only after hashing/metadata validation completes; false is unknown, not failure or a fabricated digest. Its bounded incremental measurement also runs on an independent public lamp without fleet enrollment or an active donor radio, allowing exact postboot confirmation without inventing donor eligibility. Measurement waits during updater ownership/commissioning; offers and transfer admission still require their fleet/radio gates. The relay status reports `signedOfferVersion=2`, `publisherEnforced`, `signedImageReady`, and the current `donorEligible` admission result. While an explicit rollout pins a synchronized group, its coordinator suppresses new donation offers/requests and reports `coordinatorDonationHeld=true`; this keeps the coordinator available to play and orchestrate the staged rollout. Ordinary donation outside an armed rollout retains its existing behavior. Same-channel, direct-neighbor donation is distinct from generic multi-hop control reach. Public builds can donate; a development build cannot invent a public marker or publisher metadata.

## Opt-in BLE transfer lease

The 20-byte status version and old fields are retained. Flag bit 0 remains committed; bit 1 remains the four-frame data capability; bit 2 advertises the lease extension; bit 3 denotes a retained detached receiver. Existing clients ignore the additive flags and keep `Start=2` behavior.

`StartWithLease=6` has the same eight-byte header as Start and explicitly opts into in-RAM retention. Only a bonded/encrypted direct BLE caller can use it; radio donation does not acquire a BLE lease. Unexpected disconnect while Receiving retains the unfinished inactive-image handle, hash context, validated prefix, exact version/size/SHA and written offset for at most **120,000 ms** from the first detach. Wrong requests neither abort a valid lease nor extend expiry. Normal connected inactivity remains 30 seconds; the complete receiver session is bounded to one hour even if a peer keeps sending tiny valid chunks. Explicit Cancel erases the lease. Restart loses the lease; durable across-reboot offset recovery is not advertised.

`Resume=7` is exactly 50 bytes: the existing header `[version=1, op=7, session:uint32, request:uint16]`, followed by size:uint32 at 8, SHA-256 at 12–43, and version:uint16[3] at 44–49. It requires MTU at least 53. The original nonzero receiver session plus full artifact tuple must match a still-detached lease, and the new generation must be currently bonded/authorized. Session is a collision fence, not a replacement authorization credential. Queued old-generation packets cannot continue after handoff. A successful resume acknowledges the **receiver's retained written offset**; subsequent data begins there without Start/manifest/image replay.

Finish remains a single commit boundary. Restarting status survives disconnect until scheduled reboot; repeated Finish/Cancel/data cannot select boot again. A lost final reply requires exact target/installed-version and fresh control-health reconciliation. It is never a resumable Receiving lease and never authorizes another Finish through another route.

The narrow client API is:

```js
const prepared = await downloadSignedPhoneFirmware(http, {
  publisherTrust, expectedManifest, isCurrent, signal, onProgress
});
// Target identity and native authorization are verified by the owned transport lane.
await transfer.send(prepared, {enableResume: true});
const lease = transfer.getResumeLease();
// After a new protected identity check and fresh receiver status:
await replacementTransfer.send(prepared, {resumeLease: lease});
```

`prepareSignedPhoneFirmware` independently verifies signature and image and brands a prepared package internally; a caller's boolean cannot bypass signature verification. `send(prepared)` remains the legacy behavior. The current visual app is not replaced, and resume persistence/foreground re-entry UI must consume this integration surface deliberately. Native app background/cancel rules remain authoritative; explicit app cancellation sends Cancel and removes the lease. Do not promise unattended phone updates or resume after reboot, cancellation, expiry, a different target, insufficient MTU or final commit.

The existing owned transport lane forwards `updateOverBluetooth(prepared,onProgress,{enableResume,resumeLease,onLease,signal})`, repeats protected target identity verification and binds any emitted `firmwareResumeLease` to that canonical identity. A different target is rejected before mutation. A dropped link may emit the bounded lease on the thrown error and through `onLease`; a cancelled/committed transfer does not. Native secure storage, background scheduling and the redesigned resume prompt are separate release integration gates.

## Boot health and resource bounds

`LampUpdateHealth` now requires 30 seconds of continuous main-loop service, at least 128 observations and no gap over one second before marking a pending image valid. It handles millis rollover. `lampBootHealthy()` and `healthGate=loop-continuity-v1` mean that gate passed; they do not certify RF, audio, effect geometry, physical knob response or phone interoperation.

The pinned ESP32-C3 `dio_qspi/include/sdkconfig.h` defines `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=1`, and Arduino 3.3.11 supports deferred confirmation through `verifyRollbackLater()`. That proves the SDK configuration used for this build, not the bootloader physically installed on a lamp. No automatic recovery promise is made until a compatible installed bootloader/partition image and a deliberate faulty-but-valid application test establish rollback. No new partition layout is proposed for OTA installation.

`LampUpdateAttempt` independently prevents automatic reinstallation of an unconfirmed exact artifact on firmware that supports this contract. The reset-retained `lamptrust/otaAttemptV1` record is 188 canonical bytes: magic `CLA1`, version 1, count, two reserved zeros, four 44-byte version/size/SHA tuples (unused tuples zero), then CRC32. At most four unconfirmed artifacts are retained without eviction. HTTPS, direct BLE and donation validate the complete image, retain original publisher metadata/epoch if applicable, then durably record the exact attempt **before** boot selection. Failed attempt storage blocks boot selection. Duplicate same-artifact preparation consumes no extra slot/write. Automatic HTTPS/donor admission refuses a recorded tuple; explicit manual repair of that same tuple can proceed through the existing ownership/rollout fences.

A record means boot selection or health is unconfirmed. It cannot distinguish interruption just before selection, a lost final reply, an interrupted boot or an actual rollback, and never claims rollback occurred. Only continuous loop health, explicit SDK VALID image state and the incrementally verified exact running version/size/hash can remove the matching entry durably. Failed healthy-clear retries occur at most once per 60 seconds; different running bytes cannot clear another artifact. A full record blocks new artifacts until a recorded artifact is explicitly repaired and proven healthy. An unreadable/corrupt record requires an explicitly authorized service/bootstrap repair; it is never silently cleared or evicted. The legacy raw service upload remains explicit and does not fabricate an exact attempt from unknown metadata.

`/api/firmware.attemptGuard` reports version 1, storage readiness, unconfirmed count/capacity, `sameArtifactRequiresManual=true`, `rollbackProven=false`, and `candidateReason`: 0 ready, 1 exact unconfirmed artifact, 2 full ledger, 3 unavailable storage. This is separate from quiet/group admission and installed bootloader proof. The narrow app parser exposes it or null for earlier snapshots. Firmware 1.14 and earlier do not enforce this record: disable their automatic receiver policy before the first candidate, use the explicit bootstrap/service route, and verify the supported guard before enabling automatic updates. Installing an app alone cannot retrofit guard enforcement into an older rollback image.

New fixed allocations include the 288-byte BLE manifest text (96 additional bytes), a 288-byte pinned HTTPS signed candidate, two bounded typed signed-donation metadata records, one policy and a small continuity tracker. BLE queue remains eight copied frames, each at most 244 bytes; data window remains four; status remains 20. Donation keeps 250-byte packets, 201-byte data payloads, 20-second inactivity and 15-minute total transfer bounds. Publisher parser uses a bounded 288-byte stack text copy plus the pinned P256 library's measured allocations; no unbounded catalog or firmware buffering is introduced on the lamp. Missing/mismatched donor metadata waits one minute before repeating incremental hash work. Signed-offer verification is rate-limited to one P256 attempt per second to bound a compromised same-fleet sender's loop workload.

The production-header host layout probe reports `FirmwareManifest=44`, signed `Manifest=116`, `TrustedKey=80` (four slots at most 320), `Policy=76`, encoded policy record=84, `LampUpdateStatus=36`, BLE frame=252 and its nine-slot/eight-capacity queue=2,276, cue cadence=16, and loop-health tracker=12 bytes. Attempt retention adds four manifests at 176 bytes plus bounded counters/mutex; its exceptional save path has three 188-byte buffers plus a 176-byte caller snapshot. Policy readback/reconciliation uses fixed 84-byte buffers. Internal typed records are not serialized by raw structure copy; their canonical/wire formats retain explicit lengths. These static layout figures are separate from the embedded final globals/map and measured heap/stack budget.

The final build/map ledger must supply actual binary/OTA margin and static RAM delta. Runtime `/api/firmware` already reports free heap, largest block, worker-stack and loop-stack high-water marks. Physical acceptance must record them through signature verification, maximum reply/RPC activity, writing, radio donation and postboot recovery; host stack sizes do not establish C3 stack/heap margins.

The helper's optional `--stack-usage` emits compiler `.su` files for compiled C/C++ sources in the isolated build cache. These are per-function static compiler estimates, with bounded/dynamic annotations where applicable; they exclude prebuilt SDK/TLS archives and are not a measured call-chain/RTOS-stack guarantee. Keep runtime measurements separate.

## Temporary local update light

An installing receiver may display a subtle amber progress cue. It is a temporary local overlay, has no effect ID/catalog/schema entry, and sends no group frame. A donor and other group members never acquire a receiver cue merely from donating/following. A release-availability check and postboot-health checking alone do not display it.

Power eligibility and brightness are captured on the loop when the update operation is accepted. **A lamp that was off at admission stays dark for the entire operation, even if its state later changes.** An on-at-admission receiver uses its captured brightness capped at 40/255, and the existing configured FastLED current limiter. Prewrite/unknown-total phases breathe gently without a made-up percentage; a known exact artifact shows a growing folded-strip height band driven by actual confirmed flash writes, then gentle breathing during verification/restart. The legacy BLE transfer offset retains its existing accepted-prefix semantics for compatibility; new `writtenOffset`/progress data and this cue wait until the complete validated prefix is actually written.

`LampUpdateCue.h` supplies bounded integer geometry/cadence and `LampUpdateCue.ino` runs only on the main loop, before the ordinary updater rendering guard. It uses the existing scratch frame, restores all RGB bytes after each display, allocates nothing, and does not change Mode, power, palettes, geometry or persistent settings. Cadence is at most 10 Hz with a four-second gentle breath; 1–1024 and odd counts are supported. The current physical cue appearance/brightness remains a diffuser acceptance test, not a firmware-test claim.

The cue is supplied by the running receiver firmware. Installing this candidate from an older image does not retroactively add an animation to the older updater. Physical cue acceptance starts after the candidate has booted and been verified, using another exact approved artifact or an explicit same-version repair.

## Software validation and remaining gates

Run with the pinned compiler/runtime and a workspace-local TEMP/TMP on Windows:

```powershell
. ./tools/windows-env.ps1
$env:TEMP=(Resolve-Path .build/experience-temp).Path
$env:TMP=$env:TEMP
g++ -std=c++17 -Wall -Wextra -Werror -I. tests/update-policy.cpp LampUpdatePolicy.cpp -o .build/update-policy.exe
.build/update-policy.exe
python tests/update-policy-runtime.py
python tests/update-attempt-runtime.py
python tests/update-handoff-runtime.py
python tests/update-cue-runtime.py
python tests/rollout-recovery-preflight.py
python tests/ble-update-runtime.py
python tests/ble-update-radio-runtime.py
python tests/update-publisher-runtime.py
python tests/update-publisher-receiver-runtime.py
python tests/firmware-relay-runtime.py
python tests/firmware-relay-runtime.py --publisher
node --test tests/publisher-trust.test.cjs
node --test mobile/tests/update-contracts-v2.test.js mobile/tests/bluetooth-firmware*.test.js mobile/tests/firmware-fleet*.test.js
```

Production handler tests cover NVS prior/new/uncertain writes, revision reconciliation after commit-then-failure, save/reboot/corruption, opt-out/unknown clock/window/monotonic rollover, loop continuity, 31 receiver scenarios including legacy disconnect, exact-artifact lease recovery, total lifetime/manual rollout/attempt-storage guards, six radio handoff scenarios, real P256 every-byte metadata/signature tampering/epoch/key/downgrade, six provisioned flash-receiver scenarios and retained reset-surviving original metadata, 22 legacy donation scenarios, and 27 signed donation scenarios. Signed donation adds malicious same-fleet signature/artifact, unsigned offer, absent metadata and running-image mismatch rejection before OTA begin. Independent/unpaired measurement is exercised with donor radio unavailable and no transmitted offer. Actual attempt-ledger tests cover every-byte record corruption, read/open/write/commit boundaries, reboot and simulated supported rollback state, exact healthy clearing, four slots, reset retention and no silent eviction/duplicate writes. Updater tests bound failed healthy-clear retries to 60 seconds and refuse pending SDK state. Group admission tests assert no automatic OTA start without coordination and preserve explicit manual admission outside a ticket. Coordinator donation tests distinguish the armed rollout hold from ordinary donation. All automatic and manual pinned updater paths exercise rollout eligibility and a failed durable Started fence, asserting no image write occurs before successful reservation/fencing; manual only bypasses the quiet/use policy and exact-artifact quarantine for explicit repair. Existing data/ACK/final-ACK loss tests continue to drive actual production donor/receiver state machines. The mobile suite verifies the new protocol without claiming native throughput or accessibility acceptance.

Externally pending: approved production public roots/private signing custody/rotation and compromised-key service policy; immutable signed production release assets; real ESP32 heap/stack/timing and installed bootloader rollback; real iPhone/Android foreground, permission and reconnect behavior; finished-lamp RF/coexistence/power/thermal testing. Across-reboot BLE transfer resumption is intentionally unsupported. Durable group rollout/ticket/lease behavior is documented by the rollout module separately: protected phone/coordinator orchestration arms every member, pins one artifact, reserves one member and updates coordinator last; an uncertain Started lease is reconciled before reuse. Automatic radio ticket dissemination is not claimed. Grouped automatic installs conservatively wait for protected orchestration rather than updating concurrently without a ticket.

For explicit renewal of the **same** Started artifact/target/lease, updater-owned `lampRolloutRecoveryPreflight` must prove no request, updater, receiver or restart is pending; configured boot selection exactly equals the running flash partition; running OTA state is explicitly VALID; the loop/control state is healthy; and the incrementally measured installed digest is known and different from the pinned artifact. Missing/undefined boot metadata, pending verification, changed boot selection, ongoing work or already-installed bytes cannot produce a retry proof. The rollout module binds that proof to the current boot and preserves its original lease; it never turns an expired/uncertain lease into a different target. Legacy devices without a verified VALID OTA state require the explicit bootstrap/service route.

## Controlled physical acceptance and recovery

1. Obtain explicit authorization for the exact signed/legacy application artifacts and service fixture. Record each lamp's canonical identity, installed version/build, hardware geometry/count/current budget/microphone/style, startup/appearance/group settings, automatic policy, running slot, partition table and installed bootloader hash. Capture a recoverable NVS/firmware baseline. Keep router/SSID/channel settings fixed.
2. Prove quiet gating on one lamp: automatic off never installs; enabled unknown-time window waits; before/start/end/overnight boundaries and DST transitions match the configured rules; real knob/phone use defers; manual Update now overrides; a donor cannot bypass receiver policy. Inject NVS save failure and power loss before/after the single policy blob commit; read the actual revision and old/new policy without guessing.
3. On a real iPhone and Android, verify exact protected lamp identity, permission/native accessory path and foreground lifetime. Transfer one pinned image while showing written bytes only. Interrupt before Start, during prefix/body, after the last data ACK, and during final reply. With an opted-in lease, reconnect the same target within 120 seconds at MTU≥53 and verify the returned offset/image tuple; do not replay uncertain data. Wrong artifact/target/session, explicit Cancel, expiry and lamp power cycle must not resume. After possible Finish, only reconcile installed version, identity and fresh control state.
4. Test separate same-channel donation using a signed donor with original metadata, then with absent/mismatched original metadata. A same-fleet test sender must be unable to alter signed size/version/hash/epoch/signature. Drop data/ACK/final ACK; receiver validates bytes and selects once. Record group interruption, resource ownership and receiver quiet/opt-out behavior. Do not infer multi-hop donation from control-mesh reach.
5. Before a first candidate on firmware lacking the attempt guard, turn its receiver automatic policy off and bootstrap a supported prior image through the explicitly authorized service path. Then verify real bootloader rollback on a sacrificial/backup-protected fixture with an intentionally valid image that fails continuity before confirmation. Power-cycle during pending verify, validate selection of the supported prior app, exact hardware/user-state preservation, retained exact attempt, and no automatic reinstallation of that artifact. Test interruption before/after boot selection and a healthy exact running image clearing only its own entry. Require explicit repair after an unconfirmed attempt; exercise storage failure and full-ledger service prerequisites. If the installed bootloader/layout cannot support rollback, use the explicitly authorized USB/service migration; never try to install a new layout as an ordinary app OTA.
6. Release rehearsal uses a pinned artifact, one independent canary, then one follower at a time. Reconcile each target's exact artifact and healthy control before advancing; offline/paused positions stay recorded. The coordinator goes last only through the explicit durable rollout contract. Failed or uncertain started installs block automatic path retry until reconciliation. Preserve opt-out and a signed same/current-or-later-epoch repair path. No release is published by these tests.

Record latency, written throughput, reconnect interval, signature verification time, free/largest heap, loop/update stack minima, watchdog/reset reasons, retained settings and recovery outcomes. Passing host tests or compilation does not supply any of these physical measurements.
