import { lampAddress, validFirmwareVersion } from './lamps.js';
import { wifiObservation,groupObservation,lightingObservation } from './lamp-connectivity.js';
import {normalizeLampStyle} from './lamp-style.js';
import {validateCatalog} from './catalog.js';

const busyPhases = [1, 3, 4];
const updateErrors = ['','Lamp is offline.','Lamp could not set its clock.','Lamp cannot reach the update server.',
  'Lamp rejected the update manifest.','This update needs a USB partition upgrade.','Firmware verification or download failed.',
  'Lamp could not save update settings.','Lamp did not have enough memory for the update.'];
const newer = (a, b) => {
  if (!validFirmwareVersion(a) || !validFirmwareVersion(b)) return false;
  const next = a.split('.').map(Number), current = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (next[i] !== current[i]) return next[i] > current[i];
  return false;
};
const failure = (message, fields = {}) => Object.assign(new Error(message), fields);
const parse = response => {
  try { return typeof response.data === 'string' ? JSON.parse(response.data) : response.data; }
  catch { throw failure('Invalid firmware response from lamp.'); }
};
function firmwareStatus(value) {
  if (!validFirmwareVersion(value?.version)) throw failure('Invalid firmware version from lamp.');
  // Some older lamps expose their installed version without the OTA controls.
  const supported = Number.isInteger(value.phase) && value.phase >= 0 && value.phase <= 5 &&
    Number.isInteger(value.progress) && value.progress >= 0 && value.progress <= 100 &&
    Number.isInteger(value.error) && value.error >= 0 && value.error <= 8 &&
    typeof value.wifi === 'boolean' && typeof value.available === 'boolean' && typeof value.automatic === 'boolean' &&
    (value.latest === '0.0.0' || Boolean(validFirmwareVersion(value.latest)));
  if (!supported && Object.keys(value).some(key => ['phase','available','error','progress'].includes(key))) {
    throw failure('Invalid firmware status from lamp.');
  }
  return {...value, supported, latest: validFirmwareVersion(value.latest)};
}
function target(entry) {
  if (typeof entry?.id !== 'string' || !entry.id || entry.id.length > 128) throw failure('Lamp identity is unavailable.');
  if (!entry.address) throw failure('Find this lamp on Wi-Fi to check its firmware.', {unsupported: true});
  const base = lampAddress(entry.address);
  // In addition to lampAddress, reject abbreviated, encoded and broadcast IPs.
  const host = new URL(base).hostname;
  if (!host.endsWith('.local')) {
    const supplied = String(entry.address).replace(/^http:\/\//, '').replace(/\/$/, '');
    const exact = host + (supplied.endsWith(':80') ? ':80' : '');
    if (supplied !== exact || host.split('.').some(part => !/^\d{1,3}$/.test(part)) || ['0','255'].includes(host.split('.').at(-1))) {
      throw failure('Use the lamp’s local IPv4 address or .local name.');
    }
  } else if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.local$/.test(host)) {
    throw failure('Use the lamp’s local IPv4 address or .local name.');
  }
  return {id: entry.id, base};
}

