import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {normalizeLampStyle,styleDefinition,lampStyleLocked,lampDesignLabel,resolveLampStyle} from '../src/lamp-style.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),id='aabbccddeeff';
const style=(extra={})=>({version:1,code:1,id:'helix',family:'helix',...extra});
const rendering=source.slice(source.indexOf('function renderLampStyleSettings('),source.indexOf('\nfunction settingsSection('));
function renderFixture(rawStyle,{cached=null,connected=true}={}){
 const elements=new Map(),node=key=>{if(!elements.has(key))elements.set(key,{value:'',textContent:'',hidden:false,disabled:false,setAttribute(){},replaceChildren(){}});return elements.get(key);};
 const lamp={raw:{lampStyle:rawStyle},epoch:4},selected={id,lampStyle:cached,phoneLampStyle:'corkscrew'};
 const context={$:node,lamp,selected,state:{power:true},firmware:{version:'1.15.5'},bleLamp:lamp,busy:false,connecting:false,styleSaving:null,
  styleDraftIdentity:null,styleDraftDirty:false,verifiedSelectedLamp:()=>connected,updatingLamp:()=>false,
  reportedLampStyle:normalizeLampStyle,lampStyleLocked,lampDesignLabel,lampStyleIllustration:value=>value,setupActivity(){},retireStyleActivity(){},
  resolvedStyle:()=>resolveLampStyle(connected?lamp.raw.lampStyle:selected.lampStyle,selected.phoneLampStyle)};
 runInNewContext(rendering+';globalThis.render=renderLampStyleSettings;',context);context.render();return {node,lamp,render:context.render};
}
test('actual design renderer hides editing for factory lamps and explains that strip calibration remains separate',()=>{
 const f=renderFixture(style({locked:true,model:{version:1,id:'helix-2',displayName:'Helix lamp',artworkFamily:'helix',hardwareRevision:'rev-b',preconfigured:true}}));
 assert.equal(f.node('lampStyleFields').hidden,true);assert.equal(f.node('lampStyleFields').disabled,true);
 assert.equal(f.node('lampStyleReadOnly').hidden,false);assert.equal(f.node('lampStyleReadOnly').textContent,'Helix lamp');
 assert.match(f.node('lampStyleScope').textContent,/set at the factory/);assert.match(f.node('lampStyleScope').textContent,/LED count and strip setup are separate/);
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/<\/fieldset>[\s\S]*?<button[^>]*data-settings-section="hardware">LED count & strip setup<\/button>/);
});

test('factory Edison renders its own trusted design label while keeping calibration independent',()=>{
 const value={version:1,id:'edison',code:4,family:'edison',locked:true,factoryStyle:'edison',model:{version:1,id:'edison-v1',displayName:'CoolLamp Edison',artworkFamily:'edison',hardwareRevision:'unspecified',preconfigured:true}};
 const f=renderFixture(value);assert.equal(f.node('lampStyleReadOnly').textContent,'CoolLamp Edison');
 assert.equal(f.node('lampStyleFields').hidden,true);assert.equal(f.node('lampStyleFields').disabled,true);
 assert.equal(f.node('lampStyle').value,'edison');assert.match(f.node('lampStyleScope').textContent,/LED count and strip setup are separate/);
});
test('legacy design remains editable and a later locked snapshot retires a stale draft',()=>{
 const f=renderFixture(style());assert.equal(f.node('lampStyleFields').hidden,false);assert.equal(f.node('lampStyleFields').disabled,false);
 f.node('lampStyle').value='corkscrew';f.lamp.raw.lampStyle=style({locked:true});f.render();assert.equal(f.node('lampStyle').value,'helix');assert.equal(f.node('lampStyleFields').hidden,true);
});
test('unavailable or future factory design remains read-only with generic artwork and no phone override',()=>{
 for(const value of [style({locked:true}),{version:1,code:0,id:'unspecified',family:'unspecified',locked:true,factoryStatus:'unavailable'}]){
  const f=renderFixture(value,{cached:value,connected:false});assert.equal(f.node('lampStyleFields').hidden,true);assert.equal(f.node('lampStyleReadOnly').hidden,false);
  if(value.factoryStatus)assert.equal(f.node('lampStyleReadOnly').textContent,'Factory design unavailable');
 }
});

const meshSubmit=source.slice(source.indexOf("$('meshSetupForm').onsubmit="),source.indexOf('\nasync function openCardSettings('));
test('actual mesh setup handler keeps factory design while allowing an independent odd LED count correction',async()=>{
 const elements=new Map(),calls=[],node=key=>{if(!elements.has(key))elements.set(key,{value:'',checked:false,disabled:false,textContent:''});return elements.get(key);};
 const raw={name:'Lamp',lampStyle:style({locked:true}),ssid:'',leds:181,milliamps:500,startupMode:4,startupBrightness:100,audio:{installed:true}};
 const transport={identity:id,raw,state:{power:true},enqueue:fn=>fn(),configureLampStyle:async()=>calls.push('style'),request:async(path,data)=>calls.push({path,data}),command:async()=>calls.push('power')};
 const task={lease:{lamp:transport},target:id,abort:new AbortController(),saving:false};
 Object.assign(node('meshSetupName'),{value:'Lamp'});node('meshSetupStyle').value='corkscrew';node('meshSetupLeds').value='183';node('meshSetupMilliamps').value='500';node('meshSetupMicrophone').checked=true;node('meshSetupPower').checked=true;
 const context={$:node,meshWizard:task,styleDefinition,lampStyleLocked,reportedLampStyle:normalizeLampStyle,rememberLampStyle(){},wifiCredentials(){throw Error('No Wi-Fi change expected');},
  store:{items:[{id}],upsert(){}},closeMeshWizard:async()=>calls.push('closed'),status(){}};
 runInNewContext(meshSubmit,context);await node('meshSetupForm').onsubmit({preventDefault(){}});
 assert.equal(calls.includes('style'),false);const writes=calls.filter(call=>call?.path);assert.equal(writes.length,1);assert.equal(writes[0].path,'/api/config');assert.equal(writes[0].data.leds,183);
 assert.equal('style' in writes[0].data,false);assert(calls.includes('closed'));
});
