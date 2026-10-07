import test from 'node:test';
import assert from 'node:assert/strict';
import { GroupDiscovery } from '../src/group-discovery.js';

const ids = ['aabbccddeeff','112233445566','0123456789ab','fedcba987654'];
const groupKey = '0123456789abcdef0123456789abcdef';
const code = id => 'CL1-' + id + '-' + groupKey;
const response = (data, status = 200) => ({status, data: typeof data === 'string' ? data : JSON.stringify(data)});
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(count = 3) {
  let entries = ids.slice(0, count).map((id, index) => ({id, address: `192.168.1.${20 + index}`, name: 'Lamp ' + index}));
  const devices = entries.map((entry, index) => ({...entry, password: 'coollamp', token: 'private-boot-token-' + index,
    sync: {version: 2, role: index === 1 ? 1 : 0, leader: index === 1 ? entry.id : '', members: 0,
      paused: true, active: false, order: index === 1 ? [{id: entry.id, online: true}] : [], peers: []}}));
  let target = {...entries[0], epoch: 7, sync: devices[0].sync};
  const savedPasswords = new Map(entries.map(entry => [entry.id, 'coollamp'])), calls = [], changes = [], credentials = [];
  const http = {request: async options => {
    calls.push(options);
    const url = new URL(options.url), device = devices.find(entry => entry.address === url.hostname);
    assert(device, 'Only known local test lamps may be queried.');
    assert.equal(options.disableRedirects, true);
    if (device.request) {const result = await device.request(options, url.pathname); if (result !== undefined) return result;}
    if (options.headers.Authorization !== 'Basic ' + btoa('lamp:' + device.password)) return response('Unauthorized', 401);
    if (url.pathname === '/api/diagnostics' || url.pathname === '/api/state') return response({deviceId: device.identity || device.id,
      name: device.name, token: url.pathname.endsWith('/state') ? device.token : undefined, firmware: {version: '1.9.5'}, sync: device.sync,
      privatePassword: device.password, privateKey: groupKey});
    assert.equal(url.pathname, '/api/sync/invite'); assert.equal(options.method, 'POST'); assert.equal(options.data, '');
    assert.equal(options.headers['X-Lamp-Token'], device.token);
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    return response(code(device.id));
  }};
  const discovery = new GroupDiscovery({http, credential: async id => {credentials.push(id); return {value: savedPasswords.get(id) || ''};},
    getLamps: () => entries, getTarget: () => target, onStatus: (id, status) => changes.push({id, ...status}), requestTimeout: 1000, now: () => 1234});
  return {discovery, devices, calls, changes, credentials, savedPasswords, entries: () => entries,
    setEntries: value => {entries = value;}, target: () => target, setTarget: value => {target = value;}};
}
const writes = calls => calls.filter(call => call.method === 'POST');

test('GET-only scan lists verified coordinators, excludes selected lamp and keeps dark/paused coordinators', async () => {
  const {discovery, calls, changes} = setup();
  const outcome = await discovery.scan();
  assert.equal(outcome.cancelled, false); assert.equal(outcome.coordinators.length, 1);
  assert.equal(outcome.coordinators[0].id, ids[1]); assert.equal(outcome.coordinators[0].joinable, true);
  assert.equal(outcome.coordinators[0].checkedAt, 1234);
  assert(calls.every(call => call.method === 'GET' && !call.url.startsWith('http://192.168.1.20/')));
  assert.equal(writes(calls).length, 0); assert(changes.some(change => change.state === 'not-coordinator'));
});

