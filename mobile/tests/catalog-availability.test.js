import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {validateCatalog,selectableCatalog,startupCatalog,effectAvailable} from '../src/catalog.js';
import {LampTransport} from '../src/transport.js';
import {WifiTransport} from '../src/wifi.js';
import {decodeState} from '../src/protocol.js';
import {effectSettings} from '../src/effect-settings.js';

const newNames=['Filament','Eureka','Orbit','Induction','Sound Filament'];
function edisonCatalog(count=52){
 return validateCatalog(Array.from({length:count},(_,index)=>{
  const id=index+1,audio=id>=39&&id<=47||id===52;
  return {id,name:id>=48?newNames[id-48]:'Legacy '+id,category:audio?'audio':'calm',speed:true,
   ...(id>=39&&id<=47?{available:false}:{}),...(id>=48?{startupSupported:false}:{})};
 }),count);
}
const statePacket=(id=0,mode=48,count=52)=>new DataView(Uint8Array.of(1,id,0,mode,100,1,count,43,1,0,0,0,0,255,80,0).buffer);

test('optional availability preserves dense wire slots and exact legacy object shape',()=>{
 const legacy=[{id:1,name:'Future effect',category:'calm',speed:true}];
 assert.deepEqual(validateCatalog(legacy,1),legacy);
 const catalog=edisonCatalog();
 assert.equal(catalog.length,52);assert.equal(catalog[47].id,48);assert.equal(catalog[47].name,'Filament');
 assert.deepEqual(selectableCatalog(catalog).map(entry=>entry.id),[...Array.from({length:38},(_,i)=>i+1),48,49,50,51,52]);
 assert.equal(selectableCatalog(catalog).length,43);
 assert.deepEqual(startupCatalog(catalog).map(entry=>entry.id),Array.from({length:38},(_,i)=>i+1));
 assert.equal(catalog[47].startupSupported,false);
 assert.equal(selectableCatalog(catalog)[38],catalog[47]);
 assert.equal(catalog[38].available,false);assert.equal(effectAvailable(catalog,39),false);assert.equal(effectAvailable(catalog,48),true);
 assert.equal(effectAvailable(catalog,53),false);assert.equal(effectAvailable(null,1),false);
 for(const available of [0,1,null,'false',{},[]])assert.throws(()=>validateCatalog([{...legacy[0],available}],1),/availability/);
 for(const startupSupported of [0,1,null,'false',{},[]])assert.throws(()=>validateCatalog([{...legacy[0],startupSupported}],1),/availability/);
 assert.deepEqual(validateCatalog([{...legacy[0],startupSupported:true}],1),[{...legacy[0],startupSupported:true}]);
 assert.throws(()=>validateCatalog([legacy[0],{id:3,name:'Sparse',category:'calm',speed:true}],2),/catalog/);
 assert.deepEqual(selectableCatalog(edisonCatalog(51)).map(entry=>entry.id).slice(-4),[48,49,50,51]);
 assert.equal(decodeState(statePacket()).effectCount,52);
});

test('Bluetooth rejects unavailable selection and tuning before any native write',async()=>{
 const writes=[];let lamp;
 const radio={async write(device,service,characteristic,frame){
  writes.push(frame);lamp.receive(statePacket(frame.getUint8(1),frame.getUint8(2)===3?frame.getUint8(3):lamp.state.mode));
 }};
 lamp=new LampTransport(radio);lamp.id='fixture';lamp.state=decodeState(statePacket());lamp.catalog=edisonCatalog();
 for(const [operation,value] of [['effect',39],['resetColor',39],['color',{mode:39,r:1,g:2,b:3}],
  ['effectOptions',{mode:39,speed:50,intensity:80,dual:0,r:1,g:2,b:3}]])
  await assert.rejects(lamp.command(operation,value),error=>error.confirmed===true&&/not available/.test(error.message));
 assert.equal(writes.length,0);assert.equal(lamp.id,'fixture');
 await assert.rejects(lamp.command('saveDefaults'),error=>error.confirmed===true&&/startup light/.test(error.message));
 assert.equal(writes.length,0);assert.equal(lamp.id,'fixture');
 await lamp.command('effect',51);assert.equal(writes.length,1);assert.equal(lamp.state.mode,51);assert.equal(lamp.state.effectCount,52);
 lamp.control={capabilities:['control']};lamp.deviceIdentity='aabbccddeeff';lamp.raw={sync:{role:1,scene:3}};
 lamp.configureGroupScene=()=>assert.fail('Unavailable effect must not clear the coordinator scene.');
 await assert.rejects(lamp.command('effect',39),/not available/);assert.equal(writes.length,1);
});

