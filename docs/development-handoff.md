# CoolLamp development handoff — 2026-10-06

## Current development — 2026-10-08: offline groups and global Groups page

The user requested Bluetooth control/configuration plus ESP-NOW group
coordination when Wi-Fi is unavailable, and a separate Groups page showing
leaders, followers and independent lamps without selecting a coordinator.
The local firmware candidate is **1.10.0**, not published. Public OTA remains
1.9.6 and the accepted TestFlight upload remains 1.0 (31.1). Read
[the new implementation and test checkpoint](offline-groups.md) before
resuming this work.

The chosen test pair, CoolLamp 1 (`acb950b2f180`, `.154`) and CoolLamp 2
(`f0b950b2f180`, `.222`), were freshly verified on 1.9.6 with stable Wi-Fi.
The sanitized baseline is `.build/hybrid-test-lamps-baseline.json`.
CoolLamp 1 still has startup effect 43/brightness 215; CoolLamp 2 has startup
effect 46/brightness 55. Both currently participate in scene 27. One local OTA
upload to CoolLamp 1 failed with an empty server reply; fresh readback confirms
it still runs 1.9.6 with continued uptime and unchanged compared settings.
CoolLamp 2 was not uploaded. USB access to CoolLamp 1 is pending. Preserve these
current settings rather than assuming older handoff snapshots still apply.

## Latest release follow-up — 2026-10-07: 1.9.6 public; app 31.1 uploaded

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

App **1.0 (31.1)** is the latest accepted TestFlight upload. The existing macOS
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

No hardware requests or flashing were performed during publication, and no
lamp installation of 1.9.6 is confirmed. Publishing and successful builds do
not establish physical corkscrew/music acceptance or a full secure OTA
installation. Those checks, same-IoT forwarding and the earlier blackout/thermal
investigation remain separate unresolved work. The raw Mac diagnostics and
prototype binaries remain an unfilled migration gap.

## Earlier local development checkpoint — 2026-10-07: corkscrew effects candidate

Six new group scenes 27–32 are implemented for corkscrew, helix and mixed rooms:
Chromatic screw, Mercury ribbon, Bass turbine, Prism torque, Echo coils and
Aurora braid. The first two are ambient; the last four require the coordinator
microphone. Every scene retains a colored field during silence/dropout. Existing
0–26 rendering, GPIOs, strip geometry/defaults, settings/NVS and wire v2 remain
unchanged. Existing midpoint calibration supports unequal spine/spiral lengths;
the new lamp's exact wiring/count/top-turn boundary is still unconfirmed.

At this earlier checkpoint, firmware **1.9.6 was a local unpublished candidate**,
built and packaged at
1,830,784 bytes, SHA-256
`a1db07d1de968d94a1e007938119b79ca8d085bc26f2540347079403c8a81cdd`.
Public OTA then remained 1.9.5, and TestFlight 30.1 was the accepted app; the new
six-entry app catalog and 1.9.6 compatibility labels had not been uploaded.
No physical lamp operations or GitHub publication had been performed for this set.
Prior Windows firmware artifacts were preserved before rebuilding.

Validation passed: 68,673,600 new-scene LED samples all lit at normal settings,
exact legacy-render signature, protocol/runtime microphone/persistence checks,
166 mobile tests, production web build and four packaging checks. Six mocked
built-app scenarios passed with 46 intercepted lamp requests. The actual-renderer
preview now animates Helix/Corkscrew/Mixed rooms, 2/3/5/9 lamps, audio/silence;
336 browser control combinations and timing/layout checks passed. Hardware
acceptance and sanitizer CI were pending at this checkpoint. See
[the effects and evidence](corkscrew-effects.md). Existing OTA, networking,
thermal and missing Mac raw-evidence gaps remain separate.

## Earlier accepted upload — 2026-10-07: direct group joining; app 30.1

The user requested that Settings → Groups discover network coordinators and
join directly without switching lamps or copying a group code. App-only source
`c6674ba38cc76214d2d311c003fff1f1513095f0` is pushed to
`codex/firmware-1-9-5-temperature-room-audio`. Existing macOS CI run
`37698202209` completed successfully for app **1.0 (30.1)**, including
165/165 CI tests, native Swift accessory/address checks, web build and signed
archive/export/upload. Apple reported `UPLOAD SUCCEEDED with no errors` at
`2026-10-07T22:50:22.803933Z` (17:50:22 CDT). Evidence:
`.build/ios-testflight-30.1-ci.log`. App 30.1 was latest at this checkpoint;
29.1 is the preceding checkpoint. Tester availability and phone installation
have not been independently queried. Every GitHub action uses personal
**jammendolia** only. Published firmware 1.9.5 remains unchanged.

