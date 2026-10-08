import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorLightingContext,runGroupLighting,GroupLightingUi} from '../src/group-lighting-ui.js';
import {WifiTransport} from '../src/wifi.js';

const id='aabbccddeeff';
function fixture({scene=0,ble=true}={}) {
  const writes=[],reads=[],commandCalls=[],other={id:'112233445566',mode:3,brightness:80,power:true};
  const raw={deviceId:id,name:'Coordinator',mode:9,brightness:123,power:false,token:'private-session',
    sync:{version:2,role:1,leader:id,scene,key:'private-key'},firmware:{phase:0},
    colors:Array.from({length:47},()=>[1,10,20,30]),effectOptions:Array.from({length:47},()=>[50,80,0,40,50,60]),
    audio:{installed:true,gain:16,gate:12,scale:100,liveTuning:true,token:'private-audio'},
    rotation:{enabled:false,random:false,category:0,seconds:30,key:'private-rotation'},
    vuColors:[[0,255,0],[255,255,0],[255,0,0]],fountainColors:[[255,65,0],[0,230,130],[75,30,255]]};
  const lamp={identity:id,epoch:4,base:'ble:owned',raw,state:{supportsColor:true,capabilities:10},supportsOfflineControl:ble,
    catalog:[{id:9,name:'Rain',category:'calm',speed:true,token:'private-catalog'},{id:41,name:'VU Meter',category:'audio',speed:true},{id:33,name:'Future local',category:'other',speed:false}],
    async enqueue(action){return action();},
    async command(action,value,responseCharacteristic,beforeWrite){
      commandCalls.push({action,value});if(this.beforeCommand)await this.beforeCommand(action,value);
      beforeWrite?.();writes.push({action,value});
      if(action==='power')raw.power=Boolean(value);
      if(action==='brightness')raw.brightness=value;
      if(action==='effect')raw.mode=value;
      if(action==='color')raw.colors[value.mode-1]=[1,value.r,value.g,value.b];
      if(action==='resetColor')raw.colors[value-1]=[0,255,255,255];
      if(action==='effectOptions')raw.effectOptions[value.mode-1]=[value.speed,value.intensity,value.dual,value.r,value.g,value.b];
    },
    async refresh(expected){reads.push(expected);if(this.beforeRefresh)await this.beforeRefresh();return raw;},
    async configureRotation(value){writes.push({action:'rotation',value});Object.assign(raw.rotation,value);},
    async tuneAudio(value){writes.push({action:'audio',value});Object.assign(raw.audio,value);},
    async configureVuColors(value){writes.push({action:'vuColors',value});if(value)raw.vuColors=value;},
    async configureFountainColors(value){writes.push({action:'fountainColors',value});if(value)raw.fountainColors=value;}}
  let editor={id,lamp,epoch:4,busy:false};
  const api={getEditor:()=>editor,run:async action=>action(lamp)};
  return {api,lamp,raw,writes,reads,commandCalls,other,editor:()=>editor,setEditor:value=>editor=value};
}

test('context requires exact coordinator identity, epoch and exclusive leader role, without secrets',()=>{
  const f=fixture(),context=coordinatorLightingContext(f.editor());
  assert.deepEqual(context.catalog.map(entry=>entry.id),[9,41,33]);
  assert(!JSON.stringify(context).includes('private'));
  for(const mutate of [current=>current.lamp.identity='112233445566',current=>current.lamp.epoch++,current=>current.raw.deviceId='112233445566',
    current=>current.raw.sync.role=0,current=>current.raw.sync.role=2,current=>current.raw.sync.leader='112233445566']) {
    const current=fixture();
    const before=coordinatorLightingContext(current.editor());assert(before);
    mutate(current);assert.equal(coordinatorLightingContext(current.editor()),null);
  }
});

test('power and brightness work for every group scene without touching a selected independent lamp',async()=>{
  for(const scene of [0,1,19,32]) {
    const f=fixture({scene}),other=structuredClone(f.other);
    await runGroupLighting(f.api,{action:'power',value:1});
    await runGroupLighting(f.api,{action:'brightness',value:222});
    assert.deepEqual(f.writes,[{action:'power',value:1},{action:'brightness',value:222}]);
    assert.deepEqual(f.reads,[id,id]);assert.deepEqual(f.other,other);assert.equal(f.raw.sync.scene,scene);
  }
});

