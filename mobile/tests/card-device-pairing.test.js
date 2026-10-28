import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('async function pairCardBluetooth('),end=source.indexOf('function completeCardSettings(',start);
assert(start>=0&&end>start);const handlers=source.slice(start,end);
const id='aabbccddeeff';
function fixture({knownBridge=false,role,name='Desk lamp',owner=false}={}){
 const calls=[],nodes=[];const entry={id,name,...(role?{role}:{})};
 const document={body:{append:node=>calls.push(['dialog',node])},createElement(tag){
  const value={tagName:tag,children:[],append(...children){this.children.push(...children);},addEventListener(type,callback){this[type]=callback;},showModal(){calls.push(['modal']);},remove(){calls.push(['remove']);}};
  nodes.push(value);return value;
 }};
 const context={document,entry,bridgeAccessories:{has:target=>knownBridge&&target===id},
  page:name=>calls.push(['page',name]),status:message=>calls.push(['status',message]),
  bluetoothFirmwareOwner:()=>owner?{id:'other'}:null,firmwareConnectionSelectionAllowed:()=>false,firmwareConnectionNotice:()=>calls.push(['updater']),
  fleetLampInstalling:()=>false,mergedLampEntries:()=>[entry],verifiedSelectedLamp:()=>false,
  connect:async(value,options)=>{calls.push(['connect',value,options]);return {connected:true,id};}};
 runInNewContext(`let busy=false,connecting=false,wifiSettingsTarget=null,lamp={},bleLamp={},selected=null,navigationSerial=1;
 ${handlers}
 globalThis.ui={pair:()=>pairCardBluetooth(entry),connect:()=>connectCardBluetooth(entry,{forCardSettings:true,readOnlyReconnect:true})};`,context);
 return {...context.ui,calls,nodes,entry,choose(value){const dialog=nodes.find(node=>node.tagName==='dialog');assert(dialog);dialog.returnValue=value;dialog.close();}};
}

for(const kind of ['stored','advertised'])test(kind+' bridge opens Bridges without a lamp pairing prompt',async()=>{
 const f=fixture(kind==='stored'?{knownBridge:true}:{role:'bridge'});assert.equal(await f.pair(),false);await f.connect();
 assert.equal(f.nodes.length,0);assert.equal(f.calls.filter(call=>call[0]==='page'&&call[1]==='bridges').length,2);
 assert(!f.calls.some(call=>call[0]==='connect'));assert(f.calls.some(call=>call[0]==='status'&&/no lamp knob/.test(call[1])));
});

test('a lamp named CoolLamp Bridge is not classified by its name; dialog offers an explicit bridge exit',async()=>{
 const f=fixture({name:'CoolLamp Bridge'}),run=f.connect();
 assert.equal(f.nodes.find(node=>node.tagName==='h2').textContent,'Connect CoolLamp Bridge');
 assert.match(f.nodes.find(node=>node.tagName==='p').textContent,/For a lamp/);
 assert.match(f.nodes.find(node=>node.tagName==='p').textContent,/Bridges use Wi-Fi and have no lamp knob/);
 assert.deepEqual(f.nodes.filter(node=>node.tagName==='button').map(node=>node.textContent),['Cancel','Open bridges','Choose a lamp']);
 f.choose('bridge');await run;assert(f.calls.some(call=>call[0]==='page'&&call[1]==='bridges'));assert(!f.calls.some(call=>call[0]==='connect'));
});

test('ordinary lamp pairing still requires canonical target verification and keeps read-only reconnect',async()=>{
 const f=fixture(),run=f.connect();f.choose('pair');await run;
 const connects=f.calls.filter(call=>call[0]==='connect');assert.equal(connects.length,1);assert.equal(connects[0][2].expectedId,id);assert.equal(connects[0][2].readOnlyReconnect,true);assert.equal(connects[0][2].navigate,false);
});

test('Cancel never starts pairing or changes navigation',async()=>{
 const f=fixture(),run=f.connect();f.choose('cancel');await run;assert(!f.calls.some(call=>call[0]==='connect'||call[0]==='page'));
});

test('bridge navigation cannot interrupt the existing Bluetooth updater owner',async()=>{
 const f=fixture({knownBridge:true,owner:true});await f.connect();assert.deepEqual(f.calls,[['updater']]);assert.equal(f.nodes.length,0);
});
