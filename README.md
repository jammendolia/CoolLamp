# Cool Lamp

ESP32-C3 / WS2812B lamp with 28 effects, rotary controls, saved settings, Wi-Fi setup, and browser OTA updates.

## Controls

- Turn the knob: select the next or previous effect (wraps around).
- Short press and release: toggle the light.
- Hold for three seconds: open or close the setup hotspot. A short teal pulse confirms the gesture. Releasing after a long hold does not toggle the light.
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

`LampConfig.h` defines `DEFAULT_LED_COUNT` (134) and `MAX_LED_COUNT` (1024). The page changes the active length from 1 to 1024 without rebuilding. Every effect uses the active `NUM_LEDS` value. Odd split lengths assign the extra center LED to the left half. Build-time buffers are sized for the maximum; only the active LEDs are transmitted.

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

## Build and update

After cloning, run `node tools/setup-secrets.cjs` once to create a private initial password header made from two randomly selected common words (for example, `cactus-piano`). It will not overwrite an existing header. Node.js is needed for this helper and the tests.

Board target: `esp32:esp32:esp32c3:CDCOnBoot=cdc`. Dependencies: Arduino ESP32 core 3.3.11, FastLED 3.10.5, ESP32RotaryEncoder 1.2.0. WiFi, WebServer, Preferences, ESPmDNS, and Update come with the ESP32 core.

Build using `arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc --output-dir firmware .`.

For OTA, open the lamp page, select **CoolLamp.ino.bin** in the Firmware update section, and upload. Do not select bootloader, partitions, or merged images. The upload is authenticated and protected by a per-boot request token. The handler verifies the C3 application header, writes the inactive OTA partition, and restarts only after successful verification. Failed/interrupted uploads do not activate the incomplete image. Effects pause while receiving firmware. USB upload remains available for recovery.

`LampSecrets.h` contains this lamp's generated initial access password. Keep it private; create a different 8–63 character password for another lamp or change it through setup. Saved passwords override the initial value after restart. If you forget the saved password, recovery requires clearing the `coollamp` preferences namespace or erasing device settings over USB; simply rebuilding with a different initial password does not override saved credentials.

## Verification

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

Current application size is about 1.22 MB in a 1.31 MB OTA slot. Future larger builds may require a partition-layout change over USB before they can be installed wirelessly.
- The owner confirmed the three-second knob hold now produces the teal setup pulse.

## Planned GitHub updates

See [the update roadmap](docs/github-updates.md) for release publishing, available-update signaling, and automatic installation. These are planned; current OTA uses a manual upload on the lamp page. Never publish the current local firmware binaries: they contain the initial device password.
