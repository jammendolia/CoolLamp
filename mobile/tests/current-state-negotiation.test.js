import test from 'node:test';
import assert from 'node:assert/strict';
import {LampTransport} from '../src/transport.js';
import {SERVICE,STATE,CONTROL,COMMAND,effects,decodeState} from '../src/protocol.js';
import {legacyCatalog} from '../src/catalog.js';

const target='aabbccddeeff',device='saved-target';
const identityCharacteristic='7b610006-6e2b-4f3d-9a71-28e45c001001';
const names=[...effects,'Sound glow','Sound meter','Spectrum Rise','Bass Launch','Spectral Embers','Beat Bloom','Three-band Fountain','VU Meter','Rainbow Embers'];
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function binary(id=0,count=47){const data=new DataView(Uint8Array.of(1,id,0,4,100,1,count,46,0,0,0,0,1,10,20,30).buffer);return data;}
function page(text,tx=0,endpoint=0,offset=0){
 const bytes=new TextEncoder().encode(text),part=bytes.slice(offset,offset+480),data=new DataView(new ArrayBuffer(12+part.length));
 data.setUint8(0,1);data.setUint16(1,tx,true);data.setUint8(3,endpoint);data.setUint16(4,200,true);data.setUint16(6,bytes.length,true);data.setUint16(8,offset,true);data.setUint16(10,part.length,true);
 new Uint8Array(data.buffer,12).set(part);return data;
}
function snapshot(projection=true){
 return {deviceId:target,name:'Pink Corkscrew',hostname:'coollamp-test',ssid:'fixture-network',leds:179,milliamps:2000,
  midpoint:73,effectiveMidpoint:73,motionPath:1,motionVersion:1,startupMode:4,startupBrightness:81,
  mode:46,brightness:62,power:true,apiVersion:2,catalogVersion:1,effects:[...names],
  colors:names.map((_,index)=>!projection||index===45?[1,10,20,30]:null),
  effectOptions:names.map((_,index)=>!projection||index===45?[44,75,1,50,60,70]:null),
  vuColors:[[0,255,0],[255,180,0],[255,0,0]],fountainColors:[[255,0,0],[0,255,0],[0,0,255]],
  audio:{available:true,enabled:true,gain:8,gate:150,scale:1},rotation:{enabled:false,random:false,seconds:60},calibration:{active:false},
  firmware:{version:'1.15.3',phase:0},sync:{version:3,role:0,scene:0,order:[],peers:[]},factoryReset:true,usingDefaultPassword:false,
  lampStyle:{version:1,style:'corkscrew',code:3},...(projection?{stateView:1}:{})};
}
function fixture({capabilities=['control','groups','current-state-v1'],projected=snapshot(),legacy=snapshot(false),hasCatalog=true}={}){
 const events=[],executions=[],callbacks=[];let transaction=null,response=null,admitted=true;
 const catalogNames=Array.isArray(projected.effects)?projected.effects:names;
 const cap={version:1,capabilities,maxRequest:1024,maxResponse:8192,pageBytes:480,firmware:'1.15.3'};
 const radio={async write(nativeId,service,characteristic,frame){
  assert.equal(nativeId,device);assert.equal(service,SERVICE);assert.equal(characteristic,COMMAND);
  const operation=frame.getUint8(2);events.push({write:operation});await radio.hold?.('write:'+operation);
  if(operation===22){if(!frame.getUint8(5))response=null;else transaction={tx:frame.getUint16(3,true),endpoint:frame.getUint8(5),method:frame.getUint8(6),body:[]};}
  if(operation===23)transaction.body.push(...new Uint8Array(frame.buffer,frame.byteOffset+7,frame.byteLength-7));
  if(operation===24){
   const body=new TextDecoder().decode(Uint8Array.from(transaction.body));executions.push({...transaction,body});
   const value=transaction.endpoint===1?(body==='view=current'?projected:legacy):transaction.endpoint===26?legacyCatalog(catalogNames):{};
   response={tx:transaction.tx,endpoint:transaction.endpoint,text:JSON.stringify(value),offset:0};
  }
  if(operation===25)response.offset=frame.getUint16(5,true);
  lamp.receive(binary(frame.getUint8(1),catalogNames.length));
 },async read(nativeId,service,characteristic){
  assert.equal(nativeId,device);assert.equal(service,SERVICE);events.push({read:characteristic,offset:response?.offset});await radio.hold?.('read:'+characteristic);
  if(characteristic===STATE)return binary(0,catalogNames.length);
  if(characteristic===identityCharacteristic)return new DataView(new TextEncoder().encode(target).buffer);
  assert.equal(characteristic,CONTROL);
  return response?page(response.text,response.tx,response.endpoint,response.offset):page(JSON.stringify(cap));
 },async disconnect(){events.push({disconnect:true});}};
 const lamp=new LampTransport(radio,{onState:(state,metadata)=>callbacks.push({state,metadata}),onOptions:options=>callbacks.push({options}),onFirmware:firmware=>callbacks.push({firmware})});
 lamp.id=device;lamp.deviceIdentity=target;lamp.state=decodeState(binary(0,catalogNames.length));lamp.catalog=hasCatalog?legacyCatalog(catalogNames):null;lamp.raw={deviceId:target,name:'Cached',mode:4,brightness:100,power:true};
 const guard=()=>{if(!admitted)throw Object.assign(Error('Target read cancelled.'),{cancelled:true,confirmed:true,readAdmission:true});};
 return {lamp,radio,events,executions,callbacks,guard,stop:()=>{admitted=false;},async negotiate(){lamp.control=await lamp.readControlCapabilities(lamp.epoch,guard);}};
}

