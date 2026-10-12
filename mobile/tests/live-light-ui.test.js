import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {LiveLightQueue} from '../src/live-light.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function block(start){const at=source.indexOf(start);assert(at>=0,start);const open=source.indexOf('{',at);let depth=1,end=open+1;for(;depth&&end<source.length;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}assert.equal(depth,0);return source.slice(at,end);}
const wiring=source.slice(source.indexOf('function brightnessLabel()'),source.indexOf('async function connect(saved'));
const brightnessHandlers=source.split('\n').filter(line=>/^\$\('brightness'\)\.on(input|change)/.test(line)).join('\n');
const optionHandlers=source.slice(source.indexOf("for (const id of ['speed','intensity']) $(id).oninput"),source.indexOf('function verifiedSelectedLamp()'));
const stateCallback=block('onState(next,metadata) {').replace(/^onState\(/,'function receiveUI(');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
function harness(producer=async()=>true){
 let now=0,nextTimer=0;const timers=new Map(),elements=new Map(),calls=[],messages=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{value:id==='secondaryColor'?'#102030':id==='brightness'?100:id==='speed'?50:id==='intensity'?100:'',checked:false,disabled:false,style:{},classList:{toggle(){}},setAttribute(){}});return elements.get(id);};
 class ClockQueue extends LiveLightQueue{constructor(options){super({...options,set:(run,delay)=>{const id=++nextTimer;timers.set(id,{run,at:now+delay,delay});return id;},clear:id=>timers.delete(id),now:()=>now});}}
 const context={$:element,LiveLightQueue:ClockQueue,document:{querySelector:()=>element('hero'),documentElement:{style:{setProperty(){}}}},
  status:message=>messages.push(message),paintRanges:()=>{},renderFirmware:()=>{},filterEffects:()=>{},observeLampLighting:()=>{},rememberLampStyle:()=>{},observeLampWifi:()=>{},
  groupsAvailable:()=>true,updatingLamp:()=>false,fleetLampInstalling:()=>false,legacyWithoutGroups:()=>false,
  app2LightChange:async(...args)=>{calls.push(args);return producer(...args);}};
 runInNewContext(`
 let selected=null,lamp=null,bleLamp=null,wifiLamp={},state=null,busy=false,connecting=false,liveLightSending=false,liveLight=null;
 let editingBrightness=false,editingOptions=false,effectOptions=null,bluetoothFirmwareTask=null,centerStatus=null,firmware={version:'1.15.2'};
 const groupScenes=[];
 const verifiedSelectedLamp=()=>Boolean(state&&lamp&&selected&&lamp.identity===selected.id&&!connecting);
 const independentLightingAllowed=()=>Boolean(verifiedSelectedLamp()&&state.sync.role===0);
 ${block('function app2TargetMatches(')}
 ${block('function renderPower()')}
 const renderOptions=()=>renderPower();
 ${stateCallback}
 ${wiring}
 ${brightnessHandlers}
 ${optionHandlers}
 globalThis.ui={
  select(id='aabbccddeeff'){
   liveLight.cancel();lamp={identity:id,id:'native-'+id,deviceIdentity:id,epoch:1,raw:{token:'token-'+id},supportsOfflineControl:true,catalog:[{id:4,name:'Fire'}],command:()=>{throw Error('Unexpected legacy command');}};bleLamp=lamp;
   selected={id,name:id,deviceId:lamp.id};state={mode:4,brightness:100,power:true,sync:{role:0,active:false},calibration:{active:false},color:{enabled:true,r:10,g:20,b:30},capabilities:14,supportsColor:true};
   effectOptions={mode:4,speed:50,intensity:100,dual:0};renderPower();
  },input(id,value){$(id).value=value;$(id).oninput();},release(id){return $(id).onchange();},
  receive(next){receiveUI({...state,...next},{freshLight:true});},busy(value){busy=value;renderPower();},
  snapshot(){return {editingBrightness,editingOptions,busy,liveLightSending,brightness:state?.brightness,pending:liveLight.pending};},queue:()=>liveLight
 };ui.select();`,context);
 return {...context.ui,elements,calls,messages,timers,async tick(ms=120){now+=ms;for(const [id,timer]of[...timers])if(timer.at<=now){timers.delete(id);timer.run();}await flush();}};
}

