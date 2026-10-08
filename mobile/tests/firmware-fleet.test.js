import test from 'node:test';
import assert from 'node:assert/strict';
import { FirmwareFleet } from '../src/firmware-fleet.js';

const ids = ['aabbccddeeff','112233445566','0123456789ab'];
const status = (version = '1.9.4', phase = 0, latest = '0.0.0') => ({version, phase, latest,
  available: phase === 2, automatic: false, wifi: true, progress: 0, error: 0});
const response = (data, code = 200) => ({status: code, data: typeof data === 'string' ? data : JSON.stringify(data)});
function setup(count = 1) {
  let now = 1000;
  let entries = ids.slice(0, count).map((id, i) => ({id, address: `192.168.1.${20 + i}`}));
  const devices = entries.map((lamp, i) => ({...lamp, firmware: status(), uptimeMs: 100,
    token: `token-${i}`, password: `password-${i}`, polls: [], diagnosticReads: 0}));
  const calls = [], changes = [];
  const http = {request: async options => {
    calls.push(options);
    const url = new URL(options.url), device = devices.find(lamp => new URL('http://' + lamp.address).hostname === url.hostname);
    assert(device, 'Only expected local lamps may be contacted.');
    assert.equal(options.headers.Authorization, 'Basic ' + btoa('lamp:' + device.password));
    assert.equal(options.disableRedirects, true);
    if (device.request) {const result = await device.request(options, url.pathname); if (result !== undefined) return result;}
    if (url.pathname === '/api/diagnostics') {
      device.diagnosticReads++;
      return response({deviceId: device.identity || device.id, uptimeMs: device.uptimeMs, firmware: device.firmware});
    }
    if (url.pathname === '/api/state') return response({deviceId: device.identity || device.id, token: device.token, firmware: device.firmware});
    if (url.pathname === '/api/firmware') {
      const next = device.polls.shift();
      if (next instanceof Error) throw next;
      if (next) { device.firmware = next; if (next.version === '1.9.5') device.uptimeMs = 100; }
      return response(device.firmware);
    }
    assert.equal(options.method, 'POST'); assert.equal(options.headers['X-Lamp-Token'], device.token);
    assert.equal(options.data, ''); assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    if (url.pathname === '/api/firmware/check') {device.firmware = {...device.firmware, phase: 1}; return response('Checking', 202);}
    if (url.pathname === '/api/firmware/install') {device.firmware = {...device.firmware, phase: 1}; return response('Installing', 202);}
    assert.fail('Unexpected firmware mutation ' + url.pathname);
  }};
  const fleet = new FirmwareFleet({http, credential: async id => ({value: devices.find(lamp => lamp.id === id)?.password || ''}),
    getLamps: () => entries, onStatus: (id, value) => changes.push({id, ...value}), now: () => now,
    sleep: async ms => {now += ms;}, pollInterval: 5, checkTimeout: 30, updateTimeout: 80, healthyUptime: 35, requestTimeout: 1000});
  return {fleet, devices, calls, changes, setEntries: values => {entries = values;}, entries: () => entries,
    setNow: value => {now = value;}};
}
const writes = calls => calls.filter(call => call.method === 'POST');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('page refresh reads every lamp independently and displays installed, never offered firmware', async () => {
  const {fleet, devices, calls, changes} = setup(2);
  devices[0].firmware = status('1.9.4', 2, '1.9.5'); devices[1].firmware = status('1.9.5');
  const outcome = await fleet.refresh();
  assert.equal(outcome.results.length, 2); assert.equal(outcome.cancelled, false);
  assert.equal(writes(calls).length, 0);
  assert(calls.every(call => call.url.endsWith('/api/diagnostics')));
  const ready = changes.filter(change => change.verified);
  assert.deepEqual(ready.map(change => change.installedVersion), ['1.9.4','1.9.5']);
  assert.equal(ready[0].latestVersion, '1.9.5'); assert.equal(ready[0].available, true);
  assert(ready.every(change => change.fresh && change.checkedAt === 1000));
});

