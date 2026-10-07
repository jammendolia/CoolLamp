# Windows development

The source migration checkpoint is `617c8b1` on
`checkpoint/windows-migration-2026-10-06`. The checkout was clean before Windows
work began. The Mac's ignored `.build` logs, prototype binaries and caches were
not copied; the user confirmed they remain on the Mac. Keep those as historical
evidence. Fresh Windows evidence is stored in the local ignored `.build` folder.

## Toolchain

Verified on this computer: Node 22.19.0, Python 3.12.10, bundled Arduino CLI
1.5.1, ESP32 core 3.3.11, FastLED 3.10.5, ESP32RotaryEncoder 1.2.0 and Windows
tar. CI retains its existing Arduino CLI 1.3.1 pin. Installed pnpm is 11.25.0;
mobile CI pins 11.19.0. No mobile dependency reinstall or app rebuild was needed
for this firmware task. Future iOS builds use the existing macOS CI workflows.

USB diagnostics use a local Python virtual environment with pyserial 3.5:

```powershell
python -m venv .build/venv
.build/venv/Scripts/python.exe -m pip install -r tools/requirements-usb.txt
. ./tools/windows-env.ps1
python tools/audio-usb.py COM4 d --poll --poll-command d --seconds 15
node tools/build-firmware.cjs --public
node tools/package-firmware.cjs
```

Rediscover the COM port before use. Never overlap a reader and a flash tool.
The serial helper sets DTR true and RTS false before opening, without reset
pulses. Two live open/close cycles on COM4 preserved increasing uptime.

Native C++ host tests use portable w64devkit 2.9.1 extracted into
`.build/tooling/w64devkit`. Its official x64 release archive was verified against
GitHub's SHA-256:
`9208c19755cd4964b7915b9afcf02c66d493a4c870c4b3e83f6c538d9c1237a5`.
The environment script adds these tools only to the current shell's PATH.
Linux sanitizer coverage remains in the existing firmware CI workflow.

GitHub CLI's global active account is HiFin on this computer. **Never use that
account for any CoolLamp GitHub operation.** Select credentials explicitly with
`gh auth token --hostname github.com --user jammendolia` into a process-local
`GH_TOKEN`, verify `gh api user --jq .login` returns exactly `jammendolia`, and
stop if verification fails. Do not print the token or change the global account.
Use only the personal repository `jammendolia/CoolLamp`.

```powershell
. ./tools/windows-env.ps1
node --test tests/tls-library.test.cjs tests/firmware-release.test.cjs tests/factory-password.test.cjs
python tests/diagnostics.py
python tests/audio-usb.py
```

## Device and release boundaries

COM4 was verified as lamp `24eae26e9e9c`, 205 LEDs, midpoint 102, audio gain/gate/
scale 8/8/100, follower of `f0b950b2f180`, automatic installation disabled. Its
transferred diagnostic prototype reports firmware 1.9.4 and `tlsProbe` fields.
Fresh boot-check evidence recorded HTTP 200, no TLS errors and 13,160 bytes of
minimum free heap. This is prototype evidence, not production acceptance.

Windows HTTP requests to `192.168.1.220` timed out although USB diagnostics show
the lamp joined Wi-Fi. Group reception remains zero and is a separate issue.
Do not infer a router setting from these observations.

The full-flash backup is private: it includes saved credentials/bonds/settings.
Keep it under ignored `.build`, never upload it or attach it to a release.
The normal esptool stub reader failed at 688,128 bytes twice; use the ROM reader
(`--no-stub`) for this device's backup. Do not use a partial backup for recovery.

The ROM backup completed: 4,194,304 bytes, SHA-256
`f409f2c293ce367f91f957b3b22a2f5486f005bcc7aba6cf0450bb05f218c761`.
NVS occupies `0x9000..0xDFFF`, OTA metadata `0xE000..0xFFFF`, app0 starts
`0x10000`, and app1 starts `0x200000`; each application slot is `0x1F0000` bytes.

Firmware 1.9.5 is being prepared locally and has not been published. Report
production boot checks, manual checks under app polling, and full secure OTA
download/install as separate validation steps. Do not overwrite 1.9.4 or trigger
the old auto-publish branch. Use the manually dispatched draft-release workflow
for review. App 1.0 (26.1) is already in TestFlight; this work needs no app upload.

## Windows validation result — 2026-10-06

