# App connection broker

The app selects a connection for a canonical lamp identity through one broker.
Ordinary lamp controls, settings recovery, group acquisition and card power use
the same order: an authorized mesh gateway, direct Wi-Fi, then saved Bluetooth.
A healthy verified connection is reused. Explicit Bluetooth setup and bounded
onboarding probes can request a particular transport.

The phone still needs Wi-Fi or Bluetooth to reach a gateway. ESP-NOW is the
lamp-to-lamp leg; this app change does not give the phone an ESP-NOW radio, alter
firmware routing, elect group coordinators or change group membership.

## Ownership and fallback

Each route attempt has a deadline, child abort signal, selection guard and exact
identity verification. The broker releases rejected or late leases. Foreground
connections adopt the transport's own epoch scope; pooled group leases retain
their broker scope until the final owner releases them. A discovery timeout
retires only its own reference when a group has acquired that same connection.

Fallback is connection acquisition only. Known state/catalog GET acquisition
failures can use another route, including an uncertain read. Authorization and
identity refusals, cancellation, resource refusals and unclassified uncertainty
are terminal. Provisioning and control commands retain their existing receipt
rules: an uncertain write is never repeated through another connection.

## Confirmed state and reachability

Fresh foreground reads and acquired group reads feed the same safe broker
projection and Groups observation. The projection omits credentials, tokens,
invitations and private group keys. Merely opening an existing connection does
not make an old state snapshot fresh. Old selection observations cannot replace
a newer selection's record.

Mesh routes are session observations with a 15-second expiry, gateway and target
boot hints, gateway epoch and hop count. Multiple gateway observations coexist.
Advertisements rank already authorized gateway candidates; they do not authorize
an unknown gateway or create ownership. Persisted online/hop/route fields are
removed from phone records, while names, rooms, styles and credentials remain.

The app quietly reads `/api/mesh/status` every eight seconds through its current
verified gateway while visible and idle. It opens no extra connection or pairing
dialog. Exact owner, epoch, identity and firmware-generation guards discard late
results. Existing onboarding and mesh acquisition reads also refresh the route
inventory. Hidden apps, unavailable gateways and disconnected lamps may therefore
have expired observations until a new authenticated read succeeds.

## Provisioning after validation

Factory resetting the lamps can provide a useful reproducible test household,
after this app has been tested against the current lamps. It is not a connection
fix by itself: it also removes Wi-Fi, ownership, names and group configuration.

For each future USB session, identify and back up that physical lamp, confirm its
style and measured LED count, then install the selected initial firmware/profile
and verify a complete power cycle before moving to the next lamp. Keep the
recorded current budgets and wiring. Sonata's known profile is 128 LEDs, GPIO0,
500 mA, microphone installed, whole-strip motion and no middle split. Other
designs need their own saved measurements. No lamp reset, firmware installation,
partition change or automatic app-data wipe is part of this app-only change.

## Validation boundary

Node integration tests exercise the real broker, production app handlers,
transport receipt/error handling, route freshness and simulated native peers.
The web build and iOS synchronization check packaging. Physical iPhone radio
handoffs and the two Sonata lamps still require an owner-observed test; successful
software tests alone do not prove RF reliability or repair an obstructed antenna.
