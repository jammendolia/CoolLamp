# Firmware updates through a phone

Public Latest is **1.13.0**, published on 2026-10-09 at 19:17:05 CDT. Its
manifest and image downloads were verified against the successful CI build.
Firmware **1.11.0 or newer** is required to receive updates over Bluetooth;
an older lamp needs one bootstrap using Wi-Fi or USB. CoolLamp 2 successfully
received and booted 1.13.0 using app **1.0 (42.1)** in about **16 minutes**.
App **1.0 (44.1)** adds screen-awake protection and notification acknowledgments.
Its signed macOS CI build and Apple upload succeeded on 2026-10-09 at
23:14:44 CDT. TestFlight tester availability and physical speed testing remain
pending; build success does not establish the real transfer time.

Firmware 1.11.0 adds an encrypted, bonded Bluetooth firmware receiver alongside
the existing Wi-Fi OTA, automatic updates, and USB recovery paths. The phone
downloads the public release using its own cellular data or Wi-Fi, verifies
the image, and sends it to the selected lamp. The lamp does not need a router
or internet connection for this transfer.

## Initial installation

A lamp running 1.10.2 or older needs **one installation of 1.11.0 or newer using
the existing Wi-Fi update path** before it can accept firmware over Bluetooth.
For lamps already stable on Wi-Fi, USB disassembly is unnecessary. Installing
the new app alone cannot add a receiver to old firmware.

## Phone controls

Connect using the lamp card's Bluetooth icon, open its gear, and choose Updates.
App 43.1 and later also offer **Connect over Bluetooth** directly on Updates.
The existing Wi-Fi controls remain available. The additional **Update through
your phone** panel downloads the Latest official release and transfers it to
that exact, protected device identity. Keep the app in the foreground, remain
near the lamp, and keep the lamp powered. Its lighting and coordination pause
during writing and restart afterward.

The phone pins the image URL to the version read from the release manifest;
an intervening change to Latest cannot silently change the selected image.
It checks the ESP32-C3 application header, partition size, and SHA-256. iOS uses
CryptoKit on a background queue; Android uses native MessageDigest on the
Capacitor worker. Downloading and transferring are asynchronous. Navigation
and unrelated lamp status remain available; changing this lamp's settings,
switching the main connection, and Update all are held until completion/cancel.
App 44.1 keeps the phone screen awake during a Bluetooth update and restores
its previous idle setting afterward. Manually locking the phone or switching
apps still interrupts an incomplete transfer and reports that specific cause.
Connection-changing card actions and delayed selection results cannot replace
the connection that owns a live Bluetooth transfer.

An already-current lamp downloads and verifies the release without flashing.
**Reinstall the current release** explicitly permits a same-version transfer
for recovery or acceptance testing. Downgrades are rejected on both ends.

Cancel or backgrounding aborts an incomplete transfer. A lost connection also
releases the receiver, with a 30-second inactivity deadline if a cancellation
message cannot arrive. A retry starts a fresh transfer; this version does not
resume across disconnects. Cancel is disabled when final verification begins.
After completion reconnect and confirm the installed version. App 44.1 replaces
the pending restart receipt with an installed receipt only after a fresh,
verified matching or newer version; cached cards and failure receipts do not
prove installation. If the final
reply is lost, the app reports uncertainty and does not automatically repeat
the commit or flash. No automatic rollback of a successfully selected but
faulty application is promised.

## Receiver invariants

- UUID `7b61000b-6e2b-4f3d-9a71-28e45c001001`: protected writes.
- UUID `7b61000c-6e2b-4f3d-9a71-28e45c001001`: protected 20-byte status read
  and notifications, already present on the 1.11.0 receiver.
- Version-1 frames carry a random session and a nonzero 16-bit request ID.
  Manifest chunks use a 16-bit offset; firmware chunks use a 32-bit offset.
  The app honors the negotiated MTU and writes at most four frames before
  requiring an application acknowledgment. App 44.1 accepts matching written
  offsets from notifications, avoiding per-window status reads. A missed or
  unsupported notification switches once to the existing polling path, without
  replaying frames. Native data writes remain sequential writes with response.
  Only the correct session, image size, issued sequence and written offset can
  advance progress; stale callbacks and status regressions are ignored.
- Bluetooth callbacks only authorize a live encrypted bonded connection and
  copy bounded frames into a fixed queue. Flash, hashing, and update ownership
  stay on the Arduino loop. Generation changes invalidate old queued frames.
- The existing updater lease excludes Wi-Fi OTA, resets, scans/setup, and
  concurrent updates. Two subsequent loop passes allow RPC/radio/UDP cleanup
  before the inactive OTA slot is written. Flash sectors are erased incrementally
  during sequential writes, avoiding a long initial bulk erase. When Wi-Fi is
  unassociated, its retry loop is held during BLE transfer and restored after
  failure/cancellation; an associated connection stays intact. No GPIO or saved lamp/group/hardware
  settings are changed by the receiver.
- The lamp checks manifest model/layout/version/size, ESP32-C3 application
  headers, the public build marker, full SHA-256, and SDK image validation.
  Boot selection changes only after complete verification. Later queued frames
  or a disconnect cannot cancel a committed restart.

## Physical validation and remaining acceptance

CoolLamp 2's successful full Bluetooth transfer and 1.13.0 boot are verified.
CoolLamp 1's next transfer stopped when the phone locked, at 23%; it remains
on 1.11.0. A subsequent bounded local LAN upload also ended early without a
reboot or saved-settings changes; that path is not a proven faster alternative.
App 44.1's Windows validation passed **479 mobile tests** and **24 production
UI cases**. Its 70 focused Bluetooth tests include a 1,920,432-byte model image,
full SHA validation, one commit, notification/polling fallback, low-MTU sequence
wrap, cancellation and stale connection/status handling. These are model tests,
not measured radio throughput. See `development-handoff.md` for evidence.

Once app 44.1 is available in TestFlight, use CoolLamp 1 first to install the
published 1.13.0 over Bluetooth, without changing its lamp Wi-Fi or router
settings. Keep the app foregrounded, verify the screen stays awake, and time
the receiving phase separately from the phone download. Confirm the device
version, normal controls, saved settings and coordination
after its restart. A subsequent test with lamp Wi-Fi unavailable is needed to
establish the complete offline path; do not change router settings as part of
this test. Also test a cancelled partial transfer and confirm the old image
remains selected and the lamp is usable. Host tests and build success are not
physical Bluetooth acceptance evidence.