test('a slow lamp never prevents the second lamp status arriving and refresh concurrency is bounded', async () => {
  const {fleet, devices, changes} = setup(3);
  let complete;
  devices[0].request = () => new Promise(resolve => {complete = resolve;});
  const pending = fleet.refresh(); await tick();
  assert(changes.some(change => change.id === ids[1] && change.verified));
  assert(changes.some(change => change.id === ids[2] && change.verified));
  assert(!changes.some(change => change.id === ids[0] && change.verified));
  complete(response({deviceId: ids[0], firmware: status(), uptimeMs: 100}));
  assert.equal((await pending).results.length, 3);
  let active = 0, peak = 0; const resolvers = [];
  for (const device of devices) device.request = () => new Promise(resolve => {
    active++; peak = Math.max(peak, active); resolvers.push(() => {active--; resolve(response({deviceId: device.id, firmware: status()}));});
  });
  const bounded = fleet.refresh(); await tick(); assert.equal(active, 2);
  resolvers.shift()(); await tick(); assert.equal(active, 2);
  resolvers.shift()(); resolvers.shift()(); await bounded; assert.equal(peak, 2);
});

test('a hung GET has a bounded timeout while other lamps remain readable', async () => {
  const {fleet, devices, changes} = setup(2);
  devices[0].request = () => new Promise(() => {}); fleet.requestTimeout = 5;
  const outcome = await fleet.refresh();
  assert.equal(outcome.results.find(result => result.id === ids[0]).state, 'offline');
  assert(changes.some(change => change.id === ids[1] && change.fresh));
});

test('legacy diagnostics fallback is GET-only and still verifies identity before showing the version', async () => {
  const {fleet, devices, calls} = setup();
  devices[0].firmware = {version: '1.4.0'};
  devices[0].request = (_, path) => path === '/api/diagnostics' ? response('Not found', 404) : undefined;
  const result = (await fleet.refresh()).results[0];
  assert.equal(result.installedVersion, '1.4.0'); assert.equal(result.verified, true); assert.equal(result.state, 'unsupported');
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/api/diagnostics','/api/state']);
  assert.equal(writes(calls).length, 0);
});

test('missing Wi-Fi address or saved credentials reports a per-lamp skip without guessing passwords', async () => {
  const {fleet, devices, calls, entries, setEntries} = setup(2);
  devices[0].password = ''; setEntries([{id: ids[1]}, entries()[0]]);
  const outcome = await fleet.updateAll();
  assert.deepEqual(outcome.results.map(result => result.state), ['unsupported','needs-password']);
  assert.equal(calls.length, 0);
});

test('a stalled credential read is bounded and does not prevent other lamp results', async () => {
  const {fleet, devices, calls} = setup(2);
  fleet.requestTimeout = 5;
  fleet.credential = async id => id === ids[0] ? new Promise(() => {}) : {value: devices[1].password};
  const outcome = await fleet.refresh();
  assert.equal(outcome.results.find(result => result.id === ids[0]).state, 'needs-password');
  assert.equal(outcome.results.find(result => result.id === ids[1]).installedVersion, '1.9.4');
  assert.equal(calls.length, 1);
});

test('wrong identity, malformed firmware, and failed authentication never produce verified version status', async () => {
  const {fleet, devices, calls} = setup(3);
  devices[0].identity = ids[1]; devices[1].firmware = {...status(), version: '<script>'};
  devices[2].request = () => response('Unauthorized', 401);
  const outcome = await fleet.refresh();
  assert.deepEqual(outcome.results.map(result => result.state), ['failed','failed','needs-password']);
  assert(outcome.results.every(result => !result.verified && !result.fresh)); assert.equal(writes(calls).length, 0);
});

test('off-LAN, encoded and broadcast targets never receive credentials or firmware requests', async () => {
  for (const address of ['https://coollamp.local','https://example.com','8.8.8.8','192.168.1.255','192.168.1.0',
    'http://user:password@192.168.1.20','192.168.1.20/api/state','192.168.1.20?next=evil','0xc0a80114','192.168.1.020']) {
    const {fleet, calls, setEntries} = setup(); let credentials = 0;
    fleet.credential = async () => {credentials++; return {value: 'secret'};};
    setEntries([{id: ids[0], address}]); const result = (await fleet.updateAll()).results[0];
    assert.equal(result.state, 'failed', address); assert.equal(calls.length, 0, address); assert.equal(credentials, 0, address);
  }
});

