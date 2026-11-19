import test from 'node:test';
import assert from 'node:assert/strict';
import { HomeAccessClient, homeAccessPeopleState, validateHomeAccessAppView } from '../src/home-access-client.js';

const id = digit => digit.repeat(32);
const installation = Object.freeze({ version: 1, installationId: id('1'), credentialKeyId: id('2'), credentialGeneration: 1, displayName: 'This iPhone', publicKeyThumbprint: '3'.repeat(64), keyState: 'active' });
const now = Date.parse('2026-11-19T18:00:00.000Z');
const ready = () => ({
  version: 1, kind: 'home-access-app-view', home: { id: id('4'), name: 'Primary home' }, installationId: installation.installationId,
  observedAt: '2026-11-19T17:59:30.000Z', freshUntil: '2026-11-19T18:04:30.000Z', canInvite: true,
  people: [
    { id: id('5'), displayName: 'Joe', role: 'owner', status: 'active', expiresAt: null, scope: { kind: 'home', targetNames: [] }, isYou: true, phones: [{ id: installation.installationId, personId: id('5'), displayName: 'This iPhone', status: 'active', isThisPhone: true }] },
    { id: id('6'), displayName: 'Lisa', role: 'member', status: 'active', expiresAt: null, scope: { kind: 'home', targetNames: [] }, isYou: false, phones: [{ id: id('7'), personId: id('6'), displayName: 'Lisa’s iPhone', status: 'active', isThisPhone: false }] }
  ],
  invitations: [{ id: id('8'), displayName: 'Pat', role: 'member', status: 'issued', expiresAt: '2026-11-26T18:00:00.000Z', accessExpiresAt: null, scope: { kind: 'home', targetNames: [] } }],
  pendingTargets: [{ deviceId: 'aabbccddeeff', displayName: 'Edison', state: 'unavailable' }]
});
const identity = { ensure: async () => installation };

test('a strict fresh app view is credential-free and scoped to this phone and Home', () => {
  const view = validateHomeAccessAppView(ready(), { homeId: id('4'), installationId: id('1'), now });
  assert.equal(view.state, 'ready');
  assert.equal(view.fresh, true);
  assert.equal(view.canInvite, true);
  assert.equal(view.canManagePeople, true);
  assert.equal(view.people[1].displayName, 'Lisa');
  assert(Object.isFrozen(view.people[0].phones[0]));
  assert(!/password|secret|token|address/i.test(JSON.stringify(view)));
});

test('saved navigation Home names and local IDs never authorize a provider read', async () => {
  let reads = 0;
  const client = new HomeAccessClient({ identity, provider: { readAccess: async () => { reads += 1; return ready(); } }, now: () => now });
  const missing = await client.refresh({ homeName: 'Primary home' });
  assert.equal(missing.state, 'not-configured');
  const local = await client.refresh({ homeName: 'Primary home', homeId: 'local-home' });
  assert.equal(local.state, 'owner-help-required');
  assert.equal(reads, 0);
});

test('refresh visibly checks the phone and Home before returning a fresh view', async () => {
  const phases = [], reads = [];
  const client = new HomeAccessClient({ identity, provider: { readAccess: async input => { reads.push(input); return ready(); } }, now: () => now });
  const view = await client.refresh({ homeName: 'Primary home', homeId: id('4'), onProgress: phase => phases.push(phase) });
  assert.deepEqual(phases, ['checking-phone', 'checking-home']);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].installation, installation);
  assert.equal(view.state, 'ready');
});

test('wrong Home, phone, current-person mapping, unknown fields and future observations never present ready access', async () => {
  const variants = [
    { ...ready(), home: { id: id('9'), name: 'Other home' } },
    { ...ready(), installationId: id('9') },
    { ...ready(), people: ready().people.map((row, index) => index ? row : { ...row, isYou: false }) },
    { ...ready(), people: ready().people.map(row => ({ ...row, isYou: true })) },
    { ...ready(), people: ready().people.map((row, index) => index ? { ...row, phones: [{ ...row.phones[0], id: installation.installationId }] } : row) },
    { ...ready(), password: 'nope' },
    { ...ready(), observedAt: '2026-11-19T18:01:00.000Z', freshUntil: '2026-11-19T18:05:00.000Z' }
  ];
  for (const raw of variants) {
    const client = new HomeAccessClient({ identity, provider: { readAccess: async () => raw }, now: () => now });
    assert.equal((await client.refresh({ homeName: 'Primary home', homeId: id('4') })).state, 'owner-help-required');
  }
});

test('stale access remains visibly stale and cannot invite', async () => {
  const raw = ready(); raw.observedAt = '2026-11-19T17:50:00.000Z'; raw.freshUntil = '2026-11-19T17:55:00.000Z';
  const client = new HomeAccessClient({ identity, provider: { readAccess: async () => raw }, now: () => now });
  const view = await client.refresh({ homeName: 'Primary home', homeId: id('4') });
  assert.equal(view.state, 'stale');
  assert.equal(view.canInvite, false);
  assert.equal(view.issue.action, 'try-again');
});

