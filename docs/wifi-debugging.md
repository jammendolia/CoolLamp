# Debugging lamps over Wi-Fi

## Latest publication — 2026-10-08: firmware 1.10.2 public; app 35.1 accepted

The user explicitly requested publication despite the known physical-acceptance
gap, overriding the earlier hold. [Firmware 1.10.2](https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.10.2)
is now **Public Latest**, published at `2026-10-08T21:21:55Z`
(2026-10-08 16:21:55 CDT). Its tag/source is
`b66099080078bc47cbc253cfa23da2a1429df9f5`; Latest/tag references and public
flags (`draft=false`, `prerelease=false`) are verified. Publication used only
verified personal **jammendolia**; HiFin remains untouched.

The release uses the verified CI application: **1,863,744 bytes**, SHA-256
`2a1634f9404d40d0aece4632aa60ec94db0d1d1a853192157e1dd0d460028eda`.
Firmware CI `37843327031` succeeded, including runtime/sanitizer and packaging
checks. Program usage is 1,863,594 bytes, globals 61,612 and remaining OTA
image space 167,872 bytes. The prior Windows candidate has different bytes;
retain it as historical evidence. Anonymous downloads without Authorization
verified the public latest manifest (120 bytes) and pinned 1.10.2 application
at `2026-10-08T21:22:59.972Z`. The application size/hash and complete bytes match
the verified CI image; public marker and ESP32-C3 layout checks passed. Evidence:
`.build/firmware-1.10.2-public-verification.json`.

The last verified fleet snapshot immediately **before publication** made eight
GETs: `.build/ota-1.10.1-fleet-baseline-1791494436377.json`. CoolLamp 1/2 were
on 1.10.1 with their original automatic-update preferences enabled; BACL/new
lamp were on 1.9.6 with their original preferences disabled. Publication did
not introduce automatic-update holds or change those preferences. No check or
installation was forced for publication. Automatic checks/installations can now
occur on the enabled lamps; **no 1.10.2 lamp
installation has yet been verified**. Do not present this pre-publication
snapshot as proof of a lamp's running version after a subsequent automatic
update.

App **1.0 (35.1)** is already the latest accepted TestFlight upload; no additional
app build is required for this firmware. Existing macOS CI `37843221334`, source
`6a468d46e2c7ddea0cbb2df533118186de08b15a`, succeeded. Apple accepted the upload
at `2026-10-08T21:01:24.3685690Z` (16:01:24 CDT), with evidence in
`.build/ios-testflight-35.1-ci.log`. Tester availability and phone installation
remain unverified.

Publication does not establish physical 1.10.2 acceptance, a completed device
installation or repaired intermittent HTTPS checks. The earlier partial manual
C2 transfer and possible queued boot-slot uncertainty remain recorded below;
no controlled next-boot test or 1.10.2 TLS check has been performed. The bounded
1.10.1 encrypted-frame test and phone-Wi-Fi-off Bluetooth test remain valid,
while lamps outside AP coverage, same-IoT forwarding, new-scene/music acceptance,
blackout/thermal diagnosis and raw Mac diagnostic migration remain open.
GPIO assignments and existing lamp settings are retained.

## Earlier pre-publication checkpoint — 2026-10-08: live OTA, radio and CI draft

The status below records the checkpoint before the user's explicit publication
request. Its Latest 1.9.6 and unpublished 1.10.2 draft statements are historical
and superseded by the publication section above. Preserve the observed device,
settings, failure and validation evidence; publication alone does not close
the physical-acceptance or next-boot/TLS gaps.

**Public Latest is firmware-v1.9.6.** Firmware 1.10.1 is a public prerelease
with its original pinned tag/assets. CoolLamp 1 (`acb950b2f180`, `.154`) and
CoolLamp 2 (`f0b950b2f180`, `.222`) are installed on `COOLLAMP-PUBLIC-1.10.1`;
BACL and the new lamp remain on 1.9.6. The test pair's original automatic-update
preferences were enabled and have been restored. BACL/new lamp's original
preferences were disabled and remain disabled. Reverting Latest does not
downgrade installed firmware or erase a cached newer offer. Before restoring a
held old lamp's enabled preference after any failed rollout, check restored
Latest and verify that no newer cached offer remains.

