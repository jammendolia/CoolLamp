# Optional Heltec household bridge

The bridge is a separate accessory for the Heltec WiFi Kit 32 V3. It does not
render lamp effects, produce lamp audio, or substitute its identity for a lamp.
Its owner page provides network setup, household status, nearby device inventory,
absolute lamp power controls, and a verified lamp-update cache. Existing lamps
continue to operate without a bridge.

The implementation is isolated in `bridge/` and
`examples/CoolLampBridge/CoolLampBridge.ino`. The bridge build stages unchanged
mesh, radio, commissioning, HTTP, and firmware-relay sources from the lamp.
It uses its own board target, version, partitions, and output directory. No bridge
image belongs in the ESP32-C3 lamp release feed.
The only shared commissioning change is a read-only accessor for the already
accepted public comparison transcript, used by the bridge display; it does not
change packets, enrollment authority, or lamp settings.
The HTTP cleanup initializer also accepts a bounded task-stack override. Lamp
callers keep the previous 2,048-byte default; the ESP32-S3 bridge requests 4,096
bytes before opening its server.

## Build without connecting or flashing hardware

Use the installed Arduino-ESP32 3.3.11 tools:

```powershell
. .\tools\windows-env.ps1
node tools/build-bridge.cjs
```

The target is `esp32:esp32:heltec_wifi_kit_32_V3`. The build validates the 8 MiB
partition map and creates an isolated staging tree under `.build/sketch-bridge`.
It does not upload firmware, download libraries, or read lamp secrets. Check the
build report for the exact staged-source hashes and generated image sizes.

The dedicated layout has two 2 MiB bridge application slots and a separate
custom data partition for the cached lamp image. A board currently using another
partition layout needs a separately authorized initial installation that includes
the bridge partition table. A lamp's existing application-only flash procedure is
not an installation procedure for this accessory.

## Owner setup and household trust

No additional buttons or encoder are needed. The board's onboard **PRG** button
is GPIO0; the OLED uses SDA17, SCL18, reset21, and active-low Vext36. A short PRG
click toggles the setup hotspot; a two-second hold opens it. During a pending
comparison, a short click approves only the physically pending transcript.

On a new unconfigured bridge, the OLED shows `CoolLampBridge-xxxx`, the address
`192.168.4.1`, and **Open setup WiFi**. Connect without a key and open the address.
The page first requires an exactly confirmed password of 8–32 UTF-8 bytes. Other
features remain unavailable until it is durably saved. After replying, the bridge
restarts the hotspot with WPA protection after a bounded 2.5-second delay. Rejoin
using the password you chose, then sign in as **OWNER** using that same password.
Both `OWNER` and `owner` are accepted; the password remains case-sensitive.

The temporary open link is for choosing this setup password only. Home Wi-Fi
credentials and household control are gated until the protected setup is in
place. This is convenience commissioning, not manufacturer-authenticated
identity; household enrollment retains its separate protected comparison.
The chosen password is never printed in USB status or browser diagnostics.

Use **Find Wi-Fi** to select the home's **2.4 GHz** network. **Refresh** explicitly
starts a new scan; ordinary status reads never scan. Manual entry remains
available for a hidden network. Password inputs are cleared when submitted.
The phone then returns to its normal home network. The bridge's home address is
shown after closing the setup hotspot with a short PRG click.

The page uses same-origin requests and has no external scripts. Its password
input is cleared when submitting Wi-Fi setup; status responses do not return
network passwords, owner passwords, or fleet keys. Network settings are saved
after association and a valid address, allowing a failed attempt to preserve
the previous saved settings. An uncertain storage commit blocks subsequent
configuration writes until a restart reads the durable record; the status fields
`storageFault` and `configurationUncertain` distinguish this from a normal save.
Every browser POST also requires the current boot-scoped `X-Lamp-Token`, obtained
through a status read (public only while first-time setup is unclaimed). USB and fleet diagnostics exclude this
token. After a bridge restart, refresh status before sending a new command; an
old token cannot authorize a mutation. Result-only reconciliation remains a GET.

