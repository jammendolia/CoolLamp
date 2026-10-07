# Group coordination diagnosis — Windows, 2026-10-06

Latest follow-up (2026-10-07): CoolLamp 2's COM5 and CoolLamp 1's COM3 USB
bootstraps to the exact published 1.9.5 image are complete. Their new boots and
secure manifest checks passed, and saved settings, raw logical NVS, GPIO
assignments, partition table and OTA metadata were preserved. CoolLamp 2's
preceding 1.9.4 automatic HTTPS download reached
47% but timed out, so full OTA installation is still unvalidated. App **1.0 (29.1)**
is now the latest accepted upload: asynchronous fleet source
`d8620a428406bdd4a9a8cb3fcd0188135b43bc70` passed local and macOS CI validation,
run `37692263376`, and Apple accepted its upload. App 28.1's firmware-card
upload is history. Tester availability/phone installation remain unverified.
All three lamps now report 1.9.5;
BACL retains its same-source Windows build. The final dated section
below records the new evidence and supersedes earlier pending-bootstrap states.

Initial Windows checkpoint (2026-10-06): Big Ass CoolLamp (`24eae26e9e9c`, `192.168.1.220`) ran the
unpublished production 1.9.5 candidate, and CoolLamp 2 (`f0b950b2f180`,
`192.168.1.222`) ran public 1.9.4 as coordinator. Preserve all GPIOs, saved
settings, group keys and memberships. The user requested working lamp
coordination; no factory reset is authorized.
This log preserves chronological checkpoints; see the final publication update
for the current release and installed-image state.

The user reported three successful manual update checks from the iPhone, with
no available update and no errors. Fresh later telemetry nevertheless records
628 bytes minimum heap on the USB lamp. Successful checks do not establish that
all OTA memory-pressure cases are resolved. Keep full OTA and CI validation on
the release follow-up list.

## Fresh observations

Windows Ethernet 3 is `192.168.1.115`; its connected route is `192.168.1.0/24`.
No adapter, firewall, router or Tailscale setting was changed for these probes.

| Test | Observation |
| --- | --- |
| Authenticated HTTP diagnostics to USB lamp and coordinator | Both now succeed; both share AP BSSID `86:4D:4C:D8:F0:89`, channel 11, gateway `192.168.1.1`, subnet `/24` |
| Initial group telemetry | Both listeners running and unblocked; zero received packets, discoveries, subscriptions and live peers |
| Four malformed UDP datagrams to each numeric IP, port 49732 | Each lamp's received counter increased by exactly four; no discovery/authentication/control activity |
| Four equivalent datagrams to `192.168.1.255` | Neither lamp's received counter increased |
| Legacy mDNS A queries to multicast `224.0.0.251:5353` | No replies observed on Windows |
| Equivalent mDNS queries sent directly to each lamp | Each lamp replied with one answer |
| CoolLamp 1 at `192.168.1.154` | HTTP reachable; default-password diagnostics fail, and unauthenticated endpoints return 401. Do not describe it as offline or overwrite its access password |

These observations establish direct Windows-to-lamp UDP reception and a failing
discovery path from this host. They do not yet establish an exact router setting
or whether Wi-Fi peer unicast is permitted. The existing group service discovers
its coordinator exclusively through two-second broadcast announcements. A
follower cannot subscribe before receiving the coordinator's discovery/session.

Existing host checks passed: wire validation/replay/nonce/clock tests, eighteen
group-scene tests, and the actual service handshake/authentication/reconnect/
pause/update-shutdown/settings-isolation runtime harness.

Evidence is under ignored `.build`: `group-windows-usb-baseline.jsonl`,
`group-windows-http-baseline.jsonl`, `group-udp-probe-result.json`,
`group-udp-broadcast-result.json`, `group-mdns-probe-result.json`, and
`group-host-baseline.log`. Malformed probes did not join groups or change lamp
settings. They deliberately increased received-packet counters by four.

## Direct peer probe result

A temporary `GroupNetworkProbe` is staged only under `.build`. It sends four
malformed UDP datagrams from the USB lamp directly to the coordinator, then
attempts a bounded unauthenticated HTTP connection; HTTP 401 is a successful
network-path observation. It runs once in a background task after Wi-Fi startup,
without saving settings or accessing credentials. Its diagnostic fields must
not enter production firmware or release packaging. The normal build helper
removes staging files absent from repository source.

The temporary probe built and was flashed only into app0, with esptool hash
verification. It completed with `udpSent=3` out of four attempted sends,
`tcpConnected=0`, and `httpCode=0`. The coordinator's received counter increased
by **zero**. Thus direct USB-lamp-to-coordinator delivery also fails, even though
Windows can communicate with both lamps. The existing TCP authentication/group
code is not reached in this failed peer connection. Router/AP forwarding or a
Wi-Fi-driver interaction remains a hypothesis; defective ESP32 hardware has not
been established.

The verified production 1.9.5 image was then restored, hash checked, and read-only
telemetry confirmed the original LED/midpoint/audio/group settings and absence
of `networkProbe`. Temporary files were removed only from staging. Original
probe source, images and logs remain in ignored `.build`. Normal release files
under `firmware/public` still have the validated OTA-memory candidate hash.
Further evidence: `group-probe-build.log`, `group-probe-flash.log`,
`group-peer-probe-live.jsonl`, `group-coordinator-before-peer-probe.jsonl`,
`group-coordinator-after-peer-probe.jsonl`, `group-production-restore.log`, and
`group-restored-production-diag.jsonl`.

## Router observations and next controlled test

The user reported Client Isolation **Off** on SmellsLikeEarwax_IOT. IGMP:
Multicast Proxy On, mode WAN Internet -> LAN Network, Force IGMPv2 On,
Fast-Leave On. Guest and Video networks are disabled; IoT and Primary enabled.
No assistant-side router configuration change was made.

The next requested user-operated test is one Client Isolation On/Apply followed
immediately by Off/Apply cycle on the IoT network, restoring its initial value,
then fresh group/discovery probes. Leave the other settings as reported.
“Broadcast SSID” is Wi-Fi name visibility, not UDP broadcast forwarding.

The user confirmed completing On/Apply then Off/Apply, with Client Isolation
currently Off. Fresh probes after that cycle show no improvement: both lamps
still have zero discoveries and live peers; four directed-broadcast UDP probes
reach neither lamp, while four direct UDP probes reach each. Multicast mDNS
queries still get no replies; equivalent direct queries get one answer from
each lamp. This retest did not repeat the temporary lamp-to-lamp firmware probe,
so its earlier failed direct-peer result is not a fresh post-cycle measurement.
Evidence: `group-post-isolation-cycle-baseline.jsonl`,
`group-post-cycle-udp-broadcast-result.json`,
`group-post-cycle-udp-unicast-result.json`, and
`group-post-cycle-mdns-result.json`. The received counters are now four on the
USB lamp and eight on the coordinator, solely from the malformed direct probes.
The user is having another chat inspect the network; coordinate further router
changes with that investigation rather than making concurrent changes.

## Post-toggle direct peer probe

The user relayed the parallel network investigation's recommendation: repeat
direct peer traffic after the toggle and verify Windows sender interface with
a capture, keeping router settings unchanged. An expanded diagnostic image was
built only in `.build/group-post-toggle-probe-firmware`. It retains the original
four malformed unicast probes to coordinator port 49732 and bounded TCP port 80
test, and adds four legacy mDNS A requests directly to coordinator port 5353
from local UDP port 49173. A valid matching-ID unicast response would demonstrate
both Wi-Fi peer directions without altering group membership or keys.

On USB after a fresh association, the one-shot task completed with `udpSent=3`,
`mdnsQueriesSent=0`, `mdnsUnicastReplies=0`, `tcpConnected=0`, `httpCode=0`.
The coordinator's received counter stayed eight (delta zero). Successful local
UDP send calls do not establish delivery. The mDNS sends failed locally, so
**reverse coordinator-to-USB UDP remains independently untested**, rather than
proven failed by this request/reply attempt. The forward peer UDP/TCP failure
is now reproduced after the isolation cycle and USB restart.

Evidence: `group-post-toggle-probe-build.log`,
`group-post-toggle-probe-flash.log`, `group-post-toggle-peer-probe-live.jsonl`,
`group-coordinator-before-post-toggle-peer-probe.jsonl`, and
`group-coordinator-after-post-toggle-peer-probe.jsonl`.

