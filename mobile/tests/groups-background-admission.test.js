import test from 'node:test';
import assert from 'node:assert/strict';
import {Groups} from '../src/groups.js';
import {BluetoothGroups} from '../src/bluetooth-groups.js';
import {LampTransport} from '../src/transport.js';
import {CONTROL,STATE,COMMAND,SERVICE,effects} from '../src/protocol.js';
import {legacyCatalog} from '../src/catalog.js';

const identity='aabbccddeeff';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(){
 const started=deferred(),finished=deferred(),events=[],callbacks=[];
 let ack=0,response=null,holdFirst=true,releases=0;
 const raw={deviceId:identity,name:'Reading lamp',mode:4,brightness:55,power:true,leds:135,effects:[...effects],
  firmware:{version:'1.15.1',phase:0},effectOptions:effects.map(()=>[50,60,0,0,0,0]),
  sync:{version:2,role:0,leader:'',active:false,paused:false,members:0,order:[],peers:[]}};
 const packet=()=>new DataView(Uint8Array.of(1,ack,0,4,55,1,effects.length,9,0,0,0,0).buffer);
 const radio={
  async write(device,service,characteristic,frame){
   assert.equal(device,'fixture-peripheral');assert.equal(service,SERVICE);assert.equal(characteristic,COMMAND);
   const op=frame.getUint8(2);events.push({write:op});
   if(op===22){const endpoint=frame.getUint8(5);response=endpoint?{tx:frame.getUint16(3,true),endpoint,offset:0}:null;}
   if(op===24){assert.equal(response.endpoint,1);response.text=JSON.stringify(raw);}
   if(op===25)response.offset=frame.getUint16(5,true);
   ack=frame.getUint8(1);lamp.receive(packet());
  },
  async read(device,service,characteristic){
   assert.equal(device,'fixture-peripheral');assert.equal(service,SERVICE);events.push({read:characteristic});
   if(characteristic===STATE)return packet();
   assert.equal(characteristic,CONTROL);assert.equal(response.endpoint,1);
   if(holdFirst){holdFirst=false;started.resolve();await finished.promise;}
   const bytes=new TextEncoder().encode(response.text),part=bytes.slice(response.offset,response.offset+480);
   const page=new DataView(new ArrayBuffer(12+part.length));page.setUint8(0,1);page.setUint16(1,response.tx,true);
   page.setUint8(3,response.endpoint);page.setUint16(4,200,true);page.setUint16(6,bytes.length,true);
   page.setUint16(8,response.offset,true);page.setUint16(10,part.length,true);new Uint8Array(page.buffer,12).set(part);
   return page;
  }
 };
 const lamp=new LampTransport(radio,{timeout:100,onState:(state,metadata)=>callbacks.push({state,metadata}),onFirmware:value=>callbacks.push({firmware:value})});
 lamp.id='fixture-peripheral';lamp.deviceIdentity=identity;lamp.catalog=legacyCatalog(effects);
 lamp.control={capabilities:['control','groups'],maxRequest:1024,maxResponse:8192,pageBytes:480};
 lamp.state={id:0,result:0,revision:0,mode:4,brightness:55,power:true,effectCount:effects.length,capabilities:9,supportsColor:true};
 lamp.raw={name:'Previously verified snapshot'};
 const groups=new Groups({getLamps:()=>[{id:identity,name:'Reading lamp',deviceId:'fixture-peripheral'}],
  acquire:async(id,options)=>{assert.equal(id,identity);assert.equal(options.readOnly,true);return {lamp,release:async()=>{++releases;}};}});
 return {groups,lamp,raw,events,callbacks,started,finished,releases:()=>releases};
}

