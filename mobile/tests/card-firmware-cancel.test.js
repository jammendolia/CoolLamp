import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),id='f0b950b2f180',other='aabbccddeeff';
function extract(start,end){const first=source.indexOf(start),last=source.indexOf(end,first);assert(first>=0&&last>first);return source.slice(first,last);}
const handlers=[extract('function bluetoothFirmwareOwner(','\nfunction firmwareBackgroundWorkAllowed('),
 extract('function firmwareCancelBlocked(',"\n$('cancelBluetoothFirmware').onclick="),
 extract('function cardFirmwareCancelButton(','\nfunction updateDiagnosticDetails('),
 extract('function renderBluetoothFirmwareControls(','\nfunction renderFirmware(')].join('\n');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture({stage='transferring',path='bluetooth',attempt={},sender,feedback=true,reconciling=false}={}){
 const calls=[],elements=new Map(),entry={id,name:'Reading lamp'},task={id,path,stage,reconciling,abort:new AbortController(),...(feedback?{feedback:{id}}:{}),transport:{bluetoothUpdate:sender}};
 const context={Error,Promise,Map,cardFirmwareTasks:new Map([[id,task]]),bluetoothFirmwareTask:null,bleLamp:{},firmwareAttempts:{get:()=>attempt},
  firmwareFeedback:{update:(_token,value)=>calls.push(['feedback',value.message])},renderLamps:()=>calls.push('render-lamps'),renderFirmware:()=>calls.push('render-firmware'),status:message=>calls.push(['status',message]),
  document:{createElement:()=>({style:{},dataset:{},attributes:{},setAttribute(key,value){this.attributes[key]=value;}})},
  selected:{id,name:entry.name},lamp:null,state:null,busy:false,connecting:false,verifiedSelectedLamp:()=>false,firmwareConnectionBusy:()=>true,updatingLamp:()=>false,
  validFirmwareVersion:()=>true,compareFirmwareVersions:()=>1,firmware:{version:'1.13.0'},
  $:key=>{if(!elements.has(key))elements.set(key,{attributes:{},setAttribute(name,value){this.attributes[name]=value;}});return elements.get(key);}};
 runInNewContext(handlers,context);return {context,calls,task,entry,elements,button:()=>context.cardFirmwareCancelButton(entry),cancel:(reason='user')=>context.cancelBluetoothFirmware(reason,id)};
}
for(const stage of ['connecting','downloading','downloaded','preparing','transferring'])test('the production card exposes a plainly labeled accessible Cancel during '+stage,()=>{
 const f=fixture({stage}),button=f.button();assert.equal(button.textContent,'Cancel');assert.equal(button.disabled,false);assert.equal(button.dataset.connection,'cancel-update');
 assert.equal(button.attributes['aria-label'],'Cancel update for Reading lamp');assert.match(button.className,/v2-card-update/);
});
for(const fields of [{path:'wifi'},{feedback:false},{reconciling:true},{stage:'verifying'},{stage:'restarting'},{stage:'checking-result'},{stage:'reconciling'},
 {attempt:{commitAttempted:true}},{attempt:{wifiInstallAttempted:true}},{sender:{commitAttempted:true}}])test('Cancel is absent at unsafe or unsupported boundary '+JSON.stringify(fields),async()=>{
 const f=fixture(fields);assert.equal(f.button(),null);
 if(fields.path!=='wifi'&&fields.feedback!==false){await f.cancel();assert.equal(f.task.abort.signal.aborted,false);assert.equal(f.task.cancelRequested,undefined);}
});
test('foreground Cancel stops the sender synchronously and retains the same owner and signal until its handshake finishes',async()=>{
 const gate=deferred();let f,requests=0;
 const sender={commitAttempted:false,cancel(reason){requests++;assert.equal(reason,'user');assert.equal(f.task.abort.signal.aborted,false);assert.equal(f.context.cardFirmwareTasks.get(id),f.task);return gate.promise;}};
 f=fixture({sender});const run=f.cancel();assert.equal(requests,1);assert.equal(f.task.cancelRequested,true);assert.equal(f.task.abort.signal.aborted,false);
 const button=f.button();assert.equal(button.textContent,'Stopping…');assert.equal(button.disabled,true);const duplicate=f.cancel();assert.equal(requests,1);
 gate.resolve({cancelled:true,confirmed:true,uncertain:false});await run;await duplicate;
 assert.equal(f.task.abort.signal.aborted,false);assert.equal(f.context.cardFirmwareTasks.get(id),f.task);assert(f.calls.some(value=>Array.isArray(value)&&value[1]==='Stopping the update…'));
});
test('preflight or phone-download Cancel aborts only its target when no sender exists',async()=>{
 const f=fixture({stage:'downloading'}),otherTask={id:other,abort:new AbortController(),path:'bluetooth'};f.context.cardFirmwareTasks.set(other,otherTask);
 await f.cancel();assert.equal(f.task.abort.signal.aborted,true);assert.equal(f.task.abort.signal.reason,'user');assert.equal(otherTask.abort.signal.aborted,false);
});
test('a sender refusal at the final boundary preserves the installation and presents finishing instead of pretending to stop',async()=>{
 const f=fixture({sender:{cancel:()=>({cancelled:false,tooLate:true,verificationRequired:true})}});await f.cancel();
 assert.equal(f.task.abort.signal.aborted,false);assert.equal(f.task.cancelRequested,false);assert.equal(f.task.stage,'verifying');assert.equal(f.button(),null);
 assert(f.calls.some(value=>Array.isArray(value)&&/finishing/.test(value[1])));
});
test('a missing Cancel ACK remains unconfirmed without aborting the owner or authorizing another write',async()=>{
 const result={cancelled:true,confirmed:false,uncertain:true,cancelSent:true},f=fixture({sender:{cancel:()=>result}});
 assert.equal(await f.cancel(),result);assert.equal(f.task.abort.signal.aborted,false);assert.equal(f.task.cancelRequested,true);assert.equal(f.context.cardFirmwareTasks.get(id),f.task);
 assert(!f.calls.some(value=>Array.isArray(value)&&/cancelled|unchanged|installed/i.test(value[1])));
});
test('native background lifetime cancellation still aborts immediately and makes no promise of a foreground receipt',async()=>{
 let f,called=false;f=fixture({sender:{cancel(reason){called=true;assert.equal(reason,'app-hidden');assert.equal(f.task.abort.signal.aborted,true);return {cancelled:true,uncertain:true};}}});
 await f.cancel('app-hidden');assert.equal(called,true);assert.equal(f.task.abort.signal.reason,'app-hidden');
});
test('a foreign card cannot cancel an existing update owner',async()=>{
 const f=fixture({sender:{cancel:()=>assert.fail('A different card cancelled this sender.')}});
 await f.context.cancelBluetoothFirmware('user',other);assert.equal(f.task.abort.signal.aborted,false);assert.equal(f.task.cancelRequested,undefined);
});
test('Settings Cancel remains usable for its private card owner after the selected normal connection was retired',()=>{
 const f=fixture();f.context.renderBluetoothFirmwareControls();
 assert.equal(f.elements.get('bluetoothFirmwareControls').disabled,false);assert.equal(f.elements.get('cancelBluetoothFirmware').hidden,false);assert.equal(f.elements.get('cancelBluetoothFirmware').disabled,false);
 assert.equal(f.elements.get('installBluetoothFirmware').disabled,true);assert.equal(f.elements.get('reinstallBluetoothFirmware').disabled,true);
});
