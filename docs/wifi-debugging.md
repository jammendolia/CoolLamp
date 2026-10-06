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
