import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {WifiSettingsSummary,renderSavedWifi,wifiSettingsSignal} from '../src/wifi-settings-summary.js';
import {LampConnectivity} from '../src/lamp-connectivity.js';
import {wifiSetupMessage} from '../src/wifi-setup.js';
import {configurationPayload} from '../src/settings.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),id='aabbccddeeff',other='112233445566';
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const turns=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function extract(start,end){const first=source.indexOf(start),last=source.indexOf(end,first+start.length);assert(first>=0&&last>first);return source.slice(first,last);}
const rendering=extract('function renderWifiSettings(','\nasync function networkAction(');
const network=extract('async function networkAction(','\nfunction retireStyleActivity(');
const bluetooth=extract('async function bluetoothNetworkAction(','\nasync function handoffBluetoothWifi(');
const forms=extract("for(const [id,section] of [['networkForm','network'],['hardwareForm','hardware']])","\n$('geometryForm').onsubmit=");
const networkButtons=extract('  const bleNetwork=bluetoothWifiAvailable();',"\n  $('saveIdentity').disabled=");

function fixture({ssid='Home network',ble=true,wifiGate,configGate,wifi={connected:true,rssi:-50}}={}){
 const elements=new Map(),messages=[],writes=[],focus=[];let now=1000;
 const $=key=>{if(!elements.has(key))elements.set(key,{value:'',checked:false,textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},attributes:{},setAttribute(name,value){this.attributes[name]=value;},focus(){focus.push(key);}});return elements.get(key);};
 const original={identity:id,deviceIdentity:id,epoch:4,raw:{deviceId:id,ssid,leds:184,milliamps:500,startupMode:4,startupBrightness:100},
  enqueue:action=>Promise.resolve().then(action),
  async configureWifi(name,password,open,options){writes.push({kind:'wifi',name,password,open});this.wifiOptions=options;if(wifiGate)return wifiGate.promise;return {deviceId:id,phase:4,error:0,connected:true,ssid:name};},
  async request(path,data){writes.push({kind:'config',path,data});if(configGate)return configGate.promise;return 'Settings saved.';},
  async disconnect(){this.epoch++;}
 };
 const replacement={...original,identity:other,deviceIdentity:other,epoch:8,raw:{...original.raw,deviceId:other,ssid:'Other network'}};
 const entries=[{id,address:'192.168.1.20'},{id:other,address:'192.168.1.21'}];
 const connectivity=new LampConnectivity({getLamps:()=>entries,now:()=>now});if(wifi)connectivity.observe(id,{deviceId:id,wifi});
 const context={console,Promise,AbortController,TextEncoder,$,original,replacement,WifiSettingsSummary,renderSavedWifi,wifiSetupMessage,configurationPayload,connectivity,Date:{now:()=>now},writes,messages,
  updatingLamp:()=>false,renderPower(){},renderOptions(){},hideWifiPassword(){},status:message=>messages.push(message),confirm:()=>true,
  credential:async()=>{},handoffBluetoothWifi:async()=>messages.push('handoff'),
  observeLampWifi:(target,wifi)=>connectivity.observe(target,{deviceId:target,wifi:typeof wifi==='boolean'?{connected:wifi}:wifi})};
 runInNewContext(`
  let lamp=original,selected={id:'${id}'},state={power:true},busy=false,connecting=false,navigationSerial=0,settingsView='network';
  const bleLamp=${ble?'original':'{}'},wifiLamp=${ble?'{}':'original'},wifiSettingsSummary=new WifiSettingsSummary();
  let bleWifiStatus=null,wifiSetupAbort=null,wifiSetupSerial=0,wifiHandoff=null,wifiScanning=false;
  const verifiedSelectedLamp=()=>Boolean(state&&lamp.identity===selected?.id);
  const advancedAvailable=()=>Boolean(state&&lamp.raw),bluetoothWifiAvailable=()=>lamp===bleLamp&&Boolean(state);
  function renderSettings(){${networkButtons}}
  ${rendering}
  ${network}
  ${bluetooth}
  ${forms}
  $('ssid').value=original.raw.ssid;renderSettings();
  globalThis.ui={
   render:renderSettings,reconfigure:()=>$('reconfigureWifi').onclick(),cancel:()=>$('cancelWifiEdit').onclick(),
   save:()=>$('networkForm').onsubmit({preventDefault(){}}),security:()=>$('wifiSecurityControls').onsubmit({preventDefault(){}}),
   progress:value=>original.wifiOptions.onProgress(value),setStatus:value=>{bleWifiStatus=value;renderSettings();},
   change:()=>{lamp=replacement;selected={id:'${other}'};renderSettings();},navigate:()=>{navigationSerial++;},
   scope:()=>wifiSettingsSummary.scope(),summary:()=>({name:wifiSettingsSummary.name,editing:wifiSettingsSummary.editing}),
   snapshot:()=>({busy,serial:wifiSetupSerial})
  };`,context);
 return {...context.ui,$,elements,messages,writes,original,connectivity,focus,advance:ms=>{now+=ms;context.ui.render();}};
}

