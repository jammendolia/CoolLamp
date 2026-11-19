import test from 'node:test';
import assert from 'node:assert/strict';
import { compileLegacyMigrationProposalV1 } from '../src/home-migration.js';
import { homeMigrationV1Fixture } from './fixtures/home-migration-v1.js';

const NOW = '2026-11-17T16:03:00Z';
const copy = value => structuredClone(value);
const compile = value => compileLegacyMigrationProposalV1(value, { now: NOW });

function everyObjectFrozen(value) {
  if (!value || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(everyObjectFrozen);
}

test('the existing-Home compiler produces a review proposal, never a Home snapshot or mutation plan', () => {
  const proposal = compile(copy(homeMigrationV1Fixture));
  assert.equal(proposal.kind, 'legacy-home-migration-proposal');
  assert.equal(proposal.disposition, 'review-required');
  assert.deepEqual(proposal.destinationHome, {
    id: 'home.primary',
    name: 'Primary home',
    status: 'requested-unverified'
  });
  assert.equal(proposal.summary.devices, 6);
  assert.equal(proposal.summary.groups, 1);
  assert.equal(proposal.summary.savedLooks, 1);
  assert.equal('authority' in proposal, false);
  assert.equal('grants' in proposal, false);
  assert.equal('mutations' in proposal, false);
  assert.equal('canCommit' in proposal, false);
});

test('canonical lamp identity comes only from the 12-hex record id, not native Bluetooth identity', () => {
  const proposal = compile(copy(homeMigrationV1Fixture));
  const edison = proposal.candidates.devices.find(device => device.canonicalDeviceId === 'a10000000001');
  const porch = proposal.candidates.devices.find(device => device.proposedName === 'Porch lamp');
  assert(edison);
  assert.equal(edison.sourceRefs.filter(ref => ref.includes(':lamp:')).length, 2);
  assert.equal(porch.canonicalDeviceId, null);
  assert.equal(porch.identity, 'needs-check');
  assert.equal(porch.binding, 'proof-required');
});

test('routing, discovery, fleet, and private fields never enter the proposal', () => {
  const text = JSON.stringify(compile(copy(homeMigrationV1Fixture)));
  for (const forbidden of [
    '192.0.2.41', 'edison.local', 'native-edison-accessory',
    'must-never-leave-the-collector', 'legacy-route-1', 'legacy-fleet'
  ]) assert.equal(text.includes(forbidden), false, forbidden);
  assert.match(text, /routing-or-private-evidence/);
});

test('same names never merge different products and are presented as a rename choice', () => {
  const proposal = compile(copy(homeMigrationV1Fixture));
  const helixes = proposal.candidates.devices.filter(device => device.proposedName === 'Helix');
  assert.equal(helixes.length, 2);
  assert.notEqual(helixes[0].canonicalDeviceId, helixes[1].canonicalDeviceId);
  const conflict = proposal.conflicts.find(row => row.code === 'duplicate-product-name');
  assert.deepEqual(conflict.choices, ['Keep both names', 'Rename a product']);
  assert.equal(conflict.blocks, false);
});

test('conflicting Rooms remain choices and the My home fallback does not become a Room', () => {
  const proposal = compile(copy(homeMigrationV1Fixture));
  const edison = proposal.candidates.devices.find(device => device.proposedName === 'Edison');
  assert.deepEqual(edison.roomCandidates.map(value => value.value), ['Living room', 'Office']);
  assert.equal(edison.proposedRoomCandidateId, null);
  assert.equal(proposal.candidates.rooms.some(room => room.name === 'My home'), false);
  assert.deepEqual(proposal.conflicts.find(row => row.code === 'product-room').choices, [
    'Living room', 'Office', 'Not assigned yet'
  ]);
});

test('case-only Room spelling merges safely into one proposal-local Room', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[1].lampRecords.push({
    id: 'a10000000002',
    name: 'Helix',
    room: 'living room',
    identityConfirmed: false
  });
  fixture.sources[1].appPreferences.rooms.a10000000002 = 'LIVING ROOM';
  const proposal = compile(fixture);
  const helix = proposal.candidates.devices.find(device => device.canonicalDeviceId === 'a10000000002');
  assert.equal(helix.roomCandidates.length, 1);
  assert(helix.proposedRoomCandidateId);
  assert.equal(proposal.candidates.rooms.filter(room => room.name.toLowerCase() === 'living room').length, 1);
});

