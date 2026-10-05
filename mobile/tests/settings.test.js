import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationPayload} from '../src/settings.js';
const raw={ssid:'Home',leds:134,milliamps:2400,mode:41,brightness:170,startupMode:22,startupBrightness:80};
const draft={ssid:'Guest',wifiPassword:'network-pass',adminPassword:'private-pass',openNetwork:false,forgetWifi:true,leds:'88',milliamps:'1200',startupMode:'30',startupBrightness:'100'};
test('network save preserves saved hardware and startup, not a hidden draft',()=>{
 assert.deepEqual(configurationPayload(raw,'network',draft),{ssid:'Guest',leds:134,milliamps:2400,mode:22,brightness:80,wifiPassword:'network-pass',adminPassword:'private-pass',openNetwork:0,forgetWifi:1});
});
test('hardware save preserves saved network and omits draft credentials and forget flags',()=>{
 assert.deepEqual(configurationPayload(raw,'hardware',draft),{ssid:'Home',leds:'88',milliamps:'1200',mode:'30',brightness:'100'});
});
test('older lamps without startup telemetry use their current effect and brightness',()=>{
 const value=configurationPayload({ssid:'',leds:10,milliamps:500,mode:1,brightness:1},'network',{ssid:'',wifiPassword:'',adminPassword:'',openNetwork:true,forgetWifi:false});
 assert.equal(value.mode,1);assert.equal(value.brightness,1);assert.equal(value.openNetwork,1);
});
