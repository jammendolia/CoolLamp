// Existing-Home review compiler v1.
//
// This module is intentionally pure and read-only. It accepts detached legacy
// snapshots, produces a bounded review proposal, and has no storage, network,
// credential-vault, discovery, device, or mutation dependencies.
const encoder = new TextEncoder();
const MAX_INPUT_BYTES = 512 * 1024;
const MAX_SOURCES = 16;
const MAX_RECORDS = 128;
const MAX_EVIDENCE_NODES = 32768;
const VERIFIED_CAPTURE_MAX_AGE_MS = 5 * 60 * 1000;
const DEVICE_ID = /^[a-f0-9]{12}$/;
const KEY = /^[a-z][a-z0-9._-]{0,63}$/;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;
const SOURCE_FIELDS = new Set([
  'sourceId', 'kind', 'capturedAt', 'homeContext', 'lampRecords',
  'appPreferences', 'groupSnapshot', 'groupRemovalIntents',
  'savedLooksEnvelope', 'bridgeRecords'
]);
const IGNORED_EVIDENCE = /(?:password|token|secret|credential|ssid|address|hostname|route|fleet|meshbridgeid|ipaddress)/i;

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sourceInput(raw) {
  if (typeof raw === 'string') {
    if (encoder.encode(raw).length > MAX_INPUT_BYTES) throw Error('Existing Home review input is too large.');
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw Error('Invalid Existing Home review input.'); }
    if (!record(parsed)) throw Error('Invalid Existing Home review input.');
    return parsed;
  }
  if (!record(raw)) throw Error('Invalid Existing Home review input.');
  let serialized;
  try { serialized = JSON.stringify(raw); } catch { throw Error('Invalid Existing Home review input.'); }
  if (typeof serialized !== 'string' || encoder.encode(serialized).length > MAX_INPUT_BYTES) throw Error('Existing Home review input is too large.');
  return JSON.parse(serialized);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function cleanText(value, maxBytes = 64) {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  if (!result || encoder.encode(result).length > maxBytes || /[\u0000-\u001f\u007f]/.test(result)) return null;
  return result;
}

function cleanKey(value) {
  return typeof value === 'string' && KEY.test(value) ? value : null;
}

function cleanSourceId(value) {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

function canonicalId(value) {
  if (typeof value !== 'string') return null;
  const lowered = value.trim().toLowerCase();
  return DEVICE_ID.test(lowered) ? lowered : null;
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  return new Date(parsed).toISOString() === canonical ? value : null;
}

function generatedAt(value) {
  const parsed = typeof value === 'number' ? value : timestamp(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) throw Error('Existing Home review needs a fixed generation time.');
  return new Date(parsed).toISOString();
}

function boundedList(value, max = MAX_RECORDS) {
  return Array.isArray(value) && value.length <= max ? value : null;
}

function addCandidate(map, value, sourceRef) {
  if (!value) return;
  if (!map.has(value)) map.set(value, new Set());
  map.get(value).add(sourceRef);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function candidateList(map) {
  return [...map.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([value, sources]) => ({ value, sourceRefs: [...sources].sort() }));
}

function roomKey(value) {
  return value.normalize('NFKC').toLowerCase();
}

function addRoomCandidate(map, value, sourceRef) {
  if (!value || value.toLowerCase() === 'my home') return;
  const key = roomKey(value);
  if (!map.has(key)) map.set(key, { value, sourceRefs: new Set() });
  const candidate = map.get(key);
  if (compareText(value, candidate.value) < 0) candidate.value = value;
  candidate.sourceRefs.add(sourceRef);
}

function roomCandidateList(map) {
  return [...map.values()]
    .sort((a, b) => compareText(a.value, b.value))
    .map(candidate => ({ value: candidate.value, sourceRefs: [...candidate.sourceRefs].sort() }));
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function safeInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function countIgnoredEvidence(value) {
  const stack = [value];
  const seen = new Set();
  let count = 0;
  let visited = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    if (++visited > MAX_EVIDENCE_NODES) throw Error('Existing Home review input is too complex.');
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (IGNORED_EVIDENCE.test(key)) count += 1;
      else if (child && typeof child === 'object') stack.push(child);
    }
  }
  return count;
}

function issue(code, message) {
  return { code, message };
}

function audioInput(kind, explicitValues) {
  const isLamp = kind === 'coollamp' || kind === 'super-lamp';
  const values = [...explicitValues];
  if (values.length > 1) return { installed: null, availability: 'unconfirmed', basis: 'conflict' };
  if (values.length === 1) {
    const installed = values[0];
    return {
      installed,
      availability: 'unconfirmed',
      basis: installed ? 'explicit-provisioning' : isLamp ? 'explicit-exception' : 'controller-default'
    };
  }
  return {
    installed: isLamp,
    availability: 'unconfirmed',
    basis: isLamp ? 'coollamp-default' : 'controller-default'
  };
}

function participation(row) {
  if (!record(row)) return 'unknown';
  if (row.verified !== true) return 'unknown';
  const paused = typeof row.sync?.paused === 'boolean' ? row.sync.paused : row.paused;
  const active = typeof row.sync?.active === 'boolean' ? row.sync.active : row.active;
  if (paused === true) return 'separate';
  if (active === true) return 'playing';
  if (active === false && paused === false) return 'paused';
  return 'unknown';
}

function sanitizeLook(row, deviceCandidateId) {
  if (!record(row)) return null;
  const name = cleanText(row.name);
  const legacyId = cleanSourceId(row.id);
  const localId = safeInteger(row.effect?.localId, 1, 255);
  const effectName = cleanText(row.effect?.name, 96);
  const brightness = safeInteger(row.appearance?.brightness, 1, 255);
  const color = Array.isArray(row.appearance?.color) && row.appearance.color.length === 4 && row.appearance.color.every((value, index) => safeInteger(value, 0, index === 0 ? 1 : 255) !== null)
    ? row.appearance.color.slice() : null;
  const options = Array.isArray(row.appearance?.options) && row.appearance.options.length === 6 && row.appearance.options.every((value, index) => safeInteger(value, index === 0 ? 1 : 0, index === 0 ? 100 : index === 1 ? 100 : index === 2 ? 1 : 255) !== null)
    ? row.appearance.options.slice() : null;
  if (!name || !legacyId || localId === null || !effectName || brightness === null || !color || !options) return null;
  const key = typeof row.effect.key === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(row.effect.key) ? row.effect.key : null;
  return {
    legacyId,
    deviceCandidateId,
    disposition: 'device-scoped-look',
    name,
    effect: { localId, name: effectName, ...(key ? { key } : {}) },
    appearance: { brightness, color, options },
    issues: deviceCandidateId ? [] : [issue('device-needs-match', 'Choose the light this saved look belongs to.')]
  };
}

function sanitizeGeometry(value) {
  if (!record(value)) return null;
  const top = safeInteger(value.top, 1, 4096);
  const right = safeInteger(value.right, 1, 4096);
  const bottom = safeInteger(value.bottom, 1, 4096);
  const left = safeInteger(value.left, 1, 4096);
  const startCorner = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].includes(value.startCorner) ? value.startCorner : null;
  const direction = ['clockwise', 'counterclockwise'].includes(value.direction) ? value.direction : null;
  if ([top, right, bottom, left].includes(null) || !startCorner || !direction) return null;
  return { top, right, bottom, left, pixels: top + right + bottom + left, startCorner, direction };
}