After the user moved BACL into the room, authenticated reads reached and
identity-verified all four lamps on 1.9.6. The staged test published the verified
1.10.1 image at `2026-10-08T19:46:33Z` and started the built-in GitHub OTA exactly
once on each test lamp. Both rebooted into 1.10.1, resumed Wi-Fi and passed the
compared configuration checks. Saved ordered group IDs were preserved;
transient online/name annotations and follower effect options settled after
subscription resumed. The effect-options getter overlays the coordinator's
live options, explaining the temporary post-boot difference. Neither install
was replayed, and no factory reset or GPIO change occurred. USB is an optional
recovery/diagnostic path, not a prerequisite for this Wi-Fi-connected test pair.
Evidence: `.build/ota-1.10.1-live-rollout.json`, the lamp1/lamp2 verified logs,
and `.build/ota-1.10.1-fleet-baseline-1791489654068.json`.
A later GET-only fleet baseline made eight reads across four lamps and reconfirmed the same
installed versions, original automatic-update preferences and group scene 19:
`.build/ota-1.10.1-fleet-baseline-1791493231724.json`. No mutations occurred.

Five samples over about 13 seconds proved accepted encrypted ESP-NOW frames:
CoolLamp 1 stayed active on `esp-now` with 296 additional accepted group frames;
CoolLamp 2 reported hybrid coordination and three members. Queue-drop,
authentication-failure and clock-drop deltas were zero; the coordinator had one
failed radio send. The user confirmed CoolLamp 2's Bluetooth Groups/Settings
panels work with the phone's Wi-Fi off. **Lamps outside AP coverage have not been
tested.** A held display or a phone without Wi-Fi is not proof of the lamps'
AP-off radio path. Evidence: `.build/ota-1.10.1-radio-proof.json`.

CoolLamp 2's post-boot update check failed, then repeated with compact polling
and with Bluetooth disconnected: phase 5/error 3, asset-host TLS after HTTP 302
(host 2), TLS error 12288 (`0x3000` generic X.509 fatal error), transport error
32794 (`0x801A` handshake failure), flags 0. Minimum free heap was 848 bytes
at that failure checkpoint. A subsequent automatic check completed: the later
fresh read reported phase 0/error 0, latest 1.9.6 and available false. HTTPS
failures are therefore intermittent, not a permanently failed path. The later
cumulative minimum free heap was 492 bytes, superseding 848 as the current
minimum without altering the earlier logs. This since-boot minimum does not
measure available headroom at the start of a particular TLS handshake.
Memory pressure is a suspect, **not a proven allocation failure**. Source review
found an ordering gap that could start HTTPS before the next network/Bluetooth
resource-cleanup pass. The local **1.10.2 candidate** defers worker notification
until that boundary and fixes the Bluetooth mutation allowlist's omission of
Style endpoint 25, with an actual Begin/Commit regression. Twelve runtime
scenarios and independent review passed. TLS verification, buffer configuration
and saved settings remain intact. Device validation must establish whether this
fix resolves repeat update checks.

The earlier Windows 1.10.2 build and packaging passed: **1,864,128 bytes**,
SHA-256 `ddfdad8787aa95f8ac0214ee8533d4c01e0e312eb5e688a63069cf3bc5bf2f93`.
Initial firmware CI `37842646052` failed on a Linux host-harness macro compilation
problem. The harness-only fix passed all 12 Windows scenarios, and rerun
`37843327031` **succeeded** on source
`b66099080078bc47cbc253cfa23da2a1429df9f5`.

The verified **1.10.2 CI image is 1,863,744 bytes**, SHA-256
`2a1634f9404d40d0aece4632aa60ec94db0d1d1a853192157e1dd0d460028eda`.
Program usage is 1,863,594 bytes, globals 61,612 and remaining OTA image space
167,872 bytes. Public-marker/C3 manifest/layout, local-credential exclusion and
both GitHub asset-digest checks passed. Evidence:
`.build/firmware-1.10.2-ci.log` and
`.build/firmware-1.10.2-ci-assets/verification.json`.
**Firmware 1.10.2 remains an unpublished draft; public Latest remains 1.9.6.**
CI/build success does not establish a device installation or TLS fix.