The production image was restored to app0 with esptool hash verification.
Fresh HTTP diagnostics confirm 1.9.5, no `networkProbe`, and preserved LED count
205, midpoint 102, audio gain/gate/scale 8/8/100, follower role and coordinator ID.
The diagnostic hooks were removed only from build staging. Evidence:
`group-post-toggle-production-restore.log` and
`group-post-toggle-restored-production-diag.jsonl`.

Windows has PktMon, but this process receives Access Denied from its driver.
The user-run `.build/capture-group-discovery.ps1` requires Administrator
PowerShell, checks for no existing capture or filters, briefly captures only
UDP 49732/5353 at NICs, then stops and restores the initially empty filter list.
The sender binds `192.168.1.115` and additionally sets `IP_MULTICAST_IF` to that
address and multicast TTL 255. Its successful socket calls alone are not
capture evidence. The first user attempts stopped before capturing due to a
mistyped path, then an empty-list representation (`Packet Filters: None`) that
the preflight initially did not recognize. The script now accepts that exact
empty-list form. No network configuration was changed by those attempts.

The NIC-only capture then completed successfully, with no events lost and ten
captured packets. Component 1 is Ethernet 3 / ASIX, MAC AC-F4-66-49-92-08.
It records UDP 49732 broadcast reception from CoolLamp 1 (`192.168.1.154`, twice)
and the USB lamp (`192.168.1.220`, once), as well as other LAN mDNS traffic.
Thus some Wi-Fi-to-wired broadcast forwarding demonstrably works. It does not
record the coordinator's broadcast during this short window.

Critically, the captured packets contain **none of this sender probe's port
57760 traffic**, including the direct mDNS queries/responses that the probe
successfully exchanged with both lamps. This capture is incomplete for the
probe's path and cannot establish that its broadcast/multicast left the intended
NIC or that Windows suppressed them. No events lost is not proof that every
traffic path was observed. A follow-up script,
`capture-group-discovery-stack.ps1`, keeps the same narrow UDP filters while
capturing all network components, preserving the original evidence files.
First capture evidence: `group-windows-sender.etl`, `.pcapng`, `.txt`,
`group-capture-components.txt`, `group-capture-adapters.txt`, and
`group-windows-interface-probe.json`.

## Windows stack capture result

The follow-up capture completed with sender port 52462. It contains a concrete
UDP 49732 test broadcast transmit event at Ethernet 3's ASIX NIC (component 1):
`192.168.1.115:52462 -> 192.168.1.255:49732`, source MAC AC-F4-66-49-92-08,
destination MAC FF-FF-FF-FF-FF-FF. The same frame appears at TCPIP, QoS and WFP
components on that adapter. Thus the observed broadcast reaches the intended
NIC's transmit path; wrong-interface selection is not an explanation for that
observed packet. This is a sender observation, not a capture at the router.

ASIX counters report ten outgoing filtered packets totaling 818 bytes and zero
NIC drop counters. Those totals match the sender's four 83-byte broadcast
frames plus six 81-byte mDNS query frames. Nevertheless the retained raw events
identify only one test broadcast and one USB-lamp broadcast (each seen across
multiple components); there is no identifiable raw multicast test event. Do not
claim multicast-interface transmission verified solely from these totals.
The sender again got direct mDNS replies from both lamps but no multicast reply.

The capture's `INET: transport endpoint was not found` / `Port unreachable`
drop events are at component 147 on **Rx**, including the locally received test
broadcast and USB broadcast. There is no local listener on UDP 49732; these
receive-side drops do not establish that the test frame was dropped outbound,
which is separately recorded Tx at the ASIX NIC.

Evidence: `group-windows-stack.etl`, `.pcapng`, `.txt`,
`group-stack-components.txt`, `group-windows-stack-probe.json`,
`group-stack-capture-summary.json`, and `group-after-stack-capture-diag.jsonl`.
Keep router settings unchanged. Reverse coordinator-to-USB UDP is still the
independent peer test gap; forward failure is already reproduced post-toggle.

## Reverse peer test and exact coordinator recovery

The user connected CoolLamp 2 to Windows USB and kept Big Ass CoolLamp powered
on Wi-Fi. COM5 read-only telemetry verified coordinator ID `f0b950b2f180`,
firmware 1.9.4, 134 LEDs, effect 46, brightness 55, audio 8/8/100 and role 1.
ROM read-flash backed up all 4,194,304 bytes in 247 seconds. The private backup
and exact recovery partition remain local under ignored `.build`; they contain
device configuration and must never be uploaded or attached to a release.

The recovery extractor validates partition bounds, ESP32-C3 image target,
segment checksum, appended SHA-256 and both OTA selection CRCs. Valid sequences
5 and 4, both state 2, select app0 at 0x10000, size 0x1f0000. The installed image
has 1,821,936 bytes, SHA-256
`f9c1e3bb0f9f0e926e4c8ec0ba2994e570e31162cce44a413c367ab3a6afe223`.
No published-image substitution was used for recovery.

A staged reverse probe was built for `192.168.1.220` /
`coollamp-e2ea24.local`, flashed only to app0 and hash verified. Its one-shot
task completed with `udpSent=3` out of four attempts, `mdnsQueriesSent=0`,
`mdnsUnicastReplies=0`, `tcpConnected=0`, `httpCode=0`. The receiving USB lamp's
UDP counter stayed zero (delta zero). Thus independent **coordinator-to-USB
unicast UDP and TCP failure is now reproduced**, closing the earlier reverse
test gap. Failed mDNS sends still do not establish any distinct response-path
result. In both probe directions some local UDP sends succeed without delivery;
packet forwarding, ARP resolution and Wi-Fi compatibility remain potential
causes. No exact router or hardware defect is established.

The complete original active partition (2,031,616 bytes) was then restored from
the backup and esptool hash verified. Readback before normal boot showed the
partition table and OTA selection byte-identical to backup. Parsed NVS differed
only in `phy/cal_data` radio calibration records; all non-PHY records, including
user settings, Wi-Fi configuration, BLE bonds and group settings, are identical.
Fresh USB telemetry confirms original 1.9.4 with no `networkProbe` and the
expected LED/effect/brightness/audio/coordinator configuration. Temporary hooks
were removed only from staging. Big Ass CoolLamp remains on production 1.9.5;
its public candidate hash remains `d8dc4b7d773118b5d0050ae3add647edd9a4e56b7f666d9ec3d0731b7050a41e`.
Router settings were not changed, and no GitHub operation was needed.

Evidence: `group-coordinator-usb-before-reverse-probe.jsonl`,
`group-coordinator-backup-read.log`,
`group-coordinator-original-backup-metadata.json`,
`group-reverse-probe-build.log`, `group-reverse-probe-flash.log`,
`group-reverse-peer-probe-live.jsonl`,
`group-usb-immediately-before-reverse-peer-probe.jsonl`,
`group-usb-after-reverse-peer-probe.jsonl`,
`group-coordinator-original-restore.log`,
`group-coordinator-nvs-comparison.json`,
`group-coordinator-restored-original-diag.jsonl`, and
`group-final-after-reverse-probe.jsonl`.

A fresh Windows unicast control after both production firmwares were restored
delivered all four malformed UDP probes to each lamp (counter delta four each).
This confirms the peer failures alongside currently working Windows-to-lamp
UDP, rather than relying solely on the earlier pre-restart control. Evidence:
`group-after-reverse-windows-unicast-result.json`. These four control packets
do not discover, authenticate, join or change any settings.

## Lamp-to-Windows outbound control

The user pasted the network chat's next recommendation into this firmware chat:
test each lamp sending UDP to a listening Windows receiver, then consider one
lamp on the primary 2.4 GHz SSID only if both outbound paths work. The user
clarified that the pasted "pass this to the other chat" wording was a relay to
this chat, not a new instruction to send a message elsewhere. A coordination
note had already been sent to `Check Current Machine Specs`, asking that network
settings remain unchanged. Firmware tests proceed here; future pasted relay
text should not itself be treated as authorization to message another chat.

