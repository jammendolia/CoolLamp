// Read-only compatibility adapter for the redesigned Home experience.
//
// This module accepts detached snapshots. It never reads storage, discovers a
// product, chooses a route, checks credentials, or sends a command. Legacy
// records remain review-required Home evidence rather than becoming ownership.

const encoder = new TextEncoder();
const DEVICE_ID = /^[0-9a-f]{12}$/;
const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;
const MAX_INPUT_BYTES = 384 * 1024;
const MAX_LIGHTS = 128;
const MAX_GROUPS = 64;
const MAX_LOOKS = 128;
const MAX_MEMBERS = 32;
const OBSERVATION_MAX_AGE_MS = 60 * 1000;
const PRODUCT_KIND = new Map([
  ['lamp', 'lamp'], ['coollamp', 'lamp'], ['super-lamp', 'super-lamp'],
  ['strip', 'coolstrip-controller'], ['coolstrip', 'coolstrip-controller'],
  ['strip-controller', 'coolstrip-controller'], ['coolstrip-controller', 'coolstrip-controller'], ['bridge', 'bridge']
]);
const CAPABILITIES = Object.freeze([
  'power', 'brightness', 'effects', 'colors', 'soundResponse', 'matrix', 'updates'
]);

const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const list = (value, max) => Array.isArray(value) && value.length <= max ? value : null;