function sanitizeMatrix(value) {
  if (value === null || value === undefined || value.installed === false) return null;
  if (!record(value) || value.installed !== true) return undefined;
  const columns = safeInteger(value.columns, 1, 256);
  const rows = safeInteger(value.rows, 1, 256);
  const rowStride = safeInteger(value.rowStride, 1, 1024);
  const firstPixelIndex = safeInteger(value.firstPixelIndex, 0, 65535);
  if ([columns, rows, rowStride, firstPixelIndex].includes(null) || rowStride < columns || columns * rows > 65535) return undefined;
  const padding = record(value.padding) ? {
    top: safeInteger(value.padding.top, 0, 65535),
    right: safeInteger(value.padding.right, 0, 65535),
    bottom: safeInteger(value.padding.bottom, 0, 65535),
    left: safeInteger(value.padding.left, 0, 65535)
  } : null;
  if (padding && Object.values(padding).includes(null)) return undefined;
  return { installed: true, columns, rows, rowStride, firstPixelIndex, ...(padding ? { padding } : {}) };
}

function sanitizeOutputs(value) {
  const rows = boundedList(value, 16);
  if (!rows || rows.length === 0) return { values: [], valid: false };
  const values = [];
  let valid = true;
  for (const row of rows) {
    if (!record(row) || !['linear', 'perimeter', 'matrix'].includes(row.kind)) {
      valid = false;
      continue;
    }
    const pixelCount = safeInteger(row.pixelCount, 1, 65535);
    if (pixelCount === null) {
      valid = false;
      continue;
    }
    const name = cleanText(row.name);
    values.push({ kind: row.kind, pixelCount, ...(name ? { name } : {}) });
  }
  return { values, valid };
}