test('Mirror selection uses the coordinator catalog’s actual IDs and leaves power off',async()=>{
  const f=fixture();await runGroupLighting(f.api,{action:'effect',value:41});
  assert.deepEqual(f.writes,[{action:'effect',value:41}]);assert.equal(f.raw.mode,41);assert.equal(f.raw.power,false);
  await assert.rejects(runGroupLighting(f.api,{action:'effect',value:1}),/unavailable/);assert.equal(f.writes.length,1);
});

test('custom palette, reset and options target the frozen mirrored mode with actual readback',async()=>{
  const f=fixture();await runGroupLighting(f.api,{action:'color',value:[200,2,50]});
  const options={speed:37,intensity:62,dual:1,r:11,g:22,b:33};
  await runGroupLighting(f.api,{action:'effectOptions',value:options});
  assert.deepEqual(f.writes[0],{action:'color',value:{mode:9,r:200,g:2,b:50}});
  assert.deepEqual(f.writes[1],{action:'effectOptions',value:{...options,mode:9}});
  await runGroupLighting(f.api,{action:'resetColor'});assert.deepEqual(f.writes[2],{action:'resetColor',value:9});
});

test('non-Mirror scenes reject all local effect, rotation and palette mutations',async()=>{
  const f=fixture({scene:32});
  for(const intent of [{action:'effect',value:41},{action:'color',value:[1,2,3]},{action:'resetColor'},
    {action:'effectOptions',value:{speed:50,intensity:80,dual:0,r:1,g:2,b:3}},
    {action:'rotation',value:{enabled:true,random:false,category:0,seconds:30}},{action:'saveDefaults'}])
    await assert.rejects(runGroupLighting(f.api,intent),/Mirror/);
  assert.deepEqual(f.writes,[]);
});

test('delayed preflight rejects replaced editors, locator, identity, role, scene or active mode before a write',async()=>{
  for(const change of [f=>f.setEditor({...f.editor()}),f=>f.lamp.base='ble:replacement',f=>f.lamp.epoch++,
    f=>f.raw.sync.role=2,f=>f.raw.sync.leader='112233445566',f=>f.raw.sync.scene=1,f=>f.raw.mode=41]) {
    const f=fixture();f.api.run=async action=>{change(f);return action(f.lamp);};
    await assert.rejects(runGroupLighting(f.api,{action:'color',value:[1,2,3]}),/changed|coordinator/);
    assert.deepEqual(f.writes,[]);
  }
});

test('caller-owned drafts are frozen before asynchronous preflight',async()=>{
  const f=fixture(),value=[1,2,3],intent={action:'color',value};f.api.run=async action=>{value[0]=255;intent.action='resetColor';return action(f.lamp);};
  await runGroupLighting(f.api,intent);
  assert.equal(f.writes[0].value.r,1);
  assert.equal(f.writes[0].action,'color');
});

test('a queued membership or scene change aborts inside the command before physical mutation',async()=>{
  for(const change of [f=>f.raw.sync.role=0,f=>f.raw.sync.scene=32,f=>f.raw.mode=41]) {
    const f=fixture();f.lamp.beforeCommand=()=>change(f);
    await assert.rejects(runGroupLighting(f.api,{action:'color',value:[1,2,3]}),/changed/);
    assert.equal(f.commandCalls.length,1);assert.deepEqual(f.writes,[]);
  }
  const f=fixture();f.lamp.enqueue=async action=>{f.raw.sync.role=0;return action();};
  await assert.rejects(runGroupLighting(f.api,{action:'rotation',value:{enabled:true,random:false,category:0,seconds:30}}),/changed/);
  assert.deepEqual(f.writes,[]);
});

test('unconfirmed commands and changed connection during readback never replay or report success',async()=>{
  const f=fixture();f.lamp.command=async(action,value)=>{f.writes.push({action,value});throw Object.assign(Error('Lost acknowledgment'),{uncertain:true});};
  await assert.rejects(runGroupLighting(f.api,{action:'power',value:1}),/Lost acknowledgment/);
  assert.equal(f.writes.length,1);assert.deepEqual(f.reads,[]);
  const changed=fixture();changed.lamp.beforeRefresh=()=>changed.lamp.epoch++;
  await assert.rejects(runGroupLighting(changed.api,{action:'brightness',value:200}),/changed/);assert.equal(changed.writes.length,1);
});

test('failure still propagates locally when main runner catches it, and cancellation does not claim success',async()=>{
  const f=fixture();f.api.run=async action=>{try{await action(f.lamp);}catch{}};
  f.lamp.beforeCommand=()=>{throw Error('Confirmed rejection');};
  await assert.rejects(runGroupLighting(f.api,{action:'power',value:1}),/Confirmed rejection/);
  f.api.run=async()=>{};await assert.rejects(runGroupLighting(f.api,{action:'power',value:1}),/cancelled/);
});

