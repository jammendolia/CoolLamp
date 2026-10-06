# Debugging lamps over Wi-Fi

Run `tools/debug-wifi.py` on a computer on the same LAN as the lamps. No USB cable, phone-app update, or remote shell is required. Each request uses the lamp's existing access password and only reads telemetry. The tool never changes effects, starts recording audio, updates firmware, or restarts a lamp.

Use IP addresses shown in the app, or each lamp's `.local` hostname:

```sh
python3 tools/debug-wifi.py coollamp-50b9f0.local --factory-password
python3 tools/debug-wifi.py 192.168.1.25 192.168.1.26 --factory-password --samples 30 --interval 2
```

`--factory-password` explicitly selects `coollamp`. For a custom password, omit that flag and enter it at the hidden prompt. For automation, `--password-env VARIABLE_NAME` reads an existing environment variable. Do not put custom passwords in command arguments or check them into the repository. Lamps with different passwords should be sampled separately.

Output is one JSON object per lamp per sample; redirect it to an ignored `.build/` file to retain a diagnostic session. A failed lamp produces an error record without preventing the other lamp from being queried. Sampling is bounded to 300 rounds, with at least one second between rounds. Requests have an eight-second timeout and redirects/proxies are disabled.

Firmware 1.7.3 adds authenticated `GET /api/diagnostics` with:

- Device identity, firmware version and update status.
- Uptime in milliseconds, numeric ESP reset reason, free heap, minimum free heap, and largest allocatable block.
- Wi-Fi connection, IP, RSSI (dBm; meaningful when connected), channel, setup-hotspot clients, and scan result count/timing. A scan count of -1 means running and -2 means failed or not started; `active` disambiguates current state.
- Render frame counter, maximum render duration in microseconds since boot, active effect, brightness, power, LED count and midpoint setting.
- Microphone installation, capture status, amplitude/band summaries, gain/noise floor, capture errors and overruns. No raw audio is returned. Inactive capture is normal outside audio effects.
- Group role, following status and discovered peers. No group invitation key is returned.

Estimate frame rate from the difference in `render.frames` divided by elapsed `uptimeMs` between samples. Counters wrap; discard samples spanning restart or wrap. Diagnostics do not start a Wi-Fi scan or microphone capture. Normal authenticated requests count as setup-hotspot activity.

Older firmware falls back to selected fields from `/api/state`, marked `diagnosticsVersion: 0`; it has less network/runtime information. The tool excludes the state endpoint's session token and home network name from saved output. The new diagnostic endpoint excludes these at the source as well. Reports include device identities and local IP addresses, so review them before sharing publicly.

The assistant needs network access from the computer running this repository. Remote control of this session keeps execution on that computer. This feature does not expose the lamps to the internet or provide a firmware-level debugger, arbitrary memory access, or a remote shell.

## USB fallback for network/group diagnosis

Development firmware 1.9.4 also exposes the same read-only diagnostic snapshot
with USB command `d`. It streams replies in bounded chunks so a missing USB host
cannot stall rendering. HTTP authentication remains required for the online
endpoint; neither path includes access passwords, Wi-Fi passwords, group keys,
session tokens or raw microphone audio.

```sh
python3 tools/audio-usb.py /dev/cu.usbmodem80201 d --poll --poll-command d --seconds 15
```

The Wi-Fi section includes the AP BSSID, subnet and gateway for identifying
which access point/network a lamp actually joined. The group section includes
whether its UDP listener is running or paused by setup/update activity, plus
received-packet, discovery, authentication-failure, subscription, accepted-frame
and delayed-clock-reply counters. Packet counters are runtime observations;
configured membership alone does not establish that the coordinator can be
reached. A follower with a saved coordinator, `paused=false`, a running listener,
and zero received packets requires network-path investigation before changing
its group code.

