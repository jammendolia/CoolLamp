# Physical lamp design and optional effect recommendations

Physical design is chosen by the user in Settings → Overview → Lamp design.
The choices are Not specified, Helix, Large helix and Corkscrew. LED count,
name, microphone, GPIO wiring and saved effect settings do not determine the
classification. The two helix sizes share the `helix` effect family. Each
lamp card uses a corresponding illustration.

The Light page offers **All effects** (the default) and **For this style**.
The latter shows recommended effects from the selected lamp's own catalog;
it does not replace that catalog or change effect IDs, order, the running
effect or group rendering. Recommendations are suggestions, not compatibility
restrictions. Unknown future effects remain available in All effects. An
unspecified design leaves the catalog unfiltered. The initial recommendations
use reviewed effect names rather than numerical IDs; future firmware may
provide explicit per-entry `styles` metadata.

Firmware 1.10.1 stores the selected design as a separate typed NVS value in
`coollamp/lampStyle`. Its descriptor is `{version:1,code,id,family}` with codes
0 unspecified, 1 helix, 2 large-helix, 3 corkscrew. State and diagnostics report
it, and authenticated HTTP `POST /api/style` or bonded/encrypted Bluetooth
control endpoint 25 saves it on the Arduino loop. Update, setup and reset guards
apply. A follower may change its physical design without leaving its group.
The save acknowledges only successful persistence, requires no reboot and
does not change the existing LampSettings record or group wire format.
Physical design survives factory reset alongside the existing hardware
settings. A separate checksummed recovery snapshot protects it across reset
interruption while retaining compatibility with the original pending record.

On older firmware, design selection is saved on this phone only, associated
with the identity-verified canonical lamp ID. The interface states that scope.
A non-unspecified design reported by the lamp takes priority over the phone
fallback. After upgrading, a phone choice remains phone-only until explicitly
saved onto the lamp. Firmware reads reuse the existing bounded asynchronous
fleet diagnostics requests; style metadata does not add another polling loop.
Late identity/connection results cannot classify another lamp or replay a save.

The metadata and local firmware getter prepare future effects to use physical
design. Current standalone and coordinated renderers retain their existing
behavior. Public OTA remains 1.9.6; 1.10.x candidates need the pending physical
ESP-NOW/Bluetooth acceptance test on CoolLamp 1 and CoolLamp 2 before publication.

Validation: 263 mobile tests, the production app build, 11 mocked style UI
scenarios and 10 group-shortcut scenarios pass. Firmware host tests exercise
typed storage and restart, invalid/corrupt metadata, failed persistence,
authenticated HTTP and shared Bluetooth handlers, follower/update/setup/reset
guards, and all 43 simulated durable reset interruption boundaries. The
worst-case protected control snapshot is 5,998 bytes, within the existing
8,192-byte reply limit. These checks do not replace phone or physical lamp
acceptance testing.
