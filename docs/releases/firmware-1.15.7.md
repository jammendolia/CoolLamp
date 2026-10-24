# CoolLamp 1.15.7 — Edison

Adds Edison as physical style code 4 with its own bulb-and-coils artwork and
five standalone effects: Filament (48), Eureka (49), Orbit (50), Induction (51)
and Sound Filament (52). Existing effect IDs, names and ordering 1–47 remain
unchanged. Sound Filament requires the installed and enabled microphone.

The new effects require a readable factory `edison-v1` record, Edison style,
222 LEDs, midpoint 81 and independent playback. Different calibration, other
models and group playback explicitly exclude them. Normal OTA never provisions
a model or overwrites calibrated hardware. See [Edison measurements and effects](../edison-lamp.md).

Edison-specific effects cannot be selected as startup effects in this release:
the older startup record accepts IDs 1–47. Their appearance settings can be saved
independently. Joining a group while one is selected requires selecting a
compatible effect first; leaving a group remains permitted.

The accompanying TestFlight update adds the taller/wider Edison icon, five
effect descriptions and actual controls, device-catalog availability filtering,
and factory-design setup guards. A finished lamp's design is shown read-only;
calibration remains separate. Unknown model IDs are retained with generic art.
Published help, tours, native Bluetooth transfer and route behavior are retained.

The firmware source starts from published 1.15.6; the app starts from TestFlight
2.0.5 (75.1). Unpublished updater-memory, TLS and bridge work is excluded.
The pinned ESP32-C3/Arduino 3.3.11 dual-OTA layout remains unchanged, with
2,031,616 bytes per application slot. Only a normal `--public` build may be
published, paired with its exact OTA-1 manifest. Diagnostic images are excluded.

The existing HTTPS/SHA-256 and household donation trust policy is unchanged.
Publisher keys are not provisioned, and no new signing or bootloader rollback
guarantee is claimed. This release does not establish twenty-lamp RF, native
Android or sustained thermal acceptance.

The original single-lamp trial passed all five visual effects, physical knob
selection and microphone response. Final normal-image resource measurements,
canary results, asset hashes and exact Apple processing status belong in the
publication receipt; host success alone is not physical phone validation.
