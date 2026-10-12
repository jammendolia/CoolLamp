# Update progress refinement — local implementation

## 1.15.3 whole-lamp background candidate (2026-10-12)

The current candidate separates the two visual layers. A subdued whole-lamp
color wash slowly cross-fades through a small palette; stateless selection uses
only cue generation and elapsed time. It does not allocate a frame buffer or
consume the effects' shared random generator. Confirmed filled positions replace
that background with the existing brighter, steady route color: blue for phone
Bluetooth, green for Internet, amber for trusted donation and purple for browser
upload. Unknown routes remain neutral. Filled pixels never follow the background
hue or pulse. No transfer percentage is inferred from time.

The calibrated folded-strip mask, 1–1024/odd counts, 10 Hz cadence, brightness and
current caps, original-frame restoration and on-at-admission latch are retained.
A one-pixel lamp blends its background toward the route color using confirmed
written bytes; only complete data reaches the exact completed color. Invalid or
unavailable counters show background only. The effect remains receiver-only and
absent from catalogs. No wire structure or NVS record changes.

Public 1.15.2 artifacts remain immutable. Pink's transfer from 1.15.1 uses the
renderer in that running image; installing a newer renderer cannot change an
already-running transfer. This 1.15.3 refinement becomes visible on a subsequent
update started from 1.15.3. Code/build checks and an exact-image authenticated
browser reinstall are complete. Hardware show counters corroborate the hidden
renderer during that transfer; optical color/contrast confirmation and native
Bluetooth cue acceptance remain pending. Exact artifact, settings evidence and
resource limitations are recorded in `docs/releases/firmware-1.15.3.md`.
Historical milestones below describe their earlier images.

## Earlier milestones

This follows the physically observed iPhone 60.1 reinstall of the exact standard
1.15.1 release on CoolLamp 2. The user saw progress, the hidden update animation,
and **Your lamp is updated**; USB subsequently verified fresh healthy boot,
identity, inactive updater and the listed render settings/bond count. Full
Settings still failed. The user's screenshot shows the client's recognized
Bluetooth memory-refusal message; it is separate from update completion.

## Lamp renderer

`LampUpdateCue::level()` retains the existing calibrated folded-strip height.
Both physical base ends fill toward the calibrated top. Model name/style never
changes geometry. All unfilled positions breathe gently in amber, levels 12–18;
positions reached by confirmed written bytes use steady amber level 48. The
renderer retains the captured power/brightness, 40/255 brightness cap, existing
current budget, 10 Hz cadence and scratch-buffer restoration. It remains hidden
from every user catalog, local to the active receiver, and dark if power was off
at admission. No protocol, NVS, effect IDs or group frame change is required.

Zero, unavailable or invalid progress displays ambient only. A one-pixel lamp
uses a proportional brightness fallback. Spatial quantization, including the
two-base-pixel geometry, cannot display an exact percent. A full fill describes
written bytes, not a successful boot; verification/restart remain separate.

The production admission/renderer fixture passes all 1–1024 LED counts and
calibration extremes: 4,090 geometries and 33,587,040 pixel samples. It checks
steady filled RGB, animated ambient RGB, monotonic fill membership, invalid
offsets, captured off/power/brightness, cadence rollover and frame restoration.
Windows GCC has no sanitizers; supported CI platforms retain sanitizer flags.

## App integration

The existing SVG model artwork accepts only an integer `updateProgress` in
0–100. Its light body fills vertically in a fixed color; the base stays unchanged.
Cards retain the native progress bar and show the percentage below the artwork.
Only an active transferring task or a fresh, verified receiving observation can
supply a percentage. Phone download, cancellation, restart, missing values and
unresolved receipts remain neutral. The extra drawing/percentage is decorative;
the labeled native progress and task text carry the accessible meaning.

Unknown styles keep the existing generic drawing; descriptors and ownership
storage are unchanged. Ordinary non-update SVG output is byte-identical across
24 style/theme/light cases. Production rendering tests cover receiver isolation,
twenty distinct clip IDs, escaping, stage separation, Cancel/focus retention,
theme rules and reduced-motion behavior. Native screen-reader, text-size and
diffuser appearance acceptance remain pending.

Optional **Update details** now retain a bounded transfer snapshot on success
as well as failure. It records actual MTU/chunk/write mode, fallback enums,
acknowledged-byte range, bounded counters and commit acknowledgment. Data timing
uses a monotonic Begin/Resume ACK to last Data ACK interval; resumes count only
newly acknowledged bytes. Unavailable/backward clocks omit the duration. No
remaining-time estimate is generated. Optional callbacks/storage cannot alter
the safety journal, update result, ownership or retry behavior. Exported details
omit identity/attempt/session/ACK identifiers, arbitrary text and secrets.
Build 60.1 cannot retrospectively supply these measurements.

## Fresh firmware artifacts

