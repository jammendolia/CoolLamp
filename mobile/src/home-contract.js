// Home Contract v1 is a read-only boundary for app prototypes and fixtures.
// It deliberately contains no persistence, discovery, routing, or mutation code.
const encoder = new TextEncoder();
const RESOURCE_LIMIT = 128;
const DEVICE_ID = /^[a-f0-9]{12}$/;
const NONCE = /^[a-f0-9]{16}$/;
const KEY = /^[a-z][a-z0-9._-]{0,63}$/;
const roles = new Set(['owner', 'admin', 'member', 'guest']);
const permissions = new Set(['control', 'organize', 'automations', 'people', 'device-care', 'integrations']);
const rolePermissions = {
  owner: permissions,
  admin: new Set(['control', 'organize', 'automations', 'people', 'device-care', 'integrations']),
  member: new Set(['control', 'automations']),
  guest: new Set(['control', 'device-care'])
};
const targetKinds = new Set(['home', 'room', 'group', 'device']);
const deviceKinds = new Set(['coollamp', 'coolstrip-controller', 'bridge', 'super-lamp']);
const serviceKinds = new Set(['home-authority', 'schedule-executor', 'away-access', 'device-relay', 'audio-source']);
const serviceStates = new Set(['ready', 'unavailable', 'migrating', 'standby']);

function parse(raw, maxBytes = 131072) {
  if (typeof raw !== 'string') return raw;
  if (encoder.encode(raw).length > maxBytes) throw Error('Home snapshot is too large.');
  return JSON.parse(raw);
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`Invalid ${label}.`);
  return value;
}

function only(value, keys, label) {
  record(value, label);
  const allowed = new Set(keys);
  if (Object.keys(value).some(key => !allowed.has(key))) throw Error(`Unexpected ${label} field.`);
}

function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw Error(`Invalid ${label}.`);
  return value;
}

function text(value, maxBytes, label) {
  if (typeof value !== 'string' || !value.trim() || encoder.encode(value).length > maxBytes || /[\u0000-\u001f\u007f]/.test(value)) throw Error(`Invalid ${label}.`);
  return value.trim();
}

function key(value, label) {
  if (typeof value !== 'string' || !KEY.test(value)) throw Error(`Invalid ${label}.`);
  return value;
}

function deviceId(value, label = 'device ID') {
  if (typeof value !== 'string' || !DEVICE_ID.test(value)) throw Error(`Invalid ${label}.`);
  return value;
}

function nonce(value, label) {
  if (typeof value !== 'string' || !NONCE.test(value) || /^0+$/.test(value)) throw Error(`Invalid ${label}.`);
  return value;
}

function oneOf(value, values, label) {
  if (!values.has(value)) throw Error(`Invalid ${label}.`);
  return value;
}

function list(value, label, max = RESOURCE_LIMIT) {
  if (!Array.isArray(value) || value.length > max) throw Error(`Invalid ${label}.`);
  return value;
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw Error(`Duplicate ${label}.`);
}

function timestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error(`Invalid ${label}.`);
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (new Date(value).toISOString() !== canonical) throw Error(`Invalid ${label}.`);
  return value;
}

function timezone(value) {
  text(value, 64, 'Home timezone');
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); }
  catch { throw Error('Invalid Home timezone.'); }
  return value;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function mapUnique(items, label) {
  const result = new Map();
  for (const item of items) {
    if (result.has(item.id)) throw Error(`Duplicate ${label} ID.`);
    result.set(item.id, item);
  }
  return result;
}