test('production brightness oninput schedules the bounded 120 ms lane without waiting for finger release',async()=>{
 const f=harness();f.input('brightness',170);assert.equal(f.calls.length,0);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,120);
 await f.tick(119);assert.equal(f.calls.length,0);await f.tick(1);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0][0],'brightness');assert.equal(f.calls[0][1],170);assert.equal(f.calls[0][3],null);
});

test('a slider release before admission coalesces with continuous input instead of adding a duplicate change',async()=>{
 const f=harness();for(let value=1;value<=255;value++)f.input('brightness',value);f.release('brightness');await f.tick();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],255);assert.equal(f.snapshot().pending,false);
});

for(const option of ['speed','intensity'])test('production '+option+' input passes its exact changed-option key and current effect scope',async()=>{
 const f=harness();f.input(option,31);assert.equal(f.calls.length,0);await f.tick();assert.equal(f.calls.length,1);
 assert.equal(f.calls[0][0],'effectOptions');assert.equal(f.calls[0][1].mode,4);assert.equal(f.calls[0][1][option],31);assert.equal(f.calls[0][3],option);
 assert.equal(f.calls[0][1].dual,0);
});

test('production change, renderPower and state ACK callbacks keep sliders interactive throughout an in-flight live adjustment',async()=>{
 const gate=deferred(),f=harness(async()=>{await gate.promise;return true;});f.input('brightness',180);await f.tick();
 assert.equal(f.snapshot().busy,true);assert.equal(f.snapshot().liveLightSending,true);assert.equal(f.elements.get('controls').disabled,false);assert.equal(f.elements.get('brightness').disabled,false);
 f.receive({brightness:110});assert.equal(f.elements.get('controls').disabled,false);assert.equal(f.elements.get('brightness').disabled,false);assert.equal(f.elements.get('brightness').value,180);
 f.input('brightness',225);assert.equal(f.calls.length,1);gate.resolve();await flush();await f.tick();
 assert.equal(f.calls.length,2);assert.equal(f.calls[1][1],225);assert.equal(f.snapshot().busy,false);assert.equal(f.snapshot().liveLightSending,false);
});

test('another owning UI operation delays a live input rather than silently losing it through change busy guard',async()=>{
 const f=harness();f.busy(true);f.input('brightness',201);await f.tick();assert.equal(f.calls.length,0);assert.equal(f.snapshot().pending,true);
 f.busy(false);await f.tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],201);
});

test('an unsuccessful live adjustment discards unsent drafts and restores verified brightness and editing flags',async()=>{
 const f=harness(async()=>{throw Object.assign(Error('Not executed'),{preexecution:true,confirmed:true});});f.receive({brightness:80});f.input('brightness',220);f.input('intensity',20);await f.tick();await f.tick();
 assert.equal(f.calls.length,1);assert.equal(f.snapshot().pending,false);assert.equal(f.snapshot().editingBrightness,false);assert.equal(f.snapshot().editingOptions,false);
 assert.equal(f.elements.get('brightness').value,80);assert.equal(f.elements.get('brightnessValue').value,'31%');assert.match(f.messages.at(-1),/couldn’t apply/);
});

test('target selection cancels unsent production slider work and never moves it to the new lamp',async()=>{
 const f=harness();f.input('brightness',200);f.select('112233445566');await f.tick();assert.equal(f.calls.length,0);assert.equal(f.snapshot().pending,false);
});

test('an old in-flight error cannot discard the newly selected lamp’s production input',async()=>{
 const gate=deferred(),f=harness(async()=>{if(f.calls.length===1)await gate.promise;return true;});f.input('brightness',200);await f.tick();
 f.select('112233445566');f.input('brightness',70);gate.reject(Error('Old target stopped'));await flush();await f.tick();
 assert.equal(f.calls.length,2);assert.equal(f.calls[1][1],70);assert.equal(f.messages.length,0);
});
