# Edison lamp: design and factory calibration

Edison is the rounded bulb loop with two smaller coils below it. It is a
separate physical design, taller and wider than the standard Helix.

| Field | Value |
| --- | --- |
| Physical style | `edison`, code **4**, family `edison` |
| Initial model preset | `edison` |
| Factory model ID | `edison-v1` |
| Display name | CoolLamp Edison |
| LED count | **222** |
| Midpoint | **81** |
| Split lengths | 81 and 141 LEDs |

The midpoint is the existing one-based boundary after LED 81. It was located
by moving a flashing marker to the top of the large loop, where rising effects
should meet. It is deliberately different from the arithmetic half, 111. LED
count was separately measured by advancing the endpoint marker beyond the strip
and returning to its last visible pixel. The owner confirmed both positions.

These are manufacturing defaults for this measured construction, not a reason
to replace an individual lamp's validated calibration. Style/name/artwork changes,
normal updates and appearance changes never apply a model preset automatically.
Other physical builds may need different calibration.

## Measured LED regions

The owner positioned the USB fixture's white marker at each physical boundary
on 24 October 2026. Positions below are **one-based, inclusive**, following the
strip's data order from GPIO0. These measurements describe this 222-LED
construction; they are not inferred from the Edison style or artwork.

| Region | First LED | Last LED | LEDs |
| --- | ---: | ---: | ---: |
| Straight upright stem, starting at its bottom | 1 | 37 | 37 |
| Large rounded bulb loop | 38 | 124 | 87 |
| Short connection from the loop to the coils | 125 | 127 | 3 |
| Coils, ending at the strip's last LED | 128 | 222 | 95 |

The top of the large loop is LED **81**. That is a physical anchor; the existing
saved midpoint value 81 still means the boundary **after** LED 81. The two loop
sides therefore contain 44 LEDs (38–81) and 43 LEDs (82–124). Do not substitute
the arithmetic midpoint of the entire strip.

These regions are sufficient to design a loop-only Orbit and separate coil,
stem and bulb phases for Eureka, Induction and sound-driven effects. Individual
coil-turn boundaries and a physical clockwise direction have not been measured;
effects must not assume them.

Section markers were temporary previews. Count 222 and midpoint 81 remained
unchanged in NVS. The region map is design evidence, not a new wire/NVS format,
and is not applied automatically to other lamps or during updates. Region-aware
effects will need an explicitly matching measured construction; a different
count, calibration or unknown model must not silently stretch this map.

## Edison effects

The five new standalone effects append IDs **48–52**; existing IDs, names and
ordering 1–47 are unchanged.

| ID | Effect | Behavior |
| --- | --- | --- |
| 48 | Filament | A warm amber bulb with a quiet thermal breath and dimmer coils. |
| 49 | Eureka | Energy climbs through the coils and stem, blooms into the bulb, then settles and fades. |
| 50 | Orbit | Two soft trails travel around the bulb in opposite strip directions; the coils stay subdued. |
| 51 | Induction | A coil pulse releases a wave that rises around both sides of the bulb. |
| 52 | Sound Filament | Bass lights the coils; middle and high frequencies brighten the bulb. |

Admission requires the readable factory model `edison-v1`, physical style
`edison`, count **222**, midpoint **81**, and independent operation (group role
0). These checks run before mutations and in the renderer. Changing a name,
artwork, microphone flag or user-selectable style cannot enable the effects on
another construction. Unknown future models and mismatched calibration do not
inherit this map. The code never modifies count or midpoint to make it fit.

Sound Filament additionally requires installed, enabled microphone hardware.
The other four effects do not require audio capture. Live samples are reduced
to existing local level/band features; no audio recording or network upload is
added. All five use the normal power, brightness, intensity, current limiting
and per-effect appearance paths. Speed changes the four timed animations;
Sound Filament exposes intensity and color without a motion-speed control.
Custom primary/secondary colors and the secondary-color toggle affect the
renderers. No new frame buffers, rendering task, blocking waits or NVS writes
are introduced in rendering.

These effects are currently **standalone**, not Mirror/group scene formats.
Groups retain their existing catalog and scenes. Starting group membership
while an appended effect is selected is rejected before saving membership;
select an existing effect first. This avoids sending a region-specific mode
to an older or differently shaped follower without compatibility negotiation.

### Catalog and persistence compatibility

Catalog v1 remains a dense table: entry ID is its one-based slot, and its size
is the maximum wire ID. Non-Edison lamps still return exactly their 38/47-slot
catalogs. A matching independent Edison returns 51 slots without a microphone,
or 52 with one. Reserved audio slots 39–47 remain in place when audio is absent;
optional Boolean `available:false` hides them in the updated app and firmware
rejects their selection. Slots are never renumbered. A disabled microphone also
makes Sound Filament unavailable. For example:

```json
{"id":48,"name":"Filament","category":"calm","speed":true,"available":true,"startupSupported":false}
```

