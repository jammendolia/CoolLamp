# Firmware task: keep lamp animations running during connection attempts

Implement this in the existing CoolLamp firmware work, preserving that worker's current changes and release procedure.

## Incident and verified findings

The user just commissioned Pink Corkscrew, named it and configured Wi-Fi, on firmware **1.15.0**. Opening Settings → Lamp Designs to change its LED count left the app connecting for roughly its 25-second deadline. The active lamp animation froze during the attempt, resumed afterward, and the app reported a connection timeout. The exact transport and cause of that incident have not been captured; do not claim a confirmed reproduction yet.

A read-only source audit found a concrete rendering-stall risk:

- `CoolLamp.ino` calls `serviceLampNetwork()` before rendering (line 172 in the audited source).
- `LampNetwork.ino` calls synchronous `lampServer.handleClient()` on that loop (line 951).
- Installed ESP32 Arduino core 3.3.11 sets a 5-second client timeout in `WebServer.cpp`. Its parser calls blocking `readStringUntil()` for request lines and headers. Incomplete or trickling requests can spend multiple waits on the rendering loop, without a total request deadline.
- `NetworkClient::write()` retries synchronous sends with 1-second select waits, up to 10 retries; partial progress can reset the retry count. A stalled response reader can also block rendering.
- `maxRenderUs` starts after network service, so it excludes these stalls.
- Cached BLE reads and normal state/effects/firmware reads do not deliberately stop playback. Investigate any additional radio, control-response or allocation delays rather than assuming HTTP is the only cause.

The app fix reduces pressure: reuse the verified current connection; prefer the paired target Bluetooth route when Wi-Fi has no fresh healthy evidence; try both direct target routes before bounded mesh recovery; use a read-only modern Bluetooth reconnect without duplicate legacy catalog downloads; never provision other lamps while opening settings. Coordinate with this behavior without depending on the phone always being well behaved.

## Required implementation

1. Reproduce the freeze while an animated effect runs. Test partial/trickled request lines and headers, stalled request bodies, response peers that stop reading, abrupt disconnects, and normal phone reconnect/status/catalog traffic. Record the actual affected transport and maximum gap between rendered frames.
2. Remove unbounded HTTP parsing and transmission from the rendering loop. Choose bounded incremental I/O or a bounded I/O task that queues mutations and serves immutable cached read snapshots. Keep one owner for FastLED, mutable lamp state, and NVS. Do not simply move existing mutable handlers to another task or reduce one timeout while leaving other blocking reads/writes.
3. Enforce explicit request/header/body size limits, a total connection/request deadline, bounded work per loop/service turn, cleanup of abandoned clients, and fair service for several clients. A slow phone must not pause animation or block another client indefinitely. Check the implementation against the actual core 3.3.11 APIs and ESP32-C3 memory/radio constraints.
4. State, catalog, descriptor and firmware-status reads must be side-effect free: no Wi-Fi scans, radio reconfiguration, provisioning, calibration, update mode or effect pause. Audit BLE control GET paging as well. Preserve authentication, tokens, device identity checks, transaction/receipt semantics, update ownership and legacy API compatibility. Never replay an uncertain mutation.
5. Add privacy-safe maximum frame-gap/loop-service and HTTP stall metrics that include networking time. Keep credentials, fleet keys, pairing material, SSIDs and request bodies out of logs. Define and justify a bounded frame-gap target, then measure it on physical hardware.
6. Preserve all effect semantics, adjustable LED count including odd counts, brightness/power/startup state, saved Wi-Fi and NVS. Preserve the hidden update-only renderer: show it only on the actively updating lamp and only if that lamp was on when updating began; never include it in the user effect catalog.

## Acceptance and release

Add meaningful host checks for bounded parsing/send work, deadlines, cancellation, limits and queued command ownership. Verify normal authentication, state/catalog queries, LED count changes, guided calibration, BLE reconnects, mesh, group control and OTA still work. Exercise one lamp and a fleet of at least 20, with degraded Wi-Fi and multiple clients. Run the firmware build and applicable existing tests.

Hardware validation must show the animation remains responsive during the reproduced connection failures. Report firmware version, tested route, maximum measured frame gap, and remaining limitations. Host tests/build success alone are not physical phone/lamp validation. Follow the existing firmware worker's signing, backup, flash and publication procedure; do not overwrite another worker's changes or publish a claimed fix without the corresponding evidence.
