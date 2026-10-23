# CoolLamp firmware 1.15.6

This ESP32-C3 release reduces the memory needed by audio-responsive lighting.
Capture buffers and the audio worker now reserve **9,728 fewer bytes**. The
microphone retains the same physical I2S timing, left-channel selection and
effective sample precision; the existing filter-bank analysis, effect IDs,
colors, brightness and motion semantics are preserved.

The release also includes the tested control-read and mesh-inventory work from
the current lamp checkout: bounded HTTP responses, compact state construction,
main-loop mutation ownership, target-reported model/version/link information
and preservation of an independent OFF state for a disconnected legacy group
follower. These dependencies accompany the audio change so an OTA does not
remove the fixes already checked on the local lamps. Unknown/unprovisioned
designs remain generic. Ordinary updates do not provision or replace hardware
design/calibration. Existing Wi-Fi, household, group and startup settings remain
in place. No app or bridge binary is included in this lamp release.

## Exact OTA files

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| CoolLamp.ino.bin | 2,025,344 | `6feb4c1c54b2bdf6d168fdfc748de62f605a956cc0881cbaa8d03de0cd3e1ad8` |
| coollamp-manifest.txt | 120 | `bace5c12f19d2393558a386f5574e0ced1cb6dacaf96ddd49a4de94c8105361e` |

The normal public image uses Arduino ESP32 core 3.3.11, FastLED 3.10.5 and
ESP32RotaryEncoder 1.2.0 with
`esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=no_fs`.
Program/static-global use is **2,025,196 / 94,380 bytes**. Both existing OTA
slots remain 2,031,616 bytes; the complete image has **6,272 bytes** of slot
margin. No partition or bootloader migration is included. Diagnostic/local
images and private settings are excluded from the public assets.

## Verification and limits

Production audio lifecycle tests cover compact capture, partial/odd/malformed
reads, teardown, allocation failure, retry and rollover. Real analysis paths
compare old/new layouts over 2,048 blocks including signed extremes, discarded
right-channel/low-bit noise, calibration, bands and beats. Effect, geometry,
knob, playback and shared-audio fixtures retain the 1–1024 LED range, odd counts
and physical rising/falling behavior.

The current checkout's 49-command contract gate passed 47 commands initially;
two stale fixture declarations were corrected and their targeted reruns passed.
The original failures and rerun provenance are retained explicitly. Packaging,
factory-password and TLS-library checks passed nine tests. The isolated source
export is checked separately before publication; native Windows host runs do
not claim sanitizer coverage.

The earlier diagnostic image was installed wirelessly on CoolLamp 1 and
Corkscrew, with saved settings and membership verified. CoolLamp 1's 90-second
active-audio/two-reader check completed 122 reads without failure or reboot;
sampled heap stayed at least 20,852 bytes and worker stack reserve was 1,372
bytes. Those measurements belong to that diagnostic image. The exact normal
1.15.6 canary, export gates and publication/download results are recorded in
the separate publication receipt and local evidence directory.

Startup/TLS transients, sustained native iPhone/Android BLE traffic,
twenty-physical-lamp RF/timing and bootloader rollback remain separate
acceptance items. Earlier measured frame-gap windows passed the 100 ms target,
but an earlier startup gap exceeded it; this release does not claim a
whole-lifetime timing guarantee.

## Installation and recovery

Automatic updates remain opt-in. A lamp with a viable internet connection can
use HTTPS; an eligible trusted donor/bridge can offer the original validated
artifact to an auto-enabled receiver. The receiver's policy, group safety,
radio/channel compatibility and legacy receiver prerequisites still apply.
Generic mesh control does not transport arbitrary firmware uploads. A lamp
with an older receiver defect may first need one direct Wi-Fi/Bluetooth update.

Phone Bluetooth transfer retains native foreground/lifetime requirements.
Keep the lamp powered during installation and verify its installed version
after restart. A missing final reply is uncertain: reconcile the same target
before retrying. The hidden update renderer stays local to the updating lamp
and appears only if it was ON when installation began.

The existing unsigned OTA-1 HTTPS/SHA-256/household-trust policy is retained.
Production publisher-signature roots are **not provisioned**; this release
does not claim publisher-signature enforcement or install a new trust policy.
No production signing keys, credentials or private firmware are published.

Release evidence: `.build/firmware-1.15.6-release-20261023/`.
