import test from 'node:test';
import assert from 'node:assert/strict';
import {runLampPower,lampPowerSnapshot,legacyPowerWithoutGroups} from '../src/lamp-power.js';
import {runGroupLighting} from '../src/group-lighting-ui.js';
import {WifiTransport} from '../src/wifi.js';
import {LampTransport} from '../src/transport.js';
import {COMMAND,STATE,FIRMWARE} from '../src/protocol.js';

const id='aabbccddeeff',leader='112233445566';
const group=(role=0)=>({role,leader:role===1?id:role===2?leader:null});
function fixture({role=0,power=true}={}) {
  const raw={deviceId:id,hostname:'coollamp-test.local',name:'Test lamp',power,mode:1,brightness:100,
    firmware:{version:'1.9.6',phase:0,wifi:true},sync:{version:2,...group(role),paused:false,active:role===2,scene:0,sceneCount:32,key:'private-key'},
    token:'private-token',wifi:{connected:true,rssi:-64,ssid:'private-ssid'},effects:['Rain'],
    calibration:{active:false},colors:[[1,1,2,3]],effectOptions:[[50,80,0,4,5,6]]};
  const writes=[],reads=[],snapshots=[],other={id:'fedcba987654',power:true},calls={acquire:0,release:0};
  let current=true,clock=1000,tail=Promise.resolve();
  const lamp={identity:id,epoch:4,base:'http://192.168.1.9',raw,state:{...raw},catalog:[{id:1,name:'Rain',category:'calm',speed:true}],
    enqueue(action){const result=tail.then(action);tail=result.catch(()=>{});return result;},
    async refresh(expected){reads.push(expected);if(this.onRead)await this.onRead();this.state={...raw};return raw;},
    command(action,value,response,beforeWrite){return this.enqueue(async()=>{
      if(this.beforeCommand)await this.beforeCommand();beforeWrite?.();
      writes.push({action,value});if(this.onWrite)await this.onWrite(action,value);
      if(action==='power'){raw.power=Boolean(value);if(raw.sync?.role===2&&!value){raw.sync.paused=true;raw.sync.active=false;}}
      this.state={...raw};
    });}};
  const options={id,expected:{power,group:group(role)},acquire:async()=>{calls.acquire++;if(lamp.onAcquire)await lamp.onAcquire();return {lamp,release:async()=>calls.release++};},
    isCurrent:()=>current,onSnapshot:snapshot=>snapshots.push(snapshot),now:()=>++clock};
  return {options,lamp,raw,writes,reads,snapshots,calls,other,setCurrent:value=>current=value};
}

test('public snapshots whitelist telemetry and classify only proven legacy no-group firmware',()=>{
  const f=fixture({role:2}),snapshot=lampPowerSnapshot(f.raw,f.lamp.catalog,123);
  assert.equal(snapshot.id,id);assert.deepEqual(snapshot.group,group(2));assert.equal(snapshot.power,true);assert.equal(snapshot.checkedAt,123);
  assert(!JSON.stringify(snapshot).includes('private'));assert(Object.isFrozen(snapshot));assert(Object.isFrozen(snapshot.group));
  assert.deepEqual(snapshot.wifi,{connected:true,rssi:-64});assert.equal(snapshot.lighting.name,'Rain');
  for(const version of ['1.0.0','1.4.1','1.6.6'])assert(legacyPowerWithoutGroups(version));
  for(const version of ['0.0.0','1.6.7','1.7.0','1.9.6','2.0.0','01.6.6',null])assert(!legacyPowerWithoutGroups(version));
  const legacy={...f.raw,firmware:{version:'1.6.6'},sync:undefined};assert.deepEqual(lampPowerSnapshot(legacy,null).group,group());
  assert.equal(lampPowerSnapshot({...legacy,firmware:{version:'1.9.6'}},null).group,null);
});

test('unknown or stale power/membership clicks only refresh and release the same verified lamp',async()=>{
  for(const expected of [null,{power:null,group:group()},{power:true,group:null}]) {
    const f=fixture();f.options.expected=expected;const before=structuredClone(f.raw);const result=await runLampPower(f.options);
    assert.equal(result.refreshed,true);assert.equal(result.desired,null);assert.equal(result.changed,false);
    assert.deepEqual(f.writes,[]);assert.deepEqual(f.raw,before);assert.deepEqual(f.reads,[id]);assert.equal(f.calls.release,1);
  }
});

