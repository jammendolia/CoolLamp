# Bluetooth app prototype

## Implemented

- Shared control functions for the knob, HTTP and Bluetooth.
- A bundled web interface in native Capacitor Android and iOS projects.
- Bluetooth discovery, encrypted bonding without a code, saved-device reconnect,
  power, brightness, 28 effects, state notifications and saved startup defaults.
- Six-second knob hold opens a two-minute pairing window. The entire strip flashes
  blue (400 ms on, 400 ms off), even if the light was off. Pairing success or timeout
  restores the normal light state. Another six-second hold cancels pairing.
- A hold released between three and six seconds toggles the existing hotspot and
  teal pulse. Waiting until release prevents a six-second hold from toggling Wi-Fi.
- Short press still toggles power. Long holds never also toggle power.
- Existing Wi-Fi configuration, scanning and manual firmware upload remain available.

A phone may show an OS pairing confirmation, but no lamp code is required.
During the physical pairing window, any nearby phone can enroll. Encryption uses
Bluetooth Just Works bonding without passkey/MITM authentication, as requested.
Control requires Bluetooth range; it does not provide remote internet access.

## First connection

1. Install the native app and enable Bluetooth.
2. Hold the knob for six seconds until the whole lamp flashes blue.
3. Tap **Find a lamp flashing blue**, select the lamp, and accept an OS pairing
   prompt if one appears. No Wi-Fi connection or settings page is required.
4. Use **Reconnect to my lamp** on later visits. The app stores only its device ID
   and name; Bluetooth keys are managed by the phone OS and the ESP32 bond store.

One phone can control the lamp at a time in this prototype. Opening pairing
disconnects the current phone to make room for a new one. The installed ESP32 core
has capacity for three stored bonds. To clear them, open pairing with six seconds,
then use **Forget all paired phones** on the authenticated web settings page.
Forget the lamp in the phone's Bluetooth settings before re-pairing after a reset.

Outside pairing, advertising omits the service UUID and name so the app's filtered
discovery does not list the lamp. Saved phones connect by remembered OS device ID;
the firmware rejects unknown phones outside the pairing window. Unpaired lamps
do not advertise outside pairing. Advertising remains radio-visible when saved
phones need to reconnect; this is not RF invisibility.

## Firmware

Requires Arduino ESP32 core 3.3.11 and its bundled NimBLE backend. Bluetooth is
enabled by default (COOL_LAMP_BLE=1). COOL_LAMP_BLE=0 builds the Wi-Fi-only variant.
No separate BLE library is required.

The Bluetooth build passes with the core's no_fs partition scheme:
two 2,031,616-byte OTA slots instead of the old 1,310,720-byte slots. A changed
partition layout must be installed over USB first, never through the existing
application's OTA page. The no_fs layout preserves the existing NVS address and
size; verify saved settings after migration. It removes an unused filesystem
allocation. Later application updates can use the existing Wi-Fi upload page.

Build:
```sh
node tools/build-firmware.cjs
```

The helper compiles an isolated copy of the firmware sources so Arduino does not
scan the mobile dependencies. Set ARDUINO_CLI if the compiler is installed elsewhere.
Use node tools/build-firmware.cjs --wifi-only for the smaller recovery variant.

### Verified on 2026-09-15

- ESP32-C3 compile passed: 1,502,898 bytes of program storage in a 2,031,616-byte slot.
  It exceeds the old 1,310,720-byte slot, so the first installation requires USB.
- Static RAM: 52,084 bytes, leaving 275,596 bytes before runtime allocations.
  This is a compiler report, not a measurement of free heap with Bluetooth running.
- App web build and synchronization into both native projects passed.
- All eight app transport tests and both existing local regression scripts passed.
- Headless Edge check at 390 px passed: no overflow or JavaScript errors, 28 effects,
  disabled disconnected controls, and readable six-second pairing instructions.
- USB installation completed on CoolLamp-50B9AC (ESP32-C3, 4 MB flash, COM3).
  Bootloader, partition table, boot metadata and application hashes verified.
- Readback confirmed the new partition table and byte-for-byte preservation of the
  saved CoolLamp configuration: 134 LEDs, 500 mA limit, brightness 100, Fire startup.
  Radio calibration/Bluetooth storage added runtime data outside that configuration.
- USB diagnostics responded after restart at more than 72 seconds uptime, with
  about 74 KB free heap. No pairing or physical gesture test was performed.
- Native APK/iOS compilation, installation, phone Bluetooth behavior and physical
  blue-flash timing remain unverified.

## Version 1 protocol

Service: 7b610001-6e2b-4f3d-9a71-28e45c001001

Command: 7b610002-6e2b-4f3d-9a71-28e45c001001 (encrypted write).
Exactly four bytes: [version=1, requestId=1..255, operation, value].

| Operation | Value | Behavior |
| --- | --- | --- |
| 1 | 0 or 1 | Power off/on |
| 2 | 1–255 | Brightness, preserving power |
| 3 | 1–28 | Effect, preserving power |
| 4 | 0 | Save current effect and brightness as startup defaults |
| 5 | 0 | Refresh state |

State: 7b610003-6e2b-4f3d-9a71-28e45c001001 (encrypted read and notifications).
Twelve bytes: [version, requestId, result, effect, brightness, power, effectCount,
capabilities, revision0, revision1, revision2, revision3]. Revision is unsigned
32-bit little-endian. Capability bit 0 means save-defaults support. Request ID 0
denotes an unsolicited knob/HTTP state change.

Results: 0 success, 1 protocol error, 2 invalid command/value, 3 update in progress,
4 save failure. Invalid-length frames or queue overflow disconnect the client.
Every command fits the minimum BLE MTU. The app serializes writes and waits for an
application-level acknowledgment; it disconnects on uncertainty rather than
replaying changes. Queued work from an old connection generation is discarded.
Only the main loop modifies LEDs or saved settings; callbacks enqueue commands.

## Remaining work and live verification

- Test actual iPhone/Android pairing and reconnection, including rotating phone
  addresses, lamp reboot, out-of-range recovery and the three-bond limit.
- Test six-second blue flashing, three-second Wi-Fi release, short-press behavior,
  timeout/cancellation, and restoring power/effect after pairing.
- Verify animations, hotspot scans and OTA with both radios active.
- Add Bluetooth strip configuration and Wi-Fi provisioning; those functions remain
  on the existing web page in this prototype.
- Share more UI with the embedded page, support multiple named lamps, refine
  continuous slider updates, and sign/package distributable apps.

The first prototype sends brightness on slider release. Saving startup brightness
and effect does not restart the lamp; full web configuration retains its existing
save-and-restart behavior. Build and mock tests do not prove radio behavior.
