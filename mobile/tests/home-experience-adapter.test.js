import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeExperienceProjectionV1, homeExperienceLight } from '../src/home-experience-adapter.js';

const NOW = 10_000;
const ids = {
  leader: 'a10000000001',
  separate: 'a10000000002',
  paused: 'a10000000003',
  independent: 'a10000000004',
  other: 'a10000000005'
};

const fixture = () => ({
  version: 1,
  home: { id: 'local-home', name: 'Primary home', mode: 'local-only' },
  lamps: [
    { id: ids.leader, name: 'Helix', room: 'Living room', phoneLampStyle: 'helix', capabilities: { power: true, brightness: true, effects: true } },
    { id: ids.separate, name: 'Edison', room: 'Living room', microphoneInstalled: false, capabilities: { power: true, colors: false } },
    { id: ids.paused, name: 'Window display', room: 'Front windows', productKind: 'coolstrip-controller', capabilities: { power: true, matrix: true } },
    { id: ids.independent, name: 'Reading lamp', room: 'Office', capabilities: { power: true, soundResponse: true } },
    { id: 'ble:native-picker-id', deviceId: 'native-picker-id', name: 'Porch lamp', address: '192.0.2.9', token: 'never-copy-me' }
  ],
  statuses: {
    [ids.leader]: {
      wifi: { state: 'connected', fresh: true, checkedAt: 9_900 },
      lighting: { kind: 'group', power: true, mode: 4, scene: 0, name: 'Fire', fresh: true, checkedAt: 9_900 },
      group: { state: 'leader', leader: ids.leader, active: true, paused: false, fresh: true, checkedAt: 9_900 }
    },
    [ids.separate]: {
      wifi: { state: 'disconnected', fresh: true, checkedAt: 9_850 },
      lighting: { kind: 'effect', power: true, mode: 8, name: 'Pacifica', fresh: false, checkedAt: 1_000 },
      group: { state: 'follower', leader: ids.leader, active: false, paused: true, fresh: true, checkedAt: 9_850 }
    },
    [ids.independent]: {
      group: { state: 'independent', leader: null, fresh: true, checkedAt: 9_800 }
    }
  },
  groups: [{
    id: ids.leader,
    name: 'Old group name',
    leader: { id: ids.leader, verified: true, checkedAt: 9_900, role: 1, sync: { role: 1, active: true, paused: false } },
    followers: [
      { id: ids.separate, verified: true, checkedAt: 9_850, role: 2, sync: { role: 2, active: false, paused: true } },
      { id: ids.paused, verified: false, lastSeenMembership: true, checkedAt: 500, role: 2, sync: { role: 2, active: false, paused: false } }
    ],
    available: true
  }],
  savedLooks: [{
    version: 1,
    id: 'warm-evening',
    createdAt: 8_000,
    lampId: ids.separate,
    name: 'Warm evening',
    effect: { localId: 4, name: 'Fire', key: 'fire' },
    appearance: { brightness: 144, color: [0, 255, 132, 48], options: [60, 20, 0, 128, 90, 30] }
  }],
  preferences: {
    rooms: { [ids.separate]: 'Office', missing: 'Garage' },
    groups: { [ids.leader]: 'Evening lights', missing: 'Invented group' }
  },
  discovery: [{ id: ids.other, name: 'Must not appear' }],
  routes: [{ targetId: ids.other, address: '192.0.2.20' }]
});

const build = value => buildHomeExperienceProjectionV1(value, { now: NOW });