One guarded manual local HTTP upload to CoolLamp 2 used that exact verified CI
image. Bluetooth was disconnected and the coordinator was idle. Before upload,
free heap was 27,752 bytes, largest block 18,420 and cumulative minimum 492.
Its original enabled automatic-update preference was temporarily held disabled,
then restored enabled and confirmed. Curl ended with error 52/HTTP 000 and an
empty reply after 7.239553 seconds, reporting `size_upload: 392924` to verified
remote `192.168.1.222`. This is a **partial upload**, below the 1,863,744-byte
image size. No upload was replayed, no restart was requested and no other lamp
was changed. Evidence: `.build/ota-1.10.2-manual-C2.json`.

Fresh readback still showed CoolLamp 2 running 1.10.1 with continuous uptime.
The journal conservatively retains a possible queued boot slot; next-boot
selection has not been verified. At `2026-10-08T21:15:38Z`, the post-failure
read-only comparison reported uptime 4865638 ms, automatic updates enabled,
Wi-Fi connected, coordinator role 1 and scene 19. **All compared saved-settings
and runtime-control differences were empty.** Evidence is
`.build/ota-1.10.2-manual-C2.json` → `postFailureReadOnlyVerification`.
A fresh eight-GET fleet baseline also confirmed unchanged installed versions,
original automatic preferences, group roles and scene 19:
`.build/ota-1.10.1-fleet-baseline-1791493971087.json`.
Three additional read-only counter samples confirmed group recovery after the
partial upload: the follower remained active on ESP-NOW in scene 19, accepted
146 more frames, and the coordinator retained three members. Evidence:
`.build/ota-1.10.2-post-upload-radio-proof.json`.

**Physical 1.10.2 acceptance and repeat TLS checks remain pending; no 1.10.2
TLS check has run on a lamp.** USB remains an optional recovery/diagnostic
fallback. A controlled next-boot test has not been performed. Preserve the
possible boot-slot uncertainty; do not assume the partial transfer installed
new firmware or repaired TLS, and do not repeat the manual upload.

New app navigation uses lamp-card gears and organized per-lamp settings, with
only Lamps and Groups in bottom navigation. Independent lighting stays in lamp
settings; grouped controls live in Groups. Current-effect cards use each
standalone lamp's own catalog or its verified group scene, reject stale results
and retain the existing Mirrored controls. Local validation passed **291 mobile
tests**, 16 mocked UI scenarios and independent race/layout review. A separate
GET-only check observed the user's Bass cathedral group selection on all four
lamps with four diagnostics reads and no mutations (`.build/current-effect-live.json`).

App **1.0 (35.1)** is the latest accepted TestFlight upload. Existing macOS
CI run `37843221334` succeeded on source
`6a468d46e2c7ddea0cbb2df533118186de08b15a`. The log confirms build 35.1
and reports `UPLOAD SUCCEEDED with no errors` at
`2026-10-08T21:01:24.3685690Z` (2026-10-08 16:01:24 CDT). Evidence:
`.build/ios-testflight-35.1-ci.log`. Tester availability and phone installation
are not independently queried. App 34.1 is the earlier accepted design/filter
checkpoint. Firmware 1.10.2 CI succeeded; its physical/TLS acceptance remains
pending independently of this successful app upload.

The earlier 1.10.0/1.10.1 draft and USB-pending checkpoints below are historical
and superseded by this live GitHub OTA evidence. Same-IoT forwarding, lamps'
AP-off/Bluetooth coexistence, 1.10.2 next-boot/device/TLS acceptance, physical
new-scene/music acceptance and longer blackout/thermal diagnosis remain separate
open work.
Raw Mac diagnostics/prototype binaries remain an unfilled migration gap. Keep
all GitHub actions scoped to verified personal `jammendolia`, preserve the
original working tree and use the isolated release checkout for scoped commits.
No router changes were made.

## Earlier hybrid-test checkpoint — 2026-10-08: 1.10.0 draft and USB pending

CoolLamp 1 at `.154` (`acb950b2f180`) and CoolLamp 2 at `.222`
(`f0b950b2f180`) are the user's chosen ESP-NOW/Bluetooth test pair. Fresh
authenticated GETs confirmed both on firmware 1.9.6, Wi-Fi connected, 134 LEDs,
midpoint 0, with CoolLamp 1 following CoolLamp 2 in scene 27. Sanitized evidence:
`.build/hybrid-test-lamps-baseline.json`. This supersedes the earlier statement
that no 1.9.6 lamp installation had been confirmed.

