import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {resolveLampStyle,lampStyleLocked} from '../src/lamp-style.js';
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
function homeHarness(entry,others=[]){
 let html='',renders=0;const elements=new Map();
 const model={lamps:entry?[entry,...others]:others,groups:[],statuses:{},connected:false,selected:null};
 const home={contains:()=>false,querySelectorAll:()=>[],get innerHTML(){return html;},set innerHTML(value){html=value;renders++;}};
 const context={resolveLampStyle,home,api:{model:()=>model},preferences:{rooms:{},groups:{}},
  document:{hidden:false,activeElement:null,getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}},
  lastHome:'',room:()=>'',groupName:()=>'',esc:String,icon:()=>'',lampDrawing:style=>'<art style="'+style+'"/>'};
 runInNewContext(styleDeclaration+'\n'+source.slice(start,end)+'\nthis.refresh=refresh;',context);
 return {refresh:context.refresh,html:()=>html,renders:()=>renders,model};
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

const sonata={version:1,code:5,id:'sonata',family:'sonata'};
const helix={version:1,code:1,id:'helix',family:'helix'};

test('Home hero follows the selected inventory lamp and refreshes when only selection changes',()=>{
 const first={id:'aabbccddeeff',name:'Reading lamp',lampStyle:helix};
 const second={id:'112233445566',name:'Sonata Left',lampStyle:sonata,phoneLampStyle:'helix'};
 const home=homeHarness(first,[second]);
 home.model.selected={id:second.id,phoneLampStyle:'helix'};home.refresh();
 assert.match(home.html(),/<art style="sonata"\/><\/section>/);assert.equal(home.renders(),1);
 home.model.selected={id:first.id};home.refresh();
 assert.match(home.html(),/<art style="helix"\/><\/section>/);assert.equal(home.renders(),2);
 home.refresh();assert.equal(home.renders(),2);
});

test('Home hero uses its first inventory lamp when selection is absent or no longer owned, without name inference',()=>{
 const entry={id:'aabbccddeeff',name:'Sonata Left',lampStyle:sonata},home=homeHarness(entry);
 home.refresh();assert.match(home.html(),/<art style="sonata"\/><\/section>/);
 home.model.selected={id:'gone',lampStyle:helix};home.refresh();
 assert.match(home.html(),/<art style="sonata"\/><\/section>/);assert.equal(home.renders(),1);
 delete entry.lampStyle;home.refresh();assert.match(home.html(),/<art style="unspecified"\/><\/section>/);
 entry.lampStyle=helix;home.refresh();assert.match(home.html(),/<art style="helix"\/><\/section>/);
});

test('empty Home uses generic artwork before a lamp design is known',()=>{
 const home=homeHarness(null);home.refresh();
 assert.match(home.html(),/<section class="v2-welcome"><art style="unspecified"\/>/);
});

const setupStart=source.indexOf(' function setup(){'),setupEnd=source.indexOf(' function beginSetup(){',setupStart);
function setupDrawing(model,setupId=null){
 let html='';
 const context={resolveLampStyle,lampStyleLocked,api:{model:()=>model},setupId,setupStep:1,working:false,
  sheet:(title,body)=>html=body,lampDrawing:style=>'<art style="'+style+'"/>'};
 runInNewContext(styleDeclaration+'\n'+source.slice(setupStart,setupEnd)+'\nsetup();',context);
 return html;
}

test('setup instructions use generic artwork before pairing and the known target when returning to pairing',()=>{
 const target={id:'aabbccddeeff',lampStyle:sonata,phoneLampStyle:'helix'},other={id:'112233445566',lampStyle:helix};
 assert.match(setupDrawing({lamps:[target,other],selected:other}),/^<art style="unspecified"\/>/);
 assert.match(setupDrawing({lamps:[target,other],selected:target},target.id),/^<art style="sonata"\/>/);
 assert.match(setupDrawing({lamps:[target,other],selected:other},target.id),/^<art style="sonata"\/>/);
 target.lampStyle={version:1,code:0,id:'unspecified',family:'unspecified',locked:true};
 target.phoneLampStyle='sonata';
 assert.match(setupDrawing({lamps:[target],selected:target},target.id),/^<art style="unspecified"\/>/);
});