test('HTTP redirects and already-followed redirect responses are rejected', async () => {
  for (const reply of [response('Redirect', 302), {...response({deviceId: ids[0], firmware: status()}), url: 'https://example.com/api/diagnostics'}]) {
    const {fleet, devices, calls} = setup(); devices[0].request = () => reply;
    const result = (await fleet.updateAll()).results[0];
    assert.equal(result.state, 'failed'); assert.match(result.message, /redirected/); assert.equal(writes(calls).length, 0);
  }
});

test('cancellation, removal and address changes discard late page refresh responses', async () => {
  for (const action of ['cancel','remove','address']) {
    const {fleet, devices, changes, setEntries, entries} = setup(); let complete;
    devices[0].request = () => new Promise(resolve => {complete = resolve;});
    const pending = fleet.refresh(); await tick();
    if (action === 'cancel') fleet.cancelRefresh();
    if (action === 'remove') setEntries([]);
    if (action === 'address') setEntries([{...entries()[0], address: '192.168.1.25'}]);
    complete(response({deviceId: ids[0], firmware: status()}));
    const outcome = await pending;
    assert.equal(outcome.results.length, 0); assert.equal(changes.filter(change => change.verified).length, 0);
  }
});

test('a replacement refresh invalidates old results without mixing versions', async () => {
  const {fleet, devices, changes} = setup(); let complete, first = true;
  devices[0].request = () => {if (first) {first = false; return new Promise(resolve => {complete = resolve;});} return undefined;};
  const old = fleet.refresh(); await tick(); devices[0].firmware = status('1.9.5');
  const current = await fleet.refresh(); complete(response({deviceId: ids[0], firmware: status('1.9.4')}));
  assert.equal((await old).cancelled, true); assert.equal(current.results[0].installedVersion, '1.9.5');
  assert.deepEqual(changes.filter(change => change.verified).map(change => change.installedVersion), ['1.9.5']);
});

test('bulk checks and installs sequentially with fresh boot tokens, then verifies new firmware after reboot', async () => {
  const {fleet, devices, calls, changes} = setup(2);
  devices[0].polls = [status('1.9.4', 1), status('1.9.4', 2, '1.9.5'), {...status('1.9.4', 3, '1.9.5'), progress: 52},
    status('1.9.4', 4, '1.9.5'), Error('reboot'), status('1.9.5', 0, '1.9.5')];
  devices[1].firmware = status('1.9.5'); devices[1].polls = [status('1.9.5', 1), status('1.9.5', 0, '1.9.5')];
  devices[0].request = (_, path) => {if (path === '/api/state') devices[0].token += '-fresh';};
  const outcome = await fleet.updateAll();
  assert.deepEqual(outcome.results.map(result => result.state), ['updated','ready']);
  assert.deepEqual(writes(calls).map(call => new URL(call.url).pathname), ['/api/firmware/check','/api/firmware/install','/api/firmware/check']);
  assert.notEqual(writes(calls)[0].headers['X-Lamp-Token'], writes(calls)[1].headers['X-Lamp-Token']);
  const firstSecondLamp = calls.findIndex(call => call.url.startsWith('http://192.168.1.21/'));
  const firstUpdated = changes.findIndex(change => change.id === ids[0] && change.state === 'updated');
  assert(firstSecondLamp > calls.findIndex(call => call.url.endsWith('/api/firmware/install'))); assert(firstUpdated >= 0);
  assert.equal(outcome.results[0].installedVersion, '1.9.5'); assert.equal(outcome.results[0].verified, true);
  assert(writes(calls).every(call => !call.url.endsWith('/automatic')));
});

test('bulk checks latest firmware but never installs the same or an older offered version', async () => {
  for (const latest of ['1.9.5','1.9.4','1.8.9']) {
    const {fleet, devices, calls} = setup(); devices[0].firmware = status('1.9.5');
    devices[0].polls = [status('1.9.5', 2, latest)];
    const result = (await fleet.updateAll()).results[0];
    assert.equal(result.state, 'ready'); assert.equal(result.installedVersion, '1.9.5'); assert.equal(result.available, false);
    assert.equal(writes(calls).length, 1); assert(writes(calls)[0].url.endsWith('/check'));
  }
});