test('missing or mismatched option readback remains unconfirmed rather than silently succeeding',async()=>{
  for(const result of [null,[50,80,0,40,50,60]]) {
    const f=fixture();f.lamp.beforeRefresh=()=>f.raw.effectOptions[8]=result;
    await assert.rejects(runGroupLighting(f.api,{action:'effectOptions',value:{speed:10,intensity:10,dual:0,r:0,g:0,b:0}}),/confirm/);
    assert.equal(f.writes.length,1);
  }
});

test('supported live sound, three-color palettes and Mirror rotation remain coordinator-scoped',async()=>{
  const f=fixture();await runGroupLighting(f.api,{action:'rotation',value:{enabled:true,random:true,category:2,seconds:600}});
  f.raw.mode=41;await runGroupLighting(f.api,{action:'audio',value:{gain:22,gate:15,scale:160}});
  await runGroupLighting(f.api,{action:'vuColors',value:[[1,2,3],[4,5,6],[7,8,9]]});
  assert.deepEqual(f.writes.map(value=>value.action),['rotation','audio','vuColors']);
  assert.equal(f.raw.rotation.seconds,600);assert.equal(f.raw.audio.gain,22);assert.deepEqual(f.raw.vuColors[0],[1,2,3]);
});

test('updating, calibration, missing capability and invalid values block mutations',async()=>{
  for(const change of [f=>f.editor().busy=true,f=>f.raw.firmware.phase=3,f=>f.raw.calibration={active:true}]) {
    const f=fixture();change(f);await assert.rejects(runGroupLighting(f.api,{action:'power',value:1}),/available/);assert.equal(f.writes.length,0);
  }
  for(const intent of [{action:'power',value:2},{action:'brightness',value:0},{action:'color',value:[256,0,0]},
    {action:'effectOptions',value:{speed:0,intensity:101,dual:1,r:0,g:0,b:0}},{action:'unknown'}]) {
    const f=fixture();await assert.rejects(runGroupLighting(f.api,intent));assert.equal(f.writes.length,0);
  }
  const f=fixture();f.lamp.state.capabilities=0;
  await assert.rejects(runGroupLighting(f.api,{action:'effectOptions',value:{speed:50,intensity:80,dual:0,r:0,g:0,b:0}}),/valid/);
});