Groups now scans asynchronously from saved lamps, native mDNS discovery and
the selected lamp's UDP peer hints. Authenticated reads verify device identity,
current coordinator role, wire compatibility and available group capacity.
An explicit **Join** obtains a private invitation in the background, then uses
the selected target's fresh token with identity/address/connection-epoch/wire
guards. The app keeps the selected lamp and its catalog; it does not expose the
invitation through the DOM, storage or clipboard. A custom-password modal saves
the password in the native vault only after verification. An optional Advanced
manual-code fallback remains available; joining does not silently leave an
existing group. Status distinguishes saved/waiting settings from actual
following, and an uncertain join POST triggers read-only readback without replay.

Seven mobile paths changed; firmware, native code and GPIO assignments are
unchanged. Local validation passed **165 tests**, the production web build and
seven mocked browser scenarios with 271 intercepted requests. A separate live
**GET-only** scan verified CoolLamp 2 as coordinator on 1.9.5 with zero members,
identified CoolLamp 1 as not a coordinator, and reported BACL's unreachable
status separately. Evidence: `.build/group-discovery-live-validation.json`.
No live invitation request or membership mutation was performed; joining and
credential/error scenarios are mock-validated, and actual devices are unchanged.
The existing IoT-to-IoT UDP limitation remains separate: saving group settings
does not guarantee the follower receives discovery, subscribes or follows.

New lamp first install (2026-10-07): COM6, MAC `24:EC:4A:AF:94:58`, device
`5894af4aec24`, hostname `coollamp-af9458.local`. The user confirmed it was
brand new and requested no backup. Verified ESP32-C3 revision 0.4/4 MB received
the pinned bootloader, dual-OTA partition table, initial app0 selector and exact
published 1.9.5 application. All four written hashes verified. Twenty USB
diagnostic samples showed advancing frames/uptime, valid 36–39 C chip readings,
and no observed reset, through uptime 65828 ms. Defaults are 134 LEDs/midpoint
0, Fire/brightness 100, microphone disabled, automatic updates disabled and
Wi-Fi unconfigured. No pairing/group enrollment was performed. Evidence:
`.build/new-lamp-24ec4aaf9458-1.9.5-validation.json`. USB capture is closed.

## Earlier verified follow-up — 2026-10-07: all lamps updated; app 29.1 uploaded

App **1.0 (29.1)** was accepted at this earlier checkpoint, from source
`d8620a428406bdd4a9a8cb3fcd0188135b43bc70`. Existing macOS CI run `37692263376`
succeeded, including 134/134 tests, native Swift accessory/address checks,
web build, signing, archive/export and upload. Apple reported
`UPLOAD SUCCEEDED with no errors` on 2026-10-07 at 16:56:54 CDT.
Evidence: `.build/ios-testflight-29.1-ci.log`. Tester availability and phone
installation have not been independently queried. App 28.1 is the earlier
firmware-card upload; app 29.1 adds asynchronous per-card status reads and
explicitly triggered, sequential **Update all**.

CoolLamp 2 now runs the exact **published firmware 1.9.5** image after USB
bootstrap. COM5 and MAC `80:F1:B2:50:B9:F0` were verified. Its fresh 1.9.4 boot
completed secure HTTPS setup and began automatic download, but reached only
47% before the existing 180-second limit ended in phase 5/error 6. This was a
failed full OTA attempt, followed by a separate successful USB installation.
Evidence: `.build/coordinator-published-1.9.5-auto-ota-attempt.json`.

The fresh private 4 MiB backup has SHA-256
`703b82e9fffa7e5fde52bd3db6ae6075e359776a5142198898247a04473fb2ea`.
CRC-valid metadata selected app0, sequence 5/state 2; the recovered old image
matched `f9c1e3bb0f9f0e926e4c8ec0ba2994e570e31162cce44a413c367ab3a6afe223`.
Only app0 at `0x10000` was written with the immutable published CI image,
1,828,656 bytes, SHA-256
`aabfb5bfcd314242c381b3494cbe7aca09b43f58d0de4b4d101e0e7e487d0082`;
ROM write-hash verification passed. Raw readback found **no logical NVS
changes**, and partition table/OTA metadata were unchanged. Saved API settings
and runtime controls also matched (`changedFields: []`). GPIO assignments and
lamp settings remain preserved; all recovery blobs stay private under `.build`.