test('one lamp update failure does not prevent later lamps being checked', async () => {
  const {fleet, devices, calls} = setup(2);
  devices[0].polls = [{...status('1.9.4', 5), error: 3}]; devices[1].polls = [status('1.9.5')];
  const outcome = await fleet.updateAll();
  assert.deepEqual(outcome.results.map(result => result.state), ['failed','updated']);
  assert.match(outcome.results[0].message, /cannot reach the update server/); assert.equal(writes(calls).length, 2);
});

test('updater errors preserve their firmware protocol meaning', async () => {
  for (const [error, message] of [[5,/USB partition/],[6,/verification or download/],[7,/save update settings/],[8,/enough memory/]]) {
    const {fleet, devices} = setup(); devices[0].polls = [{...status('1.9.4', 5), error}];
    assert.match((await fleet.updateAll()).results[0].message, message);
  }
});

test('a rejected check is not mistaken for a successful latest-version check', async () => {
  const {fleet, devices, calls} = setup();
  devices[0].request = (_, path) => path.endsWith('/check') ? response('Still starting', 409) : undefined;
  const result = (await fleet.updateAll()).results[0];
  assert.equal(result.state, 'failed'); assert.match(result.message, /not accepted/); assert.equal(writes(calls).length, 1);
});

test('changed identity directly before an update prevents any mutation', async () => {
  const {fleet, devices, calls} = setup();
  devices[0].request = (_, path) => path === '/api/state' ? response({deviceId: ids[1], token: 'other-token', firmware: status()}) : undefined;
  const result = (await fleet.updateAll()).results[0];
  assert.equal(result.state, 'failed'); assert.match(result.message, /different lamp/); assert.equal(writes(calls).length, 0);
});

test('changed identity or address before install prevents install even after a successful check', async () => {
  for (const action of ['identity','address']) {
    const {fleet, devices, calls, entries, setEntries} = setup(); let reads = 0;
    devices[0].polls = [status('1.9.4', 2, '1.9.5')];
    devices[0].request = (_, path) => {
      if (path === '/api/state' && ++reads === 2) {
        if (action === 'identity') return response({deviceId: ids[1], token: 'other-token', firmware: devices[0].firmware});
        setEntries([{...entries()[0], address: '192.168.1.29'}]);
      }
    };
    const result = await fleet.updateAll();
    assert.equal(writes(calls).length, 1); assert(writes(calls)[0].url.endsWith('/check'));
    if (action === 'identity') assert.equal(result.results[0].state, 'failed'); else assert.equal(result.results.length, 0);
  }
});

test('an automatic install already underway is observed without a duplicate check or install', async () => {
  const {fleet, devices, calls} = setup(); devices[0].firmware = {...status('1.9.4', 3, '1.9.5'), automatic: true};
  devices[0].polls = [status('1.9.4', 4, '1.9.5'), status('1.9.5')];
  const result = (await fleet.updateAll()).results[0];
  assert.equal(result.state, 'updated'); assert.equal(writes(calls).length, 0);
});

test('automatic install race after available status reuses active update instead of sending install', async () => {
  const {fleet, devices, calls} = setup(); let states = 0;
  devices[0].polls = [status('1.9.4', 2, '1.9.5'), status('1.9.4', 3, '1.9.5'), status('1.9.5')];
  devices[0].request = (_, path) => {if (path === '/api/state' && ++states === 2) devices[0].firmware = status('1.9.4', 3, '1.9.5');};
  const result = (await fleet.updateAll()).results[0];
  assert.equal(result.state, 'updated'); assert.equal(writes(calls).length, 1); assert(writes(calls)[0].url.endsWith('/check'));
});