function detach(raw) {
  if (!record(raw)) throw Error('Home experience input must be a detached record.');
  let text;
  try { text = JSON.stringify(raw); } catch { throw Error('Home experience input could not be read.'); }
  if (typeof text !== 'string' || encoder.encode(text).length > MAX_INPUT_BYTES) throw Error('Home experience input is too large.');
  return JSON.parse(text);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function text(value, fallback = '', maxBytes = 96) {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim();
  return clean && encoder.encode(clean).length <= maxBytes && !/[\u0000-\u001f\u007f]/.test(clean) ? clean : fallback;
}

function canonical(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return DEVICE_ID.test(id) ? id : null;
}

function safeKey(value, fallback = '') {
  return typeof value === 'string' && SAFE_KEY.test(value) ? value : fallback;
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freshAt(value, now) {
  return Number.isFinite(value) && value >= 0 && value <= now + 1000 && now - value <= OBSERVATION_MAX_AGE_MS;
}

function normalizedRoom(value) {
  const name = text(value);
  return !name || name.toLocaleLowerCase() === 'my home' ? null : name;
}

function roomKey(value) {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function issue(code, message) {
  return { code, message };
}

function capabilityValue(rows, key, observed = false) {
  const values = [...new Set(rows.flatMap(row => typeof row.capabilities?.[key] === 'boolean' ? [row.capabilities[key]] : []))];
  if (values.length === 1) return values[0] ? 'supported' : 'unsupported';
  if (values.length > 1) return 'unknown';
  // Legacy products do not advertise a descriptor. A validated power snapshot
  // proves only that this compatibility action exists; other capabilities stay unknown.
  return key === 'power' && observed ? 'supported' : 'unknown';
}

function productKind(rows) {
  const values = [...new Set(rows.map(row => row.kind))].sort(compare);
  return { value: values.length === 1 ? values[0] : 'unknown', conflict: values.length > 1 };
}

function microphone(rows, kind) {
  const values = [...new Set(rows.flatMap(row => typeof row.microphoneInstalled === 'boolean' ? [row.microphoneInstalled] : []))];
  if (values.length > 1) return { installed: null, availability: 'unconfirmed', basis: 'conflict' };
  if (values.length === 1) return {
    installed: values[0],
    availability: 'unconfirmed',
    basis: values[0] ? 'explicit-provisioning' : kind === 'lamp' || kind === 'super-lamp' ? 'explicit-exception' : 'controller-default'
  };
  if (kind === 'unknown') return { installed: null, availability: 'unconfirmed', basis: 'unknown-product' };
  const installed = kind === 'lamp' || kind === 'super-lamp';
  return { installed, availability: 'unconfirmed', basis: installed ? 'coollamp-default' : 'controller-default' };
}

function lightingState(status, now) {
  const value = status?.lighting;
  const valid = record(value) && typeof value.power === 'boolean' && Number.isInteger(value.mode) && value.mode >= 1 && value.mode <= 255;
  if (!valid) return { freshness: 'unknown', confirmedAt: null, power: null, effect: null, scope: 'unknown' };
  const fresh = value.fresh === true && freshAt(value.checkedAt, now);
  return {
    freshness: fresh ? 'fresh' : 'stale',
    confirmedAt: Number.isFinite(value.checkedAt) && value.checkedAt >= 0 && value.checkedAt <= now + 1000 ? value.checkedAt : null,
    power: value.power,
    effect: {
      localId: value.mode,
      name: text(value.name, '', 96) || null,
      scene: Number.isInteger(value.scene) && value.scene >= 0 && value.scene <= 255 ? value.scene : null
    },
    scope: value.kind === 'group' ? 'group' : 'device'
  };
}

function availabilityState(status, now) {
  const wifi = status?.wifi;
  if (!record(wifi) || wifi.fresh !== true || !freshAt(wifi.checkedAt, now)) return { reachability: 'unknown', freshness: 'unknown', confirmedAt: null };
  if (wifi.state === 'connected') return { reachability: 'reachable', freshness: 'fresh', confirmedAt: wifi.checkedAt };
  if (wifi.state === 'disconnected') return { reachability: 'unreachable', freshness: 'fresh', confirmedAt: wifi.checkedAt };
  return { reachability: 'unknown', freshness: 'unknown', confirmedAt: null };
}

function participation(value) {
  if (!record(value)) return 'unknown';
  const role = Number.isInteger(value.role) ? value.role : value.sync?.role;
  const active = typeof value.active === 'boolean' ? value.active : value.sync?.active;
  const paused = typeof value.paused === 'boolean' ? value.paused : value.sync?.paused;
  if (role === 0) return 'independent';
  if (paused === true) return 'separate';
  if (role === 1) return 'playing';
  if (role === 2 && active === true && paused === false) return 'playing';
  if (role === 2 && active === false && paused === false) return 'paused';
  return 'unknown';
}

function groupObservation(status, expectedGroupId, now) {
  const value = status?.group;
  if (!record(value) || value.fresh !== true || !freshAt(value.checkedAt, now)) return null;
  const leader = canonical(value.leader);
  if (value.state === 'leader' && (expectedGroupId === null || expectedGroupId !== canonical(value.leader))) return null;
  if (value.state === 'follower' && leader !== expectedGroupId) return null;
  const current = participation({
    role: value.state === 'leader' ? 1 : value.state === 'follower' ? 2 : value.state === 'independent' ? 0 : null,
    active: value.active,
    paused: value.paused
  });
  return current === 'unknown' ? null : { current, lastKnown: current, evidence: 'fresh', confirmedAt: value.checkedAt };
}

function memberObservation(row, status, groupId, now) {
  const live = groupObservation(status, groupId, now);
  if (live) return live;
  const lastKnown = participation(row);
  if (row?.verified === true && freshAt(row.checkedAt, now)) return {
    current: lastKnown,
    lastKnown,
    evidence: 'fresh',
    confirmedAt: row.checkedAt
  };
  if (row?.lastSeenMembership === true) return {
    current: 'unknown',
    lastKnown,
    evidence: 'saved',
    confirmedAt: Number.isFinite(row.checkedAt) ? row.checkedAt : null
  };
  if (row?.verified === true || lastKnown !== 'unknown') return {
    current: 'unknown',
    lastKnown,
    evidence: 'stale',
    confirmedAt: Number.isFinite(row?.checkedAt) ? row.checkedAt : null
  };
  return { current: 'unknown', lastKnown: 'unknown', evidence: 'unknown', confirmedAt: null };
}

function normalizedLamp(row) {
  if (!record(row)) return null;
  const suppliedKind = text(row.productKind, '', 64).toLocaleLowerCase();
  const kind = suppliedKind ? PRODUCT_KIND.get(suppliedKind) ?? 'unknown' : row.role === 'bridge' ? 'bridge' : 'lamp';
  return {
    canonicalId: canonical(row.id),
    name: text(row.name, kind === 'coolstrip-controller' ? 'Window display' : kind === 'bridge' ? 'Home hub' : 'CoolLamp'),
    room: normalizedRoom(row.room),
    kind,
    microphoneInstalled: typeof row.microphoneInstalled === 'boolean' ? row.microphoneInstalled : null,
    capabilities: record(row.capabilities) ? Object.fromEntries(CAPABILITIES.flatMap(key => typeof row.capabilities[key] === 'boolean' ? [[key, row.capabilities[key]]] : [])) : {},
    lampStyle: text(typeof row.phoneLampStyle === 'string' ? row.phoneLampStyle : row.lampStyle?.id ?? row.lampStyle, '', 64) || null
  };
}

function assertHomeScope(rows, homeId, label) {
  for (const row of rows) {
    if (!record(row) || row.homeId === undefined || row.homeId === null || row.homeId === '') continue;
    if (safeKey(row.homeId) !== homeId) throw Error(`${label} contains a record from another Home.`);
  }
}

function assertGroupInputs(rows, homeId) {
  for (const group of rows) {
    if (!record(group)) continue;
    if (group.followers !== undefined && (!Array.isArray(group.followers) || group.followers.length > MAX_MEMBERS - 1))
      throw Error('Home experience group membership exceeds its limits.');
    assertHomeScope([group, group.leader, ...(Array.isArray(group.followers) ? group.followers : [])], homeId, 'Groups');
  }
}

function normalizeLook(value) {
  if (!record(value) || value.version !== 1 || !canonical(value.lampId)) return null;
  const name = text(value.name, '', 64), effect = value.effect, appearance = value.appearance;
  if (!name || !record(effect) || !Number.isInteger(effect.localId) || effect.localId < 1 || effect.localId > 255 || !text(effect.name, '', 96) || !record(appearance)) return null;
  if (!Number.isInteger(appearance.brightness) || appearance.brightness < 1 || appearance.brightness > 255) return null;
  const color = Array.isArray(appearance.color) && appearance.color.length === 4 && appearance.color.every((item, index) => Number.isInteger(item) && item >= 0 && item <= (index === 0 ? 1 : 255)) ? [...appearance.color] : null;
  const options = Array.isArray(appearance.options) && appearance.options.length <= 16 && appearance.options.every(item => Number.isInteger(item) && item >= 0 && item <= 65535) ? [...appearance.options] : null;
  if (!color || !options) return null;
  return {
    legacyId: safeKey(value.id) || null,
    deviceId: canonical(value.lampId),
    name,
    effect: { localId: effect.localId, name: text(effect.name, '', 96), ...(safeKey(effect.key) ? { key: effect.key } : {}) },
    appearance: { brightness: appearance.brightness, color, options },
    createdAt: Number.isSafeInteger(value.createdAt) && value.createdAt > 0 ? value.createdAt : null,
    scope: 'phone-device'
  };
}

export function buildHomeExperienceProjectionV1(raw, { now } = {}) {
  if (!Number.isFinite(now) || now < 0) throw Error('Home experience needs a fixed current time.');
  const input = detach(raw);
  if (input.version !== 1) throw Error('Unsupported Home experience input.');
  const lampRows = list(input.lamps, MAX_LIGHTS);
  const groupRows = list(input.groups ?? [], MAX_GROUPS);
  const lookRows = list(input.savedLooks ?? [], MAX_LOOKS);
  if (!lampRows || !groupRows || !lookRows) throw Error('Home experience input exceeds its limits.');
  if (!record(input.statuses ?? {}) || !record(input.preferences ?? {})) throw Error('Home experience input is malformed.');

  const home = record(input.home) ? input.home : {};
  const homeId = safeKey(home.id, 'local-home');
  const homeName = text(home.name, 'My home', 64);
  const mode = ['local-only', 'hybrid', 'account-linked'].includes(home.mode) ? home.mode : 'local-only';
  const statuses = input.statuses;
  const roomPreferences = record(input.preferences.rooms) ? input.preferences.rooms : {};
  const groupNames = record(input.preferences.groups) ? input.preferences.groups : {};
  const globalIssues = [];

  assertHomeScope(lampRows, homeId, 'Lights');
  assertGroupInputs(groupRows, homeId);
  assertHomeScope(lookRows, homeId, 'Saved looks');

  const normalized = lampRows.map(normalizedLamp).filter(Boolean);
  const buckets = new Map();
  for (const row of normalized) {
    const signature = JSON.stringify(row);
    const key = row.canonicalId ? `device:${row.canonicalId}` : `unresolved:${signature}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const orderedBuckets = [...buckets.entries()].sort(([left], [right]) => compare(left, right));
  const resourceRooms = new Map();
  const lights = orderedBuckets.map(([bucketKey, rows], index) => {
    const id = rows[0].canonicalId || `unresolved.${String(index + 1).padStart(3, '0')}`;
    const canonicalId = rows[0].canonicalId;
    const names = [...new Set(rows.map(row => row.name))].sort(compare);
    const kind = productKind(rows), styleCandidates = [...new Set(rows.map(row => row.lampStyle).filter(Boolean))].sort(compare);
    const roomCandidates = new Map();
    for (const row of rows) if (row.room) roomCandidates.set(roomKey(row.room), row.room);
    const preferred = canonicalId ? normalizedRoom(typeof roomPreferences[canonicalId] === 'string' ? roomPreferences[canonicalId] : roomPreferences[canonicalId]?.name) : null;
    if (preferred) roomCandidates.set(roomKey(preferred), preferred);
    const rooms = [...roomCandidates.values()].sort(compare);
    for (const room of rooms) {
      const key = roomKey(room);
      if (!resourceRooms.has(key) || compare(room, resourceRooms.get(key)) < 0) resourceRooms.set(key, room);
    }
    const issues = [];
    if (!canonicalId) issues.push(issue('identity-needs-check', 'Identify this light before changing its Home details.'));
    if (names.length > 1) issues.push(issue('name-conflict', 'This light has more than one saved name.'));
    if (rooms.length > 1) issues.push(issue('room-conflict', 'Choose this light’s current Room.'));
    if (kind.conflict) issues.push(issue('product-kind-conflict', 'Check which product this saved record describes.'));
    if (styleCandidates.length > 1) issues.push(issue('lamp-style-conflict', 'Check this light’s design.'));
    const status = canonicalId && record(statuses[canonicalId]) ? statuses[canonicalId] : null;
    const lighting = lightingState(status, now);
    return {
      id,
      actionTargetId: canonicalId,
      canonicalDeviceId: canonicalId,
      identity: canonicalId ? 'canonical-record' : 'needs-check',
      homeBinding: 'review-required',
      productKind: kind.value,
      name: names[0] || 'CoolLamp',
      nameCandidates: names,
      roomCandidateNames: rooms,
      roomId: null,
      lampStyle: styleCandidates.length === 1 ? styleCandidates[0] : null,
      capabilities: Object.fromEntries(CAPABILITIES.map(key => [key, capabilityValue(rows, key, lighting.freshness !== 'unknown')])),
      microphone: microphone(rows, kind.value),
      availability: availabilityState(status, now),
      lighting,
      group: { groupId: null, groupName: null, current: 'unknown', lastKnown: 'unknown', evidence: 'unknown', confirmedAt: null },
      savedLookIds: [],
      issues
    };
  });
  const lightByCanonicalId = new Map(lights.filter(light => light.canonicalDeviceId).map(light => [light.canonicalDeviceId, light]));

  const rooms = [...resourceRooms.entries()].sort(([, left], [, right]) => compare(left, right)).map(([key, name], index) => ({
    id: `room.${String(index + 1).padStart(3, '0')}`,
    key,
    name,
    deviceIds: []
  }));
  const roomByKey = new Map(rooms.map(room => [room.key, room]));
  for (const light of lights) if (light.roomCandidateNames.length === 1) {
    const room = roomByKey.get(roomKey(light.roomCandidateNames[0]));
    light.roomId = room?.id ?? null;
    if (room) room.deviceIds.push(light.id);
  }
  for (const room of rooms) {
    room.deviceIds.sort(compare);
    delete room.key;
  }

  const normalizedGroups = groupRows.filter(record).map(group => ({
    legacyId: canonical(group.id),
    name: text(typeof groupNames[group.id] === 'string' ? groupNames[group.id] : group.name, 'Light group', 64),
    leader: record(group.leader) ? group.leader : group,
    followers: group.followers ?? [],
    removalPending: group.removalPending === true || Array.isArray(group.pendingRemovalIds) && group.pendingRemovalIds.length > 0
  })).filter(group => group.legacyId).sort((left, right) => compare(left.legacyId, right.legacyId));

  const groups = normalizedGroups.map((group, index) => {
    const id = `group.${String(index + 1).padStart(3, '0')}`;
    const rows = [group.leader, ...group.followers].filter(record).slice(0, MAX_MEMBERS);
    const members = [];
    let unmatchedMemberCount = 0;
    for (const row of rows) {
      const deviceId = canonical(row.id);
      const light = deviceId ? lightByCanonicalId.get(deviceId) : null;
      if (!light) { unmatchedMemberCount += 1; continue; }
      const observation = memberObservation(row, statuses[deviceId], group.legacyId, now);
      members.push({ deviceId: light.id, ...observation });
      const stronger = light.group.evidence !== 'fresh' || observation.evidence === 'fresh';
      if (stronger) light.group = { groupId: id, groupName: group.name, ...observation };
    }
    const evidence = members.length && members.every(member => member.evidence === 'fresh') ? 'fresh' : members.some(member => member.evidence !== 'unknown') ? 'stale' : 'unknown';
    const issues = [];
    if (unmatchedMemberCount) issues.push(issue('member-needs-identification', 'One or more saved group members need to be identified.'));
    if (group.removalPending) issues.push(issue('group-change-pending', 'A saved group change still needs confirmation.'));
    if (evidence !== 'fresh') issues.push(issue('group-state-needs-check', 'Check this group before changing its membership.'));
    return {
      id,
      actionTargetId: group.legacyId,
      name: group.name,
      evidence,
      members: members.sort((left, right) => compare(left.deviceId, right.deviceId)),
      unmatchedMemberCount,
      issues
    };
  });

  for (const light of lights) if (!light.group.groupId && light.canonicalDeviceId) {
    const observation = groupObservation(statuses[light.canonicalDeviceId], null, now);
    if (observation?.current === 'independent') light.group = { groupId: null, groupName: null, ...observation };
  }

  const validLooks = lookRows.map(normalizeLook).filter(Boolean).filter(look => lightByCanonicalId.has(look.deviceId));
  validLooks.sort((left, right) => compare(`${left.deviceId}\u0000${left.name}\u0000${left.createdAt ?? 0}\u0000${left.legacyId ?? ''}`, `${right.deviceId}\u0000${right.name}\u0000${right.createdAt ?? 0}\u0000${right.legacyId ?? ''}`));
  const savedLooks = validLooks.map((look, index) => ({ id: `look.${String(index + 1).padStart(3, '0')}`, ...look }));
  for (const look of savedLooks) lightByCanonicalId.get(look.deviceId).savedLookIds.push(look.id);

  const suggestions = [
    ...groups.map(group => ({ kind: 'group', id: group.id, name: group.name, attention: group.issues.length > 0 })),
    ...rooms.map(room => ({ kind: 'room', id: room.id, name: room.name, attention: false })),
    ...lights.filter(light => light.group.current === 'independent' || light.group.current === 'separate' || light.group.current === 'unknown').map(light => ({ kind: 'device', id: light.id, name: light.name, attention: light.issues.length > 0 || light.availability.reachability === 'unreachable' }))
  ].slice(0, 12);

  if (lights.some(light => light.homeBinding === 'review-required')) globalIssues.push({
    ...issue('home-review-required', 'Review which saved lights belong to this Home before creating Home access.'),
    visibility: 'internal'
  });
  return freeze({
    version: 1,
    kind: 'home-experience-projection',
    generatedAt: now,
    home: { id: homeId, name: homeName, mode, membership: 'unverified-legacy' },
    dashboard: { favorites: [], suggestions, nextEvent: null },
    rooms,
    groups,
    lights,
    savedLooks,
    issues: globalIssues,
    summary: {
      lights: lights.length,
      rooms: rooms.length,
      groups: groups.length,
      savedLooks: savedLooks.length,
      needsAttention: lights.filter(light => light.issues.length || light.availability.reachability === 'unreachable').length + groups.filter(group => group.issues.length).length
    }
  });
}

export function homeExperienceLight(projection, id) {
  if (projection?.kind !== 'home-experience-projection' || typeof id !== 'string') return null;
  return projection.lights.find(light => light.id === id) ?? null;
}