The current USB lamp now runs **production candidate 1.9.5**, replacing the
diagnostic prototype. Only app0 at `0x10000` was written, using the ROM writer;
esptool verified the written image hash. No GPIO or settings implementation was
changed. A subsequent NVS read showed all non-PHY records byte-identical to the
backup; only `phy/cal_data` calibration records differed. Live TX power remained
`[34,1]` (saved 8.5 dBm profile). LED count 205, midpoint 102, effect 4,
brightness 100, power on, audio 8/8/100, group follower/coordinator identity,
and automatic-install-disabled state all matched the pre-flash baseline.

The hardened helper built and reused its verified cache on Windows. ABI sizes
were context 552, config 196 and session 144 bytes, unchanged by the buffer
change. Both SDK buffers measured 16 KB; the replacement measured 16 KB receive
and 4 KB transmit. The final linker map selects replacement SSL objects and no
original SSL objects. `UpdateHttp.cpp` is unchanged from published 1.9.4; no
temporary cipher experiment or TLS diagnostic hooks entered production.

Both the baseline and candidate full Windows builds passed. Candidate compiler
usage: 1,821,972 bytes of program storage and 52,700 bytes of globals. Packaged
original USB-tested public application: **1,822,112 bytes**, SHA-256
`d8dc4b7d773118b5d0050ae3add647edd9a4e56b7f666d9ec3d0731b7050a41e`.
That tested image and manifest are now preserved in
`.build/firmware-before-local-off-fix/`. The newer candidate described below
occupies `firmware/public/CoolLamp.ino.bin` and its matching manifest.
The tested image fits the 2,031,616-byte OTA
slot and passed public-build/version/board/partition packaging checks.

The two-minute production capture returned 115 complete diagnostic samples,
with continuously increasing uptime and rendering. The scheduled secure update
check completed with HTTP 200, TLS/transport/error codes zero, and minimum heap
**9,364 bytes** while USB telemetry was polled every second and the existing
bounded audio diagnostic was exercised. Audio paused under updater resource
ownership as designed. The latest published version remained 1.9.4, so no
installation was offered. No `tlsProbe` fields were present. This is a successful
manifest-check test, not a full firmware-download or phone-polling test.

Passed host checks: four focused TLS tests, three firmware packaging tests,
saved-settings loader test, USB line-state test, HTTP diagnostic handler test,
Wi-Fi provisioning/Bluetooth/reset runtime tests, OTA HTTP/I/O/manifest C++
tests, and existing firmware page checks. Windows runtime tests omit unavailable
ASan/UBSan libraries; macOS/Linux retain those flags. The draft-release workflow
now includes the TLS and USB tests, but this local candidate has **not run in CI**.

Key evidence: `.build/windows-1.9.5-build.log`,
`.build/windows-1.9.5-flash.log`, `.build/windows-1.9.5-live.jsonl`,
`.build/windows-1.9.5-validation.log`, `.build/windows-nvs-comparison.json`,
`.build/windows-preflash-wifi.json`, `.build/windows-postflash-wifi.json`,
`.build/windows-final-host-tests.log`, and `.build/tls-library/*/build.json`.
The bounded validation scripts and private backup remain under `.build`.

Still outstanding: manual update checks while the phone app polls, full secure
OTA download/install, and firmware CI validation. Windows-to-lamp HTTP remains
unreachable. Group UDP reception is still zero and is a separate follow-up.
The Mac evidence remains on the Mac. No app build, GitHub write, commit, push,
tag, draft release, or firmware publication was performed in this continuation;
the working changes remain local for review. Personal-authenticated release
inspection confirmed `firmware-v1.9.4` is still Latest.

## Unpublished candidate update: local off during a group connection gap

The user reported BACL turning itself on later after a local button/app off,
returning to the group effect. A host regression confirmed that local off while
not actively following left a configured follower eligible to rejoin. The
focused LampControl.ino fix pauses grouping for a valid local off even during a
connection gap. Control and actual sync-service regressions passed, including
rejection of a signed handshake while paused; invalid commands and coordinator
power handling retain their behavior. No GPIO or saved setting was changed.

The new public 1.9.5 candidate built and packaged successfully: 1,822,144 bytes,
SHA-256 89069b21848ee1480d212c11f09f02b51419d751a5a13a073efe30aee3a6c81e.
Its matching manifest is in firmware/public. No diagnostic hooks were found in
the production map. Build log: .build/power-off-production-build.log.
The previous USB-tested candidate and manifest are preserved under
.build/firmware-before-local-off-fix for recovery. The new candidate has not
been installed on a lamp, run through CI, or published. USB/device validation
is pending because BACL is not currently responding at its saved LAN address
and no USB device was connected when checked.

A reboot remains another possible explanation for the reported event: startup
power defaults on and group pause is volatile. Read uptime/reset information
before flashing if possible; do not claim the historical event was conclusively
diagnosed or that this reconnect fix preserves off across a restart.