Both builds contain the previously tested counted-read memory milestone plus
the cue refinement. All 126 current/staged source hashes match. Only
`LampUpdateCue.h` changed from that previous frozen firmware candidate. Neither
build has been published or substituted for the standard 1.15.1 OTA pin. The
donation-disabled image was subsequently flashed with explicit user approval,
as recorded below; the normal image remains unflashed.

| Local artifact | Program bytes | Static RAM | Application bytes | OTA margin | SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| Normal | 2,024,332 | 94,212 | 2,024,480 | 7,136 | `40429a0cedde75df67d92b7e8a467c6bcbd0bbedc9fb597a9fa3f094ad4a283c` |
| Donation-disabled test image | 2,023,680 | 94,204 | 2,023,824 | 7,792 | `1e7a5887cc4e55c24c020089042d7954e3f9019296757ee31c166495a31d33bf` |

Normal manifest SHA-256:
`d2253f0cbb84a51e5d344241c5c3a30a7c0678c91072c9b444dce013e08dade0`.
Test manifest SHA-256:
`bb019b450ad13a97a7333f56386bbece5461a9bb5c55b84f492308629b3d4045`.
Artifacts, ELF/map, compiler stack files, source hashes and build logs are under
`.build/update-progress-refinement-20261011/`. The test image requires explicit
test packaging and is rejected by ordinary public packaging. Partition tables
match the previous candidate; each OTA slot remains 2,031,616 bytes.

## Next controlled device milestone

The user explicitly approved this exact local test image and closed the phone
app. After confirming the updater was inactive, a fresh private full-flash backup
was taken. ROM/device identity and the current application slot were verified;
OTA sequence 11 selected `app0` at `0x10000`. The backup proves that the successful
wireless reinstall placed the exact standard 1.15.1 binary in that slot. Backup
SHA-256 is `9052eba9d210ee5ed2e70f8ec1c8781bdb2d85bc9ef51034f07be030fd11c807`.
Only `app0` was written. Independent full application readback matches the test
image digest; the entire `0x00000–0x0ffff` boot/partition/OTA/NVS prefix is byte
exact before restart. No complete postboot NVS comparison is claimed.

Read-only postboot USB verified the same identity, 1.15.1, boot health, inactive
updater, one bond, power on, mode 46, brightness 55, 134 LEDs and midpoint 0 at
68,070 ms uptime. Heap is 16,612 bytes; largest block is 8,180 bytes. The subsequent
iPhone 60.1 Gear attempt kept the animation moving but did not open Settings.
The app showed an unconfirmed Bluetooth setup message. One later authenticated,
identity-verified PC Wi-Fi GET returned the actual 6,211-byte Settings response
with all 47 effects in 0.828 seconds. This proves that route's read handler, not
the iPhone Bluetooth path or its screen. Exact records are under
`.build/usb-coollamp2-counted-cue-20261011/`.

The client now holds passive fleet/group work for the complete foreground
connection attempt, including direct-route and bounded mesh fallback. Shared
native teardown completes before replacement ownership. Exact correlated
command acknowledgments settle before screen observers; throwing or rejected
observers cannot erase confirmation or initiate replay. Callback diagnostics
contain only bounded type/consumer enums and a saturating counter, not exception
text, state, request bodies or identities. These production-client defects were
reproduced in host tests; their contribution to the observed phone failure has
not been established. A recognized authenticated Settings-memory refusal stops
unhelpful route fallback. Missing modern capabilities alone never imply an old
firmware version or an upgrade requirement.

Working-tree client validation at this checkpoint passes 1,236 tests and the
production build. The build reports its existing 500 kB chunk-size warning.
Release export validation and the next phone Settings check remain separate
gates; no new firmware is published by this client milestone.

For any subsequent authorized flash, take another fresh private backup and determine
the currently selected application slot from current OTA metadata. The
successful wireless reinstall may have changed slots: never reuse the previous
USB address blindly. Write and read back only that application slot; preserve
bootloader, partitions, OTA metadata and NVS. Record exact image digest and
pre/post observations. Keep Wi-Fi/router/channel configuration unchanged.

First test read-only protected Settings/catalog/diagnostics and memory/frame
metrics. The counted reply is a read-memory fix. **Actual mutations still have
the old 24 KiB admission floor**; opening Settings does not establish that LED
count/color/appearance saves work at the observed 16 KiB heap. Do not promise
complete settings functionality from this candidate. A separate bounded
mutation-budget milestone needs production-handler/NVS interruption testing.

The 100 ms animation-gap target is also still pending: the standard receiver's
postboot retained maximum was 662.633 ms, with no timestamped cause attribution.
Pinned mDNS maintenance can block on SDK tasks and needs separate investigation.
Check physical bottom-to-top fill and off-at-start behavior, then native
iPhone/Android accessibility, cancellation/lifetime/final-ACK loss, repeated
wireless recovery, donor eligibility and twenty-lamp RF/coexistence. Do not
reinstall standard 1.15.1 over a test image and claim the new memory/cue changes
survived: the standard artifact does not contain them.