test('known independent and coordinator power use absolute requested Off and preserve unrelated state',async()=>{
  for(const role of [0,1]) {
    const f=fixture({role}),other=structuredClone(f.other),membership={...f.raw.sync};const result=await runLampPower(f.options);
    assert.equal(result.changed,true);assert.equal(result.desired,false);assert.equal(f.raw.power,false);
    assert.deepEqual(f.writes,[{action:'power',value:0}]);assert.deepEqual(f.raw.sync,membership);
    assert.equal(f.raw.mode,1);assert.equal(f.raw.brightness,100);assert.deepEqual(f.other,other);assert.equal(f.calls.release,1);
  }
});

test('fresh already-desired power never toggles the lamp back to the stale opposite state',async()=>{
  const f=fixture();f.raw.power=false;const result=await runLampPower(f.options);
  assert.equal(result.noop,true);assert.equal(result.desired,false);assert.deepEqual(f.writes,[]);assert.equal(f.raw.power,false);assert.equal(f.calls.release,1);
});

test('follower Off pauses runtime following, including already-dark unpaused follower, without changing membership',async()=>{
  for(const power of [true,false]) {
    const f=fixture({role:2});f.raw.power=power;const result=await runLampPower(f.options);
    assert.equal(result.changed,true);assert.deepEqual(f.writes,[{action:'power',value:0}]);assert.equal(f.raw.sync.paused,true);
    assert.equal(f.raw.sync.role,2);assert.equal(f.raw.sync.leader,leader);assert.equal(f.raw.sync.key,'private-key');assert.equal(f.raw.power,false);
  }
  const f=fixture({role:2});f.raw.power=false;f.raw.sync.paused=true;
  assert.equal((await runLampPower(f.options)).noop,true);assert.equal(f.writes.length,0);
});

test('follower On retains its runtime pause and never sends a Resume or membership mutation',async()=>{
  const f=fixture({role:2,power:false});f.raw.sync.paused=true;f.raw.sync.active=false;
  const result=await runLampPower(f.options);assert.equal(result.desired,true);assert.equal(result.changed,true);
  assert.deepEqual(f.writes,[{action:'power',value:1}]);assert.equal(f.raw.sync.paused,true);assert.deepEqual(result.snapshot.group,group(2));
});

test('invalid identity, malformed role/leader and changed initial membership never write',async()=>{
  const bad=fixture();bad.options.id='ble:phone';await assert.rejects(runLampPower(bad.options),/identity/);assert.equal(bad.calls.acquire,0);
  for(const change of [f=>f.lamp.identity=leader,f=>f.raw.deviceId=leader,f=>Object.assign(f.raw.sync,{role:1,leader}),
    f=>Object.assign(f.raw.sync,{role:2,leader:id}),f=>f.raw.sync.role=2,f=>f.raw.sync.version=3]) {
    const f=fixture();change(f);await assert.rejects(runLampPower(f.options));assert.deepEqual(f.writes,[]);assert.equal(f.calls.release,1);
  }
});

test('request cancellation before acquisition or while waiting releases acquired leases without writing',async()=>{
  const before=fixture();before.setCurrent(false);await assert.rejects(runLampPower(before.options),/card changed/);assert.equal(before.calls.acquire,0);
  const after=fixture();after.lamp.onAcquire=()=>after.setCurrent(false);await assert.rejects(runLampPower(after.options),/card changed/);
  assert.equal(after.calls.release,1);assert.deepEqual(after.writes,[]);
  const read=fixture();read.lamp.onRead=()=>read.setCurrent(false);await assert.rejects(runLampPower(read.options),/card changed/);assert.equal(read.calls.release,1);
});

test('queue-time location, epoch, group, power and calibration changes cancel before command sends',async()=>{
  for(const change of [f=>f.lamp.base='http://192.168.1.10',f=>f.lamp.epoch++,f=>f.raw.sync.role=1,
    f=>Object.assign(f.raw.sync,{role:2,leader}),f=>f.raw.calibration.active=true,f=>f.raw.firmware.phase=3]) {
    const f=fixture();f.lamp.beforeCommand=()=>change(f);await assert.rejects(runLampPower(f.options));
    assert.equal(f.writes.length,0);assert.equal(f.calls.release,1);
  }
  const completed=fixture();completed.lamp.beforeCommand=()=>completed.raw.power=false;
  assert.equal((await runLampPower(completed.options)).noop,true);assert.equal(completed.writes.length,0);
  const follower=fixture({role:2});follower.lamp.beforeCommand=()=>follower.raw.power=false;
  await assert.rejects(runLampPower(follower.options),error=>error.powerChanged&&error.cancelled);assert.equal(follower.writes.length,0);assert.equal(follower.raw.sync.paused,false);
});

