# CoolLamp 2 update bench evidence — October 11, 2026

## Current outcome

The user has returned. The corrective client is now available as **2.0.5 (60.1)**:
exact source `1e2d722a7f6b5388f8071b0e26670b9618922d0a`, workflow run
`38187429490`, 1,136 exported tests, production build, five native checks,
signed IPA and validated upload passed. Apple verification reports `VALID`,
`IN_BETA_TESTING`, nonexpired, and access through one assigned and one automatic
internal group. The export deliberately inherits the prior release's unrelated
quiet-policy/artifact modules; the working checkout's two extra tests are not
counted as released coverage. Evidence is
`.build/update-reliability-phone-20261011/published-handoff.json`.

Read-only USB on return verifies the canonical target, 1.15.1, phase 0/error 0,
power on/mode 46/brightness 55/134 LEDs, one retained bond, and boot health.
It reports 16,556 free heap and 8,180 largest block. Recent five-second animation
window max is 19.949 ms with no overrun; lifetime max remains 668.226 ms/two
overruns. A source audit identifies another possible stall: the pinned mDNS
begin/hostname/free SDK paths can wait indefinitely on the rendering loop.
No correlated event trace attributes the retained gaps to mDNS. That remains a
separate diagnostic/code milestone, not a claimed fix in either frozen image.
Those observations precede the subsequently authorized local canary described
below. The public OTA artifact remains unchanged.

The user installed 60.1 and confirmed **Reinstall current software**. The exact
standard 1.15.1 artifact was pinned; this was a same-version Bluetooth bench
reinstall, not a new release. The user observed the receiver's update animation,
reported 19% then 65%, and finally reported **Your lamp is updated**. The remaining
Wi-Fi warning is a separate control-path observation. Receive-only USB observers
sent no commands during transfer. After the app reported completion, read-only
USB verified the same canonical identity, version 1.15.1, fresh uptime 74,675 ms,
boot health, inactive receiver and no update error. Power, mode 46, brightness 55,
134 LEDs, midpoint 0 and one Bluetooth bond match the pretest observations.
At that checkpoint, complete NVS/startup/color records and the installed partition
digest had not been read back. A subsequent fresh full-flash backup independently
proved the selected slot contained the byte-exact standard 1.15.1 release (see
`docs/update-progress-refinement.md`). The app's private commit journal was not extracted; its completion
message is a user observation of the shipped receipt/reconciliation flow.

This is one physically observed successful iPhone reinstall. Build 60.1 discards
the sender's success timing/MTU/write-mode counters, so no precise throughput or
negotiated-mode claim is possible. Exact observer and postboot records are under
`.build/update-reliability-phone-20261011/physical-first-reinstall.json`.

With separate explicit user approval, the counted-read/cue test image was later
installed over USB. A fresh private backup, ROM identity, selected slot, full
application readback and unchanged boot/partition/OTA/NVS prefix were verified.
The user reported that the animation stayed active, but Settings did not open;
the subsequent screenshot shows **Bluetooth connected, but the lamp did not
confirm setup**. One authenticated PC Wi-Fi Settings GET returned the correct
identity and all 47 effects in 0.828 seconds. This is not proof of iPhone Bluetooth
Settings success. Foreground connection isolation, exact-ACK observer isolation
and native cleanup safeguards are now tested client changes; their contribution
to this physical failure has not yet been established. The next controlled
TestFlight check should open Gear → Lamp Designs without changing settings or
starting another reinstall. The standard reinstall would undo the test image's
counted-read and refined cue changes. No new firmware has been published.
Postboot heap is 16,252 bytes (largest block 7,668); loop stack minimum 2,832 bytes
and HTTP cleanup stack minimum 1,272. The last five-second animation window peaks
at 21.315 ms, but this boot's retained maximum is 662.633 ms with two overruns.
The 100 ms animation-gap target is therefore still not physically accepted;
event attribution and continuous update/RF timing remain pending.

