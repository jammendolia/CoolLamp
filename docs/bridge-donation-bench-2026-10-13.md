# Controlled bridge donation bench: 13 October 2026

The user authorized trying the automatic bridge update after local bridge
0.2.2/Corkscrew 1.15.4 installations and successful browser reads. This bench
keeps group membership, Wi-Fi/router/channel configuration, ownership,
calibration, startup and appearance unchanged. It does not publish a release.
The public release was independently checked through the directory-routed
`jammendolia` account and verified CoolLamp remote: it remains 1.15.3.

## First candidate: withdrawn after the initial attempt

There was no newer approved public artifact. A source export was frozen under
`.build/bridge-donation-20261013/candidate-root/`; only that export's actual
version/patch constants changed from 1.15.4 to 1.15.5. Live `LampVersion.h`
remains 1.15.4. No private settings header or signing material was copied.
The real build uses the existing pinned C3 helper with `--public --test-image`.
The following pins describe the first attempt only. This candidate is withdrawn;
the revised candidate below is the pin for the next controlled attempt.

| Item | Value |
| --- | --- |
| Candidate version/chip | 1.15.5 / ESP32-C3 |
| Actual image / OTA slot / margin | 2,030,192 / 2,031,616 / 1,424 bytes |
| Static globals | 94,340 bytes |
| SHA-256 | `095d3336dd8fff52d17eff7d520ad4630114ba80c1cc30c22d398846709b3c5e` |
| Original manifest | 120-byte canonical `COOLLAMP-OTA-1` |
| Manifest SHA-256 | `adbbad250782c9f3c99ee8dc716fff708f923edb2c21897d1464efc022505efb` |
| Receiver | Corkscrew `5894af4aec24`, actual MAC `24:ec:4a:af:94:58` |

The compiled public version marker, diagnostic marker, chip header, size and
digest agree. Standard release packaging rejects the diagnostic image. Its
test-image flag suppresses donating its running image after installation.
This is an explicitly approved household bench artifact, not an HTTPS release
or a publisher-signed image. Publisher trust/signing remains a separate gate.
If either 1.15.5 candidate is installed, existing anti-downgrade checks reject
public 1.15.4 and older; Corkscrew then stays on test 1.15.5 until a genuine
compatible release at least 1.15.5, or separately authorized physical service
restoration. The first attempt did not confirm installation of its candidate.

## Current clock-fix artifacts

The source-backed relay clock fix was frozen into separate diagnostic exports
under `.build/bridge-donation-20261013/clock-fix/`. The bootstrap keeps the
installed version at 1.15.4; the candidate genuinely builds as 1.15.5. Neither
image is published or eligible to donate its installed diagnostic image.
Live `LampVersion.h` remains 1.15.4.

| Item | Bootstrap / verified donor candidate |
| --- | --- |
| Firmware version | 1.15.4 / 1.15.5 |
| Actual image / OTA slot | 2,030,432 / 2,031,616 bytes; 2,030,448 / 2,031,616 bytes |
| OTA margin | 1,184 / 1,168 bytes |
| Static globals | 94,340 bytes for each |
| Bootstrap SHA-256 | `ae780590976b2e632bed2b1f5f4c34252bbd0e83571d454b5eecdb926b1ffed4` |
| Candidate SHA-256 | `b9ad024278f4299b0eb3f0d7e62e127a14f50808839bafa807a25d0a992339fa` |
| Bootstrap manifest SHA-256 | `0f182c1d3c6a1739ab7c65264c5ee9467e41798c5c6d128924c1af28de311431` |
| Candidate manifest SHA-256 | `7ae9b46467355b855db156c534858199be7064fccc3058d569536d95cdb23b49` |

`clock-fix/bootstrap-artifact.json` and `clock-fix/candidate-artifact.json`
retain exact source hashes and publication prohibitions. The bootstrap contains
the primary fresh-clock and startup fix. The final candidate also contains the
nonzero retry-deadline and retry-snapshot rollover guards; it is not inferred
to be byte-identical to the bootstrap with a version label changed.

