# Commissioning comparison v2 and household light authority

Implementation record, 10 October 2026. Firmware/main-loop code is authoritative. This document describes new production handlers and their mobile integration surface, not a shipped setup screen or physical accessibility certification.

## Existing behavior retained

`LampCommission.cpp` already advertises an unclaimed newcomer over ESP-NOW, performs committed P-256 key reveal, binds broker/target identities, boot sessions, request ID and fleet fingerprint, derives separate direction keys, and requires the target's physical knob click before saving fleet trust. Discovery does not create ownership. The target must have no fleet, saved Wi-Fi, BLE bonds, configured group, setup hotspot or conflicting operation. BLE bond-enumeration failure now conservatively makes the lamp ineligible instead of looking like zero bonds.

Six-second blue pairing, three-second setup hotspot and deliberate ten-second red reset remain compatible recovery paths. The knob approval path does not toggle power, pause a group or persist appearance. Existing factory-reset recovery preserves physical LED/power/midpoint/microphone/style settings and clears user authority; its typed-style interruption tests remain applicable.

Existing first-phone BLE pairing uses the pinned Arduino/NimBLE secure-connections bonding setup with no display/input. It is not manufacturer-authenticated identity enrollment. Newcomer mesh commissioning still needs an already-owned broker. This change does **not** claim automatically discoverable, MITM-resistant first-phone setup with one click. That requires a phone-side authenticated commissioning exchange and validated physical comparison, or provisioned manufacturer QR/NFC identity with real manufacturer trust material. No manufacturer key was fabricated.

## Negotiated physical comparison

New lamps alternate their existing `CCA\x01` advertisement with `CCA\x02`, at the existing bounded 250 ms advertisement cadence. There is no second advertisement packet per cadence. Both versions keep the existing packet length/layout. Brokers remember the highest supported comparison version within the same advertised target boot session, and clear it on a new session. The discovery row adds `comparisonVersion` and `targetBoot`; older consumers can ignore these fields.

Existing callers use comparison v1. A new consumer explicitly requests:

```text
POST /api/mesh/enroll/start
target=050302010002
broker=040302010002
requestId=0000000000000001
comparisonVersion=2
```

The broker rejects unsupported versions, unsupported targets and attempts to change the comparison version of the same request. There is no automatic downgrade. `CCO`, `CCB`, `CCT` and `CCE` use byte 3 to distinguish v1/v2; their lengths remain 112/193/193/64–96 bytes. The selected v2 byte is also included in the transcript hash, so changing the packet version fails transcript/key verification. V1 transcript and HKDF output prefixes remain compatible. The longest commissioning packet is still 193 bytes, below the shared 250-byte radio bound.

The status envelope remains `version:1`. V2 adds:

```json
{
  "brokerBoot": "0000000000000042",
  "targetBoot": "0000000000000043",
  "comparison": {
    "version": 2,
    "entropyBits": 24,
    "semanticKey": "commission.color-counts.v2",
    "symbols": [1,4,7,12,8,15],
    "checkSymbol": 11,
    "cycleMs": 58000,
    "pulseOnMs": 350,
    "pulsePeriodMs": 700,
    "countPeriodMs": 3400,
    "symbolPeriodMs": 8000,
    "approvalRequiresFullCycle": true
  }
}
```

Clients calculate and validate the check symbol. `LampCommissionCue.h` is the production timing/count/CRC implementation. `mobile/src/commissioning.js` validates its data-only contract.

Six independent four-bit symbols are derived from the authenticated HKDF output: **24 bits**, compared with v1's four colors/16 bits. Each symbol is displayed as its existing color and two counts of one through four pulses: `first = 1 + (symbol >> 2)`, `second = 1 + (symbol & 3)`. Owners compare the same six count pairs and colors. A seventh CRC4 check symbol uses polynomial `x^4 + x + 1` with initial value zero and detects every single-bit transcription change. The check symbol adds error detection, not entropy. An independently substituted transcript has a nominal one-attempt 24-bit comparison collision probability; this is not a human success-rate measurement or unlimited-retry security claim.

