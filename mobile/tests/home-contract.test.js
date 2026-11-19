import test from 'node:test';
import assert from 'node:assert/strict';
import { compileHomeView, validateHomeEvent, validateHomeFixture, validateHomeSnapshot } from '../src/home-contract.js';
import { homeContractV1Fixture } from './fixtures/home-contract-v1.js';

const copy = value => structuredClone(value);
const primary = () => copy(homeContractV1Fixture.snapshots[0]);
const lake = () => copy(homeContractV1Fixture.snapshots[1]);

test('the v1 fixture validates two isolated Homes and ordered invalidation events', () => {
  const result = validateHomeFixture(homeContractV1Fixture);
  assert.equal(result.snapshots.length, 2);
  assert.equal(result.events.length, 3);
  assert.deepEqual(result.snapshots.map(snapshot => snapshot.home.id), ['home.primary', 'home.lake']);
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.snapshots[0].devices[0].audioInput));
});

test('an owner phone receives a full but credential-free Home view', () => {
  const view = compileHomeView(primary(), {
    personId: 'person.joe',
    installationId: 'installation.joe.iphone',
    grantId: 'grant.primary.joe.iphone',
    now: Date.parse('2026-11-17T16:00:00Z')
  });
  assert.equal(view.role, 'owner');
  assert.equal(view.devices.length, 4);
  assert.equal(view.home.location.latitude, 41.8781);
  assert.equal(view.access.grantId, 'grant.primary.joe.iphone');
  assert.equal(view.access.scope.kind, 'home');
  assert.equal(JSON.stringify(view).includes('password'), false);
  assert.equal(JSON.stringify(view).includes('192.168.'), false);
  assert.equal('authority' in view, false);
});

test('temporary help exposes only its typed target and redacts precise Home location', () => {
  const view = compileHomeView(lake(), {
    personId: 'person.lisa',
    installationId: 'installation.lisa.iphone',
    grantId: 'grant.lake.lisa.help',
    now: Date.parse('2026-11-17T16:00:00Z')
  });
  assert.equal(view.role, 'guest');
  assert.deepEqual(view.devices.map(device => device.name), ['Deck Helix']);
  assert.deepEqual(view.rooms.map(room => room.name), ['Deck']);
  assert.equal(view.groups.length, 0);
  assert.equal(view.scenes.length, 0);
  assert.equal(view.schedules.length, 0);
  assert.equal('location' in view.home, false);
  assert.deepEqual(view.access, {
    grantId: 'grant.lake.lisa.help',
    permissions: ['control', 'device-care'],
    scope: { kind: 'targets', targets: [{ kind: 'device', id: 'c20000000001' }] },
    expiresAt: '2026-11-23T23:00:00Z'
  });
});

test('a compiled view uses one exact grant and cannot union unrelated permissions', () => {
  const snapshot = primary();
  snapshot.grants.push({
    id: 'grant.primary.lisa.device-care',
    kind: 'member',
    subjectType: 'membership',
    subjectId: 'membership.primary.lisa',
    installationId: 'installation.lisa.iphone',
    authorizationRevision: 8,
    permissions: [],
    scope: { kind: 'targets', targets: [{ kind: 'device', id: 'c10000000002' }] },
    status: 'active',
    expiresAt: null
  });
  const view = compileHomeView(snapshot, {
    personId: 'person.lisa',
    installationId: 'installation.lisa.iphone',
    grantId: 'grant.primary.lisa.device-care',
    now: Date.parse('2026-11-17T16:00:00Z')
  });
  assert.deepEqual(view.devices.map(device => device.name), ['Edison']);
  assert.deepEqual(view.access.permissions, []);
  assert.throws(() => compileHomeView(snapshot, {
    personId: 'person.lisa',
    installationId: 'installation.lisa.iphone',
    grantId: 'grant.primary.joe.iphone',
    now: Date.parse('2026-11-17T16:00:00Z')
  }), /selected active Home grant/);
});

