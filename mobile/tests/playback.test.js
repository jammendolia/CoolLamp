import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WifiTransport} from '../src/wifi.js';
const identity='aabbccddeeff';
function fixture(){
 const lamp=new WifiTransport({}),calls=[];let refreshes=0;
 lamp.deviceIdentity=identity;lamp.identity=identity;lamp.base='http://lamp.local';lamp.epoch=1;
 lamp.raw={deviceId:identity,calibration:{active:false,position:134},rotation:{enabled:false,random:true,category:0,seconds:30},sync:{role:0,scene:0},audio:{installed:true}};
 lamp.request=async(path,data,epoch,beforeWrite)=>{beforeWrite?.();calls.push({path,data});
  if(path==='/api/rotation')Object.assign(lamp.raw.rotation,{enabled:Boolean(data.enabled),random:Boolean(data.random),category:data.category,seconds:data.seconds});
  return 'Saved';};
 lamp.refresh=async()=>{refreshes++;};
 return {lamp,calls,refreshes:()=>refreshes};
}
test('LED setup validates limits, supports above-current counts, and avoids reading during save reboot',async()=>{
 const {lamp,calls,refreshes}=fixture();
 await lamp.calibrateLeds('start');await lamp.calibrateLeds('move',1024);
 assert.deepEqual(calls[1],{path:'/api/calibration',data:{action:'move',position:1024}});
 for(const position of [0,1025,1.5,NaN])await assert.rejects(()=>lamp.calibrateLeds('move',position));
 await assert.rejects(()=>lamp.calibrateLeds('oops'));
 await lamp.calibrateLeds('save');assert.equal(refreshes(),2);
 lamp.raw.sync.role=1;await assert.rejects(()=>lamp.calibrateLeds('start'));
 lamp.raw={};await assert.rejects(()=>lamp.calibrateLeds('start'));
});
test('rotation validates intervals, serializes settings, and prevents independent follower clocks',async()=>{
 const {lamp,calls}=fixture();const value={enabled:true,random:false,category:1,seconds:120};
 assert.equal(await lamp.configureRotation(value),'Rotation saved and checked.');
 assert.deepEqual(calls[0],{path:'/api/rotation',data:{enabled:1,random:0,category:1,seconds:120}});
 for(const seconds of [0,4,86401,5.5,NaN])await assert.rejects(()=>lamp.configureRotation({...value,seconds}));
 lamp.raw.sync.role=2;await assert.rejects(()=>lamp.configureRotation(value));
 await lamp.configureRotation({...value,enabled:false});
 lamp.raw.sync.role=1;lamp.raw.sync.scene=2;await assert.rejects(()=>lamp.configureRotation(value));
 lamp.raw.sync.scene=0;lamp.raw.audio.installed=false;await assert.rejects(()=>lamp.configureRotation({...value,category:2}));
 await lamp.configureRotation(value);
});
test('rotation never replays a submitted write and reports uncertainty when readback disagrees',async()=>{
 const {lamp,calls,refreshes}=fixture(),value={enabled:true,random:false,category:1,seconds:120};
 lamp.request=async(path,data,epoch,beforeWrite)=>{beforeWrite?.();calls.push({path,data});throw Error('reply lost');};
 await assert.rejects(()=>lamp.configureRotation(value),error=>{
  assert.equal(error.uncertain,true);assert.equal(error.confirmed,false);
  assert.match(error.message,/could not confirm the rotation change/i);return true;
 });
 assert.equal(calls.length,1);assert.equal(refreshes(),2);assert.equal(lamp.raw.rotation.enabled,false);
});
test('rotation accepts a matching readback after a lost reply without replaying the write',async()=>{
 const {lamp,calls,refreshes}=fixture(),value={enabled:true,random:false,category:1,seconds:120};
 lamp.request=async(path,data,epoch,beforeWrite)=>{beforeWrite?.();calls.push({path,data});
  Object.assign(lamp.raw.rotation,value);throw Error('reply lost');};
 assert.equal(await lamp.configureRotation(value),'Rotation saved and checked.');
 assert.equal(calls.length,1);assert.equal(refreshes(),2);assert.equal(lamp.raw.rotation.enabled,true);
});
