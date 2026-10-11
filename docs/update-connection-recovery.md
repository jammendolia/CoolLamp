# Wireless update recovery for older lamps

## CoolLamp 2 evidence, 2026-10-11

CoolLamp 2 was connected to USB for read-only diagnosis. Its live identity is
`f0b950b2f180`, and its installed firmware is public **1.13.0**. It remains on
that image: no flash, reset, firmware install, Wi-Fi change, ownership change,
group change or settings save was performed in this diagnosis.

The lamp was associated on its existing channel 6 with strong signal. That did
not make its internet update viable. Fresh USB and authenticated HTTP status
reported update phase 5/error 3, TLS error 32512 (`0x7f00`, the magnitude of
`MBEDTLS_ERR_SSL_ALLOC_FAILED`) and transport error 32791 (`0x8017`,
`ESP_ERR_MBEDTLS_SSL_SETUP_FAILED`). The errors are defined by the actual pinned
Mbed TLS and ESP32-C3 core 3.3.11 headers. Current free heap was approximately
14–20 KiB with largest blocks of 7,668–9,716 bytes. The reported historical
regional minimum sum of 152/188 bytes is not an instantaneous global heap
measurement. The TLS error independently confirms an allocation failure.

Two normal authenticated `/api/state` reads timed out at approximately seven
seconds before response headers. `/api/firmware` and `/api/diagnostics` succeeded
with valid JSON, and diagnostics confirmed the target identity. Initial raw HTTP
files were superseded by a second invocation of the private diagnostic helper;
the first summary remains in the chat tool evidence and the second report/raw
files are retained. The helper now requires unique labels and refuses to
overwrite an existing report. No failing phone response body has been captured.

USB recorded roughly 266 repeated `esp-aes-gcm: No input supplied` messages per
second. Published 1.13.0 source commit
`238c9dd616eb2cce0b13167551374298cbfd7a11` passes null input for authenticated
zero-body mesh challenges and retries failed admission each loop. Current
1.15.1 supplies a nonnull dummy pointer without changing zero length and applies
bounded failed-admission backoff. This defect impairs mesh admission/control;
donation uses a separate packet format with nonempty payloads. It does not
establish failure of the donation receiver or direct Bluetooth updater.

SDK errors interleave inside the old multi-turn USB JSON output. Diagnostic
reconstruction removed only that exact SDK error and its line separators;
original logs are retained privately under ignored `.build`. This reconstruction
does not claim the HTTP or Bluetooth response was similarly corrupted.

The user reproduced **Invalid Bluetooth settings snapshot** in app
**2.0.5 / 55.1**, source commit
`6ff4e81ca9f25fdb444ed218155bcef7f6fd96d1`. The lamp's subsequent Bluetooth
status showed one connection, one authentication, encrypted/bonded status and
three 16-byte state reads. It also showed zero ordinary command writes. A full
snapshot RPC requires those writes, so the observed counters do not prove that
the reported message came from a newly executed snapshot RPC in this exact
session. Preserve that uncertainty instead of attributing every symptom to one
cause. Historical 1.13.0 schema fields pass the strict current parser in a host
fixture; missing optional newer fields are not a confirmed incompatibility.

## Implemented phone recovery contract

An explicit update can acquire a **firmware-only** Bluetooth transport for its
already saved, authorized target. It performs four short protected reads:
binary state, canonical identity, control capability metadata and binary firmware
status. It never downloads the large settings/effect catalog, sends legacy setup
commands, subscribes to state notifications, or starts periodic full-state reads.
Identity, encrypted/bonded authorization, native accessory permission and data
validation remain mandatory. Ordinary connection/settings parsing remains strict.

The restricted lease exposes `supportsBluetoothFirmware`; ordinary control,
groups, Wi-Fi setup, commands and control RPCs are unavailable. It is never
registered in the shared group-control inventory. Direct transfer no longer
requires a separate persistent firmware-fleet enrollment mutation first; normal
explicit fleet provisioning remains available on ordinary authorized connections.
Native initialization considers only the intended lamp, so an unrelated legacy
card cannot block an authorized update target.

