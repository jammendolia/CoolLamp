# Wi-Fi lamp groups and spatial scenes (firmware 1.8.1)

Mirror mode mirrors one coordinator's effect, brightness, power, colors,
motion settings and audio features onto up to eight followers. Each lamp renders
its own strip and keeps its LED count, center point and current limit. GPIOs and
the PCB design are unchanged. There is no cloud service or ESP-NOW dependency.

## Spatial group scenes

Firmware 1.8.1 expands the eight scenes from 1.8.0 to eighteen, alongside the original 47 mirrored effects.
The ten new scenes require **1.8.1 on every group member**. The packet layout is unchanged;
1.8.0 supports the original eight scenes only. The app reads `sync.sceneCount` and hides
new choices on older controllers. Followers also need updating; the controller cannot verify their renderer version.
Install the matching app and update **every group member to 1.8.1** before testing:
the authenticated UDP packet format is now version 2. Version 1.7.x lamps cannot
synchronize with 1.8.0 lamps. Existing group credentials and membership are retained,
so updated lamps can reconnect without making a new invitation code.

The controller's **Light → Group scenes** pane selects the scene, two colors,
scene brightness, and travel/flow/bloom speed. Audio scenes expose shared sensitivity,
cutoff, and scale on that pane. These are the controller's existing audio settings.
Scene appearance settings are shared between scenes. Choose **Mirror effects**
to return to ordinary effects, or select a normal effect from the library.
Turning the controller's knob to a different effect also exits a scene.
Overall lamp power and brightness still apply.

| Scene | Spatial behavior | Sound |
|---|---|---|
| Portal | A comet climbs one lamp and emerges down the next. | Not required |
| Ping-pong | A light ball bounces through the shared route. Sound accelerates its continuous motion. | Optional |
| Stereo fountain | Odd positions respond to bass; even positions respond to treble, with flowing intensity ripples. This is a frequency split of one microphone, not stereo channels. | Required |
| Duet | Beat accents move between lamps; strong accents light all positions together. | Required |
| Orbit | Two contrasting bands circulate through the ordered group. | Not required |
| Storm front | Flickering strikes travel across the lamps, changing direction between storms. | Not required |
| Ember exchange | Audio flames surround an ember that rises out of one lamp, descends into the next, and bursts on arrival. | Required |
| Color wave | A continuous two-color blend rolls through the group. | Not required |
| Newton’s cradle | A ball falls on the first lamp, transfers along the bases, and rises on the last; the direction reverses. | Not required |
| Conversation | A three-note motif travels from lamp to lamp with varied color replies. | Not required |
| Constellation | Twinkling stars are traced in sequence across the room. | Not required |
| Tidal basin | Normalized water levels transfer a shared volume between lamps. | Not required |
| Firefly courtship | Wandering fireflies answer neighboring flashes, followed by a shared flash. | Not required |
| Rocket relay | A rocket rises on one lamp and explodes on the next, which becomes the next launcher. | Not required |
| Prism split | White light becomes a fixed spectrum and returns to white. Palette controls are hidden for this scene. | Not required |
| Rhythm section | Repeating bass, midrange and treble roles. Two lamps combine mids and treble on the second. | Required |
| Beat chase | Beats advance accents; direction alternates every eight beats and strong beats add an opposite accent. | Required |
| Shared heartbeat | Double pulses gradually converge in time, then spread apart again. | Not required |

**Settings → Lamp groups → Lamp order** provides earlier/later buttons.
The controller starts at position 1 but can be moved anywhere. Newly authenticated
followers are appended; order is saved separately from normal effect settings.
Up to nine positions are supported (one controller and eight followers).
Offline lamps retain their positions so a brief disconnect does not shift everyone
else. Remove an offline position explicitly when a lamp is no longer part of the
installation. A lamp that later rejoins is appended again.

Each lamp maps height from both strip ends to its own configured center. The route
alternates upward/downward across positions. Different strip lengths do not change
travel duration. A scene waits dark until the ordered layout has at least two lamps.
No microphone is needed on followers. Controllers without microphones can select
the non-audio scenes and Ping-pong; required-audio scenes are disabled/rejected.

