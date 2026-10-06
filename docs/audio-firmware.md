# Audio firmware (1.5.0)

The `feature/audio-input` firmware adds two effects without changing existing GPIO assignments:

| Effect ID | Name | Behavior |
| --- | --- | --- |
| 39 | Sound glow | Whole-lamp brightness follows the sound envelope |
| 40 | Sound meter | Sound level rises from both strip ends toward the midpoint |

Both use the existing color, secondary color, intensity, overall brightness, and power limit. Speed controls envelope release, independently of the sample rate. Existing effects keep IDs 1–38.

## Hardware and product variants

Connect INMP441 VDD to 3V3, GND and L/R to GND, SCK to GPIO5, WS to GPIO6, and SD to GPIO7. See the [microphone guide](hardware/coollamp-inmp441-wiring.png) and [encoder companion guide](hardware/coollamp-microphone-encoder-wiring.png). The images were created during planning; their “firmware not yet implemented” captions describe that earlier stage.

Use one firmware image for both products. The saved microphone device setting defaults to microphone **not installed**. In that configuration, Wi-Fi and BLE catalogs contain only the original 38 effects, the knob wraps at 38, audio effect commands are rejected, and capture resources are not allocated. Enable the setting during assembly/testing of microphone-equipped lamps. Ordinary OTA preserves it. Settings take effect on restart, keeping each connection's catalog stable.