function allFrozen(value) {
  if (!value || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(allFrozen);
}

test('adapter is detached, deterministic, deeply frozen, and omits routes, credentials, and discovery', () => {
  const input = fixture(), before = JSON.stringify(input);
  const first = build(input), reordered = fixture();
  reordered.lamps.reverse();
  reordered.groups[0].followers.reverse();
  assert.deepEqual(first, build(reordered));
  assert.equal(JSON.stringify(input), before);
  assert(allFrozen(first));
  const output = JSON.stringify(first);
  for (const forbidden of ['never-copy-me', '192.0.2.9', '192.0.2.20', 'Must not appear', 'native-picker-id']) assert.equal(output.includes(forbidden), false, forbidden);
});

test('saved products remain an unverified Home projection and never become ownership', () => {
  const view = build(fixture());
  assert.deepEqual(view.home, { id: 'local-home', name: 'Primary home', mode: 'local-only', membership: 'unverified-legacy' });
  assert(view.lights.every(light => light.homeBinding === 'review-required'));
  assert.equal('owner' in view.home, false);
  assert(view.issues.some(value => value.code === 'home-review-required' && value.visibility === 'internal'));
});

test('canonical records and unresolved picker records remain distinct without promoting native identity', () => {
  const view = build(fixture());
  assert.equal(view.lights.length, 5);
  assert.equal(homeExperienceLight(view, ids.leader).identity, 'canonical-record');
  assert.equal(homeExperienceLight(view, ids.leader).actionTargetId, ids.leader);
  const porch = view.lights.find(light => light.name === 'Porch lamp');
  assert.match(porch.id, /^unresolved\./);
  assert.equal(porch.canonicalDeviceId, null);
  assert.equal(porch.actionTargetId, null);
  assert.equal(porch.identity, 'needs-check');
  assert(porch.issues.some(value => value.code === 'identity-needs-check'));
  assert.equal(view.lights.some(light => light.canonicalDeviceId === ids.other), false);
});

test('Room evidence stays explicit, conflicts remain choices, and My home is not a Room', () => {
  const value = fixture();
  value.lamps[0].room = 'My home';
  const view = build(value), edison = homeExperienceLight(view, ids.separate), helix = homeExperienceLight(view, ids.leader);
  assert.deepEqual(edison.roomCandidateNames, ['Living room', 'Office']);
  assert.equal(edison.roomId, null);
  assert(edison.issues.some(value => value.code === 'room-conflict'));
  assert.deepEqual(helix.roomCandidateNames, []);
  assert.equal(view.rooms.some(room => room.name === 'My home' || room.name === 'Garage'), false);
});

test('fresh connectivity confirms reachability and lighting while stale appearance remains visibly stale', () => {
  const view = build(fixture());
  const leader = homeExperienceLight(view, ids.leader), separate = homeExperienceLight(view, ids.separate);
  assert.deepEqual(leader.availability, { reachability: 'reachable', freshness: 'fresh', confirmedAt: 9_900 });
  assert.equal(leader.lighting.freshness, 'fresh');
  assert.equal(leader.lighting.effect.name, 'Fire');
  assert.deepEqual(separate.availability, { reachability: 'unreachable', freshness: 'fresh', confirmedAt: 9_850 });
  assert.equal(separate.lighting.freshness, 'stale');
  assert.equal(separate.lighting.effect.name, 'Pacifica');
});

test('expired or future observations cannot establish live state', () => {
  const value = fixture();
  value.statuses[ids.leader].wifi.checkedAt = -1;
  value.statuses[ids.leader].lighting.checkedAt = NOW + 2_000;
  value.statuses[ids.leader].group.checkedAt = NOW + 2_000;
  value.groups[0].leader.checkedAt = -1;
  const leader = homeExperienceLight(build(value), ids.leader);
  assert.equal(leader.availability.reachability, 'unknown');
  assert.equal(leader.lighting.freshness, 'stale');
  assert.equal(leader.lighting.confirmedAt, null);
  assert.equal(leader.group.current, 'unknown');
  assert.equal(leader.group.evidence, 'stale');
});

test('fresh playing, fresh separate, and saved paused membership remain distinct', () => {
  const view = build(fixture()), group = view.groups[0];
  const members = new Map(group.members.map(member => [member.deviceId, member]));
  assert.equal(members.get(ids.leader).current, 'playing');
  assert.equal(members.get(ids.leader).evidence, 'fresh');
  assert.equal(members.get(ids.separate).current, 'separate');
  assert.equal(members.get(ids.separate).lastKnown, 'separate');
  assert.equal(members.get(ids.paused).current, 'unknown');
  assert.equal(members.get(ids.paused).lastKnown, 'paused');
  assert.equal(members.get(ids.paused).evidence, 'saved');
  assert.equal(homeExperienceLight(view, ids.separate).group.current, 'separate');
  assert.equal(homeExperienceLight(view, ids.paused).group.lastKnown, 'paused');
});

test('a fresh status for the wrong group cannot replace explicit saved membership', () => {
  const value = fixture();
  value.statuses[ids.separate].group.leader = ids.other;
  value.groups[0].followers[0].checkedAt = -1;
  const membership = build(value).groups[0].members.find(member => member.deviceId === ids.separate);
  assert.equal(membership.current, 'unknown');
  assert.equal(membership.lastKnown, 'separate');
  assert.equal(membership.evidence, 'stale');
});

test('group labels cannot create a group or a member and missing saved members stay actionable', () => {
  const value = fixture();
  value.groups[0].followers.push({ id: ids.other, verified: false, lastSeenMembership: true, role: 2, sync: { role: 2, paused: true } });
  const view = build(value);
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].name, 'Evening lights');
  assert.equal(view.groups[0].actionTargetId, ids.leader);
  assert.equal(view.groups[0].unmatchedMemberCount, 1);
  assert(view.groups[0].issues.some(value => value.code === 'member-needs-identification'));
  assert.equal(JSON.stringify(view).includes('Invented group'), false);
});

