import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {BridgeWifiBroker} from '../src/bridge-wifi.js';
import {meshRouteCandidates} from '../src/mesh-route-candidates.js';
import {selectMeshRecoveryCandidates} from '../src/settings-recovery.js';
import {BRIDGE_MODEL} from '../src/bridge-accessory.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('async function createMeshLampLease('),source.indexOf('\nasync function connectMeshCard('));
const target='5894af4aec24',id='8c4856dab734',fleetId='1111111111111111',token='0123456789abcdef0123456789abcdef';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture({password='fixture-password',patch={},gate=null}={}){
 const calls=[],events=[],entry={id,role:'bridge',address:'192.168.1.197',fleetId},f={current:true};
 const replies={
  '/api/bridge/status':{role:'bridge',deviceId:id,fleetId,meshEnabled:true,token,...patch},
  '/api/descriptor':{role:'bridge',deviceId:id,firmwareVersion:'0.2.2',model:{id:BRIDGE_MODEL},capabilities:['mesh-control','trusted-cached-donation']},
  '/api/mesh/status':{version:1,deviceId:id,fleetId,boot:'2222222222222222',available:true,peers:[]}
 };
 const context={BridgeWifiBroker,meshRouteCandidates,selectMeshRecoveryCandidates,clearTimeout,lamp:null,phonePlatform:'ios',CapacitorHttp:{request:async request=>{
  calls.push(request);if(gate)await gate.promise;const path=new URL(request.url).pathname;assert(Object.hasOwn(replies,path));return {status:200,data:JSON.stringify(replies[path]),url:request.url};
 }},bridgeAccessories:{items:[entry]},mergedLampEntries:()=>[],groupRemovedIds:new Set(),fleetLampInstalling:()=>false,connectivity:{get:()=>({wifi:{fresh:false,state:'unknown'}})},
 firmwareBackgroundWorkAllowed:()=>true,firmwareBackgroundGeneration:0,foregroundConnectionHold:null,credential:async credentialId=>{assert.equal(credentialId,id);return {value:password};},
 compareFirmwareVersions:()=>0,meshInventory:{remember(){assert.fail('Broker-only acquisition cannot create lamp inventory.');}},renderLamps(){},
 acquireMeshLamp:async options=>{events.push(options);assert.equal(options.target,target);assert.equal(options.candidates.length,1);return options.acquireBridge(options.candidates[0]);},
 initializeGroupRadio:()=>assert.fail('No Bluetooth provisioning during bridge acquisition'),WifiTransport:class{constructor(){assert.fail('A bridge cannot use a lamp snapshot transport.');}}
 };
 runInNewContext(handler+';globalThis.acquire=()=>createMeshLampLease("'+target+'",{recoveryOnly:true,isCurrent:()=>currentValue()});',Object.assign(context,{currentValue:()=>f.current}));
 return Object.assign(f,{context,calls,events,acquire:context.acquire});
}

test('actual main bridge branch uses owner broker and existing credential without lamp setup or catalog reads',async()=>{
 const f=fixture(),lease=await f.acquire();assert(lease.lamp instanceof BridgeWifiBroker);assert.equal(lease.lamp.identity,id);assert.equal(lease.lamp.raw.role,'bridge');
 assert.deepEqual(f.calls.map(request=>[new URL(request.url).pathname,request.method]),[['/api/bridge/status','GET'],['/api/descriptor','GET'],['/api/mesh/status','GET']]);
 assert(f.calls.every(request=>request.headers.Authorization==='Basic '+btoa('OWNER:fixture-password')));
 assert.equal(f.events[0].options.totalTimeout,10000);assert.equal(f.events[0].options.timeout,4000);
 await lease.release();assert.equal(lease.lamp.identity,null);assert.equal(lease.lamp.connection,null);
});
test('main never guesses a bridge password or silently uses the lamp default',async()=>{
 const f=fixture({password:''});await assert.rejects(f.acquire(),/saved card.*access password/);assert.equal(f.calls.length,0);
});
test('actual main bridge route rejects a recycled address with another device or household',async()=>{
 for(const patch of [{deviceId:target},{fleetId:'3333333333333333'},{role:'lamp'}]){const f=fixture({patch});await assert.rejects(f.acquire(),/identity or household/);assert.equal(f.calls.length,1);}
});
test('a late native bridge reply after changing selected lamp cannot be adopted or cause provisioning',async()=>{
 const gate=deferred(),f=fixture({gate}),pending=f.acquire();await new Promise(done=>setImmediate(done));assert.equal(f.calls.length,1);
 f.current=false;gate.resolve();await assert.rejects(pending,error=>error.cancelled===true);assert.equal(f.calls.length,1);
});
