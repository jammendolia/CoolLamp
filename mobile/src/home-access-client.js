const OPAQUE_ID = /^(?!0{32}$)[a-f0-9]{32}$/;
const DEVICE_ID = /^(?!0{12}$)[a-f0-9]{12}$/;
const encoder = new TextEncoder();
const roles = new Set(['owner', 'admin', 'member', 'guest']);
const phoneStates = new Set(['active', 'revoked']);
const invitationStates = new Set(['issued', 'accepting', 'accepted', 'expired', 'cancelled']);
const targetStates = new Set(['pending', 'unavailable', 'rejected', 'uncertain']);

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, fields, label) {
  if (!record(value)) throw Error(`Invalid ${label}.`);
  const actual = Object.keys(value).sort(), expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw Error(`Unexpected ${label} field.`);
}

function text(value, label, max = 64) {
  if (typeof value !== 'string' || value !== value.trim() || !value || encoder.encode(value).length > max || /[\u0000-\u001f\u007f]/.test(value)) throw Error(`Invalid ${label}.`);
  return value;
}

function opaque(value, label) {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw Error(`Invalid ${label}.`);
  return value;
}

function timestamp(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(Date.parse(value)).toISOString() !== value) throw Error(`Invalid ${label}.`);
  return value;
}

function list(value, label, max) {
  if (!Array.isArray(value) || value.length > max) throw Error(`Invalid ${label}.`);
  return value;
}

function nullableTimestamp(value, label) {
  return value === null ? null : timestamp(value, label);
}