The app validates both optional flags, retains dense transport slots and filters
only selectable views. Older clients can keep reading the dense catalog; an
unsupported mutation receives a rejection. Schema v2 supplies stable
`effect.edison-*` keys, audio dependency, applicable controls, warm palette
defaults and the explicit `edison` style requirement. Catalog/state reads only
inspect cached runtime state.

The existing 153-byte colors, 229-byte options and 91-byte audio records retain
their layouts. New effects use the existing 24-byte per-effect `look48`–`look52`
records, including first-save, failure and reply-loss reconciliation. Appearance
saves do not alter startup, Wi-Fi, calibration or manufacturing metadata. The
volatile command-ledger snapshot expands from 512 to 576 bytes to observe all
52 slots; receipt count, lifetime, wire format and boot fencing are unchanged.

**Startup limitation for this test image:** effects 48–52 cannot be saved as
the power-on effect. They advertise `startupSupported:false`; the app omits them
from the startup selector, and both defaults/config saves reject them before
writing. Writing a value above 47 directly into the old settings record would
make older firmware reject the entire record, including network settings. A
future startup extension needs its own versioned transaction; this test does
not silently change the old record. Normal playback and appearance saving work.

### USB trial controls

The normal firmware accepts these local, non-persistent selectors while no
updater owns the lamp: uppercase **E** Filament, **F** Eureka, **G** Orbit,
**H** Induction, **I** Sound Filament. They call the same admission/control path
as the app. The ordinary knob also reaches the appended effects after Rainbow
Embers. Existing button gestures and effect order are preserved.

```powershell
. ./tools/windows-env.ps1
python tools/audio-usb.py COM12 E --seconds 1
python tools/audio-usb.py COM12 r --seconds 4
```

These are single-character commands for normal CoolLamp firmware. The separate
calibration fixture has its own role-verified command grammar.

## Implementation and compatibility

- Firmware appends Edison to the existing typed style enum without renumbering
  codes 0–3. HTTP/BLE style reads and the factory descriptor retain their existing
  versions and storage layouts. Reset recovery accepts/preserves code 4.
- The app's design list, selectors, descriptor/catalog parsing, cards, update
  artwork and bridge map know Edison. Factory-locked lamps keep a read-only
  design. Existing effect IDs/order and style compatibility remain unchanged.
- Artwork is a dedicated bulb-and-coil silhouette, with its own size and support
  for theme/progress rendering. Sources/preview assets are
  [lamp-edison.svg](design/assets/lamp-edison.svg) and
  [lamp-edison.png](design/assets/lamp-edison.png).
- The 217-byte factory V2 record already permits future model/style strings.
  Edison needs no record-layout migration. Old firmware/clients may show generic
  artwork/classification; upgrading software does not require erasing identity
  or hardware calibration.

The new effect exclusions come from the measured construction and explicit
capabilities. The lamp's actual catalog and parameter capabilities remain
authoritative.

## Explicit initial provisioning defaults

`tools/lamp-model-presets.json` is the measured preset registry. The bounded
loader validates the same public factory fields as the existing factory-service
writer, plus LED count 1–1024 and midpoint 0–count−1. Unknown presets, malformed
fields and unmeasured values fail explicitly.

```powershell
. ./tools/windows-env.ps1
python tools/lamp-model-presets.py edison --record .build/edison-factory.json
```

This exports the factory identity; it does not change a connected lamp. On a
verified new board running the USB hardware fixture, initialize the model's
hardware defaults explicitly:

```powershell
python tools/apply-lamp-preset-usb.py --port COM_PORT --device-id CANONICAL_ID --preset edison --journal .build/edison-new-board-intent.json
```

The tool first passively verifies the bench role, physical identity, boot,
midpoint support and genuinely missing count/center calibration. Existing
calibration is refused, including a calibration already equal to the defaults.
It writes count first and requires a durable receipt before writing midpoint.
Each write has an exclusive fsynced intent and separate receipt, sharing the
original target/boot fence. Interrupted/uncertain commands are never replayed;
inspect the original journals and current stored values before proceeding.
Count and midpoint are separate records, so a partial result is reported honestly.

The identity file is then written with the existing USB-only
[factory design service](factory-design-v2.md), preserving the hardware settings.
Restore an approved Edison-aware normal image after factory service. The service
and calibration images must never be published as lamp OTA artifacts.

This measured lamp was calibrated manually before the preset existed. The
preset tool was subsequently checked against it and refused to overwrite its
confirmed 222/81 values without sending a mutation or creating an intent.

## New-board bench, 24 October 2026

Target: `a02c4e8dbd44` (physical MAC `44:bd:8d:4e:2c:a0`), COM12, ESP32-C3
revision v0.4, 4 MiB XMC flash. The original partition table was blank.

The USB fixture adds `center N` and an independent `save-center` command, while
retaining the original endpoint modes. Midpoint preview uses amber/blue sides
and a flashing white marker. Turning or pressing the knob never saves NVS by
itself. Bounds, parser deadlines, one-use boot fencing and honest storage
failure outcomes are shared with the existing hardware test.

