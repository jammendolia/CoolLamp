# Bridge access and grouped updates: 13 October 2026 handoff

Scope: keep grouped Corkscrew eligible for trusted bridge updates, simplify saved
Wi-Fi, and provide an understandable Bridges page. Existing in-progress source,
untracked implementation and Git index were preserved. Initial software checks
preceded hardware work. The user subsequently authorized the local canary
installations recorded below. No GitHub access, network configuration change,
firmware publication or TestFlight submission was performed.

## Implemented and verified in software

| Outcome | Implementation/evidence | Remaining gate |
| --- | --- | --- |
| Grouped legacy follower updates | Lamp 1.15.4 admits valid active protocol-2 followers with empty durable rollout records to existing Internet/donor services. No membership/settings rewrite. | Install canary and verify retained group/health; actual donation |
| Protected paused/coordinator states | Paused legacy followers defer; legacy coordinator and expanded staged groups retain admission rules. | Durable autonomous expanded-group scheduler is still further implementation |
| Storage failure honesty | Direct pinned NVS API distinguishes absence from read/type/length failures; failed writes invalidate readiness and report uncertainty until exact readback. | New-image MCU stack/heap measurements |
| Bridge lamp access | Bridge 0.2.2 separate versioned/CRC record, 64 exclusions, boot/revision CAS, four 60-second receipts; policy protects new control/donor requests while preserving reconciliation. | Physical Add/Remove and offline bridge confirmation |
| Bridge setup feedback | Spinners, duplicate fences, focus-preserving polling, durable Wi-Fi completion and signal/name summary, Reconfigure. | Phone/computer browser interaction on installed 0.2.2 |
| Native Bridges page | Lamps/Settings entries, bridge cards, existing household access, nearby unowned setup, pending changes and original receipt checks. Password through native secure storage. | New iPhone/Android builds and physical setup walkthrough |
| Native bridge route | Owner status/descriptor/household/boot checked, then actual target paging/identity; bounded route fallback, no uncertain command replay. | Physical Wi-Fi-to-bridge-to-lamp/native route |
| Saved lamp Wi-Fi | Verified saved name/signal; credential fields hidden until Reconfigure; failed candidates cannot overwrite working saved Wi-Fi. | Native confirmation on each supported transport |
| Existing light/update contracts | Legacy effects/odd geometry/knob/audio/group/OTA regression gate passes; hidden update renderer unchanged. | RF, power/thermal and sustained twenty-lamp acceptance |

Already physically verified before this change: bridge 0.2.1 household enrollment
with real PRG comparison, browser bridge read of Corkscrew, durable bridge cache,
and direct computer-to-Corkscrew Wi-Fi update to 1.15.3 with retained settings.
Those observations do **not** verify new 0.2.2/1.15.4 behavior or bridge donation.
See [historical bench evidence](coollamp-bridge.md).

## Artifacts and resources

Pinned platform: Arduino ESP32 **3.3.11**, ESP32-C3 public build with bundled
NimBLE/FastLED and existing dual-OTA layout. Heltec target is
`esp32:esp32:heltec_wifi_kit_32_V3`, ESP32-S3/8 MiB, CP2102 UART0, native CDC off.
No partition or bootloader change is proposed.

| Build | Actual image / slot / margin | Static globals |
| --- | --- | --- |
| C3 public 1.15.4 | 2,030,864 / 2,031,616 / **752 bytes** | 94,348 bytes |
| C3 diagnostic 1.15.4 | 2,030,192 / 2,031,616 / **1,424 bytes** | 94,340 bytes |
| S3 bridge 0.2.2 | 1,241,840 / 2,097,152 / **855,312 bytes** | 88,584 bytes |

C3 binary SHA-256:
`29407a7532e336cd3cf21de3510123bf5341f119a5d9eb8cdbffc83e03ca31d9`.
Manifest SHA-256:
`4c0a8e9cc13e0d33d5e3cc3875e9055764dd9e0b0c55c893d3b6270fd5e20257`.
Bridge binary SHA-256:
`ef65077b0028de64aa398bc931f7c093f36d153e63218d380849eebb13f3a062`.
Diagnostic C3 SHA-256:
`9c406cd34b8b68f06d7fd2a0b3fde2b4e0bd29b98d877a99385be610cb863916`;
its 120-byte manifest SHA-256 is
`4517cfecd27079f8ef247fd14cbd34880d97507f5d4856e6f871b488438eec7d`.