test('phone preference keys cannot create products without a matching lamp record in that source', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[1].appPreferences.rooms.d10000000009 = 'Garage';
  fixture.sources[1].appPreferences.groups.d10000000009 = 'Garage lights';
  const proposal = compile(fixture);
  assert.equal(proposal.candidates.devices.some(device => device.canonicalDeviceId === 'd10000000009'), false);
  assert.equal(proposal.candidates.groups.some(group => group.proposedName === 'Garage lights'), false);
});

test('a coordinator-keyed group becomes a proposal-local group and preserves physical participation', () => {
  const proposal = compile(copy(homeMigrationV1Fixture));
  const group = proposal.candidates.groups[0];
  assert.equal(group.candidateId, 'group-candidate.001');
  assert.equal(group.proposedName, 'Evening lights');
  assert.deepEqual(group.members.map(member => member.participation).sort(), ['paused', 'playing', 'separate']);
  const edisonCandidate = proposal.candidates.devices.find(device => device.proposedName === 'Edison').candidateId;
  assert.equal(group.members.find(member => member.deviceCandidateId === edisonCandidate).participation, 'separate');
  assert.equal(group.disposition, 'preserve');
});

test('last-seen group membership remains unknown until a fresh product check', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[0].groupSnapshot.groups[0].followers[0] = {
    id: 'a10000000001',
    verified: false,
    lastSeenMembership: true,
    sync: { active: false, paused: true }
  };
  const member = compile(fixture).candidates.groups[0].members.find(row => row.deviceCandidateId === 'device-candidate.001');
  assert.deepEqual(member, {
    deviceCandidateId: 'device-candidate.001',
    participation: 'unknown',
    evidence: 'last-seen'
  });
});

test('a verified group row with no explicit participation remains unknown', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[0].groupSnapshot.groups[0].followers[0] = {
    id: 'a10000000001',
    verified: true,
    sync: {}
  };
  const member = compile(fixture).candidates.groups[0].members.find(row => row.deviceCandidateId === 'device-candidate.001');
  assert.equal(member.participation, 'unknown');
});

test('unknown saved group members stay visible as a blocking product-match issue', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[0].groupSnapshot.groups[0].followers.push({
    id: 'd10000000009',
    verified: true,
    sync: { active: true, paused: false }
  });
  const proposal = compile(fixture);
  const group = proposal.candidates.groups[0];
  assert.equal(group.disposition, 'review-required');
  assert(group.issues.some(value => value.code === 'member-needs-identification'));
  assert(proposal.conflicts.some(value => value.code === 'group-product-match' && value.blocks));
});

test('stale or malformed group evidence stays visible but cannot be preserved silently', () => {
  const staleFixture = copy(homeMigrationV1Fixture);
  staleFixture.sources[0].capturedAt = '2026-11-17T15:00:00Z';
  const staleProposal = compile(staleFixture);
  const staleGroup = staleProposal.candidates.groups[0];
  assert.equal(staleGroup.disposition, 'review-required');
  assert(staleGroup.issues.some(value => value.code === 'membership-needs-check'));
  assert(staleProposal.conflicts.some(value => value.code === 'group-evidence' && value.blocks));

  const malformedFixture = copy(homeMigrationV1Fixture);
  malformedFixture.sources[0].groupSnapshot.groups[0].followers.push(null);
  const malformedProposal = compile(malformedFixture);
  const malformedGroup = malformedProposal.candidates.groups[0];
  assert.equal(malformedGroup.disposition, 'review-required');
  assert(malformedGroup.issues.some(value => value.code === 'membership-needs-check'));
});

test('pending group removal is surfaced for review and never replayed', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[0].groupRemovalIntents.sources.push({
    source: 'a10000000002',
    targets: ['a10000000001'],
    dissolve: false,
    incarnation: '2'
  });
  const proposal = compile(fixture);
  assert.equal(proposal.candidates.groups[0].disposition, 'review-required');
  assert(proposal.conflicts.some(row => row.code === 'group-pending-change'));
  const text = JSON.stringify(proposal);
  assert.equal(text.includes('remove-member'), false);
  assert.equal(text.includes('a10000000001\",\"dissolve'), false);
});

test('saved looks retain exact device-scoped appearance and never become Scenes', () => {
  const proposal = compile(copy(homeMigrationV1Fixture));
  assert.equal('scenes' in proposal.candidates, false);
  assert.deepEqual(proposal.candidates.savedLooks[0], {
    candidateId: 'look-candidate.001',
    legacyId: 'warm-evening',
    deviceCandidateId: 'device-candidate.001',
    disposition: 'device-scoped-look',
    name: 'Warm evening',
    effect: { localId: 4, name: 'Fire', key: 'fire' },
    appearance: {
      brightness: 144,
      color: [0, 255, 132, 48],
      options: [60, 20, 0, 128, 90, 30]
    },
    issues: [],
    sourceRefs: ['phone.joe:look:0']
  });
});