The new boot showed valid temperature 53.7 C at 41.8 seconds, sceneCount 26,
power on, mode 46, brightness 55, 134 LEDs/midpoint 0. The subsequent 95-second
USB capture showed at least 93.6 seconds of stable observed operation. A fresh
secure manifest check **passed**: latest 1.9.5, phase 0/error 0, available false,
HTTP stage 7/code 200/host 2, TLS error/flags 0 and transport 0. Later HTTP
diagnostics at uptime 174306 ms reported valid 55.7 C and sceneCount 26.
Evidence: `.build/coordinator-published-1.9.5-usb-boot.jsonl`,
`.build/coordinator-published-1.9.5-https-check.jsonl`, and
`.build/coordinator-1.9.5-usb-settings-comparison.json`.
CoolLamp 2 can return to normal power. CoolLamp 1's later COM3 bootstrap is also
complete; MAC `80:F1:B2:50:B9:AC` was verified. Its fresh private 4 MiB backup
has SHA-256 `14a2e6fb973b02f79830c67f70b7e37fa808e4c4261a738d1c781ffc9686bfe6`.
CRC-valid sequence 22/state 2 selected **app1 at `0x200000`**, so only that
verified active slot was written with the exact published 1.9.5 image; ROM hash
verification passed. Partition table/OTA selector and **all logical NVS records**
were unchanged (`nvsChanges: []`). Saved API settings and runtime controls
matched (`changedFields: []`). Preserve its freshly verified, distinct settings:
startup mode 43/brightness 215, microphone installed with automatic gain,
gain 8/gate 10/scale 115, 134 LEDs/midpoint 0, automatic updates enabled,
follower role 2 with CoolLamp 2 as leader. Prior-day snapshots are not authoritative.

CoolLamp 1's healthy 95-second USB capture had 45 valid records spanning
95363 ms. Its scheduled secure check passed: current/latest 1.9.5, phase 0,
error 0, HTTP stage 7/code 200/host 2, TLS error/flags 0 and transport 0. Final
diagnostics at uptime 150004 ms showed valid 57.7 C and historical peak 58.7 C.
Evidence: `.build/lamp1-published-1.9.5-usb-boot.jsonl`,
`.build/lamp1-published-1.9.5-https-check.jsonl`,
`.build/lamp1-1.9.5-usb-nvs-comparison.json`, and
`.build/lamp1-1.9.5-usb-settings-comparison.json`.
CoolLamp 1 can disconnect USB and return to normal power. Final separate reads
confirmed **all three lamps on firmware 1.9.5**, power on, mode 46, brightness
55, group scene 0 (`.build/other-lamps-after-lamp1-bootstrap.jsonl`). CoolLamp 1
and CoolLamp 2 run the exact published CI image; BACL retains its validated
Windows 1.9.5 build. Full secure OTA installation, physical new-scene/audio
acceptance and longer blackout/thermal follow-up remain open. The user noticed
no blackout during the short comparisons, but observation was incomplete.

Earlier app **1.0 (28.1)** introduced per-device installed-firmware cards: **Last seen**
for disconnected remembered versions and **Connect to view** for unknown
versions, with no extra hardware polling. Four mobile files changed; 104/104
tests, production web build and mock browser check passed. Commit
`a3499e89a69fcb7bbb56b6a9f3fdae4f21761821` completed existing macOS CI run
`37688466205`; Apple reported `UPLOAD SUCCEEDED with no errors` on
2026-10-07 at 16:23:19 CDT. Evidence: `.build/ios-testflight-28.1-ci.log`.
Tester availability and installation remain unverified. Earlier app 27.1's
accepted upload and immutable firmware source commit
`7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f` remain established history.
Every GitHub action uses personal **jammendolia** only; HiFin remains untouched.
The requested asynchronous per-card status refresh and explicit **Update all**
are now implemented in source `d8620a428406bdd4a9a8cb3fcd0188135b43bc70`, pushed
to the existing codex branch. Local validation passed 134/134 tests, production
web build and mocked UI checks, including one blocked/deferred ping while other
cards update and Light/Settings navigation/other-lamp controls stay usable.
Update all processes lamps sequentially with per-lamp progress/errors; offline
or missing-password lamps fail separately. Selection, disconnection and saved
automatic-update preferences are not changed. Installed-versus-latest checks
and timestamp ordering guards prevent stale or misleading card results.

