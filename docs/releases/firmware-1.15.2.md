# CoolLamp firmware 1.15.2

This update improves progress feedback and recovery across the existing update
paths, and adds a local browser upload. It retains the ESP32-C3 application and
existing dual **2,031,616-byte OTA slots**; it does not install a new bootloader
or partition layout. Saved Wi-Fi, ownership, groups, calibration, individual
appearance and startup settings retain their existing persistence contracts.

## Changes

- The hidden update animation has gentle whole-lamp motion and a brighter steady
  fill for confirmed written progress, from the calibrated bottom toward the
  top. Its color identifies the active receiver path: **blue** for phone
  Bluetooth, **green** for Internet HTTPS, **amber** for a trusted nearby firmware
  donor, and **purple** for browser/computer upload. Unknown sources remain
  neutral. It appears only on the updating lamp, only if that lamp was on when
  updating began, and never in the effect catalog.
- Automatic-update opt-in remains persistent and defaults off on new lamps.
  Eligible receivers try Internet first, then observe authenticated donor offers
  and periodically retry safe failures. New bounded status fields distinguish
  retry, policy/resource holds and failures that need a user-started phone
  update. Quiet/defer policy, staged-group permits, storage, update ownership and
  uncertain-commit reconciliation still govern admission. This does not promise
  automatic updates when those prerequisites are unmet.
- Internet, Bluetooth and trusted-donor receivers keep ownership when a durable
  installation result is uncertain. Duplicate finish, cancellation, disconnect
  and a different route cannot repeat boot selection. An additive Bluetooth
  status flag preserves the original receipt until reboot; older clients remain
  fenced by the lamp even if they describe this rare failure incorrectly.
- The lamp's authenticated browser page accepts a matching CoolLamp application
  `.bin`, including from its setup hotspot at `http://192.168.4.1`. It pins target,
  boot session, version, chip, size and SHA-256 before bounded inactive-slot
  streaming. Complete validation precedes boot selection; lost final replies
  use read-only reconciliation. Existing authenticated `/update` remains
  compatible. A merged image or bootloader is not an application update.
- A negotiated whole-strip motion path can be selected separately from the
  physical midpoint. Returning to split motion restores the saved center;
  existing effects, IDs, odd LED counts and calibrated spatial scenes remain
  compatible.
- Microphone capture has a separate durable owner switch and explicit
  starting/healthy/stale/error status. Healthy silence does not prove that a
  microphone is absent, and missing samples do not identify a hardware fault.
  Installation, tuning and effect IDs remain separate. Finished-lamp default-on
  installation requires explicit verified manufacturing provisioning.

## Compatibility and remaining gates

App 2.0.5 (61.1) retains its existing behavior and ignores the new optional fields.
The new phone guides, microphone/layout controls and update-card presentation
are **not released with this firmware**. Browser upload is part of the lamp's
bundled page. Trusted donation remains its separate protected service; ordinary
control mesh routing does not carry arbitrary firmware uploads.
New client code also preserves explicit commit uncertainty across reload and
never reports it as unchanged. Installed 61.1 does not contain that refinement.
Protected binary Bluetooth snapshots cannot yet prove a fresh boot, exact running
digest and health; newly flagged client attempts therefore stay honestly pending.

The standard artifact retains the disclosed legacy OTA-1 SHA-256/HTTPS/fleet-trust
policy. **Production publisher-signature keys are not provisioned.** A lamp with
publisher enforcement must receive the original valid signed metadata; this
update does not bypass that requirement. Development signing fixtures are not
release assets. Production key custody, rotation and manufacturing trust remain
external prerequisites.

Flash is nearly full. Low runtime memory can still hold updates or reject durable
settings; a readable lamp is not proof that a save can be admitted. Legacy
protocol-2 groups remain held for automatic staged rollout, and automatic radio
permit distribution is incomplete. Do not infer twenty-lamp RF acceptance,
native iPhone/Android interoperability, long-run resource margins or automatic
bootloader rollback from host tests and compilation.

## Release evidence

- Standard public application: **2,029,232 bytes**, with **2,384 bytes** of
  OTA-slot headroom, SHA-256
  `a532bf18876bdeb5d9d7076fc3dcd6c7d46f464ec477ab6bb4b9d6185ef7d0f0`.
- Matching legacy-compatible 120-byte `coollamp-manifest.txt`: SHA-256
  `ee0a89715aded1e188579e445869eb50eccbd6f19eb0bb1860da357aea1e7046`.
- Pinned core 3.3.11, FastLED 3.10.5, ESP32RotaryEncoder 1.2.0 and normal public
  ESP32-C3/no_fs build; no test-image or development-trust flags. Compiler program
  size 2,029,092 bytes, static globals 94,348 bytes. Individual `.su` estimates
  and exact staged sources are retained locally; they do not measure complete
  SDK stack chains or runtime heap. The 39-command production-handler gate
  passes. Local client contracts pass 1,344 tests and the production web build;
  that client build is not a TestFlight release.
- CoolLamp 2 identity `f0b950b2f180` received this exact standard image through
  an authorized application-only flash. Independent readback matches its digest;
  bootloader, partitions, OTA metadata and the full NVS prefix were byte-exact
  before restart. A fresh 4 MiB private backup preceded each installation.
  Subsequent boot-health and authenticated running-image digest checks pass.
  Power on, effect 46, brightness 55, 134 LEDs and midpoint 0 retain their values.
- On the unchanged direct Wi-Fi route, descriptor, microphone health, compact
  firmware status, installed-artifact proof, revision and the actual gzip setup
  page all pass. The 10,951-byte compressed page loads in 1.141 seconds without
  a lamp-side page buffer. A separate 11,776-byte mapped-page budget fixed the
  physically observed page-admission timeout; generic mutation and read floors
  retain their values. Microphone capture is healthy and enabled. Automatic
  service truthfully reports the existing protocol-2 group hold, with zero
  Internet attempts; this is not proof of an automatic installation.
- A full state read can still return bounded HTTP 503 under resource pressure.
  The retained intermediate failure records are not converted into passes.
  At 154,603 ms uptime, free heap was 16,336 bytes, largest block 8,180 bytes,
  lifetime minimum 216 bytes, loop stack minimum 2,728 bytes and cleanup stack
  minimum 1,268 bytes. The last completed five-second animation window had a
  20.673 ms maximum gap and no overrun. Lifetime maximum 660.462 ms and one
  startup overrun remain separate. These are firmware timestamps, not optical
  or sustained acceptance; the 100 ms target remains unaccepted overall.
- Coordinated native Settings check: **PENDING**. An earlier reported encryption
  failure overlapped a follow-up USB backup/reset and is not an isolated
  firmware or native Bluetooth reproduction.
- OTA publication and independent public download receipts will be retained
  under `.build/firmware-1.15.2-release-page-20261011/`. Only the standard
  application and its matching manifest are release assets.

Publishing this version as GitHub Latest makes it available to existing OTA
clients and may trigger lamps that opted into automatic updates, subject to
receiver policy and compatibility. Private backups, ELF/map files, service
images and signing fixtures are not release assets.

The [update/layout integration contract](../update-paths-and-guides.md),
[microphone contract](../microphone-health.md) and
[controlled physical acceptance procedure](../experience-physical-acceptance.md)
describe the migrations, source interfaces and remaining validation steps. Hold
router settings constant while testing interrupted transfers, final-reply loss,
all four update routes, on/off admission and recovery.
