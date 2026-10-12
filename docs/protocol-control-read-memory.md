# Counted control reads and memory admission

This software milestone preserves the existing JSON and wire versions. It does not validate radio range, native phone interoperability, frame gaps, or the installed candidate on a physical lamp.

The old shared 24 KiB admission floor blocked both complete BLE RPC reads and HTTP dispatch while audio was running. The incremental HTTP server could then reach its unchanged five-second request deadline without executing the read or sending headers. The source-backed failure is distinct from identifying every cause of an app connection failure or a rendering interruption.

## Ownership and bounded replies

`LampJsonSink` evaluates one checked encoder in count mode, reserves one exact Arduino String output allocation, then evaluates it in write mode. Every append and escaped string is checked; overflow, allocation failure, count mismatch, invalid JSON or an incomplete captured leaf discards the whole reply. The existing 8,192-byte reply ceiling remains. There is no permanent 8 KiB scratch allocation. The separate direct household ceiling of 12,288 bytes is unchanged.

The firmware captures update-worker status, audio features, radio counters, time windows and network addresses before the two passes. Other appearance and membership data remain owned by the loop. BLE paging retains the finished immutable response rather than evaluating a new snapshot on every page. HTTP retains and moves the finished response through its existing bounded send lane. No read stops microphone capture, changes the radio, scans, calibrates, saves NVS, begins an update or pauses rendering.

The safe read whitelist comprises HTTP GET state, firmware, catalog, descriptor, revision and diagnostics; trusted BLE/mesh state, group, firmware, catalog, descriptor and revision reads; and the existing semantic read-only POST schema, receipt and group-page contracts. Their methods, authentication, tokens, target checks, receipts and request bounds are unchanged. Actual mutation and unclassified handler admission retains the existing 24 KiB free/6,160-byte contiguous floor. A failed or missing mutation reply still requires reconciliation and must never be replayed on a new route automatically.

## Admission formula

Core 3.3.11 rounds a String allocation as `(replyBytes + 16) & ~15`.

* Read dispatch requires 8,192 bytes of SDK/radio headroom, 512 bytes of formatting allowance and 2,048 bytes for captured leaf Strings: 10,752 bytes before form overhead.
* Retained decoded forms add one rounded form allocation plus 768 bytes for the two rounded key/value allocations in each of 24 fields. BLE admission additionally includes its form copy. HTTP raw staging is already included in current free heap. Forms remain bounded to 1,024 bytes.
* After capture/form allocations, the reply itself requires its exact rounded allocation plus 8,192 + 512 bytes of remaining headroom, and a contiguous block large enough for that allocation.
* Previously retained HTTP/BLE replies are included in current heap measurements; none are excluded from these checks.

The 512-byte formatting and 2,048-byte capture allowances are bounded application allowances, not a reservation or a promise about later SDK allocations. Pinned String allocation fixtures and target compiler layouts document their software evidence. Runtime minimum heap, largest block, task high-water marks and frame gaps still require physical measurement.

Known read-resource refusals are explicit 503 responses: `Read resources unavailable. Nothing changed.`, `State response memory unavailable. Nothing changed.`, `Diagnostic response memory unavailable. Nothing changed.`, `Effect catalog incomplete. Nothing changed.`, and `Schema response memory unavailable. Nothing changed.` Invalid requests retain their normal authentication/400 outcomes. Initial BLE denial retains `Control resources unavailable. No command executed.`; the trusted adapter retains `Control resources unavailable. This request was not executed.` A valid read refused for memory does not wait five seconds without headers or mutate the lamp.

## Evidence and next gate

The pinned 3.3.11 WString production-handler fixture measures String payload allocations with moving reallocations and return elision disabled. Its frozen canonical JSON digests preserve the previous full state, diagnostics and 38/47-effect catalogs. Allocation failures are swept through production encoders, including nested captured leaves. Host pointer/SSO sizes, allocator metadata, transient SDK allocations and radio behavior are outside that measurement.

