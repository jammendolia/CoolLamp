import test from 'node:test';
import assert from 'node:assert/strict';
import {MeshInventorySession} from '../src/mesh.js';

const a='111111111111',b='222222222222',target='aabbccddeeff',other='aabbccddee00';
const fleet='1234567890abcdef',nextFleet='fedcba0987654321',boot='1111222233334444';
const peer=(id=target,changes={})=>({id,name:'Lamp '+id,online:true,hops:2,boot:'5555666677778888',...changes});
const snapshot=(id,peers=[peer()],changes={})=>({version:1,deviceId:id,fleetId:fleet,available:true,peers,...changes});
function fixture(){let time=0;return {inventory:new MeshInventorySession({now:()=>time}),at(value){time=value;}};}

test('a target retains alternative gateway observations and selects its freshest short route',()=>{
 const {inventory,at}=fixture();inventory.remember(snapshot(a),a,{bridgeEpoch:3});at(1000);
 inventory.remember(snapshot(b,[peer(target,{hops:1})]),b,{bridgeEpoch:4});
 const routes=inventory.routes(target);assert.equal(routes.length,2);assert.equal(routes[0].gatewayId,b);assert.equal(routes[0].gatewayEpoch,4);
 assert.equal(routes[0].targetBoot,'5555666677778888');assert.equal(inventory.items[0].meshBridgeId,b);assert.equal(inventory.items[0].meshRoutes.length,2);
 at(15000);assert.equal(inventory.routes(target).length,1);assert.equal(inventory.items[0].meshOnline,true);
 at(16000);assert.deepEqual(inventory.routes(target),[]);assert.equal(inventory.items.length,1);assert.equal(inventory.items[0].meshOnline,false);
 assert.equal(inventory.items[0].name,'Lamp '+target);assert.equal(inventory.items[0].meshBridgeId,b);
});

test('a fresh full snapshot removes vanished routes only for its own gateway',()=>{
 const {inventory}=fixture();inventory.remember(snapshot(a,[peer(),peer(other)]),a);inventory.remember(snapshot(b),b);
 inventory.remember(snapshot(a,[peer(other)]),a);
 assert.deepEqual(inventory.routes(target).map(row=>row.gatewayId),[b]);assert.equal(inventory.routes(other).length,1);
 inventory.remember(snapshot(b,[]),b);assert.equal(inventory.items.find(row=>row.id===target).meshOnline,false);
 assert.equal(inventory.items.length,2,'route loss does not remove saved/session display metadata');
});

test('partial observations do not renew or remove unmentioned routes',()=>{
 const {inventory,at}=fixture();inventory.remember(snapshot(a,[peer(),peer(other)]),a);at(8000);
 inventory.remember(snapshot(a,[peer(target,{hops:1})]),a,{complete:false});
 assert.equal(inventory.routes(other)[0].observedAt,0);assert.equal(inventory.routes(target)[0].observedAt,8000);
 at(15000);assert.equal(inventory.routes(other).length,0);assert.equal(inventory.routes(target).length,1);
});

test('an explicit offline peer or unavailable gateway cannot keep a route online',()=>{
 const {inventory}=fixture();inventory.remember(snapshot(a),a);inventory.remember(snapshot(b),b);
 inventory.remember(snapshot(a,[peer(target,{online:false})]),a);assert.deepEqual(inventory.routes(target).map(row=>row.gatewayId),[b]);
 inventory.remember(snapshot(b,[peer()],{available:false}),b);assert.equal(inventory.routes(target).length,0);assert.equal(inventory.items[0].meshOnline,false);
});

test('malformed gateway snapshots are ignored without refreshing or erasing another proof',()=>{
 const {inventory,at}=fixture();inventory.remember(snapshot(a),a);at(9000);
 for(const bad of [snapshot(b),snapshot(a,[],{version:2}),snapshot(a,[],{fleetId:'invalid'}),snapshot(a,[],{available:1}),snapshot(a,null)])inventory.remember(bad,a);
 assert.equal(inventory.routes(target)[0].observedAt,0);at(15000);assert.equal(inventory.routes(target).length,0);
});

test('gateway boot, epoch and fleet changes retire that gateway previous view even for partial replies',()=>{
 for(const change of ['boot','epoch','fleet']){
  const {inventory}=fixture();inventory.remember(snapshot(a,[peer(),peer(other)],{boot}),a,{bridgeEpoch:1});inventory.remember(snapshot(b),b);
  const changes=change==='boot'?{boot:'9999000011112222'}:change==='fleet'?{boot,fleetId:nextFleet}:{boot};
  inventory.remember(snapshot(a,[peer(other)],changes),a,{bridgeEpoch:change==='epoch'?2:1,complete:false});
  assert.deepEqual(inventory.routes(target).map(row=>row.gatewayId),[b],change);assert.equal(inventory.routes(other).length,1);
  if(change==='fleet'){assert.equal(inventory.routes(other,{fleetId:fleet}).length,0);assert.equal(inventory.routes(other,{fleetId:nextFleet}).length,1);}
 }
});