The prepared normal bridge 0.2.2 application, with development activation
compiled out, is 1,245,936 bytes in the existing 2,097,152-byte slot, leaving
851,216 bytes. Static globals are 88,648 bytes. Its SHA-256 is
`b7e2f31d2e7f8bce577e41e003a6e2c1ac5637bd64eca8e3871f627acae08c9c`;
the exact artifact is recorded in `clock-fix/bridge-default-artifact.json`.

## Isolated bridge fixture and bounds

`tools/build-bridge.cjs --bench-fixture=<public JSON>` stages/builds only under
`.build/bridge-bench/`, with `COOLLAMP_BRIDGE_BENCH` explicitly enabled. It pins
the exact candidate manifest, receiver and at most 1,200,000 ms lifetime.
The JSON is limited to 2 KiB; the image is bounded to the existing C3 OTA slot
and checked before being read. Default bridge builds have no bench activation
or local-development trust mode. Default artifacts also reject diagnostic
markers even through ordinary HTTPS/signature provenance.

USB `bench-status` is read-only and reports public pins, boot identity, original
bank, opposite seed bank/flash address and readiness. `bench-arm` is one-shot
per boot and never auto-runs after reboot. It requires the committed verified
1.15.3 cache, exact matching record, no storage fault, enabled sharing/trust,
radio/association, no updater, donor, commissioning, scan, Wi-Fi change,
pending control or active HTTP client. Missing arm replies require original
session reconciliation, never an automatic retry.

Before arming and throughout verification/transfer/restoration, cache refresh
is held. This closes the race between reporting the inactive bank and seeding
it. The original record and bank are not modified by the fixture. The C3 bytes
are data in the opposite S3 custom cache bank, never an S3 bootable image. Exact
target/device, partition boundaries, plaintext/unsecured flash state, candidate
hash, original-bank before/after digest and unchanged OTA selection are checked
by the local seed helper. No app/NVS/boot-selection region is written by seeding.

Development activation is RAM-only, with `durable:false` and explicit
`local-physical-bench` provenance. Artifact verification stays incremental at
1,024 bytes per service; its general hard cap remains 4,096. Offers bind the
Corkscrew destination before encryption, and actual-source admission rejects
other receivers. Ordinary control admission retains the household serving
policy. Success, failure, expiry and reboot restore/reload the committed public
cache; an uncertain receiver outcome is not retried by the fixture.

## Checks and physical procedure

Software checks pass: production default/enabled artifact/session/sender tests,
actual Runtime helper ownership/cache/restore tests, pre-seed race regression,
three builder tests, all 21 actual grouped-receiver integration scenarios and
all 16 existing bridge checks. Fixtures cover wrong target/artifact, corruption,
limits, opt-out/paused/coordinator holds, duplicates, loss, nonce/session fencing,
expiry/rollover/reboot, storage faults and zero fixture NVS/flash writes. These
do not establish physical delivery or phone/RF acceptance.

After the clock fix, all **28** production bridge/lamp/rollout integration
scenarios pass. Added checks advance the receive clock while passing an older
service timestamp, including offers and subsequent packets across rollover,
the startup gate after rollover, long-uptime offers and an exact zero-wrapping
retry deadline. The production bench artifact/session/Runtime checks also
pass. Logs are `.build/bridge-group-clock-final-20261014.log` and
`.build/bridge-bench-clock-final-20261014.log`; their filename date is retained
as generated and is not a claim about the user-facing test date.

1. Confirm receiver's exact 1.15.4 identity/hash/health, automatic opt-in and
   group policy, and capture sanitized persisted settings. Keep both devices
   powered; close the phone app and bridge browser for this controlled run.
2. Install only the explicit bridge fixture application into the verified
   selected existing S3 app partition, preserving NVS/cache/OTA metadata.
3. Obtain ready `bench-status`. With cache held, seed only its opposite bank
   over the already-connected bridge USB. Verify exact bytes and untouched
   original cache/OTA selection. Restart, recheck original cache/readiness.
