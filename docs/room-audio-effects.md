# Room audio group effects — 2026-10-07

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
The new catalog needs the updated app bundle; TestFlight 1.0 (26.1) remains the
previous uploaded build. Future iOS builds use the existing macOS CI workflow.
No iOS build or upload was performed for this work.

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

## Unpublished candidate

The public 1.9.5 image now includes the earlier local power-off fix and these
eight scenes and the subsequently added cached chip-temperature diagnostics.
Build program usage is 1,828,890 bytes (90%); globals are 52,748 bytes.
Packaged application size is 1,829,040 bytes, SHA-256
`13940566fe29d92c668820ebd6319f67aac7424d99ef78c7ef9f2203306709ab`.
Public-build/credential/version/board/partition packaging checks passed and the
production map contains no temporary network/TLS probe hooks. The smaller TLS
transmit buffer remains enabled.

The prior power-fix-only candidate and matching manifest are preserved in
`.build/firmware-before-room-effects/`; the previously USB-tested candidate is
also retained in its earlier recovery folder. Current artifacts are under
`firmware/public/`; build logs include `.build/room-effects-production-build.log`
and `.build/room-effects-mobile-build.log`.
The pre-temperature eight-scene candidate and matching manifest are preserved
under `.build/firmware-before-temperature/`; the current build log is
`.build/temperature-production-build.log`.

**BACL was updated by USB for temperature diagnosis; the coordinator remains
on 1.9.4.** Saved lamp settings were verified unchanged, and no GitHub operation,
app upload or publication occurred. Physical music/room acceptance, firmware CI,
full OTA and the power/enclosure/blackout comparison remain pending. Native Windows
tests do not have ASan/UBSan; the firmware-release workflow retains those checks
and now includes the new room-renderer suite.
