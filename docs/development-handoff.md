# CoolLamp development handoff — 2026-10-06

## CoolLamp 1 screen-lock interruption and update-speed work — 2026-10-09

The user reported a Bluetooth stop at **23%**, with **453,096 of 1,920,432
bytes acknowledged**, and confirmed **the phone screen locked**. The app's
existing visibility handler deliberately cancels unfinished Bluetooth transfers
when hidden; the generic message did not explain that cause. Read-only evidence
verified CoolLamp 1 (`acb950b2f180`, `192.168.1.154`) still on public **1.11.0**
with its Bluetooth connection closed. This failure predates any possible sequence
counter rollover. Historical HTTPS error/minimum-heap fields do not establish
the Bluetooth failure cause. CoolLamp 2 did not respond at its last Wi-Fi address
during this check; its card's restarting receipt was stale after the previously
verified successful 1.13.0 boot.

The app candidate keeps the screen awake only while an explicit or card Bluetooth
update owns a token-fenced native lease, and restores the prior idle flag on
completion, failure, cancellation, backgrounding and teardown. Manual lock/app
switching still cancels with a clear first-stop reason. Connection-changing card
actions and late Wi-Fi/mesh selection results can no longer tear down an active
Bluetooth update. Fresh verified installed versions reconcile pending success
receipts; cached versions and failed receipts never do. Native iOS ownership
tests run in the existing macOS TestFlight workflow. App **1.0 (44.1)** was
accepted by Apple at `2026-10-10T04:14:44.1927150Z` (**October 9, 11:14:44 PM
CDT**), successful CI **38023170740**, source
`6071b17bb098d4b2933804801d796062c6fc193f`. CI repeated all 479 mobile tests,
passed the production native Swift screen-lease tests and built/exported the
signed iPhone app. TestFlight tester availability, physical screen-awake/speed
acceptance and Android compilation remain unverified. No new firmware was
published for this app-only change; public Latest remains **1.13.0**.

For speed, existing 1.11.0/1.13.0 receivers already provide OTA-status
notifications. The app-only candidate uses authenticated written-offset
notifications as acknowledgments while retaining four sequential response writes,
bounded read fallback, exact version/size/SHA verification and one final commit.
Physical time improvement is not yet measured. Truly faster unacknowledged data
bursts would require explicit new firmware capability and native backpressure;
they are not implemented or advertised by this candidate.

Final Windows validation passed **479 mobile tests**, the production build and
**24 production UI scenarios** on bundle `index-DLjOmhDi.js`. The UI cases cover
explicit/card update ownership, delayed connection selection, screen-awake
cleanup, installed-version receipts and existing update/failure flows.
The 70 focused Bluetooth cases include an exact **1,920,432-byte** model transfer
with notification acknowledgments, validated image SHA, one initial status read,
zero per-window reads and one final commit. Dropped notifications downgrade once
to the existing polling path; stale session/size/offset/sequence and error statuses,
bounded listener setup/cleanup, cancellation, reconnect ownership, sequence wrap
and uncertain final responses were covered. These are sender/receiver-model tests,
not physical Bluetooth throughput evidence. Evidence:
`.build/bluetooth-speed-mobile-tests.log`,
`.build/bluetooth-speed-mobile-build.log` and
`.build/bluetooth-update-final-validation.json`.
Publication evidence: `.build/bluetooth-speed-app44.1-record.json`,
`.build/bluetooth-speed-ios-ci-metadata.json` and
`.build/bluetooth-speed-ios-ci.log`. Only personal **jammendolia** was used;
the original working tree was preserved and the scoped app release was
committed/pushed through `.build/release-1.9.5`.

A one-shot local LAN upload of the exact published 1.13.0 image was attempted
to avoid Bluetooth/remote HTTPS. Preflight first aborted without any upload on
an outdated follower-role assumption; a fresh read confirmed CoolLamp 1 is now
a **leader**, role 1, scene 0. That current role was preserved. The actual upload
closed after **262,144 bytes / 11.3 seconds**, curl error 52, no HTTP response.
Only read-only reconciliation followed; no mutation was replayed. The lamp
still runs **1.11.0**, its uptime increased without a reboot, and the complete
captured saved-settings snapshot compared equal afterward. The journal prevents
another automatic upload. This local upload path remains unreliable.

Evidence: `.build/lamp1-bluetooth-stop-1791602613857989900.json`,
`.build/lamp1-direct-preflight-abort.json`,
`.build/lamp1-direct-ota-1.13.0.json` and
`.build/lamp1-after-lan-interruption.json`.

## CoolLamp 2 Bluetooth upgrade verified — 2026-10-09

The user completed an explicit phone-to-lamp Bluetooth update using installed
app **1.0 (42.1)**, kept foregrounded and unlocked. The lamp received the full
image, reported **100% / restarting / no error**, then booted
**COOLLAMP-PUBLIC-1.13.0**. A read-only identity check verified CoolLamp 2
(`f0b950b2f180`, `192.168.1.222`) on the new image at uptime **39,442 ms**,
past the 35-second healthy-boot check. The user separately confirmed success.
Observed receiving-to-restart time was about **16 minutes**; slow Bluetooth
throughput remains a usability limitation. This one successful physical transfer
does not establish the cause of previous Wi-Fi or Bluetooth failures, or prove
the post-upgrade HTTPS update path.

After boot: Wi-Fi connected, Automatic Updates still enabled, name CoolLamp 2,
134 LEDs, midpoint 0, startup effect 46 / brightness 55, coordinator role 1,
group scene 19, and microphone enabled. No agent settings mutation, forced
reboot, USB flash or direct LAN upload occurred; the prepared direct installer
was not needed. A full pre-transfer settings snapshot was not captured, so
the evidence confirms these known settings and the resulting configuration,
not a complete before/after equality claim. GPIO assignments were unchanged.
Free heap was about 16 KiB, largest block about 8 KiB, minimum since boot
3,268 bytes; die temperature was 74.7 C, new-boot peak 77.7 C. No receiver error
was observed during the transfer. Stored HTTPS diagnostics on the old boot
were unchanged during Bluetooth reception and were not current Bluetooth errors.

Evidence: `.build/lamp2-controlled-update-1791596126906004300.jsonl`,
`.build/lamp2-controlled-update-1791596791048289100.jsonl` and
`.build/lamp2-bluetooth-1.13.0-installed.json`. No other lamp installation or
physical mesh acceptance was established by this test.

Subsequent GET-only relay readiness checks found CoolLamp 1 and BACL on 1.11.0;
Automatic Updates was enabled on CoolLamp 1 and disabled on BACL. Corkscrew was
unreachable at its last address. CoolLamp 2 remains on 1.13.0, but
`/api/mesh/status` reports an empty fleet identifier, unavailable mesh and no
trusted peers. Its owner fleet is not provisioned yet; reconnect it through the
existing authorized phone Bluetooth connection to establish trust. Older public
1.11.0 lamps need a one-time Wi-Fi/Bluetooth upgrade to 1.13.0 before they can
receive future ESP-NOW firmware offers. Group ESP-NOW coordination alone is not
firmware-relay capability or fleet trust. The current automatic HTTPS checks on
CoolLamp 2, CoolLamp 1 and BACL report phase 5 / error 3; HTTPS checking remains
unresolved after CoolLamp 2's upgrade. No update, setting or trust provisioning
command was sent during these checks. Evidence:
`.build/firmware-relay-fleet-version-check.json` and
`.build/lamp2-espnow-relay-readiness.json`.

## Direct Bluetooth connection from Updates — 2026-10-09

App **1.0 (43.1)** adds **Connect over Bluetooth** directly to the selected lamp's
Updates page, outside its disabled transfer fieldset. The action verifies that
exact lamp and stays on Updates. Active firmware operations block transport
switching. Connection completion and failure now refresh update controls after
the connecting flag clears; a background refresh is no longer needed to enable
them. The default status reflects a verified Bluetooth connection, while retained
failure messages and transfer progress remain intact.

Validation: **425 mobile tests**, production build, **five new production UI
scenarios** and **13 existing update/failure UI scenarios** passed. Wrong identity,
failed connection, stale navigation, cancellation and uncertain final commit
were covered with mocked radios/downloads. Apple accepted the upload at
`2026-10-10T01:46:37.2867460Z` (**October 9, 8:46:37 PM CDT**), successful macOS
CI **38014182883**, source `d4faeadcb0641cdc066a1b81268088335561f108`.
Tester availability remains unconfirmed. Evidence:
`.build/bluetooth-connect-app43.1-record.json`,
`.build/bluetooth-connect-ios-ci.log`,
`.build/bluetooth-connect-updates-ui-result.json` and
`.build/update-connection-final-ui-validation.json`.
Only personal **jammendolia** was used. The original working tree was preserved;
only the two app files were committed in the isolated release checkout. No
firmware asset, GPIO assignment or lamp setting was changed for this app update.

## CoolLamp 2 update failures and retained app feedback — 2026-10-09

The user reports Wi-Fi and explicit phone-to-lamp Bluetooth transfers stopping
around halfway. The phone remained foregrounded and unlocked. The original error
was missed after the UI returned to its enabled state. A read-only check verified
CoolLamp 2 (`f0b950b2f180`, `192.168.1.222`) still running **1.11.0**, connected
on channel 6 at RSSI -60 dBm. Uptime was roughly nine hours, with no reset shown
during the read-only observation. Stored HTTPS diagnostics showed stage 2,
GitHub HTTP 302 followed by host 2, TLS error 12288 and transport error 32794.
This identifies a handshake failure, not the missing Bluetooth failure trace.
Free heap was roughly 30–32 KiB, largest block 17–20 KiB, and minimum since boot
124 bytes. Die temperature was 79.7–83.7 C with a historical peak of 92.7 C.
These historical minima/peaks do not establish the cause of the Bluetooth stop.
No firmware, settings, reboot or update request was sent by the agent.

The app now retains terminal update feedback on the correct lamp card and its
Updates panel across disconnect, navigation, refresh and reload. It captures the
receiver's original status and acknowledged bytes before Cancel changes the error
to code 8. An uncertain native write gets at most one bounded, same-session
read-only status snapshot. No data or final commit is repeated. A new explicit
attempt or successful lamp removal clears the saved result; stale callbacks
cannot overwrite it. Validation: **425 mobile tests**, Vite production build,
three new production UI failure scenarios and ten existing update UI scenarios
passed. Full-size 1,920,432-byte modeled transfers at MTU 23 and 185 pass,
including all three sequence-number rollovers at minimum MTU. These tests do not
prove physical Bluetooth reliability. App **1.0 (42.1)** was accepted by Apple
at `2026-10-10T01:20:48.3612820Z` (October 9, 8:20:48 PM CDT), successful
macOS CI **38012482232**, source `315af35ba9ce3d5e83c7145af34585f47c5182e4`.
The user confirmed build 42.1 installed. Evidence:
`.build/update-feedback-app42.1-record.json` and
`.build/update-feedback-ios-ci.log`. Only personal `jammendolia` was used.
No firmware source or published OTA asset was changed for this app update.

The next Bluetooth attempt was blocked by a disabled Updates button. Its page
was connected by Wi-Fi; a read-only `/api/bluetooth` check confirmed no phone
connected or secure. The user was directed to Lamps, CoolLamp 2's Bluetooth
icon, then its gear and Updates. Tapping the card body prefers Wi-Fi. A six-minute
read-only observer captured no active transfer and no reboot; the lamp remains
on 1.11.0. Evidence: `.build/lamp2-bluetooth-disabled-button.json` and
`.build/lamp2-controlled-update-1791595645479614000.jsonl`. The requested restart
was not confirmed; this observation stayed on the existing boot.