4. Journal one `bench-arm` dispatch. Let Corkscrew's own automatic receiver
   detect the offer. Sample bridge USB status about every 8 seconds and only
   small authenticated receiver firmware status at that cadence. Avoid mesh
   commands/catalog/settings during transfer. No phone transfer is involved.
5. Observe only Corkscrew's amber progress fill over its subdued full-lamp
   animation, since its power was on at admission. Bridge OLED progress is
   acknowledged written bytes. Do not infer a finish from the animation alone.
6. At restarting/disconnect, stop receiver polling briefly. Reconcile exact
   new boot, 1.15.5 size/hash and health; running image measurement starts after
   35 seconds. A final-ACK loss or timeout after complete data is uncertain.
   Never rearm or resend Finish before reconciliation.
7. Confirm retained saved settings/group and normal playback, and original
   durable bridge cache restoration. Restore the normal bridge application to
   remove the development activation interface. Record all exact artifacts,
   results, timing and limitations separately from software checks.

Preparation and one-operation journals live under
`.build/bridge-donation-20261013/`. The second physical transfer result is
pending until the measured installation ledger is appended. Sustained twenty-lamp RF,
multi-hop control, native app routing, rollback and publisher provisioning
remain separate acceptance gates.

## First physical attempt and identified clock defect

The first one-shot bench attempt was monitored for **1,083,562 ms** (about
18 minutes), with 125 status samples. The receiver observed 18 authenticated
newer offers, but every sampled bridge status had `sending:false`, both
completed and failed donation counters remained zero, and receiver status
never showed active reception. Maximum observed written offsets were zero on
both devices. No candidate installation was confirmed and the monitor sent no
mutation or automatic rearm. These observations establish discovery of the
offer, not successful firmware RF delivery, reception, progress or installation.

The source investigation found that `LampSync.cpp` captures a service-pass
timestamp before processing radio packets, while `LampFirmwareRelay::receive()`
records a fresh `millis()` value for the accepted session. The same pass then
supplied its older timestamp to relay service. Unsigned subtraction could make
a newly accepted session appear more than four billion milliseconds old,
exceeding its 20-second inactivity and 15-minute lifetime checks before even
queuing the receiver's first Request.

A minimal production-code fixture with real pinned AES-GCM proved the boundary:
receive at 40,001 ms followed by service at 40,000 ms changed AwaitDonor to Idle,
queued zero Requests and scheduled a 59,999-ms remaining retry. Service at the
fresh 40,001-ms clock retained AwaitDonor and queued one Request. The first
physical observations are consistent with this defect; they do not separately
prove every radio packet's timing. The isolated proof and result are retained
under `.build/relay-stale-clock-audit-20261013/`.

Relay service now samples the current clock before age checks. Startup readiness
is latched so a running lamp does not re-enter its first-35-seconds hold when
`millis()` wraps. Expired retry deadlines are cleared, an exact zero-wrapping
deadline retains its cooldown, and idle snapshots do not fabricate a retry at
long uptime. The bridge Runtime likewise passes fresh clock samples to donor
receive and service. Existing identities, artifact checks, replay/session
fences, timeout bounds and commit ownership remain in force.

## Installed bootstrap before the second donor attempt

The corrected diagnostic **1.15.4** bootstrap was installed once through the
existing authorized Wi-Fi file-update path. Its one-operation journal records
the prepared boot, all bytes sent, and a confirmed HTTP 200 final response.
After restart, `clock-fix/receiver-before.json` verifies Corkscrew's canonical
identity, exact 2,030,432-byte image and `ae780590...` digest, a fresh boot and
healthy operation.

The persisted name, 184 LEDs, 500 mA limit, midpoint 46, whole-strip/midpoint
mode, Fire startup effect/100 brightness, style, colors, per-effect options,
VU/Fountain colors, microphone tuning and rotation match the retained baseline.
The saved Wi-Fi digest and automatic-update preference also match. Membership
remains an unpaused protocol-2 follower of coordinator `f0b950b2f180`; no group
removal was required. Policy reports `eligibility:0`, `groupCoordination:0`
and `automaticEligible:true`.

