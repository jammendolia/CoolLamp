# Firmware updates through a phone

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

An already-current lamp downloads and verifies the release without flashing.
**Reinstall the current release** explicitly permits a same-version transfer
for recovery or acceptance testing. Downgrades are rejected on both ends.

Cancel or backgrounding aborts an incomplete transfer. A lost connection also
releases the receiver, with a 30-second inactivity deadline if a cancellation
message cannot arrive. A retry starts a fresh transfer; this version does not
resume across disconnects. Cancel is disabled when final verification begins.
After completion reconnect and confirm the installed version. If the final
reply is lost, the app reports uncertainty and does not automatically repeat
the commit or flash. No automatic rollback of a successfully selected but
faulty application is promised.

## Receiver invariants

- UUID `7b61000b-6e2b-4f3d-9a71-28e45c001001`: protected writes.
- UUID `7b61000c-6e2b-4f3d-9a71-28e45c001001`: protected 20-byte status.
- Version-1 frames carry a random session and a nonzero 16-bit request ID.
  Manifest chunks use a 16-bit offset; firmware chunks use a 32-bit offset.
  The app honors the negotiated MTU, writes at most four frames before reading
  an application acknowledgment, and counts bytes written by the receiver.
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

## Acceptance test still required

App 1.0 (37.1) was accepted by Apple on 2026-10-09. Firmware 1.11.0 passed
Windows and Linux CI builds and is staged as an unpublished draft; public
Latest remains 1.10.2. Local checks include 333 mobile tests, 19 receiver cases
using real pinned SHA-256, six offline radio handoff cases, five security
callback tests, and five mocked production update-panel scenarios.

Use CoolLamp 1 first, followed by CoolLamp 2. Bootstrap the candidate over
Wi-Fi, verify normal boot, saved settings, and coordination, then use the
phone's same-version reinstall option over Bluetooth with **phone Wi-Fi off**
and cellular data available. Confirm the device version and normal controls
after its restart. A subsequent test with lamp Wi-Fi unavailable is needed to
establish the complete offline path; do not change router settings as part of
this test. Also test a cancelled partial transfer and confirm the old image
remains selected and the lamp is usable. Host tests and build success are not
physical Bluetooth acceptance evidence.
