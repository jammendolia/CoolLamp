import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {resolveLampStyle} from '../src/lamp-style.js';
import {selectMeshRecoveryCandidates} from '../src/settings-recovery.js';

test('a large saved Wi-Fi inventory retains the preferred paired Bluetooth mesh bridge',()=>{
 const wifi=Array.from({length:20},(_,i)=>({entry:{id:'wifi-'+i},kind:'wifi'}));
 const preferred={entry:{id:'preferred-paired'},kind:'bluetooth'},other={entry:{id:'other-paired'},kind:'bluetooth'};
 assert.deepEqual(selectMeshRecoveryCandidates([...wifi,preferred,other]),[wifi[0],preferred]);
});
test('an existing active bridge retains priority while reserving a paired Bluetooth fallback',()=>{
 const active={transport:{identity:'active'}},wifi={entry:{id:'wifi'},kind:'wifi'},ble={entry:{id:'paired'},kind:'bluetooth'};
 assert.deepEqual(selectMeshRecoveryCandidates([active,wifi,ble]),[active,ble]);
 assert.deepEqual(selectMeshRecoveryCandidates([wifi,{...wifi,entry:{id:'second'}}]),[wifi,{...wifi,entry:{id:'second'}}]);
 assert.deepEqual(selectMeshRecoveryCandidates([ble]),[ble]);
 assert.deepEqual(selectMeshRecoveryCandidates(null),[]);
});

// Exercise Home's actual render/memoization function with a small DOM adapter.
// Only the drawing output is simplified so the asserted style is explicit.
const source=readFileSync(new URL('../src/app-v2.js',import.meta.url),'utf8');
const styleDeclaration=source.match(/export const lampDrawingStyle=[^;]+;/)[0].replace('export ','');
const start=source.indexOf(' function refresh(force=false)'),end=source.indexOf(' function chooseLight(',start);
function homeHarness(entry){
 let html='',renders=0;const elements=new Map();
 const home={contains:()=>false,querySelectorAll:()=>[],get innerHTML(){return html;},set innerHTML(value){html=value;renders++;}};
 const context={resolveLampStyle,home,api:{model:()=>({lamps:[entry],groups:[],statuses:{},connected:false})},preferences:{rooms:{},groups:{}},
  document:{hidden:false,activeElement:null,getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}},
  lastHome:'',room:()=>'',groupName:()=>'',esc:String,icon:()=>'',lampDrawing:style=>'<art style="'+style+'"/>'};
 runInNewContext(styleDeclaration+'\n'+source.slice(start,end)+'\nthis.refresh=refresh;',context);
 return {refresh:context.refresh,html:()=>html,renders:()=>renders};
}
test('phone-only design changes refresh Home even when lamp identity and connection stay the same',()=>{
 const entry={id:'aabbccddeeff',name:'My lamp',phoneLampStyle:'helix'},home=homeHarness(entry);
 home.refresh();assert.match(home.html(),/<art style="helix"\/><span><strong>My lamp/);home.refresh();assert.equal(home.renders(),1);
 entry.phoneLampStyle='corkscrew';home.refresh();assert.match(home.html(),/<art style="corkscrew"\/><span><strong>My lamp/);assert.equal(home.renders(),2);
});
test('reported hardware design takes precedence and a later lamp design change refreshes Home',()=>{
 const entry={id:'aabbccddeeff',name:'My lamp',phoneLampStyle:'corkscrew',lampStyle:{version:1,code:1,id:'helix',family:'helix'}},home=homeHarness(entry);
 home.refresh();assert.match(home.html(),/<art style="helix"\/><span><strong>My lamp/);
 entry.lampStyle={version:1,code:2,id:'large-helix',family:'helix'};home.refresh();assert.match(home.html(),/<art style="large-helix"\/><span><strong>My lamp/);
});