Windows Ethernet 3 remains 192.168.1.115/24 with Public network profile. A
temporary staged sender binds UDP 49173 and sends four identifiable packets to
Windows 49733, waits ten seconds, then sends four more. The receiver initially
only listens. After USB telemetry reports the first phase finished, it sends
UDP to the same lamp socket during the second phase to establish the normal
reverse flow. No firewall rule, profile, adapter or router setting is changed.
Actual receipt is counted separately for each phase, not inferred from sender
success calls. The serial monitor sets DTR true and RTS false before opening.

For CoolLamp 2, local send calls succeeded 4/4 in both phases. Windows received
**0/4 initially and 4/4 in the second phase**, with source 192.168.1.222:49173,
MAC 80:F1:B2:50:B9:F0, matching unique phase/sequence payloads. The latter
establishes working coordinator-to-Windows UDP. Why the first phase had no
receipt is not independently proven by this receiver test; Windows inbound
policy and address resolution must not be conflated with a definite send-path
failure.

The coordinator's exact original app partition was restored and hash checked.
The partition table and OTA metadata remain byte-identical to the private
backup; all non-PHY NVS records remain identical. Fresh USB telemetry confirms
original 1.9.4, no `networkProbe`, and expected LEDs/effect/brightness/role.
The user was asked to reconnect Big Ass CoolLamp by USB for the same outbound
control, keeping CoolLamp 2 powered on IoT. No SSID comparison has begun.

Evidence: `group-windows-probe-build.log`,
`group-windows-coordinator-flash.log`, `group-windows-coordinator-live.jsonl`,
`group-windows-coordinator-result.json`, `group-windows-coordinator-restore.log`,
`group-windows-coordinator-nvs-comparison.json`, and
`group-windows-coordinator-restored-diag.jsonl`.

Big Ass CoolLamp was then reconnected as COM4 and verified as `24eae26e9e9c`,
production 1.9.5, LEDs 205/midpoint 102, mode 4, brightness 100, follower role 2
with coordinator `f0b950b2f180`. A fresh private 32 KiB partition/NVS/OTA backup
confirmed sequence 1 selecting app0. The same compiled outbound diagnostic was
used, preserving the receiver's two-phase procedure and Windows interface.
Both local-send phases succeeded 4/4; Windows received **4/4 initially and 4/4
after reverse-flow priming**, from 192.168.1.220:49173, MAC 9C:9E:6E:E2:EA:24.

Thus **both lamp-to-wired-Windows UDP paths are demonstrated**. CoolLamp 2's
initial 0/4 remains a separate observation and should not be reported as global
Windows firewall blocking, since the second lamp's first phase succeeded.
The failed peer tests alongside successful outbound controls support further
investigation of Wi-Fi peer forwarding/address resolution/compatibility, not a
conclusive diagnosis of defective hardware or a particular router setting.

The production 1.9.5 image was restored to Big Ass CoolLamp, hash verified, and
readback showed partition table/OTA selection unchanged and all non-PHY NVS
records byte-identical. Expected LED layout, effect, brightness, audio tuning
and follower configuration were verified with no diagnostic hook. Evidence:
`group-windows-usb-before-outbound-diag.jsonl`,
`group-windows-usb-config-backup.log`, `group-windows-usb-flash.log`,
`group-windows-usb-live.jsonl`, `group-windows-usb-result.json`,
`group-windows-usb-restore.log`, `group-windows-usb-nvs-comparison.json`, and
`group-windows-usb-restored-diag.jsonl`. Configuration backups remain private.

Next controlled comparison requested from the user: notify the network chat to
hold router settings fixed; use the app's Bluetooth Wi-Fi setup to move **only
Big Ass CoolLamp** to the primary 2.4 GHz SSID, keeping CoolLamp 2 on IoT and
Big Ass CoolLamp on USB. Verify the selected network and current addresses
before repeating peer tests. Await the user's successful connection report;
no SSID change has been made in this chat yet. All other lamp settings and GPIOs
must stay unchanged, and the original IoT credentials are retained privately
for returning the lamp after comparison.

## Primary-network join blocked; scan failure reproduced

The user reported repeated "Wi-Fi scan failed" while trying the primary network
and said manual entry had also been attempted. Fresh COM4 telemetry shows
saved SSID `SmellsLikeEarwax`, disconnected, address 0.0.0.0, no AP BSSID and no
group listener. Phase 0 and join diagnostics all zero do not prove a successful
connection; they indicate no retained provisional-join observation. The saved
SSID differs in case from the handoff's `SmellsLikeEarWax` (capital W). The user
was asked to confirm the exact current router/phone SSID before another join.
Do not assume the historical handoff spelling is confirmed current.

A bounded USB `b` scan reproduced phase 5/error 1 with zero networks and no
connection. Thus the scan failure is reproduced in firmware independently of
the app UI. Free heap was about 75 KiB, minimum 71 KiB, and updater idle; this
observation does not support attributing the scan failure to OTA memory pressure.
The installed Arduino 3.3.11 scan implementation returns WIFI_SCAN_FAILED when
esp_wifi_scan_start fails. Espressif documents that a concurrent connection
attempt can reject scanning with ESP_ERR_WIFI_STATE. Current firmware starts
scans without pausing an unsuccessful reconnect attempt. This is a plausible
scan-recovery defect, not a captured low-level error-code diagnosis.
Keep firmware constant during the SSID comparison; record the scan-recovery
case for a separate fix/validation before the 1.9.5 release is finalized.

Evidence: `group-primary-scan-failure-wifi.jsonl`,
`group-primary-scan-failure-diag.jsonl`, `group-primary-manual-join-status.jsonl`,
`group-primary-manual-join-diag.jsonl`, and
`group-primary-usb-scan-reproduction.jsonl`. Driver reference:
https://docs.espressif.com/projects/esp-idf/en/release-v5.5/esp32c3/api-reference/network/esp_wifi.html

## Primary/IoT comparison succeeds with production firmware

The user confirmed the current primary name is `SmellsLikeEarWax` (capital W)
and corrected the manual entry. Fresh USB Wi-Fi setup status reports phase 4,
error 0, connected, IP 192.168.1.220, join associated/IP flags both true, saved
TX profile still [34,1]. BACL's BSSID is now 86:4D:4C:D8:F0:80; the coordinator
remains on IoT BSSID 86:4D:4C:D8:F0:89. Both are channel 11, /24, gateway
192.168.1.1. No diagnostic firmware was needed for this comparison.

**Authenticated group coordination started immediately across the SSIDs.**
BACL discovers CoolLamp 2 and CoolLamp 1, subscribes to the saved coordinator,
receives authenticated frames and reports active following. The coordinator
reports BACL as a joined peer. A ten-round, two-second-interval observation
showed BACL connected and following in every sample, with 490 additional frames
in 19,557 ms and zero additional authentication failures or resets. This
demonstrates the discovery, subscription/clock and unicast frame return paths
needed for the actual service, so repeating the temporary peer firmware probe
would add no necessary evidence for this comparison.

This distinguishes failed communication while both tested lamps used IoT from
working communication with one on primary and one on IoT. It supports examining
SSID-dependent forwarding/address-resolution/security-driver behavior. It does
not independently identify a specific router rule or prove which component is
defective. Keep router settings fixed for the network chat's investigation.
CoolLamp 1 is discoverable by BACL, but is not a joined coordinator peer; its
same-IoT coordination remains unresolved. Do not describe the lamp as offline
from the network.

Read-only saved-state verification confirms BACL startup mode 4 (Fire), startup
brightness 100, LED count 205, midpoint 102, limit 500 mA and audio 8/8/100 are
unchanged. Current runtime mode 46/brightness 55 come from following the group;
they do not overwrite startup defaults. The coordinator automatically adds the
newly reachable member to its scene order, preserving existing entries and
giving BACL position 2/count 3. BACL remains production 1.9.5, coordinator exact
original 1.9.4, with no root firmware/app implementation change in this test.
The primary SSID is currently saved on BACL as the controlled comparison state;
do not automatically switch it back and discard the working connection before
the user/network investigation decides the next step. Original IoT settings
remain backed up privately. A visual coordination check was requested from the
user; telemetry success is confirmed independently of that pending observation.

Evidence: `group-primary-corrected-ssid-wifi.jsonl`,
`group-primary-corrected-ssid-diag.jsonl`,
`group-coordinator-before-primary-comparison.jsonl`,
`group-primary-comparison-stability.jsonl`, and
`group-primary-saved-settings.json`. The latter omits the HTTP session token.