function homeValue(raw) {
  only(raw, ['id', 'name', 'mode', 'timezone', 'location', 'revision', 'authorizationRevision'], 'Home');
  let location = null;
  if (raw.location !== null) {
    location = record(raw.location, 'Home location');
    only(location, ['latitude', 'longitude'], 'Home location');
    if (typeof location.latitude !== 'number' || location.latitude < -90 || location.latitude > 90 || typeof location.longitude !== 'number' || location.longitude < -180 || location.longitude > 180) throw Error('Invalid Home location.');
    location = { latitude: location.latitude, longitude: location.longitude };
  }
  return {
    id: key(raw.id, 'Home ID'),
    name: text(raw.name, 64, 'Home name'),
    mode: oneOf(raw.mode, new Set(['local-only', 'account-linked', 'hybrid']), 'Home mode'),
    timezone: timezone(raw.timezone),
    location,
    revision: integer(raw.revision, 1, 0xffffffff, 'Home revision'),
    authorizationRevision: integer(raw.authorizationRevision, 1, 0xffffffff, 'authorization revision')
  };
}

function authorityValue(raw) {
  only(raw, ['serviceId', 'hostDeviceId', 'generation', 'bootSession', 'state'], 'Home authority');
  return {
    serviceId: key(raw.serviceId, 'authority service ID'),
    hostDeviceId: deviceId(raw.hostDeviceId, 'authority host device ID'),
    generation: integer(raw.generation, 1, 0xffffffff, 'authority generation'),
    bootSession: nonce(raw.bootSession, 'authority boot session'),
    state: oneOf(raw.state, new Set(['ready', 'unavailable', 'migrating']), 'authority state')
  };
}

function peopleValue(raw) {
  return list(raw, 'people').map(item => {
    only(item, ['id', 'name'], 'person');
    return { id: key(item.id, 'person ID'), name: text(item.name, 64, 'person name') };
  });
}

function membershipsValue(raw) {
  return list(raw, 'memberships').map(item => {
    only(item, ['id', 'personId', 'role', 'status'], 'membership');
    return {
      id: key(item.id, 'membership ID'),
      personId: key(item.personId, 'membership person ID'),
      role: oneOf(item.role, roles, 'membership role'),
      status: oneOf(item.status, new Set(['pending', 'active', 'revoked']), 'membership status')
    };
  });
}

function installationsValue(raw) {
  return list(raw, 'phone installations').map(item => {
    only(item, ['id', 'personId', 'name', 'status'], 'phone installation');
    return {
      id: key(item.id, 'phone installation ID'),
      personId: key(item.personId, 'phone installation person ID'),
      name: text(item.name, 64, 'phone installation name'),
      status: oneOf(item.status, new Set(['active', 'revoked']), 'phone installation status')
    };
  });
}

function grantsValue(raw) {
  return list(raw, 'grants', 256).map(item => {
    only(item, ['id', 'kind', 'subjectType', 'subjectId', 'installationId', 'authorizationRevision', 'permissions', 'scope', 'status', 'expiresAt'], 'grant');
    const scope = record(item.scope, 'grant scope');
    only(scope, ['kind', 'targets'], 'grant scope');
    const scopeKind = oneOf(scope.kind, new Set(['home', 'targets']), 'grant scope kind');
    const targets = list(scope.targets, 'grant targets', 64).map(target => targetValue(target, 'grant target'));
    unique(targets.map(target => `${target.kind}:${target.id}`), 'grant target');
    if ((scopeKind === 'home' && targets.length) || (scopeKind === 'targets' && !targets.length)) throw Error('Invalid grant target scope.');
    const grantPermissions = list(item.permissions, 'grant permissions', permissions.size).map(value => oneOf(value, permissions, 'grant permission'));
    unique(grantPermissions, 'grant permission');
    const subjectType = oneOf(item.subjectType, new Set(['membership', 'integration']), 'grant subject type');
    const installationId = item.installationId === null ? null : key(item.installationId, 'grant phone installation ID');
    if ((subjectType === 'membership') !== (installationId !== null)) throw Error('A person grant must name one phone installation.');
    return {
      id: key(item.id, 'grant ID'),
      kind: oneOf(item.kind, new Set(['member', 'temporary-help', 'integration']), 'grant kind'),
      subjectType,
      subjectId: key(item.subjectId, 'grant subject ID'),
      installationId,
      authorizationRevision: integer(item.authorizationRevision, 1, 0xffffffff, 'grant authorization revision'),
      permissions: grantPermissions,
      scope: { kind: scopeKind, targets },
      status: oneOf(item.status, new Set(['active', 'revoked']), 'grant status'),
      expiresAt: timestamp(item.expiresAt, 'grant expiration', { nullable: true })
    };
  });
}

