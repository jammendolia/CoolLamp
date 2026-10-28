import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverBridgePage} from '../src/bridge-discovery.js';
import {BridgeAccessoryStore,BRIDGE_MODEL,bridgeDescriptor} from '../src/bridge-accessory.js';

const brokerId='5894af4aec24',bridgeId='8c4856dab734';
const descriptor=id=>({deviceId:id,role:'bridge',model:{id:BRIDGE_MODEL},name:'CoolLamp Bridge',
 firmwareVersion:'0.2.2',capabilities:['mesh-control','trusted-cached-donation'],address:'192.168.1.197'});
const peer=id=>({id,online:true,hops:1,boot:'7932df5b6d39a0e9'});
const snapshot=peers=>({version:1,deviceId:brokerId,boot:'618d803fea3a565f',fleetId:'c8d27ebafed5d956',available:true,peers});
function setup(peers=[peer(bridgeId)]){
 const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
 const accessories=new BridgeAccessoryStore(storage),calls=[];
 let value=snapshot(peers);
 const broker={epoch:1,base:'owned-route',request:async path=>{calls.push(path);return value;}};
 const input={broker,brokerId,accessories,readDescriptor:async value=>descriptor(value.id)};
 return {input,broker,accessories,calls,data,setSnapshot:next=>{value=next;}};
}
test('bridge discovery uses only verified paged reads and retains its route hint',async()=>{
 const f=setup();const result=await discoverBridgePage(f.input);
 assert.equal(result.bridges.length,1);assert.equal(result.cursor,null);
 assert.deepEqual(f.calls,['/api/mesh/status','/api/mesh/status']);
 assert.equal(f.accessories.items[0].address,'192.168.1.197');
 assert.equal(f.accessories.items[0].meshBridgeId,brokerId);
 assert.equal(new BridgeAccessoryStore({getItem:key=>f.data.get(key)}).items[0].address,'192.168.1.197');
});
test('four-neighbor pages preserve other devices and expose continuation',async()=>{
 const peers=Array.from({length:6},(_,i)=>peer((i+1).toString(16).padStart(12,'0'))),f=setup(peers),read=[];
 f.input.readDescriptor=async value=>{read.push(value.id);return value.id===peers[5].id?descriptor(value.id):{deviceId:value.id,role:'lamp'};};
 const first=await discoverBridgePage(f.input);assert.equal(first.cursor,4);assert.equal(first.bridges.length,0);assert.equal(read.length,4);
 const second=await discoverBridgePage({...f.input,cursor:first.cursor});assert.equal(second.cursor,null);assert.equal(second.bridges.length,1);assert.equal(read.length,6);
});
for(const kind of ['wrong-broker','duplicate','wrong-hop','wrong-fleet-boot'])test('discovery rejects '+kind,async()=>{
 const f=setup(),value=snapshot([peer(bridgeId)]);
 if(kind==='wrong-broker')value.deviceId='112233445566';
 if(kind==='duplicate')value.peers.push(peer(bridgeId));
 if(kind==='wrong-hop')value.peers[0].hops=5;
 if(kind==='wrong-fleet-boot')value.fleetId='0'.repeat(16);
 f.setSnapshot(value);await assert.rejects(discoverBridgePage(f.input));assert.equal(f.accessories.items.length,0);
});
test('broker restart or household change during descriptors cannot create a bridge card',async()=>{
 for(const field of ['boot','fleetId']){
  const f=setup();f.input.readDescriptor=async value=>{const fresh=snapshot([peer(bridgeId)]);fresh[field]='1234567890abcdef';f.setSnapshot(fresh);return descriptor(value.id);};
  await assert.rejects(discoverBridgePage(f.input),/restarted/);assert.equal(f.accessories.items.length,0);
 }
});
test('target reboot and loss leave existing records in place',async()=>{
 for(const field of ['boot','online']){
  const f=setup();f.input.readDescriptor=async value=>{const fresh=snapshot([peer(bridgeId)]);fresh.peers[0][field]=field==='boot'?'1234567890abcdef':false;f.setSnapshot(fresh);return descriptor(value.id);};
  const result=await discoverBridgePage(f.input);assert.equal(result.bridges.length,0);
 }
});
test('cancellation and expired reads never adopt a late bridge',async()=>{
 const f=setup(),controller=new AbortController();let finish;
 f.input.readDescriptor=()=>new Promise(resolve=>finish=resolve);
 const pending=discoverBridgePage({...f.input,signal:controller.signal});
 while(!finish)await new Promise(resolve=>setTimeout(resolve,0));controller.abort();
 await assert.rejects(pending,error=>error.cancelled===true);finish(descriptor(bridgeId));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.accessories.items.length,0);
 const slow=setup();slow.input.readDescriptor=()=>new Promise(()=>{});
 await assert.rejects(discoverBridgePage({...slow.input,timeout:5}),/too long/);assert.equal(slow.accessories.items.length,0);
});
test('bridge address is a bounded route hint and saving cannot evict another bridge',()=>{
 for(const address of ['https://evil.example','192.168.1.197/steal','127.0.0.999','0.0.0.0'])assert.equal(bridgeDescriptor({...descriptor(bridgeId),address},bridgeId).address,undefined);
 const f=setup();for(let i=1;i<=8;++i){const id=i.toString(16).padStart(12,'0');f.accessories.remember(bridgeDescriptor(descriptor(id),id),{bridgeId:brokerId});}
 const order=f.accessories.items.map(value=>value.id);f.accessories.remember(bridgeDescriptor(descriptor(order[0]),order[0]),{bridgeId:brokerId});assert.deepEqual(f.accessories.items.map(value=>value.id),order);
 const id='999999999999';assert.throws(()=>f.accessories.remember(bridgeDescriptor(descriptor(id),id),{bridgeId:brokerId}),/No bridge was removed/);
 assert.deepEqual(f.accessories.items.map(value=>value.id),order);
});
