# Animation continuity during connection attempts

Candidate: **1.15.1**, unpublished. Candidate hardware acceptance is pending.
Controlled direct-HTTP traffic reproduced a visible freeze on Pink Corkscrew's
published 1.15.0 baseline. The original phone incident's route remains unknown;
the candidate is not yet ready for OTA.

## Incident and established evidence

Pink Corkscrew was commissioned, named and connected to Wi-Fi on 1.15.0. Opening
Settings → Lamp Designs reportedly left the app connecting until roughly its
25-second deadline. Its active animation froze and resumed after that attempt.
The actual route, request, radio state and maximum frame gap were not captured.
An HTTP stall is a concrete source-backed risk, rather than a confirmed cause
of that particular incident.

The installed ESP32 Arduino **3.3.11** source establishes these risks in the old
transport:

- `CoolLamp.ino` services networking before rendering. Its former HTTP server
  used synchronous `WebServer::handleClient()` on the same owning loop.
- `WebServer/src/WebServer.cpp` sets the client timeout from
  `HTTP_MAX_SEND_WAIT`, which `WebServer.h` defines as 5000 ms.
  `WebServer/src/Parsing.cpp` uses `readStringUntil()` repeatedly for request
  lines, headers and multipart framing. Progress could incur further waits;
  there was no whole-request deadline protecting rendering.
- `Network/src/NetworkClient.cpp::write()` calls `select()` with a one-second
  wait and up to ten retries. Partial send progress restores the retry count.
- The old `maxRenderUs` timer begins after network service. A small value did
  not establish a small gap between rendered frames.

These are findings from the pinned installed implementation. Host simulations
and a source audit do not prove which path the real phone used. Also measure
BLE servicing, response construction/allocation, Wi-Fi recovery and shared
radio work; they remain possible sources of delay.

On the connected Pink Corkscrew (`74b950b2f180`), USB verified 1.15.0, 134 LEDs,
corkscrew style, power on, Wi-Fi associated on the existing channel 6, and
continuous pre-test uptime. The user observed animation freezing during the
controlled incomplete HTTP request test. Concurrent reads timed out; USB
diagnostic delivery also paused for seconds. The old timer still reported
`maxRenderUs=13264`, demonstrating why that render-only timer misses this failure.
No exact baseline maximum LED-frame gap was measured: the old image has no
inclusive metric and no GPIO logic-analyzer capture was available. Several later
profiles could not connect, so they are recorded as failed/incomplete trials,
not successful exercise of every trace. No settings or router writes were made.

The same baseline flooded USB with `esp-aes-gcm: No input supplied`. The pinned
ESP-IDF 5.5.5 hardware GCM implementation rejects null input even for length zero.
Mesh challenges and empty commissioning records passed null input; software
Mbed TLS host behavior alone had missed this platform restriction. The candidate
supplies a real dummy address while retaining length zero, unchanged authenticated
bytes and protocol versions. Failed mesh challenge admission now waits its existing
350 ms retry interval instead of retrying on every loop. Strict hardware pointer
checks layered over real pinned Mbed TLS reproduced the failures before the fix;
21 mesh and 30 commissioning scenarios pass after it. This explains the observed
error flood, without establishing the original app timeout's full cause.

## Ownership and transport contract

[`LampHttpServer`](../LampHttpServer.h) replaces the synchronous server/parser
with incremental socket I/O. `O_NONBLOCK` descriptors and `MSG_DONTWAIT`
receive/send calls preserve progress across service turns. A complete request
occupies a bounded slot before dispatch. Routes, mutations, rendering ownership
and Preferences/NVS remain on the Arduino loop. A handler executes once; losing
its response never causes transport redispatch.

Each generated reply is immutable until its bounded send finishes or its slot
is abandoned. The server owns at most three clients, rotates its starting
slot each turn, and admits at most one normal dispatch/upload event per turn.
An upload event can also invoke its terminal reply handler; bounded cancellation
cleanup can invoke the original upload owner's abort callback. There
is no keep-alive or pipelined mutation execution: responses say
`Connection: close`. A full slot pool can delay a new caller until a slot's
deadline frees it; three clients is a per-lamp transport bound, not a fleet
inventory ceiling.

The socket-close worker receives detached descriptors and immutable original
acceptance/progress/deadline metadata through a four-entry queue. Its 2048-byte task stack and queue are an explicit resource
cost. It never executes a handler or accesses lamp state, FastLED or NVS.
Queue-full sockets remain in a bounded closing state; the loop retries queue
handoff rather than calling a potentially waiting `close()` itself. Cleanup
queue handoff also runs while networking is disconnected or HTTP is stopped.
One worker owns one additional descriptor. Including the listener and three
client slots, this server owns at most nine descriptors. Ownership ends only
after successful close, or verified EBADF while the sole owner still holds the
descriptor. A failed close retains ownership and retries with a 10 ms worker
backoff; lasting SDK failures can backpressure the bounded queue until recovery.
No descriptor is inspected after successful close because its number may be reused.

The pinned SDK has no usable socket send-buffer limiter and compiles socket
linger support off. Graceful close can leave queued TCP data in the stack after
the descriptor closes; a zero-window peer can keep it there. Simply moving
`close()` to a task therefore did not establish bounded resource recovery.
[`LampHttpSocketCleanup`](../LampHttpSocketCleanup.cpp) keeps the detached socket
open until its queued data drains, or the original request/idle deadline expires.
Actual reduction of pending bytes/segments can renew the idle deadline; the total
deadline never renews. Cancelled or expired pending sends are aborted before
close, under the TCP core lock in this worker only. Already drained replies close
normally. Upload responses preserve the original 180-second total allowance.

