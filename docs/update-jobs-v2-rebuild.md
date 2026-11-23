# Durable update jobs v2

Status: implementation contract for the updater replacement. This document does
not authorize a firmware release, lamp flash, bridge deployment, or TestFlight
submission.

## Decision and boundary

Replace the firmware-update orchestration while retaining the verified
cryptographic, artifact-validation, OTA-writing, boot-health, transport, and
bridge-cache primitives.

The legacy app updater remains available only for older firmware during the
migration. It must not gain new route-selection behavior. In particular, a
failed or uncertain Internet job must never silently become a phone Bluetooth
transfer.

The replacement follows a device-owned job model:

- The app chooses one route before mutation and creates one immutable job.
- A lamp owns an Internet job after durable acceptance.
- One explicitly selected bridge owns a targeted bridge job after durable
  acceptance.
- The owning device continues the job without the app.
- The app observes the durable job. Closing, backgrounding, reinstalling, or
  changing pages cannot cancel or restart device-owned work.
- Bluetooth is an explicit foreground service route. It is not an automatic
  fallback and is not counted as Internet or bridge success.

## Immutable identity

Every job is bound to this tuple:

```text
jobId       32 lowercase hexadecimal characters
targetId    canonical lamp identity
version     canonical firmware version
sha256      64 lowercase hexadecimal characters
size        exact image byte count
route       internet | targeted-bridge | phone-service
ownerId     canonical target identity for internet, selected bridge identity
            for bridge, phone installation identity for phone-service
```

Reusing `jobId` with the identical tuple is idempotent and returns the current
job. Reusing it with any different field is a conflict. The tuple cannot change
after acceptance.

The signed manifest remains authoritative. The job tuple is a fence around that
manifest, not an alternate source of trust.

## Authoritative state

A job contains one monotonic `revision` and one route-valid phase:

```text
accepted
downloading                 Internet
offering                    targeted bridge
transferring
installing
restarting
awaiting-verification       targeted bridge
verifying
succeeded        terminal
failed           terminal
cancelled        terminal
```

Internet jobs use `accepted`, `downloading`, `installing`, `restarting`, and
`verifying`. Targeted bridge jobs use `accepted`, `offering`, `transferring`, and
`awaiting-verification`. Phone-service jobs use only their declared foreground
phases. An owner may skip a route-valid phase, but may never move backward. A
reboot may repeat the same phase with a higher revision while recovering the
durable record.

Progress consists only of receiver-confirmed bytes:

```text
confirmedBytes
totalBytes
```

`totalBytes` is the immutable artifact size. `confirmedBytes` is monotonic and
never exceeds it. Indeterminate animation is allowed only before the owner knows
whether transfer has begun; it is not a fabricated percentage.

A terminal job includes a receipt that binds the job tuple, final revision, and
outcome. `succeeded` additionally requires the exact running version, size, and
digest plus the existing boot-health proof. A transfer reaching 100 percent is
not installation proof.

An error is data, not presentation state:

```text
code
message             bounded, diagnostic-safe text
```

Retry eligibility is derived from the terminal phase and `code`; the wire
contract does not carry a second boolean that could disagree with them.

Retrying creates a new job ID unless the original owner explicitly reports that
the same durable job is resumable. A timeout or lost mutation response is
`unknown`; it never authorizes replay.

## Owner APIs

The final paths may follow existing protected HTTP conventions, but their
semantics are fixed:

```text
POST   /api/update-jobs        create or return an idempotent job
GET    /api/update-jobs/{id}   read the exact job
POST   /api/update-jobs/{id}/cancel
```

All responses include the canonical owner and target identities, contract
version, immutable tuple, current revision, and phase. The app rejects a
response from a different target, owner, contract, job, or artifact.

Cancel is a request. It is terminal only after the owner returns a durable
`cancelled` receipt. Once boot selection may have occurred, the owner can refuse
cancel and the app continues observing the same job.

### Internet owner

The lamp persists acceptance before beginning network download. It fetches and
validates the exact signed artifact, writes the inactive image, records the
existing attempt fence, selects boot once, and proves the exact healthy running
image after restart.