test('an orphaned saved look remains visible and needs a product match', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[0].savedLooksEnvelope.looks[0].lampId = 'd10000000009';
  const look = compile(fixture).candidates.savedLooks[0];
  assert.equal(look.deviceCandidateId, null);
  assert.equal(look.issues[0].code, 'device-needs-match');
});

test('duplicate saved-look records dedupe exactly and conflict when their appearance differs', () => {
  const exactFixture = copy(homeMigrationV1Fixture);
  exactFixture.sources[1].savedLooksEnvelope.looks.push(copy(exactFixture.sources[0].savedLooksEnvelope.looks[0]));
  const exactProposal = compile(exactFixture);
  assert.equal(exactProposal.candidates.savedLooks.length, 1);
  assert.deepEqual(exactProposal.candidates.savedLooks[0].sourceRefs, ['phone.joe:look:0', 'phone.lisa:look:0']);

  const conflictFixture = copy(exactFixture);
  conflictFixture.sources[1].savedLooksEnvelope.looks[0].appearance.brightness = 99;
  const conflictProposal = compile(conflictFixture);
  assert.equal(conflictProposal.candidates.savedLooks.length, 2);
  assert(conflictProposal.candidates.savedLooks.every(look => look.issues.some(value => value.code === 'saved-look-conflict')));
  assert(conflictProposal.conflicts.some(value => value.code === 'saved-look-version' && value.blocks));
});

test('bridges remain products and cannot appoint themselves as Home services', () => {
  const proposal = compile(copy(homeMigrationV1Fixture));
  const bridge = proposal.candidates.devices.find(device => device.productKind === 'bridge');
  assert(bridge);
  assert.equal(bridge.binding, 'proof-required');
  assert.deepEqual(bridge.audioInput, {
    installed: false,
    availability: 'unconfirmed',
    basis: 'controller-default'
  });
  assert.equal(proposal.candidates.services.some(service => service.kind === 'bridge' || service.kind === 'home-authority'), false);
  assert.equal(proposal.candidates.services.length, 0);
});

test('microphone migration follows product provisioning defaults without guessing availability', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[0].lampRecords[0].microphoneInstalled = false;
  fixture.sources[0].bridgeRecords[0].microphoneInstalled = true;
  const proposal = compile(fixture);
  const edison = proposal.candidates.devices.find(device => device.proposedName === 'Edison');
  const bridge = proposal.candidates.devices.find(device => device.productKind === 'bridge');
  assert.deepEqual(edison.audioInput, { installed: false, availability: 'unconfirmed', basis: 'explicit-exception' });
  assert.deepEqual(bridge.audioInput, { installed: true, availability: 'unconfirmed', basis: 'explicit-provisioning' });
});

test('an unmatched CoolLamp still honors an explicit microphone exception', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[0].lampRecords[3].microphoneInstalled = false;
  const porch = compile(fixture).candidates.devices.find(device => device.proposedName === 'Porch lamp');
  assert.deepEqual(porch.audioInput, { installed: false, availability: 'unconfirmed', basis: 'explicit-exception' });
});

test('verified CoolStrip geometry, matrix layout, padding, and specialized schedule remain exact candidates', () => {
  const proposal = compile(copy(homeMigrationV1Fixture));
  const config = proposal.candidates.stripConfigurations[0];
  assert.deepEqual(config.geometry, {
    top: 47, right: 90, bottom: 47, left: 90,
    pixels: 274, startCorner: 'top-left', direction: 'clockwise'
  });
  assert.deepEqual(config.matrix.padding, { top: 2, right: 3, bottom: 2, left: 3 });
  assert.equal(proposal.candidates.schedules[0].pattern, 'sunset-until-midnight');
  assert.equal(proposal.candidates.schedules[0].disposition, 'review-required');
  assert.equal(proposal.candidates.services.length, 0);
  assert(proposal.candidates.schedules[0].issues.some(value => value.code === 'executor-unassigned'));
});

test('an absent matrix remains absent and an unverified read cannot import geometry', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.coolStripSnapshots[0].matrix = null;
  assert.equal(compile(fixture).candidates.stripConfigurations[0].matrix, null);
  fixture.coolStripSnapshots[0].verifiedRead = false;
  const config = compile(fixture).candidates.stripConfigurations[0];
  assert.equal(config.geometry, null);
  assert.equal(config.matrix, null);
  assert.equal(config.disposition, 'review-required');
  assert(config.issues.some(value => value.code === 'verified-read-needed'));
});