test('selected lamp peers contribute unlisted coordinators but known mDNS address takes precedence', async () => {
  const {discovery, devices, calls, target, setEntries} = setup(4);
  target().sync.peers = [{id: ids[1], address: '192.168.1.199', name: 'Stale peer', role: 1},
    {id: ids[3], address: devices[3].address, name: 'New peer', role: 1}, {id: ids[2], address: devices[2].address, role: 2}];
  devices[3].sync = {...devices[1].sync, leader: ids[3], order: [{id: ids[3]}]};
  setEntries([target(), {id: ids[1], address: devices[1].address, name: 'Known coordinator'}]);
  const outcome = await discovery.scan();
  assert.deepEqual(new Set(outcome.coordinators.map(entry => entry.id)), new Set([ids[1],ids[3]]));
  assert(calls.some(call => call.url.startsWith('http://192.168.1.21/'))); assert(!calls.some(call => call.url.includes('.199/')));
  assert(!calls.some(call => call.url.startsWith('http://192.168.1.22/')));
});

test('missing credentials uses the documented factory password exactly once for read-only discovery', async () => {
  const {discovery, savedPasswords, calls, credentials} = setup(2); savedPasswords.clear();
  const outcome = await discovery.scan();
  assert.equal(outcome.coordinators.length, 1); assert.equal(calls.length, 1); assert.deepEqual(credentials, [ids[1]]);
  assert.equal(calls[0].headers.Authorization, 'Basic ' + btoa('lamp:coollamp')); assert.equal(calls[0].method, 'GET');
});

test('custom password rejection marks an unverified candidate and never retries a different password', async () => {
  const {discovery, devices, savedPasswords, calls} = setup(2);
  devices[1].password = 'custom-access-password'; savedPasswords.set(ids[1], 'wrong-saved-password');
  const outcome = await discovery.scan();
  assert.equal(outcome.coordinators.length, 0); assert.equal(outcome.results[0].state, 'needs-password');
  assert.equal(outcome.results[0].verified, false); assert.equal(outcome.results[0].role, null); assert.equal(calls.length, 1);
  await assert.rejects(discovery.invite(ids[1]), error => error.needsPassword === true);
  assert.equal(writes(calls).length, 0); assert.equal(savedPasswords.get(ids[1]), 'wrong-saved-password');
});

test('an entered coordinator password gets a transient invitation without selecting or saving that coordinator', async () => {
  const {discovery, devices, savedPasswords, calls, target} = setup(2);
  devices[1].password = 'custom-access-password'; savedPasswords.clear();
  const selectedBefore = target();
  const invite = await discovery.invite(ids[1], 'custom-access-password');
  assert.deepEqual(invite, {id: ids[1], targetId: ids[0], code: code(ids[1])});
  assert.equal(target(), selectedBefore); assert.equal(savedPasswords.size, 0);
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/api/state','/api/sync/invite','/api/state']);
});

test('scan results, callback statuses and retained metadata contain no invitations, passwords, tokens or raw state', async () => {
  const {discovery, changes} = setup(2);
  const scan = await discovery.scan(); await discovery.invite(ids[1]);
  for (const value of [scan, changes, [...discovery.statuses.values()]]) {
    const serialized = JSON.stringify(value);
    for (const secret of [groupKey,'CL1-','private-boot-token','privatePassword','privateKey','token','coollamp']) {
      assert(!serialized.includes(secret), 'Metadata must exclude secret field ' + secret);
    }
  }
  assert.equal(discovery.invites.size, 0);
});

test('scan concurrency is bounded to two and fast results arrive before a slow lamp', async () => {
  const {discovery, devices, changes} = setup(4); let resolveSlow;
  devices[1].request = () => new Promise(resolve => {resolveSlow = resolve;});
  const pending = discovery.scan(); await tick();
  assert(changes.some(change => change.id === ids[2] && change.state === 'not-coordinator'));
  assert(changes.some(change => change.id === ids[3] && change.state === 'not-coordinator'));
  resolveSlow(response({deviceId: ids[1], sync: devices[1].sync})); await pending;
  let active = 0, peak = 0; const resolvers = [];
  for (const device of devices.slice(1)) device.request = () => new Promise(resolve => {
    active++; peak = Math.max(peak, active); resolvers.push(() => {active--; resolve(response({deviceId: device.id, sync: device.sync}));});
  });
  const bounded = discovery.scan(); await tick(); assert.equal(active, 2);
  resolvers.shift()(); await tick(); assert.equal(active, 2);
  resolvers.shift()(); resolvers.shift()(); await bounded; assert.equal(peak, 2);
});

