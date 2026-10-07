# Room audio group effects — 2026-10-07

## New development follow-up — corkscrew and helix scenes

Six additional group scenes 27–32 are implemented in an unpublished firmware
1.9.6 candidate: two ambient and four audio driven. The actual-renderer preview
now compares corkscrew, helix and mixed rooms across 2/3/5/9 lamps, retaining
the earlier 19–26 scenes. All 166 mobile tests, the ESP32 build, new renderer
sweep and mocked UI checks pass. No lamp was changed or release published.
Public firmware remains 1.9.5; TestFlight 30.1 is the latest accepted upload,
containing direct group discovery/join. Its earlier 29.1 checkpoint below is
history. See [the new scenes and validation](corkscrew-effects.md).

## Latest device and app follow-up — 2026-10-07

App **1.0 (29.1)** is now the latest accepted upload, source
`d8620a428406bdd4a9a8cb3fcd0188135b43bc70`. Existing macOS CI run `37692263376`
passed 134/134 tests, native Swift accessory/address checks, web build and signed
archive/export/upload. Apple reported `UPLOAD SUCCEEDED with no errors` on
2026-10-07 at 16:56:54 CDT (`.build/ios-testflight-29.1-ci.log`). Tester
availability/phone installation remain unverified. App 28.1's firmware-card
upload is retained as history; the current app includes asynchronous per-card
status reads and explicitly triggered sequential **Update all**.

CoolLamp 2 now runs the exact published 1.9.5 CI image after verified COM5 USB
bootstrap; its stable new boot reports sceneCount 26 and valid chip temperature.
Its fresh secure manifest check passed, while its preceding 1.9.4 automatic
download timed out at 47%. These establish USB installation and a successful
check, not full secure OTA acceptance. Raw logical NVS, saved/runtime settings,
GPIO assignments, partition table and OTA metadata were preserved. CoolLamp 1's
COM3 bootstrap also completed: its verified selected app1 at `0x200000` now has
the exact published CI 1.9.5 image, with ROM hash verification and unchanged
logical NVS, partition table, OTA selector and saved/runtime settings. Its
95-second capture was healthy and its scheduled secure check passed with
HTTP 200/TLS error 0/transport 0. All three lamps now report 1.9.5, power on,
mode 46, brightness 55 and group scene 0. CoolLamp 1 and CoolLamp 2 run the
exact published CI image; BACL retains its validated Windows 1.9.5 build.
Firmware prerequisites for scenes 19–26 are satisfied. Physical multi-lamp/
music acceptance remains pending, and full secure OTA installation is still
unvalidated. CoolLamp 1 can return to normal power.

Earlier app **1.0 (28.1)** introduced per-device firmware cards: connected installed versions,
disconnected **Last seen**, and unknown **Connect to view**, without extra
hardware polling. Four mobile files changed; 104/104 tests, production web build
and mock browser check passed. Commit
`a3499e89a69fcb7bbb56b6a9f3fdae4f21761821` completed existing macOS CI run
`37688466205`, and Apple accepted the upload. Tester availability is unverified.
App 27.1's earlier accepted upload included the eight-scene catalog. Firmware
source `7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f` and published assets remain
immutable; the new app did not replace firmware 1.9.5. Only personal jammendolia
was used. See [the current hardware evidence](group-network-debugging.md).
The newly requested asynchronous per-card status refresh and explicit **Update
all** are implemented in source `d8620a428406bdd4a9a8cb3fcd0188135b43bc70`, pushed
to the existing codex branch. Local 134/134 tests, production build and mocked
UI checks passed: a blocked/deferred ping leaves other cards and Light/Settings/
other-lamp controls usable. Update all is explicitly triggered and sequential,
with per-lamp progress/errors and separate offline/missing-password failures;
it does not change selection, disconnection or automatic-update preferences.
Installed/latest and timestamp ordering guards preserve current card results.
Page-open/background status requests are read-only. A live GET-only module test
verified all three IDs and installed/latest 1.9.5; installation behavior used
mocks (`.build/firmware-fleet-live-refresh.json`). This is not full OTA proof.
Existing macOS CI run `37692263376` and Apple's upload succeeded for **1.0 (29.1)**;
134/134 CI tests and native Swift checks passed. The current accepted app contains
the background/page read-only refresh and explicit sequential Update all.
Bulk installation remains mock-validated and live fleet checks were GET-only.
Full secure OTA installation, physical new-scene/music acceptance and the separate
blackout/thermal and IoT-to-IoT investigations remain open.

