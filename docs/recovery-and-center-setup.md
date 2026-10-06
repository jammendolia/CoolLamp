# Lamp removal, factory reset, and center fine-tuning

Firmware **1.9.1** and the corresponding phone app add these controls. Older
lamps retain their current behavior and show an upgrade hint for unsupported
features. C3 GPIO assignments are unchanged.

## Remove a lamp from the phone

The **Lamps** screen has a trash icon inside the lower-right corner of each lamp
card, with a separate 44-point tap target and the existing confirmation. The same
action is available under **Settings → Overview**. It removes the app's saved
lamp, stored access password, reconnect target, and cached discovery record.
Removing an offline lamp works without connecting to it. Removing one lamp
does not disconnect another lamp that is currently selected.

The lamp itself retains its settings and Bluetooth bonds. The updated app uses
AccessorySetupKit on iOS 18 and later to remove its authorized iPhone pairing
with the app record. Apple may ask for confirmation. Cancelling or failing that
operation keeps the app record and access password intact. Existing saved
peripherals are migrated together using Apple's authorization picker before
initializing Core Bluetooth. A cancelled or incomplete migration cannot connect
or discard records. Saved, authorized lamps reconnect without the setup picker.

Android, iOS 15–17, and unrecognized legacy pairings retain manual unpairing.
The app shows the pairing name and instructions; Android also has an **Open
Bluetooth settings** button. On iPhone use **Settings → Bluetooth → the lamp →
Forget This Device**. If a legacy pairing cannot be migrated, a separate
confirmation allows removing only its app record and provides manual steps.
Cancelling Apple's prompt never selects this fallback automatically.

Firmware **1.9.2** advertises the unique hardware name, such as
`CoolLamp-E2EA24`, instead of `CoolLamp`. The Apple picker also allows naming the
lamp. Settings → Overview shows the Apple pairing name and hardware Bluetooth
name separately. Changing the lamp name in the app does not silently rename
its iPhone pairing. Old generic Settings entries remain ambiguous until replaced.

The `Peer removed pairing information` error opens named recovery instructions
and an iPhone **Remove old pairing & try again** action when the peripheral
identifier is known. This uses Apple's removal operation without resetting the
lamp again. A knob reset followed by deletion of the old app record may still
require manual unpairing, because its old iPhone identifier is no longer known.
OS-authorized accessories remain available as app cards after a failed GATT
connection or an app restart; late results cannot restore a removed card.

Late results from a scan already in progress cannot reinsert a removed lamp.
An explicit **Find on Wi-Fi / Refresh Wi-Fi list** allows rediscovery. A lamp
still on the network may appear as a new discovery in a later app session.

## Factory reset

Choose **Settings → Overview → Factory reset lamp**, review the confirmation,
then select **Factory reset**. This works over Bluetooth or authenticated
Wi-Fi. The phone removes its app record after the lamp confirms the reset.

Alternatively, hold the knob for **ten seconds**. The existing orange setup
cue appears at three seconds and blue pairing cue at six. At ten seconds the
lamp flashes **red**. Release the knob to commit the reset. Continuing to
hold keeps it armed; release is required. A shorter hold never resets it.
Firmware updates suppress the reset gesture.
The encoder button uses the ESP32's internal GPIO2 pull-up in this firmware;
the existing GPIO assignments and A/B inputs are unchanged.

The lamp restarts with these user settings cleared:

- Home Wi-Fi and the lamp access password (restored to `coollamp`).
- Bluetooth phone bonds and notification subscriptions.
- Lamp name, palettes, effect tuning, audio tuning, and startup choices.
- Group membership, group credentials, group scenes, effect rotation, and
  automatic-update preference.