function scope(raw, label) {
  exact(raw, ['kind', 'targetNames'], label);
  if (!['home', 'targets'].includes(raw.kind)) throw Error(`Invalid ${label}.`);
  const targetNames = list(raw.targetNames, `${label} targets`, 64).map((value, index) => text(value, `${label} target ${index}`));
  if (raw.kind === 'home' && targetNames.length || raw.kind === 'targets' && !targetNames.length) throw Error(`Invalid ${label}.`);
  return { kind: raw.kind, targetNames };
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function homeName(value) {
  return text(value || 'My home', 'Home name');
}

function phone(raw, personId) {
  exact(raw, ['id', 'personId', 'displayName', 'status', 'isThisPhone'], 'phone');
  if (raw.personId !== personId || !phoneStates.has(raw.status) || typeof raw.isThisPhone !== 'boolean') throw Error('Invalid phone access.');
  return { id: opaque(raw.id, 'phone ID'), personId, displayName: text(raw.displayName, 'phone name'), status: raw.status, isThisPhone: raw.isThisPhone };
}

function person(raw, installationId) {
  exact(raw, ['id', 'displayName', 'role', 'status', 'expiresAt', 'scope', 'isYou', 'phones'], 'person');
  const id = opaque(raw.id, 'person ID');
  if (!roles.has(raw.role) || !phoneStates.has(raw.status) || typeof raw.isYou !== 'boolean') throw Error('Invalid person access.');
  const expiresAt = nullableTimestamp(raw.expiresAt, 'person access expiration'), accessScope = scope(raw.scope, 'person access scope');
  if (raw.role === 'guest' && (expiresAt === null || accessScope.kind !== 'targets')) throw Error('Invalid guest access.');
  const phones = list(raw.phones, 'person phones', 16).map(value => phone(value, id));
  if (new Set(phones.map(value => value.id)).size !== phones.length) throw Error('Duplicate phone access.');
  if (phones.filter(value => value.isThisPhone).length > 1 || phones.some(value => value.isThisPhone && value.id !== installationId)) throw Error('Wrong current phone.');
  return { id, displayName: text(raw.displayName, 'person name'), role: raw.role, status: raw.status, expiresAt, scope: accessScope, isYou: raw.isYou, phones };
}

function invitation(raw) {
  exact(raw, ['id', 'displayName', 'role', 'status', 'expiresAt', 'accessExpiresAt', 'scope'], 'invitation');
  if (!invitationStates.has(raw.status)) throw Error('Invalid invitation status.');
  const invitationRole = roles.has(raw.role) && raw.role !== 'owner' ? raw.role : null, accessExpiresAt = nullableTimestamp(raw.accessExpiresAt, 'invited access expiration'), accessScope = scope(raw.scope, 'invitation access scope');
  if (!invitationRole || invitationRole === 'guest' && (accessExpiresAt === null || accessScope.kind !== 'targets')) throw Error('Invalid invitation access.');
  return { id: opaque(raw.id, 'invitation ID'), displayName: text(raw.displayName, 'invitation name'), role: invitationRole, status: raw.status, expiresAt: timestamp(raw.expiresAt, 'invitation expiration'), accessExpiresAt, scope: accessScope };
}

function pendingTarget(raw) {
  exact(raw, ['deviceId', 'displayName', 'state'], 'pending product');
  if (typeof raw.deviceId !== 'string' || !DEVICE_ID.test(raw.deviceId) || !targetStates.has(raw.state)) throw Error('Invalid pending product.');
  return { deviceId: raw.deviceId, displayName: text(raw.displayName, 'product name'), state: raw.state };
}

export function validateHomeAccessAppView(raw, { homeId, installationId, now = Date.now() } = {}) {
  exact(raw, ['version', 'kind', 'home', 'installationId', 'observedAt', 'freshUntil', 'canInvite', 'people', 'invitations', 'pendingTargets'], 'Home access view');
  if (raw.version !== 1 || raw.kind !== 'home-access-app-view' || typeof raw.canInvite !== 'boolean') throw Error('Invalid Home access view.');
  exact(raw.home, ['id', 'name'], 'Home access Home');
  const parsedHome = { id: opaque(raw.home.id, 'Home ID'), name: text(raw.home.name, 'Home name') };
  const parsedInstallation = opaque(raw.installationId, 'view installation ID');
  if (homeId && parsedHome.id !== homeId || installationId && parsedInstallation !== installationId) throw Error('Home access view changed identity.');
  const observedAt = timestamp(raw.observedAt, 'Home access observation'), freshUntil = timestamp(raw.freshUntil, 'Home access freshness');
  if (Date.parse(freshUntil) < Date.parse(observedAt) || Date.parse(freshUntil) - Date.parse(observedAt) > 300000 || Date.parse(observedAt) > now + 30000) throw Error('Invalid Home access freshness.');
  const people = list(raw.people, 'people', 64).map(value => person(value, parsedInstallation));
  const invitations = list(raw.invitations, 'invitations', 128).map(invitation);
  const pendingTargets = list(raw.pendingTargets, 'pending products', 256).map(pendingTarget);
  for (const values of [people, invitations, pendingTargets]) {
    const ids = values.map(value => value.id || value.deviceId);
    if (new Set(ids).size !== ids.length) throw Error('Duplicate Home access item.');
  }
  const allPhones = people.flatMap(value => value.phones);
  if (new Set(allPhones.map(value => value.id)).size !== allPhones.length) throw Error('Duplicate phone access.');
  const currentPhones = allPhones.filter(value => value.isThisPhone);
  const currentPeople = people.filter(value => value.isYou);
  if (currentPhones.length !== 1 || currentPeople.length !== 1 ||
      currentPhones[0].id !== parsedInstallation || currentPhones[0].status !== 'active' ||
      currentPeople[0].status !== 'active' || currentPhones[0].personId !== currentPeople[0].id) {
    throw Error('This phone is not represented by the Home access view.');
  }
  const fresh = now >= Date.parse(observedAt) - 30000 && now <= Date.parse(freshUntil) + 30000;
  return freeze({
    version: 1, state: 'ready', home: parsedHome, installationId: parsedInstallation,
    observedAt, freshUntil, fresh, canManagePeople: raw.canInvite, canInvite: raw.canInvite && fresh,
    people, invitations, pendingTargets
  });
}

export function homeAccessPeopleState(value) {
  if (!record(value) || value.version !== 1 || !record(value.home) || typeof value.home.name !== 'string') throw Error('Invalid People and access source.');
  const realHomeId = typeof value.home.id === 'string' && OPAQUE_ID.test(value.home.id) ? value.home.id : null;
  if (value.state === 'ready' || value.state === 'stale') {
    const current = value.people.find(person => person.isYou && person.status === 'active' && person.phones.some(phone => phone.isThisPhone && phone.status === 'active'));
    if (!current || !realHomeId) throw Error('Invalid current People and access source.');
    return freeze({
      version: 1,
      state: value.state === 'ready' ? 'ready' : 'unavailable',
      home: { id: realHomeId, name: value.home.name },
      viewer: { personId: current.id, installationId: value.installationId, canManagePeople: value.canManagePeople === true },
      people: value.people.map(person => ({ id: person.id, name: person.displayName, role: person.role, status: person.status, expiresAt: person.expiresAt, scope: person.scope, phones: person.phones.map(phone => ({ id: phone.id, name: phone.displayName, status: phone.status })) })),
      invitations: value.invitations.map(invitation => ({ id: invitation.id, recipientName: invitation.displayName, role: invitation.role, state: invitation.status, expiresAt: invitation.expiresAt, accessExpiresAt: invitation.accessExpiresAt, scope: invitation.scope })),
      pendingTargets: value.pendingTargets.map(target => ({ id: target.deviceId, name: target.displayName, outcome: target.state })),
      activity: null
    });
  }
  const mapped = value.state === 'phone-required' ? 'not-configured' : value.state;
  if (!['not-configured', 'unavailable', 'revoked', 'failed', 'recovery-required', 'owner-help-required'].includes(mapped)) throw Error('Unsupported People and access source state.');
  return freeze({ version: 1, state: mapped, home: { id: realHomeId, name: value.home.name }, viewer: null, people: [], invitations: [], pendingTargets: [], activity: null });
}

function state(value) {
  return freeze(value);
}

export class HomeAccessClient {
  constructor({ identity, provider = null, now = () => Date.now() } = {}) {
    if (!identity || typeof identity.ensure !== 'function' || provider !== null && typeof provider.readAccess !== 'function') throw Error('Invalid Home access client.');
    this.identity = identity;
    this.provider = provider;
    this.now = now;
  }

  async refresh({ homeName: requestedName = 'My home', homeId = null, signal, onProgress } = {}) {
    const name = homeName(requestedName);
    const progress = phase => { if (!signal?.aborted && typeof onProgress === 'function') onProgress(phase); };
    progress('checking-phone');
    let installation;
    try {
      installation = await this.identity.ensure({ signal });
    } catch (error) {
      if (error?.cancelled || signal?.aborted) throw Object.assign(Error('Access check stopped.'), { cancelled: true });
      const accessState = error?.code === 'native-required' ? 'phone-required' : error?.code === 'identity-recovery' ? 'recovery-required' : 'failed';
      return state({ version: 1, state: accessState, home: { name }, issue: { title: 'Access could not be checked', detail: error?.message || 'Unlock your phone and try again.', action: accessState === 'recovery-required' ? null : 'try-again' }, people: [], invitations: [], pendingTargets: [], canInvite: false });
    }
    if (signal?.aborted) throw Object.assign(Error('Access check stopped.'), { cancelled: true });
    if (!this.provider || homeId === null) {
      return state({ version: 1, state: 'not-configured', home: { name }, installation, people: [], invitations: [], pendingTargets: [], canInvite: false });
    }
    if (!OPAQUE_ID.test(homeId)) return state({ version: 1, state: 'owner-help-required', home: { name }, installation, issue: { title: 'Access needs attention', detail: 'Ask a Home owner to add this phone again.', action: null }, people: [], invitations: [], pendingTargets: [], canInvite: false });
    progress('checking-home');
    let raw;
    try {
      raw = await this.provider.readAccess({ homeId, installation, signal });
    } catch (error) {
      if (error?.cancelled || signal?.aborted) throw Object.assign(Error('Access check stopped.'), { cancelled: true });
      return state({ version: 1, state: 'failed', home: { name }, installation, issue: { title: 'Access could not be refreshed', detail: 'Check your connection and try again.', action: 'try-again' }, people: [], invitations: [], pendingTargets: [], canInvite: false });
    }
    if (signal?.aborted) throw Object.assign(Error('Access check stopped.'), { cancelled: true });
    if (record(raw) && raw.version === 1 && raw.kind === 'home-access-revoked') {
      exact(raw, ['version', 'kind', 'homeId', 'observedAt'], 'revoked Home access');
      if (raw.homeId !== homeId) throw Error('Revoked Home access changed identity.');
      timestamp(raw.observedAt, 'revocation observation');
      return state({ version: 1, state: 'revoked', home: { name }, installation, people: [], invitations: [], pendingTargets: [], canInvite: false });
    }
    try {
      const view = validateHomeAccessAppView(raw, { homeId, installationId: installation.installationId, now: this.now() });
      return view.fresh ? view : state({ ...view, state: 'stale', canInvite: false, issue: { title: 'Access could not be refreshed', detail: 'Check your connection and try again.', action: 'try-again' } });
    } catch {
      return state({ version: 1, state: 'owner-help-required', home: { name }, installation, issue: { title: 'Access needs attention', detail: 'Ask a Home owner to check this phone’s access.', action: null }, people: [], invitations: [], pendingTargets: [], canInvite: false });
    }
  }
}