test('capabilities remain advertised states and microphone defaults follow product provisioning rules', () => {
  const view = build(fixture());
  const lamp = homeExperienceLight(view, ids.leader), edison = homeExperienceLight(view, ids.separate), strip = homeExperienceLight(view, ids.paused);
  assert.equal(lamp.capabilities.power, 'supported');
  assert.equal(lamp.capabilities.matrix, 'unknown');
  assert.deepEqual(lamp.microphone, { installed: true, availability: 'unconfirmed', basis: 'coollamp-default' });
  assert.deepEqual(edison.microphone, { installed: false, availability: 'unconfirmed', basis: 'explicit-exception' });
  assert.deepEqual(strip.microphone, { installed: false, availability: 'unconfirmed', basis: 'controller-default' });
  assert.equal(strip.productKind, 'coolstrip-controller');
  const aliases=fixture();aliases.lamps.find(value=>value.id===ids.paused).productKind='strip-controller';
  assert.equal(homeExperienceLight(build(aliases),ids.paused).productKind,'coolstrip-controller');
  aliases.lamps.find(value=>value.id===ids.paused).productKind='CoolStrip-Controller';
  assert.equal(homeExperienceLight(build(aliases),ids.paused).productKind,'coolstrip-controller');
});

test('a validated legacy power snapshot exposes only the compatibility power action', () => {
  const value=fixture(),row=value.lamps.find(item=>item.id===ids.leader);delete row.capabilities;
  const product=homeExperienceLight(build(value),ids.leader);
  assert.equal(product.capabilities.power,'supported');assert.equal(product.capabilities.brightness,'unknown');assert.equal(product.capabilities.effects,'unknown');
});

test('an explicit unknown product never inherits lamp or microphone defaults', () => {
  const value=fixture(),row=value.lamps.find(item=>item.id===ids.paused);row.productKind='coolstrip-controllre';delete row.microphoneInstalled;
  const product=homeExperienceLight(build(value),ids.paused);
  assert.equal(product.productKind,'unknown');
  assert.deepEqual(product.microphone,{installed:null,availability:'unconfirmed',basis:'unknown-product'});
});

test('explicit Home scope fails closed before foreign records can enter the projection', () => {
  for(const mutate of [
    value=>value.lamps[0].homeId='other-home',
    value=>value.groups[0].homeId='other-home',
    value=>value.groups[0].leader.homeId='other-home',
    value=>value.groups[0].followers[0].homeId='other-home',
    value=>value.savedLooks[0].homeId='other-home'
  ]){
    const value=fixture();mutate(value);assert.throws(()=>build(value),/another Home/);
  }
  const scoped=fixture();for(const row of [...scoped.lamps,...scoped.groups,...scoped.savedLooks])row.homeId='local-home';
  assert.equal(build(scoped).home.id,'local-home');
});

test('group member limits fail closed instead of silently truncating a follower', () => {
  const value=fixture();value.groups[0].followers=Array.from({length:32},(_,index)=>({id:(index+20).toString(16).padStart(12,'0')}));
  assert.throws(()=>build(value),/membership exceeds its limits/);
  value.groups[0].followers.pop();assert.equal(build(value).groups[0].unmatchedMemberCount,31);
});

test('duplicate style evidence is order independent and conflicts stay unresolved', () => {
  const value=fixture(),duplicate={...value.lamps[0],name:'Helix',phoneLampStyle:'edison'};value.lamps.push(duplicate);
  const first=build(value),light=homeExperienceLight(first,ids.leader);assert.equal(light.lampStyle,null);assert(light.issues.some(value=>value.code==='lamp-style-conflict'));
  value.lamps.reverse();assert.deepEqual(build(value),first);
});

test('saved looks retain exact device appearance, remain phone-scoped, and never become Scenes', () => {
  const value = fixture();
  value.savedLooks.push({ ...value.savedLooks[0], id: 'orphan', lampId: ids.other, name: 'Orphan' });
  const view = build(value), look = view.savedLooks[0];
  assert.equal(view.savedLooks.length, 1);
  assert.equal(look.deviceId, ids.separate);
  assert.equal(look.scope, 'phone-device');
  assert.deepEqual(look.appearance.color, [0, 255, 132, 48]);
  assert.deepEqual(homeExperienceLight(view, ids.separate).savedLookIds, [look.id]);
  assert.equal('scenes' in view, false);
});

test('dashboard candidates prioritize real groups and Rooms without claiming they are user favorites', () => {
  const view = build(fixture());
  assert.deepEqual(view.dashboard.favorites, []);
  assert.equal(view.dashboard.suggestions[0].kind, 'group');
  assert(view.dashboard.suggestions.some(value => value.kind === 'room'));
  assert.equal(view.dashboard.nextEvent, null);
});

test('input limits, fixed time, and malformed sections fail closed', () => {
  assert.throws(() => buildHomeExperienceProjectionV1(fixture()), /fixed current time/);
  assert.throws(() => build({ ...fixture(), version: 2 }), /Unsupported/);
  assert.throws(() => build({ ...fixture(), statuses: [] }), /malformed/);
  const tooMany = fixture();
  tooMany.lamps = Array.from({ length: 129 }, (_, index) => ({ id: index.toString(16).padStart(12, '0'), name: 'Lamp' }));
  assert.throws(() => build(tooMany), /limits/);
  assert.throws(() => build({ ...fixture(), padding: 'x'.repeat(400_000) }), /too large/);
});