Each pulse is on for 350 ms within a 700 ms period, below 1.5 Hz. Two count groups take 6.8 seconds, followed by a 1.2-second symbol gap; seven symbols plus a two-second ending gap total 58 seconds. The existing session lifetime is 120 seconds. Target approval remains unavailable until a complete rendered cycle has elapsed. A rendering gap exceeding 200 ms restarts that rendering gate. Elapsed wall time alone, without rendering the cue, cannot authorize a click. Main-loop service/cue ownership and radio callback copy bounds are unchanged.

This is a color-independent visual equivalent; it does not serve a person who cannot see the lamp. Assisted comparison/manufacturer identity remains required for that case. Validate real diffuser contrast, pulse discrimination, screen-reader count presentation, flash behavior and comprehension with older novice users. A 58-second cycle is an engineering candidate, not validated effortless setup.

`MeshOnboarding.start(candidate,{comparisonVersion:2})` opts into v2 and publishes a frozen complete comparison through `onStatus.comparison`. It pins discovery targetBoot and status brokerBoot/fleet fingerprint, rejects changed bindings, and preserves the original request for reconciliation. Existing UI remains v1 until it renders all six symbols and the check pair. Displaying only the first four colors during v2 would weaken the check and is forbidden. A Yes button cannot synthesize physical approval.

## Household phone authorization

`LampHousehold.h/.cpp` implement a separate eight-record light-control credential registry. An invitation supplies a fresh random 128-bit per-lamp/per-phone secret, never the legacy access password or owner-fleet key. The administrator provisions each intended member deliberately. Phone IDs are eight-byte, nonzero opaque identities; they are not BLE addresses or display names. A different phone gets a different identity/secret. A cloned invitation is the same credential, not a second independently revocable phone.

The versioned `householdV1` NVS blob is 464 bytes under `coollamp`. It uses explicit little-endian fields, validation, duplicate-ID checks and CRC32. No existing settings record changes. A single whole-blob write is read back before success. A verified old record gives `StorageFailure`; unknown or corrupt readback gives `Uncertain` and disables registry operations until a verified reload. Malformed existing storage is never overwritten with an empty success state. User reset clears this user credential record; factory/model/publisher trust retention is governed by their separate hardware/trust contracts.

Records are pending, active or revoked. Invite/adopt/revoke retain one last durable operation receipt per phone. Same original request can reconcile a completed adoption/revocation without another write. Other expired receipts do not establish absence. Invitation lifetime is 120 seconds within the original lamp boot; reboot or expiry invalidates pending adoption. Adopted credentials persist across reboot. Explicit revocation zeros the key, increments its epoch and fences every old proof/session. There is no silent eviction when eight records are occupied, including revoked records. The administrator can re-invite the same revoked phone identity with a fresh key/epoch; replacing a different identity at full capacity needs an explicit future pruning/service policy.

Household light-control permissions deliberately exclude administrator/network/hardware/reset/private-invitation/update-install authority. Allowed ordinary mutations are scene/order/power/preview/color/effect options/revision-fenced partial state/appearance save. Schema/receipt/group pagination use their existing form-read mutation envelopes. The source allowlist is authoritative. Phone revocation does not revoke a separately held legacy admin password, fleet key or native BLE bond. Do not give these administrator secrets to a phone intended to be individually revocable.

`LampHouseholdAdapter.ino` exposes these bounded routes:

| Route | Authorization / meaning |
| --- | --- |
| `POST /api/household`, `action=status` | Existing administrator; registry revision/counts/limits only. |
| Same route, `action=invite` | Protected BLE RPC directly or through a target-verified trusted mesh bridge; phone, requestId, expectedRevision; returns a private invitation. Plain HTTP cannot return the secret. |
| Same route, `action=revoke` | Existing administrator; phone, requestId, expectedRevision; reports durable or failed/uncertain result. |
| `POST /api/household/challenge`, `action=challenge` | Public bounded challenge for an existing pending/active phone; no secret. |
| Same route, `action=adopt` | Original invite request ID and transcript-bound HMAC proof. |
| `POST /api/household/control` | Direct HTTP, per-phone HMAC request and authenticated target reply; nested ordinary endpoint/body only. |

Admin RPC is endpoint 48. Public HTTP household control is a dedicated path, not arbitrary mesh firmware/control tunneling. Direct BLE ordinary control still requires the native bond; its single active connection and three-bond SDK capacity are separate from the eight application credential records. A Wi-Fi-reachable lamp with a grant can be adopted by a second phone without pairing that second phone to the lamp or resetting it.

Invitation creation for lamps enrolled through mesh can use an already-bonded BLE bridge without bonding individually to every member. The source derives confidential ingress from the protected BLE RPC context; plaintext HTTP cannot synthesize it. Only endpoint 48 uses method bit `0x80` in the authenticated mesh request payload. The target propagates that bit into its private handler context, verifies identity/session through the existing mesh request/reply protocol, and gates invitation export on `controlConfidential()`. Both bridge and target need this extension; old targets reject the unfamiliar method safely. A missing/partial route remains not yet granted, not shared successfully. `controlActive` alone is deliberately insufficient.

### Canonical proof framing

`targetMac` is the natural-order six-byte STA MAC encoded as 12 lowercase hexadecimal characters. `deviceId` is the repository's canonical reverse-byte identity. Clients verify the relation and expected grant identity. Phone ID and nonce are direct hexadecimal byte arrays. Boot/request are 16-character lowercase hexadecimal integers encoded little-endian in the cryptographic transcript. Epoch, sequence and status use little-endian integers.

Challenge JSON contains `version`, `deviceId`, `targetMac`, `phone`, `epoch`, `bootSession`, `nonce`. Invitation JSON additionally contains `secret`, `requestId` and `expiresAtUptimeMs`. Only the authenticated confidential invitation channel transfers `secret`.

Every proof is HMAC-SHA256 with the 16-byte phone secret:

```text
adoption:
  UTF8("CoolLamp household adoption v1")
  target[6], boot[8], phone[8], epoch[4], nonce[16], invitationRequest[8]

command:
  UTF8("CoolLamp household command v1")
  target[6], boot[8], phone[8], epoch[4], nonce[16], sequence[4], request[8]
  endpoint[1], method[1], SHA256(exact nested body UTF8)[32]

response:
  UTF8("CoolLamp household response v1")
  target[6], boot[8], phone[8], epoch[4], nonce[16], sequence[4], request[8]
  status[2], SHA256(exact plaintext response UTF8)[32]
```

Request bodies are at most 1024 bytes. Responses are at most 8192 plaintext bytes and are carried as canonical base64 in the direct-HTTP signed response envelope (`bodyEncoding:"base64"`). A client caps the entire envelope at 16384 UTF-8 bytes, base64 at 10924 characters and decoded plaintext at 8192 bytes. The reply is authenticated before UTF-8/JSON application parsing. Request HMAC alone is insufficient: a forged unsigned HTTP 200 must never confirm execution or target identity. This contract provides integrity/authentication over local HTTP, not payload confidentiality.

The target authorizes only increasing, nonzero per-phone sequences within its current boot/session. Exact latest proof replay returns `Duplicate`, without executing the nested handler. Older retained/expired requests require target command-receipt or fresh-state reconciliation. A reboot fences old proofs. `signResponse` signs only a current active epoch/session and the last accepted request/sequence/proof. Application authorization does not imply executed/persisted state; nested target receipts retain that distinction.

### Mobile integration