test('expired or revoked phone access cannot compile a Home view', () => {
  assert.throws(() => compileHomeView(lake(), {
    personId: 'person.lisa',
    installationId: 'installation.lisa.iphone',
    grantId: 'grant.lake.lisa.help',
    now: Date.parse('2026-11-24T00:00:00Z')
  }), /selected active Home grant/);
  assert.throws(() => compileHomeView(primary(), {
    personId: 'person.lisa',
    installationId: 'installation.lisa.oldphone',
    grantId: 'grant.primary.lisa.oldphone',
    now: Date.parse('2026-11-17T16:00:00Z')
  }), /active Home access/);
});

test('temporary help must be guest, expiring, and target-scoped', () => {
  const missingExpiry = lake();
  missingExpiry.grants[1].expiresAt = null;
  assert.throws(() => validateHomeSnapshot(missingExpiry), /Temporary help/);
  const homeWide = lake();
  homeWide.grants[1].scope = { kind: 'home', targets: [] };
  assert.throws(() => validateHomeSnapshot(homeWide), /Temporary help/);
  const memberRole = lake();
  memberRole.memberships[1].role = 'member';
  assert.throws(() => validateHomeSnapshot(memberRole), /Temporary help/);
});

test('typed targets reject cross-Home devices, rooms, and groups', () => {
  for (const target of [
    { kind: 'device', id: 'c10000000001' },
    { kind: 'room', id: 'room.living' },
    { kind: 'group', id: 'group.evening' },
    { kind: 'home', id: 'home.primary' }
  ]) {
    const snapshot = lake();
    snapshot.grants[1].scope.targets = [target];
    assert.throws(() => validateHomeSnapshot(snapshot), /leaves its Home/);
  }
});

test('a device cannot appear in two fixture Homes', () => {
  const fixture = copy(homeContractV1Fixture);
  fixture.snapshots[1].devices[1].id = 'c10000000001';
  fixture.snapshots[1].groups[0].members[0].deviceId = 'c10000000001';
  fixture.snapshots[1].grants[1].scope.targets[0].id = 'c10000000001';
  fixture.events[1].resource.id = 'c10000000001';
  assert.throws(() => validateHomeFixture(fixture), /more than one Home/);
});

test('one current authorization revision fences every active grant', () => {
  const snapshot = primary();
  snapshot.grants[1].authorizationRevision = 7;
  assert.throws(() => validateHomeSnapshot(snapshot), /old authorization revision/);
  const future = primary();
  future.grants[2].authorizationRevision = 9;
  assert.throws(() => validateHomeSnapshot(future), /future/);
});

test('grant permissions cannot exceed the membership role', () => {
  const snapshot = primary();
  snapshot.grants[1].permissions.push('people');
  assert.throws(() => validateHomeSnapshot(snapshot), /exceeds its membership role/);
  const help = lake();
  help.grants[1].permissions.push('integrations');
  assert.throws(() => validateHomeSnapshot(help), /exceeds its membership role/);
});

test('a Home has exactly one matching authority service', () => {
  const duplicate = primary();
  duplicate.services.push({ id: 'service.primary.second-authority', name: 'Second authority', kind: 'home-authority', hostDeviceId: 'd10000000001', state: 'ready' });
  assert.throws(() => validateHomeSnapshot(duplicate), /one matching authority/);
  const stateMismatch = primary();
  stateMismatch.authority.state = 'migrating';
  assert.throws(() => validateHomeSnapshot(stateMismatch), /one matching authority/);
});

test('microphones are authoritative capabilities, not product-name guesses', () => {
  const snapshot = primary();
  assert.equal(snapshot.devices.find(device => device.kind === 'bridge').audioInput.installed, false);
  assert(snapshot.devices.filter(device => device.kind === 'coollamp').every(device => device.audioInput.installed));
  snapshot.devices[0].audioInput = { installed: false, available: false, canDriveOtherLights: false };
  snapshot.devices[0].capabilities.push('audio-input');
  assert.throws(() => validateHomeSnapshot(snapshot), /audio capability disagrees/);
  const audioServiceWithoutMicrophone = primary();
  audioServiceWithoutMicrophone.services.push({ id: 'service.primary.audio', name: 'Sound for effects', kind: 'audio-source', hostDeviceId: 'a10000000001', state: 'ready' });
  assert.throws(() => validateHomeSnapshot(audioServiceWithoutMicrophone), /no provisioned microphone/);
});

