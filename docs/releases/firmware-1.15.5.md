# CoolLamp firmware 1.15.5

This release improves the firmware receiver used for phone Bluetooth updates
and fixes automatic trusted-donor transfers that could stop before sending
their first request. Valid, unpaused legacy group followers can receive an
automatic update while retaining their membership and individual settings.

The standard production image has been checked wirelessly on Corkscrew; exact
pins and measured limits are below. Publishing this approved release as Latest
makes it available to eligible auto-enabled receivers. The earlier diagnostic
image is a separate artifact and is excluded from publication.

## Changes

- The protected Bluetooth firmware-write callback now borrows the incoming
  characteristic bytes only long enough to copy them into the existing bounded
  receiver queue. It avoids an extra Arduino `String` allocation that could
  fail under memory pressure and turn a valid frame into an empty/rejected
  request. The callback still requires an authenticated encrypted bonded peer;
  the main loop retains flash, lamp state and persistence ownership. This does
  not remove the SDK's initial incoming-write allocation or establish that all
  native Bluetooth disconnect causes are resolved.
- Automatic update admission accepts a valid unpaused protocol-2 follower
  when neither durable rollout record is armed. It does not remove membership,
  save a pause or rewrite local light settings. Paused followers defer, legacy
  coordinators remain protected, and expanded groups retain their explicit
  coordination/permit requirements. Missing or failed storage reads do not
  silently grant permission.
- Donor service samples a fresh clock after radio processing. Previously, an
  offer could record a newer receive timestamp than the caller's loop timestamp;
  unsigned age subtraction then falsely expired the session before its first
  Request. The receiver now retains the session through that boundary. Startup
  readiness remains latched across clock rollover, expired retry deadlines are
  cleared, a deadline wrapping exactly to zero retains the cooldown, and idle
  status does not invent a long retry delay at high uptime.

The lamp continues to prefer a viable automatic Internet update and can fall
back to authenticated nearby donor offers when Internet checks cannot start or
succeed. Automatic updates require the receiver's existing explicit opt-in,
policy and exact-artifact admission. A CoolLamp Bridge caches and serves the
verified C3 image through the separate trusted-donation service. Generic control
mesh does not carry arbitrary firmware uploads or prove multi-hop firmware
delivery. Donor and receiver must have compatible channel overlap and household
trust; physical proximity alone establishes neither.

Older receivers still run their installed code during the next transfer. A lamp
with the former donor-admission or clock defect may need one authorized phone
Bluetooth or other viable direct bootstrap update before receiving the new
automatic-donor behavior. Installing new bridge software alone does not repair
an older lamp's receiver. Phone transfer retains native foreground/lifetime and
interrupted-transfer reconciliation requirements.

## Compatibility and retained behavior

No firmware packet layout, saved-record layout, partition table or bootloader
migration is introduced. Existing authenticated Wi-Fi, bonded Bluetooth,
owner-fleet control/enrollment, group playback, Internet OTA, phone transfer and
trusted donation remain available within their negotiated limits. Identity,
saved Wi-Fi, ownership, individual appearance/startup settings, microphone
tuning and calibrated geometry retain their existing contracts, including odd
LED counts and the 1–1024 range. Legacy effect IDs, names and order remain intact.

The hidden update renderer stays receiver-only and appears only during active
updating when that lamp was on at admission. It retains the subdued changing
wash across the lamp and brighter steady fill from physical bottom to top using
confirmed written bytes: blue for phone Bluetooth, green for Internet, amber
for trusted donation and purple for computer/browser upload. It never appears
in the effect catalog. Missing commit acknowledgments remain uncertain and do
not authorize automatic replay through another route.

The firmware source export includes the standalone client protocol module
`mobile/src/bridge-management.js` and its 27 tests as a contract-gate dependency.
That module covers bridge serving permission, boot/revision fencing and receipt
reconciliation. App entry points, visual redesign and native/store builds are
not published by this firmware release. No new TestFlight or Android release
is implied.

## Exact production artifact and release evidence

| Gate | Status |
| --- | --- |
| Standard ESP32-C3 1.15.5 application | 2,031,120 bytes; SHA-256 `01dadc9751be2e520aa19d7c9be12e623ec1b040755c96ac1d66c5537d24a1ab` |
| Matching manifest | 120 bytes; SHA-256 `8f59724e12c73069f313995f689f3a4ca96ed64f8c5af1567e6e41ac1a13d8b9` |
| Actual OTA-slot margin / static globals | 496 / 94,348 bytes; compiler program count 2,030,972 |
| Source and software checks | 48 firmware commands, 36 legacy/release commands, 27 bridge-client tests; compiler/current/export pins checked before publication |
| Package exclusion | Normal public marker; diagnostic/local/private settings excluded; bootloader and partitions match 1.15.3 |
| Release/tag | [firmware-v1.15.5](https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.15.5); exact source and publication intent retained in the release journal |
| Public download gate | Publication verifies Latest and both anonymously downloaded assets against the exact pins above |
| Exact standard production installation | One authenticated Wi-Fi file reinstall on Corkscrew; fresh boot, exact running hash, healthy and saved-state preservation confirmed |