function roomsValue(raw) {
  return list(raw, 'rooms').map(item => {
    only(item, ['id', 'name'], 'room');
    return { id: key(item.id, 'room ID'), name: text(item.name, 64, 'room name') };
  });
}

function devicesValue(raw) {
  return list(raw, 'devices').map(item => {
    only(item, ['id', 'name', 'kind', 'roomId', 'state', 'capabilities', 'audioInput'], 'device');
    const state = record(item.state, 'device state');
    only(state, ['reachability', 'freshness', 'confirmedAt'], 'device state');
    const audioInput = record(item.audioInput, 'device audio input');
    only(audioInput, ['installed', 'available', 'canDriveOtherLights'], 'device audio input');
    if (typeof audioInput.installed !== 'boolean' || typeof audioInput.available !== 'boolean' || typeof audioInput.canDriveOtherLights !== 'boolean') throw Error('Invalid device audio input.');
    if (!audioInput.installed && (audioInput.available || audioInput.canDriveOtherLights)) throw Error('An absent microphone cannot provide audio.');
    const capabilities = list(item.capabilities, 'device capabilities', 32).map(value => key(value, 'device capability'));
    unique(capabilities, 'device capability');
    if (capabilities.includes('audio-input') !== audioInput.installed) throw Error('Device audio capability disagrees with provisioned hardware.');
    return {
      id: deviceId(item.id),
      name: text(item.name, 64, 'device name'),
      kind: oneOf(item.kind, deviceKinds, 'device kind'),
      roomId: item.roomId === null ? null : key(item.roomId, 'device room ID'),
      state: {
        reachability: oneOf(state.reachability, new Set(['reachable', 'unreachable', 'unknown']), 'device reachability'),
        freshness: oneOf(state.freshness, new Set(['fresh', 'stale', 'unknown']), 'device freshness'),
        confirmedAt: timestamp(state.confirmedAt, 'device confirmation time')
      },
      capabilities,
      audioInput: { installed: audioInput.installed, available: audioInput.available, canDriveOtherLights: audioInput.canDriveOtherLights }
    };
  });
}

function groupsValue(raw) {
  return list(raw, 'groups').map(item => {
    only(item, ['id', 'name', 'members'], 'group');
    const members = list(item.members, 'group members', 64).map(member => {
      only(member, ['deviceId', 'participation'], 'group member');
      return { deviceId: deviceId(member.deviceId, 'group device ID'), participation: oneOf(member.participation, new Set(['playing', 'separate', 'paused']), 'group participation') };
    });
    unique(members.map(member => member.deviceId), 'group device');
    if (!members.length) throw Error('A group must contain at least one device.');
    return { id: key(item.id, 'group ID'), name: text(item.name, 64, 'group name'), members };
  });
}

function targetValue(raw, label) {
  only(raw, ['kind', 'id'], label);
  const kindValue = oneOf(raw.kind, targetKinds, `${label} kind`);
  const id = kindValue === 'device' ? deviceId(raw.id, `${label} ID`) : key(raw.id, `${label} ID`);
  return { kind: kindValue, id };
}

function scenesValue(raw) {
  return list(raw, 'Scenes').map(item => {
    only(item, ['id', 'name', 'targets'], 'Scene');
    const targets = list(item.targets, 'Scene targets', 32).map(target => targetValue(target, 'Scene target'));
    if (!targets.length) throw Error('A Scene must contain at least one target.');
    unique(targets.map(target => `${target.kind}:${target.id}`), 'Scene target');
    return { id: key(item.id, 'Scene ID'), name: text(item.name, 64, 'Scene name'), targets };
  });
}

