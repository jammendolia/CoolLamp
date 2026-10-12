import test from 'node:test';
import assert from 'node:assert/strict';
import {LampTransport} from '../src/transport.js';
import {COMMAND,SERVICE,STATE} from '../src/protocol.js';

const identity='aabbccddeeff',other='112233445566',CENTER='7b610009-6e2b-4f3d-9a71-28e45c001001';
const data=bytes=>new DataView(Uint8Array.from(bytes).buffer);
const json=value=>data(new TextEncoder().encode(JSON.stringify(value)));

class CenterRadio {
  writes=[];reads=[];now=2000;touched=1000;expires=10000;saveCount=0;
  center={version:1,active:true,position:46,midpoint:102,leds:205};
  packet(sequence=0,result=0){return data([1,sequence,result,4,55,1,28,129,1,12,34,56]);}
  snapshot(){
    const current={...this.center};
    if(current.active&&this.now-this.touched>=this.expires)current.active=this.center.active=false;
    if(!current.active)current.position=current.midpoint||Math.ceil(current.leds/2);
    return current;
  }
  async write(id,service,char,frame) {
    assert.equal(id,'peripheral');assert.equal(service,SERVICE);assert.equal(char,COMMAND);
    const bytes=[...new Uint8Array(frame.buffer,frame.byteOffset,frame.byteLength)];this.writes.push(bytes);
    let result=0;
    if(bytes[2]===20) {
      if(bytes[3]===0){this.center.active=true;this.touched=this.now;}
      if(bytes[3]===1){++this.saveCount;if(this.saveRejected||!this.snapshot().active)result=2;
        else{this.center.midpoint=this.center.position;this.center.active=false;}}
      if(bytes[3]===2)this.center.active=false;
      if(bytes[3]===3)this.snapshot();
    } else if(bytes[2]===21) {
      const position=bytes[3]|bytes[4]<<8;
      if(!this.center.active||position>=this.center.leds)result=2;
      else{this.center.position=position;this.touched=this.now;}
    } else throw Error('The fast center path must not send control RPCs.');
    await this.onWrite?.(bytes);
    this.last=this.packet(bytes[1],result);
    if(!(this.dropSaveAck&&bytes[2]===20&&bytes[3]===1))this.lamp.receive(this.last);
  }
  async read(id,service,char) {
    assert.equal(id,'peripheral');assert.equal(service,SERVICE);this.reads.push(char);
    if(char===STATE)return this.last||this.packet();
    assert.equal(char,CENTER,'Only the tiny protected center status may be read.');
    if(this.failSavedStatus&&this.saveCount)throw Error('Response lost');
    let value=this.snapshot();if(this.onStatus)value=this.onStatus(value)||value;
    return json(value);
  }
  async disconnect(){this.lamp.disconnected();}
}

function fixture(t,{modern=true,legacyIdentity=true}={}) {
  const radio=new CenterRadio(),callbacks=[],lamp=new LampTransport(radio,{timeout:60,onState:(state,metadata)=>callbacks.push({state,metadata})});
  radio.lamp=lamp;lamp.id='peripheral';lamp.state={id:0,result:0,mode:4,brightness:55,power:true,effectCount:28,capabilities:129};
  lamp.deviceIdentity=legacyIdentity?identity:null;
  if(modern){lamp.control={capabilities:['control']};lamp.expectedDeviceIdentity=identity;
    lamp.raw={deviceId:identity,mode:4,brightness:55,power:true,leds:205,midpoint:102,effectiveMidpoint:102,motionPath:1,
      calibration:{active:true,kind:'center',position:100,centerSupported:true},startupMode:22,startupBrightness:80,
      sync:{version:3,role:2,leader:other,paused:true},audio:{installed:true,gain:8},colors:[[1,12,34,56]]};}
  t.after(()=>{clearTimeout(lamp.controlTimer);lamp.disconnected();});
  return {radio,lamp,callbacks};
}
const centerCommands=radio=>radio.writes.map(bytes=>bytes[2]===20?'control:'+bytes[3]:'move:'+(bytes[3]|bytes[4]<<8));
const fresh=callbacks=>callbacks.filter(row=>row.metadata?.freshCenter);

