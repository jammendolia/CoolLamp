# CoolLamp firmware 1.15.9 release-candidate receipt

**Status:** unpublished local release candidate. No release tag, GitHub release,
`Latest` pointer, device installation, or public asset has been created.

Firmware 1.15.9 makes the first effect-rotation change visible immediately.
After an enabled rotation configuration is durably saved, a lamp that is
currently eligible advances once and then waits the full configured interval
before advancing again. Re-saving an already-enabled configuration does not
cause another immediate jump. Rotation remains paused while the lamp is off,
updating, pairing, in setup or identification, calibrating, following, or
displaying a group scene. The existing coordinator and compatible-effect rules
remain in force.

## Source provenance

| Item | Commit |
| --- | --- |
| Published 1.15.8 base | `88160728abacd0e816f28164f821b39dcc3a89ac` |
| Immediate-rotation change | `0d72bbd9a2d78af2cc0b8871fa927265ba549b83` |
| 1.15.9 version and release-test alignment | `5cd444b504ddfcd25e9b4bf0616b7a86b055f85b` |

The firmware behavior change is confined to `LampPlayback.ino`. The remaining
candidate changes are the version bump and host/mobile test fixtures aligned to
the already-present 55-effect registry, Sonata style, current TLS allocation,
and updater worker behavior.

## Exact candidate artifact

| Item | Value |
| --- | --- |
| Application image | `firmware/public/CoolLamp.ino.bin` |
| Version | `1.15.9` |
| Image size | 2,027,792 bytes |
| SHA-256 | `2cfcbf84d5da6066fdfdeaf124ecc7a8993c0a0355c56ba7af8c1e02d0f0feb9` |
| Chip/layout | ESP32-C3 / `dual-ota-2031616` |
| OTA slot size | 2,031,616 bytes |
| Image headroom | 3,824 bytes |
| Program sections | 2,027,644 bytes |
| Static RAM | 89,204 bytes |
| Manifest size | 120 bytes |
| Manifest SHA-256 | `58b5eb0dbb46ad1661242712a6225a7b2a6362d82f5df23e7674887a07d8fe95` |

The image has ESP magic `0xe9`, ESP32-C3 chip ID 5, and app-descriptor magic
`0xabcd5432`. It contains exactly one `COOLLAMP-PUBLIC-1.15.9\0` identity
marker. `COOLLAMP-TEST-IMAGE-` and `COOLLAMP-LOCAL-` markers are absent. The
package gate found no configured credential, and an independent readback found
no known home SSID. Manifest identity, version, chip, partition, length, digest,
and terminal newline all match the image.

## Verification

- The complete mobile Node suite passed 1,756 tests.
- The 1.15.8-branch release matrix passed its firmware, factory, TLS, mobile,
  Wi-Fi, Bluetooth, audio, diagnostics, HTTP, update, ESP-NOW, effect, style,
  reset, and page checks.
- The C++ host suite passed under WSL with AddressSanitizer and
  UndefinedBehaviorSanitizer enabled.
- Exact-image ESP-NOW/TLS, Bluetooth-update/TLS, firmware-relay, mesh,
  commissioning, and mesh-adapter checks passed after the public build.
- The 48-command experience-contract gate reports `allPassed=true`.
- The ordinary and preview-startup `tests/check.cjs` paths both passed; the
  preview exposed all 55 registry effects from Pacifica through Cadenza.
- The public package gate accepted the exact artifact and rejected the local
  and diagnostic identities by construction.

The local build used Node 22.19.0, Arduino CLI 1.5.1, ESP32 core 3.3.11,
FastLED 3.10.5, and ESP32RotaryEncoder 1.2.0. Continuous integration pins
Arduino CLI 1.3.1, so this local build is not a claim of exact CI-tool parity.

## Physical evidence and limits

The accepted rotation change was physically exercised on Pink Corkscrew using
the donation-disabled 1.15.8 diagnostic image, 2,027,584 bytes with SHA-256
`87e26d33bd4d947edac4710954f8c0b000c82610726179e889384e8897d3a344`.
Enabling rotation changed Embers to Pacifica immediately and subsequent changes
continued at the configured 30-second cadence. Disabling and saving rotation
stopped further changes. Power, brightness, reconnection, foreground/background
return, and app navigation also passed during that session.

That diagnostic image is not bit-identical to this normal public artifact. It
suppresses firmware donation, while the normal public image may advertise and
donate under the existing trust and eligibility rules. The exact 1.15.9 public
binary has not been installed on a physical lamp, so this receipt does not claim
radio, optical, thermal, live OTA, or long-duration acceptance for that binary.

This candidate does not change partition layout, bootloader, publisher trust,
effect IDs, appearance-record layout, ownership, household isolation, or group
wire formats. The ESP32-C3 OTA margin is only 3,824 bytes and remains a release
constraint.

## Publication gate

Publication requires a separate explicit authorization. Before any release,
the candidate commit and exact artifact must be checked by CI under the routed
`jammendolia` GitHub account. Creating a tag or GitHub release, uploading the
binary or manifest, and changing `Latest` remain deliberately unperformed.
