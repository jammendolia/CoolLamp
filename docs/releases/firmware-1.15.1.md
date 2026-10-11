# CoolLamp firmware 1.15.1

This release addresses animation stalls during slow or incomplete HTTP connections. It uses the standard public ESP32-C3 application and the existing dual 2,031,616-byte OTA slots. The application is **2,020,592 bytes**, SHA-256 `10218a28628724c2f4fca45b670e28ea2d6d4fab276eeb51197dc199e780bb9d`; the matching 120-byte `coollamp-manifest.txt` is the legacy-compatible OTA-1 manifest, SHA-256 `fc239b2238f03c9f3cc71d09889cd92533d36b51ab887073d4f54278a3e9cd60`.

Install the application through the existing updater. This release does not change the partition layout or install a new bootloader. Saved Wi-Fi, ownership, geometry, individual appearance, power/startup settings and group membership retain their existing persistence contracts. The user explicitly authorized OTA publication on October 11, 2026, after the limited validation and remaining gates were disclosed.

## Changes

- Incremental HTTP parsing and transmission have explicit size, work, connection and idle bounds. Three client slots and deferred socket cleanup let an incomplete request or a response reader that stops reading yield to animation and other clients. Rendering, mutable lamp state and NVS retain main-loop ownership.
- Protected state, catalog, descriptor and firmware-status reads remain free of scan, provisioning, calibration and update-start actions. BLE replies retain bounded immutable paging and command ownership; authentication, target identity and uncertain-command reconciliation remain enforced.
- Inclusive frame-gap, network-service and HTTP metrics make rendering stalls observable without logging credentials or request bodies. USB diagnostics have bounded output and recovery. Failed response allocation returns an honest failure rather than a shortened successful state or catalog.
- Shared control memory admission, lazy HTTPS worker creation/destruction and bounded background checks reduce avoidable resource pressure. A failed started mutation is not retried across another route.
- The hidden update animation remains receiver-only and appears only when that lamp was on when updating began. It never appears in the effect catalog. Existing effect IDs, names, order, knob behavior and supported odd LED counts retain their semantics.

## Validation and limits

The final shared firmware sources passed the 33-command production-handler contract gate, 16 legacy regressions, eight release guards and 1,168 pinned-String allocation-failure boundaries. Both standard and isolated diagnostic builds passed. The standard artifact has **11,024 bytes** of OTA-slot headroom and **94,212 bytes** of static globals; neither is a measurement of runtime heap or full stack use.

Physical measurements used the isolated diagnostic application `a6c39e5e0d9ef4e0d688ee349f12e44766166fdd61a29fdda086d4f81f65d75b`, built from the same 125 firmware sources. That image suppresses donation and cannot pass publication packaging. It is **not** the standard artifact being released, which has not been physically installed during this validation.

On one Pink Corkscrew, the diagnostic completed eight direct-Wi-Fi failure profiles, 63/63 normal reads, eight diagnostic and eight revision reads in one boot session, with complete short-run timing coverage. The warm maximum gap between `FastLED.show()` returns was **48.076 ms**, with zero new 100-ms overruns. This is firmware timestamp evidence, not optical timing. Cold startup retained 672.025 ms and one overrun separately. Eighteen protected post-run reads passed. The user subsequently reported that Settings → Lamp Designs opens and animation continues smoothly on this diagnostic image; the native transport and numeric timing of that interaction were not captured. Application-only readback and unchanged boot/partition/OTA metadata and NVS prefix were verified.

The exact standard artifact's physical behavior, full sustained workload, unresolved predecessor USB diagnostic gaps, transient memory margins, native iPhone/Android and BLE/mesh handoff, twenty-lamp RF/coexistence, actual OTA/donor interruption and installed bootloader rollback remain unverified. A predecessor allocation-failure crash is retained in the evidence; this short canary does not establish long-run recovery or stability. Do not infer these gates from host tests, compilation or this one-lamp test. The original Settings incident's transport remains unknown.

The standard build retains normal trusted-fleet donation behavior and the same legacy SHA-256/HTTPS/fleet-trust policy disclosed for 1.15.0. It has **no provisioned production publisher-signature keys**. Production signature enforcement, key custody/rotation and manufacturer identity remain external prerequisites; development signing fixtures are excluded. This release does not claim publisher-signature authenticity, automatic rollback, completed physical acceptance or store readiness.

Publishing as GitHub Latest makes 1.15.1 available to existing OTA clients and can trigger lamps that previously opted into automatic updates. Existing opt-in and receiver policy remain preserved; new lamps default off. Publication performs no direct lamp flash, reset, router or credential change. The separate diagnostic artifact, ELF/map, service images, partition files, private backups and signing fixtures are not release assets.

The [transport contract and measured results](../protocol-animation-connection-stalls.md), [implementation ledger](../experience-implementation-ledger.md) and [controlled acceptance procedure](../experience-physical-acceptance.md) retain the evidence boundaries and recovery steps. Repeat the full fixed-router workload with bounded USB recovery and independent optical timing, then the native, update and fleet fixture gates.