function servicesValue(raw) {
  return list(raw, 'Home services').map(item => {
    only(item, ['id', 'name', 'kind', 'hostDeviceId', 'state'], 'Home service');
    return {
      id: key(item.id, 'Home service ID'),
      name: text(item.name, 64, 'Home service name'),
      kind: oneOf(item.kind, serviceKinds, 'Home service kind'),
      hostDeviceId: deviceId(item.hostDeviceId, 'Home service host device ID'),
      state: oneOf(item.state, serviceStates, 'Home service state')
    };
  });
}

function schedulesValue(raw) {
  return list(raw, 'schedules').map(item => {
    only(item, ['id', 'name', 'enabled', 'executorServiceId', 'trigger', 'actions', 'state'], 'schedule');
    const trigger = record(item.trigger, 'schedule trigger');
    only(trigger, ['kind', 'minute', 'offsetMinutes', 'days'], 'schedule trigger');
    const triggerKind = oneOf(trigger.kind, new Set(['clock', 'sunrise', 'sunset']), 'schedule trigger kind');
    if (triggerKind === 'clock') integer(trigger.minute, 0, 1439, 'schedule clock minute');
    else if (trigger.minute !== null) throw Error('Sun schedule trigger cannot contain a clock minute.');
    integer(trigger.offsetMinutes, -720, 720, 'schedule trigger offset');
    const days = list(trigger.days, 'schedule days', 7).map(day => integer(day, 0, 6, 'schedule day'));
    unique(days, 'schedule day');
    if (!days.length) throw Error('A schedule needs at least one day.');
    const actions = list(item.actions, 'schedule actions', 16).map(action => {
      only(action, ['kind', 'target'], 'schedule action');
      return { kind: oneOf(action.kind, new Set(['power-on', 'power-off', 'apply-scene']), 'schedule action'), target: targetValue(action.target, 'schedule target') };
    });
    if (!actions.length) throw Error('A schedule needs at least one action.');
    if (typeof item.enabled !== 'boolean') throw Error('Invalid schedule enabled state.');
    return {
      id: key(item.id, 'schedule ID'),
      name: text(item.name, 64, 'schedule name'),
      enabled: item.enabled,
      executorServiceId: key(item.executorServiceId, 'schedule executor service ID'),
      trigger: { kind: triggerKind, minute: trigger.minute, offsetMinutes: trigger.offsetMinutes, days },
      actions,
      state: oneOf(item.state, new Set(['ready', 'paused', 'attention']), 'schedule state')
    };
  });
}

function integrationsValue(raw) {
  return list(raw, 'integrations').map(item => {
    only(item, ['id', 'name', 'kind', 'status', 'grantId'], 'integration');
    return {
      id: key(item.id, 'integration ID'),
      name: text(item.name, 64, 'integration name'),
      kind: oneOf(item.kind, new Set(['home-assistant', 'alexa']), 'integration kind'),
      status: oneOf(item.status, new Set(['connected', 'disconnected', 'revoked']), 'integration status'),
      grantId: item.grantId === null ? null : key(item.grantId, 'integration grant ID')
    };
  });
}

function assertTarget(target, home, rooms, groups, devices, label) {
  const valid = target.kind === 'home' ? target.id === home.id : target.kind === 'room' ? rooms.has(target.id) : target.kind === 'group' ? groups.has(target.id) : devices.has(target.id);
  if (!valid) throw Error(`${label} leaves its Home.`);
}