`mobile/src/household.js` provides the production WebCrypto framing, `HouseholdVault` and serialized per-target `HouseholdClient`. Its crypto tests match golden outputs from the production C++ implementation using archive-verified pinned mbedTLS. Instantiate the vault with the existing native `credential(id,value)` adapter and `isNative:true`; browser/session/localStorage fallback is rejected. Records are keyed by exact target and phone identity. Native counter blocks reserve 64 sequences durably before use, avoid a storage write for every light change, and prevent replay after app restart. Reimporting the same grant preserves its sequence high-water mark.

```js
const vault = new HouseholdVault({credential, isNative});
await vault.importAuthenticated(nativeInvitationExchange);
const client = new HouseholdClient({
  http: CapacitorHttp, vault,
  deviceId: selected.id, phone: importedPhoneId, address: selected.address
});
await client.adopt(); // one adoption submission, then fresh signed target state
const snapshot = await client.control(1, 1); // verified result before owned card
const change = await client.control(42, 2, exactRevisionFencedPatchForm);
```

The required native invitation exchange must implement `sendAuthenticatedInvitation(grant)` / `receiveAuthenticatedInvitation()` and prove an authenticated confidential phone-to-phone channel. No transport implementation is fabricated here. Ordinary clipboard, screenshots, generic URLs and plaintext HTTP are not such a channel. The existing iOS Keychain and Android Keystore-backed `credential` implementations are reused; device tests must still verify locked-device, denied-access, reinstall and backup behavior. Transient byte buffers are wiped; JavaScript immutable strings/WebCrypto internal key objects rely on native/runtime lifetime and are never logged.

`HouseholdClient.adopt()` creates authority only after a signed fresh state read. Lost adoption ACK reconciles with that read; it does not retry adoption on another route. Lost light command reply returns uncertainty, with no mutation replay. Public unsigned rejection cannot become an authenticated execution result. `removeFromPhone` returns `{removedFromPhone:true,revoked:false}`. Fleet revoke/owner transfer must collect per-member durable receipts; an unreachable member remains authorized until its revocation reaches it, or it is physically transferred/reset. An administrative password/fleet compromise still requires independent rotation plus partial-member accounting; per-phone key revocation cannot fix leaked shared administrator credentials.

## Validation and resource evidence

Baseline passed before affected changes: 21 real P256/HKDF/AES-GCM commissioning scenarios, five actual BLE callback tests and actual knob regressions. Current coverage:

| Test | Software verification |
| --- | --- |
| `tests/commission-runtime.py` | 30 real two-node production state-machine/crypto cases: v1 retention, commitment/session/wrong target, no remote approval, NVS failure, lost Finish/reconciliation, v2 downgrade, all pulse symbols/CRC, unrendered/stalled cue, rollover and wire/JSON bounds. |
| `tests/bluetooth-runtime.py` | Six actual callback/storage tests: encrypted/bonded/generation fences, capacity refusal, storage failure, partial verified phone deletion and no implicit old-bond eviction. |
| `tests/household-runtime.py` | 14 production HMAC/storage cases: golden frames, all proof bytes/bindings, endpoint privilege restriction, duplicates, reboot, revocation, rollover/expiry, full capacity, failed writes/readback, invite/adopt/revoke durable commit interruptions, every-byte corrupted record and user reset. |
| `tests/factory-reset-runtime.py` | All 43 existing request/recovery/cleanup power-loss boundaries, typed physical-style retention and safely retryable storage failures. |
| Mobile commissioning/onboarding tests | 30 tests of actual parser/onboarding state: complete comparison, target/broker/fleet fences, no silent downgrade, lost replies/cancel/recovery, secret redaction and old client compatibility. |
| Mobile household tests | Seven tests: C++ crypto vectors, required native/confidential sharing, signed authority confirmation, forged reply/session/identity/base64 bounds, lost mutation without replay, durable sequence leases and storage failure before submission. |

