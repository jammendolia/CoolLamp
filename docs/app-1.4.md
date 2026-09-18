# App and discovery foundation

## Scope

The app now has My lamps, Light, and Settings screens. It saves multiple lamps,
names, rooms, and favorite effects. Wi-Fi uses the existing authenticated HTTP
API; Bluetooth remains available, including on firmware before 1.4.0. The setup
webpage and three/six-second knob gestures remain available.

Firmware 1.4.0 advertises `_coollamp._tcp` alongside the existing HTTP service.
TXT records contain a stable 12-character chip identifier, name, and API version.
The same identifier is exposed through a protected BLE characteristic ending
in `0006`. Old phones can ignore it. Names use a separate NVS key, preserving
the existing settings structure. Discovery metadata grants no authorization.

The app prefers a discovered Wi-Fi address for the last selected saved lamp.
Selecting another lamp disconnects the previous transport. A saved Bluetooth
connection is a fallback when Wi-Fi control fails. Commands are never replayed
after uncertain delivery. Separate lamps still require separate access passwords.

## Compatibility and limits

- Firmware before 1.4.0: manual local-address entry and Bluetooth work; automatic
  discovery, shared identity, persistent names, and white identification flash
  require the new firmware. A legacy BLE record is merged on reconnection once
  the shared identity becomes available.
- Wi-Fi configuration, strip settings, access-password changes, pairing
  management, and naming use Wi-Fi. Initial provisioning can use the lamp's
  hotspot from within the app. Wi-Fi provisioning over BLE is a later addition.
- HTTP remains local and password-authenticated, with the existing per-boot
  mutation token. It is not encrypted on the LAN. Native requests disable
  redirects. The app accepts only local IPv4 addresses and `.local` names.
- Passwords use iOS Keychain or Android Keystore-backed AES-GCM storage.
  Metadata stays in local storage. Android app backup is disabled for the vault.
- Bonjour uses declared service browsing, not raw multicast. iOS needs Local
  Network permission. Android targets SDK 36 using NSD; revisit local-network
  permission handling before targeting SDK 37.
- Guest networks, client isolation, and separate VLANs can block discovery.
  Manual address entry and Bluetooth remain available. Native discovery and
  native HTTP require a device build; the ordinary browser preview is for UI QA.
- Rooms and favorite effects are phone-local. Group commands, saved scenes,
  BLE provisioning, and voice-assistant integration are subsequent work.
- File-based recovery uploads remain on the setup webpage; normal online
  firmware updates are available in the app.

## Design

Uses UrbanVibez's MIT-licensed Sleek design skill for an eight-point spacing
rhythm, reusable semantic tokens, explicit states, and accessible controls.
Applies Darkside's principles of low cognitive load, clear hierarchy, plain
language, and progressive disclosure. CoolLamp retains its own dark surfaces
and light-inspired accent instead of copying either project's branding.

Primary controls have 44–48 px minimum targets, visible keyboard focus, labeled
inputs, and status text that does not rely on color alone. Reduced-motion
preferences disable transitions. Effects support search, categories, and
favorites; advanced setup is collapsed on a separate screen.

## Validation

Run `node --test mobile/tests/*.test.js`, `pnpm --dir mobile build`, and the
existing firmware/page regression tests. Build firmware with
`node tools/build-firmware.cjs --public` to retain radio-memory linker wrappers.
Unsigned iOS and debug Android build workflows are available separately from
TestFlight and firmware publication.

Hardware acceptance before release: discover two lamps, rename and identify
each, reconnect after IP changes and app restart, deny/regrant local-network
permission, switch Wi-Fi/BLE without duplicates, change Wi-Fi through the app,
verify credentials after a password change, and run OTA with BLE and Wi-Fi
active while checking minimum free heap and largest block. Compilation does
not replace these radio/device checks.

### Development checks completed

- Public firmware compiled: 1,721,174 bytes, leaving 310,442 bytes per OTA slot.
  This is 4,438 bytes larger than 1.3.5. Runtime free heap is not yet measured on
  the new firmware.
- 27 combined mobile/manifest tests passed, plus existing effect, webpage, and
  update-page checks. Tests cover identity migration, uncertain writes, late
  responses, token binding, power preservation, and BLE compatibility.
- Native iOS and Android compilation passed in Actions run 35389663819.
  Subsequent UI and JavaScript-only refinements passed the local production
  build and tests; native plugin sources are unchanged from that successful run.
- Browser review used an isolated simulated lamp, including saved-lamp
  reconnect, favorites filtering, power control, and advanced settings layout.
  The simulation is not part of either native app's bundled assets.
- These changes have not been released to TestFlight or installed on hardware.