A one-shot direct LAN installer of the exact published CI image remains prepared
privately under `.build/`, not executed. It preserves a settings snapshot,
checks target identity/version/boot continuity, takes an exclusive invocation
lock, journals before upload, never replays an uncertain transfer, and verifies
the installed image on a boot at least 35 seconds old and saved settings. A
process timeout continues through read-only reconciliation. Live power/effect/
brightness/group pause are recorded separately from saved settings. Do not run
concurrently with a phone transfer. Current Wi-Fi/Bluetooth transfer root cause
is unresolved; no direct update, forced reboot or settings command was sent.

Evidence: `.build/lamp2-update-readonly-*.json`,
`.build/lamp2-update-observation-*.jsonl`,
`.build/update-feedback-mobile-tests.log`,
`.build/bluetooth-failure-feedback-ui-result.json` and
`.build/ui-check/bluetooth-failure-feedback-mobile.png`.

## Firmware 1.13.0 published for OTA — 2026-10-09

The user explicitly requested publication. **Firmware 1.13.0 is public Latest**,
published at `2026-10-10T00:17:05Z` (**October 9, 7:17:05 PM CDT**), tag
`firmware-v1.13.0`, source `238c9dd616eb2cce0b13167551374298cbfd7a11`,
successful firmware CI **37971580203**.
Release: https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.13.0.
This supersedes the unpublished status in the historical candidate checkpoint
below. The separate 1.12.0 draft remains preserved.

Anonymous downloads of the Latest manifest, pinned manifest and firmware all
returned HTTP 200. Both manifests matched exactly; manifest regeneration and
published GitHub asset digests matched the verified CI image: **1,920,432 bytes**,
SHA-256 `eede1a3970737173fd78e231451b30a5419c33ff50956f42bebc293a82b1cd58`.
Manifest SHA-256:
`2e820317c1de6c2e5744d7b4e28210dc78e460b47e977c95ce1ab130a8941bcb`.
C3/public markers, OTA partition limit and local-credential exclusion passed.
Evidence: `.build/firmware-1.13.0-publication-check.json`,
`.build/firmware-1.13.0-published-metadata.json`,
`.build/firmware-1.13.0-public-verification.json`, and
`.build/firmware-1.13.0-public-assets/`.

Publication used only personal **jammendolia**, with identity and the personal
remote verified. HiFin was not used. Existing GPIO assignments, saved settings,
automatic-update preferences and the original working tree were preserved.
No direct hardware command, flash or forced reboot was issued. Lamps with
Automatic Updates enabled can now install through their available update path;
publication does not establish installation on any lamp. Physical mesh and
newcomer setup acceptance remains pending. App **1.0 (41.1)** is already uploaded
to TestFlight; no additional app build was needed for this publication.

## ESP-NOW control mesh and new-lamp setup candidate — 2026-10-09

Historical checkpoint before the publication recorded above.

The current source candidate is **1.13.0**, unpublished and not installed on a
test lamp. The separate 1.12.0 firmware-relay draft is preserved. Public Latest
remains 1.11.0. Existing uncommitted work is preserved. GPIO assignments and
physical lamps were not changed; no hardware command or flash was sent.

See [lamp-mesh.md](lamp-mesh.md) for protocol, enrollment, channel/trust limits
and physical acceptance. An owned reachable lamp can bridge bounded multi-hop
commands and exact target responses. Missing acknowledgments/results stay
uncertain, with no mutation replay or implicit direct-target Bluetooth fallback.
New unconfigured lamps advertise public setup candidates. The app offers guided
setup through a nearby owned broker after commitment/reveal, encrypted key
agreement and a matching four-color sequence approved by a physical knob click.
Discovery alone never grants ownership. Single-lamp Wi-Fi/Bluetooth setup remains.

Existing saved 1.13.0 bridges can establish their owner fleet through an already
authorized Bluetooth pairing without selecting a lamp on startup. A different
fleet is preserved. Independent offline lamps retain a channel with authenticated
neighbors and use bounded Wi-Fi retry windows, alongside existing group behavior.
Updater reservations and background retries cannot interrupt active enrollment.

Mobile validation: **411 tests**, production Vite build, **7 mocked mesh/setup
UI scenarios**, and **13 card-power UI regressions** passed. Knob tests execute
the production gesture branch and reject pre-held, multiple-click and long-hold
approval without power/effect/settings side effects. Real pinned cryptography
tests cover mesh, commissioning and adapter behavior. Windows build and Linux CI
passed, including **19 mesh, 21 enrollment and 11 adapter scenarios** with Linux
ASan/UBSan. Six additional startup/layout UI scenarios and nine Wi-Fi recovery
scenarios passed. Mock and host passes do not establish
phone/RF acceptance. Existing macOS CI remains the iOS build/upload route, using
only personal `jammendolia`. The previously missing raw Mac diagnostics,
same-IoT forwarding and BACL thermal/blackout questions remain separate gaps.

Private local evidence: `.build/mesh-mobile-node-tests.log`,
`.build/mesh-mobile-ui-result.json`, `.build/lamp-card-power-ui-result.json`,
and `.build/ui-check/mesh-*.png`. New guides and candidates require a real-lamp
acceptance pass before public OTA publication.