The card's task/cancellation guard reaches both newly acquired restricted
connections and reused healthy connections. It fences native cleanup, retrieval,
protected reads, download and every existing sender operation. Late obsolete
reads cannot disconnect a replacement transport. An owner callback failure
fails closed. Owner loss during transfer sends no final commit, cancel to a
changed owner, or alternate-route replay. A missing final acknowledgement keeps
the existing uncertain result and never repeats boot selection.

The existing card updater still refreshes firmware status, requires receiver
firmware 1.11.0 or later, blocks an active update, pins exact manifest/image
identity and rechecks protected target identity after the phone download.
Bluetooth follows a failed Wi-Fi preflight only when failure is explicitly known
to precede installation; an uncertain started installation still requires
reconciliation. Receiver ownership and group-policy gates remain in firmware.
No group membership, pause state or rollout permit is invented by this path.

The initial Wi-Fi check refreshes the target's identity and boot token through
`/api/state` before its first POST. A timeout, malformed read or missing token at
that exact boundary may select the authorized Bluetooth path, which independently
verifies protected identity. Wrong identity, access-password rejection, redirect,
cancellation, stale inventory, and an active updater fail closed. Reads after a
check POST or before install never acquire this fallback permission. This covers
the observed diagnostics-success/state-timeout pattern without replaying a
possibly executed command.

Starting a card or legacy Bluetooth update cancels passive fleet refresh. Later
inventory refreshes exclude its target while continuing reads for other lamps;
the complete inventory remains available to target/route fencing. An already
issued native HTTP GET may still finish, but its cancelled result cannot start
another request or change app state. Explicit update reconciliation retains its
own required reads. A selected Wi-Fi or mesh transport for that same target is
disconnected before private Bluetooth acquisition, fencing its late poll results.
Reconnection after update obtains fresh state; unrelated selected routes remain
available. This does not claim every user-triggered read is suppressed.

## Software validation and pending physical test

Client tests and the production Vite build are recorded against the exact source
export under ignored `.build/coollamp2-update-diagnosis-20261011`. Tests exercise
the production transport, sender, card acquisition handler, native initializer,
Wi-Fi preflight and passive inventory with malformed/unauthorized targets,
cancellation, late responses, unrelated legacy cards, reused-connection owner
loss and lost final acknowledgements. All 125 firmware sources and the frozen
1.15.1 artifacts remain unchanged. No new firmware version is needed for this
phone recovery change.

The change is not installed in the user's 55.1 app. The user authorized a new
TestFlight build. Initial 56.1 passed signing/upload and exact Apple availability
checks, but review found the pre-POST Wi-Fi blocker above, so a corrected successor
is required for this test. Verify the successor's exact source, signed upload,
`VALID` processing, nonexpired status and internal tester availability before
using it. Keep CoolLamp 2 connected to USB only for observation and
leave router/SSID/channel/settings unchanged. Use its card's Update action and
keep the phone unlocked with the app in the foreground. Confirm the short-read
connection reaches the pinned 1.15.1 transfer without settings or fleet RPCs.
Record written-byte progress, exact result, native lifetime/cancellation and
identity/version/control health after restart; never repeat a final commit after
an uncertain outcome. Then exercise a subsequent phone-driven update with the
lamp in place, without USB. Native throughput and complete wireless success are
pending until these steps run on the real phone/lamp.

Pink Corkscrew's last verified installed image is the isolated diagnostic
1.15.1 build, which cannot donate. Its version number alone does not make it a
donor. A separately authorized same-version repair with the standard release is
required, followed by verified fleet trust, receiver opt-in/policy and same-channel
donation acceptance. Do not promise automatic room-wide updates or multi-hop
firmware streaming from control-mesh reach.
