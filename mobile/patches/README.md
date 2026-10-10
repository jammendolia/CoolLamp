# Bluetooth SDK readiness patch

`@capacitor-community/bluetooth-le` is pinned to **8.3.0**. Its iOS
`writeWithoutResponse` previously submitted immediately even when CoreBluetooth
could not accept another write. The version-specific pnpm patch makes the existing
SDK operation wait for `canSendWriteWithoutResponse` and the peripheral readiness
delegate callback. It uses the SDK's existing connection and main queue.

One pending operation owns the gate. The caller's positive finite timeout is
honored up to a 60-second bound; disconnect, cancelled/replaced connection, or
peripheral replacement rejects it. Cancelled timers and delayed callbacks cannot
remove a newer pending operation. Characteristics must advertise writes without
response, and frames must fit the negotiated maximum length.

A successful native call means **submitted to CoreBluetooth**, not written to
flash. CoolLamp's sender still limits the window to four sequential data frames
and requires the firmware's exact written-offset acknowledgement before continuing.
Other firmware-update operations use writes with response. Older receivers and
platforms keep the existing path.

`pnpm install --frozen-lockfile` applies the patch reproducibly. The app's SwiftPM
package points to this installed local dependency, so the signed iOS build compiles
the patched SDK source. The iOS workflow also compiles and runs the real gate with
`ios/tests/bluetooth-write-gate/main.swift` before building the app.

When upgrading the SDK, port and validate this patch before enabling the fast
sender with the replacement version. Do not manually edit the shared pnpm store
or installed `node_modules` files.