Unicast DNS from the router resolves `coollamp-50b9f0` and
`coollamp-50b9f0.lan` to `192.168.1.222`; `.local` through ordinary DNS returns
NXDOMAIN. This could support direct discovery fallback **after** peer traffic
works, but it cannot solve the currently failed direct Wi-Fi peer path.

## Station-counter comparison preparation

The two test stations are BACL `9c:9e:6e:e2:ea:24` at 192.168.1.220
and CoolLamp 2 `80:f1:b2:50:b9:f0` at 192.168.1.222. The user's router
station dump identifies BACL on `wifi2g` and CoolLamp 2 on `w2g-iot`;
fresh HTTP diagnostics confirm their device IDs and the corresponding
primary/IoT BSSIDs. Keep this distinction when labeling any new test.

The requested paired station captures have not yet been collected. Router
SSH is authenticated in the user's terminal tab `SSH to Router`; separate
command-tool access is being established. The browser tool failed to start,
and the computer-use skill prohibits terminal UI automation. No router
configuration or installed lamp firmware was changed in preparation.

An isolated temporary probe is prepared under
`.build/sketch-group-triggered/CoolLamp`, with source
`.build/GroupNetworkProbe-triggered.cpp` and builder
`.build/build-group-triggered-probe.cjs`. It sends no automatic boot probes.
USB `h` triggers BACL-to-coordinator; USB `r` triggers the reverse direction.
It checks the expected local IP and permits at most four UDP datagrams to
peer port 49732 per boot, 200 ms apart, with no TCP/mDNS tests or settings
writes. These commands are only probe-image extensions, not production
commands. `.build/run-group-triggered-probe.py` additionally verifies the
sender MAC/device ID and receiver identity before triggering.

Capture `show wifi interface station-dump wifi2g` and
`show wifi interface station-dump w2g-iot` immediately before and after each
burst. Record the sender's attempted/successful sends, receiver counters,
timestamps and SSID arrangement alongside the router results. Local send
success is not delivery proof. On the working cross-SSID arrangement,
background group traffic also changes station and reception counters; do
not attribute all counter deltas to the four diagnostic datagrams.
The existing production image and private recovery backups remain intact.

Preparation update: the isolated build passed (1,823,856-byte image, SHA-256
`88db05d7a36cd36bfa8541ee115c4d37e813728940c6b3d998131b3da5a96407`).
BACL app0 now temporarily runs that probe, with flash hash verification.
Its fresh private configuration backup and comparison show unchanged partition
table, OTA selection and all non-PHY logical NVS records; only PHY calibration
changed. After normal Wi-Fi reconnect it is on primary and following the group,
with probe stage 0, zero attempted/sent diagnostic packets, sender MAC
9C:9E:6E:E2:EA:24, 205 LEDs/midpoint 102 and audio 8/8/100.
The user agreed to take paired router station captures in the authenticated
terminal because noninteractive `ssh admin@192.168.1.1` was rejected.
The first forward test is awaiting its BEFORE capture; no diagnostic burst
or new counter-pair result should be reported yet. Restore BACL's production
image after the forward test, then prepare the coordinator for the reverse
test and restore its exact original image afterward. Current comparison
topology remains primary/IoT; no same-IoT retest was run in this preparation.
Evidence: `group-station-forward-flash.log`,
`group-station-forward-config-comparison.json`,
`group-station-forward-join.jsonl`, `group-station-forward-preflight.json`.

## Forward UDP burst with paired station captures

The user supplied BEFORE/AFTER dumps for both interfaces. BACL remained on
primary (`wifi2g`, 9c:9e:6e:e2:ea:24), coordinator remained on IoT
(`w2g-iot`, 80:f1:b2:50:b9:f0). The explicit USB trigger sent four
malformed UDP datagrams to 192.168.1.222:49732, with four successful local
send calls. The receiver's counter increased 4105 -> 4110 during 923 ms,
while normal group service remained active. This is consistent with probe
delivery plus background traffic, but the generic receiver counter does not
uniquely identify each diagnostic datagram.

| Router station | RX packets delta | TX packets delta | TX retries delta | TX failed delta | RX drop misc delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| BACL / primary | 1778 | 4494 | 3701 | 2685 | 0 |
| CoolLamp 2 / IoT | 3658 | 116 | 23 | 17 | 1738 |

The router's capture intervals are 80.173 s (BACL) and 79.744 s
(coordinator), with no detected counter reset or interface change.
The burst ran at 2026-10-06 16:39:48.391 through 16:39:49.321 America/Chicago.
Comparing wall-clock timestamps suggests BEFORE was about 57-59 s before
the trigger and AFTER about 20-21 s after completion; absolute gaps assume
router and Windows clocks agree. The roughly 80-second intervals are measured
from the router clock alone. These captures include sustained group traffic,
so the failure/drop totals cannot be assigned to the four probes and do not
identify a forwarding rule. This is the working cross-SSID control, not a
reproduction of the failed same-IoT path.

Evidence: `group-station-forward-router-before.txt`,
`group-station-forward-router-after.txt`,
`group-station-forward-router-deltas.json`,
`group-station-forward-result.json`, `group-station-forward-summary.json`.
Configuration comparison after the test still showed identical partition/OTA
data and unchanged non-PHY logical NVS records. BACL production restoration
and the reverse-direction test follow this measurement; do not mix later
reboot-induced station counter resets into this pair.

Forward-test cleanup completed: production BACL image SHA-256
`d8dc4b7d773118b5d0050ae3add647edd9a4e56b7f666d9ec3d0731b7050a41e`
was restored to app0 with esptool hash verification. Fresh private readback
again confirms unchanged partition/OTA data and non-PHY NVS records.
Live USB diagnostics report version 1.9.5, no temporary `networkProbe` field,
primary BSSID, connected and actively following (409 frames at the final
observation), 205 LEDs, midpoint 102 and audio 8/8/100.
The reverse-direction burst with paired station captures is still pending;
it requires connecting CoolLamp 2 by USB while BACL remains powered on primary.
Cleanup evidence: `group-station-forward-production-restore.log`,
`group-station-forward-config-restored-comparison.json`,
`group-station-forward-production-restored.jsonl`.

## Reverse station-counter test ready, awaiting BEFORE capture

The user connected CoolLamp 2 over USB. Fresh enumeration finds COM5;
ROM identity confirms 80:f1:b2:50:b9:f0. Its original installed version was
1.9.4, with 134 LEDs, midpoint 0 and audio 8/8/100. Fresh configuration backup
validates OTA sequence 5/state 2, app0 active. Existing exact original active
partition recovery image remains SHA-256
`f99a68b859dffebd1e202d37305f2600bc0adca6d5e42f58d297b6d98a8fe81b`.

The previously built triggered probe was flashed only into coordinator app0,
with hash verification. Fresh post-flash configuration comparison confirms
identical partition table/OTA data and unchanged non-PHY logical NVS records.
Reverse preflight verifies sender MAC/device ID, connected coordinator on IoT,
and the expected BACL receiver connected on primary. Probe is stage 0 with
zero attempted/sent packets. Do not trigger until the user's new BEFORE
capture; no reverse burst or paired counter result exists yet.

Use `run-group-triggered-probe.py --port COM5 --direction reverse` for the
explicit four-datagram test after BEFORE is captured, then obtain AFTER.
Save the two raw captures before analysis. Restore the coordinator's exact
original 1.9.4 active partition after the test and verify saved configuration.
BACL is already back on production 1.9.5. Router/SSID settings stay unchanged.
Evidence: `group-station-reverse-flash.log`,
`group-station-reverse-config-validation.json`,
`group-station-reverse-config-comparison.json`,
`group-station-reverse-join.jsonl`, `group-station-reverse-preflight.json`.

## Reverse burst and restoration completed

The user supplied new BEFORE/AFTER dumps. CoolLamp 2 on IoT explicitly
sent four malformed UDP datagrams to BACL on primary, 192.168.1.220:49732;
all four local send calls succeeded. BACL reception increased 3309 -> 3313
over a 1025 ms receiver observation. Frame/discovery/authentication counters
did not increase during that observation. The matching counter increase
supports delivery of the four probes, although the generic counter does not
individually tag them. Burst timestamps: 2026-10-06 16:48:34.941 through
16:48:35.967 America/Chicago.

