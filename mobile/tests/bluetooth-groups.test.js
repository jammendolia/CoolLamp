import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BluetoothGroups,initializeGroupRadio} from '../src/bluetooth-groups.js';
import {LampPairing} from '../src/pairing.js';
import {LampTransport} from '../src/transport.js';
import {STATE} from '../src/protocol.js';

const targetId='aabbccddeeff',coordinatorId='112233445566',unknownId='223344556677';
const code='CL1-'+coordinatorId+'-'+'ab'.repeat(16);
function fixture(){
  const target={identity:targetId,base:'ble:target',epoch:2,supportsOfflineGroups:true,initialization:Promise.resolve(),
    raw:{sync:{version:2,role:0,peers:[{id:targetId,role:1},{id:coordinatorId,role:1,name:'Coordinator'},{id:unknownId,role:1,name:'Unpaired lamp'}]}},
    enqueue:action=>action(),async refresh(){}};
  const known=[{id:targetId,deviceId:'target'},{id:coordinatorId,deviceId:'saved-coordinator',accessoryManaged:true,name:'Living room'}];
  const events=[],links=[],options=[];let selected=target;
  const groups=new BluetoothGroups({getTarget:()=>selected,getLamps:()=>known,onStatus:(id,status)=>events.push(status),createTransport:configuration=>{
    options.push(configuration);const link={identity:coordinatorId,supportsOfflineGroups:true,raw:{sync:{version:2,role:1,members:0}},
      connects:[],disconnects:0,invites:0,enqueue:action=>action(),async connect(entry){this.connects.push(entry);},
      async disconnect(){this.disconnects++;},async refresh(){},async syncInvite(){this.invites++;return code;}};links.push(link);return link;
  }});
  return {target,known,events,links,options,groups,switch:()=>selected={...target,identity:unknownId,epoch:3}};
}
test('offline scans treat unpaired radio advertisements as hints and verify saved coordinators through a separate link',async()=>{
  const f=fixture(),result=await f.groups.scan();assert.equal(result.coordinators.length,1);assert.equal(result.coordinators[0].id,coordinatorId);
  assert.equal(result.results.find(value=>value.id===unknownId).state,'needs-pairing');assert(!result.results.some(value=>value.id===targetId));
  assert.equal(f.options[0].sharedInitialization,f.target.initialization);assert.equal(f.options[0].controlOnly,true);assert.equal(f.options[0].expectedDeviceIdentity,coordinatorId);
  assert.equal(f.links[0].disconnects,1);assert.equal(f.links[0].invites,0);assert.equal(f.target.identity,targetId);
});
test('explicit secure invite stays transient and disconnects only the auxiliary coordinator link',async()=>{
  const f=fixture(),result=await f.groups.invite(coordinatorId);assert.deepEqual(result,{id:coordinatorId,targetId,code});
  assert.equal(f.links[0].invites,1);assert.equal(f.links[0].disconnects,1);assert(!JSON.stringify(f.events).includes(code));
  assert(!JSON.stringify(f.groups).includes(code));assert.equal(f.target.epoch,2);
});
test('unpaired coordinators and self never receive an invitation request',async()=>{
  const f=fixture();await assert.rejects(f.groups.invite(unknownId),/Pair the coordinator/);await assert.rejects(f.groups.invite(targetId),/itself/);assert.equal(f.links.length,0);
});
test('fresh coordinator role, capacity, and wire compatibility are required before invitation',async()=>{
  for(const change of [{role:0},{members:8},{version:1}]){
    const f=fixture(),create=f.groups.createTransport;f.groups.createTransport=options=>{const link=create(options);Object.assign(link.raw.sync,change);return link;};
    await assert.rejects(f.groups.invite(coordinatorId));assert.equal(f.links[0].invites,0);assert.equal(f.links[0].disconnects,1);
  }
});
test('target selection changes and cancellation fence delayed auxiliary links without target actions',async()=>{
  for(const cancel of [false,true]){
    const f=fixture(),create=f.groups.createTransport;let release,ready;
    const connected=new Promise(resolve=>ready=resolve),hold=new Promise(resolve=>release=resolve);
    f.groups.createTransport=options=>{const link=create(options);link.connect=async()=>{ready();await hold;};return link;};
    const pending=f.groups.invite(coordinatorId);await connected;if(cancel)f.groups.cancel();else f.switch();release();
    await assert.rejects(pending,/selected lamp changed/);assert.equal(f.links[0].invites,0);assert(f.links[0].disconnects>=1);
  }
});
test('invalid or changed invitation is rejected without retaining its credential',async()=>{
  const f=fixture(),create=f.groups.createTransport;f.groups.createTransport=options=>{const link=create(options);link.syncInvite=async()=>code.replace(coordinatorId,unknownId);return link;};
  await assert.rejects(f.groups.invite(coordinatorId),/invitation changed/);assert.equal(f.links[0].disconnects,1);assert(!JSON.stringify(f.events).includes('CL1-'));
});
test('already-following targets must leave explicitly before any auxiliary join work',async()=>{
  const f=fixture();f.target.raw.sync.role=2;await assert.rejects(f.groups.invite(coordinatorId),/Leave/);assert.equal(f.links.length,0);
});
test('Groups-first mixed iPhone inventory waits for explicit legacy authorization before starting the radio',async()=>{
  const authorized={deviceId:'AAAAAAAA-0000-0000-0000-000000000001',name:'Authorized lamp',accessoryManaged:true};
  const legacy={deviceId:'BBBBBBBB-0000-0000-0000-000000000002',name:'Old saved lamp'};
  const events=[],accessories={devices:[authorized],async list(){events.push('list');return {supported:true,devices:this.devices};},
    async migrate({devices}){events.push('migrate');this.devices.push(...devices.map(device=>({...device,accessoryManaged:true})));}};
  const pairing=new LampPairing({platform:'ios',native:accessories,knownDevices:()=>[authorized,legacy]});
  const packet=id=>new DataView(Uint8Array.of(1,id,0,4,100,1,28,0,0,0,0,0).buffer);
  const radio={async initialize(){events.push('initialize');},async getDevices(ids){return ids.map(deviceId=>({deviceId}));},
    async connect(){},async disconnect(){},async read(id,service,char){if(char===STATE)return packet(0);throw Error('Not present');},
    async startNotifications(id,service,char,listener){this.listener=listener;},async write(id,service,char,frame){this.listener(packet(frame.getUint8(1)));}};
  const transport=new LampTransport(radio,{selectDevice:device=>pairing.select(device),onRadioReady:()=>pairing.radioStarted=true});
  await assert.rejects(initializeGroupRadio({transport,ble:radio,platform:'ios',pairing,accessories,knownDevices:()=>[authorized,legacy]}),error=>error.needsAuthorization===true);
  assert.equal(pairing.radioStarted,false);assert(!events.includes('initialize'));assert(!events.includes('migrate'));
  await transport.connect(legacy);assert(events.indexOf('migrate')<events.indexOf('initialize'));assert.equal(events.filter(event=>event==='initialize').length,1);
  await transport.disconnect();
});
