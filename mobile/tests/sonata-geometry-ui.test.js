import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {lampStyleUsesWholeStrip} from '../src/lamp-style.js';
import {startupCatalog} from '../src/catalog.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function extract(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a);return source.slice(a,b);}
const helper=extract('function selectedLampUsesWholeStrip(){','\nfunction verifiedOlderBluetoothSettings(');
const fill=extract('function fillNetwork() {','\nfunction renderWifiSettings(');
const render=extract('function renderSettings() {','\n  const observedGroup=')+'\n}';
const center=extract('function renderCenterTool(){','\nfunction setCenterStatus(');
const action=extract('async function centerAction(action){',"\n$('startCenter').onclick=");
const handlers=extract("$('geometryForm').onsubmit=", "\n$('audioUseForm').onsubmit=");
const sonata={version:1,code:5,id:'sonata',family:'sonata'},helix={version:1,code:1,id:'helix',family:'helix'};

function fixture({style=sonata,verified=true,phone='sonata'}={}){
 const elements=new Map(),node=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,disabled:false,value:'',children:[],dataset:{settingsPanel:'hardware'},replaceChildren(...values){this.children=values;}});return elements.get(id);};
 const calls=[],raw={lampStyle:style,leds:183,midpoint:70,motionVersion:1,motionPath:0,mode:4,startupMode:4,startupBrightness:100,calibration:{centerSupported:true}};
 const lamp={raw,catalog:[{id:1,name:'White',speed:false,category:'color'}],configureGeometry:async value=>calls.push(['center',value]),configureMotionPath:async value=>calls.push(['path',value])};
 const context={$:node,lamp,selected:{phoneLampStyle:phone},state:{capabilities:128,calibration:raw.calibration},busy:false,connecting:false,settingsView:'hardware',centerWasActive:false,centerStatus:null,
  verifiedSelectedLamp:()=>verified,lampStyleUsesWholeStrip,advancedAvailable:()=>true,updatingLamp:()=>false,
  renderFirmwareFeedback(){},renderBluetoothFirmwareControls(){},renderSettings(){},wifiSettingsSummary:{editing:false},startupCatalog,
  document:{querySelectorAll:()=>[node('hardwareForm'),node('geometrySettings'),node('calibrationPane')]},
  Option:function(text,value){this.text=text;this.value=String(value);},networkAction:async fn=>fn(),status(){}};
 runInNewContext(helper+';this.wholeStrip=selectedLampUsesWholeStrip;',context);
 return {context,node,calls,raw,run:code=>runInNewContext(code,context)};
}

test('only the verified connected Sonata descriptor hides center controls, never a cached or phone-only design',()=>{
 const f=fixture();assert.equal(f.context.wholeStrip(),true);
 for(const options of [{verified:false},{style:helix},{style:undefined},{style:'sonata'},{style:{...sonata,code:4}},{style:{...sonata,family:'helix'}}]){
  const f=fixture(options);if(Object.hasOwn(options,'style'))f.raw.lampStyle=options.style;
  assert.equal(f.context.wholeStrip(),false);
 }
});

test('production Settings hides Sonata center/path tools while retaining strip count and LED calibration',()=>{
 const f=fixture();f.run(render+';renderSettings();');
 assert.equal(f.node('geometrySettings').hidden,true);assert.equal(f.node('hardwareForm').hidden,false);
 assert.equal(f.node('calibrationPane').hidden,false);assert.equal(f.node('wholeStripGeometryHint').hidden,false);
 const ordinary=fixture({style:helix});ordinary.run(render+';renderSettings();');
 assert.equal(ordinary.node('geometrySettings').hidden,false);assert.equal(ordinary.node('wholeStripGeometryHint').hidden,true);
});

test('production network fill retains measured LED count and saved geometry without exposing a Sonata split',()=>{
 const f=fixture(),before=structuredClone(f.raw);f.run(fill+';fillNetwork();');
 assert.equal(f.node('geometrySettings').hidden,true);assert.equal(f.node('motionPathForm').hidden,true);
 assert.equal(f.node('leds').value,183);assert.deepEqual(f.raw,before);assert.equal(f.calls.length,0);
});

test('retained center and path submission handlers cannot send a Sonata geometry mutation',async()=>{
 const f=fixture();f.node('midpoint').value='80';f.node('motionPath').value='0';f.run(handlers);
 await f.node('geometryForm').onsubmit({preventDefault(){}});await f.node('motionPathForm').onsubmit({preventDefault(){}});
 assert.deepEqual(f.calls,[]);
 const ordinary=fixture({style:helix});ordinary.node('midpoint').value='80';ordinary.node('motionPath').value='1';ordinary.run(handlers);
 await ordinary.node('geometryForm').onsubmit({preventDefault(){}});await ordinary.node('motionPathForm').onsubmit({preventDefault(){}});
 assert.deepEqual(ordinary.calls,[['center',80],['path',1]]);
});

test('a newly verified Sonata descriptor also blocks a center/path action already waiting in the queue',async()=>{
 const f=fixture({style:helix}),queued=[];f.context.networkAction=fn=>queued.push(fn);f.run(handlers);
 f.node('geometryForm').onsubmit({preventDefault(){}});f.node('motionPathForm').onsubmit({preventDefault(){}});assert.equal(queued.length,2);
 f.raw.lampStyle=sonata;for(const dispatch of queued)await dispatch();assert.deepEqual(f.calls,[]);
});

test('center renderer and retained start/save actions do not start calibration on Sonata',async()=>{
 const f=fixture();f.run(center+';renderCenterTool();'+action+';this.adjust=centerAction;');
 assert.equal(f.node('centerHelper').hidden,true);assert.equal(f.node('geometryForm').hidden,true);assert.equal(f.node('centerControls').disabled,true);
 for(const verb of ['start','save','cancel'])await f.context.adjust(verb);
 assert.deepEqual(f.calls,[]);assert.equal(f.context.busy,false);
});