| Router station | RX packets delta | TX packets delta | TX retries delta | TX failed delta | RX drop misc delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| BACL / primary | 812 | 947 | 435 | 289 | 7 |
| CoolLamp 2 / IoT | 1432 | 92 | 69 | 64 | 224 |

Capture intervals are 37.159 s for BACL and 37.094 s for coordinator,
with no detected counter reset or interface change. Apparent BEFORE-to-trigger
gaps are 23-25 s, and completion-to-AFTER gaps 11-13 s; cross-clock gaps assume
router/Windows wall-clock agreement. These roughly 37-second captures include
background group traffic, so retries/failures/drops cannot be assigned to the
four probes. Both station-counter tests are cross-SSID controls; neither
reproduces the earlier same-IoT failure.

A group disconnect was also captured within the reverse observation:
BACL following true -> false, coordinator member count 1 -> 0, no received
frames in that interval. This occurred with temporary diagnostic firmware on
the sender; no cause was established. Do not claim uninterrupted coordination
or attribute the disconnect specifically to the probes/router/hardware.

Coordinator exact original 1.9.4 active partition was restored to app0 with
flash hash verification. Fresh readback confirms identical partition table and
OTA selection data and unchanged non-PHY logical NVS records. Complete USB
replies verify version 1.9.4, no temporary probe hook, 134 LEDs, midpoint 0,
audio 8/8/100, connected on IoT with BACL joined. A final truncated serial
reply at the bounded capture endpoint was ignored; 13 complete replies were
available for verification. BACL remains production 1.9.5 on primary.

Post-restoration observation: BACL was connected/following in all 20 samples,
received 1262 additional authenticated frames over 50.449 s and had zero
additional authentication failures. Coordinator was connected with BACL joined
in all 19 successful reads; one of 20 HTTP diagnostic reads failed. No reset
or temporary probe hook appeared in the successful observations. Settings
remain 205/102 LEDs/midpoint on BACL, 134/0 on coordinator, audio 8/8/100 on
both. Thus current coordination recovered, while uninterrupted long-term
reliability and the same-IoT failure remain unresolved.

Evidence: `group-station-reverse-router-before.txt`,
`group-station-reverse-router-after.txt`,
`group-station-reverse-router-deltas.json`,
`group-station-reverse-result.json`, `group-station-reverse-summary.json`,
`group-station-reverse-production-restore.log`,
`group-station-reverse-config-restored-comparison.json`,
`group-station-reverse-production-verification.json`,
`group-station-tests-restored-stability.jsonl`,
`group-station-tests-restored-stability-summary.json`.
No reader/build/flash or capture remains active. Router/SSID settings were not
changed; firmware 1.9.5 remains unpublished. Both private recovery snapshots
remain ignored and must not be published.

## Reported unexpected local power-on; disconnected-follower fix

The user reported turning BACL off locally (button/app) and finding it on again
later, possibly an hour afterward, showing the coordinated group effect.
The exact off/on timestamps and reset history are unavailable. Current
read-only LAN diagnostics could not reach BACL at 192.168.1.220; router DNS
still resolves its name to that address. Coordinator diagnostics now show
primary BSSID 86:4D:4C:D8:F0:80 and CoolLamp 1 joined, so the network arrangement
has changed since the paired counter tests. These observations are in
`group-unexpected-power-on-current.jsonl`; no network settings were changed
by this investigation.

A confirmed control-path defect can explain a delayed rejoin: `setLampControl`
paused group sync only when `lampSyncFollowing()` was already true. A configured
follower turned off during a connection gap remained unpaused and could later
accept a coordinator's power-on frame. The focused control regression failed
against the old code, then passed after local off was made to pause grouping
even when the follower is disconnected. Invalid commands do not newly pause
it; standalone/coordinator power handling is unchanged. The actual sync-service
test also verifies that a correctly signed fresh handshake cannot bypass a
pause. These host tests passed on Windows.

The change is in `LampControl.ino`, with regressions in
`tests/audio-control.cpp` and `tests/sync-runtime.cpp`. GPIOs, saved settings,
group keys/order and startup defaults are untouched. It prevents this reconnect
case until explicit resume or restart. Restart remains a distinct possible
cause of the reported event: `PowerOn` initializes true and sync pause is
volatile. Do not claim the historical event is conclusively diagnosed.

An updated unpublished 1.9.5 candidate is building; no lamp was flashed for this
fix. Prior tested candidate SHA-256
`d8dc4b7d773118b5d0050ae3add647edd9a4e56b7f666d9ec3d0731b7050a41e`
is preserved at `.build/firmware-before-local-off-fix/CoolLamp.ino.bin` for
recovery. USB access to BACL was requested to read its uptime/reset information
before any flash and physically validate the fix.

Build/package completion: updated public 1.9.5 candidate is 1,822,144 bytes,
SHA-256 `89069b21848ee1480d212c11f09f02b51419d751a5a13a073efe30aee3a6c81e`.
Compiler program usage is 1,821,992 bytes, globals 52,700. Public-build,
credential, board/version/partition packaging checks passed; production map
contains no temporary network/TLS probe hooks. `git diff --check` passed.
The new image and matching manifest are in `firmware/public`; the previous
tested image and manifest remain in `.build/firmware-before-local-off-fix`.
No device was flashed and no GitHub operation/publication occurred. Build log:
`power-off-production-build.log`. The power-off fix has passed host tests and
the production build, but USB/device acceptance is still pending. This does
not close the separate Wi-Fi scan, same-IoT forwarding, full OTA or CI gaps.

## Whole BACL dark/on cycling: direct diagnosis awaiting USB

The user reports the whole BACL alone going dark for seconds, then returning.
Fresh Windows LAN reads still cannot obtain BACL diagnostics at 192.168.1.220,
but the coordinator lists BACL at that address as a joined group member.
No USB lamp is connected. No flash, power, brightness, scene, router or saved
setting was changed during this investigation.

Coordinator is on primary BSSID, power true, scene 5 (Orbit), three positions,
speed 60, intensity 85, colors [70,220,255]/[255,65,170], brightness 55.
A bounded 20-sample observation spans 21.316 s with increasing coordinator
uptime, power true and scene 5 in all samples. BACL was marked joined in 19/20
samples: sample 19 reported it not joined and one member; sample 20 recovered
to two members. This establishes a group-membership interruption, not its
cause or exact correspondence to a visually observed blackout.

A simulation of the real Orbit renderer at BACL's recorded geometry
(205 LEDs, midpoint 102, position 2/count 3) and these scene parameters covered
the full 3720 ms cycle at 1 ms steps. It produced zero completely dark frames,
with at least 203 lit LEDs after approximate brightness scaling. This assumes
valid synchronization time and matching received parameters; it does not test
the physical strip, supply, power limiter, or BACL's actual firmware state.
Normal Orbit movement under those assumptions does not explain a full blackout.

USB evidence is required to distinguish an uptime reset, group reconnect,
power-state change, stalled rendering, or physical LED-output interruption.
The read-only bounded helper `.build/capture-bacl-dark-cycles.py` is prepared
to request only USB `d`, record uptime/reset/power/group/Wi-Fi transitions,
and tolerate serial disconnects for at most 300 s. It verifies BACL's device ID
and never changes settings or flashes firmware. If possible preserve existing
power when attaching USB; a user-induced power cycle loses uptime evidence.
Current diagnostics provide no temperature measurement, so overheating is
neither confirmed nor excluded.

Evidence: `bacl-dark-cycles-initial-lan.jsonl`,
`bacl-dark-cycles-coordinator-observation.jsonl`,
`bacl-dark-cycles-orbit-simulation.json`, and
`check-bacl-orbit-darkness.cpp`. The previously built power-off candidate
remains uninstalled and unpublished; do not attribute this new cycling report
to that uninstalled fix or claim it will resolve the cycling without capture.

## 2026-10-07 USB diagnosis and user-requested pause

The user brought BACL to the laptop, necessarily interrupting its power, and
connected COM4. Its first reset reason was power-on (1), expected from that
move; this does not establish the cause of the earlier blackouts. USB access
requires removing the base bottom, so every USB observation below had the
enclosure open. Power source, location, cooling and elapsed warm-up differ
from the original reported condition.

