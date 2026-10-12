# Microphone capture and owner preference v1

This is a source contract for `LampAudio.cpp/.h`. Host verification is separate
from microphone wiring, acoustic response, phone interoperability and RF tests.

Installation and permission are separate. `lampHasMicrophone()` continues to
report configured hardware and drive the existing 38/47-entry effect catalog.
Disabling capture retains installation, audio tuning and every public effect ID.
The I2S controller receives frames even when DIN is disconnected or held low;
healthy capture never proves that a microphone exists or hears sound. Silence
cannot disable capture, remove installation or write preferences.

`audio` adds three fields, alongside unchanged legacy tuning and sample metrics:

```json
{"captureVersion":1,"enabled":true,"captureStatus":2}
```

`enabled` is the owner preference, independent of installation. `null` means its
storage could not be read/validated or restoration after a failed save could not
be confirmed. Capture fails closed in that case. Only the version-1 contract and
a Boolean value negotiate an owner switch. Do not turn unknown into false or
infer an accepted durable save from an old snapshot.

| captureStatus | Meaning |
| --- | --- |
| 0 | Idle: disabled, not requested, blocked, not configured, or stopped |
| 1 | Starting: capture is running, within the first two seconds, with no post-calibration sample yet |
| 2 | Healthy: running and a valid analyzed sample is no older than 100 ms |
| 3 | Stale: startup exceeded two seconds or analyzed samples are older than 100 ms |
| 4 | Error: a driver/worker failure or invalid/unknown owner preference |

Existing `signalSeen` records sample variation observed since this capture run.
It is separate from capture health and is not an electrical presence test.
Unsigned elapsed time handles clock rollover. GET snapshots never start I2S,
extend diagnostics, scan buses, change radio settings or write NVS. No raw PCM is
logged, recorded or transmitted by this contract.

All setters and lifecycle operations remain on the Arduino loop. The worker
publishes features under its existing critical section. Before configuration or
permission changes, the loop requests worker exit and waits at most 250 ms for
the existing semaphore handshake; no driver/buffer teardown or setting change
occurs after a failed handshake. I2S reads remain bounded at 40 ms. Five consecutive
read failures terminate capture; startup/read failures retry no sooner than five
seconds. The existing 4,096-byte worker stack, 2,048-byte sample buffer and four
256-frame DMA descriptors are retained.

Retry ownership uses a separate pending flag: a deadline of zero at clock
rollover remains a full five-second backoff. The production regression injects a
failure exactly 5,000 ms before zero and verifies no early allocation/restart.

## Durable state and compatibility

`audioV1` remains the existing five bytes. `audioV2` remains the existing seven
bytes, including installed hardware, gain, gate and scale. Legacy installation
changes still apply at reboot. A gain/gate/scale save retains the separate owner
preference. The new owner record is `coollamp/audioUseV1`, four bytes:

```text
byte 0: version 1
byte 1: enabled 0 or 1
byte 2: reserved 0
byte 3: 0x69 XOR bytes 0, 1 and 2
```

Missing owner state uses the compatible enabled default. There is no read-time
migration write. Malformed/unreadable state fails closed; unsupported record
versions are preserved and cannot be overwritten by a version-1 setter.
`saveLampMicrophoneEnabled(bool)` saves only this owner setting. Repeating an
already validated durable value performs no write or worker restart.

Writes require both an exact NVS write result and exact readback. Failure restores
the prior bytes or prior absence, then verifies restoration. If restoration fails,
`lampAudioSaveUncertain()` returns true and owner permission is reported as null.
The client must reconcile a fresh target snapshot and must not replay a lost or
uncertain mutation. A power loss after the atomic blob commit recovers the durable
value on reboot, including when a reply or RAM update was interrupted. Factory
reset clears this owner preference while retaining installed hardware under the
existing reset contract.

Reads use the shared `LampNvsBlobPreferences` adapter against the pinned NVS API.
Only `ESP_ERR_NVS_NOT_FOUND` proves absence. A type mismatch, invalid length or
driver error cannot authorize a default, overwrite or rollback deletion. This
avoids Arduino `Preferences::isKey()` treating read failures as missing keys.

## Finished-product provisioning prerequisite

There is no reliable heuristic for a manufacturing-new finished lamp: user reset,
missing Wi-Fi, absent bonds, a default name or silent input cannot establish that.
Unprovisioned boards retain `installed=false`.

The manufacturing/service-only `provisionLampMicrophoneHardware(bool)` interface
writes a four-byte record with the same version/checksum layout at
`lampmodel/audioHwV1`. This namespace survives user reset. Provisioning is refused
while capture owns the driver; an identical existing valid record is idempotent.
A conflicting or corrupt existing record is never overwritten. This API has no
remote endpoint and conveys no manufacturer identity or cryptographic attestation.
A controlled factory/service process must verify the actual assembled hardware
and invoke it explicitly; production activation and wiring verification remain
external prerequisites.

Boot may use that factory default only after successfully opening `coollamp` and
verifying that **both** legacy audio keys are absent. Boot alone may create an
empty missing namespace via a writable open. It never writes owner/audio keys
while loading; any storage failure fails closed. Existing valid or malformed
legacy installation records take precedence over factory defaults. A future
finished product can therefore default its installed microphone on without
guessing about an old lamp or overwriting owner hardware calibration.

## Verification and physical acceptance

`tests/audio-health-runtime.py` compiles the complete production `LampAudio.cpp`
and `LampControl.ino`, with fault-injected NVS/I2S/RTOS platform fixtures. It covers
legacy records, factory-only namespace creation and legacy precedence, read-only
snapshots, retained catalog IDs, silence versus health, stale/startup/error states,
clock rollover, stop timeout, storage restoration and uncertainty, interrupted
write/readback, durable disable, tuning and unsupported future preference versions.
Raw-NVS fixtures additionally inject errors on either legacy-key probe, owner
defaults/saves, manufacturer metadata and rollback-to-absence; type mismatches
preserve the original record instead of granting overwrite/removal authority.
Host fixtures do not prove physical capture, heap/stack margins or acoustic quality.

Before release, use a verified installed microphone and an unpopulated DIN fixture
separately. Confirm that disabling stops capture without changing effect IDs or
light settings; re-enable and test sound, then quiet and disconnected input. Check
100 ms stale behavior, capture resource release before update, failed-save honesty,
reboot persistence and factory-reset hardware retention. Keep router configuration
unchanged. Measure actual task stack/heap and animation frame gaps during stopping,
starting and update coexistence; no automatic absence detection is promised.