At that boundary, only the bootstrap installation and retained state were
verified. The following second attempt used only the revised `b9ad0242...`
candidate above. No OTA publication or TestFlight release has been performed
for these diagnostic artifacts.

## Second physical attempt: automatic donor installation verified

The revised bridge fixture was installed application-only and the revised
candidate seeded into inactive cache bank 1. Original public bank 0 and OTA
selection were checked unchanged. The fixture SHA-256 is
`0cd62c03742a3d1a0b04f105cc71c4c91c83dcc3c038530fa90cd0cdefca4624`,
1,249,856 bytes, 88,680 static-global bytes and 847,296 OTA-slot bytes remaining.
A single USB arm was journaled, accepted and never repeated. There was no
phone upload, manual receiver install command or Corkscrew USB connection.

The actual receiver selected route 3 (trusted donation), entered receiving
phase 3 and reported increasing written offsets for the exact 2,030,448-byte
image. First written data was observed at 9,468 ms. Completion was observed at
169,734 ms after monitoring began: the bridge reported one completed transfer,
zero failed transfers and restored its durable public 1.15.3 cache. Receiver
disconnect during restart was followed by a new boot on 1.15.5; at 220,015 ms,
both boot health and the complete `b9ad0242...` running-image digest were
confirmed. The monitor retained 26 samples and sent only read requests.

Postboot verification found no changed persisted setting, the same saved Wi-Fi
digest, automatic opt-in/policy, coordinator identity, follower role and paused
state. State/current-state, descriptor, mesh status and all 38 current catalog
IDs/names returned valid responses. The configured group was retained, but
`sync.active:false`: **this run did not exercise live synchronized playback**
or recovery of a currently streaming group. The bridge presence entry was not
available in that receiver snapshot; successful donation does not replace a
fresh control-route check. Owner confirmation of the amber cue and normal
lighting remains separate from telemetry.

The bridge was then restored application-only to the normal `b7e2f31d...`
0.2.2 image, removing development activation. Its fresh USB status confirms
password configured, saved Wi-Fi connected at the same address/channel 11,
the same household, enabled mesh/donation, no storage/configuration uncertainty
and the ready durable 1.15.3 public cache. No NVS, router or group changes were
made by these installations.

The final host runs passed **48 firmware contract commands** and **16 bridge
commands**, including all 28 actual group/donor scenarios. Exact source/image
pins, one-shot journals, both physical observations, software logs and
sanitized final state are under `.build/bridge-donation-20261013/clock-fix/`;
`evidence.json` is the consolidated ledger. These are local diagnostic artifacts
and must not be published through ordinary release packaging.

Postboot receiver resources at 111,476 ms were free/minimum heap
31,316/10,668 bytes, largest free block 20,468 bytes, and minimum remaining
loop/cleanup stack 1,784/1,020 bytes. Its lifetime maximum animation gap was
336.406 ms with two overruns of the 100-ms target; maximum network service was
327.368 ms. No occurrence timestamp identifies their cause. Recent five-second
windows were 29.944/30.954 ms with zero overruns. The full-run 100-ms timing
target is therefore **not passed** by this observation. Restored bridge heap
was 201,152 bytes (minimum 183,620), loop/cleanup stack 4,752/3,252 bytes.
The C3 image's 1,168-byte OTA margin remains very tight.

This passes one physical, one-hop automatic bridge-to-group-member installation
with saved-state preservation. Active group recovery, paused/off-state cues,
interrupted physical donation, additional receivers, twenty-lamp sustained
resource/timing acceptance, range/channel coexistence and native phone bridge
flows remain pending. Publisher activation/keys and actual bootloader rollback
verification retain their existing external prerequisites. A production
release must be a genuine compatible version at least 1.15.5 and pass its own
release gates; this test is not authorization to publish it.
