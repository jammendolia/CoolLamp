import { lampAddress, validFirmwareVersion } from './lamps.js';
import { parseGroupCode, groupMemberLimit, supportsGroupProtocol } from './sync.js';

const identityPattern = /^[0-9a-f]{12}$/;
const failure = (message, fields = {}) => Object.assign(new Error(message), fields);
const label = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 96) : '';
function candidate(entry) {
  if (!identityPattern.test(entry?.id)) throw failure('Lamp identity is unavailable.');
  if (typeof entry.address !== 'string') throw failure('Find this lamp on Wi-Fi first.');
  const base = lampAddress(entry.address), host = new URL(base).hostname;
  if (host.endsWith('.local')) {
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.local$/.test(host)) throw failure('Use a local lamp address.');
  } else {
    const supplied = entry.address.replace(/^http:\/\//, '').replace(/\/$/, '');
    if (supplied !== host + (supplied.endsWith(':80') ? ':80' : '') || ['0','255'].includes(host.split('.').at(-1))) {
      throw failure('Use the lamp’s local IPv4 address or .local name.');
    }
  }
  return {id: entry.id, address: base, name: label(entry.name) || 'CoolLamp'};
}
const parse = response => {
  try { return typeof response.data === 'string' ? JSON.parse(response.data) : response.data; }
  catch { throw failure('Lamp returned invalid group information.'); }
};
function group(raw, id) {
  if (raw?.deviceId !== id) throw failure('This address belongs to a different lamp. Refresh discovery.', {identity: true});
  const sync = raw.sync;
  if (!sync || ![1,2,3].includes(sync.version) || ![0,1,2].includes(sync.role) || !groupMemberLimit(sync)) {
    throw failure('This lamp does not support compatible Wi-Fi groups.');
  }
  if (sync.role === 1 && sync.leader !== id) throw failure('Lamp returned an invalid coordinator identity.');
  return sync;
}