test('validated access maps to the credential-free People and access presentation boundary', () => {
  const source = validateHomeAccessAppView(ready(), { homeId: id('4'), installationId: id('1'), now });
  const value = homeAccessPeopleState(source);
  assert.equal(value.state, 'ready');
  assert.deepEqual(value.viewer, { personId: id('5'), installationId: id('1'), canManagePeople: true });
  assert.equal(value.people[1].name, 'Lisa');
  assert.equal(value.invitations[0].state, 'issued');
  assert.deepEqual(value.pendingTargets, [{ id: 'aabbccddeeff', name: 'Edison', outcome: 'unavailable' }]);
  const unconfigured = homeAccessPeopleState({ version: 1, state: 'not-configured', home: { name: 'Primary home' } });
  assert.equal(unconfigured.home.id, null);
  assert.equal(unconfigured.viewer, null);
});

test('stale access remains readable, keeps management permission separate, and disables mutations', async () => {
  const raw = ready(); raw.observedAt = '2026-11-19T17:50:00.000Z'; raw.freshUntil = '2026-11-19T17:55:00.000Z';
  const client = new HomeAccessClient({ identity, provider: { readAccess: async () => raw }, now: () => now });
  const presentation = homeAccessPeopleState(await client.refresh({ homeName: 'Primary home', homeId: id('4') }));
  assert.equal(presentation.state, 'unavailable');
  assert.equal(presentation.viewer.canManagePeople, true);
  assert.equal(presentation.invitations.length, 1);
  assert.deepEqual(presentation.pendingTargets, [{ id: 'aabbccddeeff', name: 'Edison', outcome: 'unavailable' }]);
});

test('revocation clears people, invitations and pending products instead of exposing cached access', async () => {
  const client = new HomeAccessClient({ identity, provider: { readAccess: async () => ({ version: 1, kind: 'home-access-revoked', homeId: id('4'), observedAt: '2026-11-19T18:00:00.000Z' }) }, now: () => now });
  const view = await client.refresh({ homeName: 'Primary home', homeId: id('4') });
  assert.equal(view.state, 'revoked');
  assert.deepEqual(view.people, []);
  assert.deepEqual(view.invitations, []);
  assert.deepEqual(view.pendingTargets, []);
});

test('provider and native failures are actionable and never fabricate ready access', async () => {
  const failedProvider = new HomeAccessClient({ identity, provider: { readAccess: async () => { throw Error('offline'); } }, now: () => now });
  const providerView = await failedProvider.refresh({ homeName: 'Primary home', homeId: id('4') });
  assert.equal(providerView.state, 'failed');
  assert.match(providerView.issue.detail, /connection/);
  const failedIdentity = new HomeAccessClient({ identity: { ensure: async () => { throw Object.assign(Error('Unlock your phone and try again.'), { code: 'identity-unavailable' }); } } });
  const identityView = await failedIdentity.refresh({ homeName: 'Primary home', homeId: id('4') });
  assert.equal(identityView.state, 'failed');
  assert.equal(identityView.people.length, 0);
});

test('permanent native identity recovery is preserved as a non-retryable state', async () => {
  const client = new HomeAccessClient({ identity: { ensure: async () => { throw Object.assign(Error('Reinstall CoolLamp, then ask a Home owner to invite this phone again.'), { code: 'identity-recovery' }); } } });
  const view = await client.refresh({ homeName: 'Primary home', homeId: id('4') });
  assert.equal(view.state, 'recovery-required');
  assert.equal(view.issue.action, null);
  const presentation = homeAccessPeopleState(view);
  assert.equal(presentation.state, 'recovery-required');
});

test('invalid Home access data asks for owner help instead of offering an ineffective retry', async () => {
  const client = new HomeAccessClient({ identity, provider: { readAccess: async () => ({ ...ready(), password: 'invalid' }) }, now: () => now });
  const view = await client.refresh({ homeName: 'Primary home', homeId: id('4') });
  assert.equal(view.state, 'owner-help-required');
  assert.equal(view.issue.action, null);
  assert.equal(homeAccessPeopleState(view).state, 'owner-help-required');
});

test('cancellation stops before a provider read', async () => {
  let reads = 0; const controller = new AbortController(); controller.abort();
  const client = new HomeAccessClient({ identity: { ensure: async () => { throw Object.assign(Error('stopped'), { cancelled: true }); } }, provider: { readAccess: async () => { reads += 1; } } });
  await assert.rejects(client.refresh({ homeName: 'Primary home', homeId: id('4'), signal: controller.signal }), error => error.cancelled === true);
  assert.equal(reads, 0);
});
