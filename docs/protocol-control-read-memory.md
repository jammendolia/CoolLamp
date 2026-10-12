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
