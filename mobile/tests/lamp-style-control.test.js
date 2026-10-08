import test from 'node:test';
import assert from 'node:assert/strict';
import {WifiTransport} from '../src/wifi.js';
import {validateCatalog} from '../src/catalog.js';
import {recommendedEffects} from '../src/lamp-style.js';

const identity='aabbccddeeff';
const descriptor=code=>({version:1,code,id:['unspecified','helix','large-helix','corkscrew'][code],family:['unspecified','helix','helix','corkscrew'][code]});
async function fixture(t,{supported=true,accept=true,lost=false}={}) {
  const raw={token:'fresh-token',deviceId:identity,hostname:'coollamp-test.local',name:'Test',mode:1,brightness:100,power:true,effects:['Rain'],...(supported?{lampStyle:descriptor(1)}:{})};
  const calls=[];let read;
  const lamp=new WifiTransport({request:async options=>{
    calls.push(options);
    if(options.method==='POST'){
      if(accept)raw.lampStyle=descriptor(Number(new URLSearchParams(options.data).get('style')));
      if(lost)throw Error('Reply lost');
      return {status:200,data:'Design saved'};
    }
    if(read)await read();
    return {status:200,data:JSON.stringify(raw)};
  }});
  await lamp.connect('192.168.1.9','password',identity);clearTimeout(lamp.timer);calls.length=0;t.after(()=>lamp.disconnect());
  return {lamp,raw,calls,setRead:value=>read=value};
}
test('style save reads fresh identity/token, sends only design and confirms without lighting changes',async t=>{
  const {lamp,raw,calls}=await fixture(t);raw.token='restarted-token';
  await lamp.enqueue(()=>lamp.configureLampStyle('corkscrew'));
  assert.deepEqual(calls.map(call=>call.method),['GET','POST','GET']);
  const post=calls[1];assert.equal(post.url,'http://192.168.1.9/api/style');assert.equal(post.data,'style=3');assert.equal(post.headers['X-Lamp-Token'],'restarted-token');
  assert.deepEqual(lamp.raw.lampStyle,descriptor(3));assert.equal(raw.mode,1);assert.equal(raw.brightness,100);assert.equal(raw.power,true);
});
test('old firmware and invalid style never issue a style mutation',async t=>{
  const {lamp,calls}=await fixture(t,{supported:false});await assert.rejects(lamp.configureLampStyle('helix'),/1.10.1/);
  assert(calls.every(call=>call.method==='GET'));calls.length=0;await assert.rejects(lamp.configureLampStyle('lamp-name'),/valid/);assert.equal(calls.length,0);
});
test('disconnect or changed locator during fresh style read prevents POST',async t=>{
  for(const change of [lamp=>lamp.disconnect(),lamp=>{lamp.base='http://192.168.1.10';}]){
    const {lamp,calls,setRead}=await fixture(t);let release,ready;const waiting=new Promise(resolve=>ready=resolve);
    setRead(()=>{ready();return new Promise(resolve=>release=resolve);});const pending=lamp.configureLampStyle('large-helix');await waiting;await change(lamp);release();
    await assert.rejects(pending,/changed/i);assert(calls.every(call=>call.method==='GET'));
  }
});
test('uncertain accepted style save verifies once without replaying the POST',async t=>{
  const {lamp,calls}=await fixture(t,{lost:true});assert.equal(await lamp.configureLampStyle('corkscrew'),'Lamp design verified.');
  assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(lamp.raw.lampStyle.id,'corkscrew');
});
test('unconfirmed style save does not report success or replay',async t=>{
  for(const lost of [true,false]){
    const {lamp,calls}=await fixture(t,{lost,accept:false});await assert.rejects(lamp.configureLampStyle('large-helix'),lost?/respond/:/confirm/);
    assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(lamp.raw.lampStyle.id,'helix');
  }
});
test('declared catalog recommendations retain original wire IDs and omit untrusted metadata',()=>{
  const source=[{id:1,name:'Rain',category:'calm',speed:true,styles:['corkscrew'],secret:'private'},
    {id:2,name:'Rain',category:'calm',speed:true,styles:['future-style']},{id:3,name:'Split fire - rising',category:'calm',speed:true}];
  const catalog=validateCatalog(source,3);assert.deepEqual(catalog[0].styles,['corkscrew']);assert(!('secret' in catalog[0]));assert.equal(catalog[1].styles,null);
  assert.deepEqual(recommendedEffects(catalog,'corkscrew').map(entry=>entry.id),[1,3]);assert.deepEqual(recommendedEffects(catalog,'helix').map(entry=>entry.id),[3]);assert.equal(catalog[2].styles,undefined);
});