The four-member profiles distinguish expanded v3 and observed v2 topology with default appearance from maximized stored appearance. They model 16,316 free bytes and a 7,668-byte largest block. Actual saved colors/options cannot be reconstructed from the existing diagnostic record, so fixture success is not a claim about the exact physical target. A maximized reply which lacks safe heap or contiguous space returns 503 honestly.

Target compiler layout evidence is `.build/low-memory-reply-layout.cpp.001l.class`: firmware snapshot 120, audio snapshot 72, group snapshot 136, timing snapshot 112 and HTTP counters 60 bytes. Static per-function stack reports are separate from total call-chain and measured task stack evidence.

Before a separately authorized canary flash, review the exact normal and donation-disabled test image digests, unchanged OTA slot and NVS contract, source hashes, complete host gate and target stack reports. With router/settings held constant, repeat authenticated settings/diagnostics/catalog reads while an audio scene runs, including a competing slow client; then measure heap/largest block, frame gaps, identity/version and preserved appearance. Mutations remain separately gated and are not proved available at the read-only memory threshold.

## Frozen normal-build checkpoint

The frozen 126-file source set builds with Arduino core 3.3.11/FastLED 3.10.5. Program use is 2,024,360 bytes, a 3,908-byte increase. Static globals remain 94,212 bytes, with no static-RAM delta. The packaged normal application is 2,024,512 bytes and leaves 7,104 bytes in the unchanged 2,031,616-byte OTA slot. It is a budget/compatibility artifact, not the physical-test candidate or a publication.

Normal image SHA-256: `ec5e4814bb7ae0543732717438c8f986b53c63199184dabd70b81ca46c386c8b`. Manifest SHA-256: `1d68a840650304693818d1eac1c45adbe986bb23f2a6ff94abeec7de69e5fe65`. Provenance and archived compiler stack reports: `.build/counted-control-read-1.15.1/normal-build.json` and `resource-budget.json`.

The CoolLamp 2-like v2 fixture uses observed 134 LEDs/four members/scene 24/mode 46/brightness 55 and production default appearance. Its 47-effect state is 6,653 bytes with a 6,656-byte reservation and a 7,456-byte added String-payload peak; diagnostics are 5,853 bytes with a 5,856-byte reservation and a 6,768-byte peak. From the modeled 16,316-byte start, the remaining modeled payload budget is 8,860/9,548 bytes respectively. This excludes target allocator/SDK overhead and is not a measured physical minimum. Maximized v2 appearance and 32-member worst replies are refused at that heap/largest-block fixture.

## Frozen test-image checkpoint

The same 126 source hashes build with `--public --test-image --stack-usage`, followed by explicit `package-firmware.cjs --test-image`. Program use is 2,023,708 bytes and static globals are 94,204 bytes. The diagnostic application is 2,023,856 bytes, leaving 7,760 bytes in the same OTA slot. Its partition table exactly matches the archived normal build. The diagnostic marker disables firmware donation; normal publication packaging rejects this image. Credential exclusion and exact manifest/image checks passed.

Test image SHA-256: `a00f4512c4a7e7f8a4967f1f502d5279471e13b089eecbbf59dab244e3851aef`. Test manifest SHA-256: `56331724564dcabf52382e687bc0fc096f226294734277ed296232458107f6fb`. Provenance, archived artifacts and per-function stack reports are in `.build/counted-control-read-1.15.1/test-image-build.json` and `test-image/`. This is an unpublished, unflashed physical-test candidate; host checks do not establish a safe measured runtime heap margin or successful phone update.

## 2026-10-12: typed capture after a physical Settings refusal

The preceding sections are historical checkpoints. A later private standard-build 1.15.2 candidate was installed on CoolLamp 2, and a clean iPhone Settings attempt was refused for read memory. The user reported that selecting the gear began Bluetooth connection, then displayed a memory message. The refusal concerns opening Settings; it does not establish that a settings save was attempted or failed. Publication of that candidate remains held.

