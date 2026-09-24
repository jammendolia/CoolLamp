# Effect settings studio

The active effect now owns a compact settings card on the Light page. The effect chooser sits immediately above it and closes after selection. Settings follow changes from the app or the lamp's knob.

- **Light:** shared lamp brightness, primary color, a custom two-color palette when enabled, and reset to effect defaults.
- **Motion:** the effect's supported speed and intensity controls. Labels reflect actual firmware behavior: flame speed, fall speed, pulse/ripple travel, response decay, or density/activity and glow. Solid colors omit this tab. Older firmware without effect options also omits it.
- **Sound:** sensitivity, quiet cutoff (noise gate), and contrast (scale factor). Shared across all audio effects, shown only for audio effects, and selected initially when entering one. Unapplied edits survive effect changes and polling within a connection. The Apply button explicitly saves them for all audio effects.

Audio hardware provisioning remains under **Settings → Wi-Fi & advanced settings → Microphone hardware**. It contains only the installed switch, preserves saved tuning, and restarts to refresh the effect catalog. Wi-Fi, strip geometry, power limits, and other device-level settings remain in their existing sections.

Colors, speed, and effect glow use the existing per-effect settings. Brightness remains lamp-wide; the UI labels that scope. The startup-save action persists the effect settings through restart. Shared audio tuning saves separately. Automatic spectrum palettes are described explicitly; choosing a primary color unlocks a custom palette.

Firmware 1.6.1 advertises `audio.liveTuning`. Authenticated, token-protected `POST /api/audio/tuning` validates gain 1–64, gate 0–1024, and scale 100–400, stops the capture worker before changing its configuration, saves settings, and resumes capture through the normal service loop. It does not reboot or change microphone presence. Tuning is blocked during firmware updates. Older firmware uses the original save-and-restart endpoint with an explicit message. Audio tuning still requires Wi-Fi; Bluetooth supports normal effect controls and displays that limitation in Sound.

Visual design uses graphite surfaces, warm light-green accents, lavender audio accents, large touch targets, numeric slider readouts, restrained light-strip artwork, and persistent bottom navigation with safe-area spacing. Effect tabs support arrow/Home/End keyboard navigation, visible focus, and reduced-motion preferences. The layout was checked at 320, 393, and 768 pixels with no horizontal overflow.

Validation: unit tests cover effect-family mapping, relocated/reordered catalog IDs, solid/unknown effects, authenticated live tuning and old-firmware fallback. `tools/check-effect-panes.cjs` drives the actual built app against a simulated lamp, checking dirty edits through polling, effect switching, live saves, effect-specific writes, hardware-only advanced audio controls, narrow layouts, keyboard tabs and older firmware. The browser test is optional and requires Playwright; install it separately and run from the repository root after building the app. Screenshots are written under ignored `.build/ui-check/`. Real iPhone rendering still needs a TestFlight check.
