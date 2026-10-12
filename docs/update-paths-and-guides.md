# Local update, layout and first-use integration

This is an unpublished source milestone following app 2.0.5 (61.1). Public
firmware 1.15.1 and that TestFlight build do not contain all of these changes.
No new lamp flash, OTA publication or store submission is performed by this
milestone. The original design documents remain proposals, not shipped claims.

## Receiver progress and source

The hidden receiver renderer preserves the on/off state captured at admission.
It uses subdued whole-lamp motion and a brighter steady fill representing
confirmed written bytes. It never becomes a selectable effect or a group
command. Source colors are blue for the phone's protected Bluetooth transfer,
green for pinned Internet HTTPS, amber for the separate trusted firmware donor
service, purple for a computer/browser upload, and neutral for unknown source.
Donation is not arbitrary firmware upload through the control mesh.

The app requires fresh verified target identity and actual receiver progress.
A route proposal, public release discovery, proximity, downloaded-phone bytes,
or relay delivery acknowledgement is not progress on the lamp. Written-offset
progress and its text remain accessible alongside model artwork. Legacy
firmware without route/written counters retains honest generic progress.

## Automatic service

New lamps retain automatic updates off. Opt-in is persistent. The loop-owned
RAM scheduler tries a viable Internet path first and observes authenticated
donor offers after a safe failure or unavailable path. Retry is bounded to
60–75 seconds; donor observation uses a 30-second window. Repeat offers are
deduplicated, and ordinary successful no-new-release checks retain the existing
six-hour cadence. Discovery is separate from admission and receipt/commit state.

Quiet/defer policy, unknown time, group staging, updater ownership, storage,
resources, publisher requirements and exact-artifact quarantine still apply.
An uncertain installation never starts another route automatically. Legacy
unknown attempt records remain held; a safe precommit HTTPS failure no longer
permanently blocks the same artifact. The legacy attempt marker is written only
after complete validation immediately before boot selection.

GET `/api/firmware` adds canonical `deviceId` and bounded `automaticService`
version 1. Its numeric state/reason enums are defined in
`LampUpdateAutomatic.h`; the app parser is `mobile/src/update-source.js`.
The extension is excluded from nested full state/diagnostics to preserve the
8192-byte control bound. Passive inventory refresh may read this optional
snapshot; mutation preflight does not add a new inventory query. The card offers
an explicit phone update only for fresh verified path failure, never quiet,
group, busy or unconfirmed commit holds. Stale/unreachable results cannot claim
that automatic updating has recovered. Phone updating requires user initiation
and the existing native foreground/lifetime requirements.

Current grouped automatic rollout still needs its staged permit. Protocol-2
groups are explicitly held. Automatic radio ticket distribution is not completed
by this retry scheduler. A card cannot promise that a nearby lamp can donate:
both lamps need matching protected household firmware-fleet trust, a compatible
channel/overlap, a validated donor artifact, receiver opt-in/policy and resources.

## Browser/computer service upload

Open the lamp's recovery/setup hotspot using the established physical gesture,
connect the computer to it, and visit `http://192.168.4.1`. Authentication and
the current boot token are still required. The page accepts the CoolLamp
ESP32-C3 application `.bin`, not a merged image or bootloader. Where publisher
enforcement is provisioned, the original publisher-signed manifest is required;
an unsigned or wrongly signed file cannot downgrade that policy.

The page hashes bounded 16-KiB slices locally, pins version/chip/size/SHA-256,
and obtains a 30-second one-use RAM preflight ticket from POST
`/api/firmware/upload/prepare`. Manifest line breaks use a printable bounded
separator in the form; the lamp restores exact canonical bytes before verifying
the signature. The shared form decoder continues rejecting control characters,
duplicates, malformed encodings and oversize requests.

The ticket binds current boot token and canonical target. One multipart file
named `firmware-<32hex ticket>` streams chunks no larger than 512 bytes into the
inactive slot using sequential writes. The transient checked context is bounded
to 640 bytes, released/wiped at safe failure/expiry. A file never occupies a
whole-image lamp RAM buffer. Exact size, header, marker, SHA, SDK image validation,
publisher metadata/epoch and durable attempt guards precede one boot selection.
The existing authenticated legacy `/update` service route remains compatible.

GET `/api/firmware/upload/status` is a pure read of target/boot/installed-artifact
and health evidence. Lost final replies use at most 45 seconds of read-only
reconciliation, never resend or repeat commit. Same-version repair needs a
changed nonsecret boot nonce and exact running artifact plus health. A boot
selection failure can be uncertain: ownership stays reserved until reboot and
the active-transfer cue stops. The page reports that uncertainty. The recovery
hotspot may close after restart; this does not justify changing saved Wi-Fi.

The pinned build helper compresses the immutable page in flash. The bounded
HTTP server sends exact mapped gzip bytes incrementally. The lamp does not
allocate a decompression workspace. Manual Arduino builds retain the raw-page
fallback; firmware-size evidence must use the actual chosen build profile.