test('production DOM renderer hides saved credentials and shows the verified saved name and fresh signal',()=>{
 const f=fixture();assert.equal(f.$('wifiNetworkEditor').hidden,true);assert.equal(f.$('savedWifiSummary').hidden,false);assert.equal(f.$('savedWifiName').textContent,'Home network');
 assert.equal(f.$('savedWifiSignal').dataset.arcs,'3');assert.match(f.$('savedWifiConnection').textContent,/Strong signal/);assert.equal(f.$('wifiSecurityControls').hidden,false);
 assert.equal(f.$('reconfigureWifi').hidden,false);assert.equal(f.$('cancelWifiEdit').hidden,true);
});

test('real Reconfigure and Keep current Wi-Fi handlers reveal the editor and discard only its draft',()=>{
 const f=fixture();f.reconfigure();assert.equal(f.$('wifiNetworkEditor').hidden,false);assert.equal(f.$('ssid').value,'Home network');assert.deepEqual(f.focus,['ssid']);
 f.$('ssid').value='Draft network';f.$('wifiPassword').value='test-only-password';f.cancel();assert.equal(f.$('wifiNetworkEditor').hidden,true);assert.equal(f.$('ssid').value,'Home network');assert.equal(f.$('wifiPassword').value,'');assert.equal(f.writes.length,0);
});

test('an unconfigured lamp starts with the credential editor and no invented network or signal',()=>{
 const f=fixture({ssid:'',wifi:null});assert.equal(f.$('savedWifiSummary').hidden,true);assert.equal(f.$('wifiNetworkEditor').hidden,false);assert.equal(f.$('cancelWifiEdit').hidden,true);assert.equal(f.$('savedWifiSignal').dataset.arcs,'0');
});

test('unknown, malformed and expired strength never display active arcs',()=>{
 const f=fixture({wifi:{connected:true}});assert.equal(f.$('savedWifiSignal').dataset.arcs,'0');assert.match(f.$('savedWifiConnection').textContent,/strength unknown/);assert.match(f.$('savedWifiSignal').innerHTML,/wifi-question/);
 const fresh=fixture();fresh.advance(30001);assert.equal(fresh.$('savedWifiSignal').dataset.arcs,'0');assert.equal(fresh.$('savedWifiConnection').textContent,'Connection status unknown');
 for(const rssi of [0,Infinity,'-30',-200])assert.equal(wifiSettingsSignal({fresh:true,state:'connected',strengthKnown:true,rssi}).arcs,0);
});

test('disconnected saved Wi-Fi remains named and uses the existing disconnected icon',()=>{
 const f=fixture({wifi:{connected:false}});assert.equal(f.$('savedWifiName').textContent,'Home network');assert.equal(f.$('wifiNetworkEditor').hidden,true);assert.match(f.$('savedWifiSignal').innerHTML,/wifi-slash/);assert.match(f.$('savedWifiConnection').textContent,/Not connected/);
});

test('a network name is text content and cannot create markup',()=>{
 const name='<img src=x onerror=alert(1)>',f=fixture({ssid:name});assert.equal(f.$('savedWifiName').textContent,name);assert.equal(f.$('savedWifiName').innerHTML,'');assert.doesNotMatch(f.$('savedWifiSignal').innerHTML,/img|onerror/);
});

test('candidate and failed-save Bluetooth snapshots never replace the saved network',()=>{
 const f=fixture();for(const value of [{phase:3,error:0,connected:true},{phase:5,error:3,connected:true}]){f.setStatus({...value,deviceId:id,ssid:'Candidate'});assert.equal(f.$('savedWifiName').textContent,'Home network');}
 const empty=fixture({ssid:''});empty.setStatus({deviceId:id,phase:3,error:0,connected:true,ssid:'Candidate'});assert.equal(empty.$('savedWifiSummary').hidden,true);
});

test('protected Bluetooth saved status works when the older full snapshot has no SSID',()=>{
 const f=fixture({ssid:''});f.setStatus({deviceId:id,phase:0,error:0,connected:true,ssid:'Protected network'});assert.equal(f.$('savedWifiName').textContent,'Protected network');assert.equal(f.$('wifiNetworkEditor').hidden,true);
 f.reconfigure();f.setStatus({deviceId:id,phase:3,error:0,connected:false,ssid:'Candidate'});assert.equal(f.$('savedWifiName').textContent,'Protected network');assert.equal(f.$('wifiNetworkEditor').hidden,false);
 const wrong=fixture({ssid:''});wrong.setStatus({deviceId:other,phase:4,error:0,connected:true,ssid:'Wrong lamp network'});assert.equal(wrong.$('savedWifiSummary').hidden,true);
});

