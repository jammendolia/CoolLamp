# Cool Lamp

ESP32-C3 / WS2812B lamp with 37 effects, rotary controls, saved settings, Wi-Fi setup, and browser OTA updates.

## Controls

- Turn the knob: select the next or previous effect (wraps around).
- Single short click while on: adjust brightness by turning the knob (minimum stays above zero).
- Double short click while on: adjust Color 1 for the current effect using a 24-color palette.
- While adjusting: single click or five seconds without activity saves the change and returns to effect selection. Changes preview live; brightness saves do not change the startup effect.
- Triple short click while on: turn off. Single short click while off: turn on.
- Clicks are grouped within 350 ms; a short press lasts up to 600 ms. Turning immediately after clicking confirms the click without waiting. Long holds cancel click counting.
- At three seconds while held: open or close the setup hotspot. Opening flashes orange for three seconds. Continue holding to six seconds to enter Bluetooth pairing and switch to blue.
- Hold for six seconds: enter Bluetooth pairing. The entire lamp flashes blue for up to two minutes, stopping when a phone pairs. Hold six seconds again to cancel. No pairing code is required. Long holds never also toggle the light.
- The hotspot closes after ten minutes without an authenticated request. Hold the knob again to reopen it.

## Setup

1. Hold the knob for three seconds.
2. Join `CoolLamp-XXXXXX` on this lamp. Other boards use their own MAC suffix.
3. Use the initial password in `LampSecrets.h` for both the hotspot and web login.
4. Open **http://192.168.4.1/**. Web username: **lamp**.
5. Use **Find nearby networks** to select a 2.4 GHz network, or enter a hidden network manually. Scanning keeps the setup hotspot open.
6. Preview effects/brightness, or save LED count, brightness, startup effect, LED current limit, home Wi-Fi, and a new access password. Saving restarts the lamp.

The lamp supports 2.4 GHz Wi-Fi. Once connected to home Wi-Fi, open **http://coollamp-xxxxxx.local/** (or its IP from your router). Configuration and firmware upload require the same login on the home network. The hotspot is off during normal startup; it is only opened by a long hold. If home Wi-Fi credentials are wrong, the light still works and a long hold lets you correct them.

There are no cloud services. The web interface uses HTTP on the local network; use it on a trusted network. Wi-Fi credentials are saved on the device and are never returned by the settings API. An empty password field keeps the saved password. Use the explicit open-network or forget-network controls when appropriate.

## LED count and power

`LampConfig.h` defines `DEFAULT_LED_COUNT` (134) and `MAX_LED_COUNT` (1024). The page changes the active length from 1 to 1024 without rebuilding. Every effect uses the active `NUM_LEDS` value. Odd split lengths assign the extra center LED to the left half. Animation buffers are allocated for the configured length at startup; only the active LEDs are transmitted.

The default LED current budget is 500 mA at 5 V. Raising it requires an appropriately rated supply and wiring. The FastLED budget is an estimate for LED power, not a measurement of total lamp current. Longer strips may run at lower brightness or frame rates.

## Effect order

1. Pacifica
2. Aurora
3. Rain
4. Fire
5. Split fire (ends to center)
6. Split fire, outward (center to ends)
7. Split fire, reversed colors (red/orange ends, white center)
8. Blue gas fire
9. Witch fire
10. Purple fire
11. Embers
12. Lava
13. Plasma
14. Rainbow
15. Rainbow with glitter
16. Confetti
17. Comet collision
18. Sinelon
19. BPM
20. Juggle
21–28. White, red, green, blue, purple, pink, yellow, cyan

29. Custom solid
30. Bouncing droplets
31. Lightning storm
32. Color tide
33. Fireflies
34. Heartbeat
35. Shooting stars
36. Breathing glow
37. Lava blobs

Each effect remembers its primary color, optional second color, speed (1–100), and
intensity (0–100). Speed 50 is normal; speed does not apply to solid colors.
Intensity scales light output and also changes particle density or strike
frequency where applicable. The new effects use both colors directly. For older
effects, apply a primary custom color to enable the two-color gradient.

App changes apply live. On the web page, apply colors/effect settings and use
**Preview light** to activate the selected effect. Save startup settings to keep
all slots through a restart. The previous color-capable app can still connect and
select its original 29 effects. See [effect release notes](docs/effects-1.3.md).

## Build and update

After cloning, run `node tools/setup-secrets.cjs` once to create a private initial password header made from two randomly selected common words (for example, `cactus-piano`). It will not overwrite an existing header. Node.js is needed for this helper and the tests.