At this earlier checkpoint, firmware 1.10.0 was a local candidate. Its radio
diagnostics distinguish UDP, ESP-NOW and hybrid links, channel/search state,
AEAD security and bounded queue counters. Wi-Fi scans and periodic AP retry windows share the
radio; preserved display holdover is not proof that radio frames arrived.
Use counter changes and exact follower state in bounded tests. Do not change
router settings or saved Wi-Fi credentials to manufacture an offline result.
See [offline groups](offline-groups.md) for authorization, test limits and
the separate global Groups page.

The first candidate local OTA upload to CoolLamp 1 failed with an empty reply
(curl 52); no replay occurred. Fresh readback confirmed installed 1.9.6,
continued uptime, unchanged compared saved settings and active following.
CoolLamp 2 was not uploaded then. USB access to CoolLamp 1 was pending; the
hybrid firmware was not physically validated or published at that checkpoint.
This status is superseded by the current 1.10.1 GitHub OTA and radio evidence.
USB remains an optional recovery/diagnostic path.

App 1.0 (32.1) was accepted by Apple at `2026-10-08T17:10:32.0898510Z` through
existing macOS CI run `37814009967`, source `28b81f142f6128638cb90feea388f522f9205336`.
It adds the top-level Groups page and passes 220 mobile tests plus native
accessory/address checks. Its Wi-Fi group workflow works with the test pair's
1.9.6 firmware; offline Bluetooth settings/groups require the 1.10.0 candidate.
Evidence: `.build/ios-testflight-32.1-ci.log`. Tester availability/phone
installation remain unverified. Public OTA is still 1.9.6.

Firmware 1.10.0 CI run `37814005688` passed and created an unpublished draft.
The verified CI asset under `.build/firmware-1.10.0-ci-assets/` is 1,859,792
bytes, SHA-256 `30eb2a3a603e4590576086c31793ab3415d9221773da308b4b461ff041a62813`.
That asset was proposed for the then-pending USB test. Host/CI success alone
does not demonstrate the physical radio path, BLE coexistence or closed-enclosure
reliability; later bounded encrypted-frame evidence is recorded above.

## Earlier public-release checkpoint — 2026-10-07: 1.9.6 and app 31.1

[Firmware 1.9.6](https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.9.6)
is the latest public OTA release, published at `2026-10-08T02:50:54Z`
(2026-10-07 21:50:54 CDT). Source and immutable tag both resolve to
`bfa04d6e0055b90561c749325cb300992b1ca39f` on
`codex/corkscrew-effects-1.9.6`. Firmware CI run `37719063401` succeeded,
including the 166 mobile tests, release packaging and new renderer suite with
ASan/UBSan. All GitHub actions used verified personal **jammendolia** only;
HiFin remains untouched.

The published CI application is **1,830,400 bytes**, SHA-256
`091bb636be3317328b0e4346f5a139d50e7af07a992c0b1a6832a53484263417`.
Program usage is 1,830,258 bytes; globals are 52,748 bytes. The 2,031,616-byte
OTA slot has 201,216 bytes of remaining image space. Anonymous downloads of the
latest manifest and pinned 1.9.6 binary matched the verified CI bytes and hash;
local-credential exclusion checks passed. This published image is different
from the earlier Windows candidate retained below. Evidence:
`.build/firmware-1.9.6-ci.log`,
`.build/firmware-1.9.6-ci-assets/verification.json`,
`.build/firmware-1.9.6-ci-assets/published-release.json`, and
`.build/firmware-1.9.6-public-verification/verification.json`.

App **1.0 (31.1)** was latest at this earlier checkpoint. The existing macOS
workflow run `37719065609` succeeded on the same source, including 166 tests,
native Swift accessory/address checks, web build and signed archive/export.
Apple reported `UPLOAD SUCCEEDED with no errors` at
`2026-10-08T02:46:34.0273470Z` (2026-10-07 21:46:34 CDT). Evidence:
`.build/ios-testflight-31.1-ci.log`. Tester availability and phone installation
have not been independently queried. App 30.1 remains the earlier direct-join
checkpoint; app 29.1 is the preceding firmware-fleet checkpoint.

