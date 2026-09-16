# Online firmware updates

Firmware 1.2.0 adds updates from https://github.com/jammendolia/CoolLamp. Both the web page and Bluetooth app show the installed version, available update and progress, with Check for updates, Update now, and Install updates automatically controls.

## Owner setup

Install 1.2.0 once through the existing authenticated web upload or USB. Older firmware cannot discover its first updater installation. Lamps still using the small pre-Bluetooth partitions need USB migration first. Connect the lamp to home Wi-Fi with internet access through its settings page.

All build variants now use the larger dual-slot partition layout, including --wifi-only. Do not upload those images to a lamp with the old small layout without migrating it over USB.

Automatic installation defaults off; changing it persists immediately. Checks run after 60–90 seconds of uptime and roughly every six hours. Failures retry after approximately 15 minutes. The updater waits for a 30-second boot health period; automatic installation waits at least a minute. An attempted version is remembered across restarts to prevent repeated automatic attempts at a bad release. Update now can retry manually.

Checks run in a background task. Installation pauses animation and restarts into saved startup settings. Updates can run while the light is off. Reconnect the app after restart. Bluetooth controls alone do not provide internet to the lamp.

## Publishing releases

Set the three version components and matching string in LampVersion.h to a new stable major.minor.patch version. Never reuse a released version or replace its assets. Run the Build firmware release draft workflow with that version. It builds pinned dependencies and creates a draft tagged firmware-v<version>, containing CoolLamp.ino.bin and coollamp-manifest.txt.

Review and test the draft before publishing it as the repository's Latest release. Publishing Latest makes it installable by every compatible lamp with auto-update enabled. Keep unrelated app releases from becoming Latest.

Local public build commands:

```
node tools/build-firmware.cjs --public
node tools/package-firmware.cjs
```

Packaging checks version, board, size, the public-build marker and credential exclusion. Only firmware/public application and manifest files may be published. Private firmware/ble and firmware/wifi images contain initial credentials and must never be published.

Public images are OTA upgrades for already provisioned lamps, preserving saved credentials, colors and settings. They are not fresh-device provisioning images: absent valid settings, they generate an inaccessible random password. Provision new or erased devices with a private local USB build first.

## Verification and recovery

### HTTP, TLS and release-selection repair (1.3.5)

The first live release check on 1.2.2 hit an allocation assertion in ESP-IDF's
`http_utils_append_string` while processing GitHub response headers. The repaired
updater uses `esp_tls` with a fixed-size streaming header parser. Unneeded header
values are discarded as they arrive; header storage never grows with a server's
Content-Security-Policy. Total headers are limited to 64 KiB and redirect URLs to
2,047 bytes. Redirect hosts, HTTPS certificates/hostnames, firmware size, target
chip, and SHA-256 remain checked. Release assets must use Content-Length and
identity encoding; unsupported framing or incomplete responses fail without
activating a partial image. Manifest and download stack frames are separate.

Lamps on the faulty 1.2.2 updater need one local web firmware upload to receive
this repair before using online discovery. Existing Wi-Fi credentials, colors,
and strip settings are retained. Version 1.3.0 remains a prerelease after its
failed discovery test. A local 1.3.1 repair image is used as the baseline for the
1.3.5 end-to-end OTA test. Version 1.3.2 fixed header allocation but still lacked
enough RAM for the asset server's RSA certificate verification.

The canonical build script now wraps `esp_wifi_init` to configure smaller Wi-Fi
buffer pools: two static RX buffers, eight dynamic RX/TX buffers, a two-frame
receive block-ack window, two RX management buffers, and six short management
buffers. The Bluetooth controller is limited to two activities (advertising and
one phone connection), scanning is disabled, and unused scan caches use their
supported minimum sizes. Pairing, encryption, saved bonds and phone connections
remain enabled. This trades unused radio capacity for TLS memory while retaining
Bluetooth. Build with `tools/build-firmware.cjs`; a plain IDE build does not apply
the linker wrappers. The authenticated firmware status includes HTTP stage, host
category, response code and TLS error diagnostics, without signed URLs or secrets.

