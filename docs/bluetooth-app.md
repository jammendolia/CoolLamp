# Bluetooth app prototype

## Implemented

- Shared control functions for the knob, HTTP and Bluetooth.
- A bundled web interface in native Capacitor Android and iOS projects.
- Bluetooth discovery, encrypted bonding without a code, saved-device reconnect,
  power, brightness, 29 effects, state notifications and saved startup defaults.
- Six-second knob hold opens a two-minute pairing window. The entire strip flashes
  blue (400 ms on, 400 ms off), even if the light was off. Pairing success or timeout
  restores the normal light state. Another six-second hold cancels pairing.
- At three seconds while held, the hotspot toggles. Opening it flashes orange for
  three seconds; continuing to six seconds opens Bluetooth pairing and switches
  to blue. A six-second hold now also changes hotspot state at the three-second
  threshold. Bluetooth pairing feedback takes priority over hotspot feedback.
- Single click adjusts brightness; double click adjusts Color 1. Turn to preview, then single-click or wait five idle seconds to save. Triple click turns off; single click while off turns on. Long holds cancel click counting.
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
  about 74 KB free heap.
- The owner confirmed iPhone discovery, pairing (blue flashing stopped), on/off
  commands in nRF Connect, and successful operation in the first TestFlight app.
- The first native iOS build was signed and uploaded successfully as 1.0 (1.1).
  Android native builds and the new custom-color firmware still need device testing.

## Version 1 protocol

Service: 7b610001-6e2b-4f3d-9a71-28e45c001001

Command: 7b610002-6e2b-4f3d-9a71-28e45c001001 (encrypted write).
Commands are four bytes: [version=1, requestId=1..255, operation, value],
except color operation 6, which is seven bytes: [1, requestId, 6, effect, R, G, B].

| Operation | Value | Behavior |
| --- | --- | --- |
| 1 | 0 or 1 | Power off/on |
| 2 | 1â€“255 | Brightness, preserving power |
| 3 | 1â€“28 | Effect, preserving power |
| 4 | 0 | Save current effect and brightness as startup defaults |
| 5 | 0 | Refresh state |
| 6 | Effect 1–29, followed by R/G/B bytes | Set this effect’s custom color |
| 7 | Effect 1–29 | Restore original colors (Custom solid resets to pink) |

State: 7b610003-6e2b-4f3d-9a71-28e45c001001 (encrypted read and notifications).
The original firmware sends twelve bytes: [version, requestId, result, effect, brightness, power, effectCount,
capabilities, revision0, revision1, revision2, revision3]. Revision is unsigned
32-bit little-endian. Capability bit 0 means save-defaults support. Request ID 0
denotes an unsolicited knob/HTTP state change. Color-capable firmware appends four
bytes [overrideEnabled, R, G, B], sets capability bit 1, and reports 29 effects.
The new app accepts both formats and hides new controls on old firmware.
Install the updated app before updating firmware: the original app only accepts
12-byte state packets and 28 effects.

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

## Custom effect colors

Every effect has an optional RGB override, including Rain. Custom solid is effect
29; the existing 28 IDs keep their meanings. Pick a color in the mobile app or
apply one on the Wi-Fi page. Restore original colors returns animated effects to
their original palettes. The override uses each pixel's strongest channel as its
intensity, preserving motion and fades while replacing the palette. Rainbow
effects use luminance to turn moving hue bands into moving brightness bands. Original
frames are restored after display so trails do not accumulate tint or dim twice.

Colors are previewed live; the app's startup save button or the web settings save
persists all slots in a separate versioned NVS blob. The Wi-Fi/password/settings
blob layout is unchanged. Named Pink now uses RGB (255,35,85), reducing its previous
blue-heavy (255,0,220) appearance; confirm the result on the physical diffuser.

## Firmware status extension

Capability bit 2 advertises encrypted read/notify characteristic 7b610004-6e2b-4f3d-9a71-28e45c001001. Its 20 bytes contain schema (1), phase, automatic flag, Wi-Fi flag, progress (0â€“100), error, three little-endian uint16 installed version components, three uint16 latest version components, available flag and a reserved byte.

Phases: idle=0, checking=1, available=2, downloading=3, restarting=4, error=5. Error meanings are in LampUpdate.h. Operations 8 and 9 (value 0) check and install; operation 10 (0/1) persists automatic installation. Result 3 also means updater starting, busy, or no available update. Explicit rejection keeps the Bluetooth connection; uncertain timeouts still disconnect. Existing state packets and control compatibility remain unchanged.