// This never selects or disconnects the lamp used by the app's controls.
// GET-only refresh and explicit bulk installs have independent lifetimes.
export class FirmwareFleet {
  constructor({http, credential, getLamps, onStatus, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    requestTimeout = 9000, pollInterval = 3000, checkTimeout = 180000, updateTimeout = 240000, healthyUptime = 35000} = {}) {
    this.http = http; this.credential = credential; this.getLamps = getLamps; this.onStatus = onStatus;
    Object.assign(this, {now, sleep, requestTimeout, pollInterval, checkTimeout, updateTimeout, healthyUptime});
    this.statuses = new Map(); this.catalogues=new Map();this.refreshRun = null; this.bulkRun = null; this.bulkPromise = null;this.singleRuns=new Map();
  }
  run() {
    let stop;
    const cancellation = new Promise(resolve => {stop = resolve;});
    return {cancelled: false, cancellation, stop() {this.cancelled = true; stop();}};
  }
  cancelRefresh() { this.refreshRun?.stop(); this.refreshRun = null; }
  forget(id) { this.cancelRefresh();this.statuses.delete(id);this.catalogues.delete(id); }
  cancel() { this.cancelRefresh(); this.bulkRun?.stop();for(const run of this.singleRuns.values())run.stop(); }
  assertCurrent(lamp, run) {
    if (run.cancelled) throw failure('Firmware task cancelled.', {cancelled: true});
    const current = this.getLamps().find(entry => entry.id === lamp.id);
    try { if (!current || target(current).base !== lamp.base) throw Error(); }
    catch { throw failure('Lamp was removed or its address changed.', {stale: true}); }
  }
  emit(lamp, run, status) {
    this.assertCurrent(lamp, run);
    const value = {...this.statuses.get(lamp.id), verified: false, fresh: false, ...status};
    this.statuses.set(lamp.id, value);
    this.onStatus?.(lamp.id, value);
    return {id: lamp.id, ...value};
  }
  async wait(lamp, run, milliseconds = this.pollInterval) {
    await Promise.race([this.sleep(milliseconds), run.cancellation]);
    this.assertCurrent(lamp, run);
  }
  async request(lamp, run, path, token) {
    this.assertCurrent(lamp, run);
    const attemptedAt=this.now();
    let timer;
    const mutation = token !== undefined;
    const options = {url: lamp.base + path, method: mutation ? 'POST' : 'GET',
      headers: {Authorization: lamp.authorization, ...(mutation ? {'X-Lamp-Token': token, 'Content-Type': 'application/x-www-form-urlencoded'} : {})},
      ...(mutation ? {data: ''} : {}), responseType: 'text', connectTimeout: 5000, readTimeout: 8000, disableRedirects: true};
    let response;
    try {
      response = await Promise.race([
        this.http.request(options),
        new Promise((_, reject) => {timer = setTimeout(() => reject(Error('timeout')), this.requestTimeout);}),
        run.cancellation.then(() => {throw failure('Firmware task cancelled.', {cancelled: true});})
      ]);
    } catch (error) {
      this.assertCurrent(lamp, run);
      throw failure(mutation ? 'The lamp did not confirm the update request. Checking its status without sending it again.' : 'Lamp did not respond on Wi-Fi.',
        {offline: !mutation, uncertain: mutation, cause: error, attemptedAt});
    } finally { clearTimeout(timer); }
    this.assertCurrent(lamp, run);
    if (response?.url && response.url !== options.url) throw failure('Lamp redirected the request. Find it on Wi-Fi again.',{attemptedAt});
    if (response?.status === 401 || response?.status === 403) throw failure('Check this lamp’s access password.', {needsPassword: true,attemptedAt});
    if (!Number.isInteger(response?.status) || response.status < 200 || response.status >= 300) {
      throw failure(response?.status >= 300 && response.status < 400 ? 'Lamp redirected the request. Find it on Wi-Fi again.' : 'Lamp rejected the firmware request.',
        {httpStatus: response?.status, confirmed: true,attemptedAt});
    }
    return response;
  }
  verifyIdentity(lamp, raw) {
    const identity = raw?.deviceId || raw?.hostname?.replace(/\.local$/, '');
    if (identity !== lamp.id) throw failure('This address belongs to a different lamp. Refresh the Wi-Fi list.', {identity: true});
  }
  async identify(lamp, run, state = false) {
    let response, wifiObservedAt=this.now();
    if (!state) {
      try { response = await this.request(lamp, run, '/api/diagnostics'); }
      catch (error) { if (error.httpStatus !== 404) throw error; }
    }
    if (!response) {wifiObservedAt=this.now();response = await this.request(lamp, run, '/api/state');}
    const raw = parse(response);
    this.verifyIdentity(lamp, raw);
    const firmware = firmwareStatus(raw.firmware);
    if (state && (typeof raw.token !== 'string' || !raw.token || raw.token.length > 128)) throw failure('Lamp did not provide an update token.');
    const lampStyle=raw.lampStyle&&typeof raw.lampStyle==='object'?normalizeLampStyle(raw.lampStyle):null;
    const catalogueKey=JSON.stringify([lamp.base,firmware.version,raw.audio?.installed??null]);
    const cached=this.catalogues.get(lamp.id);
    const lighting=lightingObservation(raw,cached?.key===catalogueKey?cached.entries:null);
    return {firmware, token: raw.token, wifi:wifiObservation(raw), group:groupObservation(raw), lampStyle,lighting,catalogueKey, wifiObservedAt, uptimeMs: Number.isInteger(raw.uptimeMs) && raw.uptimeMs >= 0 ? raw.uptimeMs : null};
  }
  live(lamp, run, identity, state = 'ready', message = '') {
    const fw = identity.firmware;
    return this.emit(lamp, run, {state, installedVersion: fw.version, latestVersion: fw.latest,
      available: fw.available === true && newer(fw.latest, fw.version), progress: fw.progress ?? 0,
      checkedAt: this.now(), verified: true, fresh: true, wifi:identity.wifi ?? null,
      wifiObservedAt:identity.wifi?identity.wifiObservedAt:null,group:identity.group ?? null,
      groupObservedAt:identity.group?identity.wifiObservedAt:null,lampStyle:identity.lampStyle ?? null,
      styleObservedAt:identity.lampStyle?identity.wifiObservedAt:null,lighting:identity.lighting??null,
      lightingObservedAt:identity.lighting?identity.wifiObservedAt:null, message, error: ''});
  }
  async enrichLighting(lamp,run,identity,row){
    if(!identity.lighting||identity.lighting.kind==='group'&&identity.lighting.scene!==0||identity.lighting.name||busyPhases.includes(identity.firmware.phase))return row;
    if(this.catalogues.get(lamp.id)?.key===identity.catalogueKey)return row;
    try{
      const value=parse(await this.request(lamp,run,'/api/effects'));
      const entries=validateCatalog(value,value?.length);this.assertCurrent(lamp,run);
      this.catalogues.set(lamp.id,{key:identity.catalogueKey,entries});
      const name=entries.find(entry=>entry.id===identity.lighting.mode)?.name??null;
      return this.emit(lamp,run,{...row,lighting:{...identity.lighting,name},lightingObservedAt:identity.wifiObservedAt});
    }catch(error){
      if(error.cancelled||error.stale)throw error;
      // Failed/malformed catalogue never hides a valid firmware/signal result.
      return row;
    }
  }
  async prepare(entry, run) {
    const lamp = target(entry);
    this.assertCurrent(lamp, run);
    let timer, password;
    try {
      password = (await Promise.race([
        this.credential(lamp.id),
        new Promise((_, reject) => {timer = setTimeout(() => reject(Error('timeout')), this.requestTimeout);}),
        run.cancellation.then(() => {throw failure('Firmware task cancelled.', {cancelled: true});})
      ]))?.value;
    } catch (error) {
      this.assertCurrent(lamp, run);
      throw failure('Could not read this lamp’s saved access password.', {needsPassword: true});
    } finally { clearTimeout(timer); }
    this.assertCurrent(lamp, run);
    if (typeof password !== 'string' || !password) throw failure('Connect once and save this lamp’s access password.', {needsPassword: true});
    lamp.authorization = 'Basic ' + btoa(unescape(encodeURIComponent('lamp:' + password)));
    return lamp;
  }
  errorStatus(entry, run, error) {
    if (error.cancelled || error.stale || run.cancelled) return null;
    try {
      const lamp = target(entry);
      return this.emit(lamp, run, {state: error.needsPassword ? 'needs-password' : error.unsupported ? 'unsupported' : error.offline ? 'offline' : 'failed',
        message: error.message, error: error.message, attemptedAt: error.attemptedAt ?? this.statuses.get(entry.id)?.attemptedAt ?? this.now(), verified: false, fresh: false});
    } catch {
      if (run.cancelled || !this.getLamps().some(lamp => lamp.id === entry.id && lamp.address === entry.address)) return null;
      const value = {...this.statuses.get(entry.id), state: error.unsupported ? 'unsupported' : 'failed', message: error.message,
        error: error.message, attemptedAt: error.attemptedAt ?? this.statuses.get(entry.id)?.attemptedAt ?? this.now(), fresh: false, verified: false};
      this.statuses.set(entry.id, value); this.onStatus?.(entry.id, value);
      return {id: entry.id, ...value};
    }
  }
  async refresh() {
    if (this.bulkRun && !this.bulkRun.cancelled||this.singleRuns.size) return {results: [], cancelled: false, busy: true};
    this.cancelRefresh();
    const run = this.run(); this.refreshRun = run;
    const entries = [...new Map(this.getLamps().map(entry => [entry.id, {...entry}])).values()], results = [];
    let index = 0;
    const worker = async () => {
      while (!run.cancelled && index < entries.length) {
        const entry = entries[index++];
        try {
          const lamp = await this.prepare(entry, run);
          this.emit(lamp, run, {state: 'checking', message: 'Reading installed firmware…', attemptedAt: this.now()});
          const identity = await this.identify(lamp, run);
          const state = identity.firmware.supported ? busyPhases.includes(identity.firmware.phase) ?
            identity.firmware.phase === 4 ? 'restarting' : identity.firmware.phase === 3 ? 'updating' : 'checking' : 'ready' : 'unsupported';
          const row=this.live(lamp, run, identity, state, identity.firmware.supported ? '' : 'This lamp does not support Wi-Fi updates.');
          results.push(await this.enrichLighting(lamp,run,identity,row));
        } catch (error) { const result = this.errorStatus(entry, run, error); if (result) results.push(result); }
      }
    };
    await Promise.all([worker(), worker()]);
    if (this.refreshRun === run) this.refreshRun = null;
    return {results, cancelled: run.cancelled};
  }
  updateAll() {
    if (this.bulkPromise) return this.bulkPromise;
    if(this.singleRuns.size)return Promise.reject(failure('Finish the current lamp update first.'));
    this.cancelRefresh();
    const run = this.run(); this.bulkRun = run;
    const entries = [...new Map(this.getLamps().map(entry => [entry.id, {...entry}])).values()];
    this.bulkPromise = (async () => {
      const results = [];
      for (const entry of entries) {
        if (run.cancelled) break;
        try { results.push(await this.updateOne(await this.prepare(entry, run), run)); }
        catch (error) { const result = this.errorStatus(entry, run, error); if (result) results.push(result); }
      }
      return {results, cancelled: run.cancelled};
    })().finally(() => {if (this.bulkRun === run) this.bulkRun = null; this.bulkPromise = null;});
    return this.bulkPromise;
  }
  async post(lamp, run, path) {
    // Refresh identity and boot token directly before EVERY mutative operation.
    const identity = await this.identify(lamp, run, true);
    if (!identity.firmware.supported) throw failure('This lamp does not support Wi-Fi updates.', {unsupported: true});
    if (busyPhases.includes(identity.firmware.phase)) return {identity, busy: true};
    if(path.endsWith('/install')&&run.expectedVersion&&identity.firmware.latest!==run.expectedVersion)throw failure('The available release changed. Refresh before updating.');
    if (path.endsWith('/install') && !(identity.firmware.available && newer(identity.firmware.latest, identity.firmware.version))) {
      return {identity, skipped: true};
    }
    try { await this.request(lamp, run, path, identity.token); return {identity}; }
    catch (error) {
      if (error.uncertain || error.httpStatus === 409) return {identity, uncertain: error.uncertain, conflict: error.httpStatus === 409};
      throw error;
    }
  }
  async compact(lamp, run) { return firmwareStatus(parse(await this.request(lamp, run, '/api/firmware'))); }
  async updateOne(lamp, run) {
    this.emit(lamp, run, {state: 'checking', message: 'Checking for updates…', attemptedAt: this.now()});
    let identity = await this.identify(lamp, run);
    this.live(lamp, run, identity, 'checking', 'Checking for updates…');
    if (!identity.firmware.supported) throw failure('This lamp does not support Wi-Fi updates.', {unsupported: true});
    if(identity.firmware.wifi===false)throw failure('This lamp is not connected to Wi-Fi.',{safeBluetoothFallback:true});
    if(run.expectedVersion&&!newer(run.expectedVersion,identity.firmware.version))return this.live(lamp,run,identity,'ready','Already up to date.');
    const originalVersion = identity.firmware.version;
    if (!busyPhases.includes(identity.firmware.phase)) {
      const check = await this.post(lamp, run, '/api/firmware/check');
      identity = check.identity;
      if (check.busy) return this.observe(lamp, run, originalVersion, identity.firmware);
      return this.observe(lamp, run, originalVersion, null, {uncertain: check.uncertain, conflict: check.conflict});
    }
    return this.observe(lamp, run, originalVersion, identity.firmware);
  }
  async observe(lamp, run, originalVersion, initial = null, check = {}) {
    const started = this.now();
    let deadline = started + this.checkTimeout, updating = initial && [3,4].includes(initial.phase), installSent = false,
      observedActivity = initial && busyPhases.includes(initial.phase), targetVersion = null, firstNewVersionAt = null;
    if (updating) deadline = started + this.updateTimeout;
    let fw = initial;
    while (this.now() <= deadline) {
      this.assertCurrent(lamp, run);
      if (!fw) {
        try { fw = await this.compact(lamp, run); }
        catch (error) {
          if (!error.offline) throw error;
          if (!updating) throw error;
          this.emit(lamp, run, {state: 'restarting', message: 'Waiting for the lamp to return…'});
          await this.wait(lamp, run); continue;
        }
      }
      if (!fw.supported) throw failure('Lamp no longer supports Wi-Fi updates.', {unsupported: true});
      if (check.conflict && !observedActivity && !busyPhases.includes(fw.phase) && fw.version === originalVersion) {
        throw failure('Lamp updater is busy or starting. The update check was not accepted.');
      }
      if (newer(fw.version, originalVersion)) {
        if(run.expectedVersion&&fw.version!==run.expectedVersion)throw failure('Lamp firmware changed to a different release. Refresh its installed version.');
        let identity;
        try { identity = await this.identify(lamp, run); }
        catch (error) { if (!updating || !error.offline) throw error; await this.wait(lamp, run); fw = null; continue; }
        fw = identity.firmware;
        if (!newer(fw.version, originalVersion)) throw failure('Lamp returned to its previous firmware.');
        firstNewVersionAt ??= this.now();
        if (identity.uptimeMs !== null ? identity.uptimeMs >= this.healthyUptime : this.now() - firstNewVersionAt >= this.healthyUptime) {
          return this.live(lamp, run, identity, 'updated', 'Firmware updated.');
        }
        this.live(lamp, run, identity, 'restarting', 'Verifying the lamp after its restart…');
        updating = true;
        deadline = Math.max(deadline, firstNewVersionAt + this.healthyUptime + this.checkTimeout);
      } else if (fw.version !== originalVersion) {
        throw failure('Lamp firmware changed unexpectedly. Refresh the Wi-Fi list.');
      } else if (fw.phase === 5) {
        throw failure(updateErrors[fw.error] || 'Lamp could not finish the update.',{safeBluetoothFallback:!updating&&!installSent&&!check.uncertain&&!check.conflict&&[1,2,3,8].includes(fw.error)});
      } else if ([3,4].includes(fw.phase)) {
        if (!updating) deadline = this.now() + this.updateTimeout;
        updating = true; observedActivity = true;
        this.emit(lamp, run, {state: fw.phase === 4 ? 'restarting' : 'updating', progress: fw.progress,
          message: fw.phase === 4 ? 'Lamp is restarting…' : 'Installing firmware…'});
      } else if (fw.phase === 1) {
        observedActivity = true;
        this.emit(lamp, run, {state: updating ? 'updating' : 'checking', progress: fw.progress, message: updating ? 'Preparing firmware…' : 'Checking for updates…'});
      } else if (fw.available && newer(fw.latest, fw.version)) {
        if (installSent) throw failure('The lamp did not start its update. The install request was not repeated.');
        targetVersion = fw.latest;
        const install = await this.post(lamp, run, '/api/firmware/install');
        if (install.skipped) {
          if (newer(install.identity.firmware.version, originalVersion)) {fw = install.identity.firmware; continue;}
          return this.live(lamp, run, install.identity, 'ready', 'Already up to date.');
        }
        installSent = !install.busy;
        updating = true; observedActivity = true; deadline = this.now() + this.updateTimeout;
        this.emit(lamp, run, {state: 'updating', latestVersion: targetVersion, progress: 0, message: 'Installing firmware…'});
      } else if (!updating && (!check.uncertain || observedActivity)) {
        const identity = await this.identify(lamp, run);
        if (busyPhases.includes(identity.firmware.phase) || (identity.firmware.available && newer(identity.firmware.latest, identity.firmware.version))) {
          fw = identity.firmware; continue;
        }
        if (identity.firmware.phase === 5) throw failure(updateErrors[identity.firmware.error] || 'Lamp could not finish the update.',{safeBluetoothFallback:!updating&&!installSent&&!check.uncertain&&!check.conflict&&[1,2,3,8].includes(identity.firmware.error)});
        if(run.expectedVersion&&newer(run.expectedVersion,identity.firmware.version))throw failure('The lamp did not find the selected release. Refresh before trying again.');
        return this.live(lamp, run, identity, 'ready', 'Already up to date.');
      }
      await this.wait(lamp, run);
      fw = null;
    }
    throw failure(updating ? 'Update not confirmed before the timeout. The install request was not repeated.' :
      check.uncertain ? 'Update check was not confirmed. The request was not repeated.' : 'Lamp update check timed out.');
  }
  async updateLamp(entry,expectedVersion){
    if(this.bulkRun||this.singleRuns.has(entry.id))throw failure('An update is already running.');
    this.cancelRefresh();const run=this.run();run.expectedVersion=expectedVersion;this.singleRuns.set(entry.id,run);
    try{
      let lamp;try{lamp=await this.prepare(entry,run);await this.identify(lamp,run);}catch(error){if(error.offline||error.unsupported)error.safeBluetoothFallback=true;throw error;}
      return await this.updateOne(lamp,run);
    }catch(error){this.errorStatus(entry,run,error);throw error;}
    finally{if(this.singleRuns.get(entry.id)===run)this.singleRuns.delete(entry.id);}
  }
}