Eight new scenes extend the group catalog from 18 to 26. The design is a room
full of active lamps: audio accents move and change roles over a persistent
colored field, rather than handing one bright object between otherwise dark
lamps. Existing IDs 0–18 and their rendering remain unchanged.

| ID | Scene | Room behavior |
| --- | --- | --- |
| 19 | Bass cathedral | Bass raises broad columns on every lamp; staggered ridges make the room feel taller. |
| 20 | Spectrum loom | Bass, mids and treble weave overlapping ribbons in different phases around the room. |
| 21 | Resonant rings | Shared beats expand into luminous rings with a different local phase on each lamp. |
| 22 | Velvet thunder | Smooth bass pressure fills the room while treble adds fine shimmering texture. |
| 23 | Prism chorus | Beats rotate palette harmonies; each lamp carries a related color rather than switching off. |
| 24 | Twin vortex | Counter-rotating helices twist through every lamp, with music controlling their prominence. |
| 25 | Electric bloom | Shared beats open distinct blooms across every lamp at once. |
| 26 | Room groove | Complementary bass/mid/treble roles share a room-wide rhythmic bed. |

All eight require a microphone on the coordinator. Followers do not need their
own microphones: they render the same forwarded level, frequency features and
shared beat clock. This is one coordinator microphone, not stereo separation
or independent sound localization. Existing gain/gate/scale and palette controls
continue to apply.

Every new scene retains ambient movement through silence or an audio dropout.
Stale frequency/beat data cannot produce new accents when input is invalid.
The presence floor respects the selected palette, intensity, lamp brightness,
power state and existing current limiter. Explicit intensity zero, black
palettes, power off and future scheduled starts remain dark. Very low brightness
or intensity can quantize small pixel values; physical brightness is not
guaranteed by the simulation.

## Compatibility and preservation

The group wire layout stays version 2: Visual 83 bytes, Packet 226 bytes. No new
transport, per-pixel stream, raw audio, allocation or persistent settings schema
was introduced. GPIOs, LED geometry, microphone configuration, group keys/order,
Wi-Fi settings and current limits are unchanged.

Update **every lamp** to the new firmware before using IDs 19–26; older followers
reject unsupported IDs. The app filters choices by the selected coordinator's
advertised sceneCount and disables required-audio choices without its microphone.
The updated catalog is included in app **1.0 (27.1)**. The existing macOS CI
workflow succeeded in run `37682084000`, and Apple accepted the upload;
tester availability and user installation have not been independently verified.
Build 1.0 (26.1) is the previous upload. Future iOS builds continue through this
macOS workflow.

## Validation and preview

- New renderer sweep: 49,335,552 physical LED samples across 2/3/5/9 lamp groups,
  every position, eight geometries including 205/102 and 134/0, speeds 1/60/100,
  and quiet, bass, treble, beat, dropout, weak and extreme input. All sampled
  LEDs stayed nonblack at normal palette/intensity 85/brightness 55; minimum
  lamp peak was 5/255 after brightness scaling.
- Distinct scene signatures and audio responses, determinism, silence/stale
  data gating, future/expired beats, intensity/black-palette bounds and time
  rollover passed.
- Existing 18-scene renderer, protocol and real sync-service tests passed,
  including new scene persistence and microphone gating.
- Mobile suite: 99/99 passed. A pre-existing Windows timer race in one transport
  test was made deterministic with an explicit mock-read readiness event;
  production transport was unchanged. The mobile web production build passed.
