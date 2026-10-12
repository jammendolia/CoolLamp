# CoolLamp firmware 1.15.2

This update improves progress feedback and recovery across the existing update
paths, and adds a local browser upload. It retains the ESP32-C3 application and
existing dual **2,031,616-byte OTA slots**; it does not install a new bootloader
or partition layout. Saved Wi-Fi, ownership, groups, calibration, individual
appearance and startup settings retain their existing persistence contracts.

## Changes

- The hidden update animation has gentle whole-lamp motion and a brighter steady
  fill for confirmed written progress, from the calibrated bottom toward the
  top. Its color identifies the active receiver path: **blue** for phone
  Bluetooth, **green** for Internet HTTPS, **amber** for a trusted nearby firmware
  donor, and **purple** for browser/computer upload. Unknown sources remain
  neutral. It appears only on the updating lamp, only if that lamp was on when
  updating began, and never in the effect catalog.
- Automatic-update opt-in remains persistent and defaults off on new lamps.
  Eligible receivers try Internet first, then observe authenticated donor offers
  and periodically retry safe failures. New bounded status fields distinguish
  retry, policy/resource holds and failures that need a user-started phone
  update. Quiet/defer policy, staged-group permits, storage, update ownership and
  uncertain-commit reconciliation still govern admission. This does not promise
  automatic updates when those prerequisites are unmet.
- Internet, Bluetooth and trusted-donor receivers keep ownership when a durable
  installation result is uncertain. Duplicate finish, cancellation, disconnect
  and a different route cannot repeat boot selection. An additive Bluetooth
  status flag preserves the original receipt until reboot; older clients remain
  fenced by the lamp even if they describe this rare failure incorrectly.
- The lamp's authenticated browser page accepts a matching CoolLamp application
  `.bin`, including from its setup hotspot at `http://192.168.4.1`. It pins target,
  boot session, version, chip, size and SHA-256 before bounded inactive-slot
  streaming. Complete validation precedes boot selection; lost final replies
  use read-only reconciliation. Existing authenticated `/update` remains
  compatible. A merged image or bootloader is not an application update.
- A negotiated whole-strip motion path can be selected separately from the
  physical midpoint. Returning to split motion restores the saved center;
  existing effects, IDs, odd LED counts and calibrated spatial scenes remain
  compatible.
- Microphone capture has a separate durable owner switch and explicit
  starting/healthy/stale/error status. Healthy silence does not prove that a
  microphone is absent, and missing samples do not identify a hardware fault.
  Installation, tuning and effect IDs remain separate. Finished-lamp default-on
  installation requires explicit verified manufacturing provisioning.

## Compatibility and remaining gates

TestFlight **2.0.5 (64.1)** is processed and available for internal testing.
It includes visible Settings loading, target-fenced connection recovery and
bounded retries of explicitly rejected read-only Wi-Fi queries. Mutations and
uncertain update commits are never replayed. Existing clients retain legacy
catalog, wire, settings and update contracts; unsupported optional controls stay
hidden. Trusted donation remains a separate protected service. Generic control
mesh does not carry arbitrary firmware uploads.

This standard artifact retains the disclosed legacy OTA-1 SHA-256/HTTPS/fleet
trust policy. **Production publisher-signature roots are not provisioned.**
Enforcing receivers still require valid original signed metadata. Private keys,
development signing fixtures and merged/service images are not release assets.

Legacy protocol-2 groups retain their staged automatic-rollout hold. Automatic
radio permit distribution, production manufacturing trust, twenty-lamp RF,
Android interoperability, sustained heap/stack margins and actual bootloader
rollback remain separate unfinished gates. Low memory can reject reads, updates
or durable saves explicitly; a readable lamp does not prove save admission.

## Exact artifact and validation

- Application: **2,029,600 bytes**, SHA-256
  `bf2231e38467dccf51b022624af2b10f90d2b059cc578f056282452a6f3955ec`.
  Matching 120-byte manifest SHA-256:
  `81fd42c3fcaad32a29e9f960876147db01b60f712f7fb790d7f8441236734d14`.
- Pinned Arduino ESP32 core **3.3.11**, FastLED **3.10.5**,
  ESP32RotaryEncoder **1.2.0**, ESP32-C3 CDC/no_fs public build.
  Program size **2,029,454**, static globals **94,348 bytes**.
  The application has only **2,016 bytes** of OTA-slot margin. Per-function
  stack estimates exclude SDK call chains; measured loop/HTTP-cleanup minima
  were 1,736/1,052 bytes. No partition or bootloader migration is shipped.
- On CoolLamp 2, identity `f0b950b2f180`, one authenticated Wi-Fi file
  upload installed this exact artifact. Fresh boot, exact running size/digest,
  boot-health status and saved-settings hash were verified. The page reported
  **“Your lamp is updated to 1.15.2.”** The installed page matches the compiled
  source. Router/network configuration was held constant; no USB flash or
  automatic upload replay occurred in this check.
- Browser reconciliation now has a bounded **120-second** window. The previous
  45-second window expired before the incremental image fingerprint was ready,
  despite a successful install. Its ambiguous result remains recorded. The final
  test used the real authenticated page with the exact new reconciliation
  function injected before its single submission; the new firmware subsequently
  served that same compiled page. This improves confirmation, not install speed.
- The only source differences from the physically tested `407483...` image
  are the page and its generated gzip. That image opened iPhone Settings over
  Bluetooth on 63.1 with loading visible and animation moving, as observed by
  the user. Eight two-client slow HTTP profiles retained the boot and added no
  animation overruns; observed window maximum was **50.998 ms**. One profile
  returned two initial busy 503s, so raw first-attempt availability failed.
  The production client transport subsequently recovered from five explicit
  busy refusals in **8.44 seconds**, on the same target/route/boot, and loaded
  state plus all 47 effects. This used a Node HTTP adapter, not native iOS HTTP.
- After the final restart, observed steady animation windows reached **44.919 ms**;
  a later 38-sample check reached **23.009 ms**, without new overruns. The first
  startup window contained **685.438 ms** and one overrun. These sampled windows
  satisfy the 100 ms steady target only where observed. They do not prove every
  frame, the update renderer's optical continuity, or an all-time/fleet target.
  Early reconciliation sampled 7,156 free bytes and a 2,548-byte largest block;
  later sampling reached 11,652/7,668 bytes. The reported lifetime heap minimum
  was **112 bytes**: sustained resource margin remains a material open limit.
- The production-handler gate has **41 commands**. Final publication checks run
  against an isolated immutable source export. Client 64.1's exact source passes
  **1,446 tests**, production build, native checks and signed TestFlight upload;
  Apple reports VALID and IN_BETA_TESTING. These do not establish Android or RF
  acceptance. See [app handoff](app-2.0.5-settings-loading.md).

Exact budget, source hashes, physical records, export gate and independent release
download receipts are retained under
`.build/firmware-1.15.2-ota-final-20261012/`. Earlier failed/refused runs remain
under `.build/firmware-1.15.2-http-admission-20261012/` and
`.build/firmware-1.15.2-release-page-20261011/`; they are not converted to passes.

Publishing as GitHub Latest makes this version available to existing OTA clients,
including eligible lamps with automatic updates enabled. The release contains
only the standard application and its matching manifest. Follow the
[physical acceptance procedure](../experience-physical-acceptance.md), holding
router configuration constant. Next: install 64.1, open Settings and Lamp Designs
without saving, confirm route and animation; then test one Internet update and
one trusted donor receiver before extending the canary set.