This narrow shim uses Espressif's private socket getter. Compile guards require
Arduino 3.3.11, IDF 5.5.5, core locking and full-duplex netconns; checked symbol
exports and pinned layout accompany the real build. The pinned
[socket close implementation](https://github.com/espressif/esp-lwip/blob/fd432e4ee2cfb7f7f1c7eb7227e0173412e7b84e/src/api/sockets.c),
[netconn teardown](https://github.com/espressif/esp-lwip/blob/fd432e4ee2cfb7f7f1c7eb7227e0173412e7b84e/src/api/api_msg.c)
and [TCP close behavior](https://github.com/espressif/esp-lwip/blob/fd432e4ee2cfb7f7f1c7eb7227e0173412e7b84e/src/core/tcp.c)
must be re-audited before a platform upgrade. Core-lock waits occur in the cleanup
worker; mutable handlers never move there. Physical resource recovery remains a
separate acceptance gate.

Active sends additionally use a pinned, **zero-wait** core-mutex credit snapshot.
Only the loop owning an attached socket may obtain it. No socket I/O happens
under that snapshot lock, no PCB pointer escapes, and a detached descriptor is
never queried by the loop. Every header or body write waits until previously
copied TCP bytes and the pbuf queue have drained. One write is limited to the
smaller of 1024 bytes and the negotiated TCP payload MSS. This avoids several
queued SDK buffers for a stopped reader; submitted bytes alone are not their
allocation size because lwIP can reserve MSS oversize space. Mutex contention
defers sending within the original deadlines. ACK loss can still expire the
request; it cannot cause replay of its handler. Healthy drained replies continue
to close normally. This trades some throughput for bounded outstanding memory
and requires separate physical latency and phone validation. The bound is one
application write between complete byte/queue drain, not one physical pbuf:
the SDK can split queued data for receiver windows or retransmit it.

The pinned TCP stack starts with a 3000-ms retransmission timeout. Production
fixtures reproduced premature cancellation when the former 1500-ms Send idle
limit expired before a lost data ACK recovered. Copied outgoing data now gets
5000 ms of ACK wait; after observed ACK drain, unsent/resource-blocked output
uses a fresh 1500-ms idle interval once. Receive/upload input remains 1500 ms.
The original 5000/15000/180000-ms totals do not move. Detached cleanup follows
the same pending-data distinction, and cancellation remains terminal.
The tenth physically tested image still used3500ms for copied data. The source
now uses5000ms: the exact production Server/Owner fixtures demonstrate that a
header ACK observed at3600ms was previously cancelled with HTTP200 headers
and no body, while the revised policy completes the unchanged reply inside its
original five-second total. Equal/unavailable snapshots do not renew idle,
and rollover, cancellation and once-only mutation execution retain their fences.
SDK RTT estimates and scheduling can change retransmission timing, so this is
a bounded policy correction, not proof of the physical resets' cause or a
guarantee of TCP recovery. It does not address the separate panic by itself.

| Bound | Candidate value | Meaning |
| --- | ---: | --- |
| Active client slots | 3 | Round-robin per lamp |
| Request line | 256 bytes | Explicit framing limit |
| Target, including query | 192 bytes | Path plus query together |
| One header line | 384 bytes | Reject rather than accumulate |
| All headers | 2048 bytes, 32 lines | Includes framing bytes |
| Authorization / token | 128 / 64 bytes | Retained only for this request |
| Ordinary form body | 1024 bytes | Shared HTTP/BLE/mesh control form limit |
| Signed household HTTP form | 2048 bytes | Existing `/api/household/control` envelope only |
| Form fields / key | 24 / 48 bytes | Strict decoding and duplicate rejection |
| Receive work | 512 bytes per service turn | Across all slots |
| Send work | 1024 bytes per service turn | Across all slots |
| Outstanding application TCP flight | One write per client, at most 1024 payload bytes | Wait for all queue/byte drain; SDK may split or retransmit |
| I/O scheduling budget | 2000 μs per turn | Checked between operations |
| Handler admission | 24576 free / 6160 largest bytes | Complete requests wait without execution when below either floor |
| Mapped HTML send admission | 24576 free bytes | Yield to Receive/Upload, Ready/Prepared and ordinary sends; waiting does not renew deadlines |
| Ordinary connection deadline | 5000 ms | From acceptance through reply; progress does not extend it |
| Mapped HTML send deadline | 15000 ms | Send only, from original acceptance; waiting input still uses 5000 ms |
| Input / unsent output idle deadline | 1500 ms | Successful I/O renews idle; queuing a reply initializes Send idle once |
| Copied outgoing data ACK wait | 5000 ms | Original absolute deadline still takes precedence; no TCP retry guarantee |
| Complete-input memory wait | Original 5000-ms total only | Ready/Prepared wait for server RAM; no peer input or lifetime renewal |
| Ordinary dynamic reply body | 8192 bytes | Per ordinary HTTP/BLE/mesh reply |
| Signed household HTTP reply | 12288 bytes | `/api/household/control` only, including its envelope |
| Retained HTTP body content together | 12288 bytes | Serialized content across all three client slots |
| Response headers | 512 bytes | Including at most 256 bytes of additional headers |
| Multipart boundary | 70 bytes | One streamed firmware file |
| Multipart stream | 2031616 + 1024 bytes | OTA slot image bound plus framing allowance |
| Multipart idle / total deadline | 1500 / 180000 ms | No indefinite phone upload |
| Multipart chunk | 512 bytes | Whole image is never retained in RAM |

The 2000 μs value is an **I/O scheduling budget**, not a hard whole-service
execution guarantee. SDK calls, response construction, NVS mutations and flash
write callbacks can exceed it and must be measured. Immutable setup-page HTML
can stream directly from mapped flash through `send_P`; the 8192-byte dynamic
ordinary body bound applies to allocated API replies, not that static page.
The actual setup page is 24012 bytes. A production fixture with one outstanding
write and a 250-ms delayed ACK completes it in 6061 ms. Its narrowly scoped
15-second Send lifetime preserves this legacy browser route; idle abandonment,
the heap floor and control-response priority still apply. Detached cleanup
captures this lifetime before wiping the mapped-page marker, including repeated
stop calls while the cleanup queue is full. API clients retain the five-second
total, and a waiting page request does not acquire the longer Send allowance.
The route-specific household envelope allowance preserves its existing signed
request/reply format; it does not increase ordinary BLE/mesh payload limits.
The socket parser is 1248 bytes in the host fixture. GET, incomplete headers and
uploads need no form allocation. A form exceeding the 384-byte inline workspace
allocates only its validated declared length plus one byte (1025 ordinary or
2049 household maximum), wipes/frees it on cancellation, and returns 503 before
execution if allocation fails. The allocation-free standalone full parser remains
2912 bytes for pure framing tests. A complete ordinary request copies 792 bytes
of bounded request metadata into one shared Prepared slot, then wipes/frees its
parser and external body **before** checking reply-memory admission. GET needs
no raw-form allocation. A form retains at most 1024 bytes, or 2048 for the signed
household route, in one private String until dispatch or cancellation. It is
decoded into the shared HTTP/BLE adapter only immediately before the loop-owned
callback, then wiped/freed. Complete-input waiting uses the original five-second
total deadline, because no more peer input is needed. It never renews acceptance
time; queuing the response starts its 1.5-second send-idle allowance once.
Cancellation,
stop or a socket error clears this request without execution; a legitimate
client write-half-close after complete framing remains accepted. Multipart END
retains its own parser and cannot overwrite the waiting ordinary request.
Auth, token, URI and household response limits use that immutable metadata;
it is wiped after dispatch or cancellation. Three live parsers plus
response, close-worker and SDK allocations remain part of the measured budget.
The retained-content limit is not an allocator-pool size: Arduino String capacity,
serialization temporaries and TCP buffers add to heap use. The pinned allocator
rounds an initial 6144-byte reservation to 6160 bytes and an 8192-byte reservation
to 8208 bytes. Runtime global minimum heap and largest-block observations must
accompany the serialized-content bounds.
The internal multipart upload buffer is 512 bytes, matching its streamed chunk.

USB input consumes at most 32 commands per service turn. Pending JSON diagnostics
coalesce and build at most one JSON reply per turn; partial/backpressured output
retains that reply until sent. Completion explicitly releases Arduino String
capacity before the next reply. New read-only USB `r` uses a fixed 2304-byte
buffer, no heap allocation, and the same partial-send/coalescing rules. Its version
2 numeric snapshot contains identity, firmware phase, heap/stack and timing;
worst valid uint32 values occupy 2077 bytes plus NUL. Its additional numeric
`socketCleanup` counters report queued, attempts, failures, aborts, pending owned
and maximum ownership age. Full HTTP diagnostics retain their existing bounded
format. Legacy `d` remains available.
Legacy bounded status/scan text formats remain.

Owner APIs retain HTTP Basic authentication, mutation tokens, canonical target identity,
boot/session/revision fences, receipts and existing endpoint semantics remain
in force. Signed household HTTP control retains its distinct per-phone proof
and authenticated reply envelope. Duplicate security/framing headers, transfer encoding, malformed
UTF-8/escapes, excess sizes and unsupported upload framing are rejected.
Successful dynamic JSON replies receive an allocation-free syntax/completeness
check before transmission; invalid/truncated JSON is an honest resource error.
Diagnostics additionally require actual top-level fields and critical nested
timing/firmware fields; a valid JSON object with a lost section is a 503 resource
failure. This still does not prove semantic completeness of arbitrary JSON, which
remains part of the production handler tests and worst-case reply measurements.
Incomplete requests never reach a mutation handler. A 503 before dispatch
reports that nothing executed. A lost reply or post-execution resource failure
requires state/receipt reconciliation; changing route does not justify replay.

Browser `/update` remains a separate legacy service upload. Multipart completion
requires the declared length and closing delimiter before END/boot selection;
cancellation must release only the original manual-upload owner. Signed/phone
update and trusted donation retain their distinct contracts.
The multipart final callback always runs after END or a rejected/failed upload,
even when an unrelated large response is pending. END may already have selected
the verified image; its final callback reports that outcome and schedules the
restart once. It must not return an ordinary pre-execution busy response claiming
that nothing ran. A lost or unavailable final reply requires firmware-status
reconciliation before retry. Aggregate response bounds remain enforced.

## Read paths and diagnostics

State, catalog, descriptor and firmware-status reads do not initiate scans,
provisioning, calibration, updating or effect pause. Descriptor/revision reads
may observe existing appearance to advance RAM revision bookkeeping. Firmware
policy and rollout status use cached state; storage recovery and volatile
expiry run on their owning service path. Unavailable storage remains an honest
invalid/locked result. Policy mutation admission can reconcile durable state
before its compare-and-set check.

Protected BLE control reads serve a cached response page with at most 480
payload bytes plus its 12-byte header. Commit evaluates the read once on the
loop; subsequent Page/read operations do not rebuild it or rerun handlers.
Generation/timeout fencing clears abandoned transfers. Temporary form/reply
buffers are wiped and freed. Large replies now move into one immutable String
owner instead of allocating a second full copy for paging. The wire retains a
view and an exact-once wipe/release callback; it never detaches private String
allocator pointers. Small replies use supported copying followed by wiping the
source to avoid moved-from inline remnants. The retained payload remains at most
8192 bytes; rounded String backing can reach 8208 bytes and can exceed the old
exact-length allocation. The ten-second idle lease still renews on valid Page
selection; clear, a fresh Begin, generation/authority loss or update cancellation
releases it. The current mobile client explicitly clears a completed download.

HTTP, BLE and permitted mesh controls use the same 24576/6160-byte
pre-execution resource admission. The shared adapter checks before decoding or
entering a handler; authenticated mesh retains a terminal denial for the
original request rather than executing it after memory recovers.
BLE consumes the transaction before returning a bounded 503 when resources are
insufficient, never invokes its handler, and cannot execute a duplicate Commit.
If even that reply cannot be retained, its existing terminal metadata/error path
remains honest. This admission is not a heap reservation against asynchronous
SDK allocation. It also applies to the general firmware-status RPC; the separate
20-byte protected firmware/update characteristics remain available unchanged.
Full reply construction and retention still require measured BLE Commit and
HTTP/BLE coexistence budgets separately from cheap cached ATT reads.

The hidden update renderer keeps its prior admission rule: only the receiving
lamp, only during active update, and visible only if it was on at update start.
It is never an effect-catalog entry. This transport change does not alter effect
IDs/order, rising/falling behavior, startup choices, brightness, power, geometry,
microphone settings or the supported 1–1024 LED range.

`GET /api/diagnostics`, read-only USB `d`, and allocation-free USB `r` include `timing` with:

- Maximum completed-frame gap and maximum animation-frame gap, animation gap
  overruns, show duration, whole-loop duration/gap and pre-render service time.
- Maximum network/BLE service duration, including connection I/O before render.
- Automatic 5000000-us current/last observation windows with sequence, modulo
  timestamps, observation/frame counts, maximum animation gap and overruns.
- HTTP accepted/rejected/deadline/cancellation/blocked-send counts, response
  failures, dispatch/send/receive maxima and close-queue pressure.

Reads never reset or advance windows. Windows use constant work, align to the
first observation, and retain only current and last; sequence zero is unavailable.
A cross-window gap belongs to the completing frame's window. Skipped windows have
zero observations and visible sequence gaps. Sample more often than five seconds
and verify contiguous sequences, nonzero animation counts and the same boot.
Boundary windows may include quiet pre/post-test frames; report that measurement
interval, and keep the boot-cumulative startup maximum visible. Storage is
128 bytes for the tracker, 64 bytes more than the original cumulative tracker.

Counters saturate and reset on boot. Unsigned microsecond differences handle
rollover when a sampled interval is shorter than one `micros()` period, roughly
71 minutes. Off, setup, calibration and update cues are distinct frame domains;
intentionally sparse/off output does not establish an animation stall. HTTP
health cannot be inferred from one small identity reply when larger replies
fail. Diagnostics contain no credentials, SSIDs, request bodies, fleet keys or
pairing material. Raw authenticated API bodies and packet captures remain
private because they can contain configuration/session data.

The provisional acceptance ceiling is **100000 μs (100 ms)** between normal
animation frame completions, with zero animation-gap overruns during each
connection-stress profile. This is a regression threshold chosen to expose a
visible freeze while allowing larger supported strips and normal service work;
it is not a steady-state frame-rate promise or validated accessibility claim.
Record actual maxima, baseline frame rate and control latency. Review the target
against physical results instead of declaring success from a compile or a
synthetic clock.

## Controlled physical procedure

No physical result is recorded for this candidate yet. Baseline observations
above do not satisfy candidate acceptance. Keep the current router,
SSID, channel and isolation settings constant. Preserve each lamp's saved
configuration and identify the actual target before any separately authorized
flash. Follow the existing release worker's private backup, exact artifact/hash,
application-slot, signing/provisioning and readback procedure. Do not publish
the candidate or fabricate an artifact digest in this document.

1. Record each target's canonical identity, running firmware/build marker,
   transport, LED count/midpoint, power/brightness/effect, group/paused state,
   microphone, automatic-update setting and current network health. Keep full
   configuration privately. Save and hash the test artifact when available.
2. On a consenting test lamp, run an animated standalone effect and preserve
   its appearance/startup settings. Use the same effect, brightness and LED
   count on old and candidate images. Include an odd count and the supported
   maximum in the fixture matrix; record a lower normal count separately.
3. Use a logic analyzer on GPIO0 to timestamp actual LED transfer completions
   for the published 1.15.0 baseline, which lacks the new frame-gap metric.
   High-frame-rate video can document visible freezes but is not an exact frame
   gap measurement. Do not infer a maximum gap from one-second polling of the
   old render counter. Preserve the baseline symptom even if it is not the
   original phone incident.
4. Capture the candidate's read-only USB diagnostics concurrently with each
   network profile. Rediscover the COM port and device ID first, leave BOOT
   alone during normal runtime, and never overlap a reader with the flash tool.
   The existing helper sets DTR before opening and leaves RTS deasserted:

   ```powershell
   . .\tools\windows-env.ps1
   python tools/audio-usb.py COM_PORT r --poll --poll-command r --interval 0.5 --seconds 180
   ```

   Replace `COM_PORT` with the verified port. Store the captured evidence under
   ignored `.build/` with private access. Metrics are per boot; obtain a fresh
   baseline by an explicitly approved restart before an isolated profile, or
   report the maximum for the entire continuous test session. Include USB
   polling overhead in the test rather than subtracting it without evidence.
5. Run each trace below for at least 60 seconds with normal status traffic on
   a second client. Record deadlines, actual socket blocking evidence,
   frame/loop/service maxima, free/minimum/largest heap, task stack margin,
   route/status, successful control latency and reboot/uptime continuity.
6. Repeat normal phone flows on a genuine iPhone and Android: bonded reconnect,
   Settings → Lamp Designs, state/descriptor/catalog refresh, Wi-Fi ↔ paired
   target BLE handoff, and bounded mesh recovery after direct route failure.
   Confirm merely opening settings never provisions another lamp. Exercise LED
   count and guided calibration only on a suitable authorized fixture, then
   restore its accepted individual hardware/appearance settings.
7. Repeat with at least 20 physical lamps and multiple clients. Include mixed
   styles, a 20-member synchronized group, paused/offline positions, coordinator
   audio, direct and genuinely multi-hop control, and simultaneous reconnect
   traffic. Radio mesh delivery ACKs are not target execution receipts.
8. Degrade client reachability using attenuation, distance or a test-client
   proxy/loss fixture while keeping the router configuration unchanged. Record
   association, phone reachability, group playback and update viability
   separately. Return to the original placement and demonstrate recovery.
9. On separately authorized update fixtures, test interrupted multipart/BLE
   transfer, original-session recovery, donor ownership and correct hidden-cue
   visibility for initially on/off receivers. Test failed manual upload followed
   by another update owner, then old HTTP disconnect: the old stream must not
   abort the new owner or boot-select incomplete data.

### Connection traces

Use explicit test targets and a local socket harness; never print authorization
values or raw request bodies. A harness must limit its own threads, connections,
duration and retries. These profiles are read-only except the separately
authorized interruption/command fixtures.

| Trace | Input/behavior | Required observation |
| --- | --- | --- |
| Partial request line | Send `GET /api/state HTTP/1.1` without CRLF, then wait | Idle close; render continues; no dispatch |
| Trickled line/headers | Send one byte every 1000 ms, never finish headers | Absolute 5000 ms deadline despite progress |
| Partial header | Send a complete request line, then `Authorization:` without line ending | No parse wait on rendering loop; bounded abandonment |
| Stalled body | Declare a small body for `/api/state/patch`, send only a prefix | No mutation before completeness; idle/total deadline |
| Limits | Overlong target/header/body, duplicate length/auth/token, invalid percent/UTF-8, transfer encoding | Bounded rejection and another client recovers |
| Reader stalls | Complete authenticated mapped-page and state reads separately, then stop reading; constrain receive window or use a controlled proxy | Confirm blocked-send/zero-window or cleanup-abort evidence, not just absent application reads |
| Abrupt disconnect | Close during line, headers, form and reply | Resources recover; no repeated dispatch |
| Slot saturation | Three slow clients plus one normal client | Bounded wait/cleanup; no indefinite starvation or render freeze |
| Normal traffic | Repeated authenticated state, effects, descriptor, firmware and revision reads | Valid complete replies, preserved state, responsive rendering |
| BLE paging | Reconnect then Commit/Page; reorder/repeat reads and disconnect | Immutable pages, no duplicate handler/mutation, truthful session fencing |

A stopped reader can still have enough OS/TCP buffering to receive a complete
small reply. Use `blockedSends` and TCP window evidence to establish the actual
send-stall profile. Match the deadline profile and firmware version in every
measurement; do not label all app timeouts as HTTP failures.

## Evidence and release ledger

Host checks exercise production parsers, paging adapters, policy recovery,
rollout handlers and timing trackers. They prove bounded application logic and
specific failure handling. They do not prove native BLE interoperability,
lwIP/RF scheduling, physical 20-lamp scale, thermals or animation quality.
Run the repository's pinned firmware build and contract gate, including
`tests/http-server-runtime.py`, `tests/http-parser-runtime.py`,
`tests/http-multipart-runtime.py`, `tests/runtime-metrics-runtime.py`,
`tests/ble-control-runtime.py`, `tests/update-policy-runtime.py`, and the
applicable existing group/mesh/updater tests before considering hardware rollout.
Record source hashes, exact image size/SHA, OTA-slot margin, static RAM, measured
heap/stack, test commands and failures repaired in the release evidence.

Current tenth public-default **1.15.1** test artifact:

| Item | Exact result |
| --- | --- |
| Application image | 2019248 bytes |
| Program / static globals | 2019108 / 94204 bytes |
| Configured OTA slot / image margin | 2031616 / 12368 bytes |
| Static delta from released 1.15.0 | +8752 bytes |
| Image SHA-256 | `384bbd2e2be32cf6a0397e2dfca8e990ed326b94510b35dc10c1cbbd2959d603` |
| Legacy 120-byte manifest SHA-256 | `ee4851d6fc61f91e1acc5161000043945d797a52ab5335a1037d578d3c1b0236` |
| Source/build provenance | 125 checkout/staged/frozen source hashes checked against the passing 33-command gate |
| Bootloader / partitions | Byte-identical to released 1.15.0 |

The image, manifest, ELF, map and compiler stack evidence are under
`.build/animation-continuity-1.15.1`. This is a local test build; no production
publisher roots are provisioned and its manifest is unsigned. No release was
published. Compiler remaining-RAM arithmetic (233476 bytes) is not runtime free
heap. Cleanup per-function stack estimates are 80 bytes for the worker, 64 for
an owner step and 32 for inspection; they do not prove whole-call-chain margins.
Application-only readback and controlled physical acceptance are recorded below
only when complete, against this exact image hash.

The second local public-default **1.15.1** candidate built with the pinned helper
and stack output: program 2,005,120 bytes, application image 2,005,264 bytes,
static globals 91,716 bytes. Its 2,031,616-byte OTA slot leaves 26,352 image bytes.
Partitions and bootloader are byte-identical to released 1.15.0; static globals
increased 6,264 bytes. Compiler remaining-RAM arithmetic is not runtime heap.
The upload-event stack estimate is 48 bytes; loop/close-worker stacks are
6144/2048 bytes. Per-function estimates do not prove whole call-chain margins.
Revised image SHA-256:
`fc5fe3476cc33714f0c7fc6a287eee5fe8d94b9ce9a633ac4c70fb6ef26a4cb8`.
The 120-byte legacy manifest SHA-256 is
`330ae454d47cbe74cd2bb412a51ee4c7231085e72cf40cecef9cb7b097bff20f`.
Frozen image, manifest, map, ELF, stack estimates and 120 verified source hashes
are retained under `.build/animation-continuity-1.15.1-fc5fe347`; no release was
published. This candidate failed physical acceptance and is historical evidence.

The first installed candidate (`e642257a...`) is retained separately in
`.build/animation-continuity-1.15.1-e642257a`. Its normal state preflight failed
HTTP 503, so zero stress trials completed. Request-parser retention and completed
USB diagnostic String retention consumed the contiguous heap needed for the full
state response; both have been repaired. Its 15 USB samples measured a cumulative
381349-us animation gap and two overruns, both already present before HTTP traffic.
Global minimum heap reached 1384 bytes; measured loop/close-task stack margins were
2864/1752 bytes. These are failed-candidate evidence, never physical acceptance.

The second candidate's user observation was no visible freeze, but settings still
did not connect. Its controlled HTTP workload timed out; 57 USB samples contain
12 incomplete timing/status snapshots, so the test interval is not fully covered.
Observed warm windows reached 28469 us with zero window overruns; its cumulative
startup maximum was 670482 us before HTTP traffic. Current sampled heap reached
3212 bytes (global minimum 412), largest block 1204, and loop/close stack minima
2860/1156 bytes. A scheduled HTTPS update check overlapped control requests around
74 seconds and heap deteriorated; earlier pressure occurred without a checking
phase. This motivates both compact request storage and background TLS admission,
without proving the original phone incident's route or blaming TLS alone.

The fifth candidate (`b0a6bb8b77c6c41054d1a9e73bc802c2da6cd6e52ae78209005fbf71b0f1df99`)
completed all 56 attempted profile loops, but only five passed. The first five
profiles completed 40 normal reads. Two stopped readers of the mapped setup page
then caused an invalid-framing state reply and an effects timeout; subsequent
trials could not establish their test sockets. Only 40 of 42 attempted normal
reads succeeded. A completed harness is not a passed workload: later setup
failures did not exercise their intended profiles.

Continuous captured timing windows covered 562.656 host seconds with a maximum
normal-animation show-return gap of **46459 μs** and zero new overruns. The
pre-workload cumulative maximum remained 662252 μs with one prior overrun. Sampled
heap fell to **2332 bytes**, the boot minimum to **388**, and largest block to
**1012**. Loop/cleanup stack margins were 2724/1164 bytes. This failed both control
availability and the sustained 8192-byte heap target despite continuing animation.
The archived image, full run, independent audit and readback/NVS proof are retained
under `.build/animation-continuity-1.15.1-b0a6bb8b`; no acceptance or publication
attaches to this image. This evidence led to pending-TCP ownership/abort cleanup,
mapped-page priority and pre-dispatch memory admission. The next run separately
adds stopped readers of the allocated state response: eight profiles, eight
rounds, 64 trials and 512 seconds of nominal profile traffic.

The sixth candidate (`f50884eddde352105dd5937540fe79ddd8463cb02b996f5ecf6626d119a79085`)
completed all 64 attempted profile loops, with only two passing. Normal state and
catalog queries succeeded 231 of 455 times; most failures were reset connections,
with some timeouts. Continuous USB timing windows covered 636.875 host seconds
and recorded a **54111 μs** normal-animation show-return maximum with zero new
overruns. Its pre-workload cumulative maximum was **684662 μs**, separately
retained. Sampled free heap fell to **3528 bytes**, the boot minimum to **680**,
and largest block to **1012**; loop/cleanup stack margins were 2476/1036 bytes.
This failed control availability and the sustained 8192-byte heap target.
Cleanup recorded 754 attempts, zero close failures, 387 aborts and zero owned
pending sockets in the last sample. This does not prove absence of healthy
TIME_WAIT metadata or establish the cause of every reset.

On that sixth image the user reported **Settings opens; animation continues
smoothly**. Its exact native route was not captured. USB separately recorded
five authenticated Bluetooth connections and eight state reads; that activity
does not identify the route used for the particular Settings opening. Subsequent
isolated normal HTTP reads passed 17 of 18, with one diagnostics connection reset.
Those positive observations do not supersede the failed multi-client workload.
The image, full report, independent audit, readback/NVS proof and supplementary
read/Bluetooth evidence are archived under `.build/animation-continuity-1.15.1-f50884ed`.

The seventh candidate frees completed request framing before the existing
16384/6160-byte memory admission. The earlier order could reject a viable reply
because the completed parser itself occupied the contiguous allocation needed
for that reply. Production transport tests now cover this reclamation, the
single waiting request, raw-form wiping and cancellation, interleaved BLE reads,
multipart completion, legitimate write-half-close, and three concurrent clients.
This mechanism still requires its own physical control/resource measurement.

That seventh image (`3cc8012f...`) completed all 64 trials with 12 passing and
486 of 506 normal reads succeeding. An actual restart interrupted the workload:
USB uptime fell from 212643 to 3583 ms, render counters reset, and subsequent
HTTP replies had a different boot session. Warm show-return maxima were
51336/49596 μs in the two separate boots; they are not a continuous whole-run
maximum and do not measure the gap across restart. Cumulative cold-start maxima
were 659802/666924 μs, separately retained. Per-boot global heap minima reached
112/124 bytes. This failed stability, control availability and resource gates.

Eighteen subsequent authenticated normal reads passed; three diagnostics replies
reported reset reason 4 (ESP panic). The precise panic/backtrace cause was not
captured. Zero Bluetooth connections reported after restart do not prove there
were none in the preceding boot. Full evidence, independent per-boot audit,
installation proof and post-run read/Bluetooth supplements are retained under
`.build/animation-continuity-1.15.1-3cc8012f`.

The original fixture gave requests launched near the end of an eight-second
trial only the trial's remaining time, sometimes 328 or 344 ms. Those failures
remain recorded and do not erase the real restart. The next fixture uses a
bounded eight-second launch window and a separate seven-second deadline for
each launched request, retaining slow clients through the last in-flight read
and recording actual phase duration. Its results require a separate run.

The eighth image (`6816982d...`) used those full independent seven-second
request deadlines. All 64 trials completed, with 23 passing and 413 of 446
normal reads succeeding (203/236 state and 210/210 effects). USB captured one
actual restart: uptime fell from 427517 to 3384 ms and render counters reset.
The numeric abort PC, `0x40381a43`, maps in that exact frozen ELF to
`lock_init_generic`. Disassembly shows `xQueueCreateMutex` returning zero and
branching to `abort`; this establishes a mutex allocation failure for that
abort. The calling path/lock remains unknown. The subsequent illegal-instruction
trap is part of abort processing, not separate proof of faulty instruction code.

Warm show-return maxima were **49535/47584 us** in the two separate boots;
neither measures the restart gap. Cold cumulative maxima were 653498/664215 us.
Sampled free heap reached **1016 bytes**, largest block 420, and per-boot heap
minima 228/188. Stability, availability and the sustained memory gate failed.
A separate healthy 24012-byte setup-page read succeeded in 2578 ms. Eighteen
additional protected reads overlapped the latter workload, all successful and
three reporting panic reset reason 4; this extra traffic is recorded. The full
source/image, run, independent audits and NVS/readback proof remain archived in
`.build/animation-continuity-1.15.1-6816982d`. No release acceptance attaches to it.

The next candidate removes stdio formatting from the bounded USB timing path,
including identity formatting. Literal/boolean/manual decimal and hexadecimal
encoding use caller-owned buffers. Tests trap stdio calls and verify every
numeric boundary, identity representation and truncated-buffer outcome. This
removes stdio formatting from measurement; it does not establish which caller
caused the eighth abort. Read-only disassembly of the pinned eighth formatter
shows integer/string snprintf paths use a stack pseudo-FILE and have no direct
stdio initialization/lock calls. Those calls are therefore not a demonstrated
mutex-allocation source. General formatter stack and allocating formats remain
separate concerns elsewhere in the firmware.

Pinned core 3.3.11 String tests also found that returning a large concatenation
helper from status builders retained the original, helper and returned buffers
simultaneously. For the production full-group builder, measured host String
payload peak fell from 12320 to 4144 bytes; state-group peak fell from 7488 to
2528. Named results with checked appends preserve successful bytes and return
empty on allocation failure so enclosing response validation fails honestly.
The fixture runs the actual pinned String implementation and disables NRVO;
host String layout, allocator internal transients and SDK allocations differ
from the target. The saved worst state/diagnostic byte hashes are unchanged.
All 506 injected String-allocation boundaries return an empty failed read with
no retained allocation. Six required HTTP diagnostic keys additionally prevent
a failed nested append from yielding a syntactically valid shortened object.
These source-backed reductions require fresh physical heap and stability tests.

The next candidate defers scheduled HTTPS checks while HTTP clients exist,
within 15 seconds of HTTP activity, or while a BLE phone is connected. Background
admission additionally requires at least 36968 free heap bytes and a 24576-byte
largest block, reserving an 8192-byte control reply and three compact parsers
beyond the TLS allowance. Insufficient resources leave the check pending and
preserve the previous verified result. These conservative gates can defer checks
indefinitely on a constrained lamp; they are not proof of update viability.
Explicit checks/installs retain 24576/16384-byte preflight and honest memory errors.
Automatic installs also wait for idle control before updater ownership; a started
install is never cancelled merely because a control client arrives. Opt-in and
all saved policy remain unchanged.

Background manifest work has a six-second whole budget, including clock wait and
redirects, and cooperative cancellation on new control traffic. Explicit HTTPS
work has a 180-second whole budget, 12-second connection/TLS and 30-second I/O
wait ceilings, with at most 512-byte sends followed by a scheduler yield. Only
the worker owns/destroys TLS. SDK DNS remains a blocking call with SDK-controlled
latency, so cancellation bounds apply between SDK returns; physical measurement
is required. A first control request racing an already-started TLS check can
still receive an honest 503 before cancellation releases memory.

Software verification covers all 33 commands in `tools/test-experience-contracts.py`,
including real handlers, allocation tracking, bounded USB handling and 20/32-member
simulation. The existing 16 effect/knob/audio/geometry/group/update regressions pass,
as do diagnostics, Wi-Fi recovery/setup, temperature and web-page checks. The
734-test mobile run and production Vite build passed again after the transport
and serialization changes. No visual app changes were introduced by this task.
These results do not establish native phone, RF or physical sustained acceptance.

The physical report must state: firmware/build/artifact hash, target identity,
tested route/trace, baseline and candidate maximum frame gap, overrun count,
concurrent-client/fleet size, reply/control recovery, sustained resource minima,
and remaining limitations. Publication is blocked until the required physical
evidence exists and the user separately authorizes the release. Production
signature/trust provisioning and bootloader/rollback gates retain their prior
requirements; this transport patch does not establish either one.

## Ready-to-run traffic harness

### Ninth physical candidate and next bounded changes

The ninth image (`a22dea37f8e1570008573c69e4a2927ab9fd424d99d5a4fbddb27392a1dd8235`)
completed all 64 direct-Wi-Fi stress trials on Pink Corkscrew. 58 trials passed;
446 of 452 normal reads succeeded. The six failed state reads were connection
resets during trickled request traffic. All 64 trial diagnostics and revision
queries succeeded with the original boot session, and 18 post-run reads succeeded.
This is an improvement in availability, but it fails the acceptance gate.

USB snapshots stopped after 88.187 seconds, leaving a 531.375-second unobserved
tail. The captured 17 complete timing windows had a maximum show-return gap of
47532 us and no new overruns. Later HTTP counters retained the same boot-cumulative
381030 us maximum and two overruns established before the workload; they cannot
recover the exact smaller warm maximum in missing windows. A subsequent bounded
USB query accepted one host-written byte but received no reply within five seconds.
Neither observation establishes a USB driver root cause. Sampled free heap reached
7456 bytes, below the 8192-byte sustained target; global minimum heap reached
124 bytes between samples. That transient is not a claim of continuous 124-byte
availability. Loop/close stack minima were 2724/996 bytes. Router configuration
and lamp settings were unchanged. The full failed evidence and exact software
archive are retained under `.build/animation-continuity-1.15.1-a22dea37`.

The next transport change observes bounded pending TCP byte/SDK queue-entry counts under
the pinned zero-wait core lock. A genuine decrease refreshes the ACK idle fence;
an unchanged snapshot, lock contention or unavailable descriptor does not. Only
complete draining grants the next application write. The original five-second
ordinary request deadline still wins, including across timer rollover. Production
server/cleanup fixtures cover partial progress, no progress, unavailable observations,
descriptor reuse and the absolute deadline; a negative fixture reproduces the
pre-fix premature close. This establishes a source defect, not attribution of
all six physical resets to that defect.
The SDK queue-entry count is `tcp_sndqueuelen` (PBUFs), not a packet count or
physical memory bound. SDK splitting and retransmission still own their buffers.
Detached cleanup additionally carries the known final-flight byte baseline
before the slot clears its send state. A delayed first observation can therefore
recognize a decrease, while an equal/unknown observation cannot renew idle.
The internal handoff record remains20bytes, enforced on host and target; repeated
handoff retries preserve that baseline and the original lifetime. This is
transport progress only, never a target mutation receipt.

State and diagnostics now use a loop-owned checked `appendLampSyncJson` helper,
with the original standalone wrapper retained. Failed appends discard the reply
and return an honest read failure. The real handler fixtures retain their exact
8082/8096-byte worst responses. A separate paired fixture using the pinned
String implementation forces every realloc to move: its8040-byte diagnostic
reply retains identical bytes while its String payload peak falls18224→16096
bytes. Its7838-byte state reply has the same15696-byte peak because later
appearance growth still dominates. These are fixture-specific values, not target
total heap. All506 standalone allocation failures and171 new helper-in-handler
boundaries fail honestly. Allocator overhead, SDK/radio work and sustained heap
margin still require physical measurement.

The USB liveness patch passes the production-handler and pinned-driver fixtures: each turn
reads at most32commands and writes at most64bytes; immutable replies expire
after5seconds total or1500ms without enqueue progress. Abandonment requires
a framing newline before a fresh reply. Only that newline can attempt a
zero-room, zero-timeout recovery write, once per100ms. SDK enqueue acceptance
is not host delivery. Read-reply requests coalesce and rotate fairly. This
uses no flush, reboot or remote lighting action; physical CDC recovery remains
a required test.

The next physical fixture pins the exact frozen image digest and size, uses
finite USB read/write timeouts and an independent heartbeat, and requires a fresh
end snapshot. Missing capture is a failed gate. A bounded same-port reopen can
be explicitly enabled with target/boot fencing; it records the gap and cannot
turn missing timing windows into successful acceptance.

`tools/http-stall-probe.py` uses explicit targets, asks for the existing access
password without logging it, verifies a single lamp's canonical identity, and
runs two slow peers alongside normal state/catalog traffic. It makes no lamp
settings or router writes. Its eight profiles include stopped readers of both
the mapped setup page and allocated state reply. `--rounds 8` gives 64 trials
with an eight-second normal-request launch window per trial. Every request
launched in that window receives its own full seven-second deadline, and slow
peers remain held through the last request (15-second profile cap). It records only identity,
version, latency, heap and timing counters, never request/response bodies or
credentials. Its result is physical evidence only when actually run against
verified lamps, with continuous USB capture and observed animated output.

```powershell
python tools/http-stall-probe.py --target VERIFIED_LAMP_IP --expected-device VERIFIED_CANONICAL_ID --rounds 8 --output .build/physical-http-continuity.json
```

For a fleet sharing the same existing HTTP access password, repeat `--target`
up to 32 times; at most 20 lamp probes run concurrently, with two slow client
connections per lamp. With distinct existing passwords, run verified single
lamp probes separately; never change household credentials to fit the harness.
The native phone and genuine multi-hop acceptance profiles remain separate.

Diagnostics now include `loopStackMinimumBytes` and
`httpCloseStackMinimumBytes`. The pinned ESP-IDF FreeRTOS header specifies
`uxTaskGetStackHighWaterMark()` in **bytes**, unlike upstream word units. The
loop stack is 6144 bytes and the close worker stack 2048 bytes. A zero close
stack result means the worker is unavailable/not started, not measured success.
Initial physical resource gates: no watchdog/crash, zero render-gap overruns
for the 100000 us animation ceiling, at least 1024 loop/512 close stack bytes
remaining, and at least 8192 free heap bytes during sustained traffic. Capture
largest-block margin and success of the worst state reply as well. Failed
resource gates require implementation/tuning and a new candidate; compiler
static-RAM arithmetic does not satisfy them.

Successful HTTP/BLE/mesh JSON replies receive an allocation-free syntax
completeness check, capped at 16 nested containers. Incomplete JSON produces a
507 reconciliation response; deliberate non-2xx legacy text errors retain their
status. State and diagnostic builders initially reserve 6144 bytes; they can grow
within the shared 8192-byte response limit. Initial reservation failure returns
an explicit 503 before serialization, with no mutation. Status builders are
appended separately to avoid simultaneous large temporary copies. Successful
state replies also require every catalog/color/option entry and exactly three
VU/Fountain colors; valid but shortened arrays fail closed with 503. Production
handler tests exercise allocation failure, missing whole fields and transient
whole-row omissions, then fresh-read recovery without persistence. The tested
worst state is 8082 bytes; the full diagnostic reply is 8096 bytes, including
32 durable positions and eight peer hints. Their 110/96-byte margins require
a bound regression check for future field additions.

### Tenth controlled candidate: failed physical acceptance

The application-only installed and read-back verified 1.15.1 image is
`384bbd2e2be32cf6a0397e2dfca8e990ed326b94510b35dc10c1cbbd2959d603`,
2019248 bytes. Its frozen build, source, installation proof, complete controlled
run, independent audit and post-run health checks are preserved under
`.build/animation-continuity-1.15.1-384bbd2e/`, with an evidence digest inventory.
There was no settings or router change, and no publication.

One physical lamp completed64 direct-Wi-Fi HTTP profiles;44 passed.423/432 normal
reads succeeded, and all64 diagnostic and revision checks succeeded. An actual
abort occurred at500.938 seconds, followed by an observed uptime/frame-counter
restart. Subsequent trials correctly failed the original boot-session fence.
The last pre-restart USB sample was at500.063 seconds and the first post-restart
sample at505.250 seconds. Firmware show-return gaps in continuously captured
healthy warm windows were at most48185us before restart and49024us after the
new boot's health anchor, with zero warm overruns in each. These measurements
exclude the restart interruption. Separate cold cumulative maxima were368177us
and669496us, with two overruns each; they must not be combined into one boot.
The final USB snapshot passed the fresh-end fence (age187ms, after HTTP work).

The exact frozen ELF resolves abort PC`0x40381a43` to `lock_init_generic` after
`xQueueCreateMutex` returns null. The deliberate panic trap and return address
do not identify its caller. No cause is attributed to TickHook, USB formatting,
TCP ACK loss or a phone route without further evidence. The first boot reported
a92-byte historical minimum heap, despite sampled free heap being higher.
That transient resource failure and the restart fail the acceptance gate.
After the run, all18 protected normal read checks and a bounded USB Bluetooth
status query succeeded. Recovery does not convert the failed run into a pass.
The earlier human report that Settings opened and animation stayed smooth was
for sixth`f508` image; it is not native-phone evidence for this tenth image.

The subsequent read-only capture of the existing crash partition resolves the
caller. The CRC-verified C3 ELF dump, matching nine-character SDK ELF hash
prefix, full local ELF/application-descriptor hash and exact installed-image
readback bind the diagnosis to this candidate. The failed first allocation was
64 bytes in the SDK mDNS receive callback. Its error log then tried to create
the UART VFS recursive mutex, which also failed and aborted. The bounded
backtrace continues through IP input to the TCP/IP task. The updater was
waiting for a notification, the HTTP cleanup worker was waiting on its queue,
and the Arduino loop was servicing mesh. This proves cascading memory
exhaustion; it does not identify every simultaneous heap owner or establish
the original phone incident's route.

Only code addresses, trusted symbols, aggregate format/hash checks and
redacted read proof are archived. The raw crash dump contains private RAM and
remains in the ignored USB evidence directory; it must not be published or
committed. The source diagnosis does not justify suppressing SDK error logs or
precreating mutexes as a substitute for adequate memory margins.

The next controlled candidate removes the permanently allocated HTTPS worker.
The existing full-loop handoff creates its unchanged 8192-byte stack only for an
admitted internet operation. After all scoped TLS work and destructors finish,
the worker publishes completion with release/acquire ordering and blocks; the
loop deletes it and clears the handle before another request. A live handle
continues to fence update ownership even if the reported phase has already
become Idle, Available or Error. Bluetooth/manual receivers allocate no HTTPS
worker. Task-creation failure cancels the queued job and reports UPDATE_MEMORY
without starting a transfer.

The pinned target task-control block is 348 bytes, so idle reclamation is 8540
bytes of stack/task payload, excluding allocator overhead. Automatic discovery
checks 45508 free/33116 largest bytes both before accepting and after the loop
handoff, including that future worker. Its existing active background floor is
36968/24576; explicit active TLS retains 24576/16384. These separate admission
checks are not reservations or evidence of a viable OTA path. Control admission
is now 24 KiB: the measured 16096-byte worst moving-String peak plus 8 KiB of
headroom fits within that floor, before allocator/SDK/radio variation. The
initial 6160-byte contiguous requirement is unchanged to retain fragmented-heap
availability for ordinary 6 KiB replies. Three TCP receive windows can still hold
17280 payload bytes plus SDK overhead; SO_RCVBUF does not cap the pinned TCP
receive callback. Sustained margins therefore require a new physical run.

Forty production updater lifecycle scenarios cover creation failure, completion
after TLS destruction, cancellation, offline/clock errors, repeated jobs,
background rechecks and manual-receiver exclusion. Production HTTP/BLE/mesh
and control-handler cases verify denied commands do not decode, persist or
execute, preserve original deadlines and never execute later as a duplicate.
Legacy mesh `executed:true` denotes a consumed target transaction and can
accompany a terminal 503; the exact response status/body determine its outcome.
It is not proof that a mutation was applied. Prior uncertainty always requires
reconciliation, irrespective of a later resource-denial response.

## Local diagnostic builds must not donate to the fleet

The source audit found that a running image with `COOL_LAMP_PUBLIC_RELEASE` and a matching `COOLLAMP-PUBLIC-<version>` marker can advertise its incrementally measured image to trusted fleet receivers. When publisher enforcement is off, this does not require a published release or donor automatic-update opt-in. An older, same-fleet receiver with automatic updates enabled can accept the offer if its update policy and rollout gates allow it. This is a source-backed risk; it is not evidence that another lamp installed a diagnostic candidate.

Use `node tools/build-firmware.cjs --public --test-image --stack-usage` for local diagnostic candidates. This adds `COOL_LAMP_TEST_IMAGE`, isolates staging/cache/output under `sketch-test-image`, `cache-test-image` and `firmware/test-image`, and disables donor offers, authenticated donor requests and `donorEligible`. Installed-image measurement for postboot health and existing receiver paths remain enabled. The authenticated relay status exposes the test-only `COOLLAMP-TEST-IMAGE-<version>` marker. No automatic-update preference or NVS ownership state changes.

Normal `node tools/package-firmware.cjs` rejects any image containing the test marker, including a test binary accidentally copied into the public directory. Explicit `node tools/package-firmware.cjs --test-image` writes `firmware/test-image/coollamp-test-manifest.txt` for controlled local validation. It does not create a public release manifest. Public build and packaging defaults remain unchanged. Production relay tests exercise measured test-image health, no offering, a valid delayed authenticated donor request, and successful receiving in both legacy and publisher-verified modes; packaging tests exercise publication rejection and exact local digest binding.

## Eleventh diagnostic image: control succeeds, timing and margin gates fail

The authorized application-only image is version 1.15.1, SHA-256
`d942cfd1a4511f387ca0c275809e97e2c11cb38ac3f9b5a11cf1c24283e64850`.
It is 2,019,168 bytes, with 12,448 bytes of OTA-slot margin and 94,204 bytes of
static globals. All 33 firmware contract commands and eight release-guard tests
passed. Independent attestation checked all 125 current/staged/archived source
hashes, actual compiler flags, partition/bootloader identity and normal packaging
rejection. Application readback matched exactly; boot/partition/OTA metadata and
saved user settings were preserved. Donation of this diagnostic image is disabled.

The full direct-Wi-Fi HTTP run completed 64/64 profiles and 503/503 normal reads
(256 state, 247 effects). All 64 diagnostic and revision reads succeeded in the
same boot session. Successful normal-read median/p95/maximum were
797/922/2329 ms. Eighteen further protected reads and the bounded USB Bluetooth
status query succeeded after the fixture closed. No settings or router changes
were made. The lamp remained on its saved 134-LED Corkscrew/Fire/brightness-100
configuration; automatic-update preference remained enabled.

This is not a physical acceptance pass. USB capture had a 237.844-second gap
between host seconds 68.328 and 306.172. The stream resumed without a reopen;
337 samples were captured, but 45 complete five-second sequences and completion
of another sequence were missing. Captured warm show-return maximum was
47.920 ms, with no additional 100-ms overruns. Cold startup retained its
377.351-ms maximum and two overruns. There is no exact whole-workload warm
maximum or optical measurement. USB silence is not itself proof of an animation
freeze, RX delivery failure or host/controller failure.

Sampled free heap/largest block reached 15,640/7,668 bytes, with loop/cleanup
stack high-water free minima 2,724/1,012 bytes. The reported sum of regional
historical heap minima fell to 84 bytes after the missing capture interval.
This does not prove simultaneous total free heap reached 84 bytes. It cannot
establish the desired transient margin, despite successful normal reads and no
detected reboot or captured panic. Cleanup recorded 768 queued/attempted, zero failures, 98 forced
aborts and a drained final queue. Its maximum observed age was 5,637 ms.

The aggregate HTTP maximum connection age was 5,527 ms. It combines ordinary
requests with the mapped HTML route, whose explicit deadline is 15 seconds.
Consequently the conservative ordinary-five-second audit gate cannot pass from
this aggregate; it does not prove an ordinary deadline was extended. Measured
HTTP service/handler maxima were 31,159/30,469 us. The 2-ms transport turn budget
applies between socket operations, not across an entire synchronous handler.

Immutable ignored evidence is under
`.build/animation-continuity-1.15.1-d942cfd1`; the independent physical audit and
all failures are retained. The earlier successful native Settings/animation
observation belongs to the sixth `f508` image, not this one. iPhone/Android route
capture, genuine mesh/donor/update recovery and twenty physical lamps remain
separate pending gates. No publication was performed.

The subsequent bounded revision makes mapped HTML sends use the same 24-KiB
floor as control replies and yields to requests still receiving headers or
upload data. Existing request, ACK, upload and HTML deadlines are unchanged.
Four new actual-server scenarios verify the 20–24-KiB no-enqueue band, incoming
request priority and bounded timeout cleanup followed by byte-exact 24,012-byte
page completion. All 55 server scenarios and ten ACK-policy comparison runs
pass. This corrects an admission-policy mismatch; it does not establish the
cause of the 84-byte low-water mark or the USB gap.

### Heap measurement semantics

The pinned core's `Esp.cpp:164–169` implements `getFreeHeap()` with current
`heap_caps_get_free_size(MALLOC_CAP_INTERNAL)` and `getMinFreeHeap()` with
`heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL)`. The pinned IDF
`esp_heap_caps.h:221–239` documents that the latter adds each heap region's
separate historical minimum, which may occur at different times. For example,
two regions alternating between 100/15000 and 15000/100 free bytes always total
15100, but report a sum of minima of 200. Runtime-added heaps have separate
limitations described by that API.

Keep the reported counter and 8192-byte target. A conservative sum at or above
8192 can supply a lower bound for the represented regions/capabilities. A sum
below 8192 is inconclusive about a simultaneous global dip; sampled current
values also cannot exclude between-sample transients. Record instantaneous
heap/block observations at bounded service boundaries and failed-allocation
events before claiming the transient floor or attributing a low number to one
handler. The tenth-image dump's actual 64-byte allocation failure remains
independent evidence of resource failure. These SDK counters are not reserved
memory and do not establish TLS, radio or twenty-lamp viability.

This qualification also applies to historical `minFreeHeap` values in earlier
candidate reports and this document. Raw, sealed evidence is retained; a small
sum alone must not be relabeled as an instantaneous allocation failure.

## Twelfth diagnostic: complete HTTP workload, missing final timing capture

The twelfth version 1.15.1 image is
`f711bb64abb59c922d548b16d84394e6775ee4802b442053b45d6f4687dc7b90`.
It is 2,019,152 bytes, leaving 12,464 bytes in the unchanged OTA slot; static
globals are 94,204 bytes. All 33 contract commands, eight packaging guards,
actual target compilation and independent source/artifact attestation passed.
The application-only flash was read back exactly. Bootloader, partitions, OTA
metadata and the saved NVS prefix remained byte exact. Diagnostic donation is
disabled and normal publication packaging rejects this image.

Pink Corkscrew completed all 64 direct-Wi-Fi HTTP profiles: 504/504 protected
normal reads (256 state, 248 catalog), 64 diagnostic and 64 revision reads.
Every checked boot session matched. Successful normal-read median/p95/maximum
were 766/906/2250 ms. No reboot or panic was detected. The router and saved
134-LED Corkscrew/Fire/brightness-100/startup/automatic-update state were not
changed. Eighteen protected post-run reads and the bounded USB status query
succeeded after the fixture closed and the USB port was reopened.

USB produced 514 samples over 848,880 bytes. Captured sample gaps were at most
1.141 seconds until host second 547.562, then replies stopped for the remaining
60.563 seconds. Fifty-five successful host polls received no response. The
fixture recorded zero short writes, write timeouts or JSON parse failures;
successful host writes are not proof of device RX or host receipt of device TX.
There were 106 completed five-second timing windows without an internal missing
sequence, followed by the missing end tail. Fresh-end timing acceptance failed.
Post-run recovery after reopening is a separate result, not missing evidence.

The captured warm show-return maximum was 47.786 ms with no additional 100-ms
overruns. Cold startup retained 659.793 ms and one overrun. These are firmware
timestamps on physical hardware, not optical measurements; neither the final
tail nor an exact whole-workload warm maximum was measured. USB silence alone
does not establish an animation freeze or identify a USB driver/host fault.

Sampled current heap/largest block minima were 16,636/7,668 bytes; loop/cleanup
stack high-water free minima were 2,724/996 bytes. The reported historical
regional heap minimum sum was 96 bytes. Read this with the SDK caveat above:
transient total margin remains unverified. Only 136 explicit-path admission
snapshots were eligible; no background pre-create sample established automatic
HTTPS viability. These measurements do not validate an update transfer.

The final authenticated HTTP diagnostic extended counters beyond USB capture:
768 accepted, 98 cancelled and 80 deadline exits. The last USB cleanup sample
recorded 698 queued/attempted, zero close failures, 90 forced aborts and no
pending descriptor; its maximum observed age was 6,014 ms. HTTP service/handler
maxima were 31,618/31,041 us; receive/send maxima were 208/1024 bytes. The
aggregate connection maximum was 5,904 ms and includes the 15-second mapped
HTML route. A route-specific ordinary-five-second deadline cannot be proved or
disproved from this untagged maximum. The conservative audit remains failed.

The immutable ignored archive `.build/animation-continuity-1.15.1-f711bb64`
contains 196 files with a digest inventory, independent artifact and physical
audits, installation/readback proof and the separate corrected heap
interpretation. Raw NVS backups and RAM crash dumps are excluded. No publication
occurred. Native iPhone/Android route capture, genuine multi-hop control,
donor/update interruption and twenty-lamp physical acceptance remain pending.

## Standalone catalog completeness under allocation failure

The final read-path audit found that v1 `/api/effects` used unchecked `String`
appends. A failure inside a JSON-escaped name can leave syntactically valid
JSON with a shortened name, so transport syntax validation alone is insufficient.
The production handler now checks each append, required fields, exact sequential
wire ID, canonical escaped name and final available-effect count without adding
an allocation for validation. An incomplete reply returns 503 and changes no
lamp state. Successful v1 IDs, names, order and JSON remain byte compatible.

The pinned core 3.3.11 `WString` fixture exercises the actual handler and every
single allocation-failure boundary for both 38 base and 47 audio catalogs:
219 + 272 new cases all return 503. The existing 677 builder-failure cases
remain green. A private negative canary disables only canonical-name validation
and reproduces 13/15 valid but incorrect-name success replies, demonstrating
that the positive test exercises a real failure path. Successful base/audio
catalogs are 2,354/2,933 bytes, with measured String-payload peaks of
4,736/5,904 bytes. Host allocator and SDK/radio overhead remain outside that
measurement. This is a separate bounded software milestone, not an explanation
of the original Settings timeout or USB capture loss.

The same actual-handler fixture covers quotes, backslashes, UTF-8 and control
characters using the exact legacy `jsonText` encoding. A wider loop index and
three-digit comparison safely terminate at the wire type's 255 boundary. The
synthetic 255-entry fixture is handler-only and emits 15,989 bytes: the existing
8-KiB transport limit still rejects an oversized catalog. It does not increase
the advertised 38/47-effect capacity or establish compatibility of other legacy
loops with a larger catalog. Expansion requires separate negotiated limits.

## Final thirteenth image and short physical canary

Installed local diagnostic version: **1.15.1**. Exact image:
`a6c39e5e0d9ef4e0d688ee349f12e44766166fdd61a29fdda086d4f81f65d75b`,
2,019,904 bytes; test manifest SHA-256
`f61b0ead5fd53a5f7bbf5b72c2e239d0d1ae5ffd40d6679a4746f62bb428ffae`.
It leaves 11,712 bytes in the 2,031,616-byte slot; program use is 2,019,752
bytes and static globals 94,204. All 125 current/staged/archived source hashes,
33 final contract commands, 31 actual diagnostic compiler entries, target type
layouts and normal-publication rejection were independently checked. Sixteen
legacy C++ regressions and eight fresh release/trust guards also passed. Worst
state/diagnostic replies remain 8,082/8,096 bytes within the 8,192-byte limit.
The mobile source set is unchanged from the earlier 734-test/production-build
checkpoint; this firmware milestone adds no visual client changes.

The separate normal build also passes with the same 125 source hashes and 31
actual PUBLIC/no-TEST sketch compiler entries. Its 2,020,592-byte image leaves
11,024 bytes in the slot; program use is 2,020,452 and static globals 94,212.
Image SHA-256 is
`10218a28628724c2f4fca45b670e28ea2d6d4fab276eeb51197dc199e780bb9d`;
local manifest SHA-256 is
`fc239b2238f03c9f3cc71d09889cd92533d36b51ab887073d4f54278a3e9cd60`.
This normal image is unsigned, uninstalled and unpublished; no production
publisher roots are provisioned. Packaging and compiler success do not unblock
physical/native, signing, manufacturing or bootloader gates. Only the isolated
donation-disabled test image was installed on Pink Corkscrew.

Flash verification read back the full application at `0x10000` and matched its
digest, then checked the unchanged boot/partition/OTA metadata and NVS prefix
before restart. Saved 134 LEDs, Corkscrew style, power/brightness, Fire startup,
colors, ownership, network and automatic-update preference were preserved. No
router, credentials, hardware settings or lamp configuration were written by
the read-only workload.

This image ran **one round of eight profiles**, not the 64-profile long gate:
partial/trickled request lines and headers, stalled request body, stalled HTML
and state readers, and abrupt disconnects. Two slow peers competed with normal
protected traffic. All profiles passed over 64.218 seconds of active exposure;
63/63 normal reads (32 state, 31 effects), eight diagnostic and eight revision
reads succeeded with the original boot session. Normal-read median/p95/maximum
were 781/906/2250 ms. Every normal read retained its full seven-second request
budget; no missing reply was retried as a mutation.

USB recorded 75 samples/122,664 bytes and 75 polls, with no short writes,
timeouts, parse errors, silence event or reopen. Completed five-second sequences
7–21 and the final partial sequence 22 were captured, covering 75 seconds of
completed windows around the workload. Maximum sample gap was 1.110 seconds.
The final sample at host second 78.844 followed HTTP completion at 76.609 and
was 765 ms old at host end 79.609, passing the explicit fresh-end fences.
The measured warm show-return maximum was **48.076 ms**, with zero new 100-ms
overruns. Cold startup retained **672.025 ms/one overrun**. These are real
hardware firmware timestamps; no optical or logic-analyzer timing was taken.

Minimum sampled current free heap/largest block were 16,772/7,668 bytes; loop/
cleanup stack free minima were 2,724/1,036 bytes. The historical regional minimum
sum was 1,472 (20,528 at the anchor), with the non-simultaneous semantics above.
This verifies the 8,192-byte target at captured current samples, not allocation
transients. No background/pre-create HTTPS sample was eligible; one explicit
sample was eligible. No actual TLS/update/donor viability follows from that.

Cleanup ended at 102 queued/attempted, zero failures, 12 forced aborts and zero
owned pending descriptors; maximum observed age 5,627 ms. Actual send
backpressure was observed. Receive/send maxima were 134/1024 bytes; service/
handler maxima 31,347/29,941 us. Aggregate connection/idle maxima were
5,527/1,506 ms. The connection aggregate includes the 15-second HTML route;
its conservative check uses 657 ms of whole-boot observed loop slack, including
startup. It is not a route-specific ordinary-request deadline measurement.

The independent private auditor initially compared an elapsed body-receipt
duration with a trial-relative timestamp. That incorrectly failed one criterion
despite complete reads. Its correction, production-shaped late-launch regression
and 33 failure-criteria tests are retained beside the initial report. Firmware,
traffic and captured evidence did not change. The corrected canary audit SHA-256
is `94a66168028191f84289adea5070224d5c0eac19eb7ae6df456b5ff3c5604640`.
Eighteen post-run protected reads and the bounded USB status query passed after
capture closed. After this final image was installed, the user confirmed
**Settings opens; animation continues smoothly** on Pink Corkscrew. The report
is recorded separately in
`.build/pink-1.15.1-a6c39e5e-native-settings-observation.json`; the sealed canary
archive is unchanged. No transport, handset platform or numeric frame timing
was captured for that phone interaction. Earlier native success remains bound
to the sixth image; this is a new final-image human observation.

The sealed ignored archive `.build/animation-continuity-1.15.1-a6c39e5e`
contains 216 digest-indexed evidence files and both normal/test resource proofs.
It excludes raw NVS and RAM dumps. This canary passes its declared scope;
full-64, sustained transient margin, native BLE/Wi-Fi handoff, genuine mesh,
donor/update recovery, actual rollback and twenty-lamp physical acceptance remain
pending. Earlier long-run USB reply loss remains unexplained. No publication
occurred and no release acceptance is claimed.

### Next controlled gate

Keep Pink Corkscrew's settings/router unchanged. Repeat the full eight-round
workload using this frozen digest, `--rounds 8`, and at most one existing
guarded `--maximum-usb-reopens 1`. The capture checks target/boot session before
and after a reopen and checks recovered USB uptime. Record any missing window
as missing; recovery cannot fill it. Use the distinct full-run filenames so this
short canary is never overwritten. Obtain independent optical/logic-analyzer
timing for the full interval, then capture the verified iPhone and Android route
while opening Lamp Designs. The broader matrix in
[`experience-physical-acceptance.md`](experience-physical-acceptance.md) covers
actual LED/calibration changes, BLE/mesh, updates, group dissolution and twenty
mixed lamps. Those configuration/update fixtures need their own authorized
scope; they are not inferred from these read-only connection checks.
