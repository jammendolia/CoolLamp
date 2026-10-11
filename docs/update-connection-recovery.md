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

### Follow-up failure in 57.1

The signed 2.0.5 / 57.1 successor was available to internal TestFlight testers.
The user reported Wi-Fi fallback, a protected Bluetooth connection, phone
download at 100%, then `Not connected to device.` without an installation
result. In the pinned iOS Bluetooth plugin that exact error means the cached
native device is disconnected. It can arise before the post-download identity
read or initial receiver-status read; the disconnect boundary was not captured.
Download completion proves neither bytes written to the lamp nor installation.

The user subsequently tested 58.1 twice and reported the reconciled message
`The update did not start. Your lamp is unchanged.` The furthest visible stage
is uncertain: the user did not remember seeing phone download, then clarified
that the brief message may have been missed. No video has yet established the
failed native call. This is a failed physical acceptance, not successful updating.

Read-only USB after those attempts confirmed public 1.13.0 in the same boot,
failed internet TLS allocation, unchanged observed light configuration, and
16,308 bytes available / 7,668 largest block after closing the iPhone app.
During app traffic, a valid but incomplete diagnostic object lacked its firmware
field and reported 3,580 available / 1,140 largest block. The memory recovery
does not independently prove which native request failed. No reboot, USB flash,
network change or settings save was used.

Production-handler host fixtures reproduce that exact message without ever
downloading or invoking a Bluetooth sender: a rejected Wi-Fi check, malformed
firmware reply, or failure reading the install token can all reach it. The
coordinator previously discarded the original cause after an inactive protected
snapshot confirmed no installation. The successor preserves a separate bounded
safe stage/code record while retaining the stronger safety journal.

Read-only USB after the app was closed confirmed the same boot session, public
1.13.0 still running, failed internet preflight (phase 5/error 3), and unchanged
observed power, effect, brightness and 134-pixel configuration. Available heap
recovered from 7,640 bytes / largest block 1,908 during reconnect traffic to
15,928 / 7,668 after closure. That observation does not establish the cause of
the native disconnect. Ordinary BLE RPC counters are not OTA-frame counters.
No USB flash, reset or router change was used to bypass the failed update.

### Download, transfer and result ownership

The coordinator now releases its short protected preflight connection before
downloading the approved artifact. It then acquires a fresh target connection,
rechecks identity, installed version and inactive receiver, and sends the same
verified download. A transient preflight or post-download failure permits one
bounded connection recovery only while the durable journal proves no updater
frame was issued. Wrong identity, owner loss, access failure, busy receiver,
unsupported bootstrap and failed journal persistence do not get that retry.

Phone progress says **Getting the update on your phone**, then **Preparing your
lamp**. Numeric **Updating your lamp · N%** comes only from receiver-acknowledged
written bytes. Download 100% cannot become lamp progress 100%. The final stages
say **Finishing the update** and **Checking your lamp**. On a lost final reply
the app performs protected read-only checks itself; it does not instruct the
owner to reconnect or issue another installation. If the target stays absent,
the card keeps a visible pending result and offers **Check update**. Foreground
recovery checks are rate limited per lamp to once per 60 monotonic seconds.

The saved attempt pins canonical target identity and the exact approved
manifest text, version, size, chip/partition identity and SHA-256. Its bounded
`coollamp-firmware-attempts-v1` journal retains at most 32 targets in 32 KiB;
pending records are never evicted to make room. Before every native updater
write and every Wi-Fi firmware POST, storage is written and read back. Safety
flags distinguish metadata, Begin, Data, Finish, Cancel, resume and Wi-Fi
check/install. A failed save stops the next mutation. Per-chunk acknowledged
progress remains in memory; ten-percent checkpoints and safety boundaries keep
durable writes bounded to 32 per attempt plus its terminal result. No image,
credential, private key, SSID or request body enters the journal.

Every update entry point, including the advanced Bluetooth button and fleet
Update all, shares the pending-attempt fence. Passive inventory excludes those
targets while continuing bounded reads of other owned records. An uncertain
Wi-Fi installation cannot be replayed over Bluetooth; a missing Finish reply
cannot trigger another Finish or Begin. There is one updater owner and one
screen-awake lease, retained across download, transfer and result checks.

