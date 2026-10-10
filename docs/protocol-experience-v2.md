# CoolLamp experience contracts: unpublished 1.15.0 candidate

This document describes implemented source interfaces. The five documents under `docs/design` remain a design proposal and historical audit. No lamp was flashed, router changed, firmware published, remote pushed or store submission made in this implementation.

## Baseline and compatibility

The initial checkout was 1.14.0 with extensive modified and untracked firmware/mobile work. Those implementations were retained. Canonical identity remains `lampIdentity()`; friendly names, addresses, model, style and group membership do not replace identity. Existing 47 wire IDs/names/order, 38-effect no-microphone catalog, rising/falling geometry, 1–1024 LEDs, six-second pairing, setup hotspot, ten-second reset, authenticated HTTP, bonded BLE, mesh and donation services remain.

Catalog v1 and `/api/defaults` keep their original behavior. The new APIs use new endpoint numbers rather than altering existing packet or settings records. All shared handlers run on the Arduino loop. Radio callbacks retain bounded copy/queue behavior. Main-loop receipt/session fencing supplements the existing transport transaction rules.

## Integration surface

HTTP Basic authentication and the boot token remain required on administrator HTTP reads/writes as before. Bonded encrypted BLE invokes the same registered handlers. Mesh only permits its explicit allowlist; an authenticated bridge response is not a target execution result. POST queries below are read-only despite using the form-bearing BLE RPC method.

| HTTP path | Endpoint | Purpose |
| --- | ---: | --- |
| GET `/api/descriptor` | 40 | Verified identity, extensible model, actual hardware, negotiated capabilities and limits |
| POST `/api/effects/schema` | 41 | `kind=effects|scenes&offset=0&count=4`; at most four entries and 4096 bytes |
| POST `/api/state/patch` | 42 | Absolute partial light preview with target/session/ID/revision fencing |
| POST `/api/appearance/save` | 43 | Atomic durable memory for one effect, independent of startup settings |
| POST `/api/receipt` | 44 | Read original target execution/persistence outcome |
| GET `/api/revision` | 45 | Small fresh light snapshot, boot session, revision and next command ID |
| POST `/api/firmware/policy` | 46 | Read or revision-fenced durable quiet/defer policy |
| POST `/api/sync/page` | 47 | Eight group-neighborhood hints per page; full durable order stays present |
| POST `/api/household` | 48 | Administrator status/invite/revoke; invitation secrets require confidential ingress |
| POST `/api/household/challenge` | direct HTTP | Public challenge or adoption proof; neither discovery nor an unsigned response creates ownership |
| POST `/api/household/control` | direct HTTP | Scoped HMAC-authorized command with authenticated response |
| POST `/api/firmware/rollout` | 51 | Explicit durable staged rollout orchestration |
| POST `/api/group/remove` | 52 | Fenced coordinator removal of a confirmed departed follower |

The shared request limit remains 1024 bytes and reply limit 8192 bytes. Forms reject duplicates, malformed UTF-8, control characters, unsupported fields and excess fields. The private household HTTP wrapper has an explicit 2048-byte decoded-envelope bound, 1024-byte inner body and 8192-byte reply; base64 wrapping bounds the direct HTTP response below 12 KiB. It is not a BLE or generic mesh tunnel.

### Model and schemas

`LampModel::Record` is a versioned manufacturing/service record in namespace `lampmodel`, key `descriptorV1`. It stores bounded extensible model ID, display name, artwork family and hardware revision. `LampModel::provision` has no remote endpoint and never changes LEDs, geometry, microphone, current budget or calibration. An unprovisioned lamp reports `custom`, generic artwork and `preconfigured=false`. Production provisioning must explicitly install validated metadata; a style or name does not prove finished hardware. Unknown model IDs survive storage and parsing, and unknown artwork falls back to generic without replacing the reported identity. The separate namespace survives user reset.

Schema v2 keys are stable semantic keys plus device-local IDs. Parameters specify integer range/step/default/units and semantic roles; palette data specifies modes, RGB bounds/defaults and color roles. Solids omit motion/intensity parameters; Prism split exposes its fixed palette; density/activity coupling is explicit. Automatic spectrum behavior remains until custom color selection. VU and Fountain use their real three-role dedicated palette endpoints; their per-effect options remain separate. Scene requirements describe coordinator microphone and protocol requirements, rather than requiring microphones on followers or filtering by style. Recommendations never imply compatibility. Unknown keys/types are data only: the client preserves identity and uses verified generic controls, never executable metadata or guessed effect mappings.

`mobile/src/experience-contracts.js` validates bounded production metadata and exposes `LampExperienceSession`. Existing BLE/HTTP/mesh request maps recognize new endpoints. The redesigned visual app is not implemented by this change.

### Partial preview, drafts and durable appearance

Get a fresh revision before opening a draft. A draft binds exact target and boot session. Submit only fields the user changed:

```text
target=<canonical ID>&bootSession=<16 hex>&commandId=<nextCommandId>
&expectedRevision=<decimal>&scope=lamp&brightness=80
```

Supported partial fields are `mode`, `power`, `brightness`, `speed`, `intensity`, `dual`, primary `r/g/b`, secondary `r2/g2/b2` and `resetPalette=1`. Values are absolute; omitted fields retain their current values, including concurrent knob state. Validation finishes before applying anything. Palette reset preserves motion speed and intensity. Active followers and spatial-scene scopes reject independent tuning; pause/use-alone is a separate explicit action. Drafts live in the phone and previews live in RAM. There is no hidden lamp draft allocation or automatic startup save.

