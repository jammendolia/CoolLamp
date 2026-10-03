import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WifiTransport} from '../src/wifi.js';
function fixture(){
 const lamp=new WifiTransport({}),calls=[];let refreshes=0;
 lamp.raw={calibration:{active:false,position:134},rotation:{},sync:{role:0,scene:0},audio:{installed:true}};
 lamp.request=async(path,data)=>{calls.push({path,data});return 'Saved';};lamp.refresh=async()=>{refreshes++;};
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
 await lamp.configureRotation(value);
 assert.deepEqual(calls[0],{path:'/api/rotation',data:{enabled:1,random:0,category:1,seconds:120}});
 for(const seconds of [0,4,86401,5.5,NaN])await assert.rejects(()=>lamp.configureRotation({...value,seconds}));
 lamp.raw.sync.role=2;await assert.rejects(()=>lamp.configureRotation(value));
 await lamp.configureRotation({...value,enabled:false});
 lamp.raw.sync.role=1;lamp.raw.sync.scene=2;await assert.rejects(()=>lamp.configureRotation(value));
 lamp.raw.sync.scene=0;lamp.raw.audio.installed=false;await assert.rejects(()=>lamp.configureRotation({...value,category:2}));
 await lamp.configureRotation(value);
});