Read-only standalone capture: 208 samples over 119.841 s, no uptime resets or
serial errors, Wi-Fi connected throughout, power true, Aurora (mode 2),
brightness 100, group paused throughout. Rendering advanced 7419 frames;
lowest observed free heap 61820 bytes, minimum since boot 13724. User observed
no blackout. File `bacl-dark-cycles-usb-2026-10-07-1.jsonl` and corresponding
`-summary.json` preserve the evidence.

The user approved a two-minute group comparison on the same USB power/location.
Coordinator was temporarily turned on and BACL resumed into Orbit, with all
runtime states restored afterward. This capture had 208 samples over 119.693 s,
207 following samples after the initial join, 2944 additional group frames,
no uptime resets, no serial errors and power true throughout. User again
observed no whole-lamp blackout. Lowest observed free heap 58008 bytes.
Restoration succeeded: BACL on, Aurora/brightness 100, group paused; coordinator
off, scene 5 preserved. No firmware, GPIO, persistent configuration, router or
SSID change was made. Files `bacl-dark-cycles-usb-2026-10-07-group.jsonl`,
`bacl-dark-cycles-usb-2026-10-07-group-summary.json` and
`bacl-dark-cycles-usb-2026-10-07-group.comparison.json` contain the evidence.

The open base is a thermal confound. These short, stable tests do not rule out
heat, normal-supply/cable problems, or conditions at the original location.
The user cannot close the base with USB attached. HTTP access to BACL now works
at 192.168.1.220, so the next proposed comparison is Wi-Fi telemetry on its
usual power supply/cable in a fixed location, first base open, then base closed,
with the same group effect. Closure may affect cooling, antenna reception or
wiring; do not equate a closed-base-only failure with proven overheating.
Read-only helper `capture-bacl-wifi-cycles.py` is prepared under `.build`.
Neither normal-supply nor closed-base phase has been run.

User explicitly requested pausing until returning home later on 2026-10-07,
and will unplug USB to take the laptop. All capture/control processes have
finished; no build, flash or serial reader remains active. Do not schedule a
background run or resume work until the user returns. Working tree is retained.
The power-off fix remains source/host/build validated, **not installed** on BACL;
new candidate SHA-256 is
`89069b21848ee1480d212c11f09f02b51419d751a5a13a073efe30aee3a6c81e`,
firmware 1.9.5 remains unpublished. On resumption first verify hardware ports,
lamp/network states and physical test conditions; a power cycle clears volatile
group pause and runtime power/effect state in the installed firmware.

## 2026-10-07 resume: chip temperature telemetry installed

The user returned with BACL on COM4, USB power only, base open. Fresh USB/LAN
reads verified ID `24eae26e9e9c`, increasing uptime, primary BSSID
`86:4D:4C:D8:F0:80`, Fire (mode 4), brightness 100, power on and group paused.
The coordinator remained off on 1.9.4, with Orbit settings retained. The user
clarified that the LED strip and power supply are external; the base contains
the ESP32-C3 board, rotary encoder and microphone.

At the user's inquiry about using the internal sensor, the current 1.9.5
candidate gained cached `chipTemperature` USB/HTTP telemetry. It samples at
most once per second, reports highest successful sample since boot and sample
age, and exposes unavailable/read errors explicitly. Driver initialization and
first calibration/read occur before updater/network startup. Diagnostic
requests never call or initialize the driver. Sensor sampling is suspended
while updater/reset resources are owned. No thermal power-control threshold,
GPIO assignment or persistent setting was introduced. Six focused runtime
tests and the actual authenticated diagnostic-handler test passed; independent
review found no blocker. The release workflow includes the new runtime test,
but was not dispatched.

The instrumented public candidate built and packaged: 1,829,040 application
bytes, SHA-256 `13940566fe29d92c668820ebd6319f67aac7424d99ef78c7ef9f2203306709ab`;
compiler program 1,828,890 bytes, globals 52,748. It includes the earlier local
off fix and eight room scenes. The pre-temperature candidate is preserved in
`.build/firmware-before-temperature/`. A fresh private 4 MiB ROM backup was
verified, including active app0 and exact matching bytes of the previously
USB-tested `d8dc4b7d...` image. Only app0 at `0x10000` was written; esptool
verified its hash. Subsequent private configuration read-back verified unchanged
partition table, OTA metadata and all non-PHY logical NVS records. Only
`phy/cal_data` changed. Backup/configuration blobs remain ignored and private.

Pre-update runtime controls were restored and verified: Fire/brightness 100,
power on, follower of the same coordinator, group paused, 205 LEDs/midpoint 102.
The new sensor reads successfully through both USB and Wi-Fi. A bounded USB
capture returned 208 samples over 119.403 seconds: all temperature readings
valid, 55.1–56.1 C, zero uptime resets/serial errors/state changes, continuous
Wi-Fi/power, and 7051 rendered frames. Lowest observed free heap was 61,012;
minimum since boot 11,676. The completed boot updater status showed HTTP 200
with TLS/transport/error codes zero. The capture itself saw only idle phase 0;
it is not an additional manual-check-under-polling or full-OTA test. Visual
confirmation for this capture was requested separately; absence of firmware
transitions does not prove absence of a physical LED blackout.

Evidence: `bacl-temperature-usb-acceptance.jsonl` and `-summary.json`,
`bacl-temperature-wifi-verified.jsonl`, `bacl-temperature-restored-controls.json`,
`bacl-temperature-nvs-comparison.json`, `bacl-temperature-flash.log`, and
`temperature-production-build.log`. All USB/flash/capture processes finished.
The required next user step is to reconnect the usual supply/cable, same
location, base open, before a bounded Wi-Fi baseline and closed-base comparison.
Neither normal-power nor closed-base phase has yet run. Hold controls constant
and avoid a power interruption between open/closed phases if possible.

These are silicon-temperature trends, not exact enclosure/ambient temperature
or proof of overheating. The firmware update/power cycles also changed the
volatile group fallback history, so the new baseline cannot conclusively explain
the old dark/on event. A separate plausible software path is a group dropout
restoring pre-group local power-off, followed by rejoin restoring coordinator
power-on. Correlating uptime, `render.power`, `sync.active`, network frames and
temperature with a visually observed event remains necessary. No GitHub action,
app upload, firmware publication, router or SSID change occurred.

## Normal supply, open base: five-minute thermal baseline

The user confirmed reconnecting BACL to its usual plug and cable with the base
open. Initial Windows HTTP to BACL timed out while coordinator diagnostics
still showed it joined. A bounded 30-second preflight recovered 34 BACL replies
with seven read timeouts; no uptime reset occurred during those replies.
BACL had resumed following after the power cycle and adopted the coordinator's
off/Orbit/brightness-55 state. That explains its recorded software-off state;
it does not establish the cause of the intermittent HTTP timeouts. Two active
Windows LAN interfaces were observed (Ethernet 3 `.115`, Wi-Fi `.136`); no route,
interface, router or lamp-network setting was changed.

The saved test runtime controls were then restored and verified: Fire (4),
brightness 100, power on, group paused, 205 LEDs/midpoint 102. Only runtime
pause/preview/power commands were used. The coordinator remained off on 1.9.4
with scene 5, brightness 55 and saved order unchanged.

The controlled five-minute read-only Wi-Fi capture completed: 526 successful
BACL replies over 299.4 seconds, all fresh valid chip temperatures, 54.1–57.1 C
(median 56.1; final 57.1), zero inferred/recorded uptime resets, stable controls
and 17,588 additional rendered frames. Eighteen BACL requests timed out; the
largest successful-response gap was 5.739 seconds. These gaps are retained,
not treated as resets or silently removed. Coordinator returned 544 replies
with zero errors and retained its off state. All compared BACL runtime controls
match the USB baseline; power source, telemetry transport and warm-up timing
still differ. Physical blackout confirmation was requested separately and must
not be inferred from the firmware counters.

Files: `bacl-normal-open-preflight.jsonl`,
`bacl-normal-open-reachability.jsonl` and `-summary.json`,
`bacl-normal-open-controls.json`, `bacl-normal-open-temperature.jsonl`, and
`bacl-normal-open-temperature-wifi-summary.json`. Offline summarizer
`summarize-bacl-wifi-temperature.py` separates both hosts, identifies stale
samples/read gaps and handles reset-versus-counter-rollover/incomplete captures.
No capture is active at the end of this phase. The user was asked to close
the base without moving BACL or interrupting power before the same-duration
closed-base comparison. Do not start that phase until closure is confirmed.

