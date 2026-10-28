# Confirmed group-member removal — 28 October 2026

The group effects editor's offline **Remove** button previously filtered the
saved order and submitted it to the ordinary reorder endpoint. Protocol v3
deliberately rejects membership-count changes through that endpoint, so the
button could not remove a member. Reordering and confirmed departure now use
their separate existing firmware contracts.

## Resulting behavior

`Groups.removeMember(source, target, {expectedIncarnation})` checks a fresh,
identity-verified coordinator against the group the user reviewed. It requires
the advertised confirmed-removal capability and a valid nonzero session, then
saves an incarnation-bound removal intent on the phone before contacting the
target. It confirms the target's saved independent or moved state before
pruning its old coordinator position with the exact current order/session.

An offline or unconfirmed departure remains pending without authorizing a
prune. The editor shows that pending state and retains an explicit **Retry
removal** action when the target comes online. Generic reconciliation remains
read-only for a target that still follows the group; it does not silently
repeat a departure command. Uncertain writes keep the existing fresh-read,
identity, epoch, authorization and receipt protections.

Pending does not always mean the position still exists: a confirmed prune can
precede a failed phone-storage clear or final readback. Feedback therefore says
confirmation is still needed, with specific storage, changed-group and
authorization advice where available. It does not claim completed removal or
unconditionally claim that the position was kept.

The button captures its rendered editor and group incarnation, preventing a
retained button from operating a different or recreated group. The service runs
outside the editor's serialized queue to avoid nested-queue deadlock. Source
and target setup/update locks, busy actions and membership fences remain in
place. Older firmware without the confirmed-removal contract gets a disabled
button with update guidance; arrows still reorder the same membership.

For the last confirmed follower, the new path can stop a protocol-v3
coordinator only after fresh self-only membership and the existing firmware
count guard. Supported protocol-v2 coordinators remain running after pruning:
v2 lacks that atomic count guard, so automatic stop could race a new join.
Other unresolved removal intents are retained. Existing leave/move/group
dissolution cleanup behavior is unchanged outside the new strict path.

## Validation and preserved work

- **89 focused tests:** 75 group-service tests and 14 tests exercising the
  production renderer, removal handler and serialized queue.
- **2,003/2,003 mobile tests pass.** Two existing catalog tests were updated
  to read the authoritative `LampEffectRegistry.h` through a shared test-only
  fixture, replacing their obsolete `LampNetwork.ino` table lookup. They still
  verify actual names/IDs, the legacy fallback and style recommendations.
- The production Vite bundle builds into the isolated
  `.build/group-offline-removal-20261028/app-build-final/` directory. The
  existing large-chunk warning remains.
- New regressions fail against the frozen pre-fix implementation. Coverage
  includes persistence before departure, offline/restarted retries, stale
  incarnation/session/editor state, authorization, storage and capability
  failures, an already-moved target, other pending members, last-follower
  cleanup and the v2 concurrent-join boundary.
- Independent source review passes. Evidence, logs and the before-worktree
  manifest are under `.build/group-offline-removal-20261028/`.

Only mobile application code, tests and this note changed. Firmware, all native
effects, package assets, partitions, release artifacts and the other existing
work remain untouched. No lamp settings or memberships were changed on devices;
no phone installation, firmware flashing, signing or publication occurred.

Real-phone and physical fleet validation remain outstanding. This repairs the
specific offline-member removal mismatch; it is not acceptance of all group
reliability, reconnect or app-simplification work.