test('both HTTP and credential hangs are bounded and do not block other candidate results', async () => {
  for (const stage of ['http','credential']) {
    const {discovery, devices} = setup(3); discovery.requestTimeout = 5;
    if (stage === 'http') devices[1].request = () => new Promise(() => {});
    else discovery.credential = async id => id === ids[1] ? new Promise(() => {}) : {value: 'coollamp'};
    const outcome = await discovery.scan();
    assert.equal(outcome.results.find(entry => entry.id === ids[1]).state, stage === 'http' ? 'offline' : 'needs-password');
    assert.equal(outcome.results.find(entry => entry.id === ids[2]).state, 'not-coordinator');
  }
});

test('legacy diagnostics 404 falls back to authenticated state without requesting an invitation', async () => {
  const {discovery, devices, calls} = setup(2);
  devices[1].request = (_, path) => path === '/api/diagnostics' ? response('Not found', 404) : undefined;
  const outcome = await discovery.scan();
  assert.equal(outcome.coordinators.length, 1); assert.equal(writes(calls).length, 0);
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/api/diagnostics','/api/state']);
});

test('wrong hardware identity, mismatched coordinator leader and invalid sync schema never become verified coordinators', async () => {
  for (const invalid of ['identity','leader','role','version']) {
    const {discovery, devices, calls} = setup(2);
    if (invalid === 'identity') devices[1].identity = ids[2];
    if (invalid === 'leader') devices[1].sync.leader = ids[2];
    if (invalid === 'role') devices[1].sync.role = 7;
    if (invalid === 'version') devices[1].sync.version = 9;
    const outcome = await discovery.scan();
    assert.equal(outcome.coordinators.length, 0); assert.equal(outcome.results[0].state, 'failed');
    assert.equal(outcome.results[0].verified, false); assert.equal(writes(calls).length, 0);
  }
});

test('redirects and off-LAN, encoded, broadcast, invalid-identity candidates never receive an invitation', async () => {
  for (const address of ['https://coollamp.local','example.com','8.8.8.8','192.168.1.255','192.168.1.0',
    'http://user:password@192.168.1.21','192.168.1.21/api/state','192.168.1.21?query=evil','0xc0a80115','192.168.1.021']) {
    const {discovery, setEntries, calls, credentials} = setup(2); setEntries([{id: ids[1], address}]);
    assert.equal((await discovery.scan()).results.length, 0);
    await assert.rejects(discovery.invite(ids[1]), /removed/); assert.equal(calls.length, 0); assert.equal(credentials.length, 0);
  }
  for (const reply of [response('Redirect', 302), {...response({deviceId: ids[1], sync: {version: 2, role: 1, leader: ids[1]}}), url: 'https://example.com/api/state'}]) {
    const {discovery, devices, calls} = setup(2); devices[1].request = () => reply;
    await assert.rejects(discovery.invite(ids[1]), /redirected/); assert.equal(writes(calls).length, 0);
  }
});

test('scan cancellation, replacement, candidate removal and address changes discard late results', async () => {
  for (const action of ['cancel','replace','remove','address']) {
    const {discovery, devices, changes, entries, setEntries} = setup(2); let complete, first = true;
    devices[1].request = () => {if (first) {first = false; return new Promise(resolve => {complete = resolve;});} return undefined;};
    const pending = discovery.scan(); await tick();
    if (action === 'cancel') discovery.cancelScan();
    if (action === 'replace') await discovery.scan();
    if (action === 'remove') setEntries([entries()[0]]);
    if (action === 'address') setEntries([entries()[0], {...entries()[1], address: '192.168.1.29'}]);
    complete(response({deviceId: ids[1], sync: devices[1].sync})); const result = await pending;
    assert.equal(result.coordinators.length, 0); assert.equal(result.results.length, 0);
    assert.equal(changes.filter(change => change.verified).length, action === 'replace' ? 1 : 0);
  }
});

