# CoolLamp firmware 1.15.0

This release uses the default public ESP32-C3 build and existing dual 2,031,616-byte application slots. The application image is 2,019,760 bytes, SHA-256 `ca83d570010b8022c41d404a717a95295699020df5e83bd41cb90f1a6dcc96d4`. The matching `coollamp-manifest.txt` is the legacy-compatible OTA-1 manifest. Install the application image through the existing updater, not a merged service image or a different partition layout.

## Changes

- An internal soothing update progress overlay appears only on the actively updating receiver, only if it was on when the operation began. It reflects confirmed written bytes, never appears in either effect catalog, and preserves power, effect and individual settings. The first upgrade from older firmware cannot display this new overlay; it becomes available once 1.15 is running.
- Negotiated 32-position synchronized groups retain the existing nine-position compatibility path, offline positions, paused membership and all existing scenes. Confirmed dissolution removes followers first and the coordinator last, preserves each lamp's settings, and retains unreachable removals as pending. Last-follower moves clean up their source group. These contracts require a compatible client.
- Versioned model/capability/effect descriptors, startup-independent appearance memory, revision-fenced partial commands and bounded execution receipts support the new client experience while preserving catalog v1 and `/api/defaults`.
- Exact-artifact BLE reconnect leases, optional quiet/defer policy, durable staged group-update leases, stronger postboot continuity checks and an unconfirmed-artifact guard improve supported update recovery. Grouped automatic installs now wait for protected staged orchestration; explicit Update now remains available. Prior automatic opt-in is preserved, and new lamps default off.
- Publisher-signature and scoped household-phone interfaces are implemented. This default release has **no provisioned production publisher keys** and retains the existing SHA-256/fleet-trust compatibility policy. It does not claim independently authenticated publisher signatures, manufacturer identity, complete native household onboarding or automatic distributed rollout.

## Validation and limits

The candidate passed 111 distinct host checks, the 23-command production contract gate, 610 mobile working-tree tests and the mobile production web build. Both default and four-root development enforcement builds fit the OTA slots. The default has 11,856 bytes of actual slot headroom and 85,452 static-global bytes. The development enforcement build and its ephemeral trust fixtures are excluded from the release.

Real iPhone/Android, RF/coexistence, twenty physical lamps, diffuser accessibility, power/thermal, runtime stack/heap and installed bootloader rollback acceptance remain pending. A successful build does not prove automatic rollback. Older firmware does not enforce the new attempt guard; a failed image that rolls back to older firmware cannot obtain that protection retroactively. Use the explicit bootstrap/repair procedure before an unattended recovery rehearsal.

Publishing this release as GitHub Latest makes it available to existing OTA clients and can trigger lamps that already opted into automatic updates. Publication does not establish physical acceptance or store readiness. No lamp/router/credential change is performed by the release process itself.

Protocol and integration details: [experience](../protocol-experience-v2.md), [groups](../protocol-groups-v2.md), [updates](../protocol-updates-v2.md), [rollout](../protocol-rollout-v1.md), [household and commissioning](../protocol-commissioning-v2.md). The [implementation ledger](../experience-implementation-ledger.md) and [physical acceptance procedure](../experience-physical-acceptance.md) retain the software/physical/prerequisite distinction.