## First-use and optional help

`mobile/src/onboarding.js` stores bounded versioned local guide preferences,
never ownership credentials. `ownedLampIds` and the exact protected pairing
result determine which lamp is owned. Existing users/inventory do not acquire
factory-new prompts through migration. A fresh install shows the first guide
once; a second verified owned lamp offers group guidance once. Later Add allows
guided setup or quick connection, and Help can reopen setup, groups, center,
knob and four-step optional sound guidance.

Each accepted setup step remains separately confirmed. Partial saves become a
persisted review-only screen, without replay buttons or invented all-or-nothing
success. The current/unknown automatic-update choice is preserved unless the
user changes it. Guide navigation is presentation/connection fenced. Phone
storage failure cannot turn an accepted lamp save into a lamp failure. Deferred
group guidance after Wi-Fi setup uses the next safe Home navigation, without
discovery or group mutation.

## Whole strip and microphone contracts

The whole-strip path is a separate local layout, not a last-LED midpoint
sentinel. New `lampmodel/motionV1` retains the old `coollamp/geometryV1` center.
Split remains the default for existing lamps. GET state negotiates
`motionVersion:1` and `motionPath:0|1` (null if persistence is unconfirmed).
Protected Geometry endpoint 11 accepts either the old midpoint-only form or
`pathVersion=1&path=0|1`, with one durable field per request. Mirror uses each
member's own layout; no unversioned packet field or group-wide overwrite is
introduced. Spatial scenes, calibration and update progress retain calibrated
physical height. Switching back restores the saved center.

The installed microphone remains hardware metadata, driven by the existing
audioV1/V2 records. New `coollamp/audioUseV1` independently controls local
capture and preserves tuning/catalog IDs. Missing preference defaults enabled;
malformed/unreadable preference fails closed. GET audio adds `captureVersion:1`,
`enabled:true|false|null`, and `captureStatus` 0 idle, 1 starting, 2 healthy,
3 stale, 4 error. Signal activity is separate from capture health. Reads do not
start an audio test. Protected Audio endpoint 8 accepts
`action=use&useVersion=1&enabled=0|1`; the old full audio configuration retains
its hardware/restart behavior. Group followers still use coordinator features.

The INMP441 has an I²S data interface, with no I²C identification register.
The ESP32 supplies clocks and can receive zeros/noise even with no microphone.
Healthy silence is not proof of absence; missing DMA samples may be a capture
path failure. Do not automatically remove effects based on silence. The privacy
contract is no saved audio recordings or audio sent to the Internet; nearby
group lamps intentionally share derived levels/bands/rhythm. See the
[manufacturer datasheet](https://invensense.tdk.com/wp-content/uploads/2015/02/INMP441.pdf).

Manufacturing may call `provisionLampMicrophoneHardware(true)` to install the
small verified immutable `lampmodel/audioHwV1` default. It applies only when
both legacy hardware records are genuinely absent. Existing valid, disabled or
malformed legacy settings are never replaced by a missing owner/network/bond
heuristic. Factory provisioning is a precise remaining production prerequisite;
unprovisioned boards are not falsely declared microphone-equipped. User reset
retains manufacturing/model/layout records, resets owner audio-use, and preserves
existing physical hardware according to the established reset transaction.

Clients send these new absolute setting mutations once, after fresh target and
contract verification. Lost replies allow a verified current readback only.
Unknown future versions/null settings stay uncertain; no route replay or guessed
mapping is used. Settings retain existing resource admission; a readable lamp
is not proof that every durable mutation has sufficient SDK/NVS resources.

## Acceptance gates

Exact focused tests/build evidence is archived privately under `.build`; the
final handoff records immutable source and artifact digests. Host tests exercise
production handlers, parsers, serializers, state machines and fault boundaries.
Build/static-size/host allocator results do not establish real heap, RF timing,
native phone interoperability or optical progress direction.

The user subsequently authorized application-only flashing and OTA publication.
The exact normal 1.15.2 image, private backups, readback, resource limits and
limited physical results are recorded in [its release handoff](releases/firmware-1.15.2.md).
Only verified results in that handoff apply; the new mobile work is not shipped.

Next physical tests exercise all four routes with the router held constant.
Include on/off admission, interrupted data/final replies,
same-version repair and no duplicate boot selection. Check first/newcomer guides
on iPhone and Android, whole-path/center restore on odd counts, deliberate quiet
versus sound tests and local microphone disable/reboot. Keep twenty physical
lamps, donor/RF coexistence, staged rollout, production signing and actual
bootloader rollback as separate gates. No store/release-ready claim follows from
these software tests. Explicit uncertain Bluetooth commits now retain updater
ownership and the original receipt. The additive flag never confers permission
to replay through a different route; protected binary Bluetooth still lacks the
fresh boot/digest/health proof needed to clear the new client's durable hold.