The INMP441 has no readable device ID or control bus. Successfully starting I2S does not prove it is connected. The `signalSeen` diagnostic reports varying samples, which may also be electrical noise; it is not definitive presence detection. Never automatically hide effects because a room is quiet. A production check should combine the assembly setting with a known acoustic stimulus and observed response. [INMP441 datasheet](https://product.tdk.cn/system/files/dam/doc/product/sw_piezo/mic/mems-mic/data_sheet/inmp441.pdf)

## Configuration and testing

The lamp's existing authenticated Wi-Fi page now has a **Microphone** section:

The phone-app source also exposes these settings under **Lamp settings → Wi-Fi & advanced settings → Microphone**, when connected over Wi-Fi to supporting firmware. Installing the updated app is separate from flashing the lamp. Bluetooth still supports selection and normal effect controls; microphone provisioning/sensitivity settings use Wi-Fi or USB in this version.

1. Select **INMP441 microphone installed**, set sensitivity and noise gate, then save and restart.
2. Reconnect the phone app or refresh the web page to load the new catalog.
3. Select Sound glow or Sound meter. The updated app groups these under Audio; previous apps with dynamic catalogs can still show them under All.
4. Use **Test microphone for 10 seconds** to inspect levels without changing the selected effect. Capture pauses during updates.

Sensitivity and scale factor are sliders with numeric readouts in the app and lamp web page. Default sensitivity is 8 (range 1–64); noise gate is 8 (range 0–1024, in the scaled sample domain). Raise sensitivity for quiet sources; raise the gate if ambient noise keeps the light active. These are initial tuning values, not a calibrated sound meter.

Scale factor ranges from **1.00× to 4.00×**, defaulting to 1.00× to preserve existing behavior. After gating and sensitivity, a normalized level `x` becomes `max(0, 1 − scale × (1 − x))`. At 2×, levels in the lower half become completely black; full-scale sound remains full brightness. Rendering smooths transitions and reaches exact black on sustained quiet. Start at 2× and adjust for the room; sensitivity 32 remains a useful prototype setting. Save and restart applies both sliders. Controls are under **Lamp settings → Wi-Fi & advanced settings → Microphone** and require Wi-Fi. Audio effects have their own Audio filter and a separate heading in All.

The API expresses scale in hundredths (`100..400`). New settings use the seven-byte `audioV2` blob, falling back to the old five-byte `audioV1` on upgrade, retaining gain, gate, and installed status with scale 100. Requests omitting scale preserve the current value. Older firmware cannot accept scale; the updated app disables that slider until firmware is upgraded.

USB commands support assembly and troubleshooting. `tools/audio-usb.py` uses Python's standard library on macOS/Linux; supply the actual port:

```sh
python3 tools/audio-usb.py /dev/cu.usbmodem80201 m
python3 tools/audio-usb.py /dev/cu.usbmodem80201 g --poll --seconds 10
```

`m` saves microphone installed with default gain/gate and restarts; `n` saves microphone absent and restarts. After restarting, allow the lamp to boot before the next command. `+` doubles sensitivity (up to 64), and `-` halves it (down to 1); both save and apply without restarting, preserving the installed flag and gate. `g` selects Sound glow, `v` Sound meter, and `f` Fire. `t` requests a ten-second capture diagnostic; `u` returns its status; `?` returns the existing system status. Audio selections are rejected when the microphone setting is off. USB commands do not erase Wi-Fi credentials or Bluetooth bonds.

Authenticated HTTP endpoints:

- `GET /api/audio`: installed setting, gain, gate, capture state, levels, block/error/overrun counts, worker stack headroom, heap, frame count, and maximum render duration.
- `POST /api/audio`: `enabled=0|1`, `gain=1..64`, `gate=0..1024`, optional `scale=100..400`; saves and restarts. Requires the existing `X-Lamp-Token` and web authentication.
- `POST /api/audio/test`: starts the ten-second diagnostic when installed and not updating. Same authentication requirements.

## Implementation and limits

`LampAudio.cpp` owns a standard I2S RX channel at 16 kHz with two 32-bit slots (1.024 MHz bit clock). It retains the left slot, discards startup samples, processes blocks independently of rendering, and publishes short locked snapshots. DMA uses four 256-frame buffers (8 KiB); the read buffer is 2 KiB and the task stack 4 KiB. These allocations are released when unused and synchronously before local OTA or remote HTTPS checks/downloads. [ESP32-C3 I2S driver](https://docs.espressif.com/projects/esp-idf/en/v5.5.5/esp32c3/api-reference/peripherals/i2s.html)

`AudioAnalysis.h` uses integer DC removal, RMS/peak extraction, and a gate with hysteresis. `AudioEffects.ino` smooths levels by actual elapsed time, decays stale data, and uses the normal LED output pipeline. No PCM is stored or sent over Wi-Fi/BLE. Signal diagnostics report only aggregate features.

The original 153-byte color and 229-byte option payloads remain unchanged. Audio colors/options use a separate versioned key, preserving upgrades from the previously supported 29/37/38-effect layouts. Microphone configuration also uses its own versioned key. If downgrading to an older firmware, first save a startup effect from IDs 1–38: older firmware cannot interpret a saved audio startup mode.

Host tests cover silent and constant input, channel selection, known tone RMS, full-scale arithmetic, gating, envelope decay, render bounds across 1–1024 LEDs, legacy persistence, microphone catalog variants, knob wrapping, and web configuration. Hardware measurements and remaining validation are recorded below when available. Maximum strip length, acoustic sensitivity, and simultaneous radio traffic still require testing on the actual assembly.

## Prototype validation — 2026-09-23

- Built using Arduino ESP32 3.3.11, FastLED 3.10.5 and ESP32RotaryEncoder 1.2.0. Link map confirms the new RMT LED driver alongside standard I2S RX.
- Compiler reports 1,751,848 bytes of program storage after adding USB gain adjustment, within the existing 2,031,616-byte slot, and 48,436 bytes of static RAM; this excludes runtime radio, task, and DMA allocations.
- Backed up all 4 MiB of flash to ignored `.build/coollamp-before-audio.bin`. Verified existing partition layout and OTA selection, then wrote only the selected application slot at `0x200000`. Flash hash verification passed; bootloader, partition table, NVS and bonds were not overwritten.
- Device: ESP32-C3 revision 0.4, USB identity ending `50:B9:AC`, port `/dev/cu.usbmodem80201`. The initial boot reported `installed:false`, no audio buffers running, and 77,788 bytes free heap. USB provisioning enabled the microphone and rebooted successfully.
- Sound glow and Sound meter produced valid changing samples. Across more than 108,000 processed blocks, diagnostics reported zero capture errors and zero receive-queue overruns. The owner confirmed a visible but subtle acoustic response at sensitivity 8.
- In the polled intervals, rendered frame counts increased by 62–63 per second. Maximum recorded render duration in that boot was 10,294 µs. This measures rendering, not acoustic latency or all possible scheduling delays.
- Active capture: approximately 60.3–60.7 KB free heap; at least 3,632 bytes of audio-task stack headroom reported. Switching to Fire stopped capture and recovered free heap to 76,984 bytes. Returning to Sound glow restarted capture with no reported error.
- Host validation passed: 34 JavaScript tests (mobile transport/catalog and firmware packaging); web page checks including microphone configuration; C++ tests for audio analysis, real control availability, persistence/render bounds, encoder behavior, update HTTP framing, update I/O and manifest validation. Address/undefined-behavior sanitizers were used for the applicable C++ suites.
- After the owner reported insufficient sensitivity, flashed the USB tuning enhancement (flash hash verified), raised and saved sensitivity from 8 to 32, and left the lamp on Sound glow with gate 8. The subsequent eight-second check reported changing levels of 139–255, 62–63 rendered frames per second, and zero capture errors or overruns. Perceived response at the new setting still needs owner confirmation. Raise the gate only as needed to suppress room noise.

Not yet verified on this build: full OTA installation while audio is selected, acoustic latency/calibration, maximum-length hardware, and simultaneous active phone/BLE interaction. The updated phone-app source has not been installed on the owner's iPhone in this session.

### Scale slider follow-up

Built and flashed scale support on 2026-09-23 with hash verification. The lamp retained microphone installed, sensitivity 32, and gate 8 from its original `audioV1` settings and reported scale 100 (1×). Sound glow continued at 62–63 frames per second without capture errors or overruns. Program storage is 1,753,082 bytes; static RAM is 48,436 bytes. Host tests verify exact darkness below the scale threshold, unchanged maximum output, monotonic response across every slider setting, request validation, and compatibility with firmware lacking scale support. The updated phone app must be installed separately to use its sliders; the lamp web page exposes the same controls immediately.

### Short-sound visibility and room-noise tuning

Capture now holds each higher audio level for 80 ms before allowing it to fall. This gives the renderer and its attack smoothing time to display brief transients; RMS and peak diagnostics remain instantaneous. Stale or stopped capture still fades to black. Host tests cover expiry, stronger incoming peaks, clock wrap, and a clap arriving between render frames.

A controlled prototype clap test measured background RMS around 39–41 with peaks around 65; transient RMS reached 73 and peak amplitude 403, with no capture errors/overruns. At that noise floor, gain 30, scale 1.20× and gate 32 are proposed starting values, pending acoustic verification. The captured device configuration was actually scale 1.50×, so app slider edits must be saved before evaluating them. Noise gate now uses a slider with a numeric readout, matching sensitivity and scale. Raising the gate suppresses background but can also hide quiet desired audio; the measurements do not identify the source of the background signal.
