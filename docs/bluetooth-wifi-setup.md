# Wi-Fi setup over Bluetooth

Firmware **1.9.0** and the matching updated phone app support home Wi-Fi setup
over an existing encrypted Bluetooth connection. Older lamps retain their
hotspot setup flow; the app checks the capability advertised by each lamp.

## Using the app

1. Pair/connect to the lamp over Bluetooth. For a new phone, hold the knob for
   six seconds to open pairing, then choose **Find my lamp** in the app.
2. Open **Settings → Wi-Fi & security → Find Wi-Fi networks**.
3. Choose a 2.4 GHz network, enter its Wi-Fi password, and select
   **Connect lamp to Wi-Fi**. Hidden network names can be entered directly.
4. The app shows connection progress. The lamp saves credentials only after
   joining the network and receiving an IP address. It does not restart.
5. When the phone can reach the same lamp on that network, the app switches to
   Wi-Fi control using its saved lamp access password, or `coollamp` when the
   lamp confirms it still has the factory password. The app verifies device
   identity before switching. Unknown custom access passwords are requested
   through the existing connection form.

If the lamp joins but the phone cannot reach it, Bluetooth control stays
available. Put the phone on the same network and choose **Use Wi-Fi control**.
**Cancel Wi-Fi setup** stops scanning or an unfinished connection attempt.
Incorrect passwords and timed-out joins allow a retry and retain the previous
saved configuration. Open networks require the password-free option and an
empty password. Enterprise Wi-Fi is not supported by this setup flow.

The hotspot remains a recovery option: hold the knob for three seconds, join
the lamp's hotspot, and open `http://192.168.4.1`. The new app build is needed;
installing firmware alone does not add these controls to an older phone app.

## Protocol and persistence

- BLE state capability bit `0x40` advertises Wi-Fi setup support. Existing
  commands, effect IDs, and C3 GPIO assignments are unchanged.
- Encrypted read characteristic `7b610008-6e2b-4f3d-9a71-28e45c001001` holds one
  bounded JSON status or network record. It is appended to the service to
  preserve existing characteristic handles. Passwords are never returned.
- Existing encrypted command writes carry acknowledged commands 14–18:

| Command | Payload |
| --- | --- |
| 14 | 0: status; 1: scan; 2: cancel |
| 15 | Network index, 0–15 |
| 16 | SSID byte length, password byte length, password-free flag |
| 17 | Contiguous byte offset followed by up to 16 credential bytes |
| 18 | Commit a complete credential transfer |

All writes fit the minimum BLE MTU's 20-byte payload. SSIDs use 1–32 UTF-8
bytes; personal Wi-Fi passwords use 8–63 bytes. Network entries share a scan
ID so results cannot be mixed across scans. The app serializes selection and
readback together with ordinary controls.

Credential fragments are scoped to the current BLE connection generation,
must arrive in order, and expire after 20 seconds without progress. Incomplete
transfers are cleared on disconnect. Submitted joins run for at most 35 seconds;
they may complete if the phone disconnects after submission. Scan work is
bounded to 25 seconds. Credential buffers are cleared after use/cancellation.
All Wi-Fi and Preferences changes run on the firmware's loop task, outside BLE
callbacks. OTA and conflicting network changes wait for setup to finish.

Only the SSID and Wi-Fi password fields of the existing `coollamp/settings`
blob change after a successful join. LED count, power limit, startup settings,
access password, audio settings, and Bluetooth bonds are preserved.

## Validation

`python3 tests/wifi-setup-runtime.py` exercises the actual provisioning engine
with simulated Wi-Fi/NVS, including failed writes, failed joins, cancellation,
maximum-size credentials, ownership, and timeout recovery. Mobile tests cover
wire framing, scan paging, errors, and legacy firmware. The browser check
`tools/check-bluetooth-wifi.cjs` uses the real app and Web Bluetooth adapter with
a simulated GATT device to verify retry, password clearing, handoff, narrow
layouts, and accessibility.

USB command `b` starts the same scan engine without enabling a hotspot; `p`
returns its status without credentials. These diagnostics allow checking a
new lamp while leaving its home Wi-Fi configuration unset. Joining a real
network and the iPhone Bluetooth flow require the owner’s later test.

On 2026-10-05, firmware 1.9.0 was USB-flashed and hash-verified on
`CoolLamp-E2EA24`. USB status confirmed 205 LEDs, the factory password flag,
and an empty saved SSID. Two scans found nine and eight unique networks with
the hotspot off. During a scan overlapping microphone diagnostics, capture
reported zero errors/overruns and rendering remained approximately 63 fps;
observed free heap stayed above 55 KB. The microphone installed flag was
preserved. No home Wi-Fi network was joined or saved. The updated app's
simulated Bluetooth browser flow and 59 mobile tests passed; a new TestFlight
build is still needed for the physical iPhone setup test.