test('explicit protected capabilities negotiate a GET selector on existing endpoint 1 and preserve settings',async()=>{
 const f=fixture({hasCatalog:false});await f.negotiate();const result=await f.lamp.refresh(target,true,f.guard);
 assert.equal(f.executions.length,2);assert.deepEqual(f.executions.map(({endpoint,method,body})=>({endpoint,method,body})),[
  {endpoint:1,method:1,body:'view=current'},{endpoint:26,method:1,body:''}]);
 assert.equal(f.events.filter(row=>row.write===23).length,1);
 assert.equal(f.lamp.catalog.length,47);assert.deepEqual(f.lamp.catalog.map(row=>row.id),names.map((_,index)=>index+1));assert.deepEqual(f.lamp.catalog.map(row=>row.name),names);
 for(const field of ['leds','milliamps','midpoint','effectiveMidpoint','motionPath','motionVersion','startupMode','startupBrightness','mode','brightness','power','vuColors','fountainColors','audio','rotation','calibration','factoryReset','usingDefaultPassword'])assert.deepEqual(result[field],snapshot()[field]);
 assert.equal(result.colors.length,47);assert.equal(result.effectOptions.length,47);
 assert.equal(result.colors.filter(value=>value!==null).length,1);assert.equal(result.effectOptions.filter(value=>value!==null).length,1);
 assert.deepEqual(result.colors[45],[1,10,20,30]);assert.deepEqual(result.effectOptions[45],[44,75,1,50,60,70]);
 assert.deepEqual(f.lamp.state.color,{enabled:true,r:10,g:20,b:30});assert.deepEqual(f.callbacks.find(row=>row.options).options,{mode:46,speed:44,intensity:75,dual:1,r:50,g:60,b:70});
 assert.equal(f.callbacks.filter(row=>row.metadata?.freshControl).length,1);
});

test('a microphone-disabled 38-effect catalog retains all 47 physical appearance slots',async()=>{
 const raw=snapshot();raw.mode=4;raw.effects=[...effects];raw.audio.available=false;raw.audio.enabled=false;
 raw.colors=names.map((_,index)=>index===3?[1,10,20,30]:null);raw.effectOptions=names.map((_,index)=>index===3?[44,75,1,50,60,70]:null);
 const f=fixture({projected:raw,hasCatalog:false});await f.negotiate();const result=await f.lamp.refresh(target,true,f.guard);
 assert.equal(f.lamp.catalog.length,38);assert.deepEqual(f.lamp.catalog.map(row=>row.name),effects);assert.equal(f.lamp.state.effectCount,38);
 assert.equal(result.colors.length,47);assert.equal(result.effectOptions.length,47);assert.deepEqual(result.colors[3],[1,10,20,30]);
 assert(result.colors.slice(38).every(value=>value===null));assert(result.effectOptions.slice(38).every(value=>value===null));
 assert.equal(result.audio.available,false);assert.equal(result.audio.enabled,false);assert.equal(result.leds,179);assert.equal(result.midpoint,73);
});

for(const current of [true,false])test('a saved protected reconnect negotiates '+(current?'the current view':'the legacy full view')+' without provisioning or legacy catalog-entry mutations',async t=>{
 const f=fixture({capabilities:current?['control','groups','current-state-v1']:['control','groups']});
 f.lamp.expectedDeviceIdentity=target;f.radio.initialize=async()=>{};f.radio.getDevices=async ids=>ids.map(deviceId=>({deviceId}));f.radio.connect=async()=>{};f.radio.startNotifications=async()=>{};
 t.after(()=>{clearTimeout(f.lamp.controlTimer);f.lamp.controlRefreshOwner=null;});
 const selected=await f.lamp.connect({deviceId:device,lampId:target,readOnlyReconnect:true},false,{isCurrent:()=>true});
 assert.equal(selected.lampId,target);assert.equal(f.lamp.identity,target);assert.equal(f.lamp.raw.name,'Pink Corkscrew');assert.equal(f.lamp.state.mode,46);
 assert.deepEqual(f.executions.map(({endpoint,method,body})=>({endpoint,method,body})),[
  {endpoint:1,method:1,body:current?'view=current':''},{endpoint:26,method:1,body:''}]);
 assert(f.events.filter(row=>row.write).every(row=>[22,23,24,25].includes(row.write)));
 assert.equal(f.events.filter(row=>row.read===identityCharacteristic).length,1);assert(f.events.some(row=>row.read===CONTROL));
});

