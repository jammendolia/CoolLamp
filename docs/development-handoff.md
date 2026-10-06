# CoolLamp development handoff — 2026-10-06

## Checkpoint and user intent

The user requested a safe breakpoint to reboot the Mac, then continue in a fresh chat. Stop active engineering at this checkpoint. No flash is in progress. The final production build completed successfully, exit 0; do not confuse a successful build with a published or device-tested release.

Latest steering: user wants to move routine development to Windows machine **Beefinator**, retaining the Mac for iOS builds/testing. They also have a machine with a Ryzen 7 5800, 64 GB RAM, RTX 3070 8 GB. Its OS/storage and Beefinator's specifications have not been confirmed. That machine is ample for this project; no evidence establishes it is faster than their Mac or Beefinator. GPU does not accelerate the current firmware/mobile build pipeline. No files have been transferred and no Windows setup has been performed yet.

Update: Beefinator has Intel Core Ultra 7 255H, 64 GB DDR5-5600, RTX 3050 Laptop 4 GB, and Intel Arc 140T. The user chose Beefinator, then requested committing the current work before migration. This checkpoint is being saved on **`checkpoint/windows-migration-2026-10-06`**, based on the latest app branch `release/firmware-1.9.5`. Clone that checkpoint branch on Windows. Source, docs, CAD, images and pending TLS build changes are included; build caches, private secrets, KiCad session files and generated example firmware are excluded. This is a source checkpoint, not a new firmware or TestFlight release.

Repository: `/Users/jammendolia/Dev/Gasper/CoolLamp`. Read this file and `docs/wifi-debugging.md` before continuing. Preserve the existing working tree: it contains months of accumulated changes, while local Git HEAD is old. Do not reset, clean, or broadly stage it.

## Immediate objective on resumption

Finish and validate the firmware OTA memory fix, then prepare firmware 1.9.5. Firmware 1.9.5 has NOT been published. The user previously authorized firmware publishing, USB flashing to the connected lamp, and TestFlight publishing; the latest instruction pauses work until after reboot. Continue only when the user resumes.

Secondary unresolved issue: the synchronized group has no live UDP peers, despite all three lamps being joined to the same Wi-Fi. Do not claim the OTA memory fix resolves this separate issue.

## Published state

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

## Local changes not yet published

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

## Current lamps

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

## Resume sequence

1. Inspect handoff, build helper and final log; preserve working files. Check actual connected device and current status.
2. Review helper correctness and add focused tests for pins/cache/source/ABI failure handling. Run relevant existing firmware checks. Avoid re-running unrelated UI work unnecessarily.
3. Flash the production image to the authorized USB lamp with its existing settings retained; repeat secure update checks under normal app polling, audio/render/group load. Verify no diagnostic hooks and adequate heap. Keep original release and prototype artifacts available.
4. Prepare a real version **1.9.5**, release workflow/manifest, and validate reproducible CI build. Do not overwrite the published 1.9.4 assets/tag. Publish only after necessary validation. Verify actual full OTA download/install on a lamp, then ask user to check CoolLamp 2's manual update path.
5. Resume group-network debugging separately once updater stability is established.

Local `.git` is read-only in this environment. Previous releases were made using GitHub connector `create_tree`, `create_commit`, `update_ref` with expected SHA, overlaying only intended files onto the current remote tree. Use that approach if direct Git remains unavailable. Do not push casually to `release/firmware-1.9.4`: its publish workflow may attempt the existing tag again. App build 26.1 is already uploaded; don't publish another app build merely for firmware tooling/docs changes.

## Suggested new-chat prompt

Continue CoolLamp development in /Users/jammendolia/Dev/Gasper/CoolLamp. First read docs/development-handoff.md and docs/wifi-debugging.md. Resume the OTA heap/TLS fix from the checkpoint, preserving existing GPIO assignments and lamp settings. Review the successfully built 16 KB receive / 4 KB transmit TLS implementation, complete production/device validation, then prepare firmware 1.9.5 for OTA. App 1.0 (26.1) is already uploaded to TestFlight. Firmware 1.9.5 is not published. Keep the separate group UDP connectivity issue on the follow-up list. Do not reset the working tree or repeat completed app work; report current status before continuing.

## Windows migration notes

Clone **`checkpoint/windows-migration-2026-10-06`** to obtain the saved source checkpoint, rather than the repository's older default branch. Preserve the Mac copy as backup. Full `.build` diagnostic logs and prototype binaries remain local; `.build` is ignored. The findings and relevant measured values are recorded above, and the optimized TLS library is reproducible from pinned source. Do not copy Mac `node_modules`, Darwin toolchains or compiler caches as Windows dependencies. Do not distribute private signing material/secrets in a general source archive.

Install Windows-native Git, Node 22, pnpm (CI currently pins 11.19.0), Python 3, Arduino CLI and pinned ESP32 core 3.3.11/libraries. Use a short local path such as `C:\Dev\CoolLamp`, outside OneDrive, and reinstall mobile dependencies using the pnpm lockfile. Android development additionally needs the project's compatible Android Studio/JDK/SDK. CAD can also move to Windows with KiCad/OpenSCAD installed. Native Windows is the simplest starting point for direct USB COM ports and local-network lamp diagnostics; don't add WSL USB/network forwarding unless necessary.

The firmware Node script already has a Windows CLI lookup and the new TLS helper recognizes `.exe` compiler tools. However, the new helper has only been executed on macOS: validate Windows SDK response-file paths, quoting, `tar` availability, ABI/export parsing, and archive linking before declaring it portable. Host tests/scripts may assume Unix commands; inspect and adapt those narrowly. **Confirmed portability gap:** `tools/audio-usb.py` uses POSIX `termios`, `fcntl`, and serial `select`; it does not run natively on Windows. Port this diagnostic helper to pyserial (retaining DTR and avoiding unintended resets), rather than merely replacing the device path. Temporary TLS probe helper inherits the same gap. Rediscover Windows COM ports. Do not change firmware GPIO assignments as part of migration.

Native iOS compilation and simulator/device debugging still require macOS/Xcode. TestFlight distribution currently uses the repository's GitHub Actions macOS runner, which can be triggered from Windows; a running local Mac is not inherently required for that existing CI workflow. Preserve the Mac for native iPhone/Bluetooth troubleshooting and signing workflows if needed.

Suggested Windows continuation prompt:

Continue CoolLamp development on this Windows computer. First read docs/development-handoff.md and docs/wifi-debugging.md in the transferred repository. Verify that the Mac's pending TLS build changes and diagnostic evidence were transferred before modifying anything. Set up and validate the Windows build/test tools, preserving GPIO assignments, lamp settings and the working tree. Then resume the OTA heap/TLS fix, validate the 16 KB receive / 4 KB transmit implementation on the USB lamp, and prepare firmware 1.9.5 for OTA after tests pass. App 1.0 (26.1) is already uploaded to TestFlight; use the existing macOS CI workflow for future iOS builds. Firmware 1.9.5 is not published, and group UDP connectivity remains a separate follow-up. Report the current state and migration gaps first; do not repeat completed work or reset lamps.