A subsequent read-only USB diagnostic measured 15,508 free bytes and a 7,668-byte largest block, with firmware phase/error both zero and the boot-health gate satisfied. This is an idle measurement after the attempt, not the serializer's instantaneous peak. The private evidence is `.build/firmware-1.15.2-release-page-20261011/settings-read-refused-runtime-summary.json`. Its lifetime animation-gap maximum includes other activity and cannot identify the failed phone request's gap. The revised capture described below has software evidence only; a rebuilt image, controlled native Settings check and resource measurements are still required.

The revised code reduces heap overlap while preserving the complete response:

* `LampUpdateAttempt::captureStatus()` captures the existing attempt fields in a three-byte typed snapshot; `appendStatus()` writes their existing JSON. It retains the version, capacity, reason values and uncertainty semantics.
* `captureLampUpdatePolicyJson()` captures validated policy data, revision, eligibility and coordination once. Its bounded snapshot is at most 84 bytes. Both count and write passes use those captured values; they do not re-evaluate time or read storage. `LampUpdateJsonSnapshot` retains numeric latest-version components and typed attempt/policy leaves instead of retained JSON Strings, and is bounded to 256 bytes.
* The group incarnation is captured into a 33-byte character array. Failed capture still refuses a grouped response; it does not silently remove the incarnation or membership fields.
* `sendLampState()` captures identity into 13 bytes, and hostname plus four addresses into five 64-byte arrays. Address capture uses core 3.3.11 `IPAddress::printTo()` and a bounded `Print` writer directly, preserving the previous IPv4/IPv6 format and default zone handling without an address String allocation. Overflow, empty output or a mismatched byte count fails the read rather than truncating it. Identity/hostname text also rejects embedded NULs and overflow. Style code and constant ID/family are encoded directly, without a retained style JSON allocation.

There is still one count/write encoder and one exact finished reply allocation. The wire versions, legacy fields and field order, complete effect names/order, appearance arrays, authentication, target checks and immutable BLE paging are unchanged. The read reply ceiling remains 8,192 bytes. The 8,704-byte post-capture reply headroom and the separate 24 KiB/6,160-byte mutation admission floor are unchanged. This is a read allocation change, not a claim that durable saves are available at 15 KiB.

The archived production-handler fixture report is `.build/settings-memory-20261012/typed-status-builder-report.json`. It pins the Arduino core 3.3.11 String sources and the tested production-source hashes. The host run disables return elision, forces moving reallocations, checks legacy payload projection digests and sweeps allocation failures through the actual encoders. A second run changes only the test String's inline-storage model to the ESP32-C3's 15-byte SSO array; this is an ABI model, not a measurement of ESP32 heap, allocator metadata or SDK allocations.

| Connected 47-effect state fixture | Response bytes | Host String-payload peak | 15-byte SSO model peak | Remaining modeled bytes: host / SSO |
| --- | ---: | ---: | ---: | ---: |
| Authenticated HTTP, 32-byte token | 6,768 | 6,784 | 6,800 | 8,724 / 8,708 |
| Private Bluetooth reply | 6,725 | 6,736 | 6,752 | 8,772 / 8,756 |

Both connected fixtures start at 15,508 modeled free bytes with a 7,668-byte largest block and preserve IPv6 DNS. The HTTP SSO model exceeds the unchanged 8,704-byte headroom by only four bytes. Passing this admission model does not guarantee a physical margin or successful native connection under concurrent SDK/radio activity. These replies have no complete-response String copy; every one of their two host and five SSO-model allocation-failure boundaries returns a failed read.