test('updater phases and calibration block planned mutations but unknown refresh stays read-only',async()=>{
  for(const change of [f=>f.raw.firmware.phase=1,f=>f.raw.firmware.phase=3,f=>f.raw.firmware.phase=4,f=>f.raw.calibration.active=true]) {
    const f=fixture();change(f);await assert.rejects(runLampPower(f.options),error=>error.blocked&&error.confirmed);
    assert.equal(f.writes.length,0);assert.equal(f.snapshots.length,1);assert.equal(f.calls.release,1);
  }
  const f=fixture();f.raw.firmware.phase=3;f.options.expected=null;assert.equal((await runLampPower(f.options)).refreshed,true);
});

test('concurrent same-intent calls on one lease send one absolute power command',async()=>{
  const f=fixture();const results=await Promise.all([runLampPower(f.options),runLampPower(f.options)]);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].value,0);assert.equal(results.filter(result=>result.changed).length,1);
  assert.equal(results.filter(result=>result.noop).length,1);assert.equal(f.calls.release,2);
});

test('uncertain acknowledgment never reconnects, retries, or probes the mutation again',async()=>{
  const f=fixture();f.lamp.onWrite=()=>{throw Object.assign(new Error('Reply lost'),{uncertain:true});};
  await assert.rejects(runLampPower(f.options),error=>error.uncertain);assert.deepEqual(f.writes,[{action:'power',value:0}]);
  assert.deepEqual(f.reads,[id]);assert.equal(f.calls.acquire,1);assert.equal(f.calls.release,1);
});

test('readback requires requested power, same membership and paused follower Off',async()=>{
  for(const change of [f=>f.raw.power=true,f=>Object.assign(f.raw.sync,{role:1,leader:id})]) {
    const f=fixture();let read=0;f.lamp.onRead=()=>{if(++read===2)change(f);};
    await assert.rejects(runLampPower(f.options),error=>error.uncertain);assert.equal(f.writes.length,1);assert.equal(f.calls.release,1);
  }
  const follower=fixture({role:2});let read=0;follower.lamp.onRead=()=>{if(++read===2)follower.raw.sync.paused=false;};
  await assert.rejects(runLampPower(follower.options),/paused/);assert.equal(follower.writes.length,1);assert.equal(follower.calls.release,1);
});

test('callback cannot rewrite the helper’s immutable plan or expose raw passwords and keys',async()=>{
  const f=fixture();f.options.onSnapshot=snapshot=>{assert.throws(()=>{snapshot.power=false;});assert.throws(()=>{snapshot.group.role=2;});assert(!JSON.stringify(snapshot).includes('private'));};
  assert.equal((await runLampPower(f.options)).changed,true);assert.equal(f.writes[0].value,0);
});

test('real Wi-Fi queued Leave cancels the later card power POST inside its transport queue',async t=>{
  const raw={token:'fresh',deviceId:id,hostname:'coollamp-test.local',mode:1,brightness:100,power:true,effects:['Rain'],firmware:{version:'1.9.6',phase:0},
    sync:{version:2,role:1,leader:id,scene:0}},writes=[];let hold=false,entered,release;const started=new Promise(resolve=>entered=resolve);
  const http={async request(options){if(options.method==='POST'){writes.push(options.url);Object.assign(raw.sync,{role:0,leader:''});return {status:200,data:'Applied'};}
    if(hold){hold=false;entered();await new Promise(resolve=>release=resolve);}return {status:200,data:JSON.stringify(raw)};}};
  const lamp=new WifiTransport(http);await lamp.connect('192.168.1.50','coollamp',id);clearTimeout(lamp.timer);t.after(()=>lamp.disconnect());let released=0;
  hold=true;const pending=runLampPower({id,expected:{power:true,group:group(1)},acquire:async()=>({lamp,release:async()=>released++})});await started;
  const leave=lamp.enqueue(()=>lamp.configureSync(0));release();await assert.rejects(pending,error=>error.groupChanged);await leave;
  assert.deepEqual(writes,['http://192.168.1.50/api/sync']);assert.equal(raw.power,true);assert.equal(released,1);
});