The app update adds scenes 27–32 and their 1.9.6 compatibility labels, retaining
asynchronous firmware-card checks, explicit sequential Update all and direct
network coordinator joining. Every group member needs firmware 1.9.6 or newer
for the six new scenes; the selected coordinator's advertised scene count still
filters its catalog. The first two new scenes are ambient and the last four
require the coordinator microphone. GPIOs, geometry/defaults, settings/NVS,
group keys/order and wire layout are preserved.

At this publication checkpoint no hardware requests/flashing were performed,
and no 1.9.6 installation had been confirmed. The subsequent four-lamp baseline
and test-pair 1.10.1 GitHub OTA supersede those installation gaps. Physical
corkscrew/music acceptance, same-IoT forwarding and longer blackout/thermal
investigation remain separate unresolved work. The raw Mac diagnostics and
prototype binaries remain an unfilled migration gap.

The earlier accepted app 1.0 (30.1), source
`c6674ba38cc76214d2d311c003fff1f1513095f0`, passed existing macOS CI run
`37698202209` and was accepted by Apple at `2026-10-07T22:50:22.803933Z`
(17:50:22 CDT). It added asynchronous coordinator discovery and direct Join
without switching lamps or exposing invitations. Its live scan was GET-only;
joining was mock validated. This HTTP workflow does not resolve group UDP
forwarding. See [the development handoff](development-handoff.md).

## Earlier device and app checkpoint — 2026-10-07: app 29.1 and USB 1.9.5

App **1.0 (29.1)** was the latest accepted upload at this checkpoint. Source
`d8620a428406bdd4a9a8cb3fcd0188135b43bc70` passed existing macOS CI run
`37692263376`, including 134/134 tests, native Swift accessory/address checks,
web build, signed archive/export and upload. Apple reported
`UPLOAD SUCCEEDED with no errors` on 2026-10-07 at 16:56:54 CDT
(`.build/ios-testflight-29.1-ci.log`). Tester availability/phone installation
remain unverified; app 28.1 is the historical firmware-card upload.

CoolLamp 2 now runs the exact published 1.9.5 CI image after verified COM5 USB
bootstrap. Its 1.9.4 automatic secure download reached 47% but failed at the
180-second limit (phase 5/error 6); this is not a completed OTA installation.
After the separate USB update, a 95-second boot capture was stable and the fresh
secure manifest check passed: latest 1.9.5, phase 0/error 0, available false,
HTTP stage 7/code 200/host 2, TLS error/flags 0 and transport 0. Later diagnostics
reported valid 55.7 C, sceneCount 26 and preserved power-on/mode-46/brightness-55
controls, 134 LEDs/midpoint 0. Raw logical NVS, partition table and OTA metadata
matched the fresh pre-write backup; saved API settings/runtime comparisons had
no changed fields. See [the chronological device evidence](group-network-debugging.md).

Earlier app 1.0 (28.1), commit `a3499e89a69fcb7bbb56b6a9f3fdae4f21761821`, was accepted
by Apple after successful existing macOS CI run `37688466205`. Firmware cards
show installed versions per device, **Last seen** for disconnected remembered
versions, and **Connect to view** when unknown, without extra hardware polling.
104/104 tests, the production web build and mock browser check passed. Tester
availability remains unverified; app 27.1's earlier accepted upload remains
history. Firmware source `7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f` and its
published 1.9.5 assets remain immutable. Only personal jammendolia was used.
CoolLamp 1's COM3 bootstrap is now complete. Its verified active app1 at
`0x200000` (CRC-valid sequence 22/state 2) received the exact published 1.9.5
image with ROM hash verification. All logical NVS records, partition table and
OTA selector were unchanged, and saved settings/runtime comparisons matched.
Its distinct startup mode 43/brightness 215 and microphone gain 8/gate 10/
scale 115 must remain preserved; prior-day settings are not authoritative.
A healthy 95-second USB capture produced 45 valid records spanning 95363 ms,
and the scheduled secure check passed: phase 0/error 0, HTTP stage 7/code 200/
host 2, TLS error/flags 0 and transport 0. At uptime 150004 ms it reported
valid 57.7 C, with historical peak 58.7 C. Evidence:
`.build/lamp1-published-1.9.5-https-check.jsonl` and
`.build/lamp1-1.9.5-usb-settings-comparison.json`.