The observed four-member/v2 topology fixture uses 134 LEDs, scene 24, mode 46 and brightness 55, with production default appearance and fabricated public names. Its saved appearance is not an exact reconstruction of the lamp. The 47-effect state is 6,739 bytes, with a 6,752-byte host payload peak and a 6,768-byte SSO-model peak. The unchanged 38/47 catalogs and legacy projection digests pass. At the separate 16,316-byte fixture, maximized four-member v2 appearance is now accepted at 6,893 response bytes/6,896 host payload bytes; a worst-case 32-member response still refuses safely. This does not establish twenty-lamp capacity or physical RF performance.

`tests/network-address-runtime.py` separately compiles the pinned core's actual IPAddress, Print, Stream, StreamString and WString sources. Its 136,026 allocation-free address captures match legacy `toString()` formatting, including IPv6 compression and default zone exclusion. All 133,965 destination-size checks from zero through 64 bytes retain canaries and reject overflow. This closes the SDK-formatting gap in the platform-snapshot fixture; it remains a host check, not RF or target heap evidence.

The standard candidate was subsequently built and installed on CoolLamp 2: 2,028,848 bytes, SHA-256 `33b375e6d95d60d6a77e5b01970e5547ffe45de1deb0b8575bde708b6f1dc88b`. Application-only readback matches and the entire NVS/boot prefix is byte-exact before restart. A later authenticated 6,294-byte Wi-Fi state read completed in 0.796 seconds, preserving the current lighting fields and all 47 effects. The full confirmation smoke also passes, including running-image digest and the exact compressed page. Initial header-only/timeout records remain failed evidence; an unexpected restart with reset reason 4 (panic) was observed without a captured trace. A later 60-second passive capture and repeated reads did not reproduce it.

The release gates remain a clean iPhone Settings test with the lamp undisturbed throughout the attempt and resolution/acceptance of the observed runtime instability. The private source-freeze helper separately refuses pending runtime stability even if Settings opens. Read success, durable mutation availability, frame-gap targets, Android interoperability, concurrent-client behavior and fleet scale remain separate acceptance claims. This candidate is physically installed and its computer reads have passed; native acceptance is pending and it is unpublished.

## 2026-10-12: captured SDK abort and bounded transport revision

The user subsequently reported that Settings eventually opened after a transient rejection message. This is not a clean native acceptance result. The retained 16,900-byte core record passes its bounds and CRC32 checks. Its nine-character ELF-hash prefix, `678b07b35`, matches the archived ELF SHA-256 `678b07b35e39fbf467e33cb9840742b022dfbf62d6420eeb9ebfbe2c49b5ca85`. That full hash also matches the application descriptor in the exact installed `33b375e6…` image above. The core stores only a 36-bit prefix; that prefix alone is not full cryptographic image authentication. Offline decoding exposes code locations and trusted ELF symbols only, retaining raw memory and debugger output privately.

