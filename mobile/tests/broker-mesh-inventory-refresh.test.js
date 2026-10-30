import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {MeshInventorySession} from '../src/mesh.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('async function refreshBrokerMeshInventory('),end=source.indexOf('\nfunction scheduleLampStatusRefresh(',start);
assert(start>0&&end>start);
const id='aabbccddeeff',target='112233445566';
const snapshot=()=>({version:1,deviceId:id,available:true,fleetId:'1111111111111111',boot:'2222222222222222',snapshotUptimeMs:10,peers:[{id:target,name:'Sonata Left',online:true,hops:1}]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({mesh=false}={}){
 let resolve;const pending=new Promise(done=>resolve=done),calls=[];
 const gateway={identity:id,epoch:3,request:async(path,data,epoch,before,guard)=>{calls.push(path);assert.equal(data,undefined);assert.equal(epoch,3);before();const value=await pending;guard();return JSON.stringify(value);}};
 const owner=mesh?{isMesh:true,bridge:gateway,epoch:4}:gateway;
 const inventory=new MeshInventorySession();
 const context={gateway,lamp:owner,document:{hidden:false},busy:false,connecting:false,meshSelection:null,meshWizard:null,liveLight:null,
  firmwareBackgroundGeneration:0,groupRemovedIds:new Set(),store:{items:[{id}]},bridgeAccessories:{has:()=>false},
  firmwareBackgroundWorkAllowed:()=>context.allowed,verifiedSelectedLamp:()=>context.verified,meshBridgeSupported:()=>context.supported,
  meshInventory:inventory,renderLamps:()=>calls.push('render'),allowed:true,verified:true,supported:true};
 runInNewContext('let meshInventoryRead=null;'+source.slice(start,end)+';globalThis.refresh=refreshBrokerMeshInventory;',context);
 return {context,inventory,calls,gateway,owner,resolve};
}

for(const mesh of [false,true])test('an existing '+(mesh?'mesh gateway':'direct link')+' refreshes reachability without connection or control writes',async()=>{
 const f=fixture({mesh}),run=f.context.refresh();await tick();await f.context.refresh();assert.deepEqual(f.calls,['/api/mesh/status']);
 f.resolve(snapshot());await run;assert.equal(f.inventory.routes(target)[0].gatewayEpoch,3);assert.equal(f.calls.filter(value=>value==='render').length,1);
});

for(const flag of ['hidden','busy','connecting','selection','wizard','light','background','verified','supported'])test('passive inventory stays idle while '+flag,async()=>{
 const f=fixture();
 if(flag==='hidden')f.context.document.hidden=true;
 else if(flag==='selection')f.context.meshSelection={};else if(flag==='wizard')f.context.meshWizard={};else if(flag==='light')f.context.liveLight={pending:true};
 else if(flag==='background')f.context.allowed=false;else if(flag==='verified')f.context.verified=false;else if(flag==='supported')f.context.supported=false;else f.context[flag]=true;
 await f.context.refresh();assert.deepEqual(f.calls,[]);
});

for(const change of ['gateway-epoch','gateway-id','owner','generation','hidden','removed','forgotten','background'])test('late inventory is discarded after '+change,async()=>{
 const f=fixture({mesh:true}),run=f.context.refresh();await tick();
 if(change==='gateway-epoch')++f.gateway.epoch;else if(change==='gateway-id')f.gateway.identity=target;else if(change==='owner')f.context.lamp={...f.owner};
 else if(change==='generation')++f.context.firmwareBackgroundGeneration;else if(change==='hidden')f.context.document.hidden=true;
 else if(change==='removed')f.context.groupRemovedIds.add(id);else if(change==='forgotten')f.context.store.items=[];else f.context.allowed=false;
 f.resolve(snapshot());await run;assert.equal(f.inventory.routes(target).length,0);assert(!f.calls.includes('render'));
});

test('a disabled gateway retires its old routes and a different identity cannot supply routes',async()=>{
 const f=fixture();f.inventory.remember(snapshot(),id,{bridgeEpoch:3});assert.equal(f.inventory.routes(target).length,1);
 const run=f.context.refresh();f.resolve({...snapshot(),available:false,fleetId:''});await run;assert.equal(f.inventory.routes(target).length,0);
 const other=fixture(),late=other.context.refresh();other.resolve({...snapshot(),deviceId:target});await late;assert.equal(other.inventory.routes(target).length,0);
});

test('an older unavailable snapshot cannot erase a newer gateway observation',async()=>{
 const f=fixture(),run=f.context.refresh();await tick();
 f.inventory.remember({...snapshot(),snapshotUptimeMs:30},id,{bridgeEpoch:3});
 f.resolve({...snapshot(),available:false,snapshotUptimeMs:20});await run;
 assert.equal(f.inventory.routes(target).length,1);
});