export function validateHomeSnapshot(raw) {
  const source = parse(raw);
  only(source, ['version', 'home', 'authority', 'sequence', 'people', 'memberships', 'installations', 'grants', 'rooms', 'devices', 'groups', 'scenes', 'schedules', 'services', 'integrations'], 'Home snapshot');
  if (source.version !== 1) throw Error('Unsupported Home Contract version.');
  const value = {
    version: 1,
    home: homeValue(source.home),
    authority: authorityValue(source.authority),
    sequence: integer(source.sequence, 0, Number.MAX_SAFE_INTEGER, 'Home event sequence'),
    people: peopleValue(source.people),
    memberships: membershipsValue(source.memberships),
    installations: installationsValue(source.installations),
    grants: grantsValue(source.grants),
    rooms: roomsValue(source.rooms),
    devices: devicesValue(source.devices),
    groups: groupsValue(source.groups),
    scenes: scenesValue(source.scenes),
    schedules: schedulesValue(source.schedules),
    services: servicesValue(source.services),
    integrations: integrationsValue(source.integrations)
  };

  const people = mapUnique(value.people, 'person');
  const memberships = mapUnique(value.memberships, 'membership');
  const installations = mapUnique(value.installations, 'phone installation');
  const grants = mapUnique(value.grants, 'grant');
  const rooms = mapUnique(value.rooms, 'room');
  const devices = mapUnique(value.devices, 'device');
  const groups = mapUnique(value.groups, 'group');
  mapUnique(value.scenes, 'Scene');
  const schedules = mapUnique(value.schedules, 'schedule');
  const services = mapUnique(value.services, 'Home service');
  const integrations = mapUnique(value.integrations, 'integration');

  if (value.memberships.filter(item => item.status === 'active' && item.role === 'owner').length !== 1) throw Error('A Home needs exactly one active owner.');
  unique(value.memberships.map(item => item.personId), 'membership person');
  for (const membership of value.memberships) if (!people.has(membership.personId)) throw Error('Membership person is not in this Home.');
  for (const installation of value.installations) if (!people.has(installation.personId)) throw Error('Phone installation person is not in this Home.');
  for (const device of value.devices) if (device.roomId !== null && !rooms.has(device.roomId)) throw Error('Device room is not in this Home.');
  for (const group of value.groups) for (const member of group.members) if (!devices.has(member.deviceId)) throw Error('Group device is not in this Home.');
  for (const scene of value.scenes) for (const target of scene.targets) assertTarget(target, value.home, rooms, groups, devices, 'Scene target');
  for (const schedule of value.schedules) {
    const executor = services.get(schedule.executorServiceId);
    if (!executor || executor.kind !== 'schedule-executor') throw Error('Schedule executor is not a Home scheduling service.');
    for (const action of schedule.actions) assertTarget(action.target, value.home, rooms, groups, devices, 'Schedule target');
  }
  for (const service of value.services) {
    const host = devices.get(service.hostDeviceId);
    if (!host) throw Error('Home service host is not in this Home.');
    if (service.kind === 'audio-source' && !host.audioInput.installed) throw Error('Audio service host has no provisioned microphone.');
  }
  const authorityService = services.get(value.authority.serviceId);
  if (!authorityService || authorityService.kind !== 'home-authority' || authorityService.hostDeviceId !== value.authority.hostDeviceId) throw Error('Home authority does not match its service host.');
  if (value.services.filter(service => service.kind === 'home-authority').length !== 1 || authorityService.state !== value.authority.state) throw Error('A Home needs one matching authority service.');
  for (const grant of value.grants) {
    if (grant.status === 'active' && grant.authorizationRevision !== value.home.authorizationRevision) throw Error('Active grant is from an old authorization revision.');
    if (grant.authorizationRevision > value.home.authorizationRevision) throw Error('Grant authorization revision is in the future.');
    if (grant.subjectType === 'membership') {
      const membership = memberships.get(grant.subjectId);
      const installation = installations.get(grant.installationId);
      if (!membership || !installation || membership.personId !== installation.personId) throw Error('Person grant does not match its member and phone.');
      if (grant.status === 'active' && (membership.status !== 'active' || installation.status !== 'active')) throw Error('Active grant points to inactive access.');
      if (grant.kind === 'integration') throw Error('Person grant cannot be an integration grant.');
      if (grant.kind === 'temporary-help' && (membership.role !== 'guest' || grant.scope.kind !== 'targets' || grant.expiresAt === null)) throw Error('Temporary help must be expiring, guest, and target-scoped.');
      if (grant.permissions.some(permission => !rolePermissions[membership.role].has(permission))) throw Error('Grant permission exceeds its membership role.');
    } else {
      const integration = integrations.get(grant.subjectId);
      if (!integration || grant.kind !== 'integration') throw Error('Integration grant does not match its integration.');
    }
    for (const target of grant.scope.targets) assertTarget(target, value.home, rooms, groups, devices, 'Grant target');
  }
  for (const integration of value.integrations) {
    const grant = integration.grantId === null ? null : grants.get(integration.grantId);
    if (integration.grantId !== null && (!grant || grant.subjectType !== 'integration' || grant.subjectId !== integration.id)) throw Error('Integration grant is not scoped to this Home integration.');
    if (integration.status === 'connected' && grant?.status !== 'active') throw Error('Connected integration needs an active Home grant.');
    if (integration.status === 'revoked' && grant?.status !== 'revoked') throw Error('Revoked integration needs a revoked Home grant.');
  }
  if (!schedules.size && value.services.some(service => service.kind === 'schedule-executor')) {
    // A Home may have a scheduling-capable hub before its first schedule.
  }
  return freeze(value);
}

