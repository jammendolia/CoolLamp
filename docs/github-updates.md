# GitHub-delivered updates (planned)

Repository: https://github.com/jammendolia/CoolLamp

This is a roadmap, not an implemented capability. Current firmware supports authenticated application uploads through the local web page. It does not check GitHub or download updates automatically.

## Intended experience

1. Publish a versioned ESP32-C3 application binary and signed update manifest as GitHub Release assets.
2. A lamp connected to home Wi-Fi periodically checks for a compatible newer version, with backoff and randomized timing.
3. The lamp signals an available update using a gentle, configurable indicator and a notice on the setup page.
4. Download, verify, and install the release through the inactive OTA slot. Make automatic installation an explicit setting, with a sensible idle-time policy; manual installation stays available.
5. Reboot into the new version, confirm that it is healthy, and retain a recovery path if boot fails. Do not repeatedly retry a bad release.

## Required groundwork before publishing binaries

- Remove per-lamp initial passwords from distributable firmware. Current builds embed LampSecrets.h; the local firmware directory must not be uploaded or attached to a public release.
- Move initial provisioning to a device-specific process, keeping Wi-Fi and access credentials in device storage across updates. Do not ship a universal setup password or embed a GitHub token.
- Add a firmware version, stable effect/settings identifiers, and explicit settings-schema migrations. Reordering numeric mode IDs must not silently change a saved startup effect.
- Include version, board/chip target, minimum bootloader/partition requirements, image size, download URL, and SHA-256 in a signed manifest. A hash alone is not proof of publisher authenticity.
- Verify HTTPS certificates and the manifest signature using a trusted public key embedded in the firmware. Keep the signing private key in protected release infrastructure and define key rotation.
- Pin build tools and dependencies. Test artifacts before signing and publishing. Publish the application .ino.bin, not a merged flash image, for OTA.
- Plan the partition layout now: current application size is approximately 1.22 MB in a 1.31 MB OTA slot. A larger dual-slot layout may need a one-time USB upgrade before adding the updater.
- Validate interrupted downloads, wrong-chip images, invalid signatures, oversized images, loss of power, failed health checks, and downgrade policy. Boot rollback must be enabled and tested; the current manual updater does not yet implement post-boot health rollback.
- Keep update traffic and status indicators from blocking the knob, button, or normal effects. Avoid signaling updates while the lamp is switched off unless the owner enables it.

No release workflow or public firmware assets are enabled until provisioning and authenticity checks are implemented.