- The native preview covers all 48 scene/count/input combinations with no dark
  lamp frames. Browser checks verified autoplay changes actual canvas pixels,
  pause/resume, 3/5/9-lamp selection, keyboard scrubbing and all 48 combinations
  through the real controls. Desktop/mobile screenshots were checked.
  A reproduced first-frame timing error could stop the animation loop when an
  animation timestamp preceded the playback start. Elapsed time now clamps to
  zero, and controls redraw immediately even when animation frames are delayed.
  The early-timestamp and suppressed-animation regression checks passed, as did
  the local HTTP browser check, with no script errors or external requests.

`tools/group-scene-preview.cpp` generates the self-contained developer preview
at `.build/room-effects-preview.html`, using the actual firmware renderer and
folded-strip geometry. It shows 3/5/9 lamps, 12 seconds of synthetic audio or
silence, 24 samples per lamp, and playback/scrubbing controls. Its room glow and
placement are illustrative; it does not model actual power limiting, acoustic
capture, network timing, brightness calibration or heat. It never controls a
lamp or accesses a microphone/network service.

```powershell
. ./tools/windows-env.ps1
g++ -std=c++17 -O2 -Wall -Wextra -pedantic tools/group-scene-preview.cpp -o .build/room-effects-preview-generator.exe
.build/room-effects-preview-generator.exe .build/room-effects-preview.html
```

Open the HTML in Edge or Chrome for interactive playback. You can also run
`node tools/serve-group-scene-preview.cjs` and open the printed local browser URL.
The server listens only on `127.0.0.1` and serves only the generated preview;
it does not expose the working tree or connect to any lamp. Refresh after
regenerating the HTML, and stop the server with Ctrl+C when finished. If a file
preview stays on one frame, use this browser URL.

## Published release and installed Windows candidate

The latest public [firmware 1.9.5 release](https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.9.5)
includes the earlier local power-off fix, these eight scenes, cached
chip-temperature diagnostics and the smaller TLS transmit buffer. Firmware CI
run `37682079916` passed on commit `7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f`.
Its published application is 1,828,656 bytes, SHA-256
`aabfb5bfcd314242c381b3494cbe7aca09b43f58d0de4b4d101e0e7e487d0082`.

The Windows candidate installed on BACL has the same source, but different
binary bytes: program usage 1,828,890 bytes (90%), globals 52,748 bytes,
packaged application 1,829,040 bytes, SHA-256
`13940566fe29d92c668820ebd6319f67aac7424d99ef78c7ef9f2203306709ab`.
Public-build/credential/version/board/partition packaging checks passed and the
production map contains no temporary network/TLS probe hooks. Same-version OTA
does not offer the published 1.9.5 binary to BACL already reporting 1.9.5.

The prior power-fix-only candidate and matching manifest are preserved in
`.build/firmware-before-room-effects/`; the previously USB-tested candidate is
also retained in its earlier recovery folder. The local Windows artifacts are under
`firmware/public/`; build logs include `.build/room-effects-production-build.log`
and `.build/room-effects-mobile-build.log`.
The pre-temperature eight-scene candidate and matching manifest are preserved
under `.build/firmware-before-temperature/`; the current build log is
`.build/temperature-production-build.log`.

**At the earlier publication checkpoint, BACL had been updated by USB for
temperature diagnosis and the coordinator still ran 1.9.4.** Saved lamp settings
were verified unchanged. Publication and app
upload subsequently completed using verified process-local jammendolia only;
HiFin was untouched. The coordinator's HTTPS checks failed, and its local
uploads returned empty replies; upload success and next-boot image were
unconfirmed then. The later verified coordinator bootstrap is recorded in the
latest section above. Physical
music/room acceptance, full OTA and longer blackout/thermal follow-up remain
open. Native Windows tests do not have ASan/UBSan; the successful firmware CI
retains those checks and includes the new room-renderer suite.

BACL's fresh secure published-manifest check succeeded while following:
latest 1.9.5, phase 0/error 0, HTTP stage 7/code 200/host 2, TLS error/flags 0,
transport 0. The latest observed controls on all three lamps are on, mode 46,
brightness 55, scene 0; BACL is unpaused/actively following at 61.1 C. Preserve
these controls for remaining device work. This is a successful check, not a
full OTA installation or proof that controls stayed unchanged throughout it.