It preserves the physical hardware configuration: **LED count, effect center,
power limit, and microphone presence**. This keeps a 205-LED microphone lamp
correctly configured after reset. Firmware and hardware identity are retained.
The default light is Fire at brightness 100. After an app reset, authorized
iPhone pairings are also removed. If cleanup fails or is unsupported, the app
shows recovery steps and correctly reports that the lamp reset already started.
After a physical knob reset, clear the old phone pairing through the app or
phone Settings. Hold six seconds to pair again.

Reset is deferred briefly so Bluetooth/HTTP can acknowledge it. A versioned,
checked hardware recovery record is saved in a separate NVS namespace before
restarting. Startup clears the user-settings namespace, restores hardware,
then erases Bluetooth bonds before advertising. Interrupted recovery can be
retried; completing settings recovery is recorded before bond cleanup so a
later restart does not clear newly saved settings again. No reset is executed
merely by installing this firmware.

Authenticated `POST /api/factory-reset` requires `confirm=RESET` and the
existing mutation token. Encrypted BLE command 19 requires `0xa5` and firmware
capability bit `0x80`. The app pins a reset confirmation to the selected lamp
and connection epoch; changing/disconnecting that connection cancels it.

## Fine-tune the effect center

Under **Settings → Hardware → Fine-tune the center**, choose **Fine-tune
center**. The lamp temporarily displays a blinking white LED at its saved
center (or automatic midpoint). Turn the knob to move the marker. Click once
to save, or use **Set this center** in the app. **Cancel adjustment** or
**ten seconds without knob/app movement** restores the normal effect without
saving. Merely reading the status does not extend this timeout.

The tool works over both Bluetooth and Wi-Fi, including before Wi-Fi setup.
It adjusts the existing one-based split boundary after the displayed LED;
valid boundaries are 1 through LED count minus one. Both sides remain nonempty.
The numeric Wi-Fi center field still offers zero for automatic positioning.
Saving updates all center-aware effects immediately, without restarting or
changing the LED count. A failed save leaves the probe active for retry;
timeout still cancels without changing the saved center.

This differs from **LED strip sizing**, which retains its teal last-pixel
probe, 1–1024 range, five-minute timeout, and save/restart behavior. HTTP
`/api/calibration` uses `kind=center` for the new tool and checks that save/move
requests match the active tool. Encrypted BLE command 20 selects
start/save/cancel/status (0–3); command 21 moves a little-endian 16-bit boundary.
Characteristic `7b610009-6e2b-4f3d-9a71-28e45c001001` returns a bounded center
status. Reads are serialized with their selecting commands. Both new recovery
and center controls use capability bit `0x80`.

The embedded setup webpage also includes center-tool and factory-reset
buttons. USB diagnostic `c` starts the center probe; `j` reads its status.
Neither diagnostic saves a center value automatically.

## Verification

Host tests exercise reset persistence and interrupted writes, retained
hardware, release-only long holds, debounce/update suppression and clock
rollover. Actual playback tests cover center bounds, restoration, failed
saves, ten-second timeout, and independence from LED-count sizing. Mobile
tests cover encrypted command framing, capability checks, authenticated HTTP,
center preview/save/cancel, and discovery removal. The real app's simulated
Bluetooth browser check covers removal, reset confirmation/cancellation,
center knob/status behavior, idle cancellation, accessibility, and narrow
layouts. Physical factory reset remains a deliberate owner action.

On 2026-10-05, firmware 1.9.1 was USB-flashed and hash-verified on
`CoolLamp-E2EA24`. The live center probe started at LED 103 on the 205-LED strip,
then became inactive after ten seconds without input. The saved midpoint stayed
zero (automatic), normal rendering resumed, and microphone presence remained
enabled. Home Wi-Fi was still unset. No physical factory reset was executed.
All 63 mobile tests and both browser checks passed for that version.

## Reconnection fix for the next app build

The native iOS BLE plugin recreates `CBCentralManager` on each `initialize`
while retaining its peripheral cache. The app now initializes it once per
session, retrieves a saved peripheral before reconnecting, and ends an
unfinished connection only when this transport initiated it. A fresh Apple
authorization is handed over without forcibly disconnecting the picker's link.
This also allows a saved lamp to reconnect after app restart
without discovery. Failed initialization remains retryable.

