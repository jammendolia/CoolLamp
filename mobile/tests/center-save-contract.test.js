import test from 'node:test';
import assert from 'node:assert/strict';
import {WifiTransport} from '../src/wifi.js';

const id='aabbccddeeff',other='112233445566';
async function fixture(t,{accept=true,lost=false,postStatus=200,readStatus=200}={}) {
  const raw={deviceId:id,hostname:'coollamp-test.local',token:'test-token',mode:1,brightness:55,power:true,effects:['Rain'],
    leds:205,midpoint:102,effectiveMidpoint:102,motionVersion:1,motionPath:1,startupMode:4,startupBrightness:80,
    calibration:{active:true,kind:'center',position:46,centerSupported:true},
    sync:{version:3,role:2,leader:other,paused:true},colors:[[1,12,34,56]],effectOptions:[[50,85,1,90,80,70]]};
  const calls=[];let onRead,onPost;
  const lamp=new WifiTransport({request:async request=>{
    calls.push(request);
    if(request.method==='POST') {
      const form=new URLSearchParams(request.data);
      if(accept&&(postStatus===200||postStatus>=500)) {
        raw.midpoint=form.has('midpoint')?Number(form.get('midpoint')):raw.calibration.position;
        raw.effectiveMidpoint=raw.midpoint||Math.ceil(raw.leds/2);
        if(form.get('action')==='save')raw.calibration.active=false;
      }
      await onPost?.();
      if(lost)throw Error('Reply lost');
      return {status:postStatus,data:postStatus===200?'Center saved.':'Could not save center.'};
    }
    await onRead?.();
    return {status:calls.some(call=>call.method==='POST')?readStatus:200,data:JSON.stringify(raw)};
  }});
  await lamp.connect('192.168.1.9','test-password',id);clearTimeout(lamp.timer);calls.length=0;
  t.after(()=>lamp.disconnect());
  return {lamp,raw,calls,onRead:callback=>onRead=callback,onPost:callback=>onPost=callback};
}
const posts=calls=>calls.filter(call=>call.method==='POST');

test('numeric center save checks exact boundary and count, preserving whole-strip choice and individual settings',async t=>{
  for(const center of [0,1,46,204]) {
    const {lamp,raw,calls}=await fixture(t);const before=structuredClone(raw);
    assert.equal(await lamp.enqueue(()=>lamp.configureGeometry(center)),'Center saved.');
    assert.deepEqual(calls.map(call=>call.method),['GET','POST','GET']);
    assert.equal(posts(calls)[0].data,'midpoint='+center);
    assert.equal(lamp.raw.midpoint,center);assert.equal(lamp.raw.leds,205);
    for(const field of ['motionPath','mode','brightness','power','startupMode','startupBrightness','sync','colors','effectOptions'])
      assert.deepEqual(raw[field],before[field]);
  }
});