test('a strip layout cannot be preserved without a matched controller and complete outputs', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.coolStripSnapshots[0].controllerId = 'not-a-controller-id';
  fixture.coolStripSnapshots[0].outputs = [
    { kind: 'perimeter', pixelCount: 0 },
    { kind: 'unknown', pixelCount: 274 }
  ];
  const config = compile(fixture).candidates.stripConfigurations[0];
  assert.equal(config.hostDeviceCandidateId, null);
  assert.equal(config.disposition, 'review-required');
  assert(config.issues.some(value => value.code === 'controller-needs-match'));
  assert(config.issues.some(value => value.code === 'outputs-need-check'));
});

test('same-controller strip evidence dedupes exactly and conflicting layouts or schedules block review', () => {
  const exactFixture = copy(homeMigrationV1Fixture);
  const duplicate = copy(exactFixture.coolStripSnapshots[0]);
  duplicate.sourceId = 'front-window-backup';
  exactFixture.coolStripSnapshots.push(duplicate);
  const exactProposal = compile(exactFixture);
  assert.equal(exactProposal.candidates.stripConfigurations.length, 1);
  assert.equal(exactProposal.candidates.stripConfigurations[0].sourceRefs.length, 2);
  assert.equal(exactProposal.candidates.schedules.length, 1);
  assert.equal(exactProposal.candidates.schedules[0].sourceRefs.length, 2);

  const conflictFixture = copy(exactFixture);
  conflictFixture.coolStripSnapshots[1].geometry.top += 1;
  conflictFixture.coolStripSnapshots[1].schedule.automatic = false;
  const conflictProposal = compile(conflictFixture);
  assert.equal(conflictProposal.candidates.stripConfigurations.length, 2);
  assert(conflictProposal.candidates.stripConfigurations.every(row => row.disposition === 'review-required'));
  assert(conflictProposal.conflicts.some(value => value.code === 'strip-configuration' && value.blocks));
  assert.equal(conflictProposal.candidates.schedules.length, 2);
  assert(conflictProposal.conflicts.some(value => value.code === 'schedule-evidence' && value.blocks));
});

test('the presentation-only local Home never proves ownership, access, or a device binding', () => {
  const proposal = compile(copy(homeMigrationV1Fixture));
  assert.equal(JSON.stringify(proposal).includes('local-home'), false);
  assert(proposal.candidates.devices.every(device => device.binding === 'proof-required'));
  assert.equal('people' in proposal.candidates, false);
  assert.equal('memberships' in proposal.candidates, false);
});

test('unscoped legacy Home flags cannot suppress destination-Home checks', () => {
  const proposal = compile(copy(homeMigrationV1Fixture));
  for (const device of proposal.candidates.devices.filter(device => device.canonicalDeviceId)) {
    assert(device.issues.some(value => value.code === 'home-needs-check'));
  }
});

test('invalid source headers cannot confirm identity or import a CoolStrip layout or executor', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[0].capturedAt = 'not-a-time';
  fixture.coolStripSnapshots[0].capturedAt = 'not-a-time';
  const proposal = compile(fixture);
  const edison = proposal.candidates.devices.find(device => device.canonicalDeviceId === 'a10000000001');
  assert.equal(edison.identity, 'needs-check');
  assert.equal(proposal.candidates.stripConfigurations[0].geometry, null);
  assert.equal(proposal.candidates.services.length, 0);
  assert(proposal.sourceErrors.some(value => value.code === 'invalid-source-header'));
  assert(proposal.sourceErrors.some(value => value.code === 'invalid-strip-snapshot'));
});

test('stale but structurally valid captures cannot confirm live state or preserve a strip layout', () => {
  const fixture = copy(homeMigrationV1Fixture);
  for (const source of fixture.sources) source.capturedAt = '2026-11-17T15:00:00Z';
  fixture.coolStripSnapshots[0].capturedAt = '2026-11-17T15:00:00Z';

  const proposal = compile(fixture);
  const edison = proposal.candidates.devices.find(device => device.canonicalDeviceId === 'a10000000001');
  const group = proposal.candidates.groups[0];
  const strip = proposal.candidates.stripConfigurations[0];
  const schedule = proposal.candidates.schedules[0];

  assert.equal(edison.identity, 'needs-check');
  assert.equal(edison.reachability, 'unknown');
  assert.equal(group.disposition, 'review-required');
  assert(group.issues.some(value => value.code === 'membership-needs-check'));
  assert.equal(strip.geometry, null);
  assert.equal(strip.matrix, null);
  assert.equal(strip.disposition, 'review-required');
  assert(schedule.issues.some(value => value.code === 'controller-check'));
  assert(proposal.sourceErrors.some(value => value.code === 'stale-source'));
  assert(proposal.sourceErrors.some(value => value.code === 'stale-strip-snapshot'));
});

