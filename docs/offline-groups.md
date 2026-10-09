# Bluetooth control, ESP-NOW and the Groups page

## Group-card transport indicator — 2026-10-09

The coordinator supports both Wi-Fi UDP and ESP-NOW in one group. It tracks
subscriptions on each path and sends each follower's scene frames over its
subscribed transport(s); the receive loop services both with bounded work.
An active follower reports the path of its accepted frames in `sync.transport`.
A coordinator reporting `hybrid` means both interfaces are available; an idle
follower's reported available interfaces do not establish an active group link.

The Lamps screen keeps the existing group icon/click target. A verified active
ESP-NOW follower has an amber icon, radio arcs, and a **NOW** badge. Its tooltip
and accessibility label say "Following via ESP-NOW". Wi-Fi UDP followers keep
the purple icon and state "Following via Wi-Fi UDP". Paused/waiting/stale or
unknown transport is neutral with respect to the path. The leader's hybrid
tooltip states that it supports both protocols. The separate Wi-Fi icon continues
to describe AP association and RSSI, so a lamp may show Wi-Fi connected while
its group icon says NOW. No new firmware is required for this card change.


## Development checkpoint — 2026-10-08

Firmware **1.10.0 is a development candidate**. Public OTA remains 1.9.6.
App **1.0 (32.1)** was accepted by Apple through existing macOS CI run
`37814009967`, source `28b81f142f6128638cb90feea388f522f9205336` on
`codex/offline-groups-1.10.0`. The run passed 220 tests, native accessory/address
checks and the signed archive/export; Apple reported `UPLOAD SUCCEEDED with no
errors` at `2026-10-08T17:10:32.0898510Z` (12:10:32 CDT). Evidence:
`.build/ios-testflight-32.1-ci.log`. Phone installation and tester availability
have not been independently queried. App 31.1 is the earlier accepted upload.
The firmware candidate has not been published. The user chose CoolLamp 1 and CoolLamp 2 for
bounded testing over their working Wi-Fi connections.

The initial authenticated, read-only inventory confirmed both lamps on 1.9.6:

| Lamp | Identity | Address | Current group | Preserved startup settings |
| --- | --- | --- | --- | --- |
| CoolLamp 1 | `acb950b2f180` | `192.168.1.154` | Follower of CoolLamp 2; scene 27 active | Effect 43, brightness 215 |
| CoolLamp 2 | `f0b950b2f180` | `192.168.1.222` | Coordinator; scene 27 | Effect 46, brightness 55 |

Both were on, showing mode 46 at brightness 55, with 134 LEDs and midpoint 0.
The sanitized full baseline is private/local in
`.build/hybrid-test-lamps-baseline.json`. Runtime values may change as the user
controls the room; get a fresh baseline before a hardware mutation. GPIOs,
Wi-Fi credentials, per-lamp defaults, geometry, NVS layout, group key/order,
existing effect IDs and the UDP wire version remain preserved.

## User-facing behavior

The top-level **Groups** page lists verified coordinators with their followers,
independent lamps and lamps that cannot currently be reached. It does not
require opening a coordinator or changing the selected lamp. Reads are
asynchronous and bounded; progress and failures belong to individual lamps.

An independent lamp can create a group or join a verified coordinator. A
follower can pause/resume, leave, or move to another group. A lamp has one role
and one group at a time; a coordinator cannot silently become a follower.
Group effects, palette, order and microphone controls operate through that
group's coordinator. Explicit buttons/selectors also work without dragging.

Moving preflights the destination before leaving. The app then verifies the
target's independent state and its new membership. If joining fails after
leaving, it reports that partial result and leaves the lamp independent.
It does not replay an uncertain mutation or silently rejoin the old group.
An unavailable leader remains a clearly marked placeholder; stale membership
is not presented as a live discovery. Legacy saved Bluetooth entries need one
explicit connection to establish their canonical hardware identity.

## Transport and authorization

UDP discovery/control remains available. ESP-NOW adds direct discovery and
group synchronization without requiring AP association. A live Wi-Fi
association owns the radio channel even before DHCP; otherwise coordinators
anchor a channel and followers seek their saved coordinator. Wi-Fi, Bluetooth
and ESP-NOW share one 2.4 GHz radio. ESP-NOW does not remove enclosure/antenna
limitations or guarantee a range in the finished lamp.

Native ESP-NOW encryption has insufficient peer capacity for the existing
nine-lamp group limit in this SDK. Unicast group traffic therefore uses
application **AES-128-GCM** with per-peer keys derived from the group secret
and canonical sender/destination identities. The nonce includes sender session
and sequence. Public discovery advertisements contain no credentials or group
keys and cannot authorize joining. Existing group HMAC, identity, session,
subscription, replay, clock and pause checks still apply. The radio envelope
fits the legacy 250-byte ESP-NOW payload limit.

Radio callbacks copy bounded data only. The Arduino loop handles crypto,
configuration and group state. Short scans and bounded AP recovery probes
retain the existing visual holdover. Full update/setup/pairing ownership
releases group resources. Offline groups periodically retry saved Wi-Fi;
credentials and the saved transmit-power profile are not changed. Completing
a Wi-Fi scan leaves STA enabled even on an unconfigured lamp.