test('duplicate or older gateway snapshots cannot keep a stale route fresh; uptime wraps safely',()=>{
 const {inventory,at}=fixture();inventory.remember(snapshot(a,[peer()],{boot,snapshotUptimeMs:100}),a);at(14000);
 inventory.remember(snapshot(a,[peer()],{boot,snapshotUptimeMs:100}),a);inventory.remember(snapshot(a,[peer()],{boot,snapshotUptimeMs:99}),a);
 assert.equal(inventory.routes(target)[0].observedAt,0);at(15000);assert.equal(inventory.routes(target).length,0);
 inventory.remember(snapshot(a,[peer()],{boot,snapshotUptimeMs:101}),a);assert.equal(inventory.routes(target)[0].observedAt,15000);
 const wrapped=fixture();wrapped.inventory.remember(snapshot(a,[peer()],{boot,snapshotUptimeMs:0xfffffffe}),a);wrapped.at(10);
 wrapped.inventory.remember(snapshot(a,[peer()],{boot,snapshotUptimeMs:5}),a);assert.equal(wrapped.inventory.routes(target)[0].observedAt,10);
});

test('an unavailable same-tick snapshot clears the gateway without letting the duplicate online snapshot renew it',()=>{
 const {inventory}=fixture(),value=snapshot(a,[peer()],{boot,snapshotUptimeMs:100});inventory.remember(value,a);
 inventory.remember({...value,available:false},a);assert.equal(inventory.routes(target).length,0);
 inventory.remember(value,a);assert.equal(inventory.routes(target).length,0);
});

test('a late retired gateway boot cannot replace a newer view through a different connection epoch',()=>{
 const {inventory,at}=fixture(),old=snapshot(a,[peer()],{boot,snapshotUptimeMs:900});
 inventory.remember(old,a,{bridgeEpoch:7});at(100);
 const nextBoot='9999000011112222';inventory.remember(snapshot(a,[peer(other)],{boot:nextBoot,snapshotUptimeMs:10}),a,{bridgeEpoch:1});
 at(200);inventory.remember(old,a,{bridgeEpoch:8});
 assert.deepEqual(inventory.routes(target),[]);const current=inventory.routes(other)[0];
 assert.equal(current.gatewayBoot,nextBoot);assert.equal(current.gatewayEpoch,1);assert.equal(current.observedAt,100);
 inventory.remember({...old,available:false},a,{bridgeEpoch:9});assert.equal(inventory.routes(other).length,1);
});

test('same-boot uptime orders snapshots across incomparable transport epochs without renewing duplicate routes',()=>{
 const {inventory,at}=fixture();inventory.remember(snapshot(a,[peer()],{boot,snapshotUptimeMs:100}),a,{bridgeEpoch:2});at(1000);
 for(const value of [snapshot(a,[peer(other)],{boot,snapshotUptimeMs:99}),snapshot(a,[],{boot,snapshotUptimeMs:99,available:false}),snapshot(a,[peer(other)],{boot,snapshotUptimeMs:100})])inventory.remember(value,a,{bridgeEpoch:20});
 assert.equal(inventory.routes(target)[0].observedAt,0);assert.equal(inventory.routes(target)[0].gatewayEpoch,2);assert.deepEqual(inventory.routes(other),[]);
 inventory.remember(snapshot(a,[peer(other)],{boot,snapshotUptimeMs:101}),a,{bridgeEpoch:1});
 assert.deepEqual(inventory.routes(target),[]);assert.equal(inventory.routes(other)[0].observedAt,1000);assert.equal(inventory.routes(other)[0].gatewayEpoch,1);
 const wrapped=fixture();wrapped.inventory.remember(snapshot(a,[peer()],{boot,snapshotUptimeMs:0xfffffffe}),a,{bridgeEpoch:50});wrapped.at(10);
 wrapped.inventory.remember(snapshot(a,[peer(other)],{boot,snapshotUptimeMs:5}),a,{bridgeEpoch:1});assert.equal(wrapped.inventory.routes(other)[0].observedAt,10);
});