function visibleDeviceIds(snapshot, grant) {
  if (grant.scope.kind === 'home') return new Set(snapshot.devices.map(device => device.id));
  const groups = new Map(snapshot.groups.map(group => [group.id, group]));
  const rooms = new Set(grant.scope.targets.filter(target => target.kind === 'room').map(target => target.id));
  const devices = new Set(grant.scope.targets.filter(target => target.kind === 'device').map(target => target.id));
  for (const target of grant.scope.targets.filter(target => target.kind === 'group')) for (const member of groups.get(target.id)?.members || []) devices.add(member.deviceId);
  for (const device of snapshot.devices) if (device.roomId && rooms.has(device.roomId)) devices.add(device.id);
  return devices;
}

export function compileHomeView(raw, { personId, installationId, grantId, now = Date.now() }) {
  const snapshot = validateHomeSnapshot(raw);
  key(personId, 'view person ID');
  key(installationId, 'view phone installation ID');
  key(grantId, 'view grant ID');
  const membership = snapshot.memberships.find(item => item.personId === personId && item.status === 'active');
  const installation = snapshot.installations.find(item => item.id === installationId && item.personId === personId && item.status === 'active');
  if (!membership || !installation) throw Error('This phone does not have active Home access.');
  const grant = snapshot.grants.find(item => item.id === grantId && item.subjectType === 'membership' && item.subjectId === membership.id && item.installationId === installation.id && item.status === 'active' && (item.expiresAt === null || Date.parse(item.expiresAt) > now));
  if (!grant) throw Error('This phone does not have the selected active Home grant.');
  const allHome = grant.scope.kind === 'home';
  const deviceIds = visibleDeviceIds(snapshot, grant);
  const grantTargets = new Set(grant.scope.targets.map(target => `${target.kind}:${target.id}`));
  const devices = snapshot.devices.filter(device => deviceIds.has(device.id));
  const roomIds = new Set(devices.map(device => device.roomId).filter(Boolean));
  const rooms = snapshot.rooms.filter(room => allHome || roomIds.has(room.id) || grantTargets.has(`room:${room.id}`));
  const groups = snapshot.groups.filter(group => allHome || grantTargets.has(`group:${group.id}`)).map(group => ({ ...group, members: group.members.filter(member => deviceIds.has(member.deviceId)) })).filter(group => group.members.length);
  const targetVisible = target => target.kind === 'home' ? allHome : target.kind === 'room' ? rooms.some(room => room.id === target.id) : target.kind === 'group' ? groups.some(group => group.id === target.id) : deviceIds.has(target.id);
  const scenes = allHome ? snapshot.scenes.filter(scene => scene.targets.every(targetVisible)) : [];
  const schedules = allHome ? snapshot.schedules.filter(schedule => schedule.actions.every(action => targetVisible(action.target))) : [];
  const access = { grantId: grant.id, permissions: grant.permissions, scope: grant.scope, expiresAt: grant.expiresAt };
  const home = allHome ? snapshot.home : {
    id: snapshot.home.id,
    name: snapshot.home.name,
    mode: snapshot.home.mode,
    timezone: snapshot.home.timezone,
    revision: snapshot.home.revision,
    authorizationRevision: snapshot.home.authorizationRevision
  };
  return freeze({
    version: 1,
    home,
    role: membership.role,
    access,
    rooms,
    devices,
    groups,
    scenes,
    schedules,
    connection: { state: snapshot.authority.state, sequence: snapshot.sequence }
  });
}