The chronology below records the earlier completed software-only checkpoint;
references to an unpublished client there describe that checkpoint, superseded
by the exact release evidence above. The firmware canaries remain unpublished.

The first iPhone 59.1 Bluetooth upgrade from 1.13.0 advanced through user-reported
5%, 7%, 10%, 17% and 32%. It was deliberately interrupted at the user's request
to bootstrap the newer receiver over USB. That wireless attempt was **not a
successful installation or throughput acceptance test**. There was no visible
Cancel action on the card. The user closed the iPhone application; the service
backup subsequently proved that the original validated 1.13.0 slot remained
selected. No incomplete image was selected by this procedure.

CoolLamp 2 now boots the exact standard, published **1.15.1** application.
Its Bluetooth link has authenticated, but the user reported that the Bluetooth
and settings buttons did not open controls. Full control-read availability and
the faster wireless transfer remain pending.

## USB installation and preservation

- Target identity: `f0b950b2f180`; verified ROM MAC `80:f1:b2:50:b9:f0`, ESP32-C3
  revision 0.4, 4 MiB flash, COM5.
- Application: 2,020,592 bytes, SHA-256
  `10218a28628724c2f4fca45b670e28ea2d6d4fab276eeb51197dc199e780bb9d`.
- Matching OTA-1 manifest: SHA-256
  `fc239b2238f03c9f3cc71d09889cd92533d36b51ab887073d4f54278a3e9cd60`.
- Full private 4,194,304-byte ROM recovery backup: SHA-256
  `e033e84a969f9ee87d45ff64e3f6335f77fe1e66306a40fd9659349b44f649f6`.
- Existing active application was app1 at `0x200000`, size `0x1f0000`;
  OTA sequence 10, state 2. Its prewrite bytes matched the published 1.13.0 image.
- Only that application was written. Independent complete readback matched the
  1.15.1 artifact. The full `0..0xffff` prefix, including bootloader, partition
  table, NVS and OTA selection, was byte-identical before and after writing.
- Fresh USB runtime observation at 39,168 ms reported 1.15.1 and `bootHealthy=true`.
  Runtime/saved appearance matched: power on, mode 46, brightness 55, 134 LEDs,
  midpoint 0. Diagnostics retained coordinator role 1, four positions, scene 24;
  Bluetooth retained one bond and healthy bond storage. Wi-Fi remained associated
  on the saved network; no router, SSID, channel, calibration or ownership change
  was requested or performed.

All raw flash, settings, HTTP bodies and USB logs remain private under ignored
`.build/usb-coollamp2-1.15.1-bootstrap-20261011/`. Do not publish them. The backup,
validation and one-time write journals are recovery evidence, not release assets.
Do not rerun the writer after any uncertain outcome without inspecting its journal.

## Outstanding connection and timing findings

Protected Bluetooth diagnostics reported an encrypted, bonded, known-peer link.
That proves radio authentication, not a successful settings RPC or a usable app
screen. Ordinary BLE delivery acknowledgements likewise are not execution receipts.

Allocation-free runtime snapshots reported approximately 16.3–16.6 KiB free heap
and a 7,668-byte largest block. The 1.15.1 universal control dispatch guard requires
24,576 free and 6,160 contiguous bytes. Its production source therefore denies a
full BLE settings command at the observed free-heap level before handler execution.
The corresponding HTTP Prepared request waits inside its original five-second
deadline. One authenticated, read-only `/api/diagnostics` request to the address
verified over USB reset after 5.016 seconds without response headers. Later metrics
showed 13 accepted clients, zero dispatches/responses, and seven deadline expirations;
these aggregate counts also include phone traffic. This supports the admission
failure mechanism without identifying the exact phone callback/error.

The production pinned-String fixture reports worst peaks of 15,696 bytes for
state and 16,096 for diagnostics. Lowering the 24 KiB guard without reducing those
peaks is unsafe. Audio capture accounts for at least 14,336 bytes before driver,
semaphore and task-control overhead. Reads must not stop audio or change an effect
to make their response fit.

