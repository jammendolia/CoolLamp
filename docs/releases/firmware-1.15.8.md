# CoolLamp firmware 1.15.8 release receipt

Firmware 1.15.8 repairs group-scene changes on memory-constrained ESP32-C3
coordinators. A fixed-size group scene record no longer waits behind the general
24 KiB mutation admission floor. The scene endpoint instead reserves a separate
2 KiB persistence workspace while all larger configuration, power and firmware
mutations retain the existing conservative gate.

## Immutable artifact

| Item | Value |
| --- | --- |
| Application image | `CoolLamp.ino.bin` |
| Version | `1.15.8` |
| Image size | 2,027,536 bytes |
| SHA-256 | `ac3c86cb616a764cbe4ce91ebb64dd31c04322934dfeb35f35eb8c5d6a3f8a72` |
| Chip/layout | ESP32-C3 / `dual-ota-2031616` |
| OTA slot size | 2,031,616 bytes |
| Image headroom | 4,080 bytes |
| Program sections | 2,027,396 bytes |
| Static RAM | 89,204 bytes |

The public build and package helpers rejected device-specific credentials and
produced the canonical OTA-1 manifest for this exact image.

## Verification

- Direct HTTP, trusted mesh, protected Bluetooth and the shared control adapter
  pass the compact-scene regression at the observed 23,388-byte free-heap /
  9,204-byte largest-block profile.
- Below the scene-specific heap or contiguous-block floor, the request returns a
  confirmed 503 before execution. Ordinary durable mutations retain the legacy
  24 KiB admission policy, and denied commands are not replayed.
- An isolated checkout rebuilt the same 2,027,536-byte image. Its 71 differing
  bytes were confined to six ASCII compile-time digits and the ESP image's
  derived header/trailer digests; executable and other data bytes matched.
- The exact published image was installed through the authenticated ticketed
  browser/computer OTA path on the Sonata coordinator and follower. Both
  restarted on new boot nonces and reported healthy 1.15.8, exact installed
  size and SHA-256, with group identity, order and settings retained.
- A live mirror-scene save returned HTTP 200 (`Group scene saved.`). Both lamps
  then converged on effect 45 while the follower reported active under the same
  coordinator and both members reported online.

The physical validation covers the two Sonata lamps used for this repair. It
does not replace separate optical, power or interoperability acceptance on every
other lamp style. The live effect was restored without overwriting the saved
startup effect.