The calibration fixture image was **480,144 bytes**, SHA-256
`a6687c276d23e7bf8ab8abe7d56dbef664befc128bda89ba5a3852f8064af94a`.
Build sections occupy 480,002 bytes; static RAM is 24,944 bytes, leaving 302,736
bytes by the linker. During manual endpoint/center adjustment the fixture
reported a maximum frame gap of 36 ms and about 267,100 bytes free heap. This is a
simple USB-only fixture measurement, not the resource budget of the full lamp
firmware or proof of RF/phone performance.

Count 222 and midpoint 81 were explicitly saved with exact readback. Factory
Edison identity was written with a target/session-bound one-use service command
and the complete record was read back. Per-step logs, binaries, provenance and
intent/receipt pairs are in the ignored `.build/edison-usb-20261024/` directory.
No owner, network, group or phone bond was added during this procedure.

The calibration fixture remained installed through the region measurements and
microphone check. The subsequent effect trial below replaced it with the normal
application. No owner, Wi-Fi or group setup was performed.

Before adding the effects, the full Edison-aware application passed the pinned
`node tools/build-firmware.cjs --public --test-image` build: 2,027,048 bytes of
application sections and 89,196 static global bytes. Actual binary size, digest,
OTA-slot margin and staged source hashes are recorded in the bench directory's
`full-firmware-build.json`. This full application was built, not flashed or
published; dynamic heap/stack and phone/radio acceptance are not established by
the linker report.

## Effect trial installed, 24 October 2026

The pinned public **test-image** build now includes all five Edison effects.
It reports firmware **1.15.6**; this is a local test artifact, not the unchanged
public 1.15.6 OTA release. Application-only USB flashing at `0x10000` completed
with esptool's data-hash verification. The installed partition table matched
the existing dual-slot layout exactly; partitions, OTA metadata and NVS were
not overwritten. Count 222, midpoint 81, locked factory Edison identity and
independent membership were confirmed after boot. The installed microphone was
declared through the existing factory hardware record and verified with live
capture before and after flashing.

| Resource | Measured result |
| --- | ---: |
| Application sections | 2,031,406 bytes |
| Actual application binary | 2,031,552 bytes |
| Existing OTA slot | 2,031,616 bytes |
| Binary margin | **64 bytes** |
| Static global RAM | 89,324 bytes |
| Linker arithmetic remaining RAM | 238,356 bytes |
| Free heap during the timed effects | 45,372 bytes |
| Free heap during Sound Filament | 38,904 bytes |
| Minimum heap over the complete check | 33,724 bytes |
| Minimum free loop stack | 2,600 bytes |
| Free audio-worker stack | 1,384 bytes |
| Maximum observed animation frame gap, including audio transitions | **27,630 microseconds** |

Installed artifact SHA-256:
`659d857bb68d68176f428b67a14fb02243dcad4337e70ea30515e51f21403a44`.
The first two candidate builds exceeded the slot; only the final fitting binary
was flashed. The new renderer and rotation selection were compacted while
preserving the old effects and every existing update path. The remaining flash
margin is extremely small: further firmware changes require fresh size checks
and likely additional space work before a release. No partition migration or
feature removal was used to make this test fit.

The physical USB check selected IDs 48–52 through the production control path,
held each while frames advanced, and verified identity, geometry, power, mode
and updater status. Microphone capture was valid with signal detected, 549
blocks captured and zero reported errors/overruns. The existing postboot health
gate reported healthy. Filament was left playing; startup remains Fire. These
observations establish execution and capture on this board, not visual approval
or native phone, RF range, update or thermal acceptance.

Production-core/adapter tests cover region bounds, unknown models and layouts,
palette controls, progression, rollover, audio normalization, capability rejection,
rotation and appearance-save interruptions. Existing host checks passed for
effects/odd geometry/knob behavior, receipts and schema, HTTP/BLE authentication,
factory reset, microphone health, hidden update rendering, bounded USB and
ESP-NOW/group behavior. The mobile suite passed **1,903 tests** and its production
build; mobile changes have not been released to TestFlight or Android.

Edison's measured catalog is 4,241 bytes (52 slots); current state is 5,908 bytes
and the conservative maximum-model/group fixture is 7,250 bytes, within the
8,192-byte response limit. A worst-case full legacy settings reply that exceeds
the bound returns an explicit 503; the current-state path preserves all slots
with inactive appearance entries represented as null. Old non-Edison reply
bounds and catalogs are unchanged.

Exact binaries, staged source hashes, tests, settings snapshot, flash log and
runtime samples are in ignored `.build/edison-usb-20261024/`, with supplementary
host evidence in `.build/edison-effects/` and `.build/edison-mobile-style/`.
The owner subsequently confirmed on 24 October 2026 that **all five effects
look good and Sound Filament responds to sound**, after trying them with the
physical knob. Visual appearance, knob selection and sound response therefore
passed this single-lamp trial. This does not establish native phone integration,
RF/update performance or sustained thermal acceptance.

Nothing was published to OTA, GitHub or an app store. The new effects remain
standalone and unavailable as startup effects in this test image.