test('install POST 409 while automatic updater wins is reconciled without mutation replay', async () => {
  const {fleet, devices, calls} = setup();
  devices[0].polls = [status('1.9.4', 2, '1.9.5'), status('1.9.4', 3, '1.9.5'), status('1.9.5')];
  devices[0].request = (_, path) => path.endsWith('/install') ? response('Busy', 409) : undefined;
  const result = (await fleet.updateAll()).results[0];
  assert.equal(result.state, 'updated'); assert.equal(writes(calls).filter(call => call.url.endsWith('/install')).length, 1);
});

test('uncertain accepted install is reconciled through reads and never replayed', async () => {
  const {fleet, devices, calls} = setup();
  devices[0].polls = [status('1.9.4', 2, '1.9.5'), status('1.9.4', 3, '1.9.5'), status('1.9.5')];
  devices[0].request = (_, path) => {if (path.endsWith('/install')) throw Error('lost reply');};
  const result = (await fleet.updateAll()).results[0];
  assert.equal(result.state, 'updated'); assert.equal(writes(calls).filter(call => call.url.endsWith('/install')).length, 1);
});

test('uncertain check and install failures are bounded and never send the mutation twice', async () => {
  for (const phase of ['check','install']) {
    const {fleet, devices, calls} = setup();
    devices[0].polls = phase === 'install' ? [status('1.9.4', 2, '1.9.5')] : [];
    devices[0].request = (_, path) => {if (path.endsWith('/' + phase)) throw Error('lost reply');};
    const result = (await fleet.updateAll()).results[0];
    assert.equal(result.state, 'failed'); assert.match(result.message, /not repeated/);
    assert.equal(writes(calls).filter(call => call.url.endsWith('/' + phase)).length, 1);
  }
});

test('firmware restart is not declared complete until the new lamp survives the health interval', async () => {
  const {fleet, devices, changes} = setup(); let observedNew = 0;
  devices[0].polls = [status('1.9.4', 2, '1.9.5'), status('1.9.5')];
  devices[0].request = (_, path) => {
    if (path === '/api/diagnostics' && devices[0].firmware.version === '1.9.5') {
      return response({deviceId: ids[0], firmware: devices[0].firmware, uptimeMs: ++observedNew < 3 ? 10 : 40});
    }
  };
  const result = (await fleet.updateAll()).results[0];
  assert.equal(result.state, 'updated'); assert.equal(observedNew, 3);
  assert.equal(changes.filter(change => change.state === 'restarting' && change.message.includes('Verifying')).length, 2);
});

test('identity changes after reboot cannot report another lamp’s version as a completed update', async () => {
  const {fleet, devices} = setup(); devices[0].polls = [status('1.9.4', 2, '1.9.5'), status('1.9.5')];
  devices[0].request = (_, path) => {if (path === '/api/diagnostics' && devices[0].firmware.version === '1.9.5') devices[0].identity = ids[1];};
  const result = (await fleet.updateAll()).results[0];
  assert.equal(result.state, 'failed'); assert.equal(result.verified, false); assert.match(result.message, /different lamp/);
});

test('duplicate bulk calls share work and read-only page refresh does not interfere with bulk', async () => {
  const {fleet, devices, calls} = setup(); let complete;
  devices[0].request = (_, path) => path === '/api/diagnostics' && !complete ? new Promise(resolve => {complete = resolve;}) : undefined;
  devices[0].polls = [status('1.9.4', 0, '1.9.4')];
  const first = fleet.updateAll(), duplicate = fleet.updateAll(); assert.equal(first, duplicate); await tick();
  assert.deepEqual(await fleet.refresh(), {results: [], cancelled: false, busy: true});
  fleet.cancelRefresh();
  complete(response({deviceId: ids[0], uptimeMs: 100, firmware: status()}));
  assert.equal((await first).results[0].state, 'ready'); assert.equal(writes(calls).length, 1);
});

test('cancelling bulk after an accepted request stops later lamps and does not replay the accepted request', async () => {
  const {fleet, devices, calls} = setup(2);
  devices[0].request = (_, path) => {
    if (path.endsWith('/check')) {queueMicrotask(() => fleet.cancel()); return response('Checking', 202);}
  };
  const result = await fleet.updateAll();
  assert.equal(result.cancelled, true); assert.equal(writes(calls).length, 1);
  assert(calls.every(call => call.url.startsWith('http://192.168.1.20/')));
});