Page-open/background refresh only reads lamp status; updates started by the app
require an explicit button. A separate live GET-only refresh verified all three device IDs
and returned installed/latest 1.9.5, with no available update. Evidence:
`.build/firmware-fleet-live-refresh.json`. Install behavior was validated with
mocks; these live reads do not establish an actual full secure OTA installation.
Existing macOS CI run `37692263376` completed successfully for app **1.0 (29.1)**
(run number 29, attempt 1), with 134/134 CI tests and native Swift checks passing.
Its signed archive/export/upload passed; Apple accepted the upload at
16:56:54 CDT (`.build/ios-testflight-29.1-ci.log`). Tester availability/phone
installation remain unverified. App 28.1 is superseded as the latest accepted
upload but retained as an earlier checkpoint. Actual bulk installs remain
mock-validated; live fleet verification was GET-only, and full secure OTA,
new-scene/music, thermal/blackout and IoT-to-IoT acceptance remain separate gaps.
The checkpoints below retain earlier states and are superseded where this
latest block records new hardware or app results.

Earlier publication checkpoint (2026-10-07): [firmware 1.9.5](https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.9.5)
is now the latest public release, from commit
`7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f`. Firmware CI run
`37682079916` passed. The published application image is 1,828,656 bytes,
SHA-256 `aabfb5bfcd314242c381b3494cbe7aca09b43f58d0de4b4d101e0e7e487d0082`.
The existing macOS TestFlight workflow also succeeded (run `37682084000`),
and Apple accepted app **1.0 (27.1)**. Tester availability and user installation
have not been independently verified. Every GitHub action used a verified
process-local **jammendolia** identity; the HiFin account was untouched.

BACL still runs the temperature-enabled Windows 1.9.5 build, SHA-256
`13940566fe29d92c668820ebd6319f67aac7424d99ef78c7ef9f2203306709ab`.
It has the same source as the published release but different binary bytes;
the normal version gate does not offer another 1.9.5 image. At that checkpoint,
CoolLamp 2 and CoolLamp 1 were observed running 1.9.4. Their quiet HTTPS checks failed
with error 3, TLS 12288, transport 32794, HTTP 302, host 2; CoolLamp 2's manual
check also failed. Authenticated Python and curl local uploads to CoolLamp 2
returned empty replies. Upload success and its next-boot image were unconfirmed;
USB identity/OTA-selection verification and bootstrap were pending then.
CoolLamp 2's later verified bootstrap is recorded above. Publication does not establish a completed OTA installation,
a blackout/thermal fix, or a resolution of the IoT-to-IoT network issue.

Earlier live snapshot (2026-10-07, after initial publication): all three lamps
were on, mode 46, brightness 55, group scene 0. BACL was unpaused and actively
following, with chip temperature 61.1 C. These controls were the preservation
baseline for USB bootstrap rather than the earlier thermal-test controls.
BACL's fresh secure check completed phase 0/error 0 with latest 1.9.5,
HTTP stage 7/code 200/host 2, TLS error/flags 0 and transport 0 while group sync
was active. This proves the published-manifest check, not a same-version OTA
installation or unchanged controls throughout the check. Evidence:
`.build/bacl-published-1.9.5-check.jsonl` and
`.build/ota-1.9.5-current-lamp-status.jsonl`.

Earlier USB/thermal resume (2026-10-07): the user returned with BACL on USB and the base open.
At their temperature-sensor inquiry, chip-temperature telemetry was added and
the updated 1.9.5 candidate installed on verified BACL/COM4. Only app0 was
written; all non-PHY logical NVS records, partition table and OTA metadata
remained unchanged. The full pre-update recovery backup is private under
`.build`. A two-minute capture recorded 208 valid readings at 55.1–56.1 C, no
uptime resets, power changes or rendering stalls; this is USB/open-base evidence,
not proof about the original blackouts. Controls at that capture checkpoint:
Fire/brightness 100, power on, group paused. Wi-Fi temperature telemetry works.
All captures ended.
Normal-supply/open-base Wi-Fi baseline is now complete: 526 successful replies
over five minutes, 54.1–57.1 C, no observed resets/power changes, 18 read timeouts
retained as gaps. Controls matched the USB baseline; coordinator remained off.
Closed-base comparison is now complete: five minutes, 590 successful replies,
56.1–59.1 C, no observed resets/power changes, three read timeouts. Both windows
used Fire/brightness 100/group paused. A restored two-minute Orbit group test
on normal power/closed base returned 233 replies, 59.1–60.1 C, no resets or
power changes; following stayed active after joining. All controls were restored:
BACL on, Fire 100, group paused; coordinator off with Orbit settings retained.
Base remains closed on usual supply. No capture is active. Physical blackout
confirmation is inconclusive: the user noticed no blackout but was multitasking
and may have missed one. Short captures and rising temperature do not prove or
exclude heat as the historical cause. No firmware/settings change between these
thermal phases. Longer warm-up, local-off device acceptance and full OTA remain
pending despite the subsequent publication recorded above.
The user subsequently authorized publishing this temperature-enabled firmware
for OTA and the pending mobile changes to TestFlight; both CI uploads completed.
Continue using only jammendolia and the existing macOS CI, preserving this working tree.
See [group-network-debugging.md](group-network-debugging.md) for evidence.