Enroll this accessory through the household commissioning flow using a client
that supports bridge descriptors. Compare the phone's complete comparison with
the OLED, then approve using the bridge's onboard PRG button. Version 2 displays
six count pairs and a check pair, and preserves the full-cycle approval delay.
The bridge obtains its actual 16-byte fleet credential from
the commissioned credential provider; an unprovisioned bridge never fabricates
a key or silently joins another household.

The setup AP starts on channel 1. An existing Wi-Fi association changes the shared
radio to that network's channel; otherwise close the setup AP to allow the
existing channel-seeking behavior. An open setup AP on a different channel from
the broker cannot complete enrollment. ESP-NOW cannot cross incompatible Wi-Fi
channels, router isolation, or an absent radio overlap. Keep router configuration
unchanged when assessing coverage.

The current source changes classify enrolled bridges separately from lamps.
They are not published to TestFlight or Android by this task. Native discovery,
comparison, and durable enrollment on a released phone build remain physical
acceptance gates. The current app does not yet use saved bridge accessories as
automatic Wi-Fi recovery candidates. The browser page is the implemented Wi-Fi
control surface for this prototype.

For bench provisioning, `tools/bridge-usb.py` can install an **existing** private
household credential file with `fleetKeyHex` and its matching `fleetId`. This is
a local USB service path, not a browser key-entry flow. Do not create a new key
for an existing household or add credential files to Git. The helper verifies
the exact bridge identity before acting and never displays private input.

The radio's Wi-Fi STA MAC remains the device identity. It is encoded using the
existing reversed-byte, lower-case 12-digit CoolLamp identity format. Inventory
contains authenticated, challenged peer boot sessions and expires peers after
15 seconds. Its scope is the local neighborhood, with at most 16 remembered
peers and four forwarding hops. These values do not describe a global household
size ceiling. The unchanged radio presence format does not carry a device role;
read a device's state or descriptor to distinguish another bridge from a lamp.
When home Wi-Fi is unavailable, a fresh authenticated peer or active request
renews a 1.5-second channel hold. Expired peers and suspended operations release
that hold so channel discovery can resume.

## Control and HTTP integration