test('failed refresh retains its last verified timestamp and cached version with freshness cleared', async () => {
  const {fleet, devices, setNow} = setup(); await fleet.refresh(); setNow(2000);
  devices[0].request = () => {throw Error('offline');};
  const result = (await fleet.refresh()).results[0];
  assert.equal(result.state, 'offline'); assert.equal(result.installedVersion, '1.9.4'); assert.equal(result.checkedAt, 1000);
  assert.equal(result.attemptedAt, 2000); assert.equal(result.fresh, false); assert.equal(result.verified, false);
});

test('same identity-verified diagnostic read supplies per-lamp signal without additional requests or private fields',async()=>{
  const {fleet,devices,calls}=setup(2);
  devices[0].request=()=>response({deviceId:ids[0],firmware:status(),wifi:{connected:true,rssi:-58,password:'private',ssid:'private'}});
  devices[1].request=()=>response({deviceId:ids[1],firmware:status(),wifi:{connected:false,rssi:0}});
  const result=await fleet.refresh();
  assert.deepEqual(result.results.map(row=>row.wifi),[{connected:true,rssi:-58},{connected:false,rssi:null}]);
  assert(result.results.every(row=>row.wifiObservedAt===1000));assert.equal(calls.length,2);assert.equal(writes(calls).length,0);
  assert(!JSON.stringify(result.results).includes('private'));
});
test('slow diagnostic signal retains its own observation time instead of later firmware completion time',async()=>{
  const {fleet,devices,setNow}=setup();let finish;
  devices[0].request=()=>new Promise(resolve=>{finish=resolve;});
  const pending=fleet.refresh();await tick();setNow(1200);
  finish(response({deviceId:ids[0],firmware:status(),wifi:{connected:true,rssi:-67}}));
  const row=(await pending).results[0];assert.equal(row.checkedAt,1200);assert.equal(row.wifiObservedAt,1000);
});
test('a subsequent signal-less read cannot merge a previously valid RSSI into fresh firmware status',async()=>{
  const {fleet,devices,setNow}=setup();
  devices[0].request=()=>response({deviceId:ids[0],firmware:status(),wifi:{connected:true,rssi:-45}});
  await fleet.refresh();setNow(2000);devices[0].request=undefined;
  const row=(await fleet.refresh()).results[0];assert.deepEqual(row.wifi,{connected:true});assert.equal(row.wifiObservedAt,2000);
  devices[0].identity=ids[1];const wrong=(await fleet.refresh()).results[0];assert.equal(wrong.verified,false);assert.equal(wrong.fresh,false);
});
test('forget cancels pending reads and removes internal signal telemetry before rediscovery',async()=>{
  const {fleet,devices}=setup();
  devices[0].request=()=>response({deviceId:ids[0],firmware:status(),wifi:{connected:true,rssi:-50}});
  await fleet.refresh();assert.equal(fleet.statuses.get(ids[0]).wifi.rssi,-50);
  let finish;devices[0].request=()=>new Promise(resolve=>{finish=resolve;});
  const pending=fleet.refresh();await tick();fleet.forget(ids[0]);
  finish(response({deviceId:ids[0],firmware:status(),wifi:{connected:true,rssi:-40}}));
  assert.equal((await pending).cancelled,true);assert.equal(fleet.statuses.has(ids[0]),false);
});

test('failed slow GET publishes its start time so newer BLE observations survive invalidation',async()=>{
  const {fleet,devices,setNow}=setup();let reject;
  devices[0].request=()=>new Promise((_,fail)=>{reject=fail;});
  const pending=fleet.refresh();await tick();setNow(1500);reject(Error('offline'));
  const row=(await pending).results[0];assert.equal(row.state,'offline');assert.equal(row.attemptedAt,1000);
});