All three lamps now report 1.9.5, power on, mode 46, brightness 55 and group
scene 0. CoolLamp 1 and CoolLamp 2 run the exact CI asset; BACL retains the
same-source Windows candidate. CoolLamp 1 can return to normal power. Full
secure OTA installation and blackout/thermal diagnosis remain unresolved;
successful manifest checks do not prove either.

Asynchronous per-card status refresh and explicit **Update all** are implemented
in source `d8620a428406bdd4a9a8cb3fcd0188135b43bc70`, pushed to the existing
codex branch and included in accepted app 29.1. Local 134/134 tests,
production build and mocked UI checks passed. Blocked/deferred pings do not
prevent other cards returning results, Light/Settings navigation or other-lamp
controls. Update all runs sequentially, reports progress/errors per lamp and
handles offline/missing-password lamps separately without changing selection,
disconnection or saved automatic-update preferences. Installed/latest and
timestamp ordering guards preserve per-device results.

Page-open/background refresh uses read-only status requests; updates started by
the app require the explicit button. The live GET-only module check verified all three device
IDs and returned installed/latest 1.9.5 with no update available:
`.build/firmware-fleet-live-refresh.json`. Actual installation was tested with
mocks, not live OTA; these GET results do not prove full secure OTA installation.
Existing macOS CI run `37692263376` and Apple's upload both succeeded for app
**1.0 (29.1)**, including 134/134 CI tests and native Swift checks. This earlier
accepted app introduced asynchronous page/background status reads and explicit
sequential Update all. Installation paths were mocked; the live module check
was read-only. Full secure OTA installation, physical new-scene/music,
blackout/thermal and IoT-to-IoT diagnosis remain separate open work.

Run `tools/debug-wifi.py` on a computer on the same LAN as the lamps. No USB cable, phone-app update, or remote shell is required. Each request uses the lamp's existing access password and only reads telemetry. The tool never changes effects, starts recording audio, updates firmware, or restarts a lamp.

Use IP addresses shown in the app, or each lamp's `.local` hostname:

```sh
python3 tools/debug-wifi.py coollamp-50b9f0.local --factory-password
python3 tools/debug-wifi.py 192.168.1.25 192.168.1.26 --factory-password --samples 30 --interval 2
```

`--factory-password` explicitly selects `coollamp`. For a custom password, omit that flag and enter it at the hidden prompt. For automation, `--password-env VARIABLE_NAME` reads an existing environment variable. Do not put custom passwords in command arguments or check them into the repository. Lamps with different passwords should be sampled separately.

Output is one JSON object per lamp per sample; redirect it to an ignored `.build/` file to retain a diagnostic session. A failed lamp produces an error record without preventing the other lamp from being queried. Sampling is bounded to 300 rounds, with at least one second between rounds. Requests have an eight-second timeout and redirects/proxies are disabled.