test('Wi-Fi and inherited mesh command ownership reject unavailable slots before sending',async()=>{
 const lamp=new WifiTransport({}),requests=[];lamp.catalog=edisonCatalog(51);lamp.state={power:true,mode:48,brightness:100};lamp.raw={apiVersion:2};
 lamp.request=async(...args)=>{requests.push(args);return 'OK';};lamp.refresh=async()=>lamp.raw;
 for(const [operation,value] of [['effect',39],['resetColor',39],['color',{mode:39,r:1,g:2,b:3}],
  ['effectOptions',{mode:39,speed:50,intensity:80,dual:0,r:1,g:2,b:3}]])
  await assert.rejects(lamp.command(operation,value),error=>error.confirmed===true&&/not available/.test(error.message));
 assert.equal(requests.length,0);
 await assert.rejects(lamp.command('saveDefaults'),error=>error.confirmed===true&&/startup light/.test(error.message));
 assert.equal(requests.length,0);
 await lamp.command('effect',51);assert.deepEqual(requests,[['/api/preview',{mode:51,brightness:100,keepPower:1}]]);
});

test('production effect library lists only selectable entries while retaining their real IDs',()=>{
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const start=source.indexOf('function filterEffects()'),end=source.indexOf('\nfor(const tab of document.querySelectorAll',start);
 assert(start>=0&&end>start);
 const nodes=new Map(),node=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',options:[],children:[],dataset:{},setAttribute(){},append(...values){this.children.push(...values);},
   replaceChildren(...values){this.options=[];this.children=values;},add(value){this.options.push(value);}});
  return nodes.get(id);
 };
 function Option(text,value){Object.assign(this,{text,value:String(value),disabled:false});}
 const catalog=edisonCatalog(51),context={selectableCatalog,effectDisplayName:entry=>entry?.name,recommendedEffects:value=>value,
  resolvedStyle:()=>({id:'edison'}),styleLabel:()=> 'Edison',state:{mode:48},lamp:{catalog},selected:{favorites:[39,48]},
  effectStyleFilter:'all',category:'all',effectListKey:'',Option,$:node,
  document:{activeElement:null,querySelectorAll:()=>[],querySelector:()=>node('audio-filter'),createElement:tag=>({tag,children:[],dataset:{},setAttribute(){},append(...values){this.children.push(...values);},focus(){}})}};
 runInNewContext(source.slice(start,end)+';filterEffects();',context);
 assert.equal(node('libraryCount').textContent,'42 effects');
 assert.deepEqual(node('effect').options.map(option=>Number(option.value)),selectableCatalog(catalog).map(entry=>entry.id));
 assert.equal(node('audio-filter').hidden,true);assert.equal(catalog.length,51);
 context.category='favorites';runInNewContext('filterEffects();',context);
 assert.deepEqual(node('effect').options.map(option=>Number(option.value)),[48]);
});

test('production startup selector omits unavailable slots without changing stored appearance indexes',()=>{
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),start=source.indexOf('function fillNetwork()'),end=source.indexOf('\nfunction renderWifiSettings(',start);
 assert(start>=0&&end>start);
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',children:[],replaceChildren(...values){this.children=values;}});return nodes.get(id);};
 function Option(text,value){Object.assign(this,{text,value:String(value)});}
 const catalog=edisonCatalog(51),raw={leds:222,midpoint:81,mode:48,startupMode:4,startupBrightness:100};
 const context={$:node,Option,startupCatalog,lamp:{raw,catalog},wifiSettingsSummary:{editing:false},renderSettings(){}};
 runInNewContext(source.slice(start,end)+';fillNetwork();',context);
 assert.deepEqual(node('startupMode').children.map(option=>Number(option.value)),Array.from({length:38},(_,i)=>i+1));
 assert.equal(node('startupMode').value,4);assert.equal(catalog[47].name,'Filament');assert.equal(raw.midpoint,81);
});

test('production modern partial-change path rejects an unavailable selection before negotiation or writes',async()=>{
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),start=source.indexOf('async function change('),end=source.indexOf('\nliveLight=new LiveLightQueue',start);
 assert(start>=0&&end>start);
 const messages=[],calls=[],context={effectAvailable,busy:false,selected:{id:'aabbccddeeff'},bluetoothFirmwareTask:null,
  state:{mode:48,sync:{active:false}},lamp:{catalog:edisonCatalog(),command:()=>calls.push('legacy')},$:()=>({}),fleetLampInstalling:()=>false,
  independentLightingAllowed:()=>true,status:value=>messages.push(value),renderPower(){},renderFirmware(){},renderOptions(){},
  app2LightChange:async(...args)=>{calls.push(args);return true;}};
 runInNewContext(source.slice(start,end)+';globalThis.apply=change;',context);
 await context.apply('effect',39);assert.equal(calls.length,0);assert.match(messages.at(-1),/not available/);
 await context.apply('saveDefaults');assert.equal(calls.length,0);assert.match(messages.at(-1),/startup light/);
 await context.apply('effect',51);assert.equal(calls.length,1);assert.equal(calls[0][0],'effect');assert.equal(calls[0][1],51);
});

test('Edison descriptions follow names and preserve a safe unknown-effect fallback',()=>{
 for(const name of newNames){
  const profile=effectSettings({id:1,name,category:name==='Sound Filament'?'audio':'calm',speed:true});
  assert.match(profile.description,/Edison|coils/);assert.equal(profile.motion,true);assert.equal(profile.audio,name==='Sound Filament');
 }
 assert.match(effectSettings({id:48,name:'Unknown future effect',category:'other',speed:false}).description,/color and movement/);
});