Version 1.3.3 used larger temporary buffers and also treated TLS WANT_READ as a
failed download. Reads and writes now retry WANT_READ/WANT_WRITE while yielding,
with a 30-second idle limit and a 180-second request limit. Other errors and EOF
still fail incomplete transfers; the active firmware remains selected. The
limits are checked between socket operations, which also have a 12-second timeout.
`tests/update-io.cpp` covers retries, EOF, fatal errors, both deadlines and timer
wraparound using the same helper as the live transport.

Version 1.3.4 still repeated a Latest lookup during installation. Hardware testing
observed an older manifest at that step after a newer version had been offered.
Discovery now uses a per-request cache-busting query and no-cache header.
Installation re-fetches the offered version's pinned manifest and requires the
version, size and SHA-256 to remain identical before downloading. A stale Latest
response cannot silently substitute an older release. Manifest tests reject
older/newer versions and changed sizes or hashes during this revalidation.

`tests/update-http.cpp` exercises the actual header parser using 48 KB ignored
headers, byte-at-a-time input, mixed-case field names, signed redirect URLs,
invalid/duplicate lengths, unsupported encodings and oversized input. Build/run
it with C++17 and address/undefined behavior sanitizers.

HTTPS certificates are verified using the ESP certificate bundle. Redirects are restricted to GitHub asset hosts, and internet time is required for TLS. There is no GitHub token on the lamp. The strict manifest permits only ESP32-C3, dual 2,031,616-byte OTA slots and a numerically newer version. Image size, chip/application headers and SHA-256 must pass before selecting the inactive slot for boot. Interrupted or invalid downloads never select the incomplete image. Manual uploads and online installs cannot run simultaneously.

Publisher trust comes from HTTPS and control of the GitHub repository. The manifest does not have a separate cryptographic signature: SHA-256 verifies integrity, not independent publisher identity. Protect the GitHub account and release permissions.

With a rollback-enabled bootloader, the new firmware stays pending until its main loop runs for 30 seconds. A reset before confirmation allows bootloader rollback. This is a basic startup check, not proof that every effect, radio or peripheral works. USB recovery and authenticated manual uploads remain available. Firmware rollback does not undo settings: preserve existing formats or add explicit migrations.

## Hardware validation still required

Build and mock tests do not prove on-device TLS memory availability, Bluetooth/Wi-Fi coexistence during downloads, power-loss recovery or boot rollback. Before fleet publication, install the baseline on a test lamp and exercise a newer image through a controlled release, including interrupted downloads, reconnection, saved-settings preservation and reset before boot confirmation.

Firmware 1.2.2 retains the DHCP-provided primary DNS server and fills an empty backup DNS slot with Cloudflare (1.1.1.1). A DHCP-provided backup is preserved. The authenticated /api/state response includes gateway and DNS addresses for diagnostics. This does not change the router, static IP configuration, HTTPS hostname checks, or certificate validation.

## 1.2.2 hardware check (2026-09-16)

The connected lamp retained its DHCP primary DNS (192.168.1.1) and gained the empty-slot fallback (1.1.1.1). This resolved the observed lookup failure. Testing then exposed TLS allocation failures. LED frame and heat buffers now scale to the saved strip length, the updater task is allocated before radio initialization, and task stacks are bounded at 8 KB (updater) and 4 KB (control loop). Allocation failure falls back to a one-pixel buffer without overwriting saved strip settings.

Initial HTTPS checks succeeded but rapid repeats exposed an RSA verification allocation failure. For github.com only, the certificate-bundle callback selects its supported ECDHE-ECDSA AES-GCM suites, keeping certificate-chain and hostname verification enabled. GitHub asset hosts retain the SDK default suites because they do not all support ECDSA. Three consecutive on-device checks then completed successfully with no USB TLS errors: roughly 62 KB free heap, 34–43 KB largest free block, 3 KB updater stack headroom and 1.6 KB control-loop stack headroom. These measurements apply to the installed strip configuration; larger strips and full downloads still need hardware validation. The authenticated firmware status includes memory diagnostics. Certificate verification remains enabled. No downloadable release or automatic installation was tested by these checks.
