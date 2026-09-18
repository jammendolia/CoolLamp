# Lamp-provided effect catalogs (firmware 1.4.1)

The app loads the selected lamp's catalog on every connection and discards it on
 disconnect. Names, IDs, categories, and speed support come from that lamp. It
 never uses another lamp's catalog. Favorites remain scoped to the saved lamp.

Catalog v1 is a JSON array of `{id, name, category, speed}` objects. IDs are
 contiguous 1..N (maximum 255, matching the control protocol); each lamp style
 owns its names and meanings. Keep existing IDs stable across firmware updates
 and append new effects, so saved defaults, colors, and favorites retain meaning.
 Categories are `calm`, `fire`, or `color`; unknown categories remain visible in
 All and search. `speed` is a boolean indicating whether its speed control applies.
 Names must be nonempty, at most 96 UTF-8 bytes, with no control characters.

## Wi-Fi

Authenticated `/api/state` advertises `catalogVersion: 1` and retains the legacy
 `effects` names array for the setup page and older apps. Authenticated GET
 `/api/effects` returns the catalog. The app refreshes metadata when the boot
 token changes. Older Wi-Fi firmware's supplied names remain authoritative;
 known names get compatibility metadata and unknown names remain usable.

## Bluetooth

State capability bit 32 advertises catalog support. Operation 12, value 3 opts
 into the lamp's full catalog. For each index 1..state.effectCount, the app sends
 operation 13 with that index, waits for its acknowledgment, then reads encrypted
 characteristic `7b610007-6e2b-4f3d-9a71-28e45c001001`. It contains one JSON entry,
 below the 512-byte GATT attribute limit; native reads handle ATT fragmentation.
 Rows are prepared on the Arduino loop, not a Bluetooth callback. Requests are
 serialized and never replayed after uncertain delivery. Invalid or interrupted
 enumeration fails the connection rather than showing an incorrect effect list.

Old Bluetooth apps retain the 29/37-effect compatibility views. Earlier extended
 clients can request value 2 for 38 effects. Old firmware without a catalog uses
 the app's compatibility names limited to the effect count it actually reports.
 Adding effects to catalog-capable firmware requires no app update as long as
 they use the existing control protocol and metadata fields.

Firmware 1.4.1 also adds Bouncing droplets - falling, physical-direction names,
 and migration of the previous 37 saved color/option slots into the 38-slot layout.