Earlier source-work checkpoint while hardware diagnosis was paused: the user requested more
room-filling audio group effects. Eight scenes (IDs 19–26) are implemented and
host/build validated, with a real-renderer room preview. See
[room-audio-effects.md](room-audio-effects.md) for designs, compatibility and
current candidate hash. BACL had the candidate including those scenes and
the local off fix, but physical multi-lamp/audio acceptance has not run; the
coordinator was still on 1.9.4 at that checkpoint. The scene-catalog app was
uploaded as 1.0 (27.1), and firmware publication was complete.
Hardware/thermal/OTA acceptance remained pending.

Windows continuation: see [windows-development.md](windows-development.md) for
the verified migration state, local tooling, private backup and remaining
release-validation gaps. The Mac checkpoint below is historical. Its ignored
diagnostics remain on the Mac; the source checkpoint did transfer successfully.
For CoolLamp GitHub operations, explicitly verify and use **jammendolia only**;
the Windows CLI's global default is HiFin and must not be used for this project.

## Checkpoint and user intent

The user requested a safe breakpoint to reboot the Mac, then continue in a fresh chat. Stop active engineering at this checkpoint. No flash is in progress. The final production build completed successfully, exit 0; do not confuse a successful build with a published or device-tested release.

Latest steering: user wants to move routine development to Windows machine **Beefinator**, retaining the Mac for iOS builds/testing. They also have a machine with a Ryzen 7 5800, 64 GB RAM, RTX 3070 8 GB. Its OS/storage and Beefinator's specifications have not been confirmed. That machine is ample for this project; no evidence establishes it is faster than their Mac or Beefinator. GPU does not accelerate the current firmware/mobile build pipeline. No files have been transferred and no Windows setup has been performed yet.

Update: Beefinator has Intel Core Ultra 7 255H, 64 GB DDR5-5600, RTX 3050 Laptop 4 GB, and Intel Arc 140T. The user chose Beefinator, then requested committing the current work before migration. This checkpoint is being saved on **`checkpoint/windows-migration-2026-10-06`**, based on the latest app branch `release/firmware-1.9.5`. Clone that checkpoint branch on Windows. Source, docs, CAD, images and pending TLS build changes are included; build caches, private secrets, KiCad session files and generated example firmware are excluded. This is a source checkpoint, not a new firmware or TestFlight release.

Repository: `/Users/jammendolia/Dev/Gasper/CoolLamp`. Read this file and `docs/wifi-debugging.md` before continuing. Preserve the existing working tree: it contains months of accumulated changes, while local Git HEAD is old. Do not reset, clean, or broadly stage it.

## Historical Mac objective on resumption

Finish and validate the firmware OTA memory fix, then prepare firmware 1.9.5. Firmware 1.9.5 has NOT been published. The user previously authorized firmware publishing, USB flashing to the connected lamp, and TestFlight publishing; the latest instruction pauses work until after reboot. Continue only when the user resumes.

Secondary unresolved issue: the synchronized group has no live UDP peers, despite all three lamps being joined to the same Wi-Fi. Do not claim the OTA memory fix resolves this separate issue.

## Published state at the historical Mac checkpoint