test('production submit keeps the old network during a join, closes only after durable save and ignores duplicate taps',async()=>{
 const gate=deferred(),f=fixture({wifiGate:gate});f.reconfigure();f.$('ssid').value='New network';f.$('wifiPassword').value='test-only-password';const pending=f.save();await turns();
 assert.equal(f.$('wifiSetupFeedback').dataset.state,'working');assert.equal(f.snapshot().busy,true);await f.save();assert.equal(f.writes.length,1);
 f.progress({deviceId:id,phase:3,error:0,connected:false,ssid:'New network'});assert.equal(f.$('savedWifiName').textContent,'Home network');assert.equal(f.$('wifiNetworkEditor').hidden,false);
 gate.resolve({deviceId:id,phase:4,error:0,connected:true,ssid:'New network'});await pending;
 assert.equal(f.$('savedWifiName').textContent,'New network');assert.equal(f.$('wifiNetworkEditor').hidden,true);assert.equal(f.$('wifiPassword').value,'');assert.equal(f.$('savedWifiSignal').dataset.arcs,'0');assert.match(f.$('savedWifiConnection').textContent,/strength unknown/);assert.equal(f.writes.length,1);
});

test('failed credential save retains the old summary and editable draft without replay',async()=>{
 const gate=deferred(),f=fixture({wifiGate:gate});f.reconfigure();f.$('ssid').value='Draft network';f.$('wifiPassword').value='test-only-password';const pending=f.save();await turns();gate.reject(Error('Could not join Wi-Fi.'));await pending;
 assert.equal(f.$('savedWifiName').textContent,'Home network');assert.equal(f.$('wifiNetworkEditor').hidden,false);assert.equal(f.$('ssid').value,'Draft network');assert.equal(f.$('wifiSetupFeedback').dataset.state,'idle');assert.equal(f.writes.length,1);
});

for(const change of ['change','navigate'])test('late save after '+change+' cannot change the displayed network or hand off',async()=>{
 const gate=deferred(),f=fixture({wifiGate:gate});f.reconfigure();f.$('ssid').value='Late network';f.$('wifiPassword').value='test-only-password';const pending=f.save();await turns();f[change]();
 gate.resolve({deviceId:id,phase:4,error:0,connected:true,ssid:'Late network'});await pending;
 assert.equal(f.$('savedWifiName').textContent,change==='change'?'Other network':'Home network');assert.equal(f.messages.includes('handoff'),false);assert.equal(f.writes.length,1);
});

test('changing the lamp access password never submits a hidden Wi-Fi draft or forget request',async()=>{
 const f=fixture();f.reconfigure();f.$('ssid').value='Unsubmitted draft';f.$('wifiPassword').value='unsubmitted-password';f.$('forgetWifi').checked=true;f.$('adminPassword').value='new-test-access';await f.security();
 assert.equal(f.writes.length,1);const data=f.writes[0].data;assert.equal(data.ssid,'Home network');assert.equal(data.wifiPassword,'');assert.equal(data.forgetWifi,0);assert.equal(data.openNetwork,0);assert.equal(data.adminPassword,'new-test-access');
});

test('HTTP save failure keeps the current network and editor with an idle failed outcome',async()=>{
 const gate=deferred(),f=fixture({ble:false,configGate:gate});f.reconfigure();f.$('ssid').value='Draft network';const pending=f.save();await turns();assert.equal(f.$('wifiSetupFeedback').dataset.state,'working');gate.reject(Error('Settings were not saved.'));await pending;
 assert.equal(f.$('savedWifiName').textContent,'Home network');assert.equal(f.$('wifiNetworkEditor').hidden,false);assert.equal(f.$('ssid').value,'Draft network');assert.equal(f.$('wifiSetupFeedback').dataset.state,'idle');assert.equal(f.writes.length,1);
});

test('late/unknown identities cannot establish a confirmed summary in the production model',()=>{
 const model=new WifiSettingsSummary(),target={};model.view({id,target,epoch:1,verified:true,rawSsid:'Saved'});const old=model.scope();model.view({id:other,target:{},epoch:1,verified:true,rawSsid:'Other'});
 assert.equal(model.accept(old,{deviceId:id,phase:4,error:0,connected:true,ssid:'Late'}),false);assert.equal(model.name,'Other');
 assert.equal(model.view({id:'unknown',target,epoch:1,verified:true,rawSsid:'Unverified'}).name,null);
});