Published firmware 1.9.5 adds `chipTemperature` to the same
read-only USB/HTTP diagnostics. It contains `supported`, `valid`, `celsius`,
`peakCelsius` (highest successful sample since boot), `sampleAgeMs`, and `error`.
Invalid/unavailable readings are `null`; an SDK failure sets a numeric error
and retains any earlier peak. A valid zero-degree reading remains zero.
The driver initializes and takes its first reading before networking, then
samples on the main loop at most once per second when updater/reset resources
are free. Requests only format cached values; sample age identifies stale
readings while sampling is suspended. No GPIO, lamp-power, or persistent-setting
change is made by this observer. The C3 sensor reports silicon temperature
trends, not a precise ambient temperature or an automatic overheating verdict.
See [Espressif's pinned driver guidance](https://docs.espressif.com/projects/esp-idf/en/v5.5.5/esp32c3/api-reference/peripherals/temp_sensor.html).

Firmware 1.7.3 adds authenticated `GET /api/diagnostics` with:

- Device identity, firmware version and update status.
- Uptime in milliseconds, numeric ESP reset reason, free heap, minimum free heap, and largest allocatable block.
- Wi-Fi connection, IP, RSSI (dBm; meaningful when connected), channel, setup-hotspot clients, and scan result count/timing. A scan count of -1 means running and -2 means failed or not started; `active` disambiguates current state.
- Render frame counter, maximum render duration in microseconds since boot, active effect, brightness, power, LED count and midpoint setting.
- Microphone installation, capture status, amplitude/band summaries, gain/noise floor, capture errors and overruns. No raw audio is returned. Inactive capture is normal outside audio effects.
- Group role, following status and discovered peers. No group invitation key is returned.

Estimate frame rate from the difference in `render.frames` divided by elapsed `uptimeMs` between samples. Counters wrap; discard samples spanning restart or wrap. Diagnostics do not start a Wi-Fi scan or microphone capture. Normal authenticated requests count as setup-hotspot activity.

Older firmware falls back to selected fields from `/api/state`, marked `diagnosticsVersion: 0`; it has less network/runtime information. The tool excludes the state endpoint's session token and home network name from saved output. The new diagnostic endpoint excludes these at the source as well. Reports include device identities and local IP addresses, so review them before sharing publicly.

The assistant needs network access from the computer running this repository. Remote control of this session keeps execution on that computer. This feature does not expose the lamps to the internet or provide a firmware-level debugger, arbitrary memory access, or a remote shell.

## USB fallback for network/group diagnosis

On Windows, install `tools/requirements-usb.txt` into a local virtual environment
and rediscover the COM port. `tools/audio-usb.py` now uses pyserial on all hosts.
See [Windows development](windows-development.md) for tested commands. Close
serial readers before flashing; diagnostic reads assert DTR and keep RTS low.

Development firmware 1.9.4 also exposes the same read-only diagnostic snapshot
with USB command `d`. It streams replies in bounded chunks so a missing USB host
cannot stall rendering. HTTP authentication remains required for the online
endpoint; neither path includes access passwords, Wi-Fi passwords, group keys,
session tokens or raw microphone audio.

```sh
python3 tools/audio-usb.py /dev/cu.usbmodem80201 d --poll --poll-command d --seconds 15
```

The Wi-Fi section includes the AP BSSID, subnet and gateway for identifying
which access point/network a lamp actually joined. The group section includes
whether its UDP listener is running or paused by setup/update activity, plus
received-packet, discovery, authentication-failure, subscription, accepted-frame
and delayed-clock-reply counters. Packet counters are runtime observations;
configured membership alone does not establish that the coordinator can be
reached. A follower with a saved coordinator, `paused=false`, a running listener,
and zero received packets requires network-path investigation before changing
its group code.

On the USB prototype, the group join persisted as a follower, survived a restart,
and was not paused. Wi-Fi reported a good signal, but the running group listener
received no packets from either existing lamp or a discovery-only LAN probe.
Client isolation/broadcast filtering is a hypothesis to verify in the router;
these observations do not establish that an isolation setting is enabled.

A readiness-checked restart test repeated the probe after Wi-Fi had obtained
its address and before the background update check began. At roughly 20 seconds
uptime, the lamp reported over 62 KB minimum free heap, a running unblocked
listener, and zero received group packets. Read-only HTTP from the Mac also
failed. Thus the observed startup delivery failure does not depend on the
updater's later transient memory peak. The router's client-isolation toggle was
reported disabled; further diagnosis requires checking direct peer addresses,
setup-mode suspension on the coordinator, and network forwarding rules.

Further checks confirmed that the coordinator is running firmware 1.9.3 with
role 1 and no setup hotspot. Its live peer list and member count are empty;
the two entries in its scene order are saved positions, including an offline
CoolLamp 1, rather than evidence of an active group connection. Restarting the
coordinator did not restore reception on the new lamp.

On the iPhone connected to the IoT network, the coordinator's numeric address
loaded immediately, while the new lamp initially took 20–30 seconds. An isolated
build disabling modem sleep on the new lamp then loaded promptly on repeated
Safari requests. Firmware 1.9.4 therefore requests `WIFI_PS_NONE` before station
startup and reports the driver's actual `wifi.powerSave` value (`0` none, `1`
minimum modem sleep, `2` maximum modem sleep, `-1` unavailable). This is a
measured improvement on that prototype, not proof that every network-path issue
is resolved. The new lamp still received no group packets, and a separate,
temporary direct TCP probe from it to the coordinator timed out after five
seconds. The probe is isolated under `.build/` and is not part of release firmware.

The iPhone discovery plugin now uses the numeric IPv4 address already resolved
by `NetService`, matching Android's existing behavior, rather than discarding
that address and relying on another `.local` lookup for HTTP. Empty, truncated
or incompatible socket records fall back to the hostname. Device identity is
still checked before controls are enabled. Refresh the app's Wi-Fi list once
after installing this change to replace older session discoveries.