The pinned platform remains Arduino ESP32 core 3.3.11, ESP32-C3 CDC/no_fs,
FastLED 3.10.5 and ESP32RotaryEncoder 1.2.0. The release owner must record the
actual final production bytes and hashes above; neither diagnostic measurements
nor compiler program counts substitute for the complete OTA image size.

Production canary `5894af4aec24` received one prepared/uploaded application over
its existing Wi-Fi connection, with a confirmed final HTTP 200 and no replay,
receiver USB use, router or credentials change. Its new boot reported the exact
standard image hash above, healthy operation and inactive reception. Name,
geometry (184 LEDs, midpoint 46), hardware budget, appearance/audio tuning,
startup effect/brightness, automatic policy and configured unpaused follower
membership matched the baseline. The ready bridge appeared as a fresh one-hop
peer. Current state, descriptor and all 38 applicable catalog IDs/names were
verified; this receiver's saved microphone installation state remains false.

At uptime 108,457 ms the canary had 31,312 free bytes (minimum 10,852), largest
free block 19,444, loop/cleanup stack minima 1,784/1,044 bytes. Lifetime maximum
animation gap was 661.864 ms with one overrun of the 100-ms target, and maximum
network service 357.477 ms; no occurrence timestamp proves its cause. Recent
five-second animation windows measured 19.021/32.827 ms with no overruns.
The lifetime timing target is not passed by this observation. The OTA margin
also remains tight; this is not sustained fleet resource acceptance.

Static evidence comes from the exact production RISC-V ELF disassembly rather
than stale compiler `.su` files. Visible local frame reservations include
relay receive/service 544/464 bytes, the shared receiver 464, Bluetooth write
callback 32, full state construction 1,184 and HTTPS open 2,496. These exclude
callees, interrupts and complete SDK/task call chains. The ELF, map, disassembly,
source and measured canary reports remain in the private release evidence.

## Existing diagnostic physical evidence

A controlled one-hop automatic Bridge→Corkscrew test installed diagnostic
1.15.5 on receiver `5894af4aec24` through trusted donation, without a phone
upload, receiver USB connection or manual receiver install command. The image
was **2,030,448 bytes**, SHA-256
`b9ad024278f4299b0eb3f0d7e62e127a14f50808839bafa807a25d0a992339fa`,
with 94,340 static-global bytes and 1,168 bytes left in the OTA slot. Its
test-image flag disables donation of its installed image and prohibits normal
release packaging. It is not the standard public artifact.

The receiver reported trusted route 3 and increasing written offsets; the
bridge confirmed one completed transfer and zero failed transfers at 169,734 ms
after monitoring began. A fresh boot, healthy operation and the complete exact
installed digest were confirmed at 220,015 ms. Saved settings, Wi-Fi digest,
automatic preference, group coordinator, follower role and paused state matched
the retained baseline. Group membership was kept, but `sync.active:false`:
this test did not exercise live synchronized playback during the update.
The bridge was restored to its normal application and durable public cache.
Visible cue/lighting confirmation is separate from these telemetry results.

Final diagnostic checks passed 48 firmware contract commands and 16 bridge
commands, including 28 production bridge/lamp/rollout integration scenarios.
The regression tests exercise real handlers with receive/service clock skew,
clock rollover, loss/duplicates, permissions, storage failures and commit
uncertainty. This software evidence does not prove RF range or native phone
interoperability. Full pins, journals and measurements are in the
[controlled donor bench ledger](../bridge-donation-bench-2026-10-13.md).

The diagnostic receiver's observed minimum heap was 10,668 bytes; minimum
remaining loop/cleanup stack was 1,784/1,020 bytes. Its lifetime maximum
animation gap was 336.406 ms, with two overruns of the 100-ms target; recent
five-second windows were approximately 30 ms with no overruns. The full-run
100-ms timing target therefore did not pass. No event timestamp establishes
the cause of those maxima. These measurements belong to that diagnostic bench
image and are not production resource or timing acceptance.

## Remaining acceptance and prerequisites

The exact production image's physical installation, native iPhone/Android
Bluetooth behavior, active synchronized-group recovery, paused/off-state cues,
interrupted physical donation, additional receivers, and sustained twenty-lamp
timing/resource/RF coexistence remain separate gates. This one-hop result does
not establish a global fleet ceiling, multi-hop scene streaming or multi-hop
firmware transfer.

The standard release retains the existing OTA-1 SHA-256/HTTPS/household-trust
policy. Production publisher keys, manufacturer identity and signature
activation are not provisioned by this release. Actual installed bootloader
rollback still requires verification; no partition migration or automatic
faulty-image recovery claim is made. The existing update attempt/quarantine and
uncertain-commit fences remain in force. Publication is not a claim that the
complete app experience is store-ready.

Next physical release check: install the exact pinned standard image through
an authorized viable update path, verify identity/version/hash and postboot
control health, confirm retained settings/group, then perform a native phone
transfer and an update during active group playback with router settings held
constant. Keep all physical results distinct from the diagnostic ledger and
final build/CI outcomes.