Worst-case production serializers measured 4940 bytes for eight fully escaped adversarial discovery candidates and 864 bytes for v2 status with the maximum escaped failure reason, within the real 8192-byte BLE/mesh response bound. Commissioning max wire is 193 bytes. Host structures measure Session 736 bytes, eight candidates 1024 bytes, Keys 74 bytes; embedded layouts are measured from the firmware ELF/build separately. Household static storage is one 464-byte record plus eight bounded runtime auth records; one write/readback has two simultaneous 464-byte stack buffers across caller/callee. HMAC framing adds bounded ~112-byte buffers and reuses pinned crypto. These are static/host figures, not measured live heap/stack margins. Direct HTTP's base64 reply temporarily adds up to ~11 KiB and requires hardware heap-margin acceptance.

The focused mobile production Vite build passed on Windows using authorized build escalation after sandbox Node realpath failures. Firmware/full-suite/resource results are recorded in the main implementation handoff. No lamp flash, factory reset, router/SSID/channel change or publication occurred for this work.

## Physical acceptance before enabling the promise

1. Keep the existing router/SSID/channel arrangement constant. Record each test lamp's canonical identity, firmware digest/version, model, saved-state snapshot, BLE bond count and separately verified control/group/update reachability. Use isolated fixtures, not an existing owner's credentials, for reset/revoke experiments.
2. On a real iPhone and Android phone, exercise blue six-second recovery, three-second setup and ten-second reset separately. Test first-phone authorization, denied/revoked OS permission, one active BLE connection and saved-phone reconnect. Do not treat this as first-phone one-click commissioning acceptance.
3. With one owned broker and a fresh unclaimed target, start v2 through protected BLE and then Wi-Fi/mesh broker routes. Verify target/broker boot sessions and exact request, observe all six count pairs/check symbol, and click once. Confirm receipt and fresh exact-target fleet possession before adding its owned card. Log timings/outcomes without keys or challenge plaintext from unrelated sessions.
4. Test wrong target/session/fleet, interrupted key reveal, delayed/reordered duplicates, lost approval/Commit/Finish, reboot and cancellation after possible commit. Reconcile the original session or exact target state; verify one trust write, no overwritten ownership/Wi-Fi/group/hardware, and no remotely generated approval.
5. Observe v2 with older novice/color-vision participants and VoiceOver/TalkBack at large text sizes. Test glare, low brightness, diffuser geometry and count readability. Measure pulse periods with a sensor/camera; verify no render stalls under knob/radio/USB activity. A nonvisual equivalent needs a validated assisted or manufacturer-identity path.
6. Using an actual authenticated confidential native invitation channel, generate per-lamp grants through bonded BLE directly and through a target-verified confidential mesh bridge, import into the second phone's native vault, adopt over local Wi-Fi and confirm signed state. Test a mesh-only target with no administrator BLE bond and prove a plaintext Wi-Fi bridge cannot export its invitation. Test new/old bridge/target combinations with explicit unsupported outcomes. Do not pair/reset the second phone at each granted lamp. Test locked vault, app restart, node restart, stale invitation, eight records, a ninth refusal and three native bonds/fourth refusal.
7. Revoke only the sharing phone's application key on an online fixture, verify denial after restart, and test a temporarily unreachable member. Its retained authority must remain explicitly unresolved. Separately test native bond cleanup/legacy credential rotation where those authorities were granted. Local card removal must not report revocation.
8. For owner transfer, use the existing explicit physical/direct reset contract on each isolated fixture; verify typed hardware/model/trust retention according to their records and no old user/fleet/phone authority. An unreachable member cannot be declared transferred. Secure non-destructive fleet-wide ownership transfer is not implemented by a local card-delete action.

All physical/RF/native/accessibility acceptance above remains pending. Software tests do not establish signal range, phone interoperability, measured control latency, human comparison accuracy or whole-home confidential sharing readiness.