Board target: `esp32:esp32:esp32c3:CDCOnBoot=cdc`. Dependencies: Arduino ESP32 core 3.3.11, FastLED 3.10.5, ESP32RotaryEncoder 1.2.0. WiFi, WebServer, Preferences, ESPmDNS, and Update come with the ESP32 core.

Bluetooth prototype build: `node tools/build-firmware.cjs`. The larger partition layout needs a first USB installation; see [Bluetooth app notes](docs/bluetooth-app.md).

Use this build script for updater-capable firmware. It applies the radio memory
configuration needed for HTTPS downloads while Bluetooth is running; a plain
Arduino IDE build does not apply that linker setting.

For OTA, open the lamp page, select **CoolLamp.ino.bin** in the Firmware update section, and upload. Do not select bootloader, partitions, or merged images. The upload is authenticated and protected by a per-boot request token. The handler verifies the C3 application header, writes the inactive OTA partition, and restarts only after successful verification. Failed/interrupted uploads do not activate the incomplete image. Effects pause while receiving firmware. USB upload remains available for recovery.

`LampSecrets.h` contains this lamp's generated initial access password. Keep it private; create a different 8–63 character password for another lamp or change it through setup. Saved passwords override the initial value after restart. If you forget the saved password, recovery requires clearing the `coollamp` preferences namespace or erasing device settings over USB; simply rebuilding with a different initial password does not override saved credentials.

## Verification

`tests/knob.cpp` exercises the actual knob controller with simulated time, button,
encoder, and storage. Compile with C++17, warnings as errors, and address/undefined
behavior sanitizers, then run it. It covers click counts, bounce, long holds,
immediate click-and-turn, inactivity saves, failed-save retries, bounds, effect
wraparound, remote changes, update suppression, and timer wraparound. Physical
click feel and encoder behavior still require a device check after flashing.

`node tests/wifi-page.cjs` checks word-password generation, preservation of existing secrets, network selection, and scan-error recovery. Live device checks also exercise repeated scans while the hotspot serves requests.

`node tests/check.cjs` checks page JavaScript syntax, mode coverage, and strip mapping across 1–1024 LEDs. `node tests/check.cjs --serve` starts a mock setup page at http://127.0.0.1:8765 for UI testing. This mock does not prove radio connectivity or on-device OTA behavior.

### Live verification on this lamp

- USB upload and flash verification passed.
- AP startup succeeded at 192.168.4.1, with no new reset reported during startup.
- Authentication and missing-token rejection passed.
- Invalid LED counts (0 and 1025) were rejected without saving.
- Browser API effect and brightness preview passed.
- An invalid firmware image was rejected and the lamp remained responsive.
- An actual Wi-Fi upload of the application image verified successfully and restarted the lamp.
- LED count 133, brightness 99, and Aurora startup survived a settings save/restart. Original settings (134 LEDs, brightness 100, Fire) were then restored.
- The test computer's original Wi-Fi connection was restored after every connection test.
- Home Wi-Fi association awaits the owner's network credentials through the setup page.

USB diagnostics are available for recovery: send `?` at 115200 baud for reset/AP/heap status, or `a` to toggle the setup hotspot. Replies contain no credentials and use a zero transmit timeout, so an unread USB port cannot stall lamp controls or radio startup. Library diagnostics can also appear on USB.

The pre-Bluetooth application used about 1.22 MB in a 1.31 MB OTA slot. The Bluetooth prototype compiles at 1,502,898 bytes and uses the larger 2,031,616-byte OTA slots. Install the new partition layout over USB before using wireless updates with that build. This lamp received the USB migration successfully on 2026-09-15; upload hashes, partition readback, saved configuration preservation and USB startup diagnostics passed. Phone pairing and physical gesture tests remain pending.
- The owner confirmed the original three-second gesture and teal setup pulse. The updated orange feedback still needs a physical check.

## Online firmware updates

Firmware 1.2.0 adds version display, update detection, **Update now**, and optional automatic installation in both the web page and phone app. Automatic installation defaults off. The lamp needs home Wi-Fi with internet access. Affected older updaters need a one-time local or USB repair. Firmware 1.3.5 completed a full online download, verification and restart on the test lamp with saved settings preserved. See [online update setup, release instructions and validation limits](docs/github-updates.md). Only the separate public build may be published; private local binaries contain initial credentials.

## Phone app prototype

See [mobile/README.md](mobile/README.md) for the Android/iOS projects and [Bluetooth app notes](docs/bluetooth-app.md) for gestures, pairing and prototype limits. USB installation and startup are verified; phone pairing and physical gesture tests remain pending.