Local public artifacts are in `.build/experience-legacy-group-final/` and
`firmware/bridge/`. The C3 package is a **prepared, unpublished** artifact;
publisher trust is not newly provisioned and no production signing key exists
in this work. SHA/household trust is not independent publisher authentication.
Diagnostic test images cannot be published and cannot donate their running
unpublished image. Exact copies and final source/bundle hashes are recorded in
`.build/bridge-group-handoff-20261013/evidence.json` before use.

C3 serialization was factored rather than dropping features to fit the slot.
Compiler frames: rollout status 752 bytes (640-byte scratch), proof reply 176,
checked reply 80, result 160, request 1,360. These are individual frames, excluding
caller chains and prebuilt SDK/TLS stack. The 752-byte flash margin is small;
every release must measure its actual binary. New-image physical high-water heap,
largest allocation block and task stack measurements remain pending. Existing
bridge runtime observations belong to 0.2.1, not this build.

Worst production state fixtures: public full state 8,174 bytes, protected full
state 8,131, compact audio 531, expanded sync 3,167. New bridge access status is
bounded to 1,536, with a 64-exclusion fixture of 1,289 bytes. Counts and limits
are independent: 64 local exclusions, 16 radio peers and four hops do not imply
64 simultaneously reachable receivers or arbitrary-hop firmware uploads.

## Completed checks

- **45-command firmware contract gate**, all pass, including actual rollout,
  persistence faults, legacy and expanded 20/32-position simulations, rendering,
  enrollment, HTTP/BLE, donation, receipt and update receiver handlers.
- **21 actual bridge-to-grouped-receiver scenarios**, including opt-out,
  wrong fleet, coordinator/paused holds, dropped data/ACK/final ACK, duplicate
  Finish, corruption, radio loss, lease expiry, uncertain boot selection and
  competing receivers. Host SDK/radio adapters do not prove hardware timing.
- **14 bridge owner/core checks**, all pass: generated page consistency,
  spinners/focus/password/Wi-Fi picker, HTTP/runtime, scans, close-worker stack,
  donation/control, commissioning, lamp compatibility and USB secret erasure.
- **1,875 mobile tests**, all pass, including actual mounted events and main
  bridge discovery/acquisition handlers. Production web build passes with the
  existing bundle-size warning. This does not compile or accept native binaries.
  Tests include broker ownership after opening controls and replacing a borrowed
  mesh leaf. Setup shows numbered color names and explains bridge PRG separately
  from a lamp knob, without changing physical approval or household creation.
- Build provenance matches **132 C3 staged source files** and **62 bridge files**.
  Git index remains SHA-256
  `70e7a4f72696cd7c779ee76aecc0c58329eca0a276c8ebb0c9f995ee5f12a4d8`.

Local evidence: `.build/bridge-group-contract-final-20261013.log`,
`.build/experience-contract-tests.json`,
`.build/bridge-owner-final-tests-20261013.json`,
`.build/bridge-app-final-tests-20261013.log`,
`.build/bridge-app-final-production-build-20261013.log`,
`.build/group-update-public-final-r5-build-20261013.log`,
`.build/experience-artifacts.json`, and bridge build/provenance files.
Some older failed/zero-margin build attempts remain for evidence. They are
superseded; use only the exact hashes above or a separately pinned test image.

## Next physical test and release procedure

1. Obtain explicit authorization for the prepared canary installations. Keep
   router, SSID, channel and group fixed. Verify bridge `8c4856dab734` and
   Corkscrew `5894af4aec24` independently; capture only sanitized settings,
   installed digest, group role/order/pause, health and resource counters.
2. Use a donation-disabled diagnostic C3 image for unpublished bench code. An
   installed 1.15.3 follower still has the old admission gate: one direct,
   authorized application update is necessary to seed the fix. Never leave its
   group just to update. Pin artifact/version/size/hash once, journal dispatch,
   and reconcile a missing final reply before any retry.
