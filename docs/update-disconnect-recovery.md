# Bluetooth update disconnect recovery

## Incident and verified limits

On 2026-10-12 the user reported that Big Ass CoolLamp, running 1.15.2 with
TestFlight 68.1, began a Bluetooth update, displayed the hidden update animation
and then returned to normal lighting. CoolLamp stayed in the foreground and did
not show an explanation on the current screen.

The exported diagnostic acknowledged 11,136 of 2,031,568 bytes (about 0.55%),
with 12,064 bytes attempted. The user estimated the visible progress at about
2%; that estimate is separate from the written-offset evidence. The sender
recorded `native-disconnect`, no Finish attempt, no committed receipt, and
protected reconciliation confirmed `transferStopped` with installed version
1.15.2. The preceding Internet preflight returned `UPDATE_MEMORY` and never
attempted Internet installation. That memory refusal does not prove why the
Bluetooth link subsequently disconnected. The longest native status read was
5,249 ms. No HCI disconnect reason or physical receiver heap sample was captured.

Original evidence is retained privately in
`.build/big-ass-update-disconnect-20261012/user-report.json` and `incident.json`.
The existing failed attempt is terminal and cannot be resumed.

## Visible result

`lampUpdatePresentation()` now distinguishes a confirmed stopped result from an
active receiver. A terminal, same-target durable attempt and terminal feedback
keep the result visible in Settings, with neutral artwork and no stale percentage
or progress bar. The panel does not claim the updater is still active or disable
normal controls. Its saved-card action checks the selected target and attempt
again before navigating. Successful completion retains the existing behavior.

`updateLampCard()` also announces a reconciled failure outside the Lamps card.
For this confirmed disconnect outcome, the message says that the connection was
interrupted, the lamp was not updated, and gives one action: keep the lamp nearby
and powered, then tap Try again. Unresolved installation outcomes continue to
say the app is checking; they never borrow the unchanged-lamp or retry claim.

## One original-session resume

New foreground card updates with a durable attempt journal request the existing
negotiated lease. The receiver's v1 ResumeLease flag decides whether StartWithLease
(operation 6) is supported; legacy receivers retain Start (operation 2).

After a native Bluetooth disconnect, exactly one recovery is permitted when the
original journal is still pending, Begin was attempted, Finish was not attempted,
and cancellation, storage failure and commit uncertainty are absent. The sender's
private lease must match the canonical lamp, original session, exact version,
size, SHA-256 and prepared manifest. The original connection is released first.

`acquireFirmwareResumeLease()` bounds connection and protected-snapshot preflight
to 30 seconds, with 1.5-second bounded cleanup. Pending acquisition/cleanup retains
the same owner fences used by the 45-second read-only reconciliation worker. A
late connection can only be cleaned up; it cannot issue Resume or race a new
connection after its deadline.

Fresh protected reads must identify the original lamp, unchanged running version,
Receiving state, negotiated resume support, detached lease, original session/size
and a nondecreasing retained offset. The snapshot has a five-second freshness
limit. Binary status does not contain the image digest; the existing 50-byte
Resume command (operation 7) presents the locally pinned digest/version/size for
the receiver to verify before taking the new connection generation.

The production sender starts at the receiver's written offset, not attempted
phone bytes. It sends no new Manifest or Begin. The journal permits one Resume
and still fences Finish before transmission. A second disconnect, expired lease,
reboot, wrong identity/session/artifact, cancellation or possible Finish falls
through to protected read-only reconciliation. Finish is never replayed. No
alternate update route is selected after a possible mutation.

The receiver retains its existing two-minute detached lease and one-hour session
limit. App background suspension still stops the foreground JavaScript sender;
this change does not implement native background firmware transfer. No wire or
durable record layout changed. Progress diagnostics describe the resumed segment
using its actual start offset, rather than treating it as an entire-transfer
throughput measurement.

## Receiver callback allocation

The private 1.15.4 candidate changes only the OTA write callback and version.
Arduino ESP32 core 3.3.11 exposes resident characteristic bytes through
`getData()` and `getLength()`. The callback borrows those bytes only until the
existing bounded queue copies them synchronously; it retains no raw pointer.
Authentication, maximum packet size, queue capacity and main-loop execution are
unchanged.

The former `getValue()` made another Arduino String copy. A pinned-core production
callback probe reproduced a valid 244-byte frame becoming empty when that extra
256-byte allocation failed, followed by disconnect. The candidate queues the
same bytes with zero callback String allocations. The SDK's initial incoming
characteristic allocation remains necessary and unchanged. This proves a failure
path, not physical causation for the Big Ass CoolLamp incident.

## Validation and physical handoff

All 1,645 mobile tests and the production build pass. The actual production card,
transport, sender and journal fixture transfers the full 2,031,568-byte image,
disconnects after 11,136 retained bytes, resumes once at that exact offset and
checks the complete SHA-256 stream, with one StartWithLease, one Resume and one
Finish. Additional cases cover old/stopped attempts, second disconnect, wrong or
inactive leases, expiry/reboot, cancellation, storage failures, possible commit,
deadline, late acquisition and cleanup ownership. Production Settings fixtures
cover persistent stopped results, target changes, neutral progress and success.

The candidate receiver passes all 42 firmware contract commands, including six
Bluetooth runtime tests covering the production callback, authentication, exact
independent byte copying, malformed/oversize packets and queue overflow. Build
and exact candidate resource evidence are retained separately when complete.
Firmware 1.15.3 remains the immutable OTA release; 1.15.4 is not published by this
change.

Next physical check: install the new TestFlight build, keep CoolLamp on screen,
and start one explicitly approved update of Big Ass CoolLamp to the pinned
1.15.3 release. Do not ask the user to switch apps during transfer. Capture the
final installed version and update details after restart/checking completes.
If a link loss occurs, verify one restore and continuation rather than a new
Begin. A stopped update must remain visibly explained. Physical resume,
throughput, receiver heap margin and the original disconnect cause remain open.
No USB flash, router changes, factory reset or firmware publication occurred as
part of these host checks.