## Closed base and normal supply: thermal comparison and Orbit check

The user confirmed the base cover was on. Preflight still showed the same boot,
but mode had changed to SplitFire (5), so only the original Fire (4) preview
was restored before the controlled capture. Brightness 100, power on, group
paused and geometry 205/102 were verified; no saved settings were written.
Boot continuity across the gap is supported by wall time versus uptime: last
open sample to first closed sample differed by 804.559 seconds wall time and
804.587 seconds uptime, within 28 ms. The gap also included a historical peak
of 59.1 C before the closed capture; do not assign that unobserved peak to the
cover change. Warm-up and the gap's mode change remain confounds for causality.

The five-minute closed-base Fire capture completed with 590 BACL replies over
299.502 seconds, all fresh valid temperatures, 56.1–59.1 C (median 58.1; first
57.1, last 59.1), zero observed uptime resets/counter discontinuities, stable
power and test controls, and 17,539 additional rendered frames. There were
three BACL HTTP timeouts; maximum response gap 2.132 seconds. Coordinator
returned 593 replies with no errors and remained off. Compared controls match
the open-base capture. Closed readings were about 2 C higher, but were still
rising near the end; equilibrium and a heat-caused failure were not established.

The previously approved, reversible two-minute Orbit comparison was repeated
with this usual supply/cable and closed base. Only coordinator power and BACL's
runtime group resume were temporarily changed. The capture returned 233 BACL
replies over 119.488 seconds; 232 were actively following after the initial
pre-join sample, scene 5/position 2/count 3/brightness 55. Power stayed true,
uptime/rendering continued (7103 extra frames), temperatures were 59.1–60.1 C,
with no sensor errors/uptime resets and two HTTP read timeouts. Restoration
succeeded and was verified: BACL on, Fire 4/brightness 100/group paused,
coordinator off, Orbit configuration retained. No firmware, GPIO, persistent
settings, network or router change was made between these thermal tests.

Evidence: `bacl-normal-closed-preflight.jsonl`,
`bacl-normal-closed-controls.json`, `bacl-normal-closed-temperature.jsonl`,
`bacl-normal-closed-temperature-wifi-summary.json`,
`bacl-open-closed-temperature-comparison.json`,
`bacl-normal-closed-orbit-group.jsonl`,
`bacl-normal-closed-orbit-group-wifi-summary.json`, and
`bacl-normal-closed-orbit-group.comparison.json`. All captures/control processes
finished. The user was asked for visual confirmation across the closed-base
Fire/Orbit tests; do not infer that the physical LEDs remained lit from these
counters. Original hour-scale warm-up, voltage/LED-output faults, and historical
group fallback behavior are not ruled out by these short tests or the new
firmware. The source-confirmed local-off fix is installed, but targeted physical
off-during-connection-gap acceptance remains separate from thermal stability.

Visual follow-up: the user noticed no whole-lamp blackout, but was multitasking
and may have missed one. Treat this as incomplete visual observation, not proof
that physical output stayed lit. They then explicitly authorized publishing the
current temperature-enabled firmware for OTA and app changes to TestFlight;
longer logging preparation is deferred while release validation/publication runs.

## 2026-10-07 initial publication checkpoint; installed-image and OTA gaps