## Secure updater memory pressure

At the historical Mac checkpoint, both published OTA manifest URLs were
independently verified to return 1.9.4.
An isolated USB-lamp diagnostic then captured the failure beneath the generic
network error: RSA public-key verification returned `-0x4290`, composed of
`MBEDTLS_ERR_RSA_PUBLIC_FAILED` (`-0x4280`) and
`MBEDTLS_ERR_MPI_ALLOC_FAILED` (`-0x0010`). Minimum free heap fell to 572 bytes;
after the failing verification returned, free heap was 10,268 bytes and the
largest block was 7,668 bytes. Subsequent trials sometimes succeeded with only
about 1 KB of minimum free heap. This establishes memory exhaustion on the USB
prototype, rather than proving an outage or certificate-expiry problem. A
matching fresh diagnostic was still needed at that checkpoint to attribute
CoolLamp 2's failure; the current release follow-up is recorded below.

The app now reads `/api/firmware` immediately after firmware actions and while
the updater is checking, downloading or restarting. It checks this compact
status before periodic full-state reads, then resumes normal state refreshes
when the updater is idle, available or failed. If the firmware version changes,
it reloads state to verify identity and obtain the new token and effect catalog.
This reduces HTTP response allocations during TLS and works with existing
firmware. Failed firmware downloads retain a functioning Wi-Fi connection;
they are not treated as phone-to-lamp transport failures. No uncertain POST is
replayed. Host and browser checks cover progress, errors, restart identity/token
refresh, malformed/stale replies and the absence of full-state reads after an
update begins.

Temporary TLS probes under `.build/` record error codes, allocation sizes and
memory metrics only. They preserve certificate-verification results, contain no
credentials or audio, and are not part of published firmware. Restricting TLS
groups/ciphers alone did not eliminate the measured low-memory failure, so that
experiment has not been adopted as a release fix.

### Earlier publication checkpoint — 2026-10-07

[Firmware 1.9.5](https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.9.5)
is now public, including the 16 KiB receive / 4 KiB transmit TLS archive and
cached temperature diagnostics. Firmware CI run `37682079916` passed on
commit `7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f`; the published image is
1,828,656 bytes, SHA-256
`aabfb5bfcd314242c381b3494cbe7aca09b43f58d0de4b4d101e0e7e487d0082`.
App 1.0 (27.1) was uploaded through successful macOS CI run `37682084000`
and accepted by Apple; tester availability is not independently verified.

At the initial publication checkpoint, CoolLamp 2 was observed running 1.9.4.
Its manual and quiet HTTPS
checks still fail with error 3, TLS 12288, transport 32794, HTTP 302, host 2.
Authenticated local Python and curl uploads returned empty replies. The lamp's
running version remained 1.9.4, but upload success and next-boot selection were
unconfirmed; USB identity and OTA-selection verification were pending then.
The coordinator's later verified bootstrap is recorded in the latest section
above. CoolLamp 1's quiet check likewise ended on 1.9.4, phase 5/error 3,
HTTP stage 2/code 302/host 2, TLS 12288/transport 32794, automatic updates true.
Evidence: `.build/ota-1.9.5-quiet-192.168.1.154.json`. USB bootstrap and full OTA
installation were pending at that checkpoint; a published release does not mean old firmware
has acquired the smaller TLS buffers.

BACL already runs the temperature-enabled Windows 1.9.5 candidate, SHA-256
`13940566fe29d92c668820ebd6319f67aac7424d99ef78c7ef9f2203306709ab`.
It has the release source but different bytes from the CI asset. Normal OTA
version gating does not offer another 1.9.5 image. Blackout/thermal diagnosis
and the separate IoT-to-IoT forwarding issue remain unresolved.

BACL's fresh secure check of the published manifest completed phase 0/error 0,
latest 1.9.5, HTTP stage 7/code 200/host 2, TLS error/flags 0 and transport 0
while actively following the group. Evidence:
`.build/bacl-published-1.9.5-check.jsonl`. A latest separate status snapshot
showed all lamps on, mode 46, brightness 55, scene 0, with BACL unpaused/active
at 61.1 C; these were the preservation baseline for the subsequent USB work.
The successful manifest check does not establish a full OTA installation or
unchanged controls throughout the check.