On the USB prototype, the group join persisted as a follower, survived a restart,
and was not paused. Wi-Fi reported a good signal, but the running group listener
received no packets from either existing lamp or a discovery-only LAN probe.
Client isolation/broadcast filtering is a hypothesis to verify in the router;
these observations do not establish that an isolation setting is enabled.

A readiness-checked restart test repeated the probe after Wi-Fi had obtained
its address and before the background update check began. At roughly 20 seconds
uptime, the lamp reported over 62 KB minimum free heap, a running unblocked
listener, and zero received group packets. Read-only HTTP from the Mac also
failed. Thus the observed startup delivery failure does not depend on the
updater's later transient memory peak. The router's client-isolation toggle was
reported disabled; further diagnosis requires checking direct peer addresses,
setup-mode suspension on the coordinator, and network forwarding rules.

Further checks confirmed that the coordinator is running firmware 1.9.3 with
role 1 and no setup hotspot. Its live peer list and member count are empty;
the two entries in its scene order are saved positions, including an offline
CoolLamp 1, rather than evidence of an active group connection. Restarting the
coordinator did not restore reception on the new lamp.

On the iPhone connected to the IoT network, the coordinator's numeric address
loaded immediately, while the new lamp initially took 20–30 seconds. An isolated
build disabling modem sleep on the new lamp then loaded promptly on repeated
Safari requests. Firmware 1.9.4 therefore requests `WIFI_PS_NONE` before station
startup and reports the driver's actual `wifi.powerSave` value (`0` none, `1`
minimum modem sleep, `2` maximum modem sleep, `-1` unavailable). This is a
measured improvement on that prototype, not proof that every network-path issue
is resolved. The new lamp still received no group packets, and a separate,
temporary direct TCP probe from it to the coordinator timed out after five
seconds. The probe is isolated under `.build/` and is not part of release firmware.

The iPhone discovery plugin now uses the numeric IPv4 address already resolved
by `NetService`, matching Android's existing behavior, rather than discarding
that address and relying on another `.local` lookup for HTTP. Empty, truncated
or incompatible socket records fall back to the hostname. Device identity is
still checked before controls are enabled. Refresh the app's Wi-Fi list once
after installing this change to replace older session discoveries.

## Secure updater memory pressure

Both published OTA manifest URLs were independently verified to return 1.9.4.
An isolated USB-lamp diagnostic then captured the failure beneath the generic
network error: RSA public-key verification returned `-0x4290`, composed of
`MBEDTLS_ERR_RSA_PUBLIC_FAILED` (`-0x4280`) and
`MBEDTLS_ERR_MPI_ALLOC_FAILED` (`-0x0010`). Minimum free heap fell to 572 bytes;
after the failing verification returned, free heap was 10,268 bytes and the
largest block was 7,668 bytes. Subsequent trials sometimes succeeded with only
about 1 KB of minimum free heap. This establishes memory exhaustion on the USB
prototype, rather than proving an outage or certificate-expiry problem. A
matching fresh diagnostic is still needed to attribute CoolLamp 2's failure.

The app now reads `/api/firmware` immediately after firmware actions and while
the updater is checking, downloading or restarting. It checks this compact
status before periodic full-state reads, then resumes normal state refreshes
when the updater is idle, available or failed. If the firmware version changes,
it reloads state to verify identity and obtain the new token and effect catalog.
This reduces HTTP response allocations during TLS and works with existing
firmware. Failed firmware downloads retain a functioning Wi-Fi connection;
they are not treated as phone-to-lamp transport failures. No uncertain POST is
replayed. Host and browser checks cover progress, errors, restart identity/token
refresh, malformed/stale replies and the absence of full-state reads after an
update begins.

Temporary TLS probes under `.build/` record error codes, allocation sizes and
memory metrics only. They preserve certificate-verification results, contain no
credentials or audio, and are not part of published firmware. Restricting TLS
groups/ciphers alone did not eliminate the measured low-memory failure, so that
experiment has not been adopted as a release fix.
