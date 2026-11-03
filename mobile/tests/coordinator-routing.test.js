import test from 'node:test';
import assert from 'node:assert/strict';
import {COORDINATOR_MODEL} from '../src/bridge-accessory.js';
import {meshRouteCandidates} from '../src/mesh-route-candidates.js';
import {BridgeManagementClient,BridgeLinkJournal} from '../src/bridge-management.js';
import {BridgeWifiBroker} from '../src/bridge-wifi.js';

const id='8c4856dab735',target='acb950b2f180',fleet='1111111111111111',boot='2222222222222222';
const entry={id,role:'bridge',modelId:COORDINATOR_MODEL,fleetId:fleet,firmwareVersion:'0.1.0-dev'};
const journal=()=>new BridgeLinkJournal({getItem:()=>null,setItem(){}});
test('coordinator routes and management use its actual hostname when its IP is absent',()=>{
 const [route]=meshRouteCandidates({target,bridges:[entry]});
 assert.equal(route.entry.address,'coolstrip-coordinator-b735.local');
 const client=new BridgeManagementClient({bridge:entry,http:{request(){throw Error('No network expected');}},getPassword:async()=> 'fixture-password',journal:journal()});
 assert.equal(client.bridge.address,'http://coolstrip-coordinator-b735.local');
 assert.equal(entry.address,undefined,'saved record is not mutated');
});
test('an unknown accessory model cannot invent a trusted hostname route',()=>{
 assert.deepEqual(meshRouteCandidates({target,bridges:[{...entry,modelId:'unrecognized.coordinator'}]}),[]);
 assert.throws(()=>new BridgeManagementClient({bridge:{...entry,modelId:'unrecognized.coordinator'},http:{request(){}},getPassword:async()=> 'fixture-password',journal:journal()}),/home Wi-Fi address/);
});
test('coordinator development descriptor completes authenticated bridge Wi-Fi negotiation',async()=>{
 const token='0123456789abcdef0123456789abcdef',calls=[];
 const replies={
  '/api/bridge/status':{role:'bridge',deviceId:id,fleetId:fleet,meshEnabled:true,token},
  '/api/descriptor':{role:'bridge',deviceRole:'coordinator',deviceId:id,name:'CoolStrip Coordinator',model:{id:COORDINATOR_MODEL},firmwareVersion:'0.1.0-dev',capabilities:['mesh-control','trusted-cached-donation']},
  '/api/mesh/status':{version:1,deviceId:id,fleetId:fleet,boot,available:true,peers:[]}
 };
 const transport=new BridgeWifiBroker({request:async request=>{
  calls.push(request);assert.equal(request.disableRedirects,true);
  assert.equal(new URL(request.url).hostname,'coolstrip-coordinator-b735.local');
  return {status:200,url:request.url,data:JSON.stringify(replies[new URL(request.url).pathname])};
 }},{expectedFleetId:fleet});
 const raw=await transport.connect('coolstrip-coordinator-b735.local','fixture-password',id);
 assert.equal(raw.deviceId,id);assert.equal(raw.role,'bridge');
 assert.equal(raw.firmware.version,'0.1.0-dev');assert.equal(raw.mesh.boot,boot);
 assert.deepEqual(calls.map(call=>call.method),['GET','GET','GET']);
 await transport.disconnect();
});