test('canceling a real group scan fences a late native Bluetooth page, all later pages and snapshot adoption',async()=>{
 const f=fixture(),previous=f.lamp.raw,catalog=f.lamp.catalog;
 const run=f.groups.refresh();await f.started.promise;
 const issued=f.events.length,published=f.callbacks.length;
 f.groups.cancel();assert.equal((await run).cancelled,true);
 f.finished.resolve();await tick();await tick();
 assert.equal(f.events.length,issued);assert.equal(f.callbacks.length,published);
 assert.equal(f.lamp.raw,previous);assert.equal(f.lamp.catalog,catalog);assert.equal(f.groups.rows.size,0);assert.equal(f.releases(),1);
 assert.equal(f.events.filter(row=>row.write===24).length,1);assert.equal(f.events.filter(row=>row.read===CONTROL).length,1);
 const snapshot=await f.groups.refresh();assert.equal(snapshot.cancelled,false);assert.equal(snapshot.lamps.length,1);
 assert.equal(snapshot.lamps[0].available,true);assert.equal(snapshot.lamps[0].verified,true);assert.equal(f.releases(),2);
 assert.equal(f.lamp.raw.leds,135);assert.equal(f.lamp.raw.brightness,55);assert.equal(f.lamp.raw.mode,4);
 assert(f.events.every(row=>row.read||[22,24,25].includes(row.write))); // Only read-only RPC framing.
});

test('offline Bluetooth discovery stops real selected-target paging and adoption after cancellation',async()=>{
 const f=fixture(),previous={name:'Saved snapshot',sync:{version:2,role:0}};f.lamp.raw=previous;
 const scan=new BluetoothGroups({getTarget:()=>f.lamp,getLamps:()=>[]});
 const run=scan.scan();await f.started.promise;const issued=f.events.length,published=f.callbacks.length;
 scan.cancel();f.finished.resolve();await assert.rejects(run,error=>error.cancelled&&error.readAdmission);
 assert.equal(f.events.length,issued);assert.equal(f.callbacks.length,published);assert.equal(f.lamp.raw,previous);
 assert.equal(f.events.filter(row=>row.read===CONTROL).length,1);
 assert.equal((await scan.scan()).cancelled,false);assert.equal(f.lamp.raw.leds,135);
});

test('offline Bluetooth discovery checks cancellation before a queued selected-target refresh starts',async()=>{
 const f=fixture(),gate=deferred();f.lamp.raw={sync:{version:2,role:0}};
 f.lamp.enqueue=action=>gate.promise.then(action);
 const scan=new BluetoothGroups({getTarget:()=>f.lamp,getLamps:()=>[]}),run=scan.scan();
 scan.cancel();gate.resolve();await assert.rejects(run,/selected lamp changed/);
 assert.deepEqual(f.events,[]);assert.deepEqual(f.callbacks,[]);
});

test('offline coordinator discovery fences a late real page and releases the acquired read lease once',async()=>{
 const f=fixture(),targetId='112233445566',previous=f.lamp.raw;
 const target={identity:targetId,base:'ble:selected',epoch:1,supportsOfflineGroups:true,initialization:Promise.resolve(),raw:{sync:{version:2,role:0}},enqueue:action=>action(),refresh:async()=>{}};
 let releases=0;const statuses=[];
 const scan=new BluetoothGroups({getTarget:()=>target,getLamps:()=>[{id:identity,deviceId:'fixture-peripheral'}],onStatus:(_id,status)=>statuses.push(status),acquire:async()=>({lamp:f.lamp,release:async()=>{++releases;}})});
 const run=scan.scan();await f.started.promise;const issued=f.events.length,published=f.callbacks.length;
 scan.cancel();f.finished.resolve();await assert.rejects(run,/selected lamp changed/);await tick();
 assert.equal(f.events.length,issued);assert.equal(f.callbacks.length,published);assert.equal(f.lamp.raw,previous);assert.equal(releases,1);
 assert.deepEqual(statuses.map(row=>row.state),['checking']);
 f.raw.sync.role=1;const fresh=await scan.scan();assert.equal(fresh.coordinators.length,1);assert.equal(releases,2);
});