test('real Wi-Fi command queue completes outside runner preflight without nested enqueue or extra POST',async t=>{
  const raw={token:'fresh',deviceId:id,hostname:'coollamp-test.local',mode:1,brightness:100,power:false,effects:['Rain'],apiVersion:1,
    sync:{version:2,role:1,leader:id,scene:0},colors:[[1,1,2,3]],effectOptions:[[50,80,0,4,5,6]]},writes=[];
  const http={async request(options){
    if(options.method==='POST'){writes.push(options);raw.brightness=Number(new URLSearchParams(options.data).get('brightness'));return {status:200,data:'Applied'};}
    return {status:200,data:JSON.stringify(raw)};
  }};
  const lamp=new WifiTransport(http);await lamp.connect('192.168.1.50','coollamp',id);clearTimeout(lamp.timer);t.after(()=>lamp.disconnect());
  const editor={id,lamp,epoch:lamp.epoch,busy:false};
  const run=async action=>{editor.busy=true;try{await lamp.enqueue(()=>lamp.refresh(id));return await action(lamp);}finally{editor.busy=false;}};
  let timeout;try{await Promise.race([runGroupLighting({getEditor:()=>editor,run},{action:'brightness',value:177}),new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Nested enqueue deadlocked')),300))]);}finally{clearTimeout(timeout);}
  assert.equal(writes.length,1);assert.equal(writes[0].url,'http://192.168.1.50/api/preview');assert.equal(raw.brightness,177);assert.equal(raw.power,false);
});

test('real Wi-Fi queued Leave overtakes group preflight but prevents the later lighting POST',async t=>{
  const raw={token:'fresh',deviceId:id,hostname:'coollamp-test.local',mode:1,brightness:100,power:false,effects:['Rain'],apiVersion:1,
    sync:{version:2,role:1,leader:id,scene:0},colors:[[1,1,2,3]],effectOptions:[[50,80,0,4,5,6]]},writes=[];
  let hold=false,entered,release;
  const started=new Promise(resolve=>entered=resolve);
  const http={async request(options){
    if(options.method==='POST'){
      writes.push(options.url);
      if(options.url.endsWith('/api/sync'))Object.assign(raw.sync,{role:0,leader:''});
      else raw.brightness=Number(new URLSearchParams(options.data).get('brightness'));
      return {status:200,data:'Applied'};
    }
    if(hold){hold=false;entered();await new Promise(resolve=>release=resolve);}
    return {status:200,data:JSON.stringify(raw)};
  }};
  const lamp=new WifiTransport(http);await lamp.connect('192.168.1.50','coollamp',id);clearTimeout(lamp.timer);t.after(()=>lamp.disconnect());
  const editor={id,lamp,epoch:lamp.epoch,busy:false};
  const run=async action=>{editor.busy=true;try{await lamp.enqueue(()=>lamp.refresh(id));return await action(lamp);}finally{editor.busy=false;}};
  hold=true;const pending=runGroupLighting({getEditor:()=>editor,run},{action:'brightness',value:177});await started;
  const leave=lamp.enqueue(()=>lamp.configureSync(0));release();
  await assert.rejects(pending,/group changed/i);await leave;
  assert.deepEqual(writes,['http://192.168.1.50/api/sync']);assert.equal(raw.brightness,100);assert.equal(raw.sync.role,0);
});

class Element {
  constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.value='';this.checked=false;this.attributes={};this.classList={add(){}};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(name,value){this.attributes[name]=String(value);}
}
const document={createElement(tag){return new Element(tag,this);}};

test('component preserves DOM and drafts across polling; grouped scene hides local controls and close clears drafts',()=>{
  const f=fixture(),root=new Element('section',document),ui=new GroupLightingUi({root,...f.api});ui.render();
  const field=ui.fields.brightness,effect=ui.fields.effect;assert.equal(effect.children.length,3);assert.equal(field.value,'123');assert.equal(root.hidden,false);
  assert.equal(effect.attributes['aria-label'],'Coordinator effect');assert.equal(field.attributes['aria-label'],'Group brightness');
  assert.equal(ui.mirror.tagName,'DETAILS');assert.equal(ui.mirror.open,false);assert.equal(ui.mirror.children[0].textContent,'Mirror effect, colors & sound');
  ui.mirror.open=true;
  field.value='211';field.oninput();f.raw.brightness=88;ui.render();assert.equal(ui.fields.brightness,field);assert.equal(field.value,'211');
  assert.equal(ui.mirror.open,true);
  f.raw.sync.scene=32;ui.render();assert.equal(ui.mirror.hidden,true);assert.equal(ui.controls.disabled,false);
  f.raw.sync.role=2;ui.render();assert.equal(root.hidden,true);
  f.raw.sync.role=1;f.raw.sync.scene=0;ui.render();assert.equal(field.value,'88');assert.equal(ui.mirror.hidden,false);assert.equal(ui.mirror.open,false);
});

test('component suppresses repeated clicks and never puts old results into a replacement editor',async()=>{
  const f=fixture(),root=new Element('section',document),ui=new GroupLightingUi({root,...f.api});ui.render();let release;
  f.lamp.beforeCommand=()=>new Promise(resolve=>release=resolve);
  const pending=ui.act({action:'power',value:1});await Promise.resolve();await ui.act({action:'power',value:1});assert.equal(f.commandCalls.length,1);
  f.setEditor({...f.editor()});release();await pending;assert(!ui.feedback.textContent.includes('updated'));assert.equal(ui.pending,false);
});

test('applying power, color or a new mirrored effect preserves unrelated brightness and rotation drafts',async()=>{
  const f=fixture(),root=new Element('section',document),ui=new GroupLightingUi({root,...f.api});ui.render();
  ui.fields.brightness.value='211';ui.fields.brightness.oninput();ui.fields.rotationSeconds.value='600';ui.fields.rotationSeconds.oninput();
  ui.fields.primary.value='#112233';ui.fields.primary.oninput();
  await ui.act({action:'power',value:1});assert.equal(ui.fields.brightness.value,'211');assert.equal(ui.fields.rotationSeconds.value,'600');assert.equal(ui.fields.primary.value,'#112233');
  await ui.act({action:'color',value:[17,34,51]});assert.equal(ui.fields.brightness.value,'211');assert.equal(ui.fields.rotationSeconds.value,'600');assert(!ui.dirty.has('primary'));
  await ui.act({action:'effect',value:41});assert.equal(ui.fields.brightness.value,'211');assert.equal(ui.fields.rotationSeconds.value,'600');
  await ui.act({action:'brightness',value:211});assert(!ui.dirty.has('brightness'));assert(ui.dirty.has('rotationSeconds'));
});
