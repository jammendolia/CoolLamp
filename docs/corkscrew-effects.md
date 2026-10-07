# Corkscrew and helix group effects — 2026-10-07

Six new coordinated scenes are implemented as an **unpublished firmware 1.9.6
candidate**. Firmware 1.9.5 remains the public OTA release. App 1.0 (30.1) remains
the latest accepted TestFlight upload; the six new catalog entries are local
changes for the next app build. No lamp was flashed, joined, reconfigured or
controlled during this work.

| ID | Scene | Input | Behavior |
| --- | --- | --- | --- |
| 27 | Chromatic screw | Ambient | Layered color bands climb every lamp, tracing its curves with different phases around the room. |
| 28 | Mercury ribbon | Ambient | Two broad liquid highlights flow in opposing directions above a continuous colored field. |
| 29 | Bass turbine | Audio | Bass compresses and widens pressure bands; mids shape color and treble adds fine highlights. |
| 30 | Prism torque | Audio | Shared beats reverse a fading twist accent over a continuously flowing, complementary wash. |
| 31 | Echo coils | Audio | Beats release repeated ripples on every lamp, with staggered echoes above an ambient field. |
| 32 | Aurora braid | Audio | Bass, mids and treble breathe through separate broad curtains of color and braided highlights. |

All six keep a visible field on every member at normal nonblack palette,
intensity and brightness settings. Silence and invalid audio remove accents
without extinguishing lamps. Audio scenes use the coordinator's existing shared
features and beat clock; followers do not need microphones. Ambient scenes do
not use audio and work without a coordinator microphone. Black palettes, power
off and zero intensity/brightness retain their requested behavior. Very low
channel values can still quantize to black; this is not a physical brightness
guarantee.

## Geometry and compatibility

The new renderer uses the existing folded-strip height mapping: both strip ends
are at the base, and the configured midpoint marks the top turn. It supports
unequal lengths, so a corkscrew's straight spine and longer spiral can share the
same vertical pattern when the midpoint is calibrated. No GPIO assignments,
geometry defaults, saved settings schema, current limits, group keys/order or
wire layout changed. Existing scenes 0–26 remain exactly unchanged.

The user's photo shows a straight spine connected to a descending corkscrew.
Its exact wiring direction, total LED count and top-turn boundary have not yet
been confirmed. The preview illustrates a 3.5-turn spiral; the effects do not
assume a turn count or calculate physical azimuth. The existing configurable
midpoint should be checked on the real lamp before judging height alignment.
No midpoint was changed automatically.

Every group member needs firmware **1.9.6 or newer** for scenes 27–32. Older
followers reject unsupported scene IDs. The updated app catalog continues to
filter by the selected coordinator's advertised `sceneCount`; firmware 1.9.5
continues to offer only scenes 0–26. The new description and compatibility-error
labels both identify 1.9.6. The version-2 Visual/Packet sizes remain 83/226 bytes.

## Preview

`tools/group-scene-preview.cpp` generates `.build/room-effects-preview.html`
from the actual C++ renderer, with 64 samples per lamp. It covers all 14 newer
scenes (19–32), 2/3/5/9 lamps, synthetic audio and silence. Helix, Corkscrew and
Mixed room controls change the illustrated shapes while retaining the rendered
RGB data. New scenes appear first. Playback starts automatically and supports
pause/resume, scrubbing and immediate redraw on selection.

```powershell
. ./tools/windows-env.ps1
g++ -std=c++17 -O2 -Wall -Wextra -pedantic tools/group-scene-preview.cpp -o .build/room-effects-preview-generator.exe
.build/room-effects-preview-generator.exe .build/room-effects-preview.html
node tools/serve-group-scene-preview.cjs
```

Use the printed loopback URL in a browser and refresh after regenerating. The
server serves only the preview. It never controls hardware or accesses a
microphone. Placement, diffuser appearance, brightness, power limiting, sound
capture, network timing and heat are illustrative or unmodeled.

## Validation

- `tests/corkscrew-scenes.cpp` passed 68,673,600 physical-strip LED samples
  across every position in 2/3/5/9-lamp groups, speeds 1/60/100, eight input
  states and nine geometries including 134/32, 134/0 and 205/102. All sampled
  LEDs were lit at intensity 85/brightness 55; minimum lamp peak was 7/255.
- The independently captured legacy 0–26 signature remains
  `17481880130900799249`. Distinct motion/position/band responses, ambient
  independence, stale/future/expired beat rejection, clock rollover, palette
  bounds, one black palette endpoint and power/intensity limits passed.
- Protocol and real sync-service host tests passed scene acceptance,
  microphone gating, scene persistence, failed-write preservation and NVS/order
  isolation. The firmware release workflow now includes the new suite with
  ASan/UBSan; this candidate has not been run in CI. Native Windows runs do not
  provide sanitizer coverage.
- All 166 mobile tests and the production web build passed. Six built-app
  browser scenarios used 46 intercepted lamp requests and two explicit mocked
  scene changes (27/32). Verified microphone gating, coordinator switching,
  old-firmware filtering, selected-lamp state, fresh token/readback and 1.9.6
  labels. No actual lamp or external network requests were made.
- The preview dataset has 18,385,920 exact RGB bytes with zero black sampled
  pixels or dark lamp frames. Browser checks covered 336 effect/count/input/
  geometry combinations, changing canvas pixels, pause/resume/scrub, immediate
  redraw without animation callbacks and the earlier timestamp regression.
  Responsive desktop/mobile screenshots were visually reviewed.
- The public-compatible Windows ESP32-C3 build and four packaging tests passed.
  Program usage is 1,830,642 bytes; globals remain 52,748 bytes. The application
  is **1,830,784 bytes**, within the 2,031,616-byte OTA slot, SHA-256
  `a1db07d1de968d94a1e007938119b79ca8d085bc26f2540347079403c8a81cdd`.
  This is a local candidate, not a published or hardware-tested image.

Evidence is private/ignored under `.build/corkscrew-*.log`,
`.build/corkscrew-catalog-ui-check.json`, `.build/corkscrew-preview-ui-check.json`
and `.build/ui-check/corkscrew-catalog-*.png`. Prior Windows 1.9.5 firmware
artifacts are preserved under `.build/firmware-before-corkscrew-1.9.6/`.
Physical corkscrew/music acceptance is pending. Full secure OTA installation,
same-IoT forwarding and the earlier blackout/thermal investigation remain
separate unresolved work.