3. Install only the bridge application into its verified existing application
   partition. Keep its owner password, household, Wi-Fi and cached C3 artifact.
   Confirm 0.2.2 identity/health and storage readiness after restart. Reuse the
   existing backup; no routine full-flash/NVS erase or partition replacement.
4. In a new native app build, open Lamps → Bridges → Find a bridge, verify its
   card, enter the existing bridge password privately, and read nearby lamps.
   Remove Corkscrew access, then Add it. Compare saved bridge policy/receipts;
   check unchanged lamp/group state separately. Interrupt a reply and use
   Check change, including a bridge restart, without another mutation POST.
5. Test saved Wi-Fi summaries and Reconfigure/cancel on bridge and lamp. Do not
   change the working network during the controlled RF test. Try read timeout,
   multiple clicks, background/return and inaccessible bridge cases. Password
   entry must remain stable; pending access must stay visible.
6. Actual automatic donation needs a **genuinely newer pinned compatible C3
   artifact** than the seeded receiver. Cached 1.15.3 is not newer than 1.15.4.
   An approved artifact/release fixture is a precise prerequisite; never invent
   Latest metadata, publisher signatures or a successful donation. Verify
   receiver auto opt-in and policy, bridge durable original metadata/digest,
   compatible channel overlap, sender ownership and receiver eligibility.
7. Observe amber receiver progress only if it was on at update start. Verify
   exact target version/size/hash and healthy controls after restart, plus
   unchanged group/midpoint/geometry/startup/appearance and return to playback.
   Repeat with opt-out, paused follower, missing coordinator and interrupted
   data/ACK/final ACK. Missing final ACK requires reconciliation; do not resend
   commit or switch installation routes automatically.
8. After one-lamp/canary acceptance, test 20 mixed lamps using bounded multiple
   neighborhoods. Record control p50/p95/p99, frame gaps, synchronization skew,
   dropouts, donor throughput, heap/stack minimum and recovery over a sustained
   hour. Proposed control target: p95 ≤500 ms, p99 ≤1.5 s on the measured viable
   bridge route; proposed non-updating animation frame-gap target ≤100 ms,
   ≤250 ms under controlled failed requests. These are acceptance targets, not
   measured claims. Expanded staged groups still require valid orchestration;
   this follower compatibility lane does not implement a global donor lease.

Publish only after corresponding physical/native evidence and explicit release
authorization. Verify personal `jammendolia` identity and destination using the
directory router; never switch shared credentials. Preserve exact pinned
artifacts/signing policy and existing release checks. Bootloader rollback,
publisher provisioning, twenty-lamp RF, native lifetime and store release
remain separate gates; build success cannot establish them.

## Authorized local installations and observations

The user approved both local images with the phone app closed. Bridge
`8c4856dab734` received the application only in its existing selected slot at
`0x10000`; the installed partition table and OTA selection were checked first.
The existing backup was reused. NVS, cache, bootloader, partition table and OTA
metadata were not written. Esptool verified the image. The bridge retained its
owner password, Wi-Fi, household, update-sharing preference and durable 1.15.3
C3 cache. The user confirmed the saved Wi-Fi summary and Reconfigure display.

Corkscrew `5894af4aec24` received the exact diagnostic 1.15.4 image above through
one prepared computer-file Wi-Fi upload. The final reply was HTTP 200; postboot
identity, installed size/hash and health matched. Comparison of persisted
settings found no changes, including 184 LEDs, midpoint 46, startup Fire at
brightness 100, appearance, audio tuning and saved Wi-Fi. It remains an unpaused
protocol-2 follower of `f0b950b2f180`; automatic updates remain enabled. The user
confirmed normal lighting returned.

The receiver now reports valid update policy, empty durable rollout records,
`eligibility:0`, `groupCoordination:0` and `automaticEligible:true`. Its automatic
Internet attempt is presently held by the existing TLS memory preflight, while
trusted-donor searching remains enabled. Cached bridge 1.15.3 is older than the
receiver's 1.15.4: this installation does not prove automatic donation.

