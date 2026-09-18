# Effects introduced in firmware 1.3.0

Names below use the current helix-aware labels.

| Effect | Motion |
| --- | --- |
| Bouncing droplets - rising | Colored drops rise from both ends at the base and bounce near the strip midpoint at the top. |
| Lightning storm | A dim background with scattered, soft-edged strikes. |
| Color tide | Two colors swell upward from both sides of the base, then recede. |
| Fireflies | Small drifting lights brighten and fade independently. |
| Heartbeat | Paired pulses fall from the strip midpoint at the top toward both ends at the base. |
| Shooting stars | Alternating stars cross the full strip with fading tails, rising up one side and falling down the other. |
| Breathing glow | The whole lamp slowly fades and blends between colors. |
| Lava blobs | Broad overlapping blobs drift through the lamp. |

All 37 effects have separate saved color and option slots. The second color is
optional. Speed ranges from roughly 0.14x to 4x, with 50 at 1x. Intensity scales
final output independently of global brightness and controls density in
droplets/fireflies/stars and frequency in lightning. Original animation frames
are restored after tinting/dimming so trails do not fade repeatedly. Animation
time is separate from button, Wi-Fi, Bluetooth and updater timers. No per-frame
memory allocation is required.

Lightning uses a smooth strike envelope. At normal speed strikes recur every
6–10 seconds. Custom solid remains mode 29; new modes append 30–37. Original
split-fire direction and palette behavior remain unchanged unless the user
explicitly applies a custom color.

## Storage and compatibility

The version-1 `colors` blob expands from 117 to 149 bytes. Loading the old size
preserves all 29 slots and supplies defaults for eight new slots. The separate
version-1 `effectOptions` blob is 223 bytes: schema followed by 37 entries of
speed, intensity, dual-color flag, secondary R, G, B. Invalid entries fall back to
defaults. Failed writes remain dirty for retry. Wi-Fi/password storage is unchanged.

BLE capability bit 3 advertises the new controls. Each connection starts with the
29-effect catalog and existing 16-byte state packet. Operation 12 with value 1
opts into 37 modes for that connection. When a new effect is active, the older
color app displays Custom solid as a fallback; it cannot identify or customize
new effects. The very first 12-byte-only app still needs updating, as before.

Encrypted read/notify characteristic `7b610005-6e2b-4f3d-9a71-28e45c001001`
contains eight bytes: schema 1, actual mode, speed, intensity, dual flag, secondary
R, G, B. Operation 11 uses ten bytes: schema 1, request ID, operation 11, mode,
speed, intensity, dual flag, secondary R, G, B. Both fit the minimum BLE MTU.
Operation 7 restores all defaults for its effect; operation 4 saves all slots.
Negotiation and state refresh remain allowed during firmware installation.

REST state includes `effectOptions`. Authenticated, token-protected POST
`/api/effect-options` accepts mode, speed, intensity, dual, r, g, b.

## Verification

- `node --test mobile/tests/transport.test.js tests/firmware-release.test.cjs`
- `node tests/check.cjs`, `node tests/wifi-page.cjs`, `node tests/update-page.cjs`
- Compile/run `tests/effects.cpp` with C++17, `-Itests/stubs`, warnings as errors,
  and AddressSanitizer/UndefinedBehaviorSanitizer.
- ESP32-C3 firmware compilation and mobile production build/Capacitor sync.

The host effect test uses RGB/sine stand-ins with the actual firmware renderers.
It checks bounds, motion, black, clock wrap and old preset migration; it does not
establish physical appearance, radio behavior, or native phone installation.
Those require a lamp and device after deployment.