test('the proposal is deterministic across source ordering, detached, deeply frozen, and leaves input unchanged', () => {
  const input = copy(homeMigrationV1Fixture);
  const before = JSON.stringify(input);
  const first = compile(input);
  const reordered = copy(homeMigrationV1Fixture);
  reordered.sources.reverse();
  reordered.coolStripSnapshots.reverse();
  const second = compile(reordered);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(input), before);
  assert(everyObjectFrozen(first));
  input.destinationHome.name = 'Changed later';
  assert.equal(first.destinationHome.name, 'Primary home');
});

test('tied strip provenance remains deterministic when private evidence counts differ', () => {
  const base = {
    sourceId: 'same-strip-source',
    capturedAt: '2026-11-17T16:02:00Z',
    verifiedRead: false,
    controllerId: 'c10000000001',
    name: 'Window'
  };
  const fixture = {
    version: 1,
    destinationHome: { id: 'home.primary', name: 'Primary home' },
    sources: [],
    coolStripSnapshots: [
      { ...base, password: 'excluded' },
      { ...base, address: 'excluded', token: 'excluded' }
    ]
  };
  const first = compile(fixture);
  const secondFixture = copy(fixture);
  secondFixture.coolStripSnapshots.reverse();
  assert.equal(JSON.stringify(first), JSON.stringify(compile(secondFixture)));
});

test('ignored-evidence traversal is iterative and rejects excessive object complexity cleanly', () => {
  const input = depth => `{"version":1,"destinationHome":{"id":"home.primary","name":"Primary home"},"sources":[{"sourceId":"phone.deep","kind":"phone","capturedAt":"2026-11-17T16:02:00Z","junk":${'['.repeat(depth)}0${']'.repeat(depth)}}],"coolStripSnapshots":[]}`;
  const accepted = compileLegacyMigrationProposalV1(input(12000), { now: NOW });
  assert(accepted.sourceErrors.some(value => value.code === 'unsupported-source-field'));
  assert.throws(() => compileLegacyMigrationProposalV1(input(40000), { now: NOW }), /too complex/);
});

test('one malformed section is isolated without discarding valid products from that phone', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[0].groupSnapshot = { groups: 'damaged' };
  const proposal = compile(fixture);
  assert(proposal.sourceErrors.some(error => error.section === 'groups'));
  assert(proposal.candidates.devices.some(device => device.proposedName === 'Edison'));
  assert.equal(proposal.candidates.savedLooks.length, 1);
});

test('unsupported source fields are ignored generically and cannot upgrade a lamp secret into Home access', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.sources[0].householdGrant = {
    role: 'owner',
    secret: 'private-household-secret',
    deviceId: 'a10000000001'
  };
  const proposal = compile(fixture);
  assert(proposal.sourceErrors.some(error => error.code === 'unsupported-source-field'));
  const text = JSON.stringify(proposal);
  assert.equal(text.includes('private-household-secret'), false);
  assert.equal(text.includes('owner'), false);
});

test('input byte, source count, and fixed-time boundaries are enforced', () => {
  const tooManySources = copy(homeMigrationV1Fixture);
  tooManySources.sources = Array.from({ length: 17 }, (_, index) => ({
    sourceId: `phone-${index}`,
    kind: 'phone',
    capturedAt: '2026-11-17T16:00:00Z'
  }));
  assert.throws(() => compile(tooManySources), /too many sources/);
  assert.throws(() => compileLegacyMigrationProposalV1(copy(homeMigrationV1Fixture)), /fixed generation time/);
  assert.throws(() => compileLegacyMigrationProposalV1(copy(homeMigrationV1Fixture), { now: '2026-11-17T16:03:00' }), /fixed generation time/);
  assert.throws(() => compileLegacyMigrationProposalV1('null', { now: NOW }), /Invalid Existing Home review input/);
  const huge = JSON.stringify({
    version: 1,
    destinationHome: { id: 'home.primary', name: 'Primary home' },
    sources: [],
    coolStripSnapshots: [],
    padding: 'x'.repeat(600000)
  });
  assert.throws(() => compileLegacyMigrationProposalV1(huge, { now: NOW }), /too large/);
});

test('unexpected top-level fields fail closed', () => {
  const fixture = copy(homeMigrationV1Fixture);
  fixture.executeNow = true;
  assert.throws(() => compile(fixture), /Unexpected Existing Home review field/);
});