test('modern center start, move, status and cancel use protected small commands and preserve unrelated settings',async t=>{
  const {radio,lamp,callbacks}=fixture(t),before=structuredClone(lamp.raw);
  assert.equal((await lamp.calibrateCenter('start')).position,46);
  assert.equal((await lamp.calibrateCenter('move',184)).position,184);
  radio.now+=300;const touched=radio.touched;
  assert.equal((await lamp.calibrateCenter('status')).position,184);assert.equal(radio.touched,touched);
  assert.equal((await lamp.calibrateCenter('cancel')).active,false);
  assert.deepEqual(centerCommands(radio),['control:0','move:184','control:3','control:2']);
  assert(radio.reads.every(char=>char===CENTER));assert.equal(fresh(callbacks).length,4);
  assert(fresh(callbacks).every(row=>!row.metadata.freshControl&&!row.metadata.freshLight));
  for(const field of ['leds','motionPath','startupMode','startupBrightness','sync','audio','colors'])assert.deepEqual(lamp.raw[field],before[field]);
  assert.equal(lamp.raw.calibration.active,false);assert.equal(lamp.raw.midpoint,102);assert.equal(lamp.raw.effectiveMidpoint,102);
});

test('save reads current protected position, saves once and verifies the durable boundary without a settings snapshot',async t=>{
  const {radio,lamp,callbacks}=fixture(t);assert.equal(lamp.raw.calibration.position,100);
  const touched=radio.touched,value=await lamp.calibrateCenter('save');
  assert.deepEqual(centerCommands(radio),['control:3','control:1']);assert.equal(radio.saveCount,1);assert.equal(radio.touched,touched);
  assert.equal(value.midpoint,46);assert.equal(value.active,false);assert.equal(lamp.raw.midpoint,46);assert.equal(lamp.raw.effectiveMidpoint,46);
  assert.equal(lamp.raw.calibration.position,46);assert.equal(lamp.raw.calibration.active,false);
  assert.equal(fresh(callbacks).length,1);assert(radio.reads.every(char=>char===CENTER));
});

test('read-only status does not keep an abandoned physical center adjustment alive',async t=>{
  const {radio,lamp}=fixture(t);radio.now=radio.touched+9999;
  assert.equal((await lamp.calibrateCenter('status')).active,true);assert.equal(radio.touched,1000);
  ++radio.now;assert.equal((await lamp.calibrateCenter('status')).active,false);
  await assert.rejects(lamp.calibrateCenter('save'),error=>error.confirmed===true&&!error.uncertain&&/has ended/.test(error.message));
  assert.equal(radio.saveCount,0);assert.equal(lamp.raw.midpoint,102);
});

test('expired or malformed pre-save status never sends the save command',async t=>{
  for(const change of [value=>({...value,active:false}),value=>({...value,version:2}),value=>({...value,leds:204}),
    value=>({...value,midpoint:205}),value=>({...value,position:0}),value=>({...value,position:205}),value=>({...value,position:1.5})]) {
    const {radio,lamp,callbacks}=fixture(t);radio.onStatus=change;
    await assert.rejects(lamp.calibrateCenter('save'));assert.equal(radio.saveCount,0);assert.equal(fresh(callbacks).length,0);
    assert.deepEqual(centerCommands(radio),['control:3']);
  }
});

test('malformed, conflicting or changed final center status stays uncertain and is never replayed',async t=>{
  for(const change of [value=>({...value,active:true}),value=>({...value,midpoint:47}),value=>({...value,position:47}),
    value=>({...value,leds:204}),value=>({...value,version:2}),value=>({...value,midpoint:null})]) {
    const {radio,lamp,callbacks}=fixture(t);radio.onStatus=value=>radio.saveCount?change(value):value;
    await assert.rejects(lamp.calibrateCenter('save'),error=>error.uncertain===true&&error.confirmed===false&&/confirm your new center/.test(error.message));
    assert.equal(radio.saveCount,1);assert.deepEqual(centerCommands(radio),['control:3','control:1']);
    assert.equal(fresh(callbacks).length,0);assert.equal(lamp.raw.midpoint,102);
  }
});

test('a failed durable save or lost final response cannot produce a saved-center message',async t=>{
  for(const fault of ['saveRejected','failSavedStatus']) {
    const {radio,lamp,callbacks}=fixture(t);radio[fault]=true;
    await assert.rejects(lamp.calibrateCenter('save'),error=>error.uncertain===true&&error.confirmed===false);
    assert.equal(radio.saveCount,1);assert.deepEqual(centerCommands(radio),['control:3','control:1']);
    assert.equal(fresh(callbacks).length,0);
  }
});