Authorize owner requests before dispatching any bridge API. The bridge page uses:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/bridge/status` | GET | Truthful bridge, network, cache, donation, and diagnostics status |
| `/api/descriptor` | GET | Bridge role, model, version, and capabilities |
| `/api/bridge/password` | POST | Durable first-time password; exact confirmation; one-way transition to protected setup |
| `/api/bridge/wifi` | POST | Stage `ssid` and `password`, then save after a successful connection |
| `/api/bridge/wifi/scan` | POST | Explicitly queue one asynchronous Wi-Fi scan, returning its generation |
| `/api/bridge/wifi/networks` | GET | Read the bounded cached scan snapshot; never starts a scan |
| `/api/bridge/cache/check` | POST | Check the configured trusted lamp release |
| `/api/bridge/donation` | POST | Persist `enabled=1` or `enabled=0`; default off |
| `/api/mesh/status` | GET | Existing version-1 neighborhood inventory |
| `/api/mesh/request` | POST | Submit `target`, `requestId`, `endpoint`, `method`, and `body` |
| `/api/mesh/result` | GET or POST | Query the exact retained result using `target`, `requestId`, and `offset` |

The owner page additionally sends `targetBoot` with request and result queries.
Forward it to the optional `expectedTargetBoot` argument of `BridgeControl`.
Existing mobile mesh clients can use the standard fields unchanged. This does
not turn the accessory into a normal lamp in the current mobile app: its own
state and descriptor explicitly report `role: "bridge"` and do not invent lamp
effects, brightness, LED geometry, or audio features.

`BridgeControl` composes the unchanged `LampMesh::Core`; the latter owns message
authentication, replay guards, session challenges, bounded fragmentation,
forwarding, retry timing, and execution receipts. The adapter copies a supplied
fleet key and wipes the temporary buffer. Radio ingress copies at most eight
bounded frames, and loop service rejects frames older than 1.5 seconds. Only the
loop performs cryptography, peer admission, HTTP serialization, or state changes.
Quiesce the receive producer before adapter `begin()` or `stop()`.

Request bodies are limited to 1,024 bytes including endpoint/method bytes.
Responses are limited to 8,192 bytes and returned as 256-byte Base64 pages.
One origin request is active at a time; a completed, unread response is protected
from replacement for 15 seconds after completion. Reading its final page permits
replacement. A duplicate identifier must match target and content; the adapter
reconciles the retained result without executing again. Transport deadlines are
15 seconds. A missing reply or missing receipt does not prove a mutation was
never applied. The page preserves an uncertain command identifier so its
"Check last command" action reads results without resubmitting it.

The page reads the selected lamp's state and its own effect catalog before
enabling power controls. The explicit controls use endpoint 31, method 2, and
`on=1` or `on=0`, matching the existing lamp handler. Selection, target boot,
request identifier, response status, page offset, and response bounds are checked
throughout reconciliation. Hidden tabs abort foreground work and pause polling;
no mutation is replayed when the page becomes visible again.

Bridge-local reads support truthful State, Descriptor, Revision, and MeshStatus
responses through `Hooks.localRead`. Local lamp mutations and actions requiring
a protected Bluetooth origin are rejected. HTTP authorization is separate from
fleet radio trust.

The mobile classifier retains the original commissioning transcript while
independently verifying the broker and target's normal mesh boot sessions. Those
nonces are different domains. It waits for fresh same-household peer proof within
a single 12-second deadline, then fences descriptor pages and final persistence
against both sessions. It never repeats enrollment to obtain a descriptor.

The bridge has no direct lamp HTTP client. A phone/browser reaches the bridge
over Wi-Fi, and the bridge reaches an authenticated lamp through the existing
ESP-NOW control protocol. Firmware sharing uses the separate direct donor
protocol; firmware bytes are not forwarded over the generic multi-hop mesh.

## Setup storage migration and scan bounds

`bridgecfg/configV2` is a CRC-protected versioned record with a 33-byte access
password field and explicit `ownerPasswordSet`. A valid V2 record is authoritative;
a malformed V2 record never falls back to V1 and never opens a new owner session.
The original 148-byte `configV1` record is validated before migration. Saved
Wi-Fi, fleet key, trust, update-sharing preference, revision and access password
are preserved whenever V1 has a configured network, trust, or sharing preference.
Only an untouched V1 prototype becomes open first-time setup. The V1 record is
retained; migration-write uncertainty fences further saves until restart resolves
V2. Do not downgrade a configured V2 bridge to the original prototype firmware.

Password creation validates equality, byte length and control characters before
one loop-owned NVS write. Once saved, repeats are rejected; lost replies must be
reconciled by reconnecting with the chosen password or restarting and reading
the durable setup state. A failed commit is never described as unchanged.

The scan helper uses the pinned IDF asynchronous scan API. Its event callback
copies only generation and completion status into four bounded entries. The loop
retains at most 20 networks, processes four SDK records per turn, inspects at most
256 records, and enforces a 15-second request lifetime and 10-second retry limit.
It sorts by signal strength and deduplicates exact SSID/security combinations.
Malformed UTF-8, hidden/empty names and invalid channel/RSSI values are excluded;
unsupported security is marked explicitly. The reply buffer is 4,096 bytes.

Radio ownership covers queued scans, result collection and cancellation draining.
Timeout cancellation must drain before another scan; an uncertain failed stop
holds the radio lease until restart. No scan overlaps association changes,
enrollment, active control, cache download or donation. The raw IDF path avoids
Arduino's extra full-result allocation, but the Wi-Fi SDK still allocates its
internal AP list without a public hard-cap option. Actual scan heap margin is a
physical acceptance measurement, not a claim derived from these host bounds.

## Cached updates and physical acceptance

Update sharing is off by default. The cache must verify the original pinned
HTTPS manifest, intended ESP32-C3 image, size, marker, and SHA-256 before donation
is available. The downloader pins the exact release tag after reading Latest,
rechecks the same manifest, and downloads that exact image. It retains two image
banks so a failed refresh can restore the previous verified cache. An uncertain
metadata commit preserves both banks and blocks another refresh until restart.
Keep original manifest and publisher evidence with the image; never advertise
the Heltec's own application as a lamp update. Donation follows the existing
authenticated firmware-relay protocol, and each lamp retains its own acceptance
and installation policy, including auto-update opt-in, quiet hours, and group
rollout permissions. Same-household trust alone cannot override those policies.
A completed transfer counter records transport progress;
it does not certify a successful installation or reboot.

Production publisher verification is not provisioned on this accessory. It
reports `publisherProvisioned:false`; verified HTTPS release pinning is the
current legacy trust policy. The artifact layer has an original signed-manifest
verification interface, but no production key is invented or enabled here.
The bridge's own firmware is updated over USB for this prototype; its reserved
OTA slots do not imply a shipped self-update service.

With home Wi-Fi, valid network time, and household trust, the bridge checks for
a cached release at startup, every six hours after success, and every five
minutes after a failure. Download work runs in one bounded 16 KiB-stack task;
the main loop owns validation, NVS, radio service, HTTP commands, and OLED state.
The cached image is pinned during a transfer. One receiver is served at a time.
Control and enrollment are unavailable during owned update operations rather
than racing the donor's radio or flash ownership.

Host verification can run without hardware or network access:

```powershell
. .\tools\windows-env.ps1
python tests/bridge-control-runtime.py
python tests/bridge-donation-runtime.py
python tests/bridge-lamp-compat-runtime.py
python tests/bridge-runtime-contracts.py
python tests/bridge-commission-snapshot-runtime.py
python tests/bridge-usb-protocol.py
node tests/bridge-control-page.cjs
node tests/bridge-wifi-picker.cjs
node tests/bridge-password-setup.cjs
node tests/bridge-page-input-focus.cjs
python tests/bridge-wifi-scan-runtime.py
python tests/bridge-http-runtime.py
python tests/bridge-socket-stack-runtime.py
node tools/build-bridge-page.cjs --check
```

The page's readable JavaScript is `bridge/BridgePage.js`. After editing it, run
`node tools/build-bridge-page.cjs` using the installed mobile esbuild dependency,
then run the page regression and rebuild firmware. The generated flash-resident
page stays below its 24 KiB prototype budget; no code or assets are fetched by
the bridge's browser page.

These tests use the SHA-verified production AES-GCM sources and exercise two-hop
control, authentic target errors, exact request reuse, wrong-fleet isolation,
bounded/copy-only ingress, stale and tampered frames, concurrent ingress,
pagination, retention, boot guards, deadlines, lost replies, resource suspension,
truthful local reads, denied local mutations, and peer expiry. They do not prove
ESP-NOW radio delivery, OLED wiring, real household commissioning, network
association, or flash installation on the Heltec.

After a separately authorized installation, test the physical accessory in
bounded steps:

1. Confirm the exact WiFi Kit 32 V3, displayed identity, owner login, and working
   OLED. Confirm the bridge reports its own role and version.
2. Check failed network credentials preserve the saved network; check a valid
   association is saved only after an address is obtained. Check reboot recovery.
3. Enroll through code comparison and physical PRG approval. Verify another
   household's radio messages do not populate inventory or operate lamps.
4. Read a chosen lamp and its catalog. Change power explicitly once, reconcile
   the same identifier, and confirm a changed identifier/content is required for
   a new action. Interrupt the reply path and check result-only reconciliation.
5. Select another lamp or hide the browser mid-request. Check that the previous
   reply never updates the new lamp selection and that no mutation is replayed.
6. Verify the trusted cache and deliberately invalid manifest/hash cases before
   enabling donation. Inspect target status, exact version, transfer progress,
   reboot, and retained lamp settings before claiming an update succeeded.
7. Disable sharing, reboot, and verify the preference stays off. Remove the
   accessory and confirm existing standalone lamp behavior remains intact.

Keep the working household network arrangement fixed during these checks. Record
the exact bridge/lamp identities, versions, channel, operation, and outcome so
host checks and physical results remain distinct.

## 2026-10-13 implementation and bench ledger

The authorized Heltec on **COM9** was flashed and esptool verified each written
region. Its chip is ESP32-S3 revision 0.2 with 8 MiB flash, STA MAC
`34:b7:da:56:48:8c`, canonical identity `8c4856dab734`. A subsequent identity-fenced
USB read confirms bridge **0.1.0**, OLED initialization, setup AP active, no storage
fault, and donation off. Home Wi-Fi and household trust are not yet configured.

| Evidence | Result |
| --- | --- |
| Core / board | Arduino-ESP32 3.3.11 / `heltec_wifi_kit_32_V3` |
| Application / each slot | 1,203,680 / 2,097,152 bytes; 893,472 bytes spare |
| Compiler static globals | 81,656 bytes |
| Measured idle free / minimum heap | 210,060 / 207,080 bytes |
| Observed maximum loop gap / HTTP service | 120 ms / 135 us at idle; not a loaded acceptance result |
| Image SHA-256 | `a37a6e657691a3189419693af760a20a852076271a4ad750f73c352330bfb1cf` |
| Source provenance | 57 staged source hashes verified against the checkout before flash |
| Production host protocol checks | Passed; actual mesh, commissioning, and existing lamp donation receiver exercised |
| Mobile tests / production build | 1,740 tests passed after session/readiness corrections; production build passed |

Build artifacts are local under `firmware/bridge/`; source provenance is under
`.build/sketch-bridge/`. Both firmware image and credential-bearing prefix backup
are excluded from publication. No lamp was flashed or reset by this task, and no
firmware release, app upload, router change, or shared GitHub-account change was
performed.

**Still pending physically:** visible OLED confirmation, browser login, saved
home association and restart recovery, real household enrollment, direct and
multi-hop lamp controls, cache download under loaded radio conditions, one real
C3 donor update with unchanged lamp settings, and a metal-base coverage comparison.
Twenty-lamp timing, phone interoperability, and thermal/resource margins require
fixtures; host simulation is not their acceptance evidence.

## Browser commissioning follow-up, 0.2.x

The owner reported an apparent restart on login. USB captured a real panic in
`closeWorker -> Owner::step -> lwip_close -> TCP FIN -> Wi-Fi transmission`
on the original 2,048-byte cleanup stack. Its decoded trace and redacted boot
events are retained privately under `.build/bridge-http-failure-20261013/`.
The OLED's uppercase font also displayed `OWNER` while the original login accepted
only `owner`; both spellings now authenticate using the exact same password.

Bridge 0.2.0 was application-only flashed and hash-verified, preserving NVS and
the partition table. The user confirmed the open setup network and password
form. USB then recorded more than 92 completed HTTP responses, zero response
failures/deadlines, uninterrupted uptime, and 2,036 bytes minimum remaining in
the 4,096-byte cleanup stack. This is physical browser evidence, not proof of
RF coverage, household enrollment or a lamp firmware donation.

The user subsequently found a focus defect: every background status read briefly
disabled editable inputs, dismissing the keyboard. The 0.2.1 page reads first-time
setup status once, preserves editable fields during configured background reads,
and admits one bounded foreground intent after an in-flight read. It never
silently drops a Save click or replays a posted command. Browser tests include
actual focus loss on disabled transitions and delayed-read/save interaction.

The open-first-setup migration and Wi-Fi picker were not offered to existing
lamps, and no router settings changed. A temporary computer-only probe profile
was removed without connecting: the computer's Wi-Fi radio was already off.
On 0.2.1, the owner confirmed that password entry and saving, protected-hotspot
rejoin, and the actual Wi-Fi list all work. Identity-fenced USB status then
confirmed `passwordSet:true`, `wifiConfigured:true`, `wifiConnected:true`, and
`wifiSave:"saved"`. The home association obtained an address on channel 6 without
changing router settings. No credentials were copied into diagnostic evidence.

| Final 0.2.1 evidence | Result |
| --- | --- |
| Application / each slot | 1,221,280 / 2,097,152 bytes; 875,872 bytes spare |
| Compiler program / static globals | 1,221,128 / 86,640 bytes |
| Measured free / minimum heap after browser setup and scan | 196,688 / 176,808 bytes |
| Loop / cleanup task minimum remaining stack | 4,768 / 1,824 bytes |
| Observed maximum loop gap / HTTP service | 174 ms / 6,227 us across setup, scan and association; not loaded RF acceptance |
| HTTP replies / failures / deadlines | 124 / 0 / 0 with uninterrupted uptime of 290,754 ms |
| Image SHA-256 | `3a8a3c0e00c304db6955c474d186d67bec44d79dfac7a3ab0badb95bda7af872` |
| Source provenance | 59 staged source hashes verified against the checkout before flash |
| Physical first-time browser setup | Password save, protected rejoin and Wi-Fi picker confirmed by the owner; associated settings saved confirmed over USB |

The exact build report, staged-source provenance, safe USB status and follow-up
ledger are retained locally under `.build/bridge-0.2.1-bench-20261013/`. Host
configuration, scan, password, focus, HTTP authorization and socket cleanup
checks pass. This image was flashed application-only and hash-verified; no app
upload or firmware publication was performed.

At this setup milestone, saved-network recovery, household enrollment, real
direct/multi-hop controls, a cached lamp donation, native app bridge routing,
and metal-base coverage were still pending. The later enrollment and reset
results below supersede that status. Twenty-lamp performance and physical
power-cycle recovery remain separate acceptance gates.

To inspect the flashed accessory without changing it:

```powershell
.build\venv\Scripts\python.exe tools/bridge-usb.py COM9 status --expect-id 8c4856dab734
```

## Household enrollment bench, 2026-10-13

The owner authorized enrolling this bridge into the existing lamp household.
Read-only access to Corkscrew CoolLamp (`5894af4aec24`, firmware 1.15.2) confirmed
its active household fingerprint `c8d27ebafed5d956` and a fresh, unclaimed
`8c4856dab734` bridge candidate. The bridge's Wi-Fi is associated, and its verified
1.15.3 lamp cache is durable. Update sharing was already enabled in its saved
configuration when enrollment began. Receiver automatic updates were enabled
later, only after the owner's explicit approval, as recorded below.

The Corkscrew's full HTTP state and diagnostic replies were cut off during the
read-only checks, while smaller mesh/discovery/firmware replies completed. A raw
state read received HTTP 200 and 501 bytes before a connection reset; its JSON
was incomplete. This is evidence of an incomplete route, not a confirmed root
cause. No token was extracted from that fragment and no enrollment start was
submitted through that route.

`tools/bridge-enroll.py` supplies a bounded local-service alternative for a
healthy, already-owned lamp. It checks complete authenticated state, exact
identities, household fingerprint, fresh advertised target session, and the
original broker's separate mesh/commissioning boot domains. It durably journals
public session metadata before one start. Existing journals always resume by
querying the original tuple; loss, expiry and reboot never trigger a new start.
The helper explicitly uses the established v1 four-color comparison. It cannot
approve PRG, export a fleet key, or enable a receiver's automatic updates. All
27 helper/loopback tests pass; see `docs/bridge-enrollment-helper.md` for use.

Released client source inspected locally lacks the working checkout's separate
bridge classification and can report a post-enrollment lighting-snapshot error.
The bridge did not appear through that app's onboarding route. This controlled
enrollment therefore used the authenticated service helper and the owner's
physical PRG press. The comparison appeared in chat, not in the phone app; this
is a service workflow, not acceptance of the intended native onboarding screen.

The first request (`732851fc510bbfd9`) expired without physical approval. Its
original uncertain receipt was retained. Before a separately journaled second
attempt, exact-target USB confirmed no saved household or storage uncertainty,
and the authenticated broker discovered a fresh unclaimed advertisement with a
different target session. No uncertain enrollment was automatically replayed.

For request `05e39f826ad5a717`, the authenticated broker's four colors were
**Green, White, Violet, Cool white**, in that order. The owner confirmed all four
OLED lines matched and pressed PRG. The original broker returned
`phase:"complete"`, `approved:true`, `uncertain:false`; fresh challenged presence
then identified the exact bridge at one hop. Identity-fenced USB independently
confirmed the saved household `c8d27ebafed5d956`, `meshEnabled:true`, no storage
fault and no uncertain configuration. No private household credential was
exported, generated by the helper, or placed in a journal.

The owner next signed into the bridge's home-network web page, selected
Corkscrew and used **Read lamp state**. Its name and light status appeared.
This physically verifies browser-to-bridge Wi-Fi plus a bridge-origin ESP-NOW
read from that exact lamp. It does not prove multi-hop controls or firmware
donation. Power changes were deliberately left alone.

### Receiver update and retained settings

The owner explicitly authorized enabling automatic updates on Corkscrew and
testing the update. The preference save was acknowledged and remained enabled
after restart. Its existing group is a **legacy follower** of coordinator
`f0b950b2f180`. Production rollout admission rejects that legacy group format;
the observed automatic-service reason was `6` (`GroupLegacy`). Donor offers
were therefore not admitted. Bridge sharing was enabled with a durable cache,
but no donor transfer started and its completed/failed counters remained zero.
Updating the application image alone does not migrate group membership.

A single direct internet check was also attempted and acknowledged. It stopped
at memory preflight (`error:8`, HTTP diagnostic stage 2), with zero bytes written:
the largest free block was 16,372 bytes against a 16,384-byte TLS requirement.
Closing the phone's Bluetooth connection did not clear that preflight result.
No internet installation was started or uncertain mutation replayed.

The authorized update was completed through the existing **computer-to-lamp
Wi-Fi file upload**, using the already-public, pinned 1.15.3 artifact. A complete
authenticated state read verified the target before issuing one upload prepare
and one upload. All bytes were sent, the final HTTP 200 was received, and the
lamp restarted. The upload ticket and request token stayed in process memory.
This was not a bridge donation, Bluetooth transfer or lamp-direct internet
download.

| Pinned C3 artifact and result | Evidence |
| --- | --- |
| Version / chip / layout | 1.15.3 / ESP32-C3 / `dual-ota-2031616` |
| Image bytes / slot margin | 2,031,568 / 48 bytes |
| Image SHA-256 | `20e4c1532fdc3443290b004e514d0f52e2dcd69bc207eeded7bc3fb73a8a09f0` |
| Manifest bytes / SHA-256 | 120 / `d6ae7b87368cd4f6b1a08ae7acbf602ac40af58c9ad6ff19860b79731c87249e` |
| Postboot target verification | `5894af4aec24`, version 1.15.3, healthy, installed size and hash exactly match |
| Compared settings | Name, 184 LEDs, 500 mA limit, midpoint 46, startup Fire/100, style, colors, effect options, audio settings, rotation and group fields unchanged |
| Automatic preference | Explicitly enabled; still true after restart, still held for the legacy group |
| Physical light observation | Owner reports normal startup Fire; update animation was not watched |

The before snapshot did not independently capture `groupPaused`; its preservation
is not claimed from this comparison. No group, hardware, Wi-Fi, bootloader or
partition-table configuration was changed. The cached/public artifacts are local
under `.build/firmware-1.15.3-release-20261012/public-download/`; no release was
published by this enrollment task. The narrow slot margin is a constraint on
future C3 releases, not proof of performance or automatic recovery.

### Bridge reset and client checks

A subsequent esptool RAM chip-identification command followed by an RTS hard
reset made no flash writes. After restart the exact bridge remained on 0.2.1,
associated with its saved network, retained household membership and sharing
preference, and revalidated the durable 1.15.3 cache as ready. No storage fault
or uncertain configuration was reported. This verifies reset persistence;
physical removal/reconnection of power was not tested.

After the cache download, measured free/minimum heap was 194,868/108,228 bytes,
with loop/cleanup minimum remaining stack of 4,748/1,824 bytes. The post-reset
sample had 203,092 bytes free, 172,444 bytes minimum heap and 4,752/1,828 bytes
minimum remaining stack. Its observed maximum loop gap was 292 ms and maximum
HTTP service 3,228 us; these are bridge bench counters, not a lamp frame-gap or
loaded RF acceptance result.

The client discovery fix uses `mobile/src/mesh-onboarding-broker.js` to try a
verified active broker, fresh healthy Wi-Fi, saved authorized Bluetooth, stale
Wi-Fi, then bounded mesh recovery. Discovery stays read-only. A total 7.5-second
budget and 4-second route cap fence cancellation and late transport adoption;
shared broker leases retain other owners. An explicit setup guide reports a
sanitized discovery failure instead of silently swallowing it. All **179 focused
checks and 1,756 mobile tests pass**, and the production web build passes. These
changes have **not been uploaded to TestFlight** or physically tested in a new
native build. Direct native Wi-Fi bridge routing was unimplemented in that tested build.

Safe journals, observations and exact-image verification are retained under
`.build/bridge-enrollment-20261013/`. The first uncertain enrollment journal and
confirmed second receipt remain separate; subsequent update preference changes
are recorded separately rather than rewriting historical evidence.

### Remaining physical acceptance

At this 0.2.1/1.15.3 baseline, a donor test needs an older, independent, auto-enabled lamp in this
household, or an explicitly authorized migration of the existing group with its
coordinator and members available. Do not silently remove a follower, bypass
rollout admission or claim that enabling sharing makes a legacy group eligible.
For that test, record receiver version/hash and settings first, keep the router
configuration fixed, verify the internet path is unavailable without changing
credentials, and observe bridge sending plus receiver donation route/progress.
Completion requires exact target postboot identity/version/hash, health and
retained settings; nearby presence or an update animation alone is insufficient.

Still pending: actual donor transfer, signed publisher provisioning, interrupted
donor recovery, multi-hop controls, native accessory onboarding/routing,
metal-base coverage comparison, and twenty-lamp RF/timing/resource acceptance.
These software checks and the successful computer upload do not establish those
results.

## Unreleased bridge management and grouped follower update changes (13 October)

Current source adds bridge **0.2.2** and lamp **1.15.4** support. These are
implemented/tested software changes; the physical observations above still
describe installed 0.2.1/1.15.3 devices. No new installation or publication is
implied by a host build.

- An active, unarmed protocol-2 follower may receive an automatic Internet or
  trusted-donor update without leaving its group. Both durable rollout records
  must be genuinely empty. Unreadable/corrupt storage and ambiguous failed
  writes remain fenced. Paused legacy followers defer because their pause is
  RAM-only; legacy coordinators and expanded staged groups retain coordination
  gates. See [rollout v1](protocol-rollout-v1.md).
- The bridge setup page shows spinners, prevents duplicate actions, preserves
  input focus during polling, and reports saved network/signal with an explicit
  reconfiguration action. Owner Wi-Fi details are separate from USB and mesh
  diagnostics and contain no password.
- The app adds **Lamps → Bridges** and **Settings → Bridges**, with bridge cards,
  lamp access, nearby unowned setup and confirmed Add/Remove. Existing household
  lamps can use a trusted bridge without re-enrollment. Remove affects only
  this bridge's serving permission, retaining settings/ownership/groups and
  original receipt reads. See [bridge lamp access v1](bridge-lamp-links-v1.md).
- Native bridge Wi-Fi routing verifies bridge and target separately. Discovery
  is read-only, bounded to two brokers/18 seconds and four descriptors per page.
  No bridge becomes a lamp; no silent inventory eviction, target mutation
  replay or increased radio capacity is introduced.
- Lamp Wi-Fi settings show verified saved name/signal, hiding credential inputs
  until **Reconfigure**. An unsaved candidate cannot replace working saved Wi-Fi.
  Microphone, geometry and lighting catalog are unchanged by these changes.

An installed 1.15.3 grouped receiver still runs its older admission gate. The
bridge cannot override it: seed the fixed application once through an explicitly
authorized direct update. Then test a **genuinely newer exact artifact** from the
bridge; cached 1.15.3 is not newer than 1.15.4. Keep the group, credentials and
router/channel settings. Host fixtures are not physical donation, native phone,
metal-base or twenty-lamp acceptance.

## Local canary installations after authorization (13 October)

Bridge 0.2.2 and the donation-disabled Corkscrew 1.15.4 diagnostic image were
subsequently installed with the user's approval. Corkscrew's exact installed
digest and healthy boot were checked; saved hardware, appearance, startup,
Wi-Fi, automatic-update preference and follower membership were preserved.
The user confirmed normal lighting and the bridge's saved Wi-Fi summary.
The follower's policy now permits automatic updates without leaving its group.

An initial bridge browser read stopped before collecting its target reply. A
local 0.2.2 refinement adds read feedback beside the button and bounded,
privacy-safe result-query diagnostics. After installing it and opening a new
browser tab, the user confirmed two consecutive reads succeeded. Captures
confirm target identity, HTTP-200 state/catalog replies and complete collection.
The initiating cause of the earlier failure remains unproven. Actual donation
still needs a genuinely newer approved C3 artifact; retained cache 1.15.3 is
older than installed 1.15.4. See the [installation ledger and measured resource
limits](bridge-update-handoff-2026-10-13.md#authorized-local-installations-and-observations)
for hashes, observations and precise remaining gates.