export function validateHomeEvent(raw, rawSnapshot, { expectedSequence } = {}) {
  const snapshot = validateHomeSnapshot(rawSnapshot);
  const event = parse(raw, 8192);
  only(event, ['version', 'homeId', 'authorityGeneration', 'bootSession', 'sequence', 'authorizationRevision', 'occurredAt', 'change', 'resource'], 'Home event');
  if (event.version !== 1 || event.homeId !== snapshot.home.id || event.authorityGeneration !== snapshot.authority.generation || event.bootSession !== snapshot.authority.bootSession || event.authorizationRevision !== snapshot.home.authorizationRevision) throw Object.assign(Error('Home event authority changed; refresh the Home snapshot.'), { snapshotRequired: true });
  const wanted = expectedSequence ?? snapshot.sequence + 1;
  if (event.sequence !== wanted) throw Object.assign(Error('Home event sequence has a gap; refresh the Home snapshot.'), { snapshotRequired: true });
  const resource = targetValue(event.resource, 'Home event resource');
  const rooms = new Map(snapshot.rooms.map(item => [item.id, item]));
  const groups = new Map(snapshot.groups.map(item => [item.id, item]));
  const devices = new Map(snapshot.devices.map(item => [item.id, item]));
  assertTarget(resource, snapshot.home, rooms, groups, devices, 'Home event resource');
  return freeze({
    version: 1,
    homeId: event.homeId,
    authorityGeneration: event.authorityGeneration,
    bootSession: event.bootSession,
    sequence: integer(event.sequence, 1, Number.MAX_SAFE_INTEGER, 'Home event sequence'),
    authorizationRevision: integer(event.authorizationRevision, 1, 0xffffffff, 'Home event authorization revision'),
    occurredAt: timestamp(event.occurredAt, 'Home event time'),
    change: oneOf(event.change, new Set(['configuration-changed', 'state-confirmed', 'state-stale', 'access-changed']), 'Home event change'),
    resource
  });
}

export function validateHomeFixture(raw) {
  const source = parse(raw, 524288);
  only(source, ['version', 'snapshots', 'events'], 'Home fixture');
  if (source.version !== 1) throw Error('Unsupported Home fixture version.');
  const snapshots = list(source.snapshots, 'Home fixture snapshots', 16).map(validateHomeSnapshot);
  const homeIds = snapshots.map(snapshot => snapshot.home.id);
  unique(homeIds, 'Home');
  const deviceHomes = new Map();
  const authorityHomes = new Map();
  for (const snapshot of snapshots) {
    for (const device of snapshot.devices) {
      if (deviceHomes.has(device.id)) throw Error('A device appears in more than one Home.');
      deviceHomes.set(device.id, snapshot.home.id);
    }
    if (authorityHomes.has(snapshot.authority.hostDeviceId)) throw Error('One Home authority host cannot serve two Homes.');
    authorityHomes.set(snapshot.authority.hostDeviceId, snapshot.home.id);
  }
  const byHome = new Map(snapshots.map(snapshot => [snapshot.home.id, snapshot]));
  const nextSequence = new Map(snapshots.map(snapshot => [snapshot.home.id, snapshot.sequence + 1]));
  const events = list(source.events, 'Home fixture events', 256).map(event => {
    const snapshot = byHome.get(event?.homeId);
    if (!snapshot) throw Error('Home event leaves the fixture.');
    const validated = validateHomeEvent(event, snapshot, { expectedSequence: nextSequence.get(snapshot.home.id) });
    nextSequence.set(snapshot.home.id, validated.sequence + 1);
    return validated;
  });
  return freeze({ version: 1, snapshots, events });
}