Scene switches and order changes schedule a common start 300 ms ahead; beat-driven
scenes use a 120 ms event delay. These provide time for packets to arrive, but do not
guarantee simultaneous playback on a congested LAN. Rendering is deterministic for
a given position, shared clock and packet. No per-pixel data is transmitted.

Scene API (existing authentication and mutation token required):
- POST /api/sync/scene: controller-only scene (0–18), speed, intensity and two RGB colors.
- POST /api/sync/order: controller-only comma-separated device IDs; connected members cannot be removed.

## App workflow

1. Connect every lamp to the same home LAN and install firmware with group support.
2. Connect to the desired coordinator over Wi-Fi in the app. For audio effects,
   choose a lamp with a microphone.
3. Open **Settings → Lamp groups → Use this lamp as coordinator**. Copy its group code.
4. Connect to another lamp, open **Settings → Lamp groups**, paste the code and join.
5. Select and tune effects on the coordinator. Followers show a group banner and
   disable effect editing while receiving the shared effect.

Discovery is automatic; membership is opt-in. Nearby coordinators appear in the
panel, including whether they have a microphone. A group code identifies the
coordinator and authorizes membership. It is not a Wi-Fi or lamp access password.
The app doesn't save it in localStorage. On the coordinator, **Show group code**
retrieves it through an authenticated, token-bound request.

**Pause on this lamp** restores its local state while keeping membership. **Resume
following** reconnects. Normal knob interaction also pauses following so local
controls remain useful. Pause lasts until resumed or restarted; membership persists
across restarts. **Leave group** removes membership. The embedded webpage offers
pause, resume and leave controls too. To change coordinators, leave and create/join
a new group; there is no automatic leader election in this version.

## Behavior and limits

- Audio comes from the coordinator's existing analysis and AGC, not from each
  follower's microphone. Followers don't run their audio capture worker while
  following. Microphone-free followers gain the audio catalog while connected,
  without changing their hardware setting. Sensitivity/gate/contrast are adjusted
  on the coordinator.
- Missing audio packets expire after 200 ms and levels fall toward silence.
  Missing group frames for more than three seconds restore the follower's local
  mode, brightness, power and palettes. Reconnection is automatic unless paused.
- Group settings have separate versioned storage. Received frames never write
  effect settings into flash. Failed configuration writes leave the active group
  unchanged. Updates, Wi-Fi setup and Bluetooth pairing suspend sync networking.
- The group shares an animation phase and a clock estimated from request/response
  round trips. Audio and configuration snapshots arrive at 25 Hz; LEDs still render
  locally at their normal frame rate. This is best-effort visual synchronization,
  **not sample-accurate or scheduled simultaneous playback**. Audio is not buffered
  on the coordinator, so followers have network/processing latency. Real two-lamp
  timing and sustained-load measurements remain required.
- Stateful/random legacy effects can differ in individual sparks, trails and heat
  even at the same phase. Different lengths and midpoint settings also deliberately
  produce different pixel maps. This is mirrored playback, not a single virtual
  strip stretched across multiple lamps.
- Discovery uses subnet broadcasts. Internet access is unnecessary, but guest
  isolation, broadcast filtering and separate VLANs can prevent discovery or sync.
  Merely being on the same Wi-Fi name is not sufficient if clients are isolated.
- The bounded peer table supports eight discovered peers and eight followers per
  coordinator. Authenticated members and the chosen coordinator take precedence
  over unrelated discoveries. Larger groups and ESP-NOW are future work.

## Protocol and implementation

`LampSyncProtocol.h` defines a fixed-size, versioned little-endian packet (under
256 bytes). UDP port **49732** carries discovery beacons every two seconds and
unicast subscriptions, clock replies and visual snapshots. The loop processes at
most four inbound packets per pass and has no blocking discovery scans.

Group messages use HMAC-SHA256 with a random 128-bit group secret. Receivers pin the
coordinator ID and validate packet size/version/field ranges, subscription nonce,
coordinator session and increasing sequence number. A fresh handshake is required
after timeout; clock and sequence arithmetic handle 32-bit rollover. Clock samples
with round trips over 200 ms are ignored, and subsequent correction is bounded.
Discovery metadata is unauthenticated and does not itself authorize control. Group
traffic is authenticated, not encrypted. Existing app setup HTTP remains unchanged;
use a trusted local network and treat the group code as a credential.