Runtime timestamps also retain animation gaps of approximately 629–675 ms. Recent
five-second windows were approximately 21–22 ms with no overruns. The complete
interval has not been covered by the two retained windows; these readings are not
optical timing or proof of the 100 ms acceptance target. Host capture times, loop
window anchors and connection counters suggest intervening resets or metrics
reinitialization, so comparisons must not assume a single boot session. Their cause
is unresolved. Boot-health flags do not establish installed bootloader rollback.

The nearby non-pink Corkscrew was reported to freeze intermittently on 1.15.0;
its group membership was unknown. Background version/discovery traffic is
source-confirmed in app 59.1. No synchronized RF trace establishes its freeze's
cause, and proximity alone does not prove donor eligibility or mesh streaming.

## Software milestone and remaining physical gates

The client milestone passed **1,138 production protocol/handler tests** and the
production Vite build, including 39 saved-reconnect/reinstall cases after the
1,078-test background-isolation milestone and ten further cases for the new
exact resource-denial responses. Independent review added eight strict-reinstall
and three real paginated Bluetooth discovery cases. Automatic fleet, discovery,
group and selected-lamp reads pause under firmware ownership. Generation guards
stop subsequent pages and stale adoption after already-issued native I/O completes.
Automatic discovery no longer provisions a bridge. Foreground Cancel is visible
on the card, stops data, retains the original lease for bounded same-session
confirmation, and reconciles without replay. Verification/commit cannot be cancelled.
This code is not installed on the user's phone yet; native accessibility and
cancellation remain unverified.

Explicit saved reconnect failures now remain visible on their target card;
automatic recovery remains quiet. A separately confirmed per-card **Reinstall
current software** action uses the existing firmware-only protected connection
and pinned artifact. It requires a saved authorized target and fresh matching
public version; both protected receiver preflights must also report that exact
version. A stale card or a version change during download stops before any
firmware frame and cannot silently turn a reinstall into an upgrade. It does not
require full settings. Pending receipts go through
read-only reconciliation first. A same-version repair with a lost final receipt
remains uncertain: an unchanged version cannot prove that the reinstall executed.
The confirmation does not present reinstalling as a repair for memory shortage.
None of these changes has been published or installed on the phone.

The final client source/test hashes and results are in
`.build/wireless-update-58-failure-20261011/root-final-client-validation.json`;
`card-service-validation.json` and `background-isolation-validation.json` retain
the intermediate scope and logs. Full final test/build logs are
`root-reviewed-client-tests.log` and `root-reviewed-client-build.log` alongside
the ledger. Native iPhone and Android behavior remains pending despite the
JavaScript checks. Sixteen existing CI C++ effect, knob, audio, geometry, group
scene and update-I/O fixtures also compiled and passed locally, recorded under
`render-regressions/report.json`; native Windows GCC lacks the sanitizers used
by Linux/macOS CI.

A firmware reply-memory milestone now implements counted JSON, one exact output
reservation and captured worker/radio/time inputs for approved immutable reads.
Legacy JSON digests match. Resource refusals return an explicit 503; HTTP reads
do not wait five seconds behind the mutation admission floor. The response and
transport bounds, auth, ownership, NVS and partition contracts remain intact.
Actual mutations retain the original 24 KiB admission floor: working read-only
settings do not prove that a settings save is available at the lower heap level.

The pinned-String four-position **fixture** using observed topology, 134 LEDs,
mode 46, brightness 55 and default appearance yields a 6,653-byte 47-effect state
reply with 7,456 bytes of peak String payload allocation, and a 5,853-byte complete
diagnostic reply with 6,768 bytes of peak payload allocation. Both are admitted
with modeled 16,316-byte free heap/7,668-byte largest block. Exact saved appearance
was not recoverable from diagnostics and is not claimed by this fixture. Maximized
four-position and 32-position replies that do not fit are honestly refused. Host
String payload measurements exclude allocator metadata and concurrent SDK work.
See `protocol-control-read-memory.md` and `.build/status-builder-memory.json`.