Both successful workflows used source
`238c9dd616eb2cce0b13167551374298cbfd7a11` on
`codex/espnow-control-mesh-1.13.0`. Firmware CI **37971580203** created an
unpublished [1.13.0 draft](https://github.com/jammendolia/CoolLamp/releases/tag/untagged-67be753c870e9a497d4d).
The verified CI image is **1,920,432 bytes**, SHA-256
`eede1a3970737173fd78e231451b30a5419c33ff50956f42bebc293a82b1cd58`.
Manifest SHA-256:
`2e820317c1de6c2e5744d7b4e28210dc78e460b47e977c95ce1ab130a8941bcb`.
Program usage is 1,920,288 bytes; globals 76,940 bytes. OTA image space remaining
is 111,184 bytes. GitHub asset digests, manifest regeneration, C3 header, public
marker and credential exclusion checks passed. Use these CI assets for canary
tests. The separately preserved Windows image is 1,920,816 bytes, SHA-256
`07e7a24d795a0ad548592c2490f1060c92e7270100eca35bb7048a09ec3e98bc`.

App **1.0 (41.1)** was accepted by Apple at
`2026-10-09T18:14:48.9199060Z`, successful macOS CI **37971361480**. Tester
availability and physical phone acceptance are not verified. New mesh/setup
features require 1.13.0 on participating lamps; older direct Wi-Fi/Bluetooth
paths remain available. Evidence: `.build/mesh-app41.1-record.json`,
`.build/mesh-ios-ci.log`, `.build/mesh-firmware-ci.log`,
`.build/mesh-1.13.0-ci-assets/verification.json`,
`.build/mesh-1.13.0-windows-assets/verification.json`, and
`.build/mesh-source-verification.json`. Public Latest was rechecked after draft
creation and remains **firmware-v1.11.0**. No HiFin account action was taken.

## Firmware 1.11.0 published for OTA — 2026-10-09

The user authorized publication. **Firmware 1.11.0 is public Latest**, published
at `2026-10-09T14:59:37Z` (09:59:37 CDT), tag `firmware-v1.11.0`, source
`83e80bf3de5d4923c16a8cdd4270d1e56fc36b3e`, successful CI `37944143744`.
This supersedes the staged/unpublished status in the historical checkpoints below.
Release: https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.11.0.

Anonymous downloads of the Latest manifest, version-pinned manifest and firmware
all succeeded and matched the verified CI assets: **1,868,416 bytes**, image
SHA-256 `e60d0830750e7219c4229bc51d6f6e80f6647f3feb3ef9a2db8e5a7809118a8c`,
manifest SHA-256
`a5ee83a52abc4e01f510f8ee6782e4ffcd21b04e9d205b47714711e5e4034554`.
Evidence: `.build/firmware-1.11.0-published-metadata.json`,
`.build/firmware-1.11.0-public-verification.json`, and
`.build/firmware-1.11.0-public-assets/`. CI/Windows artifacts remain separately
preserved. Publication used only personal `jammendolia`; HiFin was not used.

Wi-Fi OTA and automatic updates remain available. Automatic installation is
eligible where already enabled; the agent did not alter any lamp's automatic
preference, GPIO, lamp/group/hardware settings, force an installation, or reboot.
Publication does not prove installation on any lamp. Each older lamp needs this
one Wi-Fi installation to enable subsequent phone-to-lamp Bluetooth updates;
physical Bluetooth acceptance is still pending. App 1.0 (38.1) is the latest
accepted TestFlight upload and includes the ESP-NOW follower card indicator.


## Group transport card indicator — 2026-10-09

The app now carries verified `sync.active`, `sync.paused`, and `sync.transport`
through background diagnostics, full protected Bluetooth snapshots, and Groups
reads. The existing group icon becomes amber with radio arcs and a **NOW** badge
only for a fresh, actively following, unpaused ESP-NOW follower. Wi-Fi UDP
followers keep the existing purple icon; tooltips/accessibility labels state
the active path. Paused/waiting/legacy/malformed/stale observations do not claim
an active ESP-NOW connection. Tapping continues to focus the same lamp in Groups.
Wi-Fi association and phone Bluetooth connectivity remain separate indicators.

Local checks passed: **338 mobile tests**, six production mocked icon scenarios,
the Vite build, and real-pinned-Mbed-TLS hybrid runtime tests. Existing card-power
tests passed all 13 production mocked scenarios, including local follower
pause/On behavior. No firmware or
lamp settings were changed for this app-only feature. The 1.11.0 Bluetooth-update
firmware remains an unpublished draft; its replacement CI run `37944143744`
succeeded after first run `37943794751` failed on an older test's source matcher.

**App 1.0 (38.1) uploaded successfully and was accepted by Apple** at
`2026-10-09T14:53:20.1434970Z` (09:53:20 CDT), through existing macOS CI run
`37946872212`, source `5e4111e097df6a7f0f72fae826c304e08aaf4013` on
`codex/group-transport-icons`. The run passed all 338 mobile tests and native
checks, signed/exported the app, and completed successfully. Log:
`.build/espnow-card-ios-ci.log`; simulated UI evidence:
`.build/espnow-card-ui-result.json` and `.build/ui-check/espnow-cards-mobile.png`.
Apple upload acceptance is separate from tester availability and physical
phone validation. Public firmware remains 1.10.2.


## Bluetooth update candidate — 2026-10-09

The working source now targets **1.11.0** and adds phone-to-lamp Bluetooth
firmware transfer alongside unchanged Wi-Fi OTA/automatic updates. Public
Latest is still **1.10.2**. **App 1.0 (37.1)** was uploaded successfully and
accepted by Apple at `2026-10-09T14:28:53.8770350Z` (09:28:53 CDT); processing
and availability to testers are separate from upload acceptance.
No lamp was flashed during this implementation.
See [Bluetooth firmware updates](bluetooth-firmware-updates.md) for protocol,
bootstrap requirements, cancellation behavior, and the physical acceptance plan.

Local checks: 333 mobile tests (24 new transfer/download/identity checks),
19 production receiver scenarios using the SHA-verified pinned Mbed TLS source,
five Bluetooth security callback tests, six offline radio handoff scenarios,
updater resource handoff tests, Vite build, five production mocked update-panel
scenarios and 13 existing card-power scenarios passed. The final Windows public
candidate is **1,868,800 bytes**,
SHA-256 `18bbca316683307a64d2193e0f429f52734e08fe112114122b6e0427a29f2fc4`,
with **162,816 bytes** remaining in the OTA slot; globals use 64,668 bytes.
It is a candidate build, not evidence of physical installation or BLE transfer.
Existing GPIO assignments, NVS settings, and prior migration gaps remain intact.

App source: `2cd03ab1c7d84c3bf344c764d3116f0f712945a5`, existing macOS CI run
`37943799328` succeeded, including native CryptoKit digest/bounds tests. Log:
`.build/bluetooth-ci-37943799328.log`. Firmware candidate source after the
hotspot-expiry host test correction:
`83e80bf3de5d4923c16a8cdd4270d1e56fc36b3e`; firmware CI run `37944143744`.

Firmware CI **succeeded** and created the **unpublished draft**
`firmware-v1.11.0` targeting that exact source. Downloaded CI image:
**1,868,416 bytes**, SHA-256
`e60d0830750e7219c4229bc51d6f6e80f6647f3feb3ef9a2db8e5a7809118a8c`.
Manifest SHA-256:
`a5ee83a52abc4e01f510f8ee6782e4ffcd21b04e9d205b47714711e5e4034554`.
The CI image has 163,200 bytes of OTA margin; globals use 64,668 bytes.
The CI and Windows images are distinct retained builds; do not interchange
their manifests. Evidence: `.build/firmware-1.11.0-ci-assets/`,
`.build/firmware-1.11.0-draft-metadata.json`,
`.build/bluetooth-ci-37944143744.log`, and
`.build/bluetooth-firmware-1.11.0-record.json`.
Public Latest was verified still `firmware-v1.10.2`. Publication and physical
CoolLamp 1 Bluetooth acceptance are pending the user's test/publication choice.

## Latest physical/app checkpoint — 2026-10-09: 1.10.2 installed; app 36.1 accepted

Fresh read-only fleet evidence at `2026-10-09T04:41:55.438Z`
(2026-10-08 23:41:55 CDT) confirms **CoolLamp 1, CoolLamp 2 and the new lamp
running `COOLLAMP-PUBLIC-1.10.2`**. Evidence:
`.build/group-power-fleet-1791520915438.json` and
`.build/group-power-context-live.json`. Public Latest remains firmware 1.10.2;
its published image/tag verification is retained in the publication checkpoint
below. The runtime reads confirm version/public marker; no raw-flash digest was
read, and the installation path is not established.

| Lamp | Installed version | Original automatic preference | Current group observation | Uptime (ms) |
| --- | --- | --- | --- | ---: |
| CoolLamp 1 | 1.10.2 | Enabled | Active follower on ESP-NOW | 9,986,966 |
| CoolLamp 2 | 1.10.2 | Enabled | Hybrid coordinator with three followers | 24,718,633 |
| New lamp | 1.10.2 | Disabled | Active follower on UDP | 26,012,820 |
| BACL | 1.9.6 | Disabled | Firmware phase 2, offering 1.10.2 | Not recorded here |

CoolLamp 1/2/new lamp each reported firmware phase 0/error 0, latest 1.10.2 and
TLS error 0 in this snapshot. This establishes successful current status and
observed 1.10.2 runtime, **not complete repeat-TLS validation** or proof that the
previous intermittent failure is permanently fixed. No update, update check or
reboot was forced by the agent after publication. Do not attribute these
installations to automatic updates solely because CoolLamp 1/2 retain enabled
preferences; the new lamp retains its original disabled preference.

All four lamps reported power off in the fresh fleet read. An earlier CoolLamp 2
read at about `2026-10-09T04:39Z` showed power on; the intervening state change
was external to the agent, which made **zero POST writes**. The read-only
snapshots do not establish which user control caused that change. Original
automatic-update preferences remain unchanged.

The healthy observed CoolLamp 2 boot on 1.10.2 supersedes the older manual
partial-upload record's uncertainty about whether its next boot would still
run 1.10.1. That transfer remains a historical partial upload; it is not evidence
of the installation path. The agent did not perform a controlled next-boot test.
USB remains an optional recovery/diagnostic path.

The user's app 35.1 power-control complaint was reproduced in the mobile layout:
the group Off button appeared around viewport y=1348 below Scene 19 controls.
The finished app-only fix moves group power first: production browser mocks
place it around mobile y=292 and desktop y=239. Lamp-card footers now contain a
power SVG icon labeled **Group power**, **Lamp power** or **Power**, showing
current **On/Off** state or **Check status** when unknown. Its accessibility title
states the action, such as turning the named lamp/group off or on. No new
firmware is required; published 1.10.2 already supports the guarded controls.

The first tap on unknown card state performs a read only. Each card runs
asynchronously and validates fresh device identity, group role, address and
connection epoch. The helper captures the shown current state and applies its
absolute inverse as the requested action; a later read cannot reverse that
captured intent. A coordinator controls its whole group; a follower's power is
local and pauses
runtime following. Turning that follower on does not call Resume or silently
change group membership. Shared command lanes, focus/removal checks and fresh
readback protect the exact target; double taps and uncertain writes do not
cause automatic replay. A modern Bluetooth lamp with an unknown group role
requires Wi-Fi verification; protected legacy firmware through 1.6.6 with no
group capability retains its normal power path.

Frozen source is `a971e4d558e1614be76a575be01ac69df50e3c17`. Local validation
passed **309/309 mobile tests**, including 18 helper and 18 GroupLighting checks,
the Vite production build, 13 production mocked card-power scenarios, the
Scene 19 power-first layouts and independent review. All mutating UI validation
was **mocked**, not performed on lamps. Screenshots include
`.build/ui-check/lamp-card-power-mobile.png` and its desktop companion.
A separate actual helper run made **12 GETs and zero mutations**, verified all
four device identities and Off states, and returned follower/leader/follower/
follower roles for CoolLamp 1/CoolLamp 2/BACL/new lamp, with firmware
1.10.2/1.10.2/1.9.6/1.10.2. Evidence:
`.build/lamp-card-power-live-1791522831461.json`.

App **1.0 (36.1)** is now the latest accepted TestFlight upload. Existing iOS
workflow `37887641465` succeeded on `macos-26` and source
`a971e4d558e1614be76a575be01ac69df50e3c17`. The log confirms build 36.1 and
`UPLOAD SUCCEEDED with no errors` at `2026-10-09T05:19:43.5045960Z`
(2026-10-09 00:19:43 CDT). Evidence: `.build/ios-testflight-36.1-ci.log`.
Tester availability and phone installation remain unverified after upload.
**Physical acceptance of the new power commands has not been performed**;
mutating UI checks were mocked, and the live helper validation was GET-only.
App 35.1 is the earlier accepted navigation checkpoint whose hidden lower power
control prompted this fix. Firmware 1.10.2 remains published; no additional
firmware release was needed. Existing per-lamp catalogs, group/standalone
behavior and Mirrored controls remain preserved.

GPIO assignments and saved lamp settings remain preserved. Lamps outside AP
coverage, same-IoT router forwarding, repeat HTTPS checks under representative
conditions, physical new-scene/music acceptance and longer blackout/thermal
diagnosis remain open. Raw Mac diagnostics/prototype binaries remain an unfilled
migration gap. Use only verified personal `jammendolia` for GitHub work and
preserve the original working tree.

## Earlier publication checkpoint — 2026-10-08: firmware 1.10.2 and app 35.1

The user explicitly requested publication despite the known physical-acceptance
gap, overriding the earlier hold. [Firmware 1.10.2](https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.10.2)
is now **Public Latest**, published at `2026-10-08T21:21:55Z`
(2026-10-08 16:21:55 CDT). Its tag/source is
`b66099080078bc47cbc253cfa23da2a1429df9f5`; Latest/tag references and public
flags (`draft=false`, `prerelease=false`) are verified. Publication used only
verified personal **jammendolia**; HiFin remains untouched.

The release uses the verified CI application: **1,863,744 bytes**, SHA-256
`2a1634f9404d40d0aece4632aa60ec94db0d1d1a853192157e1dd0d460028eda`.
Firmware CI `37843327031` succeeded, including runtime/sanitizer and packaging
checks. Program usage is 1,863,594 bytes, globals 61,612 and remaining OTA
image space 167,872 bytes. The prior Windows candidate has different bytes;
retain it as historical evidence. Anonymous downloads without Authorization
verified the public latest manifest (120 bytes) and pinned 1.10.2 application
at `2026-10-08T21:22:59.972Z`. The application size/hash and complete bytes match
the verified CI image; public marker and ESP32-C3 layout checks passed. Evidence:
`.build/firmware-1.10.2-public-verification.json`.

The last verified fleet snapshot immediately **before publication** made eight
GETs: `.build/ota-1.10.1-fleet-baseline-1791494436377.json`. CoolLamp 1/2 were
on 1.10.1 with their original automatic-update preferences enabled; BACL/new
lamp were on 1.9.6 with their original preferences disabled. Publication did
not introduce automatic-update holds or change those preferences. No check or
installation was forced for publication. **At that checkpoint no 1.10.2 lamp
installation had yet been verified.** The subsequent physical checkpoint above
confirms CoolLamp 1/2/new lamp on 1.10.2. The pre-publication snapshot remains
historical and does not establish the later installation path.

App **1.0 (35.1)** is already the latest accepted TestFlight upload; no additional
app build is required for this firmware. Existing macOS CI `37843221334`, source
`6a468d46e2c7ddea0cbb2df533118186de08b15a`, succeeded. Apple accepted the upload
at `2026-10-08T21:01:24.3685690Z` (16:01:24 CDT), with evidence in
`.build/ios-testflight-35.1-ci.log`. Tester availability and phone installation
remain unverified.

Publication alone did not establish a device installation or repaired HTTPS
checks. The later physical checkpoint above now confirms 1.10.2 runtime and
successful firmware status on three lamps; repeat HTTPS/AP-off acceptance remains
open. The earlier partial manual C2 transfer is retained below as historical
failure evidence. Its next-boot uncertainty was superseded by the observed
healthy 1.10.2 boot, without proving how the image was installed. No controlled
next-boot test was forced by the agent. The bounded 1.10.1 encrypted-frame and
phone-Wi-Fi-off Bluetooth tests remain valid; same-IoT forwarding, new-scene/music,
blackout/thermal and raw Mac diagnostic migration gaps remain open.
GPIO assignments and existing lamp settings are retained.

## Earlier pre-publication checkpoint — 2026-10-08: live OTA, radio and CI draft

The status below records the checkpoint before the user's explicit publication
request. Its Latest 1.9.6 and unpublished 1.10.2 draft statements are historical
and superseded by the publication section above. Preserve the observed device,
settings, failure and validation evidence; publication alone does not close
the physical-acceptance or next-boot/TLS gaps.

**Public Latest is firmware-v1.9.6.** Firmware 1.10.1 is a public prerelease
with its original pinned tag/assets. CoolLamp 1 (`acb950b2f180`, `.154`) and
CoolLamp 2 (`f0b950b2f180`, `.222`) are installed on `COOLLAMP-PUBLIC-1.10.1`;
BACL and the new lamp remain on 1.9.6. The test pair's original automatic-update
preferences were enabled and have been restored. BACL/new lamp's original
preferences were disabled and remain disabled. Reverting Latest does not
downgrade installed firmware or erase a cached newer offer. Before restoring a
held old lamp's enabled preference after any failed rollout, check restored
Latest and verify that no newer cached offer remains.

After the user moved BACL into the room, authenticated reads reached and
identity-verified all four lamps on 1.9.6. The staged test published the verified
1.10.1 image at `2026-10-08T19:46:33Z` and started the built-in GitHub OTA exactly
once on each test lamp. Both rebooted into 1.10.1, resumed Wi-Fi and passed the
compared configuration checks. Saved ordered group IDs were preserved;
transient online/name annotations and follower effect options settled after
subscription resumed. The effect-options getter overlays the coordinator's
live options, explaining the temporary post-boot difference. Neither install
was replayed, and no factory reset or GPIO change occurred. USB is an optional
recovery/diagnostic path, not a prerequisite for this Wi-Fi-connected test pair.
Evidence: `.build/ota-1.10.1-live-rollout.json`, the lamp1/lamp2 verified logs,
and `.build/ota-1.10.1-fleet-baseline-1791489654068.json`.
A later GET-only fleet baseline made eight reads across four lamps and reconfirmed the same
installed versions, original automatic-update preferences and group scene 19:
`.build/ota-1.10.1-fleet-baseline-1791493231724.json`. No mutations occurred.

Five samples over about 13 seconds proved accepted encrypted ESP-NOW frames:
CoolLamp 1 stayed active on `esp-now` with 296 additional accepted group frames;
CoolLamp 2 reported hybrid coordination and three members. Queue-drop,
authentication-failure and clock-drop deltas were zero; the coordinator had one
failed radio send. The user confirmed CoolLamp 2's Bluetooth Groups/Settings
panels work with the phone's Wi-Fi off. **Lamps outside AP coverage have not been
tested.** A held display or a phone without Wi-Fi is not proof of the lamps'
AP-off radio path. Evidence: `.build/ota-1.10.1-radio-proof.json`.

CoolLamp 2's post-boot update check failed, then repeated with compact polling
and with Bluetooth disconnected: phase 5/error 3, asset-host TLS after HTTP 302
(host 2), TLS error 12288 (`0x3000` generic X.509 fatal error), transport error
32794 (`0x801A` handshake failure), flags 0. Minimum free heap was 848 bytes
at that failure checkpoint. A subsequent automatic check completed: the later
fresh read reported phase 0/error 0, latest 1.9.6 and available false. HTTPS
failures are therefore intermittent, not a permanently failed path. The later
cumulative minimum free heap was 492 bytes, superseding 848 as the current
minimum without altering the earlier logs. This since-boot minimum does not
measure available headroom at the start of a particular TLS handshake.
Memory pressure is a suspect, **not a proven allocation failure**. Source review
found an ordering gap that could start HTTPS before the next network/Bluetooth
resource-cleanup pass. The local **1.10.2 candidate** defers worker notification
until that boundary and fixes the Bluetooth mutation allowlist's omission of
Style endpoint 25, with an actual Begin/Commit regression. Twelve runtime
scenarios and independent review passed. TLS verification, buffer configuration
and saved settings remain intact. Device validation must establish whether this
fix resolves repeat update checks.

The earlier Windows 1.10.2 build and packaging passed: **1,864,128 bytes**,
SHA-256 `ddfdad8787aa95f8ac0214ee8533d4c01e0e312eb5e688a63069cf3bc5bf2f93`.
Initial firmware CI `37842646052` failed on a Linux host-harness macro compilation
problem. The harness-only fix passed all 12 Windows scenarios, and rerun
`37843327031` **succeeded** on source
`b66099080078bc47cbc253cfa23da2a1429df9f5`.

The verified **1.10.2 CI image is 1,863,744 bytes**, SHA-256
`2a1634f9404d40d0aece4632aa60ec94db0d1d1a853192157e1dd0d460028eda`.
Program usage is 1,863,594 bytes, globals 61,612 and remaining OTA image space
167,872 bytes. Public-marker/C3 manifest/layout, local-credential exclusion and
both GitHub asset-digest checks passed. Evidence:
`.build/firmware-1.10.2-ci.log` and
`.build/firmware-1.10.2-ci-assets/verification.json`.
**Firmware 1.10.2 remains an unpublished draft; public Latest remains 1.9.6.**
CI/build success does not establish a device installation or TLS fix.

One guarded manual local HTTP upload to CoolLamp 2 used that exact verified CI
image. Bluetooth was disconnected and the coordinator was idle. Before upload,
free heap was 27,752 bytes, largest block 18,420 and cumulative minimum 492.
Its original enabled automatic-update preference was temporarily held disabled,
then restored enabled and confirmed. Curl ended with error 52/HTTP 000 and an
empty reply after 7.239553 seconds, reporting `size_upload: 392924` to verified
remote `192.168.1.222`. This is a **partial upload**, below the 1,863,744-byte
image size. No upload was replayed, no restart was requested and no other lamp
was changed. Evidence: `.build/ota-1.10.2-manual-C2.json`.

Fresh readback still showed CoolLamp 2 running 1.10.1 with continuous uptime.
The journal conservatively retains a possible queued boot slot; next-boot
selection has not been verified. At `2026-10-08T21:15:38Z`, the post-failure
read-only comparison reported uptime 4865638 ms, automatic updates enabled,
Wi-Fi connected, coordinator role 1 and scene 19. **All compared saved-settings
and runtime-control differences were empty.** Evidence is
`.build/ota-1.10.2-manual-C2.json` → `postFailureReadOnlyVerification`.
A fresh eight-GET fleet baseline also confirmed unchanged installed versions,
original automatic preferences, group roles and scene 19:
`.build/ota-1.10.1-fleet-baseline-1791493971087.json`.
Three additional read-only counter samples confirmed group recovery after the
partial upload: the follower remained active on ESP-NOW in scene 19, accepted
146 more frames, and the coordinator retained three members. Evidence:
`.build/ota-1.10.2-post-upload-radio-proof.json`.

**At this earlier checkpoint, no 1.10.2 device runtime or TLS result had been
observed.** The latest physical section now confirms running 1.10.2 and successful
firmware status on CoolLamp 1/2/new lamp, while repeat TLS/AP-off acceptance
remains open. CoolLamp 2's healthy later boot supersedes this record's next-boot
uncertainty; the partial transfer does not establish the installation path.
USB remains optional, and no controlled next-boot test or repeated manual upload
was performed by the agent.

New app navigation uses lamp-card gears and organized per-lamp settings, with
only Lamps and Groups in bottom navigation. Independent lighting stays in lamp
settings; grouped controls live in Groups. Current-effect cards use each
standalone lamp's own catalog or its verified group scene, reject stale results
and retain the existing Mirrored controls. Local validation passed **291 mobile
tests**, 16 mocked UI scenarios and independent race/layout review. A separate
GET-only check observed the user's Bass cathedral group selection on all four
lamps with four diagnostics reads and no mutations (`.build/current-effect-live.json`).

App **1.0 (35.1)** is the latest accepted TestFlight upload. Existing macOS
CI run `37843221334` succeeded on source
`6a468d46e2c7ddea0cbb2df533118186de08b15a`. The log confirms build 35.1
and reports `UPLOAD SUCCEEDED with no errors` at
`2026-10-08T21:01:24.3685690Z` (2026-10-08 16:01:24 CDT). Evidence:
`.build/ios-testflight-35.1-ci.log`. Tester availability and phone installation
are not independently queried. App 34.1 is the earlier accepted design/filter
checkpoint. Firmware 1.10.2 CI succeeded; device runtime/TLS evidence was still
pending at this earlier checkpoint and is superseded where noted above.

The earlier 1.10.0/1.10.1 draft and USB-pending checkpoints below are historical
and superseded by this live GitHub OTA evidence. Same-IoT forwarding, lamps'
AP-off/Bluetooth coexistence, 1.10.2 next-boot/device/TLS acceptance, physical
new-scene/music acceptance and longer blackout/thermal diagnosis remain separate
open work.
Raw Mac diagnostics/prototype binaries remain an unfilled migration gap. Keep
all GitHub actions scoped to verified personal `jammendolia`, preserve the
original working tree and use the isolated release checkout for scoped commits.
No router changes were made.

## Earlier design/build checkpoint — 2026-10-08: app 34.1 and 1.10.1 draft

This section records the pre-rollout design/build checkpoint. Its draft,
not-installed and USB-pending statements are superseded by the current live
OTA section above; retain its source, artifact and validation evidence.

At this checkpoint the user requested Helix, Large helix and Corkscrew design
classification, representative card illustrations and an optional **For this
style** effect filter. All effects remains the default, using only the current
lamp's catalog. Existing effect IDs, group rendering, GPIOs and saved lighting
settings remain unchanged. See [the design contract](lamp-styles.md).

The app stores selections on the phone for existing 1.9.6 lamps, with explicit
scope labeling. At this checkpoint the **1.10.1 candidate** added protected
HTTP/Bluetooth Style endpoint 25 and design reporting through state and
diagnostics; the later Bluetooth mutation-allowlist omission is tracked in the
current 1.10.2 work above. Neither test lamp had the candidate installed then.
The earlier 1.10.0 CI image/draft was preserved, and public Latest was 1.9.6.
USB access to CoolLamp 1 was pending after the failed local OTA upload, with no
replayed upload or settings changes. The later built-in GitHub OTA superseded
this USB-pending status. Local validation passed 263 mobile tests,
the production app build, 11 style UI mocks, 10 group-shortcut mocks, typed
NVS/restart/failure tests, actual protected HTTP/Bluetooth endpoint tests and
43 factory-reset power-loss boundaries. No hardware reset was performed.

App **1.0 (33.1)**, the Wi-Fi/Bluetooth card indicator checkpoint, was accepted
by Apple on source `437727f34030262a8f7f1ed6525c1e6162fff1ab`, workflow run
`37824190571`, at `2026-10-08T18:30:49.6000750Z` (13:30:49 CDT), with 233 tests.
Its log is `.build/ios-testflight-33.1-ci.log`. It does not include the later
group shortcut or physical-design UI. All GitHub actions used verified personal
`jammendolia`; HiFin remains untouched.

The combined update **1.0 (34.1)** was accepted by Apple through existing macOS
CI run `37829525364`, source `4a21fd1b47f0f74f21a6f1e066fe8563d644bf7f`, on branch
`codex/lamp-design-1.10.1`, at `2026-10-08T19:11:39.1871170Z` (14:11:39 CDT).
The log reports `UPLOAD SUCCEEDED with no errors`; 263 tests, production build,
native checks and signed archive/export passed. It includes group shortcuts,
style illustrations/selection and the optional filter. Tester availability
and installation are not independently confirmed. Evidence:
`.build/ios-testflight-34.1-ci.log`.

Firmware CI run `37830367881` succeeded on source
`43816d59353f8af5b467acf18b6f5698454998c7`, including Linux sanitizer and actual
pinned Mbed TLS checks. Its **1.10.1 release was an unpublished draft at this
checkpoint**, before the publication/installation and prerelease retention
recorded in the current section.
The downloaded CI image is **1,863,648 bytes**, SHA-256
`e0901f763ca9cf2547b750c88e4ae9abb054f7592128fcfce586d0830c08b0e1`.
Manifest/version/C3 layout, public marker, local-credential exclusion and both
GitHub asset digests match. Program usage is 1,863,508 bytes, globals 61,612,
and remaining OTA image space is 167,968 bytes. Evidence:
`.build/firmware-1.10.1-ci.log`, `.build/firmware-1.10.1-ci-assets/verification.json`
and `.build/lamp-design-1.10.1-development-record.json`.

The separate Windows image also passed build/packaging: 1,864,032 bytes, SHA-256
`95fb51b6afb4d2f0366455ddb13a29821e05b27a3f8ec4e4272daec2536a84bb`.
It is preserved under `.build/lamp-style-1.10.1-windows-assets/`; the earlier
1.10.0 images/source/draft are retained. This checkpoint recommended the
verified 1.10.1 **CI asset** for a proposed USB test after identity/backup checks.
No candidate had been installed then, and no hardware reset, GPIO change or
lamp-settings change occurred. Public Latest was verified as `firmware-v1.9.6`
after the draft completed. That proposed USB prerequisite and pre-publication
status were superseded by the later authorized GitHub OTA rollout above.

## Earlier app checkpoint — 2026-10-08: lamp-card connection indicators

The user requested clickable Wi-Fi strength and Bluetooth icons on every lamp
card, replacing the separate Connect by Bluetooth text link. This is an
app-only change: firmware 1.9.6 already supplies authenticated per-lamp RSSI
through `/api/diagnostics`. The existing bounded background firmware reads
also collect identity-verified Wi-Fi telemetry; no extra HTTP polling is added.

RSSI uses three arcs at -55 dBm or better, two through -67, one through -80,
and a dot for weaker connected signals. Missing, invalid or 30-second-old
strength/status gets a small question-mark badge; a circle/slash requires a
fresh explicit disconnected report. Request-start timestamps and separate
signal age prevent slow replies or boolean-only Bluetooth updates from making
old RSSI appear current. No signal data or credentials are persisted by the
session cache. Foreground Lamps refreshes reuse the fleet pipeline every
20 seconds and pause when hidden.

Wi-Fi icon clicks open that exact lamp's Network panel after identity-verified
Wi-Fi or Bluetooth connection, including a guarded password retry. Bluetooth
is blue only for a live identity/epoch-verified connection owned by this app;
saved pairing and pending connections remain subdued. Its icon initiates
Bluetooth connection, with exact lamp identity checks and existing six-second
physical pairing for a new device. The old card text link is removed.

The user then requested a third group-membership icon. Verified leaders and
followers are highlighted; independent/unknown lamps stay subdued. Its
identity-verified role/leader data comes from the same diagnostics request,
with a separate freshness timestamp. Clicking opens Groups and focuses the
lamp's latest group or independent/unavailable row after fresh inventory.
The selected control lamp remains unchanged; no membership mutation occurs.
Navigation/click generation guards prevent a late result stealing focus.

Fresh read-only integration made two GETs: both test lamps most recently
reported -60 / -59 dBm (two arcs), with CoolLamp 1 a follower of CoolLamp 2 and
CoolLamp 2 the leader. Evidence:
`.build/lamp-card-connectivity-live.json`. The 44 focused telemetry/fleet tests
passed. Final app validation passed **233/233 tests**, the Vite production
build, and mocked production card interactions: three/two/one arcs, timeout
question mark, confirmed disconnection slash, verified main/auxiliary blue
Bluetooth only, exact-lamp Wi-Fi settings/password retry, wrong Bluetooth
picker rejection before commands, cancellation and legacy firmware polling.
Mobile and desktop previews are `.build/ui-check/lamp-connectivity-mobile.png`
and `lamp-connectivity-desktop.png`. Phone acceptance remains pending. Public
OTA was 1.9.6, and the ESP-NOW 1.10.0 draft's USB test was pending at this
earlier checkpoint. Later GitHub OTA/radio evidence above supersedes that status.

## Earlier offline-groups checkpoint — 2026-10-08: 1.10.0 draft and app 32.1

The user requested Bluetooth control/configuration plus ESP-NOW group
coordination when Wi-Fi is unavailable, and a separate Groups page showing
leaders, followers and independent lamps without selecting a coordinator.
At this earlier checkpoint, the local candidate was **1.10.0**, not published,
and public Latest was 1.9.6. Its draft/USB-pending evidence is preserved here;
the later 1.10.1 GitHub OTA and accepted radio frames supersede that status.
App **1.0 (32.1)** was accepted by Apple through the existing macOS workflow
run `37814009967` on source `28b81f142f6128638cb90feea388f522f9205336`, branch
`codex/offline-groups-1.10.0`. It passed 220 tests and native checks; Apple
reported `UPLOAD SUCCEEDED with no errors` at `2026-10-08T17:10:32.0898510Z`
(12:10:32 CDT). Evidence: `.build/ios-testflight-32.1-ci.log`. Tester
availability/phone installation are not independently confirmed. Read
[the new implementation and test checkpoint](offline-groups.md) before
resuming this work.

Firmware CI run `37814005688` also succeeded on source `28b81f142f6128638cb90feea388f522f9205336`,
including Linux sanitizer and real pinned Mbed TLS checks. Its release is an
unpublished draft. The verified CI image is 1,859,792 bytes, SHA-256
`30eb2a3a603e4590576086c31793ab3415d9221773da308b4b461ff041a62813`,
saved in `.build/firmware-1.10.0-ci-assets/`. It was the proposed USB acceptance
image at this checkpoint; public Latest was verified as `firmware-v1.9.6`.

The chosen test pair, CoolLamp 1 (`acb950b2f180`, `.154`) and CoolLamp 2
(`f0b950b2f180`, `.222`), were freshly verified on 1.9.6 with stable Wi-Fi.
The sanitized baseline is `.build/hybrid-test-lamps-baseline.json`.
CoolLamp 1 still has startup effect 43/brightness 215; CoolLamp 2 has startup
effect 46/brightness 55. Both participated in scene 27 at this checkpoint. One
local OTA upload to CoolLamp 1 failed with an empty server reply; its subsequent
readback confirmed 1.9.6 with continued uptime and unchanged compared settings.
CoolLamp 2 was not uploaded then, and USB access to CoolLamp 1 was pending.
Both lamps later completed built-in GitHub OTA once each; the current section
records the installed version and restored automatic preferences. Preserve
fresh settings rather than assuming an older snapshot still applies.

## Earlier public-release checkpoint — 2026-10-07: 1.9.6 and app 31.1

[Firmware 1.9.6](https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.9.6)
is the latest public OTA release, published at `2026-10-08T02:50:54Z`
(2026-10-07 21:50:54 CDT). Source and immutable tag both resolve to
`bfa04d6e0055b90561c749325cb300992b1ca39f` on
`codex/corkscrew-effects-1.9.6`. Firmware CI run `37719063401` succeeded,
including the 166 mobile tests, release packaging and new renderer suite with
ASan/UBSan. All GitHub actions used verified personal **jammendolia** only;
HiFin remains untouched.

The published CI application is **1,830,400 bytes**, SHA-256
`091bb636be3317328b0e4346f5a139d50e7af07a992c0b1a6832a53484263417`.
Program usage is 1,830,258 bytes; globals are 52,748 bytes. The 2,031,616-byte
OTA slot has 201,216 bytes of remaining image space. Anonymous downloads of the
latest manifest and pinned 1.9.6 binary matched the verified CI bytes and hash;
local-credential exclusion checks passed. This published image is different
from the earlier Windows candidate retained below. Evidence:
`.build/firmware-1.9.6-ci.log`,
`.build/firmware-1.9.6-ci-assets/verification.json`,
`.build/firmware-1.9.6-ci-assets/published-release.json`, and
`.build/firmware-1.9.6-public-verification/verification.json`.

App **1.0 (31.1)** was latest at this earlier checkpoint. The existing macOS
workflow run `37719065609` succeeded on the same source, including 166 tests,
native Swift accessory/address checks, web build and signed archive/export.
Apple reported `UPLOAD SUCCEEDED with no errors` at
`2026-10-08T02:46:34.0273470Z` (2026-10-07 21:46:34 CDT). Evidence:
`.build/ios-testflight-31.1-ci.log`. Tester availability and phone installation
have not been independently queried. App 30.1 remains the earlier direct-join
checkpoint; app 29.1 is the preceding firmware-fleet checkpoint.

The app update adds scenes 27–32 and their 1.9.6 compatibility labels, retaining
asynchronous firmware-card checks, explicit sequential Update all and direct
network coordinator joining. Every group member needs firmware 1.9.6 or newer
for the six new scenes; the selected coordinator's advertised scene count still
filters its catalog. The first two new scenes are ambient and the last four
require the coordinator microphone. GPIOs, geometry/defaults, settings/NVS,
group keys/order and wire layout are preserved.

At this publication checkpoint no hardware requests/flashing were performed,
and no 1.9.6 installation had been confirmed. The subsequent four-lamp baseline
and test-pair 1.10.1 GitHub OTA supersede those installation gaps. Physical
corkscrew/music acceptance, same-IoT forwarding and longer blackout/thermal
investigation remain separate unresolved work. The raw Mac diagnostics and
prototype binaries remain an unfilled migration gap.

## Earlier local development checkpoint — 2026-10-07: corkscrew effects candidate

Six new group scenes 27–32 are implemented for corkscrew, helix and mixed rooms:
Chromatic screw, Mercury ribbon, Bass turbine, Prism torque, Echo coils and
Aurora braid. The first two are ambient; the last four require the coordinator
microphone. Every scene retains a colored field during silence/dropout. Existing
0–26 rendering, GPIOs, strip geometry/defaults, settings/NVS and wire v2 remain
unchanged. Existing midpoint calibration supports unequal spine/spiral lengths;
the new lamp's exact wiring/count/top-turn boundary is still unconfirmed.

At this earlier checkpoint, firmware **1.9.6 was a local unpublished candidate**,
built and packaged at
1,830,784 bytes, SHA-256
`a1db07d1de968d94a1e007938119b79ca8d085bc26f2540347079403c8a81cdd`.
Public OTA then remained 1.9.5, and TestFlight 30.1 was the accepted app; the new
six-entry app catalog and 1.9.6 compatibility labels had not been uploaded.
No physical lamp operations or GitHub publication had been performed for this set.
Prior Windows firmware artifacts were preserved before rebuilding.

Validation passed: 68,673,600 new-scene LED samples all lit at normal settings,
exact legacy-render signature, protocol/runtime microphone/persistence checks,
166 mobile tests, production web build and four packaging checks. Six mocked
built-app scenarios passed with 46 intercepted lamp requests. The actual-renderer
preview now animates Helix/Corkscrew/Mixed rooms, 2/3/5/9 lamps, audio/silence;
336 browser control combinations and timing/layout checks passed. Hardware
acceptance and sanitizer CI were pending at this checkpoint. See
[the effects and evidence](corkscrew-effects.md). Existing OTA, networking,
thermal and missing Mac raw-evidence gaps remain separate.

## Earlier accepted upload — 2026-10-07: direct group joining; app 30.1

The user requested that Settings → Groups discover network coordinators and
join directly without switching lamps or copying a group code. App-only source
`c6674ba38cc76214d2d311c003fff1f1513095f0` is pushed to
`codex/firmware-1-9-5-temperature-room-audio`. Existing macOS CI run
`37698202209` completed successfully for app **1.0 (30.1)**, including
165/165 CI tests, native Swift accessory/address checks, web build and signed
archive/export/upload. Apple reported `UPLOAD SUCCEEDED with no errors` at
`2026-10-07T22:50:22.803933Z` (17:50:22 CDT). Evidence:
`.build/ios-testflight-30.1-ci.log`. App 30.1 was latest at this checkpoint;
29.1 is the preceding checkpoint. Tester availability and phone installation
have not been independently queried. Every GitHub action uses personal
**jammendolia** only. Published firmware 1.9.5 remains unchanged.

Groups now scans asynchronously from saved lamps, native mDNS discovery and
the selected lamp's UDP peer hints. Authenticated reads verify device identity,
current coordinator role, wire compatibility and available group capacity.
An explicit **Join** obtains a private invitation in the background, then uses
the selected target's fresh token with identity/address/connection-epoch/wire
guards. The app keeps the selected lamp and its catalog; it does not expose the
invitation through the DOM, storage or clipboard. A custom-password modal saves
the password in the native vault only after verification. An optional Advanced
manual-code fallback remains available; joining does not silently leave an
existing group. Status distinguishes saved/waiting settings from actual
following, and an uncertain join POST triggers read-only readback without replay.

Seven mobile paths changed; firmware, native code and GPIO assignments are
unchanged. Local validation passed **165 tests**, the production web build and
seven mocked browser scenarios with 271 intercepted requests. A separate live
**GET-only** scan verified CoolLamp 2 as coordinator on 1.9.5 with zero members,
identified CoolLamp 1 as not a coordinator, and reported BACL's unreachable
status separately. Evidence: `.build/group-discovery-live-validation.json`.
No live invitation request or membership mutation was performed; joining and
credential/error scenarios are mock-validated, and actual devices are unchanged.
The existing IoT-to-IoT UDP limitation remains separate: saving group settings
does not guarantee the follower receives discovery, subscribes or follows.

New lamp first install (2026-10-07): COM6, MAC `24:EC:4A:AF:94:58`, device
`5894af4aec24`, hostname `coollamp-af9458.local`. The user confirmed it was
brand new and requested no backup. Verified ESP32-C3 revision 0.4/4 MB received
the pinned bootloader, dual-OTA partition table, initial app0 selector and exact
published 1.9.5 application. All four written hashes verified. Twenty USB
diagnostic samples showed advancing frames/uptime, valid 36–39 C chip readings,
and no observed reset, through uptime 65828 ms. Defaults are 134 LEDs/midpoint
0, Fire/brightness 100, microphone disabled, automatic updates disabled and
Wi-Fi unconfigured. No pairing/group enrollment was performed. Evidence:
`.build/new-lamp-24ec4aaf9458-1.9.5-validation.json`. USB capture is closed.

## Earlier verified follow-up — 2026-10-07: all lamps updated; app 29.1 uploaded

App **1.0 (29.1)** was accepted at this earlier checkpoint, from source
`d8620a428406bdd4a9a8cb3fcd0188135b43bc70`. Existing macOS CI run `37692263376`
succeeded, including 134/134 tests, native Swift accessory/address checks,
web build, signing, archive/export and upload. Apple reported
`UPLOAD SUCCEEDED with no errors` on 2026-10-07 at 16:56:54 CDT.
Evidence: `.build/ios-testflight-29.1-ci.log`. Tester availability and phone
installation have not been independently queried. App 28.1 is the earlier
firmware-card upload; app 29.1 adds asynchronous per-card status reads and
explicitly triggered, sequential **Update all**.

CoolLamp 2 now runs the exact **published firmware 1.9.5** image after USB
bootstrap. COM5 and MAC `80:F1:B2:50:B9:F0` were verified. Its fresh 1.9.4 boot
completed secure HTTPS setup and began automatic download, but reached only
47% before the existing 180-second limit ended in phase 5/error 6. This was a
failed full OTA attempt, followed by a separate successful USB installation.
Evidence: `.build/coordinator-published-1.9.5-auto-ota-attempt.json`.

The fresh private 4 MiB backup has SHA-256
`703b82e9fffa7e5fde52bd3db6ae6075e359776a5142198898247a04473fb2ea`.
CRC-valid metadata selected app0, sequence 5/state 2; the recovered old image
matched `f9c1e3bb0f9f0e926e4c8ec0ba2994e570e31162cce44a413c367ab3a6afe223`.
Only app0 at `0x10000` was written with the immutable published CI image,
1,828,656 bytes, SHA-256
`aabfb5bfcd314242c381b3494cbe7aca09b43f58d0de4b4d101e0e7e487d0082`;
ROM write-hash verification passed. Raw readback found **no logical NVS
changes**, and partition table/OTA metadata were unchanged. Saved API settings
and runtime controls also matched (`changedFields: []`). GPIO assignments and
lamp settings remain preserved; all recovery blobs stay private under `.build`.

The new boot showed valid temperature 53.7 C at 41.8 seconds, sceneCount 26,
power on, mode 46, brightness 55, 134 LEDs/midpoint 0. The subsequent 95-second
USB capture showed at least 93.6 seconds of stable observed operation. A fresh
secure manifest check **passed**: latest 1.9.5, phase 0/error 0, available false,
HTTP stage 7/code 200/host 2, TLS error/flags 0 and transport 0. Later HTTP
diagnostics at uptime 174306 ms reported valid 55.7 C and sceneCount 26.
Evidence: `.build/coordinator-published-1.9.5-usb-boot.jsonl`,
`.build/coordinator-published-1.9.5-https-check.jsonl`, and
`.build/coordinator-1.9.5-usb-settings-comparison.json`.
CoolLamp 2 can return to normal power. CoolLamp 1's later COM3 bootstrap is also
complete; MAC `80:F1:B2:50:B9:AC` was verified. Its fresh private 4 MiB backup
has SHA-256 `14a2e6fb973b02f79830c67f70b7e37fa808e4c4261a738d1c781ffc9686bfe6`.
CRC-valid sequence 22/state 2 selected **app1 at `0x200000`**, so only that
verified active slot was written with the exact published 1.9.5 image; ROM hash
verification passed. Partition table/OTA selector and **all logical NVS records**
were unchanged (`nvsChanges: []`). Saved API settings and runtime controls
matched (`changedFields: []`). Preserve its freshly verified, distinct settings:
startup mode 43/brightness 215, microphone installed with automatic gain,
gain 8/gate 10/scale 115, 134 LEDs/midpoint 0, automatic updates enabled,
follower role 2 with CoolLamp 2 as leader. Prior-day snapshots are not authoritative.

CoolLamp 1's healthy 95-second USB capture had 45 valid records spanning
95363 ms. Its scheduled secure check passed: current/latest 1.9.5, phase 0,
error 0, HTTP stage 7/code 200/host 2, TLS error/flags 0 and transport 0. Final
diagnostics at uptime 150004 ms showed valid 57.7 C and historical peak 58.7 C.
Evidence: `.build/lamp1-published-1.9.5-usb-boot.jsonl`,
`.build/lamp1-published-1.9.5-https-check.jsonl`,
`.build/lamp1-1.9.5-usb-nvs-comparison.json`, and
`.build/lamp1-1.9.5-usb-settings-comparison.json`.
CoolLamp 1 can disconnect USB and return to normal power. Final separate reads
confirmed **all three lamps on firmware 1.9.5**, power on, mode 46, brightness
55, group scene 0 (`.build/other-lamps-after-lamp1-bootstrap.jsonl`). CoolLamp 1
and CoolLamp 2 run the exact published CI image; BACL retains its validated
Windows 1.9.5 build. Full secure OTA installation, physical new-scene/audio
acceptance and longer blackout/thermal follow-up remain open. The user noticed
no blackout during the short comparisons, but observation was incomplete.

Earlier app **1.0 (28.1)** introduced per-device installed-firmware cards: **Last seen**
for disconnected remembered versions and **Connect to view** for unknown
versions, with no extra hardware polling. Four mobile files changed; 104/104
tests, production web build and mock browser check passed. Commit
`a3499e89a69fcb7bbb56b6a9f3fdae4f21761821` completed existing macOS CI run
`37688466205`; Apple reported `UPLOAD SUCCEEDED with no errors` on
2026-10-07 at 16:23:19 CDT. Evidence: `.build/ios-testflight-28.1-ci.log`.
Tester availability and installation remain unverified. Earlier app 27.1's
accepted upload and immutable firmware source commit
`7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f` remain established history.
Every GitHub action uses personal **jammendolia** only; HiFin remains untouched.
The requested asynchronous per-card status refresh and explicit **Update all**
are now implemented in source `d8620a428406bdd4a9a8cb3fcd0188135b43bc70`, pushed
to the existing codex branch. Local validation passed 134/134 tests, production
web build and mocked UI checks, including one blocked/deferred ping while other
cards update and Light/Settings navigation/other-lamp controls stay usable.
Update all processes lamps sequentially with per-lamp progress/errors; offline
or missing-password lamps fail separately. Selection, disconnection and saved
automatic-update preferences are not changed. Installed-versus-latest checks
and timestamp ordering guards prevent stale or misleading card results.

Page-open/background refresh only reads lamp status; updates started by the app
require an explicit button. A separate live GET-only refresh verified all three device IDs
and returned installed/latest 1.9.5, with no available update. Evidence:
`.build/firmware-fleet-live-refresh.json`. Install behavior was validated with
mocks; these live reads do not establish an actual full secure OTA installation.
Existing macOS CI run `37692263376` completed successfully for app **1.0 (29.1)**
(run number 29, attempt 1), with 134/134 CI tests and native Swift checks passing.
Its signed archive/export/upload passed; Apple accepted the upload at
16:56:54 CDT (`.build/ios-testflight-29.1-ci.log`). Tester availability/phone
installation remain unverified. App 28.1 is superseded as the latest accepted
upload but retained as an earlier checkpoint. Actual bulk installs remain
mock-validated; live fleet verification was GET-only, and full secure OTA,
new-scene/music, thermal/blackout and IoT-to-IoT acceptance remain separate gaps.
The checkpoints below retain earlier states and are superseded where this
latest block records new hardware or app results.

Earlier publication checkpoint (2026-10-07): [firmware 1.9.5](https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.9.5)
is now the latest public release, from commit
`7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f`. Firmware CI run
`37682079916` passed. The published application image is 1,828,656 bytes,
SHA-256 `aabfb5bfcd314242c381b3494cbe7aca09b43f58d0de4b4d101e0e7e487d0082`.
The existing macOS TestFlight workflow also succeeded (run `37682084000`),
and Apple accepted app **1.0 (27.1)**. Tester availability and user installation
have not been independently verified. Every GitHub action used a verified
process-local **jammendolia** identity; the HiFin account was untouched.

BACL still runs the temperature-enabled Windows 1.9.5 build, SHA-256
`13940566fe29d92c668820ebd6319f67aac7424d99ef78c7ef9f2203306709ab`.
It has the same source as the published release but different binary bytes;
the normal version gate does not offer another 1.9.5 image. At that checkpoint,
CoolLamp 2 and CoolLamp 1 were observed running 1.9.4. Their quiet HTTPS checks failed
with error 3, TLS 12288, transport 32794, HTTP 302, host 2; CoolLamp 2's manual
check also failed. Authenticated Python and curl local uploads to CoolLamp 2
returned empty replies. Upload success and its next-boot image were unconfirmed;
USB identity/OTA-selection verification and bootstrap were pending then.
CoolLamp 2's later verified bootstrap is recorded above. Publication does not establish a completed OTA installation,
a blackout/thermal fix, or a resolution of the IoT-to-IoT network issue.

Earlier live snapshot (2026-10-07, after initial publication): all three lamps
were on, mode 46, brightness 55, group scene 0. BACL was unpaused and actively
following, with chip temperature 61.1 C. These controls were the preservation
baseline for USB bootstrap rather than the earlier thermal-test controls.
BACL's fresh secure check completed phase 0/error 0 with latest 1.9.5,
HTTP stage 7/code 200/host 2, TLS error/flags 0 and transport 0 while group sync
was active. This proves the published-manifest check, not a same-version OTA
installation or unchanged controls throughout the check. Evidence:
`.build/bacl-published-1.9.5-check.jsonl` and
`.build/ota-1.9.5-current-lamp-status.jsonl`.

Earlier USB/thermal resume (2026-10-07): the user returned with BACL on USB and the base open.
At their temperature-sensor inquiry, chip-temperature telemetry was added and
the updated 1.9.5 candidate installed on verified BACL/COM4. Only app0 was
written; all non-PHY logical NVS records, partition table and OTA metadata
remained unchanged. The full pre-update recovery backup is private under
`.build`. A two-minute capture recorded 208 valid readings at 55.1–56.1 C, no
uptime resets, power changes or rendering stalls; this is USB/open-base evidence,
not proof about the original blackouts. Controls at that capture checkpoint:
Fire/brightness 100, power on, group paused. Wi-Fi temperature telemetry works.
All captures ended.
Normal-supply/open-base Wi-Fi baseline is now complete: 526 successful replies
over five minutes, 54.1–57.1 C, no observed resets/power changes, 18 read timeouts
retained as gaps. Controls matched the USB baseline; coordinator remained off.
Closed-base comparison is now complete: five minutes, 590 successful replies,
56.1–59.1 C, no observed resets/power changes, three read timeouts. Both windows
used Fire/brightness 100/group paused. A restored two-minute Orbit group test
on normal power/closed base returned 233 replies, 59.1–60.1 C, no resets or
power changes; following stayed active after joining. All controls were restored:
BACL on, Fire 100, group paused; coordinator off with Orbit settings retained.
Base remains closed on usual supply. No capture is active. Physical blackout
confirmation is inconclusive: the user noticed no blackout but was multitasking
and may have missed one. Short captures and rising temperature do not prove or
exclude heat as the historical cause. No firmware/settings change between these
thermal phases. Longer warm-up, local-off device acceptance and full OTA remain
pending despite the subsequent publication recorded above.
The user subsequently authorized publishing this temperature-enabled firmware
for OTA and the pending mobile changes to TestFlight; both CI uploads completed.
Continue using only jammendolia and the existing macOS CI, preserving this working tree.
See [group-network-debugging.md](group-network-debugging.md) for evidence.

Earlier source-work checkpoint while hardware diagnosis was paused: the user requested more
room-filling audio group effects. Eight scenes (IDs 19–26) are implemented and
host/build validated, with a real-renderer room preview. See
[room-audio-effects.md](room-audio-effects.md) for designs, compatibility and
current candidate hash. BACL had the candidate including those scenes and
the local off fix, but physical multi-lamp/audio acceptance has not run; the
coordinator was still on 1.9.4 at that checkpoint. The scene-catalog app was
uploaded as 1.0 (27.1), and firmware publication was complete.
Hardware/thermal/OTA acceptance remained pending.

Windows continuation: see [windows-development.md](windows-development.md) for
the verified migration state, local tooling, private backup and remaining
release-validation gaps. The Mac checkpoint below is historical. Its ignored
diagnostics remain on the Mac; the source checkpoint did transfer successfully.
For CoolLamp GitHub operations, explicitly verify and use **jammendolia only**;
the Windows CLI's global default is HiFin and must not be used for this project.

## Checkpoint and user intent

The user requested a safe breakpoint to reboot the Mac, then continue in a fresh chat. Stop active engineering at this checkpoint. No flash is in progress. The final production build completed successfully, exit 0; do not confuse a successful build with a published or device-tested release.

Latest steering: user wants to move routine development to Windows machine **Beefinator**, retaining the Mac for iOS builds/testing. They also have a machine with a Ryzen 7 5800, 64 GB RAM, RTX 3070 8 GB. Its OS/storage and Beefinator's specifications have not been confirmed. That machine is ample for this project; no evidence establishes it is faster than their Mac or Beefinator. GPU does not accelerate the current firmware/mobile build pipeline. No files have been transferred and no Windows setup has been performed yet.

Update: Beefinator has Intel Core Ultra 7 255H, 64 GB DDR5-5600, RTX 3050 Laptop 4 GB, and Intel Arc 140T. The user chose Beefinator, then requested committing the current work before migration. This checkpoint is being saved on **`checkpoint/windows-migration-2026-10-06`**, based on the latest app branch `release/firmware-1.9.5`. Clone that checkpoint branch on Windows. Source, docs, CAD, images and pending TLS build changes are included; build caches, private secrets, KiCad session files and generated example firmware are excluded. This is a source checkpoint, not a new firmware or TestFlight release.

Repository: `/Users/jammendolia/Dev/Gasper/CoolLamp`. Read this file and `docs/wifi-debugging.md` before continuing. Preserve the existing working tree: it contains months of accumulated changes, while local Git HEAD is old. Do not reset, clean, or broadly stage it.

## Historical Mac objective on resumption

Finish and validate the firmware OTA memory fix, then prepare firmware 1.9.5. Firmware 1.9.5 has NOT been published. The user previously authorized firmware publishing, USB flashing to the connected lamp, and TestFlight publishing; the latest instruction pauses work until after reboot. Continue only when the user resumes.

Secondary unresolved issue: the synchronized group has no live UDP peers, despite all three lamps being joined to the same Wi-Fi. Do not claim the OTA memory fix resolves this separate issue.

## Published state at the historical Mac checkpoint

* Public firmware: **1.9.4**, release `firmware-v1.9.4`, https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.9.4 . The radio uses `WiFi.setSleep(false)`. This release still has the original 16 KB TLS transmit buffer and can fail manual update checks under memory pressure.
* Branch `release/firmware-1.9.4`: head `c19b4ea3b1932334921f90eb515c4fb838ac22cb`, tree `0477e514d8f3e9f91d35a838a18cd90f602e2248`. Published binary: 1,821,936 bytes, SHA256 `f9c1e3bb0f9f0e926e4c8ec0ba2994e570e31162cce44a413c367ab3a6afe223`.
* Latest app uploaded and accepted by Apple: **1.0 (26.1)**. User installation has not been confirmed. Workflow run `37478950734`, job `112321717425`, successful upload. This build reduces firmware progress polling allocations by using `/api/firmware` instead of repeated full state requests while checking/downloading/restarting.
* Branch `release/firmware-1.9.5`: head `76f1108d44ae0b68b45a0830adcd3894b6a776ab`, tree `6fed8b7df662a8db1976051c70ea80dd33a45852`. This branch currently contains app 26.1 and documentation, not a firmware 1.9.5 release. `LampVersion.h` is still 1.9.4.
* App 26.1: 97 mobile tests and the Bluetooth/Wi-Fi browser check passed. See `.build/ota-compact-mobile-tests.log`, `.build/ota-compact-browser.log`, `.build/ota-compact-app-build.log` if present.
* `.build/wifi-reception-publish-record.json` and `.build/ota-memory-publish-record.json` record previous publishing details.

## Proven OTA failure and tested fix

The release server is healthy. Both automatic and manual updates use the same updater path. Quiet automatic checks occasionally succeed; manual checks often fail because the C3 runs out of heap during RSA certificate verification for the release-assets HTTPS redirect.

USB diagnostic wrapper captured **-17040 (-0x4290)** from PK verification: RSA public operation failure (-0x4280) combined with MPI allocation failure (-0x0010). Minimum free heap was **572 bytes**. CoolLamp 2's user-supplied diagnostics independently showed **192 bytes** minimum free heap, TLS error 12288 (0x3000), transport error 32794 (0x801A), redirect HTTP 302, host 2. This is not evidence of a bad password, expired certificate, or defective ESP32.

SDK defaults allocate 16 KB receive and 16 KB transmit TLS buffers. The working prototype rebuilds only the SDK SSL archive with **16 KB receive / 4 KB transmit**, saving approximately 12 KB. It preserves certificate verification, SDK trust bundle, SDK crypto/X509 libraries, public headers, and ABI. No insecure TLS fallback was introduced.

On the USB lamp, a boot check and two manually triggered checks succeeded with HTTP 200, no TLS errors, and minimum free heap **13,060 / 13,032 bytes** while diagnostics were polled every 1–2 seconds. A full firmware download/install and production-image device stress tests remain outstanding.

An earlier experiment restricting curves/ciphers did not reliably solve the memory problem. Do NOT adopt the temporary lean-cipher experiment into production `UpdateHttp.cpp`.

## Local changes at the historical Mac checkpoint

* New `tools/build-tls-library.cjs`: pinned-source rebuild and cache of the smaller SSL archive, with source SHA validation, exact public-header comparison, ABI probes, and exported symbol comparison. It does not modify installed SDK archives.
* Modified `tools/build-firmware.cjs`: calls the helper and links the replacement archive with whole-archive flags, preserving the existing Wi-Fi/Bluetooth init wrappers.
* These build changes and this handoff are included in the Windows migration checkpoint branch; they are not a published firmware release.
* Final production build **passed** using these tools. `.build/tls-production-build.log`: verified C3 TLS library, sketch **1,822,292 bytes / 89%**, globals **52,700 bytes**. Output is in `firmware/public` and is still labeled version 1.9.4. Do NOT publish it over the existing 1.9.4 tag or assume it is the original published binary.
* Production helper needs focused regression/failure-guard testing and device testing. Current helper explicitly targets C3; S3 support has not been implemented.

Pinned toolchain: Arduino ESP32 **3.3.11**, ESP-IDF **5.5.5**, Mbed TLS **3.6.6**. Official Espressif Mbed TLS source commit `9d669eadb1955d348986b9280156710aaaadf79f`; tar archive SHA256 `45f5e3ca387dfc1dbc41bd221f56971a6d254eb1a88d8a0faadfa9e0d193719d`. Official IDF submodule metadata confirmed that commit. The SSL archive to replace is **libmbedtls_2.a**, not libmbedtls.a (which holds the certificate bundle).

Useful paths:

* `.build/tls-library/` — new reproducible helper cache/source/output.
* `.build/tls-sdk/build.py`, `build-record.json`, `source-record.json`, `libmbedtls-ota.a` — first verified prototype build and ABI/export evidence.
* `.build/tls-small-live.jsonl`, `.build/tls-small-repeat-1.jsonl` — successful small-buffer checks.
* `.build/tls-probe-live.jsonl` — original allocation failure.
* `.build/tls-small-build.log`, `.build/tls-small-flash.log` — prototype build/flash.

Production build command from repo root:

```sh
ARDUINO_CLI="$PWD/.build/tooling/arduino-cli-local" .build/tooling/node-v22.16.0-darwin-x64/bin/node tools/build-firmware.cjs --public
```

FQBN: `esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=no_fs`. Arduino properties queries must use a repo `.build` build path to avoid writing to the forbidden home cache.

## Lamps at the historical Mac checkpoint

| Lamp | ID | Last known address | Status |
| --- | --- | --- | --- |
| Big Ass CoolLamp / new lamp | `24eae26e9e9c` | `192.168.1.220`, `coollamp-e2ea24.local` | USB test prototype, normal features retained; 205 LEDs, midpoint 102, INMP441 |
| CoolLamp 2 coordinator | `f0b950b2f180` | `192.168.1.222`, `coollamp-50b9f0.local` | Published 1.9.4, 134 LEDs; automatic updates enabled |
| CoolLamp 1 | `acb950b2f180` | `192.168.1.154`, `coollamp-50b9ac.local` | 134 LEDs, INMP441; firmware not freshly confirmed |

USB port last seen `/dev/cu.usbmodem80201`, right USB-A port on session Mac. Re-enumerate after reboot rather than assuming the port name persists. New lamp C3 rev 0.4, 4 MB flash; Wi-Fi MAC `9c:9e:6e:e2:ea:24`.

**Current USB firmware is the diagnostic small-TLS prototype labeled 1.9.4**, built from `.build/sketch-tls-small/CoolLamp` into `.build/firmware-tls-small/`. It includes temporary PK-verification/allocation trace hooks and USB commands: `d` diagnostics; `i` requests a check (no automatic install). The hook calls the real verifier unchanged. The extra `tlsProbe` JSON fields are diagnostic only and should not ship. Automatic install is disabled on this USB lamp. Last observed updater phase 0, error 0, no update available, no upload/download active; safe to reboot the Mac.

Prototype serial helper: `.build/tls-probe-usb.py` (based on `tools/audio-usb.py`). Read its CLI before invoking. Do not overlap serial readers and uploads. No active reader/build/upload was left at the checkpoint.

All lamps use default access password `coollamp` per user instruction. Do not paste customized secrets or raw PCM into logs. Gain/gate/scale on USB lamp: 8/8/100. Saved Wi-Fi TX power on USB lamp is 8.5 dBm (`wifiPower` quarter-dBm 34); preserve it. Keep NVS, bond, group, name, LED-count and midpoint settings during testing. No factory resets unless explicitly requested.

## Network and group findings

Router: Adtran **SDG-8734**, gateway `192.168.1.1`, /24. All three lamps are on **SmellsLikeEarwax_IOT**, WPA Personal PSK + CCMP; main SSID is SmellsLikeEarWax with WPA2/WPA3 mixed security. User confirmed Client Isolation is disabled. Radio AP BSSID `86:4D:4C:D8:F0:89`, channel 11.

Turning off Wi-Fi sleep made the new lamp's Safari page load promptly. App earlier discarded NetService's resolved IPv4 then tried unreliable `.local` resolution; this was fixed in the published app. Direct app connection to `192.168.1.222` succeeds.

However, coordinator and follower diagnostics still show **zero UDP packets received**, zero live peers and members, even after coordinator updated to 1.9.4. Saved `order` entries are not live membership. USB direct TCP probe to coordinator timed out during an earlier test. Mac (`192.168.1.190`, en3 Ethernet) cannot reach lamp IPs and has incomplete ARP, although gateway access works. Tailscale has no exit node/overlapping route; do not disable it because remote session access may depend on it. Exact LAN restriction has not been proven. Investigate independently after OTA is stable, without claiming router isolation is enabled or hardware is defective.

## Historical Mac resume sequence

1. Inspect handoff, build helper and final log; preserve working files. Check actual connected device and current status.
2. Review helper correctness and add focused tests for pins/cache/source/ABI failure handling. Run relevant existing firmware checks. Avoid re-running unrelated UI work unnecessarily.
3. Flash the production image to the authorized USB lamp with its existing settings retained; repeat secure update checks under normal app polling, audio/render/group load. Verify no diagnostic hooks and adequate heap. Keep original release and prototype artifacts available.
4. Prepare a real version **1.9.5**, release workflow/manifest, and validate reproducible CI build. Do not overwrite the published 1.9.4 assets/tag. Publish only after necessary validation. Verify actual full OTA download/install on a lamp, then ask user to check CoolLamp 2's manual update path.
5. Resume group-network debugging separately once updater stability is established.

Local `.git` is read-only in this environment. Previous releases were made using GitHub connector `create_tree`, `create_commit`, `update_ref` with expected SHA, overlaying only intended files onto the current remote tree. Use that approach if direct Git remains unavailable. Do not push casually to `release/firmware-1.9.4`: its publish workflow may attempt the existing tag again. App build 26.1 is already uploaded; don't publish another app build merely for firmware tooling/docs changes.

## Historical Mac new-chat prompt

Continue CoolLamp development in /Users/jammendolia/Dev/Gasper/CoolLamp. First read docs/development-handoff.md and docs/wifi-debugging.md. Resume the OTA heap/TLS fix from the checkpoint, preserving existing GPIO assignments and lamp settings. Review the successfully built 16 KB receive / 4 KB transmit TLS implementation, complete production/device validation, then prepare firmware 1.9.5 for OTA. App 1.0 (26.1) is already uploaded to TestFlight. Firmware 1.9.5 is not published. Keep the separate group UDP connectivity issue on the follow-up list. Do not reset the working tree or repeat completed app work; report current status before continuing.

## Windows migration notes

Clone **`checkpoint/windows-migration-2026-10-06`** to obtain the saved source checkpoint, rather than the repository's older default branch. Preserve the Mac copy as backup. Full `.build` diagnostic logs and prototype binaries remain local; `.build` is ignored. The findings and relevant measured values are recorded above, and the optimized TLS library is reproducible from pinned source. Do not copy Mac `node_modules`, Darwin toolchains or compiler caches as Windows dependencies. Do not distribute private signing material/secrets in a general source archive.

Install Windows-native Git, Node 22, pnpm (CI currently pins 11.19.0), Python 3, Arduino CLI and pinned ESP32 core 3.3.11/libraries. Use a short local path such as `C:\Dev\CoolLamp`, outside OneDrive, and reinstall mobile dependencies using the pnpm lockfile. Android development additionally needs the project's compatible Android Studio/JDK/SDK. CAD can also move to Windows with KiCad/OpenSCAD installed. Native Windows is the simplest starting point for direct USB COM ports and local-network lamp diagnostics; don't add WSL USB/network forwarding unless necessary.

The firmware Node script already has a Windows CLI lookup and the new TLS helper recognizes `.exe` compiler tools. However, the new helper has only been executed on macOS: validate Windows SDK response-file paths, quoting, `tar` availability, ABI/export parsing, and archive linking before declaring it portable. Host tests/scripts may assume Unix commands; inspect and adapt those narrowly. **Confirmed portability gap:** `tools/audio-usb.py` uses POSIX `termios`, `fcntl`, and serial `select`; it does not run natively on Windows. Port this diagnostic helper to pyserial (retaining DTR and avoiding unintended resets), rather than merely replacing the device path. Temporary TLS probe helper inherits the same gap. Rediscover Windows COM ports. Do not change firmware GPIO assignments as part of migration.

Native iOS compilation and simulator/device debugging still require macOS/Xcode. TestFlight distribution currently uses the repository's GitHub Actions macOS runner, which can be triggered from Windows; a running local Mac is not inherently required for that existing CI workflow. Preserve the Mac for native iPhone/Bluetooth troubleshooting and signing workflows if needed.

Suggested Windows continuation prompt:

Continue CoolLamp development on this Windows computer. First read docs/development-handoff.md and docs/wifi-debugging.md in the transferred repository. Verify that the Mac's pending TLS build changes and diagnostic evidence were transferred before modifying anything. Set up and validate the Windows build/test tools, preserving GPIO assignments, lamp settings and the working tree. Then resume the OTA heap/TLS fix, validate the 16 KB receive / 4 KB transmit implementation on the USB lamp, and prepare firmware 1.9.5 for OTA after tests pass. App 1.0 (26.1) is already uploaded to TestFlight; use the existing macOS CI workflow for future iOS builds. Firmware 1.9.5 is not published, and group UDP connectivity remains a separate follow-up. Report the current state and migration gaps first; do not repeat completed work or reset lamps.

## Windows checkpoint — 2026-10-09: Corkscrew recovery and relay candidate

Firmware **1.11.0** is public Latest. Its CI image is 1,868,416 bytes, SHA-256
`e60d0830750e7219c4229bc51d6f6e80f6647f3feb3ef9a2db8e5a7809118a8c`.
Corkscrew CoolLamp (`5894af4aec24`, USB MAC `24:EC:4A:AF:94:58`, COM6)
failed two release checks while on 1.10.2: GitHub redirected successfully, then
the asset-host TLS handshake failed with code 12288 and almost no minimum heap.
One streamed LAN upload returned an empty reply after 458,752 bytes. Subsequent
diagnostics confirmed continuous uptime and the old version; it was not replayed.

The user authorized USB bootstrap. The partition/configuration region was backed
up privately under ignored `.build`, the active OTA slot was verified at
`0x10000`, and only that application slot was flashed with the exact published
1.11.0 image. Esptool verified its hash. USB and authenticated LAN reads confirmed
a healthy 1.11.0 boot and active ESP-NOW following of CoolLamp 2. A complete saved
settings comparison passed, including 184 LEDs, midpoint 46, current limit,
startup effect/brightness, colors/options, microphone absent, audio tuning,
Wi-Fi identity, group configuration, lamp style and automatic installation off.
The corrected saved name is **Corkscrew CoolLamp**, also verified in coordinator
discovery. Evidence: `.build/corkscrew-1.11.0-usb-validation.json` and
`.build/corkscrew-1.11.0-usb-boot.jsonl`. Private flash/state files must not ship.

The app update adds background public-release lookup, a per-card update arrow,
Continue/Cancel confirmation and Wi-Fi preference with paired Bluetooth fallback.
Ambiguous Wi-Fi installations are never replayed over Bluetooth. The existing
macOS TestFlight workflow was dispatched on app commit `d9791317058e50082b6362e39dcb8796dc328b7e`,
run `37958872925`; inspect its actual conclusion and Apple acceptance before
claiming upload success. This dispatch uses only the personal `jammendolia` account.

Firmware **1.12.0 is a candidate, not published**. It adds authenticated ESP-NOW
firmware relaying across paired lamps regardless of group, with receiver opt-in
through Automatic Updates. Fleet credentials are provisioned through protected
BLE and stored separately from group membership in the existing NVS namespace.
The radio transfer shares the verified BLE flash receiver and resource owner.
The loop stack is 6 KiB to allow the additional crypto/flash call path; GPIOs and
lamp settings are unchanged. See `docs/firmware-relay.md` for trust, channel,
revocation and physical-validation limits. Host tests and a successful C3 build
do not establish real-lamp relay behavior; do not publish this candidate yet.

Both release checks subsequently completed successfully. App **1.0 (39.1)** was
accepted for TestFlight processing at `2026-10-09T16:29:43.8386050Z`, with
`UPLOAD SUCCEEDED with no errors` in run `37958872925`. Tester availability is
not independently verified. Firmware draft CI run `37959215286` passed on
`7487b6bfeb20e436a91078840ef2ffef8b8fb115`. Its verified 1.12.0 image is
1,876,656 bytes, SHA-256
`2d93dc81a93fa4055eb4c174459bea85fa361b1f0ebad5434ee87dbbe9d1732e`.
The release is still a draft and public Latest remains **1.11.0**. Windows local
candidate bytes differ and are recorded separately; do not mix their manifests.
Validation includes 359 mobile tests, five mocked update-card scenarios, five
existing mocked Bluetooth-update scenarios, eleven production relay scenarios
with real cryptography, existing BLE receiver/hybrid coordination regressions,
native iOS tests and the pinned full C3 firmware build.

A subsequent read-only lamp check found CoolLamp 2 already on **1.11.0**, with
automatic installation still enabled; CoolLamp 1 remains **1.10.2**, automatic
enabled. Corkscrew remains **1.11.0**, automatic disabled, actively following
over ESP-NOW. No candidate firmware or fleet credential was installed on hardware.
The user has been asked to test a same-version 1.11.0 reinstall through the phone
over Bluetooth after installing app 39.1. This tests the physical upgrade path
without publishing or installing the relay candidate.

## Lamps page without a default selection — 2026-10-09

The Lamps page now starts with no selected control session, even when a saved
selection or legacy Bluetooth record exists. Native discovery and independent
firmware/status reads still populate the cards. Discovery no longer reconnects
or navigates to Settings; the user opens a lamp's settings through its card.
The connection badge and default-password banner belong to that lamp's Settings
page instead of the global header. Returning to Lamps shows generic instructions.

Update, gear and remove buttons share the same 44-pixel rounded button and
24-pixel SVG dimensions. The remove icon now has a visible border/background.
359 mobile tests passed. Mocked production UI checks verified saved and legacy
startup, inventory-only discovery, exact-lamp gear navigation, Settings-only
connection details and matching button geometry at 320, 393 and 1280 pixels;
the existing update and card-power scenarios also passed. No hardware was changed.
App source: `1e3d89b1c430b8eef1c534e8051b149208a3c01b`; TestFlight workflow
`37963110135` completed successfully and Apple accepted app **1.0 (40.1)** for
TestFlight processing. Tester availability is not independently verified.
Firmware 1.12.0 remains an unpublished draft.
