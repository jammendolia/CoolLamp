# Responsive light controls and confirmed center saves

Implementation candidate, 12 October 2026. The public firmware is still 1.15.2.
Pink Corkscrew's reported 5–10 second effect/slider delay, ineffective brightness,
unconfirmed-change lock and Settings memory refusal have not yet been captured
with a native timing trace. Its reported missing center save is also unresolved
on that particular lamp. The changes below address verified production paths;
they are not a claim of physical acceptance.

## Client control path

`LampExperienceSession.change()` reads one fresh revision, submits one absolute
partial command, and validates its target/boot/command receipt. Long-lived
drafts retain their separate compare-and-set check. A previous pending command
is queried by its original identity before another command; reconnect metadata
also checks that receipt. An expired receipt or reboot remains uncertain. No
mutation is replayed, including when changing routes.

Only the five exact authenticated adapter 503 refusals documented in
`experience-contracts.js` prove no handler executed. A generic 503, failed state
read or post-execution allocation failure never becomes that evidence.

Bluetooth light polling and post-command refresh use the protected 12/16-byte
State and 8-byte Effect Options characteristics instead of a complete settings
download. They verify the connection generation, target and catalog. A mode
change between reads refuses the composite. `{freshLight:true}` proves light
values without renewing cached group or hardware freshness. Full configuration
reads remain necessary after durable configuration changes.

Control and center commands recover a missing notification with one exact
cached-ACK read 200 ms after the queued native write completes, bounded by the
existing command deadline. They never retransmit the command. Firmware transfer
ACKs and ordinary legacy command deadlines retain their existing owners.

Brightness, speed and intensity send while dragging. The 120 ms live queue
retains at most one unsent value for each of three fields, admits one submitted
command, and fences lamp identity, transport, epoch, token and effect. It discards
unsent input after ten seconds, an uncertain failure or target change. It neither
retries submitted commands nor turns appearance preview into an NVS save.

## Bounded firmware control

Only StatePatch uses the smaller admission policy. Its budget retains 8,704
bytes for SDK/workspace, 2,048 for captures, a 528-byte receipt reservation and
bounded decoded/raw form allowance. Other persistent and legacy commands retain
their existing 24 KiB floor. Revision and receipt encoders have a 512-byte ceiling.
Insufficient compact resources return a pre-execution refusal immediately.

An unpaused follower receives a confirmed rejection, including when its
coordinator is offline. A patch must not implicitly persist a pause through this
RAM-only admission lane. Already-paused followers retain local volatile controls;
explicit pause and old command behavior are unchanged.

Revision v1 optionally includes `currentColor: [enabled,r,g,b]` and
`currentOptions: [speed,intensity,dual,r,g,b]` for its current mode. Both tuples
are validated together; older responses with neither remain supported.

Pinned Arduino 3.3.11 String tests execute the actual adapter, ledger, handler and
setters, with the ESP32-C3 15-byte inline-storage model. Accepted command String
payload peaks at 592 bytes; hostile 1,024-byte input peaks at 2,992 bytes. This
excludes allocator metadata and SDK allocations and is not measured target heap.

The complete legacy state still needs approximately 6.7 KiB contiguous memory
plus 8,704 bytes after leaf capture. A read-only Wi-Fi observation on CoolLamp 2,
running 1.15.2 with the phone app closed, reported 14,968 bytes free and a
7,668-byte largest block; larger requests returned pre-handler HTTP resource
refusals. Those observations do not attribute Pink's exact failure.

`current-state-v1` negotiates a smaller Settings view. HTTP uses GET
`/api/state/current`; protected BLE uses the existing State endpoint 1 Read
with the exact twelve-byte form `view=current`. No endpoint number or wire
layout changes. The response adds `stateView:1` and retains all configuration,
identity, catalog and group fields. Inactive color/tuning slots are explicit
`null` entries; their indices and current slot values remain exact. Ordinary
legacy reads retain their full arrays. At the observed 14,968-byte budget the
pinned fixture's HTTP/BLE String peaks are 5,584/5,520 bytes. The built-in browser
page uses this view too. Bluetooth requires an explicit capability; a saved
firmware version only orders Wi-Fi reads. Actual marker, shape and canonical
identity must verify. A confirmed unsupported 404 alone permits a legacy read,
sharing the original deadline through any catalog read.

The standard candidate is 2,031,600 bytes in a 2,031,616-byte OTA slot: only
16 bytes remain. Static globals remain 94,348 bytes. Future additions, including
production publisher roots, require a new measured flash budget; no bootloader
or partition migration is included in this change.

## Center saves

Numeric Wi-Fi/mesh saves verify the same target and LED count and the exact
requested midpoint. An ambiguous reply gets at most one read-only reconciliation;
the POST is never replayed. Guided saves verify that calibration ended at the
requested saved boundary. Production Preferences commits before returning success;
the firmware updates its live midpoint only after that success.

Bluetooth uses the existing small protected center commands/status on both old
and modern firmware. Save first reads the actual marker position, then issues
one save and validates the exact durable boundary, count and inactive status.
Status polling does not extend the ten-second inactivity timeout. Full Settings
paging no longer consumes that timeout. Timeout/cancel is not described as saved.

Whole-strip animation mode deliberately ignores the saved physical midpoint for
VU and other path effects. It does not erase that hardware calibration. Validate
the saved numeric center separately from the selected animation path.

## Physical acceptance before a fix claim

Use Pink Corkscrew independently, retaining router/channel, current budget and
saved configuration. Record exact app/firmware versions and verified route. Time
at least 30 effect selections and 30 slider changes while filming phone and lamp
together; target median below 300 ms and p95 below 750 ms on a healthy foreground
connection. Record the maximum and all failures rather than treating those targets
as measured results. Repeat with missed notifications and concurrent read clients;
there must be no replay or animation stall.

Verify brightness with a low-power solid color at both low and high settings,
then Fire intensity and brightness separately. The FastLED current limit can
flatten high-brightness full-strip output; these changes do not remove that limit.
Save numeric and guided centers on an odd-count strip, read exact values, restart
and read them again. Test marker inactivity, storage refusal, lost save reply,
reconnect and whole-strip versus centered VU. Never use appearance alone as proof
that a durable center write succeeded.

New firmware also retains the prepared hidden update renderer refinement:
subdued changing colors over the whole lamp, steady brighter route-colored
progress rising physically from bottom to top, only on the receiver that was on
when updating began. It is absent from effect catalogs. Test its new renderer
only after the candidate is running; the first installation is rendered by the
previous firmware. Physical color, native BLE latency and fleet acceptance remain
separate release gates.