test('reachability and freshness remain separate state axes', () => {
  const snapshot = validateHomeSnapshot(primary());
  const edison = snapshot.devices.find(device => device.name === 'Edison');
  assert.equal(edison.state.reachability, 'unreachable');
  assert.equal(edison.state.freshness, 'stale');
  const independent = primary();
  independent.devices[2].state = { reachability: 'reachable', freshness: 'stale', confirmedAt: '2026-11-17T14:55:00Z' };
  assert.equal(validateHomeSnapshot(independent).devices[2].state.reachability, 'reachable');
});

test('location is optional but must be valid when present', () => {
  const noLocation = primary();
  noLocation.home.location = null;
  assert.equal(validateHomeSnapshot(noLocation).home.location, null);
  const invalid = primary();
  invalid.home.location.latitude = 91;
  assert.throws(() => validateHomeSnapshot(invalid), /Home location/);
});

test('timestamps and IANA timezones reject normalized-but-invalid input', () => {
  const impossibleDate = primary();
  impossibleDate.devices[0].state.confirmedAt = '2026-02-30T12:00:00Z';
  assert.throws(() => validateHomeSnapshot(impossibleDate), /confirmation time/);
  const timezone = primary();
  timezone.home.timezone = 'Central Time-ish';
  assert.throws(() => validateHomeSnapshot(timezone), /Home timezone/);
});

test('integration status and Home-scoped grant state must agree', () => {
  const connectedWithoutGrant = primary();
  connectedWithoutGrant.integrations[0].grantId = null;
  assert.throws(() => validateHomeSnapshot(connectedWithoutGrant), /active Home grant/);
  const revokedWithActiveGrant = lake();
  revokedWithActiveGrant.grants[2].status = 'active';
  revokedWithActiveGrant.grants[2].authorizationRevision = 3;
  assert.throws(() => validateHomeSnapshot(revokedWithActiveGrant), /revoked Home grant/);
});

test('unexpected route, credential, and secret fields are rejected rather than projected', () => {
  for (const [field, value] of [['ipAddress', '192.168.1.9'], ['password', 'secret'], ['route', 'mesh-hop-2']]) {
    const snapshot = primary();
    snapshot.devices[0][field] = value;
    assert.throws(() => validateHomeSnapshot(snapshot), /Unexpected device field/);
  }
});

test('event authority and exact sequence gaps require a fresh snapshot, never replay', () => {
  const snapshot = primary();
  const event = copy(homeContractV1Fixture.events[0]);
  assert.equal(validateHomeEvent(event, snapshot).sequence, 42);
  const gap = { ...event, sequence: 43 };
  assert.throws(() => validateHomeEvent(gap, snapshot), error => error.snapshotRequired === true && /sequence has a gap/.test(error.message));
  const reboot = { ...event, bootSession: 'bbbbbbbbbbbbbbbb' };
  assert.throws(() => validateHomeEvent(reboot, snapshot), error => error.snapshotRequired === true && /authority changed/.test(error.message));
  const otherHome = { ...event, homeId: 'home.lake' };
  assert.throws(() => validateHomeEvent(otherHome, snapshot), error => error.snapshotRequired === true);
});

test('fixture event streams are ordered independently for each Home', () => {
  const fixture = copy(homeContractV1Fixture);
  fixture.events[2].sequence = 44;
  assert.throws(() => validateHomeFixture(fixture), error => error.snapshotRequired === true && /sequence has a gap/.test(error.message));
});

test('validated output is detached from later input mutation', () => {
  const source = primary();
  const validated = validateHomeSnapshot(source);
  source.home.name = 'Changed after validation';
  source.devices[0].name = 'Changed equipment';
  assert.equal(validated.home.name, 'Primary home');
  assert.equal(validated.devices[0].name, 'Home hub');
});