function stripSortKey(snapshot) {
  const outputs = sanitizeOutputs(snapshot?.outputs);
  return JSON.stringify({
    sourceId: cleanSourceId(snapshot?.sourceId),
    capturedAt: timestamp(snapshot?.capturedAt),
    controllerId: canonicalId(snapshot?.controllerId),
    name: cleanText(snapshot?.name),
    room: cleanText(snapshot?.room),
    verifiedRead: snapshot?.verifiedRead === true,
    microphoneInstalled: typeof snapshot?.microphoneInstalled === 'boolean' ? snapshot.microphoneInstalled : null,
    geometry: sanitizeGeometry(snapshot?.geometry),
    outputs: outputs.values,
    outputsValid: outputs.valid,
    matrix: sanitizeMatrix(snapshot?.matrix) ?? null,
    schedule: record(snapshot?.schedule) ? {
      automatic: snapshot.schedule.automatic === true,
      timezone: cleanText(snapshot.schedule.timezone, 64)
    } : null,
    ignoredEvidenceCount: countIgnoredEvidence(snapshot)
  });
}
export function compileLegacyMigrationProposalV1(raw, { now } = {}) {
  const input = sourceInput(raw);
  const proposalGeneratedAt = generatedAt(now);
  const proposalTime = Date.parse(proposalGeneratedAt);
  const freshCapture = value => {
    const valid = timestamp(value);
    if (!valid) return false;
    const captured = Date.parse(valid);
    return captured <= proposalTime && proposalTime - captured <= VERIFIED_CAPTURE_MAX_AGE_MS;
  };
  const topFields = new Set(['version', 'destinationHome', 'sources', 'coolStripSnapshots']);
  if (Object.keys(input).some(key => !topFields.has(key))) throw Error('Unexpected Existing Home review field.');
  if (input.version !== 1) throw Error('Unsupported Existing Home review version.');
  if (!record(input.destinationHome)) throw Error('Choose the Home that should be reviewed.');
  const destinationHome = {
    id: cleanKey(input.destinationHome.id),
    name: cleanText(input.destinationHome.name)
  };
  if (!destinationHome.id || !destinationHome.name) throw Error('Invalid destination Home.');
  const sources = boundedList(input.sources, MAX_SOURCES);
  const strips = boundedList(input.coolStripSnapshots, 32);
  if (!sources || !strips) throw Error('Existing Home review contains too many sources.');
  const normalizedStrips = strips.slice().sort((a, b) => compareText(stripSortKey(a), stripSortKey(b)));

  const sourceIds = new Set();
  const normalizedSources = sources.map((source, index) => {
    if (!record(source)) throw Error('Invalid Existing Home review source.');
    const sourceId = cleanSourceId(source.sourceId);
    if (!sourceId || sourceIds.has(sourceId)) throw Error('Invalid Existing Home review source.');
    sourceIds.add(sourceId);
    return { source, sourceId, index };
  }).sort((a, b) => compareText(a.sourceId, b.sourceId));

  const sourceErrors = [];
  const excludedEvidence = [];
  const conflicts = [];
  const rawDevices = [];
  const sourceAliases = new Map();
  const phoneRooms = [];
  const phoneGroupNames = [];
  const rawGroups = [];
  const rawLooks = [];
  const rawBridges = [];
  const removalRefs = [];

  const sourceError = (sourceId, section, code, message) => sourceErrors.push({ sourceId, section, code, message });

  for (const { source, sourceId } of normalizedSources) {
    const unknownFields = Object.keys(source).filter(key => !SOURCE_FIELDS.has(key));
    if (unknownFields.length) sourceError(sourceId, 'source', 'unsupported-source-field', 'Some unsupported saved information was ignored.');
    const sourceHeaderValid = source.kind === 'phone' && Boolean(timestamp(source.capturedAt));
    if (!sourceHeaderValid) sourceError(sourceId, 'source', 'invalid-source-header', 'This phone snapshot has incomplete review information.');
    const sourceFresh = sourceHeaderValid && freshCapture(source.capturedAt);
    if (sourceHeaderValid && !sourceFresh) sourceError(sourceId, 'source', 'stale-source', 'This phone snapshot needs a fresh check.');
    const ignoredCount = countIgnoredEvidence(source);
    if (ignoredCount) excludedEvidence.push({ sourceId, kind: 'routing-or-private-evidence', count: ignoredCount });
    if (source.homeContext !== undefined) excludedEvidence.push({ sourceId, kind: 'presentation-home-context', count: 1 });

    const lamps = boundedList(source.lampRecords);
    if (source.lampRecords !== undefined && !lamps) sourceError(sourceId, 'lamps', 'invalid-lamp-records', 'Saved lights from this phone need a separate check.');
    for (const [index, row] of (lamps || []).entries()) {
      if (!record(row)) {
        sourceError(sourceId, 'lamps', 'invalid-lamp-record', 'One saved light could not be read.');
        continue;
      }
      // `id` is the 12-hex lamp hardware identity. `deviceId` is commonly an
      // OS Bluetooth accessory identifier and must never be promoted here.
      const identities = [...new Set([canonicalId(row.id)].filter(Boolean))];
      const sourceRef = `${sourceId}:lamp:${index}`;
      const aliases = [row.id, row.previousId].filter(value => typeof value === 'string');
      if (identities.length === 1) for (const alias of aliases) sourceAliases.set(`${sourceId}\u0000${alias}`, identities[0]);
      rawDevices.push({
        sourceId, sourceRef, identities, aliases, kind: 'coollamp',
        name: cleanText(row.name), room: cleanText(row.room),
        identityConfirmed: sourceFresh && row.identityConfirmed === true,
        homeBoundaryConfirmed: false,
        reachable: sourceFresh ? row.reachable === true || row.meshOnline === true ? true : row.reachable === false ? false : null : null,
        microphoneInstalled: typeof row.microphoneInstalled === 'boolean' ? row.microphoneInstalled : null,
        physicalStyle: cleanText(row.phoneLampStyle || row.lampStyle)
      });
    }

    if (source.appPreferences !== undefined) {
      const rooms = record(source.appPreferences) && record(source.appPreferences.rooms || {}) ? source.appPreferences.rooms || {} : null;
      const groups = record(source.appPreferences) && record(source.appPreferences.groups || {}) ? source.appPreferences.groups || {} : null;
      if (!rooms || !groups || Object.keys(rooms).length > MAX_RECORDS || Object.keys(groups).length > MAX_RECORDS) {
        sourceError(sourceId, 'app-preferences', 'invalid-app-preferences', 'Room and group labels from this phone could not be read.');
      } else {
        for (const [reference, value] of Object.entries(rooms)) {
          const room = cleanText(typeof value === 'string' ? value : value?.name);
          if (room) phoneRooms.push({ sourceId, reference, room });
        }
        for (const [reference, value] of Object.entries(groups)) {
          const name = cleanText(typeof value === 'string' ? value : value?.name);
          if (name) phoneGroupNames.push({ sourceId, reference, name });
        }
      }
    }

    if (source.groupSnapshot !== undefined) {
      const groups = boundedList(source.groupSnapshot?.groups);
      if (!record(source.groupSnapshot) || !groups) sourceError(sourceId, 'groups', 'invalid-group-snapshot', 'Saved group information from this phone needs a separate check.');
      else for (const [index, group] of groups.entries()) {
        if (!record(group)) {
          sourceError(sourceId, 'groups', 'invalid-group-record', 'One saved group could not be read.');
          continue;
        }
        rawGroups.push({ sourceId, sourceRef: `${sourceId}:group:${index}`, group, sourceFresh });
      }
    }

    if (source.groupRemovalIntents !== undefined) {
      const intents = Array.isArray(source.groupRemovalIntents)
        ? boundedList(source.groupRemovalIntents)
        : boundedList(source.groupRemovalIntents?.sources);
      if (!intents) sourceError(sourceId, 'group-removals', 'invalid-group-removals', 'A saved group change needs review before it can be used.');
      else for (const [index, value] of intents.entries()) if (record(value)) removalRefs.push({ sourceId, sourceRef: `${sourceId}:group-removal:${index}`, value });
    }

    if (source.savedLooksEnvelope !== undefined) {
      const looks = source.savedLooksEnvelope?.version === 1 ? boundedList(source.savedLooksEnvelope.looks) : null;
      if (!looks) sourceError(sourceId, 'saved-looks', 'invalid-saved-looks', 'Saved looks from this phone need a separate check.');
      else for (const [index, look] of looks.entries()) rawLooks.push({ sourceId, sourceRef: `${sourceId}:look:${index}`, look });
    }

    if (source.bridgeRecords !== undefined) {
      const bridges = boundedList(source.bridgeRecords, 16);
      if (!bridges) sourceError(sourceId, 'home-equipment', 'invalid-bridge-records', 'Saved Home equipment from this phone needs a separate check.');
      else for (const [index, bridge] of bridges.entries()) rawBridges.push({ sourceId, sourceRef: `${sourceId}:bridge:${index}`, bridge, sourceFresh });
    }
  }

  for (const { sourceId, reference, room } of phoneRooms) {
    const canonical = sourceAliases.get(`${sourceId}\u0000${reference}`);
    if (!canonical) continue;
    rawDevices.push({ sourceId, sourceRef: `${sourceId}:room:${stableHash(reference)}`, identities: [canonical], aliases: [], kind: 'coollamp', name: null, room, identityConfirmed: false, homeBoundaryConfirmed: false, reachable: null, microphoneInstalled: null, physicalStyle: null });
  }

  for (const [index, snapshot] of normalizedStrips.entries()) {
    const sourceId = cleanSourceId(snapshot?.sourceId) || `coolstrip-${index + 1}`;
    const sourceHeaderValid = record(snapshot) && Boolean(timestamp(snapshot.capturedAt));
    if (!sourceHeaderValid) sourceError(sourceId, 'strip-configuration', 'invalid-strip-snapshot', 'One window display snapshot has incomplete review information.');
    const sourceFresh = sourceHeaderValid && freshCapture(snapshot.capturedAt);
    if (sourceHeaderValid && !sourceFresh) sourceError(sourceId, 'strip-configuration', 'stale-strip-snapshot', 'This window display snapshot needs a fresh check.');
    const ignoredCount = countIgnoredEvidence(snapshot);
    if (ignoredCount) excludedEvidence.push({ sourceId, kind: 'routing-or-private-evidence', count: ignoredCount });
    const identity = canonicalId(snapshot?.controllerId);
    const sourceRef = `${sourceId}:coolstrip:${stableHash(`${snapshot?.controllerId || ''}:${snapshot?.name || ''}`)}`;
    rawDevices.push({
      sourceId, sourceRef, identities: identity ? [identity] : [], aliases: [], kind: 'coolstrip-controller',
      name: cleanText(snapshot?.name), room: cleanText(snapshot?.room),
      identityConfirmed: sourceFresh && snapshot?.verifiedRead === true,
      homeBoundaryConfirmed: false,
      reachable: sourceFresh && snapshot?.verifiedRead === true ? true : null,
      microphoneInstalled: typeof snapshot?.microphoneInstalled === 'boolean' ? snapshot.microphoneInstalled : false,
      physicalStyle: null
    });
  }

  for (const { sourceId, sourceRef, bridge, sourceFresh } of rawBridges) {
    if (!record(bridge)) {
      sourceError(sourceId, 'home-equipment', 'invalid-bridge-record', 'One saved Home equipment record could not be read.');
      continue;
    }
    const identities = [...new Set([canonicalId(bridge.id)].filter(Boolean))];
    rawDevices.push({
      sourceId, sourceRef, identities, aliases: [], kind: 'bridge',
      name: cleanText(bridge.name), room: null,
      identityConfirmed: sourceFresh && Boolean(timestamp(bridge.verifiedAt)), homeBoundaryConfirmed: false,
      reachable: null,
      microphoneInstalled: bridge.microphoneInstalled === true ? true : false,
      physicalStyle: null
    });
  }

  const deviceBuckets = new Map();
  const unmatched = [];
  for (const row of rawDevices) {
    if (row.identities.length !== 1) unmatched.push(row);
    else {
      const id = row.identities[0];
      if (!deviceBuckets.has(id)) deviceBuckets.set(id, []);
      deviceBuckets.get(id).push(row);
    }
  }

  const orderedDeviceBuckets = [...deviceBuckets.entries()].sort(([a], [b]) => compareText(a, b));
  const deviceIdToCandidate = new Map();
  const devices = [];
  const roomNames = new Map();
  const addRoom = (name, sourceRef) => {
    addRoomCandidate(roomNames, name, sourceRef);
  };

  for (const [index, [id, rows]] of orderedDeviceBuckets.entries()) {
    const candidateId = `device-candidate.${String(index + 1).padStart(3, '0')}`;
    deviceIdToCandidate.set(id, candidateId);
    const names = new Map(), rooms = new Map(), styles = new Map();
    const kinds = new Set(), microphones = new Set(), reaches = [];
    let identityConfirmed = false, homeBoundaryConfirmed = false;
    for (const row of rows) {
      addCandidate(names, row.name, row.sourceRef);
      addRoomCandidate(rooms, row.room, row.sourceRef);
      addCandidate(styles, row.physicalStyle, row.sourceRef);
      addRoom(row.room, row.sourceRef);
      kinds.add(row.kind);
      if (row.microphoneInstalled !== null) microphones.add(row.microphoneInstalled);
      if (row.reachable !== null) reaches.push(row.reachable);
      identityConfirmed ||= row.identityConfirmed;
      homeBoundaryConfirmed ||= row.homeBoundaryConfirmed;
    }
    const deviceIssues = [];
    if (kinds.size > 1) deviceIssues.push(issue('product-kind-conflict', 'This saved product has conflicting product information.'));
    if (names.size > 1) deviceIssues.push(issue('name-conflict', 'This product has more than one saved name.'));
    if (rooms.size > 1) deviceIssues.push(issue('room-conflict', 'This product has more than one saved Room.'));
    if (!identityConfirmed) deviceIssues.push(issue('identity-needs-check', 'Check this product before finishing the Home.'));
    if (!homeBoundaryConfirmed) deviceIssues.push(issue('home-needs-check', 'Make sure this product belongs in this Home.'));
    if (microphones.size > 1) deviceIssues.push(issue('microphone-conflict', 'Provisioned microphone information needs a check.'));
    const kind = kinds.size === 1 ? [...kinds][0] : 'unknown';
    const roomCandidates = roomCandidateList(rooms);
    devices.push({
      candidateId,
      canonicalDeviceId: id,
      productKind: kind,
      nameCandidates: candidateList(names),
      roomCandidates,
      physicalStyleCandidates: candidateList(styles),
      proposedName: names.size === 1 ? [...names.keys()][0] : null,
      proposedRoomCandidateId: null,
      identity: identityConfirmed ? 'confirmed' : 'needs-check',
      binding: 'proof-required',
      reachability: reaches.includes(true) ? 'reachable' : reaches.includes(false) ? 'unreachable' : 'unknown',
      audioInput: audioInput(kind, microphones),
      issues: deviceIssues,
      sourceRefs: [...new Set(rows.map(row => row.sourceRef))].sort()
    });
    if (names.size > 1) conflicts.push({ code: 'product-name', resourceRefs: [candidateId], choices: [...names.keys()].sort(), blocks: true, message: 'Choose the name this product should use.' });
    if (rooms.size > 1) conflicts.push({ code: 'product-room', resourceRefs: [candidateId], choices: roomCandidateList(rooms).map(value => value.value).concat('Not assigned yet'), blocks: true, message: 'Choose where this product is now.' });
    if (kinds.size > 1) conflicts.push({ code: 'product-kind', resourceRefs: [candidateId], choices: [...kinds].sort(), blocks: true, message: 'Check which kind of product this is.' });
  }

  unmatched.sort((a, b) => compareText(a.sourceRef, b.sourceRef));
  for (const [index, row] of unmatched.entries()) {
    const candidateId = `device-candidate.unmatched.${String(index + 1).padStart(3, '0')}`;
    const nameCandidates = new Map(), roomCandidates = new Map();
    addCandidate(nameCandidates, row.name, row.sourceRef);
    addRoomCandidate(roomCandidates, row.room, row.sourceRef);
    addRoom(row.room, row.sourceRef);
    const identityConflict = row.identities.length > 1;
    devices.push({
      candidateId,
      canonicalDeviceId: null,
      productKind: row.kind,
      nameCandidates: candidateList(nameCandidates),
      roomCandidates: roomCandidateList(roomCandidates),
      physicalStyleCandidates: [],
      proposedName: row.name,
      proposedRoomCandidateId: null,
      identity: 'needs-check',
      binding: 'proof-required',
      reachability: row.reachable === false ? 'unreachable' : 'unknown',
      audioInput: audioInput(row.kind, row.microphoneInstalled === null ? new Set() : new Set([row.microphoneInstalled])),
      issues: [issue(identityConflict ? 'identity-conflict' : 'identity-missing', identityConflict ? 'This saved product has conflicting identity information.' : 'Check this product nearby to identify it.')],
      sourceRefs: [row.sourceRef]
    });
    conflicts.push({ code: identityConflict ? 'product-identity' : 'product-needs-identification', resourceRefs: [candidateId], choices: ['Check nearby', 'Leave out for now'], blocks: true, message: identityConflict ? 'Check this product before it can be placed in a Home.' : 'Identify this saved product before finishing the Home.' });
  }

  const duplicateNames = new Map();
  for (const device of devices) if (device.proposedName) {
    const key = device.proposedName.toLowerCase();
    if (!duplicateNames.has(key)) duplicateNames.set(key, []);
    duplicateNames.get(key).push(device);
  }
  for (const rows of duplicateNames.values()) if (rows.length > 1) {
    for (const row of rows) row.issues.push(issue('duplicate-name', 'Another product uses this saved name.'));
    conflicts.push({ code: 'duplicate-product-name', resourceRefs: rows.map(row => row.candidateId).sort(), choices: ['Keep both names', 'Rename a product'], blocks: false, message: `More than one product is named ${rows[0].proposedName}.` });
  }

  const rooms = [...roomNames.values()].sort((a, b) => compareText(a.value, b.value)).map(({ value: name, sourceRefs }, index) => ({
    candidateId: `room-candidate.${String(index + 1).padStart(3, '0')}`,
    name,
    sourceRefs: [...sourceRefs].sort()
  }));

  const groupBuckets = new Map();
  const addGroupObservation = (leaderId, observation) => {
    if (!groupBuckets.has(leaderId)) groupBuckets.set(leaderId, []);
    groupBuckets.get(leaderId).push(observation);
  };
  for (const { sourceId, sourceRef, group, sourceFresh } of rawGroups) {
    const leaderId = canonicalId(group.id) || canonicalId(group.leader?.id) || sourceAliases.get(`${sourceId}\u0000${group.id}`);
    if (!leaderId) {
      sourceError(sourceId, 'groups', 'group-needs-identification', 'One saved group needs its products identified.');
      continue;
    }
    const followers = group.followers === undefined ? [] : boundedList(group.followers, 64);
    if (!followers) {
      sourceError(sourceId, 'groups', 'too-many-group-members', 'One saved group contains too many member records.');
      addGroupObservation(leaderId, { sourceId, sourceRef, name: cleanText(group.name), members: null, unmatchedMembers: 1, pending: true, evidenceNeedsReview: true });
      continue;
    }
    const unfilteredMembers = [group.leader, ...followers];
    const malformedMembers = unfilteredMembers.filter(row => !record(row)).length;
    const memberRows = unfilteredMembers.filter(record);
    const memberMap = new Map();
    let duplicateMembers = false;
    let matchedMemberRows = 0;
    for (const row of memberRows) {
      const id = canonicalId(row.id) || sourceAliases.get(`${sourceId}\u0000${row.id}`);
      if (!id || !deviceIdToCandidate.has(id)) continue;
      matchedMemberRows += 1;
      const member = {
        deviceCandidateId: deviceIdToCandidate.get(id),
        participation: participation(sourceFresh ? row : { ...row, verified: false }),
        evidence: sourceFresh && row.verified === true ? 'verified-live' : row.lastSeenMembership === true ? 'last-seen' : 'unknown'
      };
      if (memberMap.has(member.deviceCandidateId)) {
        duplicateMembers = true;
        const previous = memberMap.get(member.deviceCandidateId);
        if (previous.participation !== member.participation || previous.evidence !== member.evidence) {
          memberMap.set(member.deviceCandidateId, { ...member, participation: 'unknown', evidence: 'unknown' });
        }
      } else memberMap.set(member.deviceCandidateId, member);
    }
    const members = [...memberMap.values()].sort((a, b) => compareText(a.deviceCandidateId, b.deviceCandidateId));
    const unmatchedMembers = malformedMembers + memberRows.length - matchedMemberRows;
    const pending = group.removalPending === true || group.dissolutionPending === true || (Array.isArray(group.pendingRemovalIds) && group.pendingRemovalIds.length > 0);
    addGroupObservation(leaderId, {
      sourceId,
      sourceRef,
      name: cleanText(group.name),
      members,
      unmatchedMembers: Math.max(0, unmatchedMembers),
      pending,
      evidenceNeedsReview: !sourceFresh || malformedMembers > 0 || duplicateMembers || !record(group.leader)
    });
  }
  for (const { sourceId, reference, name } of phoneGroupNames) {
    const fromLampRecord = sourceAliases.get(`${sourceId}\u0000${reference}`);
    const fromVerifiedGroup = rawGroups.find(row => row.sourceId === sourceId && row.sourceFresh &&
      (canonicalId(row.group?.id) === canonicalId(reference) || canonicalId(row.group?.leader?.id) === canonicalId(reference)));
    const leaderId = fromLampRecord || (fromVerifiedGroup ? canonicalId(reference) : null);
    if (leaderId) addGroupObservation(leaderId, { sourceId, sourceRef: `${sourceId}:group-name:${stableHash(reference)}`, name, members: null, pending: false, evidenceNeedsReview: false });
  }

  for (const { sourceId, sourceRef, value } of removalRefs) {
    const leaderId = canonicalId(value.source || value.groupId || value.id) || sourceAliases.get(`${sourceId}\u0000${value.source || value.groupId || value.id}`);
    if (leaderId) addGroupObservation(leaderId, { sourceId, sourceRef, name: null, members: null, pending: true, evidenceNeedsReview: false });
  }

  const groups = [];
  for (const [index, [leaderId, observations]] of [...groupBuckets.entries()].sort(([a], [b]) => compareText(a, b)).entries()) {
    const candidateId = `group-candidate.${String(index + 1).padStart(3, '0')}`;
    const explicitNames = new Map(), fallbackNames = new Map();
    for (const row of observations) {
      const name = row.name === 'Unavailable coordinator' || row.name === 'Pending group removal' ? null : row.name;
      addCandidate(row.sourceRef.includes(':group-name:') ? explicitNames : fallbackNames, name, row.sourceRef);
    }
    const names = explicitNames.size ? explicitNames : fallbackNames;
    const memberSets = new Map();
    for (const row of observations) if (row.members) {
      const signature = JSON.stringify(row.members);
      if (!memberSets.has(signature)) memberSets.set(signature, { members: row.members, sourceRefs: [] });
      memberSets.get(signature).sourceRefs.push(row.sourceRef);
    }
    const pending = observations.some(row => row.pending);
    const evidenceNeedsReview = observations.some(row => row.evidenceNeedsReview);
    const groupIssues = [];
    if (!memberSets.size) groupIssues.push(issue('members-need-check', 'Check which products are still in this group.'));
    if (memberSets.size > 1) groupIssues.push(issue('membership-conflict', 'Saved group members do not agree.'));
    if (!deviceIdToCandidate.has(leaderId)) groupIssues.push(issue('coordinator-needs-match', 'Identify the product that previously kept this group together.'));
    if (observations.some(row => row.unmatchedMembers > 0)) groupIssues.push(issue('member-needs-identification', 'One or more saved group members need to be identified.'));
    if (evidenceNeedsReview) groupIssues.push(issue('membership-needs-check', 'Check the saved group membership before finishing this group.'));
    if (names.size > 1) groupIssues.push(issue('name-conflict', 'This group has more than one saved name.'));
    if (pending) groupIssues.push(issue('pending-change', 'A saved group change must be checked before this group is finished.'));
    const memberVersion = memberSets.size === 1 ? [...memberSets.values()][0].members : [];
    groups.push({
      candidateId,
      legacyCoordinatorDeviceCandidateId: deviceIdToCandidate.get(leaderId) || null,
      nameCandidates: candidateList(names),
      proposedName: names.size === 1 ? [...names.keys()][0] : null,
      members: memberVersion,
      disposition: pending || evidenceNeedsReview || memberSets.size !== 1 || !deviceIdToCandidate.has(leaderId) || observations.some(row => row.unmatchedMembers > 0) ? 'review-required' : 'preserve',
      issues: groupIssues,
      sourceRefs: [...new Set(observations.map(row => row.sourceRef))].sort()
    });
    if (memberSets.size > 1) conflicts.push({ code: 'group-membership', resourceRefs: [candidateId], choices: ['Check the group nearby', 'Keep for later'], blocks: true, message: 'Check which products are still in this group.' });
    if (!deviceIdToCandidate.has(leaderId) || observations.some(row => row.unmatchedMembers > 0)) conflicts.push({ code: 'group-product-match', resourceRefs: [candidateId], choices: ['Check nearby', 'Keep for later'], blocks: true, message: 'Identify the saved products before finishing this group.' });
    if (evidenceNeedsReview) conflicts.push({ code: 'group-evidence', resourceRefs: [candidateId], choices: ['Check the group nearby', 'Keep for later'], blocks: true, message: 'Check the saved group membership before finishing this group.' });
    if (names.size > 1) conflicts.push({ code: 'group-name', resourceRefs: [candidateId], choices: [...names.keys()].sort(), blocks: true, message: 'Choose the name this group should use.' });
    if (pending) conflicts.push({ code: 'group-pending-change', resourceRefs: [candidateId], choices: ['Check the saved change', 'Keep for later'], blocks: true, message: 'Review the unfinished group change; it will not be repeated automatically.' });
  }

  const savedLookRows = [];
  for (const { sourceId, sourceRef, look } of rawLooks) {
    const canonical = canonicalId(look?.lampId) || sourceAliases.get(`${sourceId}\u0000${look?.lampId}`);
    const sanitized = sanitizeLook(look, canonical ? deviceIdToCandidate.get(canonical) || null : null);
    if (sanitized) savedLookRows.push({ ...sanitized, sourceRefs: [sourceRef] });
    else sourceError(sourceId, 'saved-looks', 'invalid-saved-look', 'One saved look could not be read.');
  }
  const savedLookByContent = new Map();
  for (const row of savedLookRows) {
    const signature = JSON.stringify({
      legacyId: row.legacyId,
      deviceCandidateId: row.deviceCandidateId,
      name: row.name,
      effect: row.effect,
      appearance: row.appearance,
      issues: row.issues
    });
    if (!savedLookByContent.has(signature)) savedLookByContent.set(signature, { row, signature });
    else savedLookByContent.get(signature).row.sourceRefs.push(...row.sourceRefs);
  }
  const savedLooks = [...savedLookByContent.values()]
    .sort((a, b) => compareText(a.row.legacyId, b.row.legacyId) || compareText(a.signature, b.signature))
    .map(({ row }, index) => ({
      candidateId: `look-candidate.${String(index + 1).padStart(3, '0')}`,
      ...row,
      sourceRefs: [...new Set(row.sourceRefs)].sort()
    }));
  const looksByLegacyId = new Map();
  for (const row of savedLooks) {
    if (!looksByLegacyId.has(row.legacyId)) looksByLegacyId.set(row.legacyId, []);
    looksByLegacyId.get(row.legacyId).push(row);
  }
  for (const rows of looksByLegacyId.values()) if (rows.length > 1) {
    for (const row of rows) row.issues.push(issue('saved-look-conflict', 'This saved look has more than one saved version.'));
    conflicts.push({
      code: 'saved-look-version',
      resourceRefs: rows.map(row => row.candidateId),
      choices: ['Choose one version', 'Keep for later'],
      blocks: true,
      message: 'Choose which saved version of this look to keep.'
    });
  }

  // A recognized legacy bridge is a device candidate only. Its legacy model,
  // address, fleet, and capability hints cannot appoint a Home service.
  const services = [];

  const stripConfigurationRows = [];
  const scheduleRows = [];
  const deviceByCandidateId = new Map(devices.map(device => [device.candidateId, device]));
  for (const [index, snapshot] of normalizedStrips.entries()) {
    const sourceId = cleanSourceId(snapshot?.sourceId) || `coolstrip-${index + 1}`;
    const canonical = canonicalId(snapshot?.controllerId);
    const hostDeviceCandidateId = canonical ? deviceIdToCandidate.get(canonical) || null : null;
    const hostDevice = hostDeviceCandidateId ? deviceByCandidateId.get(hostDeviceCandidateId) : null;
    const hostMatched = hostDevice?.productKind === 'coolstrip-controller';
    const identityKey = hostMatched
      ? `device:${canonical}`
      : `unmatched:${sourceId}:${stableHash(stripSortKey(snapshot))}`;
    const verifiedSnapshot = freshCapture(snapshot?.capturedAt) && snapshot?.verifiedRead === true;
    const geometry = verifiedSnapshot ? sanitizeGeometry(snapshot.geometry) : null;
    const matrix = verifiedSnapshot ? sanitizeMatrix(snapshot.matrix) : null;
    const outputResult = verifiedSnapshot ? sanitizeOutputs(snapshot.outputs) : { values: [], valid: false };
    const configIssues = [];
    if (!verifiedSnapshot) configIssues.push(issue('verified-read-needed', 'Check the window display before using its saved layout.'));
    else if (!geometry) configIssues.push(issue('geometry-needs-check', 'The saved frame layout needs a quick check.'));
    if (!hostMatched) configIssues.push(issue('controller-needs-match', 'Identify the controller before using its saved layout.'));
    if (verifiedSnapshot && !outputResult.valid) configIssues.push(issue('outputs-need-check', 'The saved light outputs need a quick check.'));
    if (matrix === undefined) configIssues.push(issue('matrix-needs-check', 'The saved matrix layout needs a quick check.'));
    stripConfigurationRows.push({
      identityKey,
      hostDeviceCandidateId,
      geometry,
      outputs: outputResult.values,
      matrix: matrix === undefined ? null : matrix,
      disposition: configIssues.length ? 'review-required' : 'preserve',
      issues: configIssues,
      sourceRefs: [`${sourceId}:strip-configuration`]
    });
    if (record(snapshot?.schedule)) {
      const timezone = cleanText(snapshot.schedule.timezone, 64);
      scheduleRows.push({
        identityKey,
        hostDeviceCandidateId,
        pattern: 'sunset-until-midnight',
        enabled: snapshot.schedule.automatic === true,
        timezone,
        disposition: 'review-required',
        issues: [
          ...(!verifiedSnapshot || !hostMatched ? [issue('controller-check', 'Check this controller before using its saved schedule.')] : []),
          issue('home-location-review', 'Confirm this Home’s location and time zone.'),
          issue('target-review', 'Confirm which window displays this schedule should control.'),
          issue('executor-unassigned', 'Home scheduling equipment has not been assigned yet.')
        ],
        sourceRefs: [`${sourceId}:schedule`]
      });
    }
  }

  const mergeProposalRows = (rows, fields) => {
    const bySignature = new Map();
    for (const row of rows) {
      const signature = JSON.stringify(Object.fromEntries(fields.map(field => [field, row[field]])));
      const key = `${row.identityKey}\u0000${signature}`;
      if (!bySignature.has(key)) bySignature.set(key, { row, key });
      else bySignature.get(key).row.sourceRefs.push(...row.sourceRefs);
    }
    return [...bySignature.values()]
      .sort((a, b) => compareText(a.key, b.key))
      .map(({ row }) => ({ ...row, sourceRefs: [...new Set(row.sourceRefs)].sort() }));
  };

  const mergedStripConfigurations = mergeProposalRows(stripConfigurationRows, [
    'hostDeviceCandidateId', 'geometry', 'outputs', 'matrix', 'disposition', 'issues'
  ]);
  const stripConfigurations = mergedStripConfigurations.map((row, index) => {
    const { identityKey, ...candidate } = row;
    return { candidateId: `strip-configuration-candidate.${String(index + 1).padStart(3, '0')}`, identityKey, ...candidate };
  });
  const stripConfigurationsByIdentity = new Map();
  for (const row of stripConfigurations) {
    if (!row.identityKey.startsWith('device:')) continue;
    if (!stripConfigurationsByIdentity.has(row.identityKey)) stripConfigurationsByIdentity.set(row.identityKey, []);
    stripConfigurationsByIdentity.get(row.identityKey).push(row);
  }
  for (const rows of stripConfigurationsByIdentity.values()) if (rows.length > 1) {
    for (const row of rows) {
      row.disposition = 'review-required';
      row.issues.push(issue('configuration-conflict', 'This controller has more than one saved layout.'));
    }
    conflicts.push({
      code: 'strip-configuration',
      resourceRefs: rows.map(row => row.candidateId),
      choices: ['Check the controller', 'Keep for later'],
      blocks: true,
      message: 'Choose the saved layout that matches this installation.'
    });
  }
  for (const row of stripConfigurations) delete row.identityKey;

  const mergedSchedules = mergeProposalRows(scheduleRows, [
    'hostDeviceCandidateId', 'pattern', 'enabled', 'timezone', 'disposition', 'issues'
  ]);
  const schedules = mergedSchedules.map((row, index) => {
    const { identityKey, ...candidate } = row;
    return { candidateId: `schedule-candidate.${String(index + 1).padStart(3, '0')}`, identityKey, ...candidate };
  });
  const schedulesByIdentity = new Map();
  for (const row of schedules) {
    if (!row.identityKey.startsWith('device:')) continue;
    if (!schedulesByIdentity.has(row.identityKey)) schedulesByIdentity.set(row.identityKey, []);
    schedulesByIdentity.get(row.identityKey).push(row);
  }
  for (const rows of schedulesByIdentity.values()) if (rows.length > 1) {
    for (const row of rows) row.issues.push(issue('schedule-conflict', 'This controller has more than one saved schedule.'));
    conflicts.push({
      code: 'schedule-evidence',
      resourceRefs: rows.map(row => row.candidateId),
      choices: ['Choose one schedule', 'Keep for later'],
      blocks: true,
      message: 'Choose which saved schedule to review.'
    });
  }
  for (const row of schedules) delete row.identityKey;

  const roomByName = new Map(rooms.map(room => [roomKey(room.name), room.candidateId]));
  for (const device of devices) if (device.roomCandidates.length === 1) device.proposedRoomCandidateId = roomByName.get(roomKey(device.roomCandidates[0].value)) || null;

  sourceErrors.sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
  excludedEvidence.sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
  conflicts.sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));

  const attention = new Set();
  for (const conflict of conflicts) if (conflict.blocks) for (const reference of conflict.resourceRefs) attention.add(reference);
  for (const error of sourceErrors) attention.add(`source:${error.sourceId}:${error.section}`);
  for (const [kind, rows] of Object.entries({ device: devices, group: groups, look: savedLooks, strip: stripConfigurations, schedule: schedules, service: services })) {
    for (const row of rows) if (row.issues?.length) attention.add(`${kind}:${row.candidateId || row.legacyId}`);
  }
  return deepFreeze({
    version: 1,
    kind: 'legacy-home-migration-proposal',
    generatedAt: proposalGeneratedAt,
    destinationHome: { ...destinationHome, status: 'requested-unverified' },
    disposition: 'review-required',
    candidates: { devices, rooms, groups, savedLooks, services, stripConfigurations, schedules },
    conflicts,
    sourceErrors,
    excludedEvidence,
    summary: {
      devices: devices.length,
      rooms: rooms.length,
      groups: groups.length,
      savedLooks: savedLooks.length,
      homeEquipment: devices.filter(device => device.productKind === 'bridge' || device.productKind === 'coolstrip-controller').length,
      stripConfigurations: stripConfigurations.length,
      schedules: schedules.length,
      thingsToCheck: attention.size
    }
  });
}