All 76 mobile tests pass, including A → B → A switching, cold reconnect,
migration before initialization, cancellation, incomplete authorization,
target-specific removal, OS accessory recovery, and platform fallbacks. Both
browser checks pass. The native iPhone app compiles against Xcode 26.3, with
AccessorySetupKit explicitly weak-linked and availability guards preserving
iOS 15–17. Firmware 1.9.2 compiles and packages with the original GPIOs.
The actual Apple accessory picker, migration, and removal still need a real
phone test; browser and simulator checks cannot verify these system/radio
operations. Android native compilation is unavailable on the development Mac
because the Android SDK and Java runtime are not installed; its existing
native code is unchanged and the updated web assets synchronize successfully.

## Pairing completion and Wi-Fi setup in 1.9.3

The app saves an Apple-authorized accessory before attempting the encrypted
GATT handshake. Explicit reauthorization clears the removed-card tombstone;
cancelled pickers and late unrelated results cannot resurrect deleted cards.
The native picker resolves final identifiers and names from session inventory,
including late accessory events, without choosing an arbitrary existing lamp.
An unsuccessful control connection keeps the authorized card available to retry.
If Apple's inventory is ahead of Core Bluetooth's cache, reconnect retries
retrieval, checks system-connected peripherals, then briefly scans for the exact
authorized UUID. Other lamps are ignored, even if they share a display name.
This recovery does not reopen the picker or discard the pairing. The scan omits
service/name filters because saved lamps omit those fields outside enrollment.

Firmware stops the blue cue when it accepts a radio connection, while keeping
the enrollment window open until encrypted bonding completes. A failed new
authentication resumes the cue while that window remains open. Saved phones
remain subject to the existing bond check. Blue stopping alone does not mean
that the app completed its control setup.

The app still requires the lamp's application-level acknowledgment for each
command. If its notification is missing, it reads the state once within the
original deadline and accepts only that command's exact identifier and result.
It never resends an uncertain command. Initial command identifiers start beyond
the cached reply from the previous connection, and old connection callbacks or
readbacks cannot confirm a new connection's command.

Wi-Fi settings explain the first scan step, disable the button with **Scanning…**,
report completion, and open a network chooser automatically. A password eye
button temporarily reveals the typed password and hides it on leaving setup or
submitting. Bluetooth and Wi-Fi connections share these controls.

The ten-minute hotspot expiry is deferred during a scan or Bluetooth Wi-Fi join,
so it cannot turn a first-time lamp's radio off while provisional credentials are
being tested. Wi-Fi diagnostics retain the last driver disconnect reason,
association, DHCP milestone and setup error through cancellation. They report
compatible-security, signal and DHCP failures when known; a timeout without a
driver reason is not treated as evidence of an incorrect password.

USB **q** and authenticated `GET /api/bluetooth` retain connection/authentication,
command and acknowledgment counts, last command operation/identifier and
notification status after disconnect. They exclude command payloads, phone
identifiers and credentials. USB **p** includes compact `join` diagnostics in
the order setup error, driver reason, associated, received IP. USB polling can
use `--poll-command q` or `--poll-command p`; the audio default remains `u`.

Regression checks compile the actual firmware connection/security callbacks and
Wi-Fi provisioning engine, including hotspot expiry during a first-time join.
Mobile tests cover missing notifications, stale/late readbacks and failed Apple
handoff. Native host tests cover provisional identifiers, final names, late
inventory, cancellation and ambiguous accessories. Physical Wi-Fi join success
and Apple radio behavior require a phone retry; host checks cannot establish them.

## Bluetooth reconnection and Wi-Fi setup in 1.9.4