Target compiler frames are 800 bytes for state, 960 for diagnostics, 208 for
descriptor and 144 for schema. These are individual function frames, not measured
task high-water marks or complete call chains. All **33 host contract suites**
are now green: 31 from the original frozen-source run, plus two targeted reruns
after adapting old test fixtures to the counted serializer. The only subsequent
production change removed an unused group JSON quote helper; the complete Sync
radio/20/32-member suite was rerun. The initial failed record is retained rather
than rewritten; the combined evidence is
`.build/counted-control-read-1.15.1/host-gate-combined.json`, with repair logs and
hashes in `host-repairs.json`.

The exact frozen normal build is archived under
`.build/counted-control-read-1.15.1/normal/`, with 126 matching current/staged
firmware-source hashes. It is a local, unpublished 1.15.1-source build:

- Application 2,024,512 bytes; unchanged 2,031,616-byte OTA slot; 7,104 bytes spare.
- Program 2,024,360 bytes, 3,908 bytes above the baseline. Static globals remain
  94,212 bytes, a zero-byte increase.
- Image SHA-256 `ec5e4814bb7ae0543732717438c8f986b53c63199184dabd70b81ca46c386c8b`.
- Manifest SHA-256 `1d68a840650304693818d1eac1c45adbe986bb23f2a6ff94abeec7de69e5fe65`.
- Its partition table matches the archived initial target backup byte for byte;
  comparison evidence is `partition-preservation.json`. This offline comparison
  is not a fresh backup or a claim about subsequent runtime NVS writes.

`normal-build.json` retains artifact hashes, ELF/map and compiler stack reports.
The normal image is not the canary. The donation-disabled bench build is now
archived under `.build/counted-control-read-1.15.1/test-image/`:

- Application 2,023,856 bytes; 7,760-byte OTA margin; static globals 94,204 bytes.
- Image SHA-256 `a00f4512c4a7e7f8a4967f1f502d5279471e13b089eecbbf59dab244e3851aef`.
- Test manifest SHA-256 `56331724564dcabf52382e687bc0fc096f226294734277ed296232458107f6fb`.
- All 126 sources match the frozen normal build; the partition tables are identical.
- Explicit `--public --test-image` build and `--test-image` packaging succeeded;
  normal public packaging correctly rejects this test image. It cannot donate.

`test-image-build.json` and `root-handoff-validation.json` record independent
artifact/source checks and the remaining gates. Firmware version has not been
bumped or published, and neither new image has been flashed. The 7,104-byte normal
margin is small; future changes require another actual size check. The physical
tests remain necessary before a device release claim.

The user has left the bench. No subsequent device flash, reset, router change or
firmware publication is authorized by this software-only continuation. Independent
code, review, host tests and builds continue; physical testing waits for the user.

When the user returns, first verify stable boot/session, fresh protected
identity/version and an inactive updater. Full settings are not a prerequisite
for the firmware-only path. Use the separately confirmed phone reinstall of the
exact published 1.15.1 artifact on the existing standard receiver to exercise
negotiated fast writes and the receiver-only progress animation while the lamp
is on. Measure written offsets, elapsed time and actual packet sizing; do not
invent an estimate. Confirm acknowledged Finish, restart/version, protected basic
control, inactive receiver and preserved settings afterward.

Test the reviewed reply-memory canary separately, after its exact build,
preservation backup and device approval are resolved. Then check full settings,
diagnostics, catalog and animation gaps under competing/slow clients with audio
running. The published standard 1.15.1 image does **not** contain the counted-read
changes: reinstalling it over a canary would revert this memory milestone and
must not be presented as repairing full-settings availability. Test cancellation,
foreground loss, final-ACK loss and app
relaunch separately, retaining uncertain receipts. Keep router configuration
constant. Donor transfer, iPhone/Android interoperability, continuous animation,
twenty-lamp coexistence and rollback acceptance remain separate physical gates.