test('one verified diagnostics GET supplies role membership without private sync data or another request',async()=>{
  const {fleet,devices,calls}=setup(2);
  devices[0].request=()=>response({deviceId:ids[0],firmware:status(),sync:{version:2,role:2,leader:ids[1],key:'private',peers:[{password:'private'}]}});
  devices[1].request=()=>response({deviceId:ids[1],firmware:status(),sync:{version:2,role:1,leader:ids[1],invite:'private'}});
  const result=await fleet.refresh();
  assert.deepEqual(result.results.map(row=>row.group),[{role:2,leader:ids[1]},{role:1,leader:ids[1]}]);
  assert(result.results.every(row=>row.groupObservedAt===1000));assert.equal(calls.length,2);assert.equal(writes(calls).length,0);
  assert(!JSON.stringify(result.results).includes('private'));
});

test('same verified diagnostic read carries sanitized physical style and its request-start timestamp',async()=>{
 const {fleet,devices,calls,setNow}=setup();let finish;
 devices[0].request=()=>new Promise(resolve=>{finish=resolve;});
 const pending=fleet.refresh();await tick();setNow(1300);
 finish(response({deviceId:ids[0],firmware:status(),lampStyle:{version:1,code:3,id:'corkscrew',family:'corkscrew',token:'private'}}));
 const row=(await pending).results[0];assert.deepEqual(row.lampStyle,{version:1,code:3,id:'corkscrew',family:'corkscrew'});
 assert.equal(row.styleObservedAt,1000);assert.equal(row.checkedAt,1300);assert.equal(calls.length,1);assert.equal(writes(calls).length,0);assert(!JSON.stringify(row).includes('private'));
 setNow(2000);devices[0].request=()=>response({deviceId:ids[0],firmware:status(),lampStyle:'corkscrew'});
 const next=(await fleet.refresh()).results[0];assert.equal(next.lampStyle,null);assert.equal(next.styleObservedAt,null);
});

test('group current effect comes from verified scene metadata with no extra catalogue request',async()=>{
 const {fleet,devices,calls}=setup();
 devices[0].request=()=>response({deviceId:ids[0],firmware:status(),render:{mode:46,power:true},sync:{version:2,role:2,leader:ids[1],scene:27,sceneCount:32,active:true,paused:false}});
 const row=(await fleet.refresh()).results[0];assert.equal(row.lighting.name,'Chromatic screw');assert.equal(row.lighting.kind,'group');assert.equal(row.lightingObservedAt,1000);assert.equal(calls.length,1);
});
test('standalone catalogues are per lamp and firmware profile, fetched once without delaying first verified status',async()=>{
 const {fleet,devices,calls,changes,setNow}=setup(2);
 for(let i=0;i<2;i++)devices[i].request=(_,path)=>path==='/api/effects'?response([{id:1,name:'Effect on lamp '+i,category:'calm',speed:true}]):response({deviceId:ids[i],firmware:status(),render:{mode:1,power:true},audio:{installed:true},sync:{version:2,role:0}});
 const rows=(await fleet.refresh()).results;assert.deepEqual(rows.map(row=>row.lighting.name).sort(),['Effect on lamp 0','Effect on lamp 1']);
 assert.equal(calls.filter(call=>call.url.endsWith('/api/effects')).length,2);assert(changes.some(row=>row.verified&&row.lighting.name===null));
 setNow(2000);await fleet.refresh();assert.equal(calls.filter(call=>call.url.endsWith('/api/effects')).length,2);
 fleet.forget(ids[0]);await fleet.refresh();assert.equal(calls.filter(call=>call.url.endsWith('/api/effects')).length,3);
 assert.equal(writes(calls).length,0);
});
test('failed catalogue enrichment preserves known firmware and busy updater never starts enrichment',async()=>{
 const {fleet,devices,calls}=setup();
 devices[0].request=(_,path)=>path==='/api/effects'?response('No catalogue',404):response({deviceId:ids[0],firmware:status(),render:{mode:1,power:true}});
 const row=(await fleet.refresh()).results[0];assert.equal(row.verified,true);assert.equal(row.installedVersion,'1.9.4');assert.equal(row.lighting.name,null);
 devices[0].request=()=>response({deviceId:ids[0],firmware:status('1.9.4',1),render:{mode:1,power:true}});
 await fleet.refresh();assert.equal(calls.filter(call=>call.url.endsWith('/api/effects')).length,1);
});