test('selected lamp switch, disconnect, epoch or role changes cancel stale scans', async () => {
  for (const action of ['switch','disconnect','epoch','role']) {
    const {discovery, devices, setTarget, target} = setup(2); let complete;
    devices[1].request = () => new Promise(resolve => {complete = resolve;});
    const pending = discovery.scan(); await tick();
    if (action === 'switch') setTarget({...target(), id: ids[2], address: '192.168.1.22'});
    if (action === 'disconnect') setTarget(null);
    if (action === 'epoch') target().epoch++;
    if (action === 'role') target().sync.role = 2;
    complete(response({deviceId: ids[1], sync: devices[1].sync}));
    const result = await pending; assert.equal(result.cancelled, true); assert.equal(result.results.length, 0);
  }
});

test('invitation freshly checks identity, coordinator role and boot token even after a successful scan', async () => {
  const {discovery, devices, calls} = setup(2); await discovery.scan(); calls.length = 0;
  devices[1].token = 'new-private-boot-token';
  const invite = await discovery.invite(ids[1]);
  assert.equal(invite.targetId, ids[0]); assert.equal(invite.code, code(ids[1]));
  assert.equal(writes(calls)[0].headers['X-Lamp-Token'], 'new-private-boot-token');
  assert.deepEqual(calls.map(call => call.method), ['GET','POST','GET']);
});

test('role rotation or different identity before invitation prevents any POST', async () => {
  for (const invalid of ['role','identity','leader']) {
    const {discovery, devices, calls} = setup(2); await discovery.scan(); calls.length = 0;
    if (invalid === 'role') devices[1].sync = {...devices[1].sync, role: 0};
    if (invalid === 'identity') devices[1].identity = ids[2];
    if (invalid === 'leader') devices[1].sync.leader = ids[2];
    await assert.rejects(discovery.invite(ids[1]), /coordinating|different lamp|invalid coordinator/); assert.equal(writes(calls).length, 0);
  }
});

test('a lamp cannot join itself and invitations need a currently selected Wi-Fi target', async () => {
  const {discovery, calls, setTarget} = setup(2);
  await assert.rejects(discovery.invite(ids[0]), /own group/); assert.equal(calls.length, 0);
  setTarget(null); await assert.rejects(discovery.invite(ids[1]), /Connect to the lamp/); assert.equal(calls.length, 0);
});

test('group wire-version mismatch and full room capacity prevent an invitation', async () => {
  for (const invalid of ['version','order','members']) {
    const {discovery, devices, calls} = setup(2);
    if (invalid === 'version') devices[1].sync.version = 1;
    if (invalid === 'order') devices[1].sync.order = Array.from({length: 9}, (_, i) => ({id: i.toString(16).padStart(12,'0')}));
    if (invalid === 'members') devices[1].sync.members = 8;
    const scan = await discovery.scan(); assert.equal(scan.coordinators[0].joinable, false);
    await assert.rejects(discovery.invite(ids[1]), /group firmware version|group is full/); assert.equal(writes(calls).length, 0);
  }
});

test('an existing ordered group member can retrieve an invitation even when the room has nine lamps', async () => {
  const {discovery, devices} = setup(2);
  devices[1].sync.members = 8; devices[1].sync.order = Array.from({length: 9}, (_, i) => ({id: i === 0 ? ids[0] : i.toString(16).padStart(12,'0')}));
  assert.equal((await discovery.invite(ids[1])).targetId, ids[0]);
});

test('missing, malformed or header-injecting boot tokens never reach the invitation endpoint', async () => {
  for (const token of [undefined,'','bad\r\nInjected: header', 'a'.repeat(129)]) {
    const {discovery, devices, calls} = setup(2); devices[1].token = token;
    await assert.rejects(discovery.invite(ids[1]), /session token/); assert.equal(writes(calls).length, 0);
  }
});