The exact ELF control flow establishes a failed 64-byte internal mDNS receive allocation. Its error logging then reaches the UART VFS's first recursive-mutex allocation; that allocation fails and calls `abort()`. The RISC-V illegal-instruction field is the deliberate `panic_abort` mechanism, not evidence of corrupt application instructions. This trace does not establish the request route, every simultaneous heap owner, or that Settings serialization caused the underlying shortage. The pinned SDK's [mutex allocation](https://github.com/espressif/esp-idf/blob/b774170ff46/components/newlib/src/locks.c) and [UART VFS locking](https://github.com/espressif/esp-idf/blob/b774170ff46/components/esp_driver_uart/src/uart_vfs.c) agree with the archived binary's branches; repository and binary debug line numbers differ.

The next candidate adds three narrow changes:

* [LampPlatformLogPriming.h](../LampPlatformLogPriming.h) calls `primeLampPlatformLogLocks()` immediately after serial initialization, before delay, persistence, audio or radio startup. Public POSIX zero-byte writes attempt both stdout and stderr and report failure through the boolean result, without emitting characters. The supported [USB VFS nonblocking API](https://github.com/espressif/esp-idf/blob/b774170ff46/components/esp_driver_usb_serial_jtag/src/usb_serial_jtag_vfs.c) primes both secondary-console locks even without a USB host, selecting the pinned SDK's existing default callbacks. Arduino HWCDC and radio configuration remain unchanged. These persistent mutexes consume memory; priming addresses the observed lazy-lock abort, not all out-of-memory conditions.
* `LampHttpSocketCleanup::MaxTransmitFlightBytes` is now 384 bytes instead of 1,024. The next application write still waits for the prior copied TCP flight to drain. The production transport fixture compares both caps under simultaneous modeled TCP/Wi-Fi copy pressure; this is software evidence, not attribution of physical heap use. Request, idle and total deadlines, authentication, mutation admission and response contents remain unchanged.
* Whitelisted BLE read refusals use immutable allocation-free 503 text through the existing transfer owner. This covers read admission, form allocation and successful-read retention failure, including an empty known-503 body. Paging preserves the transaction, endpoint and session; expiry, authorization loss, update entry and generation changes release it. Repeated Commit never executes again. Unclassified requests, other errors and mutation uncertainty retain their existing behavior.

## Security and client paging audit

Removing application authentication flags does not release the pinned NimBLE
security pools already allocated at host initialization. Inspection of the
`70b436...` candidate's exact ELF identifies security-manager allocation payloads
of 40, 400 and 44 bytes, an optional 96-byte Secure Connections key context, and
824 bytes for the mixed bond/CCC store. The 10,752-byte MSYS payload pools remain
necessary for plaintext Bluetooth too. These are binary/source allocation sizes,
not measured total savings; allocator overhead and controller memory are separate.
Production fleet AES-GCM uses a 392-byte stack context and the hardware AES key
path. Its commissioning ECDH context and limbs are cleared when inactive.
Disabling these protections would not remove the retained 6 KiB Settings reply.
Setup and administration also carry Wi-Fi/access passwords, invitation/fleet
material and update/reset authority. Security remains enabled in this candidate.

The client can consume the already-cached offset-zero page immediately after a
successful correlated Commit acknowledgment. This ordering is source-verified
from control v1's introduction in firmware 1.10.0 through the current adapter:
the lamp caches page zero before publishing the successful command ACK. Only
subsequent offsets require a Page command. The decoder still verifies transaction,
endpoint, offset, status, total length and connection generation. Cleanup,
mutation uncertainty and the prohibition on repeating Commit are unchanged.
The client change removes one command/ACK round trip per RPC. Its 1,362 mobile
tests and production build pass; it is unshipped and has no measured native speed
claim. It does not replace the initial full State and Effects catalog reads.

## Admission before HTTP parser allocation

`serviceTransport()` now checks current free heap against the rounded compiled
`CompactParser` size plus the unchanged 8,704-byte SDK/workspace allowance, and
checks the largest block before allocation. A static 503 refusal uses no parser
or application handler. A second current-heap check immediately after allocation
releases the parser if SDK activity raced the preflight. This is admission rather
than a reservation: accepted sockets and subsequent SDK work still consume RAM.
Existing five-second API totals, idle/ACK rules, detached close ownership,
authentication, upload ownership and executed-mutation reconciliation remain.

The 73 production transport cases include a retained 6,255-byte reply with two
slow clients, no parser/handler allocation under pressure, contiguous and current
heap boundaries, allocation/race failures, queue-full cancellation and recovery
without replay. This protects overlapping read memory; it does not prove that
three clients can all receive full Settings replies at once. The new build and
its focused host checks are recorded in
`.build/firmware-1.15.2-http-admission-20261012/`; physical acceptance is pending.

Focused production-handler checks pass in `tests/platform-log-priming-runtime.py`, `tests/ble-control-runtime.py` and `tests/http-server-runtime.py`. The priming fixture covers five platform configurations and 245 syscall-result combinations; private core-parser checks reject malformed bounds/CRC and a prior image's identity. The rebuilt candidate's physical heap margin, stable native Settings connection and animation behavior remain pending. Publication stays held until those gates pass.