Files:
- `LampSync.cpp`: discovery, subscription, persistence, authentication, clock and timeout.
- `LampSyncBridge.ino`: transient control/audio/visual overlays.
- `mobile/src/sync.js`, `wifi.js`, `main.js`: codes, API, catalog transitions and group UI.

API (existing lamp access authentication required):
- `GET /api/state`: adds `sync` role (0 independent / 1 coordinator / 2 follower),
  leader ID, paused/active flags, member count and discovery peers. Never returns the secret.
- `POST /api/sync`: `role`, `leader`, `key`, or `action=pause|resume`.
  Mutations require `X-Lamp-Token`. `role=0` leaves and clears saved membership.
- `POST /api/sync/invite`: coordinator-only code retrieval; also token-bound.

## Verification

Host tests cover packet validation, replay/nonce/sequence rejection, rollover,
clock correction, the actual service's handshake, stale audio, reconnect, failed
persistence, update suspension and protection of local effect storage. Transport
and browser checks cover group creation/join/leave, pause/resume, control locking,
old firmware and microphone-free catalog changes. The host transport substitutes
networking and the digest function; the real mbedTLS implementation is checked by
the ESP32 firmware build, not by the host digest stand-in.

Run the portable sync checks:

```sh
c++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined tests/sync.cpp -o /tmp/sync-test
/tmp/sync-test
c++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined -Itests/sync-stubs -Itests/stubs tests/sync-runtime.cpp -o /tmp/sync-runtime-test
/tmp/sync-runtime-test
node --test mobile/tests/*.test.js
```

After building `mobile/dist`, `tools/check-sync-ui.cjs` runs the browser journey
with Playwright and simulated lamp responses; it never contacts hardware.

Before publishing, test two physical lamps with unequal LED counts/midpoints,
a microphone-free follower, coordinator power/effect/palette changes, VU silence,
router loss/rejoin, coordinator reboot, local knob pause and OTA. Check timing and
frame-rate/heap diagnostics under sustained audio and Wi-Fi load. Firmware and app
builds alone cannot establish wireless timing or capacity on the hardware.

## Two-lamp scene acceptance test

1. Install 1.8.0 on both lamps and the matching app; confirm controller/follower status.
2. Arrange the two lamps left to right and set that order on the controller.
3. Select Portal. Verify a comet rises on the first lamp and descends on the second.
4. Reverse the order; verify the route reverses without changing either lamp's midpoint.
5. Try Ping-pong, Orbit, Storm front, and Color wave; vary speed, palette and brightness.
6. Play music near the controller. Try Stereo fountain, Duet, and Ember exchange.
   Sound near the follower alone must not become its independent control input.
7. In silence, the three required-audio scenes should fall dark after their last event.
8. Pause/resume the follower, then power-cycle it. Verify membership and order persist.
9. Select Mirror effects and a normal effect; verify ordinary grouped playback returns.

Automated coverage includes all eight rendering signatures, boundary handoff, band
splitting, beat ownership, silence, 1–1024 LED geometry, clock rollover, position
authentication, failed writes, persisted order, scene API validation, and browser
selection/reordering at 320/393/768px widths. Physical timing/performance on multiple
lamps must still be evaluated after installation; these tests do not measure LAN jitter.


## 1.8.1 verification

The new renderers use only the authenticated shared clock, event counters, audio features,
and lamp position. Local random generators and per-pixel network messages are not used.
Tests cover all eighteen distinct signatures, endpoint handoff, tidal level reversal,
rocket launch/burst ownership, white prism input, beat ownership, invalid/silent audio,
geometry extremes, two/three/nine positions, speed limits, persistence and packet bounds.
The app checks supported IDs and hides fixed-spectrum palette controls. Browser checks
exercise all eighteen selections and phone/tablet layouts. Physical synchronization and
appearance still need testing on actual lamps before publication.
