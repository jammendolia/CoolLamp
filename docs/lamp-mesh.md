# Lamp control and newcomer setup through ESP-NOW

Firmware 1.13.0 adds control forwarding and new-lamp enrollment to the
existing owner-fleet firmware relay. It is published as public Latest for OTA.
Installation and physical mesh acceptance are not yet verified. Wi-Fi control, Bluetooth control,
Wi-Fi OTA and Bluetooth firmware transfer remain available.

## Controlling an owned lamp

An owned lamp announces its identity, name, firmware, boot session and Wi-Fi
association to its authenticated fleet. Each lamp keeps a bounded presence
table. The app uses a reachable saved lamp as a bridge when the selected target
cannot be reached directly. The bridge carries requests and replies over an
authenticated ESP-NOW flood, with at most four radio hops and sixteen peers.
Group membership is separate: owned lamps in different groups can relay control.

Only the addressed target executes a request. A relay receipt cannot report
success. The app waits for the target's authenticated execution receipt and
complete response, checks the exact target and request identifiers, and reloads
that target's state and effect catalog. A target validation error is a confirmed
response with its original HTTP status and message. A missing acknowledgment,
lost retained response, interrupted radio or changed boot session leaves an
uncertain result. The app neither repeats that mutation nor silently connects
to the target over Bluetooth. It offers Bluetooth as the next explicit action.

Radio packets have bounded size, lifetime, retry count, fragmentation and replay
windows. Requests are limited to 1,024 bytes and responses to 8,192 bytes.
Credentials in temporary requests and replies are erased before buffers are
freed. Loop-owned services dispatch all commands; radio callbacks only copy
bounded packets. Normal effects and group roles do not change during discovery.

Mesh control permits ordinary lamp, effect, group, geometry, audio, name, style
and Wi-Fi configuration commands. Firmware installation, factory reset, phone
bond removal and fleet-credential replacement require their existing direct
paths. ESP-NOW firmware donation remains a separate verified transfer service;
this control mesh does not tunnel arbitrary firmware bytes.

## A newly powered lamp

A lamp with no owner fleet, saved Wi-Fi, bonded phone or group advertises itself
as a setup candidate. Active pairing, hotspot, scan, calibration, reset and
update operations suppress enrollment. An existing owned lamp reports nearby
candidates to the app. The Lamps page displays **A new lamp has been detected!**
with a setup action; announcements cannot select a lamp, create a saved card or
grant control by themselves.

Setup first binds the new lamp, broker, boot sessions and request identifier.
Both devices commit to fresh P-256 public keys and random nonces before revealing
them. ECDH and HKDF derive direction-specific encrypted traffic keys and a
four-color confirmation sequence. The app shows the sequence and the new lamp
flashes it. The owner compares the sequence, then clicks the new lamp's knob
once. Remote requests cannot approve that step. A press begun before the cue,
rotation, multiple clicks or a long hold cannot grant approval or change power,
effects, pairing, group state or settings during the cue.

After physical approval, the broker transfers the fleet credential encrypted.
The new lamp persists it and sends a possession confirmation. Existing different
trust is never overwritten. Enrollment times out after two minutes. Cancellation
after a credential commit may be uncertain; recovery checks the original session
or current authenticated fleet presence instead of repeating the commit.

Only then does the app save a card and open guided settings for name, physical
style, LED count, power limit, microphone, power and optional Wi-Fi. These settings
travel through the mesh. Hardware and Wi-Fi changes restart the lamp. Individual
setting writes are sequential, not one crash-atomic transaction. If a save fails,
previously confirmed changes may remain; uncertain writes are not automatically
repeated. Microphone and general settings retain explicit rollback/error handling
for storage failures. Configuration never changes GPIO assignments.

The owner phone keeps its fleet credential in the existing native credential
vault. A saved, already-paired 1.13.0 bridge with no fleet credential can establish
trust through that known Bluetooth pairing in the background. This does not
select it on startup or connect directly to the newcomer. On iOS it requires a
previously authorized saved accessory; otherwise its card explains the one-time
Bluetooth enable step. A different fleet is preserved. A single-lamp owner can
still use ordinary Bluetooth or Wi-Fi setup.

## Radio and trust limits

ESP-NOW shares the ESP32-C3 Wi-Fi radio. Devices must meet on the same 2.4 GHz
channel; offline lamps seek channels, while AP-associated lamps stay on the AP's
channel. A mesh extends coverage through lamps with overlapping reach. It does
not bypass incompatible AP channels, a shielding enclosure or lack of any
reachable bridge. Newcomer advertisements are discovered by a nearby broker;
the app can reach that broker through the already trusted multi-hop mesh.

Fleet members share control authority. This is an owner-fleet design, not a
public mesh or independent publisher-signature scheme. Physical comparison is
required when granting a newcomer trust. Factory reset clears fleet trust.
Removing a card on one phone is not remote revocation of an unreachable lamp;
owner transfer and fleet-wide revocation remain future work.

## Validation and physical acceptance

The Windows public build and firmware CI **37971580203** passed on source
`238c9dd616eb2cce0b13167551374298cbfd7a11`. Linux sanitizer checks include 19
mesh, 21 enrollment and 11 real adapter scenarios. Mobile has 411 passing tests,
seven mesh/setup UI scenarios, thirteen card-power regressions and six startup
checks. App **1.0 (41.1)** was uploaded through macOS CI **37971361480**.
The verified 1.13.0 CI image and manifest are published for OTA; see the
current [development handoff](development-handoff.md) for exact hashes and
private evidence paths. Neither test lamps nor a newcomer were flashed here.

Host suites exercise the real pinned Mbed TLS crypto and production mesh and
commissioning state machines. They cover three-node forwarding without a direct
end-to-end link, packet loss/reordering/duplication, full response fragmentation,
boot/replay fencing, wrong fleet/session, commitment/reveal, physical approval,
storage failure, cancellation, expiry and lost confirmations. Production mobile
UI mocks cover discovery, a remote broker, guided setup, asynchronous control,
startup selection, cancellation and missing acknowledgment. They do not prove
RF range, heap/stack margins under real coexistence, enclosure performance or
phone-to-hardware behavior.

For physical acceptance, install the verified release on the chosen test
lamps using an existing update path and retain settings snapshots. Confirm
direct Wi-Fi and Bluetooth regression behavior, a genuinely three-lamp control
path with no direct origin-to-target reach, an offline target, group continuity,
an interrupted mutation with no replay, and newcomer color comparison plus knob
approval. Confirm a rebooted newcomer returns with the chosen settings and no
direct phone pairing. Keep the existing router/SSID configuration constant.
The previously missing raw Mac evidence, same-IoT forwarding investigation and
BACL blackout/thermal investigation remain independent gaps.