// These tests keep the real LampTransport action queue, binary command queue,
// frame encoder, acknowledgment receiver and fresh-firmware decoder. Only the
// native radio boundary/full-snapshot response is injected.
function actualBle({legacy=false}={}) {
  const model={deviceId:id,name:'BLE coordinator',mode:1,brightness:100,power:true,firmware:{version:legacy?'1.6.6':'1.10.2',phase:0,wifi:true},
    sync:{version:2,role:1,leader:id,scene:0,paused:false},colors:Array.from({length:38},()=>[1,1,2,3]),effectOptions:Array.from({length:38},()=>[50,80,0,4,5,6])};
  if(legacy)delete model.sync;
  const writes=[],requests=[];let lamp;
  const packet=(sequence=0)=>new DataView(Uint8Array.of(1,sequence,0,model.mode,model.brightness,Number(model.power),38,14,0,0,0,0,1,1,2,3).buffer);
  const ble={async write(device,service,char,frame){assert.equal(char,COMMAND);const op=frame.getUint8(2);writes.push(op);if(op===1)model.power=Boolean(frame.getUint8(3));lamp.receive(packet(frame.getUint8(1)));},
    async read(device,service,char){if(char===STATE)return packet();assert.equal(char,FIRMWARE);return new DataView(Uint8Array.of(1,0,0,1,0,0,1,0,6,0,6,0,0,0,0,0,0,0,0,0).buffer);},async disconnect(){}};
  lamp=new LampTransport(ble,{timeout:100});lamp.id='protected-device';lamp.deviceIdentity=id;lamp.control=legacy?null:{capabilities:['control','groups']};
  lamp.catalog=[{id:1,name:'Rain',category:'calm',speed:true}];if(!legacy)lamp.raw=structuredClone(model);lamp.receive(packet());
  let held=false,entered,release,leaveEntered,leaveRelease;const readStarted=new Promise(resolve=>entered=resolve),leaveStarted=new Promise(resolve=>leaveEntered=resolve);
  if(!legacy)lamp.refresh=async(expected=id)=>{assert.equal(expected,id);if(held){held=false;entered();await new Promise(resolve=>release=resolve);}lamp.raw=structuredClone(model);lamp.state={...lamp.state,...lamp.raw};return lamp.raw;};
  lamp.request=async(path,fields)=>{requests.push(path);if(path==='/api/sync'){leaveEntered();await new Promise(resolve=>leaveRelease=resolve);Object.assign(model.sync,{role:0,leader:''});return 'Left';}throw Error('Unsupported injected path');};
  return {lamp,model,writes,requests,readStarted,leaveStarted,holdRead:()=>held=true,releaseRead:()=>release(),releaseLeave:()=>leaveRelease()};
}

test('actual legacy BLE firmware/state reads and power finish with separate queues and no settings writes',async t=>{
  const f=actualBle({legacy:true});t.after(()=>f.lamp.disconnect());let released=0;
  let timer;try{
    const result=await Promise.race([runLampPower({id,expected:{power:true,group:group()},acquire:async()=>({lamp:f.lamp,release:async()=>released++})}),
      new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Legacy queues deadlocked')),300))]);
    assert.equal(result.changed,true);assert.deepEqual(result.snapshot.group,group());assert.equal(result.snapshot.firmwareVersion,'1.6.6');
  }finally{clearTimeout(timer);}
  assert.deepEqual(f.writes,[5,1,5]);assert.equal(f.model.power,false);assert.equal(released,1);
});

test('modern legacy-style BLE without group snapshot refuses mutation after a read-only refresh',async t=>{
  const f=actualBle({legacy:true});t.after(()=>f.lamp.disconnect());f.lamp.refreshFirmware=async()=>({version:'1.9.6',phase:0,wifi:true});
  await assert.rejects(runLampPower({id,expected:{power:true,group:group()},acquire:async()=>({lamp:f.lamp,release:async()=>{}})}),error=>error.groupChanged);
  assert.deepEqual(f.writes,[5]);assert.equal(f.model.power,true);
});

test('actual BLE in-flight Leave cannot be overtaken by card or group binary power commands',async t=>{
  for(const kind of ['card','group']) {
    const f=actualBle();t.after(()=>f.lamp.disconnect());const editor={id,lamp:f.lamp,epoch:f.lamp.epoch,busy:false};f.holdRead();
    const action=kind==='card'?runLampPower({id,expected:{power:true,group:group(1)},acquire:async()=>({lamp:f.lamp,release:async()=>{}})}):
      runGroupLighting({getEditor:()=>editor,run:async callback=>{editor.busy=true;try{await f.lamp.enqueue(()=>f.lamp.refresh(id));return await callback(f.lamp);}finally{editor.busy=false;}}},{action:'power',value:0});
    const rejection=assert.rejects(action,/group.*changed|membership changed/i);await f.readStarted;
    const leave=f.lamp.enqueue(()=>f.lamp.configureSync(0));f.releaseRead();await f.leaveStarted;
    try{await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.writes,[]);assert.equal(f.model.power,true);}
    finally{f.releaseLeave();}
    await rejection;await leave;assert.deepEqual(f.writes,[]);assert.deepEqual(f.requests,['/api/sync']);assert.equal(f.model.sync.role,0);
  }
});