The phone is not a data path. Lamp Wi-Fi association alone is not success.

### Bridge owner

The app explicitly selects one bridge and creates the job on that bridge. The
bridge persists the target and artifact, ensures its cache contains the exact
validated artifact, and starts a targeted donation session carrying the job
identity.

The lamp must accept that exact job from that exact bridge. Opportunistic donor
broadcast remains available for automatic policy, but cannot satisfy a manual
targeted bridge job. With two bridges, only the selected owner may advance the
job and only one receipt is authoritative.

The bridge records receiver acknowledgements and the lamp's terminal proof.
Bridge proximity is useful for RF performance but is not ownership selection.
After bridge restart, a partial transfer closes as interrupted, while a fully
receiver-confirmed transfer remains `awaiting-verification`; it is never sent
again or marked failed merely because the bridge lost radio contact, timed out,
or has not yet observed the lamp's boot proof. At the full-transfer boundary,
Finish or commit may already be in flight; those conditions are not exact
negative installation proof and cannot authorize failure or cancellation.
The selected bridge identity and target lamp identity must be distinct. Bridge
request validation enforces this now, and future lamp-side compatibility must
reject the same owner/target alias rather than accepting a self-donation. A
terminal installation proof names the observed target and a nonzero boot
session in addition to the exact healthy artifact; proof from another lamp is
never transferable even when both lamps run the same firmware.

### Phone service owner

Phone transfer is a separate, explicitly selected service workflow. It may use
the existing foreground BLE lease and resume constraints. iOS or Android
background suspension can interrupt it, so its UI must say that it requires the
app to stay open. It is never presented as a durable background job.

## App coordinator

The app stores one current projection per target lamp, keyed by canonical target
identity. The immutable `jobId` identifies the job represented by that
projection. The projection is not a second state machine; it is a cached copy of
the latest validated owner receipt.

Allowed local states are limited to:

```text
choosing-route
submitting
unknown-acceptance
observing
needs-attention
terminal
```

Only a currently running network request is called `submitting` or `observing`.
A persisted unresolved record is `needs-attention`, never `Checking` with an
unbounded progress bar. Every screen has a safe navigation exit.

The coordinator:

1. validates capabilities without mutation;
2. asks the user to select Internet, an eligible named bridge, or explicit phone
   service;
3. persists intent before the one create request;
4. accepts only the exact owner envelope;
5. polls/subscribes to that exact job;
6. resumes observation after app restart;
7. never changes route without ending the old job and obtaining a new user
   decision.

## Capability gate and migration

New orchestration is enabled only when both endpoints advertise the required
contract:

- Internet route: lamp update-job contract v2.
- Bridge route: selected bridge targeted-job contract v2 and compatible lamp
  receiver contract.
- Phone service: existing protected BLE capability, explicitly selected.

Unsupported lamps retain the legacy service workflow with clear limitations.
The new coordinator first runs in observer mode against capable firmware. The
legacy maps, feedback receipts, and route-owning `updateCardFirmware` path are
removed only after physical acceptance.

## Acceptance gates

Software tests are necessary but not sufficient. Before public use, retain the
exact artifact and receipts for these independent tests:

1. Internet-only: disable bridges and phone Bluetooth, accept the job, force
   close the app, and verify exact healthy installation on the lamp.
2. Bridge-only: block lamp Internet, disable phone Bluetooth, select a named
   bridge, force close the app, and verify exact healthy installation.
3. Two bridges: select each owner in turn and verify the other bridge cannot
   advance or claim the job.
4. Restart the app, router, bridge, and lamp at every phase, one at a time.
5. Lose every mutation response and verify no duplicate create, write, commit,
   or boot selection occurs.
6. Exercise bad signatures, wrong digest/size/target, storage failure, logical
   light off, cancellation boundaries, and rollback/health failure.
7. Verify every app state reaches confirmed progress, `needs-attention`, or a
   terminal receipt within a bounded time. No persisted uncertainty may render
   as live activity.

TestFlight availability, compilation, unit tests, a full progress bar, or a
reported transfer completion does not establish physical acceptance.