test('a stale-token 403 does not retry the invitation or ask for another password', async () => {
  const {discovery, devices, calls} = setup(2);
  devices[1].request = (_, path) => path.endsWith('/invite') ? response('Refresh the page', 403) : undefined;
  await assert.rejects(discovery.invite(ids[1]), error => error.staleToken === true && !error.needsPassword);
  assert.equal(writes(calls).length, 1);
});

test('invitations with malformed codes or another leader are rejected without exposing their contents', async () => {
  for (const invalid of ['secret-invalid-invitation', code(ids[2]), code(ids[1]) + '-extra']) {
    const {discovery, devices, changes} = setup(2);
    devices[1].request = (_, path) => path.endsWith('/invite') ? response(invalid) : undefined;
    await assert.rejects(discovery.invite(ids[1]), error => !error.message.includes(invalid) && /invalid group invitation/.test(error.message));
    assert(!JSON.stringify(changes).includes(invalid));
  }
});

test('coordinator reboot, identity or role change after the invitation makes the returned code unusable', async () => {
  for (const action of ['token','role','identity','version','capacity']) {
    const {discovery, devices, calls} = setup(2); let reads = 0;
    devices[1].request = (_, path) => {
      if (path === '/api/state' && ++reads === 2) {
        if (action === 'token') devices[1].token = 'changed-boot-token';
        if (action === 'role') devices[1].sync.role = 0;
        if (action === 'identity') devices[1].identity = ids[2];
        if (action === 'version') devices[1].sync.version = 1;
        if (action === 'capacity') devices[1].sync.members = 8;
      }
    };
    await assert.rejects(discovery.invite(ids[1]), /changed|different lamp|firmware version|group is full/); assert.equal(writes(calls).length, 1);
  }
});

test('selected target switch, removal, coordinator address change and cancellation discard an in-flight invitation', async () => {
  for (const action of ['switch','epoch','remove','address','cancel']) {
    const {discovery, devices, calls, target, setTarget, entries, setEntries} = setup(2); let complete;
    devices[1].request = (_, path) => path.endsWith('/invite') ? new Promise(resolve => {complete = resolve;}) : undefined;
    const pending = discovery.invite(ids[1]); await tick();
    if (action === 'switch') setTarget({...target(), id: ids[2], address: '192.168.1.22'});
    if (action === 'epoch') target().epoch++;
    if (action === 'remove') setEntries([entries()[0]]);
    if (action === 'address') setEntries([entries()[0], {...entries()[1], address: '192.168.1.29'}]);
    if (action === 'cancel') discovery.cancel();
    complete(response(code(ids[1])));
    await assert.rejects(pending, error => error.cancelled || error.stale); assert.equal(writes(calls).length, 1);
    assert.equal(discovery.invites.size, 0);
  }
});

test('uncertain invitation POST is bounded, never replayed and never returns a code', async () => {
  for (const failure of ['timeout','disconnect']) {
    const {discovery, devices, calls, changes} = setup(2); discovery.requestTimeout = 5;
    devices[1].request = (_, path) => {
      if (path.endsWith('/invite')) {if (failure === 'timeout') return new Promise(() => {}); throw Error('lost response with private server contents');}
    };
    await assert.rejects(discovery.invite(ids[1]), error => error.uncertain && !error.message.includes('private server contents'));
    assert.equal(writes(calls).length, 1); assert(!JSON.stringify(changes).includes(groupKey));
  }
});

test('duplicate invitation calls share one request and forget the code when complete', async () => {
  const {discovery, devices, calls} = setup(2); let complete;
  devices[1].request = (_, path) => path.endsWith('/invite') ? new Promise(resolve => {complete = resolve;}) : undefined;
  const first = discovery.invite(ids[1]), second = discovery.invite(ids[1]); assert.equal(first, second); await tick();
  complete(response(code(ids[1]))); assert.equal((await first).code, code(ids[1]));
  assert.equal(writes(calls).length, 1); assert.equal(discovery.invites.size, 0);
});