The latest public release is [firmware 1.9.5](https://github.com/jammendolia/CoolLamp/releases/tag/firmware-v1.9.5),
commit `7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f`. Firmware CI run
`37682079916` succeeded, and the published application is 1,828,656 bytes,
SHA-256 `aabfb5bfcd314242c381b3494cbe7aca09b43f58d0de4b4d101e0e7e487d0082`.
The existing macOS app workflow also succeeded in run `37682084000`;
Apple accepted app **1.0 (27.1)**. Tester availability and user installation
are not independently verified. Every GitHub action used a verified
process-local jammendolia account; HiFin was untouched.

BACL remains on the USB-installed temperature-enabled Windows 1.9.5 candidate,
SHA-256 `13940566fe29d92c668820ebd6319f67aac7424d99ef78c7ef9f2203306709ab`.
It has the same source as the release but differs from the CI binary. Normal
same-version OTA does not offer the published 1.9.5 image to this lamp.

At this earlier publication checkpoint, CoolLamp 2 was observed running 1.9.4.
Its manual and quiet HTTPS
checks reported error 3, TLS 12288, transport 32794, HTTP 302, host 2.
Authenticated local uploads using Python and curl returned empty replies;
upload success and next-boot image were unconfirmed. USB identity/OTA-selection
verification and bootstrap were pending then; their later outcome is recorded
in the following section.
CoolLamp 1's quiet check also completed on 1.9.4, phase 5/error 3, HTTP
stage 2/code 302/host 2, TLS 12288/transport 32794, automatic updates true.
Its evidence is `.build/ota-1.9.5-quiet-192.168.1.154.json`.

BACL's fresh secure published-manifest check completed phase 0/error 0,
latest 1.9.5, HTTP stage 7/code 200/host 2, TLS error/flags 0 and transport 0
while group following was active. Latest separate reads show all three lamps
on, mode 46, brightness 55, scene 0; BACL is unpaused/actively following and
reports 61.1 C. These latest controls supersede the earlier Fire/paused thermal
checkpoint and must be preserved during USB bootstrap. Evidence:
`.build/bacl-published-1.9.5-check.jsonl` and
`.build/ota-1.9.5-current-lamp-status.jsonl`. The check succeeded, but no claim
is made that controls remained unchanged throughout its entire window.

Publication and CI success do not establish a completed full OTA installation,
physical room/audio acceptance, a blackout/thermal fix, or a resolution of the
IoT-to-IoT forwarding issue. Preserve existing GPIOs, saved settings, group
keys and memberships during the remaining device checks.

## 2026-10-07 coordinator USB bootstrap verified; app 28.1 uploaded

The user connected CoolLamp 2; COM5 and MAC `80:F1:B2:50:B9:F0` were verified.
The fresh 1.9.4 boot successfully negotiated secure HTTPS and started automatic
download of the published 1.9.5 image. It reached 47%, then failed at the
existing 180-second download limit, phase 5/error 6. The observed download
had HTTP stage 7/code 200/host 2, TLS error/flags 0 and transport 0. This
supersedes the earlier quiet-check failures for this boot, but does not establish
a completed OTA installation. Evidence:
`.build/coordinator-published-1.9.5-auto-ota-attempt.json` and
`.build/coordinator-published-1.9.5-usb-ota.jsonl`.

A fresh private 4 MiB ROM backup has SHA-256
`703b82e9fffa7e5fde52bd3db6ae6075e359776a5142198898247a04473fb2ea`.
The CRC-valid OTA selector chose app0 at `0x10000`, sequence 5/state 2. The
extracted old 1.9.4 image matched SHA-256
`f9c1e3bb0f9f0e926e4c8ec0ba2994e570e31162cce44a413c367ab3a6afe223`.
Thus the earlier empty local-upload replies had not changed the selected boot
image at this verified checkpoint. Recovery files remain ignored/private:
`.build/coordinator-pre-published-1.9.5-private-backup.bin` and
`.build/coordinator-pre-published-1.9.5-active-app-private.bin`; do not attach
them to releases. Metadata is in
`.build/coordinator-pre-published-1.9.5-backup-metadata.json`.

Only app0 was written with the exact immutable published CI application:
1,828,656 bytes, SHA-256
`aabfb5bfcd314242c381b3494cbe7aca09b43f58d0de4b4d101e0e7e487d0082`,
from firmware source commit `7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f`.
ROM write-hash verification passed. Compared with the fresh pre-write backup,
raw configuration readback had `nvsChanges: []`, with partition table and
OTA-selection metadata unchanged. All logical NVS records, including PHY
calibration, were identical for this coordinator update. Saved API settings
and runtime controls independently matched (`changedFields: []`). GPIO
assignments and lamp configuration were preserved. Evidence:
`.build/coordinator-1.9.5-usb-nvs-comparison.json` and
`.build/coordinator-1.9.5-usb-settings-comparison.json`.

The new 1.9.5 boot was healthy: at 41.8 seconds it reported valid 53.7 C,
sceneCount 26, power on, mode 46, brightness 55, 134 LEDs/midpoint 0. A further
95-second USB capture showed at least 93.6 seconds of stable observed operation.
The fresh secure published-manifest check passed with latest 1.9.5, phase 0,
error 0, available false, HTTP stage 7/code 200/host 2, TLS error/flags 0 and
transport 0. Later HTTP diagnostics at uptime 174306 ms reported valid 55.7 C
and sceneCount 26. Evidence:
`.build/coordinator-published-1.9.5-usb-boot.jsonl` and
`.build/coordinator-published-1.9.5-https-check.jsonl`.
CoolLamp 2 can return to normal power. This was USB bootstrap plus a successful
secure check, not a successful secure OTA download/install or proof about
physical LED blackouts.

The app's per-device installed-firmware cards now distinguish a connected
version, disconnected **Last seen** version and unknown **Connect to view**.
No extra hardware polling was added. Four mobile files changed; 104/104 tests,
the production web build and mock browser check passed. Commit
`a3499e89a69fcb7bbb56b6a9f3fdae4f21761821` completed macOS TestFlight run
`37688466205`, and Apple reported `UPLOAD SUCCEEDED with no errors` for app
**1.0 (28.1)** on 2026-10-07 at 16:23:19 CDT. Evidence:
`.build/ios-testflight-28.1-ci.log`. Tester availability/user installation remain
unverified. The earlier app 27.1 accepted upload and published 1.9.5 firmware
assets remain established history; firmware 1.9.5 was not rebuilt or replaced
for this app-only change. Every GitHub action used personal jammendolia; HiFin
was untouched.

At this coordinator/app checkpoint, CoolLamp 1 was connected on COM3 but its
backup/install was still pending; the following section records its completion.
Full secure OTA installation, physical
new-scene/audio acceptance, IoT-to-IoT forwarding and longer blackout/thermal
follow-up remain open. The user noticed no blackout during short tests, but
was multitasking, so that observation remains incomplete.

## 2026-10-07 CoolLamp 1 bootstrap verified; all lamps now 1.9.5

CoolLamp 1's COM3 identity/MAC `80:F1:B2:50:B9:AC` was verified. The fresh
private 4 MiB ROM backup has SHA-256
`14a2e6fb973b02f79830c67f70b7e37fa808e4c4261a738d1c781ffc9686bfe6`.
CRC-valid OTA sequence 22/state 2 selected **app1 at `0x200000`**, unlike the
coordinator's app0. The recovered old application matched published 1.9.4
SHA-256 `f9c1e3bb0f9f0e926e4c8ec0ba2994e570e31162cce44a413c367ab3a6afe223`.
Only the verified selected app1 received the exact published 1.9.5 CI image,
1,828,656 bytes, SHA-256
`aabfb5bfcd314242c381b3494cbe7aca09b43f58d0de4b4d101e0e7e487d0082`.
ROM write-hash verification passed. Recovery blobs remain ignored/private,
including `.build/lamp1-pre-published-1.9.5-private-backup.bin`; metadata is
`.build/lamp1-pre-published-1.9.5-backup-metadata.json`.

Post-write raw comparison found **all logical NVS records unchanged**
(`nvsChanges: []`), with unchanged partition table and OTA selector.
Saved API settings and runtime controls matched (`changedFields: []`). This
preserves CoolLamp 1's freshly read settings rather than copying another lamp
or restoring an older snapshot: startup mode 43/brightness 215, microphone
installed and automatic gain enabled, gain 8/gate 10/scale 115, 134 LEDs/
midpoint 0, automatic updates enabled, role 2 with CoolLamp 2 as leader.
Its current runtime remained power on, mode 46, brightness 55 and group scene 0.
Evidence: `.build/lamp1-1.9.5-usb-nvs-comparison.json` and
`.build/lamp1-1.9.5-usb-settings-comparison.json`.

The healthy 95-second USB capture produced 45 valid records spanning 95363 ms,
with valid temperature telemetry. The scheduled secure manifest check passed:
current/latest 1.9.5, phase 0/error 0, HTTP stage 7/code 200/host 2, TLS
error/flags 0 and transport 0. Final diagnostics at uptime 150004 ms reported
valid 57.7 C and historical peak 58.7 C. Evidence:
`.build/lamp1-published-1.9.5-usb-boot.jsonl` and
`.build/lamp1-published-1.9.5-https-check.jsonl`.

Final separate reads confirmed CoolLamp 2 and BACL on 1.9.5, and all three lamps
power on, mode 46, brightness 55, group scene 0. CoolLamp 1 and CoolLamp 2 now
run the exact published CI application; BACL retains the same-source Windows
1.9.5 candidate. CoolLamp 1 can disconnect USB and return to usual power.
Evidence: `.build/other-lamps-after-lamp1-bootstrap.jsonl`.
The earlier 1.9.4/pending-bootstrap states are historical. Firmware version
prerequisites for scenes 19–26 are now satisfied, but physical room/audio
acceptance is still pending. This does not establish a successful full secure
OTA installation: CoolLamp 2's old 1.9.4 download timed out at 47%, whereas the
new 1.9.5 secure checks passed after USB installation. Historical blackout/
thermal and IoT-to-IoT forwarding issues remain unresolved.

At this bootstrap checkpoint, app 1.0 (28.1) was the latest accepted upload, from commit
`a3499e89a69fcb7bbb56b6a9f3fdae4f21761821`. The newly requested asynchronous
per-card pings and explicit **Update all** feature were still under implementation
at this bootstrap checkpoint; the following section records local validation
and the subsequent accepted app 29.1 upload.
Published firmware 1.9.5/source `7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f`
remains immutable. Only personal jammendolia is used; HiFin remains untouched.

## 2026-10-07 asynchronous fleet app 29.1 accepted by Apple

Source `d8620a428406bdd4a9a8cb3fcd0188135b43bc70` was pushed to the existing
codex branch, and existing macOS CI run `37692263376` completed successfully for
app **1.0 (29.1)**, verified from run number 29/attempt 1. CI's 134/134 tests,
native Swift accessory/address checks, web build, signing and archive/export
passed. Apple reported `UPLOAD SUCCEEDED with no errors` on 2026-10-07 at
16:56:54 CDT. Evidence: `.build/ios-testflight-29.1-ci.log`.
App 29.1 is the latest accepted upload; tester availability/phone installation
have not been independently queried. App 1.0 (28.1), source
`a3499e89a69fcb7bbb56b6a9f3fdae4f21761821`, is retained as the earlier
firmware-card checkpoint. Firmware 1.9.5/source
`7a4b5c294e717a6b04bca5d32d64dc4bf2b6962f`
and its published assets are unchanged.

Local validation passed 134/134 mobile tests, the production web build and
mocked UI checks. These cover asynchronous per-card reads, including a blocked
or deferred ping while other cards return results and Light/Settings navigation
and another lamp's controls remain usable. Explicit **Update all** handles lamps
sequentially with per-lamp progress/errors; an offline lamp or missing password
does not hide the other lamps' results. Selection, disconnection and saved
automatic-update preferences are not mutated. Installed-versus-latest version
and timestamp ordering guards prevent stale replies from replacing newer card
results. Page-open/background status refresh only reads; updates started by the
app require the explicit button. Existing automatic-update preferences remain unchanged.

A separate live test used the background refresh module against all three
lamps with **GET only**. Each identity was verified, and each returned installed
1.9.5, advertised latest 1.9.5, ready/no available update. Evidence:
`.build/firmware-fleet-live-refresh.json`. Update/install progress, error paths
and fleet sequencing were validated with mocks; no live full secure OTA
download/install was performed by this test. Do not combine these evidence
levels into an end-to-end OTA claim.

CoolLamp 1/CoolLamp 2 remain on exact published CI 1.9.5 after their verified
USB bootstraps, with logical NVS and saved/runtime settings unchanged; BACL
retains its same-source Windows 1.9.5 candidate. Firmware publication remains
immutable. Only personal jammendolia is used; HiFin remains untouched.
Accepted app 29.1 includes the page/background read-only refresh and explicit
sequential Update all behavior described above. Bulk installations remain
mock-tested; the live fleet test only read statuses. Full secure OTA installation,
physical new-scene/music acceptance, historical blackout/thermal diagnosis and
IoT-to-IoT forwarding remain separate open work.