for(const method of ['numeric','marker']) {
  const save=lamp=>method==='numeric'?lamp.configureGeometry(46):lamp.calibrateCenter('save');
  test(method+' lost reply or ambiguous storage failure reconciles one exact save without replay',async t=>{
    for(const fault of [{lost:true},{postStatus:500}]) {
      const {lamp,calls}=await fixture(t,fault);
      assert.match(await save(lamp),/saved and checked/i);
      assert.equal(posts(calls).length,1);
      assert.equal(calls.filter(call=>call.method==='GET').length,method==='numeric'?2:1);
    }
  });
  test(method+' rejected, conflicting or unavailable readback never reports a saved center',async t=>{
    for(const fault of [{accept:false},{accept:false,lost:true},{accept:false,postStatus:500},
      ...[400,401,409,503].map(readStatus=>({readStatus}))]) {
      const {lamp,calls}=await fixture(t,fault);
      await assert.rejects(save(lamp),error=>error.uncertain===true&&error.confirmed===false&&/confirm your new center/.test(error.message));
      assert.equal(posts(calls).length,1);
    }
  });
  test(method+' same-target count or boundary changes during the save remain unconfirmed',async t=>{
    for(const change of [raw=>raw.leds=204,raw=>raw.midpoint=47,raw=>raw.midpoint=null,
      raw=>raw.midpoint=-1,raw=>raw.midpoint=raw.leds]) {
      const {lamp,raw,calls,onPost}=await fixture(t);onPost(()=>change(raw));
      await assert.rejects(save(lamp),error=>error.uncertain===true&&/confirm your new center/.test(error.message));
      assert.equal(posts(calls).length,1);
    }
  });
  test(method+' identity, route or session changes after submission do not authorize another save',async t=>{
    for(const change of [(lamp,raw)=>raw.deviceId=other,lamp=>lamp.disconnect(),lamp=>lamp.base='http://192.168.1.10']) {
      const {lamp,raw,calls,onPost}=await fixture(t);onPost(()=>change(lamp,raw));
      await assert.rejects(save(lamp),error=>error.uncertain===true&&error.confirmed===false);
      assert.equal(posts(calls).length,1);
    }
  });
  test(method+' confirmed pre-execution refusal remains a refusal, without a replay or reconciliation read',async t=>{
    for(const postStatus of [400,401,409,503]) {
      const {lamp,calls}=await fixture(t,{postStatus,accept:false});
      await assert.rejects(save(lamp),error=>error.confirmed===true&&error.status===postStatus&&!error.uncertain);
      assert.equal(posts(calls).length,1);
      assert.equal(calls.filter(call=>call.method==='GET').length,method==='numeric'?1:0);
    }
  });
}

test('numeric preparation cancels before saving if strip size or target changed',async t=>{
  for(const change of [(lamp,raw)=>raw.leds=204,(lamp,raw)=>raw.deviceId=other,lamp=>lamp.base='http://192.168.1.10']) {
    const {lamp,raw,calls,onRead}=await fixture(t);onRead(()=>change(lamp,raw));
    await assert.rejects(lamp.configureGeometry(46));assert.equal(posts(calls).length,0);
  }
});

test('marker save sends immediately before one readback rather than consuming its inactivity window with a preflight snapshot',async t=>{
  const {lamp,calls}=await fixture(t);
  assert.equal(await lamp.calibrateCenter('save'),'Center saved.');
  assert.deepEqual(calls.map(call=>call.method),['POST','GET']);
  assert.equal(posts(calls)[0].data,'action=save&kind=center');
  assert.equal(lamp.raw.midpoint,46);assert.equal(lamp.raw.calibration.active,false);
});

test('marker save requires the tool to have ended at the exact expected boundary',async t=>{
  const {lamp,raw,calls,onPost}=await fixture(t);onPost(()=>raw.calibration.active=true);
  await assert.rejects(lamp.calibrateCenter('save'),error=>error.uncertain===true);
  assert.equal(posts(calls).length,1);
});

test('ended tools, wrong kinds and invalid positions cannot claim to save a center',async t=>{
  for(const change of [raw=>raw.calibration.active=false,raw=>raw.calibration.kind='leds',
    raw=>raw.calibration.position=0,raw=>raw.calibration.position=205,raw=>raw.calibration.position=1.5,
    raw=>raw.leds=1025]) {
    const {lamp,raw,calls}=await fixture(t);change(lamp.raw);
    await assert.rejects(lamp.calibrateCenter('save'));assert.equal(calls.length,0);
  }
});

test('invalid boundaries and unverified identity cannot submit a geometry change',async t=>{
  const {lamp,calls}=await fixture(t);
  for(const value of [-1,205,1.5,'46',NaN])await assert.rejects(lamp.configureGeometry(value));
  assert.equal(calls.length,0);lamp.identity='friendly-name';await assert.rejects(lamp.configureGeometry(46));assert.equal(calls.length,0);
});