// Discovery metadata is transient and contains no group credentials or boot tokens.
// Invitations are returned directly to the join action and never retained here.
export class GroupDiscovery {
  constructor({http, credential, getLamps, getTarget = () => null, onStatus, requestTimeout = 9000, now = Date.now} = {}) {
    Object.assign(this, {http, credential, getLamps, getTarget, onStatus, requestTimeout, now});
    this.scanRun = null; this.invites = new Map(); this.statuses = new Map();
  }
  run() {
    let stop;
    const cancellation = new Promise(resolve => {stop = resolve;});
    return {cancelled: false, cancellation, target: this.target(), stop() {this.cancelled = true; stop();}};
  }
  target() {
    const value = this.getTarget();
    if (!value) return null;
    const lamp = candidate(value);
    return {...lamp, epoch: value.epoch, role: value.sync?.role, version: value.sync?.version};
  }
  candidates() {
    const values = new Map();
    // Native discovery/saved addresses take precedence over a peer's older address.
    const peers = this.getTarget()?.sync?.peers;
    for (const entry of Array.isArray(peers) ? peers : []) if (entry?.role === 1) values.set(entry.id, entry);
    for (const entry of this.getLamps() || []) if (entry?.address) values.set(entry.id, entry);
    return [...values.values()].flatMap(entry => {try {return [candidate(entry)];} catch {return [];}});
  }
  assertCurrent(lamp, run) {
    if (run.cancelled) throw failure('Group discovery cancelled.', {cancelled: true});
    const target = this.target();
    if (Boolean(target) !== Boolean(run.target) || target &&
      ['id','address','epoch','role','version'].some(key => target[key] !== run.target[key])) {
      run.stop();
      throw failure('Selected lamp changed. Choose the group again.', {stale: true});
    }
    if (!this.candidates().some(entry => entry.id === lamp.id && entry.address === lamp.address)) {
      throw failure('Coordinator was removed or its address changed. Refresh discovery.', {stale: true});
    }
  }
  cancelScan() {this.scanRun?.stop(); this.scanRun = null;}
  cancel() {this.cancelScan(); for (const entry of this.invites.values()) entry.run.stop();}
  async bounded(operation, run, message, fields = {}) {
    let timer;
    try {
      return await Promise.race([operation(), run.cancellation.then(() => {throw failure('Group discovery cancelled.', {cancelled: true});}),
        new Promise((_, reject) => {timer = setTimeout(() => reject(failure(message, fields)), this.requestTimeout);})]);
    } finally {clearTimeout(timer);}
  }
  async authorization(lamp, run, password) {
    this.assertCurrent(lamp, run);
    if (password === undefined) {
      try {password = (await this.bounded(() => this.credential(lamp.id), run,
        'Could not read this coordinator’s saved password.', {needsPassword: true}))?.value;}
      catch (error) {if (error.cancelled) throw error; throw failure('Could not read this coordinator’s saved password.', {needsPassword: true});}
      // Intentional single attempt with the lamp's documented factory password.
      if (password === undefined || password === '') password = 'coollamp';
    }
    this.assertCurrent(lamp, run);
    if (typeof password !== 'string' || !password || password.length > 128) throw failure('Enter this coordinator’s access password.', {needsPassword: true});
    return 'Basic ' + btoa(unescape(encodeURIComponent('lamp:' + password)));
  }
  async request(lamp, run, authorization, path, token) {
    this.assertCurrent(lamp, run);
    const mutation = token !== undefined;
    const options = {url: lamp.address + path, method: mutation ? 'POST' : 'GET',
      headers: {Authorization: authorization, ...(mutation ? {'X-Lamp-Token': token, 'Content-Type': 'application/x-www-form-urlencoded'} : {})},
      ...(mutation ? {data: ''} : {}), responseType: 'text', connectTimeout: 5000, readTimeout: 8000, disableRedirects: true};
    let response;
    try {response = await this.bounded(() => this.http.request(options), run,
      mutation ? 'Coordinator did not confirm its invitation. Refresh and try joining again.' : 'Lamp did not respond on Wi-Fi.',
      {offline: !mutation, uncertain: mutation});}
    catch (error) {
      this.assertCurrent(lamp, run);
      throw failure(mutation ? 'Coordinator did not confirm its invitation. Refresh and try joining again.' : 'Lamp did not respond on Wi-Fi.',
        {offline: !mutation, uncertain: mutation});
    }
    this.assertCurrent(lamp, run);
    if (response?.url && response.url !== options.url || response?.status >= 300 && response.status < 400) {
      throw failure('Lamp redirected the request. Refresh discovery.');
    }
    if (response?.status === 403 && mutation) throw failure('Coordinator session changed. Choose the group again.', {staleToken: true});
    if ([401,403].includes(response?.status)) throw failure('Enter this coordinator’s access password.', {needsPassword: true});
    if (!Number.isInteger(response?.status) || response.status < 200 || response.status >= 300) {
      throw failure(response?.status === 409 ? 'This lamp is no longer coordinating a group. Refresh discovery.' : 'Lamp rejected the group request.',
        {httpStatus: response?.status});
    }
    return response;
  }
  async read(lamp, run, authorization, state = false) {
    let response;
    if (!state) {
      try {response = await this.request(lamp, run, authorization, '/api/diagnostics');}
      catch (error) {if (error.httpStatus !== 404) throw error;}
    }
    if (!response) response = await this.request(lamp, run, authorization, '/api/state');
    const raw = parse(response), sync = group(raw, lamp.id);
    if (state && (typeof raw.token !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(raw.token))) {
      throw failure('Coordinator did not provide a valid session token.');
    }
    return {sync, token: raw.token, firmwareVersion: validFirmwareVersion(raw.firmware?.version), name: label(raw.name) || lamp.name};
  }
  eligibility(sync, target) {
    if (target && !supportsGroupProtocol(target.sync||{version:target.version},sync.version)) return {joinable: false, message: 'Update these lamps to the same group firmware version before joining.'};
    const order = Array.isArray(sync.order) ? sync.order.map(entry => entry.id) : [];
    const limit=groupMemberLimit(sync);
    if ((order.length >= limit || sync.members >= limit-1) && !order.includes(target?.id)) {
      return {joinable: false, message: 'This group is full ('+limit+' lamps).'};
    }
    return {joinable: true, message: ''};
  }
  emit(lamp, run, status) {
    this.assertCurrent(lamp, run);
    // Explicit whitelist: callers cannot accidentally receive a raw response/key.
    const value = {id: lamp.id, address: lamp.address, name: status.name || lamp.name, state: status.state,
      verified: status.verified === true, role: status.role ?? null, members: status.members ?? null,
      firmwareVersion: status.firmwareVersion ?? null, checkedAt: status.checkedAt ?? null,
      joinable: status.joinable === true, message: status.message || ''};
    this.statuses.set(lamp.id, value); this.onStatus?.(lamp.id, value); return value;
  }
  metadata(lamp, run, info) {
    const coordinator = info.sync.role === 1;
    return this.emit(lamp, run, {state: coordinator ? 'coordinator' : 'not-coordinator', verified: coordinator,
      role: info.sync.role, name: info.name, firmwareVersion: info.firmwareVersion,
      members: Number.isInteger(info.sync.members) && info.sync.members >= 0 && info.sync.members < groupMemberLimit(info.sync) ? info.sync.members : null,
      checkedAt: this.now(), ...(coordinator ? this.eligibility(info.sync, run.target) : {message: 'This lamp is not coordinating a group.'})});
  }
  errorStatus(lamp, run, error) {
    if (error.cancelled || error.stale || run.cancelled) return null;
    try {return this.emit(lamp, run, {state: error.needsPassword ? 'needs-password' : error.offline ? 'offline' : 'failed', message: error.message});}
    catch {return null;}
  }
  async scan() {
    this.cancelScan();
    const run = this.run(); this.scanRun = run;
    const lamps = this.candidates().filter(entry => entry.id !== run.target?.id), results = [];
    let index = 0;
    const worker = async () => {
      while (!run.cancelled && index < lamps.length) {
        const lamp = lamps[index++];
        try {
          this.emit(lamp, run, {state: 'checking', message: 'Looking for a coordinator…'});
          const authorization = await this.authorization(lamp, run);
          results.push(this.metadata(lamp, run, await this.read(lamp, run, authorization)));
        } catch (error) {const status = this.errorStatus(lamp, run, error); if (status) results.push(status);}
      }
    };
    await Promise.all([worker(), worker()]);
    if (this.scanRun === run) this.scanRun = null;
    return {coordinators: results.filter(entry => entry.state === 'coordinator' && entry.verified), results, cancelled: run.cancelled};
  }
  invite(id, password) {
    if (this.invites.has(id)) return this.invites.get(id).promise;
    const run = this.run(), lamp = this.candidates().find(entry => entry.id === id);
    const promise = (async () => {
      if (!run.target) throw failure('Connect to the lamp you want to join over Wi-Fi.');
      if (!lamp) throw failure('Coordinator was removed. Refresh discovery.', {stale: true});
      if (id === run.target.id) throw failure('A lamp cannot join its own group.');
      const authorization = await this.authorization(lamp, run, password);
      const before = await this.read(lamp, run, authorization, true);
      this.metadata(lamp, run, before);
      if (before.sync.role !== 1) throw failure('This lamp is no longer coordinating a group. Refresh discovery.');
      const eligible = this.eligibility(before.sync, run.target);
      if (!eligible.joinable) throw failure(eligible.message);
      const response = await this.request(lamp, run, authorization, '/api/sync/invite', before.token);
      let code;
      try {
        if (typeof response.data !== 'string' || response.data.length > 64) throw Error();
        const fields = parseGroupCode(response.data);
        if (fields.leader !== lamp.id) throw Error();
        code = 'CL1-' + fields.leader + '-' + fields.key;
      } catch {throw failure('Coordinator returned an invalid group invitation. Refresh discovery.');}
      // Discard an invitation if the coordinator rebooted, changed role, or
      // the selected joining lamp/session changed while the request ran.
      const after = await this.read(lamp, run, authorization, true);
      if (after.sync.role !== 1 || after.token !== before.token) throw failure('Coordinator changed while joining. Choose the group again.');
      const eligibleAfter = this.eligibility(after.sync, run.target);
      if (!eligibleAfter.joinable) throw failure(eligibleAfter.message);
      this.assertCurrent(lamp, run);
      return {id: lamp.id, code, targetId: run.target.id};
    })().catch(error => {if (lamp) this.errorStatus(lamp, run, error); throw error;})
      .finally(() => {if (this.invites.get(id)?.run === run) this.invites.delete(id);});
    this.invites.set(id, {run, promise});
    return promise;
  }
}
