# LED setup and effect rotation

These features are included in the unpublished 1.8.0 firmware and matching mobile app. They use the existing wiring and GPIO assignments. App configuration requires a Wi-Fi connection; the encoder operates the LED probe after setup starts.

## Find the last LED

1. Connect to the lamp over Wi-Fi. In **Settings → Advanced settings**, choose **Start LED setup** beside the LED count controls. Leave the lamp group first if it belongs to one; rejoin afterward.
2. A single teal LED lights at the current saved count. Turn the encoder or use the app's ±1 / ±10 buttons or position field to move it toward the data-output end of the strip.
3. If it disappears beyond the end, move back until the final physical LED lights. The displayed position is one-based: position 134 means 134 LEDs.
4. Choose **Save count & restart**, or click the encoder once. Reconnect after the lamp restarts. Network credentials, power limit, startup effect, brightness, and effect settings are preserved.

Double-click the encoder or choose **Cancel setup** to restore the previous count and normal display. Setup also cancels after five minutes without movement, when an update takes ownership, or if the lamp joins a group. A failed save leaves setup active; the probe turns red so you can retry or cancel. Setup temporarily shows the probe even when the lamp was powered off; cancel restores its previous power state.

The probe supports 1–1,024 LEDs, including positions beyond the currently configured count. It allocates a temporary 3,072-byte RGB buffer and points the existing FastLED controller at that buffer, without changing the animation buffers or persistent count. Cancel/save clears the full probe range before restoring the original buffer. Save writes only the count into a copy of the existing settings, then schedules the normal restart. Pending encoder gestures are cleared on entry and exit.

This is a visual measurement, not automatic hardware discovery. A failed LED or a hidden last pixel can make the physical endpoint ambiguous. The separately adjustable effect center is retained; existing geometry code clamps it for shorter strips.

## Effect rotation

On **Light → Effect rotation**, enable automatic rotation and choose:

- **Random** (no immediate repeat) or **Sequential** (catalog order).
- All available effects, light effects only, or audio effects only.
- An interval in seconds or minutes, from **5 seconds to 24 hours**.

Save once; the lamp runs the rotation without the app and remembers the configuration across restarts. Each effect retains its own colors, speed, intensity, and sound tuning. The selected effect runs for a full interval before rotation advances. A manual effect change starts a fresh interval. Disable rotation to keep one effect selected.

Rotation pauses while the lamp is off, in LED setup, showing setup/identification flashes, updating, or displaying a group scene. It waits a fresh interval after these pauses instead of catching up through missed effects. A configured follower never runs its own rotation clock, including while its group connection is unavailable or paused. For synchronized rotation, configure the controller and select **Mirror effects**. The eight spatial group scenes are not part of the rotation pool.

Audio effects are excluded when the local lamp has no configured microphone. Audio-only rotation cannot be enabled without one. If the microphone is later disabled, a saved audio-only rotation stays idle until the configuration changes.

## API and verification

Authenticated, token-protected POST routes:

- `/api/calibration`: `action=start|move|save|cancel`; `move` includes `position=1..1024`. Save restarts the lamp. Start requires independent operation.
- `/api/rotation`: `enabled=0|1`, `random=0|1`, `category=0|1|2` (all/light/audio), `seconds=5..86400`.

`/api/state` includes calibration activity/position and rotation configuration. Older firmware omits those fields, so the app hides the controls. Existing BLE effect IDs and the 47-effect catalog are unchanged.

Host tests exercise actual playback code for persistence failures, timer rollover, effect bounds, microphone gating, group suspension, calibration buffer restoration, cancellation and timeout. Encoder tests cover movement and save/cancel gestures. Mobile transport tests validate both APIs; the browser check covers editing, polling, calibration and narrow layouts. Real-strip confirmation of the final-pixel probe remains necessary before release.