Appearance save uses the same fence plus `mode=<local ID>`, and writes exactly one 24-byte NVS item `lookNN` under `coollamp`. Twelve bytes hold version/mode, primary enabled/RGB and speed/intensity/secondary options; twelve hold an exact canonical baseline of that effect's legacy record. Legacy records are lazy migration input; the v2 overlay loads afterward. A legacy save also refreshes existing v2 overlays. On upgrade after a downgrade, a changed legacy baseline wins and is durably rebased, preventing a later old color from resurrecting stale accepted v2 data. Only changed existing records are rebased, at most 47. A failed rebase preserves the newer legacy values in RAM and reports `compatibility.appearanceMigrationPending:true` until a successful reload/rebase.

Unchanged saves do not write; changed dedicated saves are limited to one every two seconds. A failed write is reconciled by reading the exact item: confirmed new bytes mean persisted, confirmed prior bytes mean `save-failed`, and unreadable or ambiguous storage means `uncertain` with null execution/persistence evidence. A missing reply never permits replay over another route. These per-effect saves never write startup mode/brightness. VU/Fountain palettes retain their existing independently durable records. Group appearance remains shared coordinator scene configuration, not invented per-scene memories.

### Receipts and state freshness

The loop-owned ledger retains the last eight terminal receipts for at most two minutes. Commands allocate monotonically increasing 64-bit hex IDs from the fresh snapshot's `nextCommandId`; competing phones reconcile collisions rather than choosing arbitrary random IDs. The ledger hashes canonical decoded fields and endpoint. Same ID/content returns its original outcome; same ID/different content rejects. Old/evicted/expired IDs cannot execute again because of a per-boot high-water fence. Missing receipts and mismatched boot sessions return `uncertain`, not “not executed.” Revision rollover rotates the boot fence before reuse. Millisecond lifetime comparisons tolerate timer rollover.

Outcomes distinguish `rejected`, `executed`, `persisted`, `save-failed` and `uncertain`. A successful volatile preview is not persisted. A failed durable save may have been attempted, but is not acknowledged as saved. Snapshot observation compares exact bounded lighting bytes, including legacy phone/knob changes, before CAS. Routes do not maintain independent revisions.

`LampExperienceSession` sends each mutation once. Loss pins the original command; another verified route may query its receipt. Reconnect always obtains fresh target metadata/state. If a reboot or eviction makes history irrecoverable, an explicit `retireUncertainAfterSnapshot` returns the still-uncertain historical operation plus fresh state and releases the lane; it does not replay or claim the old operation succeeded. Poll small revision snapshots and fetch full state only on a changed revision/session. Existing legacy reset/enrollment/member/install APIs retain their own transaction/finalization rules and must not be automatically replayed by a route broker.

### Quiet-policy commands

Endpoint 46 reads with `action=read&target=<ID>&bootSession=<session>` and returns a verified `{version:1,target,bootSession,policy}` wrapper. Saves use the command envelope above plus `expectedPolicyRevision`, `window`, `startMinute`, `endMinute`, `timezone`, `deferDuringUse` and `idleSeconds`. The envelope's `expectedRevision` fences the fresh command lane; `expectedPolicyRevision` independently fences the durable policy record. Bare unfenced saves are rejected. `LampExperienceSession.readUpdatePolicy()` must precede `saveUpdatePolicy(fields,policyRevision)`; its retained draft binds the verified boot and revision, preventing a policy draft from crossing a reboot. Both negotiate the capability and send once; lost replies use the same receipts. A failed NVS API return is reconciled against exact fresh durable bytes. Confirmed new data is accepted, confirmed prior data is `save-failed`, and ambiguous storage is `uncertain` and blocks automatic update admission until repair/reload. No startup or light field is changed by a policy save.

## Separate scale and trust services

See [expanded groups and dissolution](protocol-groups-v2.md), [update authenticity/policy/resume/rollout](protocol-updates-v2.md), and [commissioning/household authority](protocol-commissioning-v2.md). A phone merges authenticated local neighborhood snapshots from several brokers. Each mesh node still has sixteen presence slots and four forwarding hops; neither is a global owned-inventory ceiling. Group streaming uses its own negotiated direct broadcast service, not generic four-hop control flooding.

Household application credentials grant light control, not administrator/fleet/password/native-bond authority. A protected BLE-origin private invite can traverse new trusted mesh bridges using the authenticated method flag reserved only for endpoint 48. Plain HTTP cannot synthesize that context; private result paging is also confidential-origin gated. Legacy targets reject the extension. Native encrypted credential storage exists; authenticated confidential phone-to-phone invitation exchange still needs platform integration. Removal of a card is not revocation, and unreachable lamps remain pending. Native bond revocation and administrator/fleet transfer remain distinct from revoking a household light credential. Physical reset clears user authority and preserves hardware/model/trust material according to their separate storage contracts.

## Validation and release gates

`tests/experience-runtime.py` runs actual shared handlers, real appearance storage code and the pinned SHA implementation, then parses their exact serialization with the production mobile parser. Coverage includes startup independence, migration, failed storage, stale knob/phone revisions, duplicates, route-independent receipts, timer rollover, reboot/expiry/eviction, malformed forms, future models, 47 effect schemas and 33 scene entries. Group, commissioning, household, BLE/update/donation and native-client tests exercise their own production state machines. Host tests do not establish radio timing, native authorization, accessibility or real heap margins.

The final evidence, unresolved implementation versus external prerequisites and physical sequence are recorded in [implementation ledger](experience-implementation-ledger.md) and [physical acceptance](experience-physical-acceptance.md). Unattended distributed rollout, automatic first-phone factory enrollment, manufacturer identity, production public roots/signing, native invitation exchange and actual faulty-image rollback must not be inferred from descriptor existence or software tests.