The pinned ESP32 Arduino BLE wrapper registers characteristics by allocation
address, so an unchanged UUID can acquire a different ATT handle across builds.
A bonded iPhone can retain its old handle cache and read a different attribute,
producing **Invalid response from lamp** even though encryption succeeds.
Appending characteristics alone does not ensure stable handles in this wrapper.
After encryption and the existing owner/enrollment checks, firmware sends the
standard Service Changed indication once per phone per boot.

On a bonded reconnect, an encrypted ATT request can also arrive without, or
before, the authentication-complete callback. Live USB traces showed a known
phone's encrypted write rejected while the callback-derived flag remained false.
Authorization now checks the live connection descriptor, matching connection
handle, encryption, and either a known owner or an explicit enrollment window.
Encryption alone never authorizes an unknown phone. A connection being closed
cannot reauthorize itself or prematurely close a newly opened enrollment window.
Queued commands still require the current authorized connection generation.
The live corrected connection acknowledged 55 commands with zero rejected writes.

App build **22.1** retries one connection automatically only when the initial
protected state read has an invalid packet shape on an Apple-managed accessory.
No control commands have been sent at this point. It keeps the authorized device,
does not reopen the picker or replay commands, and does not retry an incompatible
protocol. A second invalid initial packet ends the attempt with its byte count.

USB **q** additionally reports state-read count/length, service-refresh count,
authorization milestones and rejection flags. It excludes phone addresses,
command payloads and credentials.

### Authentication timeout and per-lamp radio profile

The USB prototype repeatedly timed out with driver reason **2** (AUTH_EXPIRE),
before association or DHCP, on both the main and IoT networks. Keeping driver
retries enabled, disconnecting the iPhone's Bluetooth, turning the LEDs off, and
pausing LED data/audio did not resolve it. A controlled **8.5 dBm** transmit-power
trial then obtained an address on the IoT network; the owner confirmed that
Wi-Fi effect and power controls worked. This is evidence for a radio/power-margin
issue, not proof of a defective ESP32 or an incorrect Wi-Fi password.

New lamps retain the driver's normal power profile. During Bluetooth Wi-Fi
setup, an AUTH_EXPIRE failure without association can trigger one lower-power
retry after eight seconds, within the same 35-second deadline. Other failure
reasons do not select this retry. Failed or cancelled trials restore the prior
profile without saving a speculative setting. A successful lower-power join
saves a one-byte per-lamp `wifiPower` profile only after obtaining an IP address.
It is applied before joining on subsequent boots and when restoring saved Wi-Fi.
Normal lamps keep their normal profile; firmware does not lower every lamp's
transmit power. Factory reset clears this profile with other user settings;
a later setup can select it again. Animation and audio continue during setup.

USB **p** adds `tx: [power in quarter-dBm units, saved reduced-profile flag]`.
The existing `join` tuple retains setup error, driver reason, association and
IP milestones. Host tests exercise the retry threshold, single-retry bound,
setter failure, timeout/cancellation rollback, success-only persistence and
restoring the profile after startup. On 2026-10-06, the USB lamp was flashed and hash-verified with this firmware.
It automatically rejoined its saved network after restarting, with `tx: [34,1]`,
205 LEDs, its existing phone bond, and its microphone configuration intact.
Audio capture reported no errors or overruns after restart.

### Keep the chosen name during Wi-Fi handoff

A newly paired lamp reports its factory hardware name over Wi-Fi until named
there. Earlier apps let that response overwrite the phone's chosen nickname.
The next app build preserves the saved nickname, room, favorites and pairing
identity when the Wi-Fi response is a factory name. If an older build already
overwrote the nickname, the retained Apple picker name can restore it. An
explicit custom name reported by the lamp still takes precedence. Nicknames
are matched by lamp identity, never borrowed from another lamp.

All 93 mobile tests pass. The browser check exercises the real Bluetooth-to-Wi-Fi
handoff with a factory-named Wi-Fi response and verifies the chosen nickname
both on screen and in persistent storage.
