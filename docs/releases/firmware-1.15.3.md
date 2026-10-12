# CoolLamp firmware 1.15.3

This release adds smaller negotiated Settings reads and a compact, revision-fenced
light-control path. It preserves legacy catalogs, complete legacy settings reads,
effect IDs, ownership, geometry, groups, startup state and the existing update
transports. No bootloader or partition migration is included.

The hidden update renderer now combines subdued changing colors over the whole
lamp with a brighter, steady fill for confirmed written progress. Route colors
remain blue for phone Bluetooth, green for Internet, amber for trusted donation
and purple for computer/browser upload. It is receiver-only, appears only while
updating, respects the lamp's on-at-start state and never enters the effect list.
The running firmware renders an update, so this refinement is visible on a
subsequent update started from 1.15.3.

## Contracts and client integration

- `current-state-v1` adds authenticated HTTP `/api/state/current` and protected
  BLE State endpoint 1 Read with exact `view=current`. `stateView:1` retains
  configuration and catalog positions; inactive appearance entries are explicitly
  unknown. Clients validate the marker, canonical target and active tuples.
- RAM-only StatePatch has a measured compact admission budget and a bounded
  execution receipt. Durable and legacy mutations retain their existing admission
  policy. Unpaused followers cannot enter this lane to implicitly save a pause.
- Large successful read-only JSON replies have an eight-second total send budget
  from acceptance. Parsing, queued requests, small/error replies and mutations
  retain five seconds. Packet flights and per-loop work remain unchanged.
- The browser loads Settings and firmware status sequentially. It cannot save
  invented defaults for unknown inactive appearance; Preview obtains actual tuning.
- TestFlight **2.0.5 (67.1)** introduced short protected light/center reads,
  200 ms cached-ACK recovery without retransmission, live slider coalescing,
  exact pending-receipt reconciliation and verified center saves. **68.1** also
  distinguishes an executed adjustment from a failed follow-up read.

## Exact artifact and resource budget

- ESP32-C3 public application: **2,031,568 bytes**.
  SHA-256: `20e4c1532fdc3443290b004e514d0f52e2dcd69bc207eeded7bc3fb73a8a09f0`.
- Matching 120-byte manifest SHA-256:
  `d6ae7b87368cd4f6b1a08ae7acbf602ac40af58c9ad6ff19860b79731c87249e`.
- Pinned Arduino ESP32 **3.3.11**, ESP32-C3 CDC/no_fs public build,
  FastLED **3.10.5**, ESP32RotaryEncoder **1.2.0**.
  Compiler program count: **2,031,426**; static globals: **94,348 bytes**.
  Both OTA slots remain **2,031,616 bytes**, leaving only **48 bytes**.
  Future additions require a new measured flash budget.
- All **42** final host contract commands passed against the compiled firmware
  source hashes. The HTTP fixture covers 79 scenarios plus focused comparisons:
  a 5,551-byte reply with delayed ACKs and one three-second recovery completes
  at 5,819 ms; the former budget cut it at 5,005 ms after 3,840 bytes.
- The client source exports passed **1,607** tests for 67.1 and **1,610** for 68.1,
  production builds and their signed iPhone workflows. Apple reported both exact
  builds VALID and available for internal TestFlight testing.

## Physical evidence and open gates

On CoolLamp 2 (`f0b950b2f180`), the preliminary 1.15.3 image with TestFlight 67.1
opened Settings promptly while the animation kept moving, as reported by the user.
A same-value brightness command over authenticated direct Wi-Fi received its exact
execution receipt in **196 ms**, with no persistence request or state change.
This is not a measured visible slider/effect response time for Pink Corkscrew.

The final application-only USB install reused the existing backup, independently
verified the target checksum and preserved the entire preboot NVS/bootloader/
partition/OTA-selection prefix byte-for-byte. The running image subsequently
reported the exact SHA-256 above and a healthy boot.

On this exact final image, the user opened Settings over Bluetooth after a few
seconds and closed the app again. Device animation-show windows during native
Settings/read tests had a measured maximum of **38.510 ms**, with no increase in
the existing overrun counter. The user did not separately report a visual
animation observation for this final opening; the earlier opening had both.

One actual authenticated browser-page reinstall then selected a new boot and
reported **“Your lamp is updated to 1.15.3.”** The installed version, size,
SHA-256, healthy boot and inactive receiver were confirmed. A failed follow-up
settings read was reconciled with reads only; no second upload occurred. The
captured identity/name, hardware, startup, dedicated audio palettes/tuning,
automatic-update and group/order hash was unchanged. Inactive per-effect tuples
are omitted by this projection; their preservation remains backed by unchanged
storage handlers and regression tests, rather than this subset hash alone.
The actual installed page bytes match the compiled source, with no injected
functions, HTML interception or disabled browser security in this successful test.

Steady-state animation windows around that update/restart measured at most
**36.975 ms**, excluding update-cue frames and the first three windows of each
boot. A **690.770 ms** startup gap is separately retained; it is not hidden in
the steady-state figure. Non-animation frame increments during the admitted
transfer corroborate the update renderer running at its ten-Hz cadence. Optical
color/contrast confirmation remains pending; counters do not prove appearance.
Observed transient free-heap/largest-block minima were **1,080/420 bytes** during
the native/concurrent-read sample and **1,176/628 bytes** around the reinstall.
These are material limits, not a sustained resource acceptance pass.

Earlier fixture attempts did not install their candidates. Their failure and
original-image reconciliation records remain retained. The successful final
operation is independently identified by its exact image and distinct boot IDs.

Pink Corkscrew's exact 5–10 second delay, brightness behavior and reported lost
center save still require native timing/readback tests on that lamp. Existing
current limiting can flatten high-brightness output. Runtime frame windows,
startup gaps and resource minima must be reported separately; boot/build success
does not prove sustained heap, RF, optical, power or thermal margins.

The standard image retains the existing OTA-1 SHA-256/HTTPS/fleet trust policy.
**Production publisher-signature roots are not provisioned.** Trusted firmware
donation remains its separate authenticated service; generic control mesh does
not carry arbitrary uploads. Production trust provisioning, twenty-lamp RF,
Android/native interoperability, actual bootloader rollback and native background
phone transfer remain separate unfinished gates. This is not a store-readiness claim.