for(const capabilities of [['control','groups'],['control','groups','current-state-v2']])test('version alone and unknown capability never select the new current-state view '+capabilities.at(-1),async()=>{
 const f=fixture({capabilities});await f.negotiate();const result=await f.lamp.refresh(target,true,f.guard);
 assert.deepEqual(f.executions.map(({endpoint,method,body})=>({endpoint,method,body})),[{endpoint:1,method:1,body:''}]);
 assert(!f.events.some(row=>row.write===23));assert.equal(result.colors.filter(value=>value!==null).length,47);
});

test('manual current-state alias without explicit negotiated capability rejects before GATT',async()=>{
 const f=fixture({capabilities:['control','groups']});await f.negotiate();const before=f.events.length;
 await assert.rejects(f.lamp.request('/api/state/current'),/not confirmed/);assert.equal(f.events.length,before);assert.equal(f.executions.length,0);
});

for(const data of [{},{view:'current'},{view:'full'},null])test('explicit alias data cannot turn a current-state read into a POST '+JSON.stringify(data),async()=>{
 const f=fixture();await f.negotiate();const before=f.events.length;
 await assert.rejects(f.lamp.request('/api/state/current',data),/not confirmed/);assert.equal(f.events.length,before);assert.equal(f.executions.length,0);
});

for(const [name,change] of [
 ['missing marker',raw=>{delete raw.stateView;}],['wrong marker',raw=>{raw.stateView=2;}],['wrong target',raw=>{raw.deviceId='112233445566';}],['missing effects',raw=>{raw.effects=null;}],
 ['active color missing',raw=>{raw.colors[45]=null;}],['active options missing',raw=>{raw.effectOptions[45]=null;}],
 ['invalid active color',raw=>{raw.colors[45]=[1,10,20,256];}],['invalid active color type',raw=>{raw.colors[45]=[true,10,20,30];}],
 ['invalid active speed',raw=>{raw.effectOptions[45][0]=0;}],['invalid active intensity',raw=>{raw.effectOptions[45][1]=101;}],
 ['invalid active dual',raw=>{raw.effectOptions[45][2]=2;}],['invalid active secondary',raw=>{raw.effectOptions[45][3]=-1;}],
 ['wrong physical slot lengths',raw=>{raw.colors.push(null);}],['too few physical slots',raw=>{raw.colors.pop();raw.effectOptions.pop();}],
 ['excess physical slots',raw=>{while(raw.colors.length<256){raw.colors.push(null);raw.effectOptions.push(null);}}],
 ['unmarked inactive color',raw=>{raw.colors[0]=[0,1,2,3];}],['unmarked inactive options',raw=>{raw.effectOptions[0]=[50,100,0,1,2,3];}]
])test('negotiated projection '+name+' rejects without adopting it or retrying full state',async()=>{
 const raw=snapshot();change(raw);const f=fixture({projected:raw});await f.negotiate();const previous=f.lamp.raw;
 await assert.rejects(f.lamp.refresh(target,true,f.guard),/Invalid Bluetooth settings snapshot/);
 assert.equal(f.lamp.raw,previous);assert.equal(f.lamp.raw.name,'Cached');assert.equal(f.executions.length,1);assert.equal(f.executions[0].body,'view=current');
 assert(!f.callbacks.some(row=>row.metadata?.freshControl||row.options||row.firmware));
});

test('revoked projected read admission rejects before even a selector BEGIN',async()=>{
 const f=fixture();await f.negotiate();const before=f.events.length;f.stop();
 await assert.rejects(f.lamp.refresh(target,true,f.guard),error=>error.cancelled&&error.confirmed);assert.equal(f.events.length,before);assert.equal(f.executions.length,0);
});

for(const pause of ['write:23','read:'+CONTROL])test('cancellation during projected '+pause+' read fences later pages and cache while remaining read-only',async()=>{
 const f=fixture();await f.negotiate();const gate=deferred(),started=deferred(),previous=f.lamp.raw;
 f.radio.hold=async key=>{if(key===pause){f.radio.hold=null;started.resolve();await gate.promise;}};
 const pending=f.lamp.refresh(target,true,f.guard);await started.promise;const events=f.events.length,callbacks=f.callbacks.length;f.stop();gate.resolve();
 await assert.rejects(pending,error=>error.cancelled&&error.confirmed&&error.uncertain!==true);
 assert.equal(f.events.length,events);assert.equal(f.callbacks.length,callbacks);assert.equal(f.lamp.raw,previous);assert.equal(f.lamp.raw.name,'Cached');
 assert(!f.executions.some(row=>row.method!==1));assert.equal(f.executions.length,pause==='write:23'?0:1);assert(!f.callbacks.some(row=>row.metadata?.freshControl||row.options||row.firmware));
});