test('a lost notification reads only the matching cached acknowledgment and never repeats save',async t=>{
  const {radio,lamp}=fixture(t);radio.dropSaveAck=true;
  assert.equal((await lamp.calibrateCenter('save')).midpoint,46);
  assert.equal(radio.saveCount,1);assert.deepEqual(centerCommands(radio),['control:3','control:1']);assert(radio.reads.includes(STATE));
});

test('target, native peripheral and session fences cancel queued center work before radio writes',async t=>{
  for(const change of [lamp=>lamp.deviceIdentity=other,lamp=>lamp.id='other-peripheral',lamp=>lamp.epoch++,lamp=>lamp.raw.deviceId=other]) {
    const {radio,lamp}=fixture(t);let release;lamp.tail=new Promise(resolve=>release=resolve);
    const pending=lamp.calibrateCenter('status');change(lamp);release();await assert.rejects(pending);assert.equal(radio.writes.length,0);
  }
});

test('a changed target or session after save starts remains uncertain with no further commands',async t=>{
  for(const change of [lamp=>lamp.deviceIdentity=other,lamp=>lamp.id='other-peripheral',lamp=>lamp.epoch++,lamp=>lamp.raw.deviceId=other]) {
    const {radio,lamp,callbacks}=fixture(t);radio.onWrite=bytes=>{if(bytes[2]===20&&bytes[3]===1)change(lamp);};
    await assert.rejects(lamp.calibrateCenter('save'),error=>error.uncertain===true&&error.confirmed===false);
    assert.equal(radio.saveCount,1);assert.equal(fresh(callbacks).length,0);
    assert.deepEqual(centerCommands(radio),['control:3','control:1']);
  }
});

test('background guards fence the status response before cache adoption',async t=>{
  const {radio,lamp,callbacks}=fixture(t);let current=true;
  radio.onStatus=value=>{current=false;return value;};
  await assert.rejects(lamp.calibrateCenter('status',undefined,()=>{if(!current)throw Error('Read stopped');}));
  assert.equal(fresh(callbacks).length,0);assert.equal(lamp.raw.calibration.position,100);assert.equal(radio.saveCount,0);
});

test('modern identity and advertised center support are required without weakening legacy compatibility',async t=>{
  const modern=fixture(t);modern.lamp.deviceIdentity=null;
  await assert.rejects(modern.lamp.calibrateCenter('status'));assert.equal(modern.radio.writes.length,0);
  const unsupported=fixture(t);unsupported.lamp.state.capabilities=1;
  await assert.rejects(unsupported.lamp.calibrateCenter('start'),/1.9.1/);assert.equal(unsupported.radio.writes.length,0);
  const legacy=fixture(t,{modern:false,legacyIdentity:false});
  await legacy.lamp.calibrateCenter('move',184);const value=await legacy.lamp.calibrateCenter('save');
  assert.equal(value.midpoint,184);assert.equal(value.active,false);assert.equal(legacy.radio.saveCount,1);assert.equal(legacy.lamp.raw,null);
});

test('unknown actions and invalid active single-pixel status fail before saving',async t=>{
  const {radio,lamp}=fixture(t);
  for(const action of ['invalid','constructor','toString',null])await assert.rejects(lamp.calibrateCenter(action));
  assert.equal(radio.writes.length,0);
  lamp.raw.leds=radio.center.leds=1;radio.center.position=1;radio.center.midpoint=0;
  await assert.rejects(lamp.calibrateCenter('save'),/Invalid center/);assert.equal(radio.saveCount,0);
});

test('one-pixel status and extreme odd/count boundaries validate without inventing a center',async t=>{
  const {radio,lamp}=fixture(t);lamp.raw.leds=radio.center.leds=1;radio.center.midpoint=0;radio.center.active=false;radio.center.position=1;
  assert.equal((await lamp.calibrateCenter('status')).position,1);assert.equal(lamp.raw.effectiveMidpoint,1);
  await assert.rejects(lamp.calibrateCenter('save'));assert.equal(radio.saveCount,0);
  lamp.raw.leds=radio.center.leds=1024;radio.center.active=true;radio.center.position=1023;radio.center.midpoint=0;
  assert.equal((await lamp.calibrateCenter('save')).midpoint,1023);
});