The user initially reported that the bridge's Read lamp state action fails. Read-only USB
diagnostics were added to the bridge and installed under the same bench-test
authorization. This refinement is still version 0.2.2, 1,244,032 bytes, SHA-256
`b458b9b8cffe2dc3f1c0360eb08e5cebc5144e5006385d031065d6838b29bc2b`.
Captured attempts reached Corkscrew and completed with HTTP 200, a 5,529-byte
reply and matching target boot identity; the browser had not consumed the whole
result. Earlier idle captures
preceded the actual button press and do not establish failed admission. No
bridge-read success or actual donation was established by that first refinement.

A second local 0.2.2 refinement adds persistent, accessible progress/error text
beside Read lamp state, plus RAM-only result-query count/offset/status/phase and
elapsed-time diagnostics. It changes no mesh wire format, request admission or
lamp state. Its actual image is 1,245,712 bytes (851,440 bytes free in the S3
OTA slot), 88,648 static global bytes, SHA-256
`f9428e324d3fe2156234550c925bb7c33cf7189af409801f97c7debf0c815d1e`.
The page occupies 29,959/32,768 bytes; conservative maximum diagnostic JSON is
872 bytes in its 1,024-byte buffer. All **16 bridge check commands** pass,
including **22 real production control/AES-GCM scenarios**, **19 actual generated
page scenarios**, and actual Runtime routes/auth/form server/mesh-core paging of
a 5,529-byte response in 22 pages. The new real HTTP paging check is registered
in the contract gate; the original completed 45-command run remains historical,
and is not relabeled as a new 46-command run.

After verified application-only installation, the user opened a new browser tab
and confirmed Read lamp state succeeded, then succeeded again in the same tab
without refreshing. USB data confirms State1 and Effects26 both returned HTTP
200 with matching Corkscrew target boot identity, and complete browser result
collection. The new capture's live state was 5,532 bytes (still 22 pages), and
its catalog was 2,354 bytes. The first captured state/catalog read took
approximately four/two seconds respectively. Repeated Corkscrew reads also
collected the catalog's final page. A separate observed State read addressed
`74b950b2f180` and was still pending after 12.695 seconds at capture end, without
an execution receipt; its final result was not captured. It does not establish
reachability or a successful read of that other target.
This verifies the one-hop browser/bridge/target read on this bench. It does not
identify the earlier collection failure's initiating cause; the restart/new tab
also cleared old state. The earlier “Another mesh request is still active”
message was consistent with an unconsumed retained result. No uncertain
mutation was replayed, no authentication was relaxed and no pending-result
protection was bypassed. Multiple clients, native bridge routing, RF range,
long-running repetitions and actual donor installation remain separate tests.

At receiver uptime 594 seconds, free/minimum heap was 31,344/6,352 bytes, largest
free block 19,444 and minimum remaining loop/cleanup stack 992/1,044 bytes.
Lifetime maximum animation gap was 660.438 ms (one overrun), with 613.219 ms
inside FastLED show. There is no occurrence timestamp, so startup attribution
is unproven. Recent five-second windows had about 21–22 ms maximum gaps and no
overruns. The small stack margin and isolated lifetime overrun remain resource
and timing limitations; this does not pass sustained twenty-lamp acceptance.

Sanitized installation journals, preserved artifact copies, postboot checks and
diagnostic samples are in `.build/bridge-local-install-20261013/`. USB diagnostics
exclude names, SSIDs, credentials, tokens, keys and request/reply bodies. Radio
queue acceptance is not a target execution receipt; unavailable fragment
progress is explicitly reported as unavailable.

## Subsequent automatic donation bench

The controlled bridge test subsequently exposed and fixed a real stale-service
timestamp defect in the receiver handshake, plus startup/retry rollover edges.
The corrected bridge/Corkscrew run successfully installed a genuine local
diagnostic 1.15.5 via automatic trusted donation, retaining the saved settings
and configured follower membership. The group was not actively streaming during
that run. The normal 0.2.2 bridge image and original public cache were restored
afterward. No publication occurred. Exact artifacts, tests, measured resource
and timing limitations, and remaining physical gates are recorded in
[the donation bench ledger](bridge-donation-bench-2026-10-13.md).