test('a known gateway boot cannot be downgraded to an unordered snapshot; explicit gateway forgetting resets hints',()=>{
 const {inventory,at}=fixture(),old=snapshot(a,[peer()],{boot,snapshotUptimeMs:100});inventory.remember(old,a);at(10);
 inventory.remember(snapshot(a,[peer(other)]),a);assert.equal(inventory.routes(target)[0].observedAt,0);assert.deepEqual(inventory.routes(other),[]);
 inventory.remember(snapshot(a,[peer(other)],{boot:'9999000011112222',snapshotUptimeMs:1}),a);
 inventory.forgetBridge(a);assert.equal(inventory.routes().length,0);inventory.remember(old,a);
 assert.equal(inventory.routes(target)[0].gatewayBoot,boot);assert.equal(inventory.routes(target)[0].observedAt,10);
});

test('retired gateway boot hints remain bounded across repeated reboots',()=>{
 const {inventory}=fixture();for(let index=1;index<=12;index++)inventory.remember(snapshot(a,[peer()],{boot:index.toString(16).padStart(16,'0'),snapshotUptimeMs:1}),a);
 assert.equal(inventory.gateways.get(a).retiredBoots.length,8);assert.equal(inventory.routes(target)[0].gatewayBoot,'000000000000000c');
 inventory.remember(snapshot(a,[],{boot:'000000000000000b',snapshotUptimeMs:900}),a);assert.equal(inventory.routes(target).length,1);
});

test('gateway removal leaves known lamps while forgetting a target prevents delayed reappearance',()=>{
 const {inventory}=fixture();inventory.remember(snapshot(a),a);inventory.remember(snapshot(b),b);inventory.forgetBridge(a);
 assert.deepEqual(inventory.routes(target).map(row=>row.gatewayId),[b]);inventory.forget(target);
 inventory.remember(snapshot(a),a);inventory.remember(snapshot(b),b);assert.deepEqual(inventory.items,[]);assert.deepEqual(inventory.routes(target),[]);
});

test('explicit ownership restoration only allows future observations and does not recreate old routes or cards',()=>{
 const {inventory}=fixture();inventory.remember(snapshot(a),a);inventory.forget(target);inventory.allow(target);
 assert.deepEqual(inventory.items,[]);assert.deepEqual(inventory.routes(target),[]);
 inventory.remember(snapshot(a),a);assert.equal(inventory.routes(target).length,1);assert.equal(inventory.items.length,1);
 inventory.forget(target);inventory.allow('invalid');inventory.remember(snapshot(a),a);assert.deepEqual(inventory.items,[]);
});

test('public observations contain only routing hints and callers cannot change retained state',()=>{
 const {inventory}=fixture();inventory.remember(snapshot(a,[peer(target,{deviceId:'unauthorized-device',key:'private',password:'private'})],{boot,key:'private'}),a,{bridgeEpoch:7});
 const route=inventory.routes(target)[0];assert.deepEqual(Object.keys(route).sort(),['targetId','gatewayId','fleetId','hops','observedAt','expiresAt','gatewayBoot','gatewayEpoch','targetBoot'].sort());
 route.gatewayId=b;route.expiresAt=Infinity;inventory.items[0].meshRoutes[0].hops=4;
 assert.equal(inventory.routes(target)[0].gatewayId,a);assert.equal(inventory.routes(target)[0].hops,2);assert(!JSON.stringify(inventory.items).includes('private'));
 for(const options of [{fleetId:'bad'},{bridgeEpoch:-1},{bridgeEpoch:8}])assert.deepEqual(inventory.routes(target,options),[]);
 assert.deepEqual(inventory.routes('bad'),[]);assert.equal(inventory.routes(target,{fleetId:fleet,bridgeEpoch:7}).length,1);
});

test('the firmware local snapshot limit does not become a global application inventory limit',()=>{
 const {inventory}=fixture(),peers=Array.from({length:20},(_,index)=>peer((index+100).toString(16).padStart(12,'0')));
 inventory.remember(snapshot(a,peers),a);inventory.remember(snapshot(b,peers.map(row=>({...row,id:'f'+row.id.slice(1)}))),b);
 assert.equal(inventory.items.length,32);assert.equal(inventory.routes().length,32);
});

test('a backwards clock makes old observations unusable instead of extending freshness',()=>{
 const {inventory,at}=fixture();at(100);inventory.remember(snapshot(a),a);at(99);assert.equal(inventory.routes(target).length,0);assert.equal(inventory.items[0].meshOnline,false);
 assert.throws(()=>new MeshInventorySession({ttlMs:0}),TypeError);assert.throws(()=>new MeshInventorySession({now:null}),TypeError);
});