Bluetooth's existing UUIDs and short commands remain compatible. A new
encrypted read characteristic (`7b61000a-6e2b-4f3d-9a71-28e45c001001`)
supports versioned, paged commands to the same loop handlers used by HTTP.
The new RPC requires a live encrypted, bonded connection. It uses at most
20-byte writes, a 1,024-byte request and 8,192-byte response limit, transaction
and connection-generation fences, and a consumed-once commit. Response pages
are immutable. Disconnect, authorization loss, timeout and update ownership
wipe/free transfer data. HTTP cannot activate the trusted Bluetooth context;
its normal Basic authentication and mutation-token checks remain in force.

An offline join uses a private invitation through a separately authorized
Bluetooth link to the coordinator. The selected target remains connected.
Unknown coordinators require the existing six-second physical pairing step.
The app never puts invitations into ordinary snapshots, the DOM, storage or
the clipboard. Read-only discovery cannot release a key.

## Validation and remaining work

The final Windows production build and credential/public-image packaging
checks passed: image **1,860,176 bytes**, SHA-256
`760801be25f843106cf909f26af160116f1347cba6c25de3390e5120cdbbf935`.
Program usage is 1,860,024 bytes and globals are 61,604 bytes. Review fixed two
Wi-Fi restoration paths and freed decoded RPC field allocations before TLS;
the relevant runtime checks passed. Host suites cover real pinned Mbed TLS AES-GCM,
the radio queues/channel behavior, eight encrypted followers, old UDP behavior,
BLE authorization/transfer lifetime, shared HTTP handlers, saved settings and
Wi-Fi restoration. The mobile suite includes transport and global membership
tests; mocked production UI checks exercise groups without selecting a lamp.

Final app validation passed **220/220 mobile tests**, including 27 Groups
backend cases, plus the Vite production build. Mocked UI checks cover full
offline settings, auxiliary authorization, multiple groups, join/move/leave,
honest partial moves, coordinator removal during a pending connection/editor,
legacy iPhone authorization ordering, navigation during requests and selected
lamp/catalog isolation. Eight HTTP UI scenarios cover 1.9.6 compatibility,
custom passwords, uncertain responses and global editing without selecting a
lamp. Background inventory arrivals preserve destination/focus drafts. Preview
screenshots are private/local under `.build/ui-check/global-groups-*.png`.
Auxiliary protected reads use a five-second timeout. Command acknowledgment
deadlines begin after the native queued write completes, retaining early
acknowledgments and avoiding false timeouts or replay while other lamps connect.

A live **GET-only** check using the actual new Groups model and Wi-Fi transport
verified CoolLamp 2 as leader and CoolLamp 1 as follower without a selected
lamp, on their existing 1.9.6 firmware. Six state/catalog GETs were made; all
mutations were explicitly blocked. The public snapshot contained no tokens,
keys or invitations. Evidence: `.build/global-groups-live-readonly.json`.

One guarded local OTA upload to CoolLamp 1 returned curl error 52 / empty
server reply. Fresh readback confirmed 1.9.6 still running, continued uptime,
no differences in the saved settings compared, and active following of
CoolLamp 2. The upload was not replayed and CoolLamp 2 was not uploaded.
Private evidence: `.build/ota-hybrid-1.10.0-192.168.1.154.json`. The same local
upload failure had occurred in the earlier 1.9.4 bootstrap investigation;
working update checks do not prove this upload path. USB access to CoolLamp 1
has been requested to unblock physical candidate validation.

Builds and mocks do not establish physical ESP-NOW/Bluetooth coexistence,
offline synchronization, enclosure range or phone acceptance. These remain
bounded hardware checks on the chosen pair. No router configuration change is
part of this work. Same-IoT forwarding, earlier blackout/thermal behavior and
the missing raw Mac diagnostics/prototype binaries remain separate gaps.

Before publication, retain a verified image/manifest, final source reference,
test evidence and a fresh test-lamp state snapshot. Use the existing macOS CI
workflow for iOS. All GitHub actions must use personal `jammendolia`; never the
HiFin account. Preserve the original working tree and commit scoped changes
from the existing isolated release checkout.

## Successful CI draft — 2026-10-08

Firmware CI run **37814005688** succeeded on the same source as app 32.1,
`28b81f142f6128638cb90feea388f522f9205336`. Linux validation retained
ASan/UBSan, including the real pinned Mbed TLS radio suites after the production
build. The resulting **1.10.0 release remains a draft**, not public Latest;
the verified public Latest is still `firmware-v1.9.6`.

The downloaded CI application is **1,859,792 bytes**, SHA-256
`30eb2a3a603e4590576086c31793ab3415d9221773da308b4b461ff041a62813`.
Program usage is 1,859,640 bytes and globals are 61,604 bytes. Remaining OTA
image space is 171,824 bytes. Manifest regeneration, C3/OTA layout, public
marker, local-credential exclusion and GitHub asset-digest checks passed.
Evidence: `.build/firmware-1.10.0-ci.log`,
`.build/firmware-1.10.0-ci-assets/verification.json` and
`.build/hybrid-1.10.0-development-record.json`.

Use the verified **CI asset** for the next physical candidate installation,
after identifying/backing up CoolLamp 1 and capturing fresh settings. The
different earlier Windows image is retained privately for provenance; its one
OTA upload failed. Neither test lamp has been confirmed running 1.10.0.
Phone/physical Bluetooth authorization, ESP-NOW coordination with and without
AP association, recovery and enclosure behavior remain acceptance checks.