The result worker is read only, with at most three acquisitions, 24 protected
snapshots and a 45-second total deadline. Acquisition and cleanup gates are
shared by old and new receipts; late native work cannot retire a replacement
connection. Each snapshot reads canonical identity, binary firmware, binary
state and receiver status, with a five-second freshness limit. An intended
version plus responsive protected control and an inactive receiver confirms
version/control recovery. This does **not** prove installed flash digest or
postboot health/rollback. Those remain separate physical gates.

A ready release with automatic updates enabled can start an installation in
legacy firmware even when the phone never sent `/api/firmware/install`.
Protected phase 2 with `automatic`, `available` and a newer release is therefore
pending, and blocks a Bluetooth start or an explicit-retry proof. An idle BLE
receiver alone is insufficient. Both ordinary and legacy receipt reconciliation
use this guard; malformed release identity with ready automatic flags fails
conservatively. No automatic route replay was added.

The optional `coollamp-firmware-update-diagnostics-v1` client record is separate
from update authority: up to 32 targets, four retained stage entries per target,
32 KiB total storage and a 4 KiB copied report. It records only enumerated codes,
time, numeric status and durable command-boundary flags. Raw errors, request
bodies, credentials, SSIDs, network addresses, firmware bytes and manifests are
excluded. Storage failure cannot change execution. **Connection & care →
Update details** reads this saved record without polling or modifying a lamp;
copying it is local and user initiated. These records cannot recover a cause
that 58.1 did not save. The normal target Bluetooth connection is retired before
private protected update reads, including when it was healthy, so an in-flight
rich read cannot rearm polling during preflight. Its already authorized native
radio is reused; firmware-only leases never start those lanes. Pending native
reads remain epoch fenced. Legacy receipts also survive a second interrupted
read-only check without losing the original durable confirmation boundary.

Same-version repair needs the exact acknowledged Finish receipt saved before
fresh post-restart checks can resolve it: equal version alone proves nothing
about the repair. A lost final reply stays pending. A verified inactive repair
that stopped before any possible Finish/Wi-Fi install remains safely retryable.
Older app receipts retain their original target/outcome durably while checking,
including across iOS termination and unrelated feedback saves. Only an old
explicit acknowledged completion can resolve through exact version/control;
old lost-reply receipts stay uncertain. Generic old error prose has no invented
artifact, session or completion receipt.

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

A later explicit retry prefers the saved protected Bluetooth route when the
previous attempt is durably confirmed as never starting an installation and
issued no updater frames or Wi-Fi install. A failed phone preflight that also
sent nothing retains this preference for the next explicit retry. This avoids
repeating a failed Wi-Fi check while preserving fresh identity, receiver and
minimum-version checks. Pending or possibly executed installations cannot use
this preference. After a confirmed installation, a later release follows the
normal Wi-Fi-first policy again; no persistent transport setting is introduced.

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

The user authorized corrective TestFlight publication. Builds 56.1 and 57.1
passed signing/upload and exact Apple availability checks; 57.1 did not complete
the user's wireless installation. The new bounded recovery/journal flow needs a
successor and a fresh physical test. Verify its exact source, signed upload,
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

The concrete first acceptance is CoolLamp 2 from public 1.13.0 to the unchanged
standard 1.15.1 image: 2,020,592 bytes, SHA-256
`10218a28628724c2f4fca45b670e28ea2d6d4fab276eeb51197dc199e780bb9d`.
Record the exact TestFlight build, phone download completion, first/last written
offset, acknowledged Finish, native disconnect/reconnect and protected target
identity/version after restart. Observe control and animation beyond the
30-second firmware health gate and compare saved lamp settings without a save.
Next cover app background/cancellation before Finish, loss of final reply,
relaunch with pending journal, an unavailable lamp returning, and in-place
transfer without USB on real iPhone and Android. Host mocks and builds do not
establish native throughput, radio range, accessible cues or twenty-lamp scale.

Pink Corkscrew's last verified installed image is the isolated diagnostic
1.15.1 build, which cannot donate. Its version number alone does not make it a
donor. A separately authorized same-version repair with the standard release is
required, followed by verified fleet trust, receiver opt-in/policy and same-channel
donation acceptance. Do not promise automatic room-wide updates or multi-hop
firmware streaming from control-mesh reach.