* Public firmware: **1.9.4**, release `firmware-v1.9.4`, https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.9.4 . The radio uses `WiFi.setSleep(false)`. This release still has the original 16 KB TLS transmit buffer and can fail manual update checks under memory pressure.
* Branch `release/firmware-1.9.4`: head `c19b4ea3b1932334921f90eb515c4fb838ac22cb`, tree `0477e514d8f3e9f91d35a838a18cd90f602e2248`. Published binary: 1,821,936 bytes, SHA256 `f9c1e3bb0f9f0e926e4c8ec0ba2994e570e31162cce44a413c367ab3a6afe223`.
* Latest app uploaded and accepted by Apple: **1.0 (26.1)**. User installation has not been confirmed. Workflow run `37478950734`, job `112321717425`, successful upload. This build reduces firmware progress polling allocations by using `/api/firmware` instead of repeated full state requests while checking/downloading/restarting.
* Branch `release/firmware-1.9.5`: head `76f1108d44ae0b68b45a0830adcd3894b6a776ab`, tree `6fed8b7df662a8db1976051c70ea80dd33a45852`. This branch currently contains app 26.1 and documentation, not a firmware 1.9.5 release. `LampVersion.h` is still 1.9.4.
* App 26.1: 97 mobile tests and the Bluetooth/Wi-Fi browser check passed. See `.build/ota-compact-mobile-tests.log`, `.build/ota-compact-browser.log`, `.build/ota-compact-app-build.log` if present.
* `.build/wifi-reception-publish-record.json` and `.build/ota-memory-publish-record.json` record previous publishing details.

## Proven OTA failure and tested fix

The release server is healthy. Both automatic and manual updates use the same updater path. Quiet automatic checks occasionally succeed; manual checks often fail because the C3 runs out of heap during RSA certificate verification for the release-assets HTTPS redirect.

USB diagnostic wrapper captured **-17040 (-0x4290)** from PK verification: RSA public operation failure (-0x4280) combined with MPI allocation failure (-0x0010). Minimum free heap was **572 bytes**. CoolLamp 2's user-supplied diagnostics independently showed **192 bytes** minimum free heap, TLS error 12288 (0x3000), transport error 32794 (0x801A), redirect HTTP 302, host 2. This is not evidence of a bad password, expired certificate, or defective ESP32.

SDK defaults allocate 16 KB receive and 16 KB transmit TLS buffers. The working prototype rebuilds only the SDK SSL archive with **16 KB receive / 4 KB transmit**, saving approximately 12 KB. It preserves certificate verification, SDK trust bundle, SDK crypto/X509 libraries, public headers, and ABI. No insecure TLS fallback was introduced.

On the USB lamp, a boot check and two manually triggered checks succeeded with HTTP 200, no TLS errors, and minimum free heap **13,060 / 13,032 bytes** while diagnostics were polled every 1–2 seconds. A full firmware download/install and production-image device stress tests remain outstanding.

An earlier experiment restricting curves/ciphers did not reliably solve the memory problem. Do NOT adopt the temporary lean-cipher experiment into production `UpdateHttp.cpp`.

## Local changes at the historical Mac checkpoint

* New `tools/build-tls-library.cjs`: pinned-source rebuild and cache of the smaller SSL archive, with source SHA validation, exact public-header comparison, ABI probes, and exported symbol comparison. It does not modify installed SDK archives.
* Modified `tools/build-firmware.cjs`: calls the helper and links the replacement archive with whole-archive flags, preserving the existing Wi-Fi/Bluetooth init wrappers.
* These build changes and this handoff are included in the Windows migration checkpoint branch; they are not a published firmware release.
* Final production build **passed** using these tools. `.build/tls-production-build.log`: verified C3 TLS library, sketch **1,822,292 bytes / 89%**, globals **52,700 bytes**. Output is in `firmware/public` and is still labeled version 1.9.4. Do NOT publish it over the existing 1.9.4 tag or assume it is the original published binary.
* Production helper needs focused regression/failure-guard testing and device testing. Current helper explicitly targets C3; S3 support has not been implemented.

Pinned toolchain: Arduino ESP32 **3.3.11**, ESP-IDF **5.5.5**, Mbed TLS **3.6.6**. Official Espressif Mbed TLS source commit `9d669eadb1955d348986b9280156710aaaadf79f`; tar archive SHA256 `45f5e3ca387dfc1dbc41bd221f56971a6d254eb1a88d8a0faadfa9e0d193719d`. Official IDF submodule metadata confirmed that commit. The SSL archive to replace is **libmbedtls_2.a**, not libmbedtls.a (which holds the certificate bundle).

Useful paths:

* `.build/tls-library/` — new reproducible helper cache/source/output.
* `.build/tls-sdk/build.py`, `build-record.json`, `source-record.json`, `libmbedtls-ota.a` — first verified prototype build and ABI/export evidence.
* `.build/tls-small-live.jsonl`, `.build/tls-small-repeat-1.jsonl` — successful small-buffer checks.
* `.build/tls-probe-live.jsonl` — original allocation failure.
* `.build/tls-small-build.log`, `.build/tls-small-flash.log` — prototype build/flash.

Production build command from repo root:

```sh
ARDUINO_CLI="$PWD/.build/tooling/arduino-cli-local" .build/tooling/node-v22.16.0-darwin-x64/bin/node tools/build-firmware.cjs --public
```

FQBN: `esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=no_fs`. Arduino properties queries must use a repo `.build` build path to avoid writing to the forbidden home cache.

## Lamps at the historical Mac checkpoint

| Lamp | ID | Last known address | Status |
| --- | --- | --- | --- |
| Big Ass CoolLamp / new lamp | `24eae26e9e9c` | `192.168.1.220`, `coollamp-e2ea24.local` | USB test prototype, normal features retained; 205 LEDs, midpoint 102, INMP441 |
| CoolLamp 2 coordinator | `f0b950b2f180` | `192.168.1.222`, `coollamp-50b9f0.local` | Published 1.9.4, 134 LEDs; automatic updates enabled |
| CoolLamp 1 | `acb950b2f180` | `192.168.1.154`, `coollamp-50b9ac.local` | 134 LEDs, INMP441; firmware not freshly confirmed |

USB port last seen `/dev/cu.usbmodem80201`, right USB-A port on session Mac. Re-enumerate after reboot rather than assuming the port name persists. New lamp C3 rev 0.4, 4 MB flash; Wi-Fi MAC `9c:9e:6e:e2:ea:24`.

**Current USB firmware is the diagnostic small-TLS prototype labeled 1.9.4**, built from `.build/sketch-tls-small/CoolLamp` into `.build/firmware-tls-small/`. It includes temporary PK-verification/allocation trace hooks and USB commands: `d` diagnostics; `i` requests a check (no automatic install). The hook calls the real verifier unchanged. The extra `tlsProbe` JSON fields are diagnostic only and should not ship. Automatic install is disabled on this USB lamp. Last observed updater phase 0, error 0, no update available, no upload/download active; safe to reboot the Mac.

Prototype serial helper: `.build/tls-probe-usb.py` (based on `tools/audio-usb.py`). Read its CLI before invoking. Do not overlap serial readers and uploads. No active reader/build/upload was left at the checkpoint.

All lamps use default access password `coollamp` per user instruction. Do not paste customized secrets or raw PCM into logs. Gain/gate/scale on USB lamp: 8/8/100. Saved Wi-Fi TX power on USB lamp is 8.5 dBm (`wifiPower` quarter-dBm 34); preserve it. Keep NVS, bond, group, name, LED-count and midpoint settings during testing. No factory resets unless explicitly requested.

## Network and group findings

Router: Adtran **SDG-8734**, gateway `192.168.1.1`, /24. All three lamps are on **SmellsLikeEarwax_IOT**, WPA Personal PSK + CCMP; main SSID is SmellsLikeEarWax with WPA2/WPA3 mixed security. User confirmed Client Isolation is disabled. Radio AP BSSID `86:4D:4C:D8:F0:89`, channel 11.

Turning off Wi-Fi sleep made the new lamp's Safari page load promptly. App earlier discarded NetService's resolved IPv4 then tried unreliable `.local` resolution; this was fixed in the published app. Direct app connection to `192.168.1.222` succeeds.

However, coordinator and follower diagnostics still show **zero UDP packets received**, zero live peers and members, even after coordinator updated to 1.9.4. Saved `order` entries are not live membership. USB direct TCP probe to coordinator timed out during an earlier test. Mac (`192.168.1.190`, en3 Ethernet) cannot reach lamp IPs and has incomplete ARP, although gateway access works. Tailscale has no exit node/overlapping route; do not disable it because remote session access may depend on it. Exact LAN restriction has not been proven. Investigate independently after OTA is stable, without claiming router isolation is enabled or hardware is defective.

## Historical Mac resume sequence

