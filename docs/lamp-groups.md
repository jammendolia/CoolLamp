# Wi-Fi lamp groups (firmware 1.7.0)

This first version mirrors one coordinator's effect, brightness, power, colors,
motion settings and audio features onto up to eight followers. Each lamp renders
its own strip and keeps its LED count, center point and current limit. GPIOs and
the PCB design are unchanged. There is no cloud service or ESP-NOW dependency.

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