1. Inspect handoff, build helper and final log; preserve working files. Check actual connected device and current status.
2. Review helper correctness and add focused tests for pins/cache/source/ABI failure handling. Run relevant existing firmware checks. Avoid re-running unrelated UI work unnecessarily.
3. Flash the production image to the authorized USB lamp with its existing settings retained; repeat secure update checks under normal app polling, audio/render/group load. Verify no diagnostic hooks and adequate heap. Keep original release and prototype artifacts available.
4. Prepare a real version **1.9.5**, release workflow/manifest, and validate reproducible CI build. Do not overwrite the published 1.9.4 assets/tag. Publish only after necessary validation. Verify actual full OTA download/install on a lamp, then ask user to check CoolLamp 2's manual update path.
5. Resume group-network debugging separately once updater stability is established.

Local `.git` is read-only in this environment. Previous releases were made using GitHub connector `create_tree`, `create_commit`, `update_ref` with expected SHA, overlaying only intended files onto the current remote tree. Use that approach if direct Git remains unavailable. Do not push casually to `release/firmware-1.9.4`: its publish workflow may attempt the existing tag again. App build 26.1 is already uploaded; don't publish another app build merely for firmware tooling/docs changes.

## Historical Mac new-chat prompt

Continue CoolLamp development in /Users/jammendolia/Dev/Gasper/CoolLamp. First read docs/development-handoff.md and docs/wifi-debugging.md. Resume the OTA heap/TLS fix from the checkpoint, preserving existing GPIO assignments and lamp settings. Review the successfully built 16 KB receive / 4 KB transmit TLS implementation, complete production/device validation, then prepare firmware 1.9.5 for OTA. App 1.0 (26.1) is already uploaded to TestFlight. Firmware 1.9.5 is not published. Keep the separate group UDP connectivity issue on the follow-up list. Do not reset the working tree or repeat completed app work; report current status before continuing.

## Windows migration notes

Clone **`checkpoint/windows-migration-2026-10-06`** to obtain the saved source checkpoint, rather than the repository's older default branch. Preserve the Mac copy as backup. Full `.build` diagnostic logs and prototype binaries remain local; `.build` is ignored. The findings and relevant measured values are recorded above, and the optimized TLS library is reproducible from pinned source. Do not copy Mac `node_modules`, Darwin toolchains or compiler caches as Windows dependencies. Do not distribute private signing material/secrets in a general source archive.

Install Windows-native Git, Node 22, pnpm (CI currently pins 11.19.0), Python 3, Arduino CLI and pinned ESP32 core 3.3.11/libraries. Use a short local path such as `C:\Dev\CoolLamp`, outside OneDrive, and reinstall mobile dependencies using the pnpm lockfile. Android development additionally needs the project's compatible Android Studio/JDK/SDK. CAD can also move to Windows with KiCad/OpenSCAD installed. Native Windows is the simplest starting point for direct USB COM ports and local-network lamp diagnostics; don't add WSL USB/network forwarding unless necessary.

The firmware Node script already has a Windows CLI lookup and the new TLS helper recognizes `.exe` compiler tools. However, the new helper has only been executed on macOS: validate Windows SDK response-file paths, quoting, `tar` availability, ABI/export parsing, and archive linking before declaring it portable. Host tests/scripts may assume Unix commands; inspect and adapt those narrowly. **Confirmed portability gap:** `tools/audio-usb.py` uses POSIX `termios`, `fcntl`, and serial `select`; it does not run natively on Windows. Port this diagnostic helper to pyserial (retaining DTR and avoiding unintended resets), rather than merely replacing the device path. Temporary TLS probe helper inherits the same gap. Rediscover Windows COM ports. Do not change firmware GPIO assignments as part of migration.

Native iOS compilation and simulator/device debugging still require macOS/Xcode. TestFlight distribution currently uses the repository's GitHub Actions macOS runner, which can be triggered from Windows; a running local Mac is not inherently required for that existing CI workflow. Preserve the Mac for native iPhone/Bluetooth troubleshooting and signing workflows if needed.

Suggested Windows continuation prompt:

Continue CoolLamp development on this Windows computer. First read docs/development-handoff.md and docs/wifi-debugging.md in the transferred repository. Verify that the Mac's pending TLS build changes and diagnostic evidence were transferred before modifying anything. Set up and validate the Windows build/test tools, preserving GPIO assignments, lamp settings and the working tree. Then resume the OTA heap/TLS fix, validate the 16 KB receive / 4 KB transmit implementation on the USB lamp, and prepare firmware 1.9.5 for OTA after tests pass. App 1.0 (26.1) is already uploaded to TestFlight; use the existing macOS CI workflow for future iOS builds. Firmware 1.9.5 is not published, and group UDP connectivity remains a separate follow-up. Report the current state and migration gaps first; do not repeat completed work or reset lamps.
