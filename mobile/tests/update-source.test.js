import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {acknowledgedBluetoothUpdateSource,observedReceiverUpdate,updateSourceLabel,UPDATE_SOURCE_FRESH_MS,automaticUpdateEvidence,automaticUpdateCardMessage} from '../src/update-source.js';
import {lampArtworkSvg} from '../src/lamp-artwork.js';

const target='aabbccddeeff',proof={verified:true,fresh:true,observedAt:1000,now:1500};
const status={updateContractVersion:2,phase:3,receiver:true,route:1,progress:50,writtenOffset:500,totalBytes:1000};
const snapshot=()=>({deviceId:target,firmware:{...status}});

test('source labels are fixed presentation text and never execute unknown metadata',()=>{
 assert.equal(updateSourceLabel('bluetooth'),'From your phone');assert.equal(updateSourceLabel('internet'),'From the internet');assert.equal(updateSourceLabel('donation'),'From another trusted lamp');
 assert.equal(updateSourceLabel('manual-upload'),'From your computer');
 for(const source of [undefined,null,0,1,'wifi','mesh','constructor','toString','<img>',{toString:()=>assert.fail('Executed metadata')}])assert.equal(updateSourceLabel(source),null);
});

test('phone source requires actual matching written-byte progress and the pinned artifact version',()=>{
 const value={stage:'transferring',version:'1.15.1',total:2031616,acknowledgedBytes:1015808,progress:50};
 assert.equal(acknowledgedBluetoothUpdateSource(value,'1.15.1'),'bluetooth');
 for(const change of [{stage:'downloading'},{stage:'downloaded',progress:100},{stage:'wifi'},{stage:'preparing'},{stage:'restarting'},
  {version:'1.15.2'},{acknowledgedBytes:1015807},{acknowledgedBytes:2031617},{acknowledgedBytes:-1},{acknowledgedBytes:0.5},{total:2031617},{total:0},{progress:'50'},{progress:100}])
  assert.equal(acknowledgedBluetoothUpdateSource({...value,...change},'1.15.1'),null);
 assert.equal(acknowledgedBluetoothUpdateSource(value,'1.14.0'),null);
});

test('active source snapshots are target fenced, time bounded and physically receiving rather than only associated',()=>{
 assert.deepEqual(observedReceiverUpdate(snapshot(),target,proof),{progress:50,source:'internet'});
 for(const [route,source] of [[1,'internet'],[2,'bluetooth'],[3,'donation'],[0,null],[4,'manual-upload'],[99,null]])assert.equal(observedReceiverUpdate({deviceId:target,firmware:{...status,route}},target,proof).source,source);
 for(const fields of [{verified:false},{fresh:false},{observedAt:0},{now:999},{now:1000+UPDATE_SOURCE_FRESH_MS+1},{now:NaN}])assert.equal(observedReceiverUpdate(snapshot(),target,{...proof,...fields}),null);
 assert.equal(observedReceiverUpdate({...status},target,proof),null,'A compact status without canonical target identity is not target proof.');
 assert.equal(observedReceiverUpdate({...snapshot(),deviceId:'112233445566'},target,proof),null);
 for(const fields of [{phase:0},{phase:1},{phase:2},{phase:4},{phase:5},{receiver:false},{updateContractVersion:1},{writtenOffset:501,progress:51},{totalBytes:0},{totalBytes:2031617},{progress:100},{writtenOffset:-1}])assert.equal(observedReceiverUpdate({deviceId:target,firmware:{...status,...fields}},target,proof),null);
 assert.deepEqual(observedReceiverUpdate({deviceId:target,...status},target,proof),{progress:50,source:'internet'},'A future identity-bearing compact status uses the same verified contract.');
});

test('artwork accepts only known source enums while ordinary drawings and unknown fills remain generic',()=>{
 for(const source of ['bluetooth','internet','donation','manual-upload'])assert.match(lampArtworkSvg('corkscrew',{updateProgress:50,updateSource:source}),new RegExp(`data-update-source="${source}"`));
 for(const source of ['wifi','mesh',null,1,'<img>',{}])assert(!lampArtworkSvg('helix',{updateProgress:50,updateSource:source}).includes('data-update-source'));
 assert(!lampArtworkSvg('helix',{updateSource:'bluetooth'}).includes('data-update-source'));
});

const channels=hex=>[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16));
const luminance=hex=>channels(hex).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (values[0]+.05)/(values[1]+.05);};
test('actual source colors preserve route hue ratios and distinguish the silhouette on both paper themes',()=>{
 const css=readFileSync(new URL('../src/app-v2.css',import.meta.url),'utf8');
 for(const source of ['bluetooth','internet','donation','manual-upload']){
  const light=css.match(new RegExp(`\\[data-update-source=${source}\\]\\{--lamp-update-fill:(#[a-f0-9]{6})\\}`))[1];
  const dark=css.match(new RegExp(`html\\[data-app-theme=dark\\] \\[data-update-source=${source}\\]\\{--lamp-update-fill:(#[a-f0-9]{6})\\}`))[1];
  for(const hex of [light,dark]){
   const [r,g,b]=channels(hex);
   if(source==='bluetooth'){assert(r<g&&g<b);assert.equal(r/b,.6);assert.equal(g/b,.8);}
   if(source==='internet'){assert(g>r&&r===b);assert.equal(r/g,.6);}
   if(source==='donation'){assert(b<g&&g<r);assert.equal(b/r,.6);assert.equal(g/r,.8);}
   if(source==='manual-upload'){assert(g<r&&r<b);assert.equal(g/b,.6);assert.equal(r/b,.8);}
  }
  assert(contrast(light,'#eee5d6')>=3,source+' silhouette contrast on light paper');assert(contrast(dark,'#394232')>=3,source+' silhouette contrast on dark paper');
 }
 const neutral=css.match(/stroke:var\(--lamp-update-fill,(#[a-f0-9]{6})\)/)[1],neutralDark=css.match(/html\[data-app-theme=dark\]\{--lamp-update-fill:(#[a-f0-9]{6})\}/)[1];
 for(const color of [neutral,neutralDark]){const [r,g,b]=channels(color);assert(r===g&&g===b,'Unknown/NONE source is neutral gray, never a known route hue.');}
 assert(contrast(neutral,'#eee5d6')>=3);assert(contrast(neutralDark,'#394232')>=3);
});

const service=()=>({version:1,state:5,reason:14,retryInMs:75000,donorWaitMs:0,internetAttempts:1,donorOffers:0,attention:true,phoneFallback:true,newerSeen:true});
const automatic=()=>({deviceId:target,version:'1.15.1',latest:'1.15.2',phase:0,error:0,automatic:true,bootHealthy:true,automaticService:service()});
test('automatic attention requires opt-in, fresh canonical evidence and a newer release or actual failed attempt',()=>{
 const evidence=automaticUpdateEvidence(automatic(),target,proof);assert.equal(evidence.kind,'attention');assert.equal(evidence.offerPhone,true);
 assert.match(automaticUpdateCardMessage({automaticEnabled:true,automaticAttention:evidence},target,{now:1500}),/keep checking.*Tap Update/);
 assert.match(automaticUpdateCardMessage({automaticEnabled:true,automaticAttention:evidence},target,{now:10000}),/last check/);
 assert.equal(automaticUpdateEvidence({...automatic(),automatic:false},target,proof).kind,'disabled');
 for(const fields of [{verified:false},{fresh:false},{now:10000}])assert.equal(automaticUpdateEvidence(automatic(),target,{...proof,...fields}),null);
 assert.equal(automaticUpdateEvidence({...automatic(),deviceId:'112233445566'},target,proof),null);
 const current={...automatic(),latest:'1.15.1'};assert.equal(automaticUpdateEvidence(current,target,proof).kind,'healthy');
 const unknown={...automatic(),latest:'0.0.0',automaticService:{...service(),newerSeen:false,attention:true,internetAttempts:0}};assert.equal(automaticUpdateEvidence(unknown,target,proof).kind,'waiting');
 assert.equal(automaticUpdateEvidence({...unknown,phase:5,error:3,automaticService:{...unknown.automaticService,internetAttempts:1}},target,proof).kind,'attention');
 assert.equal(automaticUpdateCardMessage({automaticEnabled:false,automaticAttention:evidence},target),null);
});

test('a phone-known newer release can offer explicit help only after unavailable donor observation finishes',()=>{
 const unseen={...automatic(),latest:'1.15.1',automaticService:{...service(),attention:false,phoneFallback:false,newerSeen:false,internetAttempts:0}};
 for(const reason of [11,12,13,14,15,16])assert.equal(automaticUpdateEvidence({...unseen,automaticService:{...unseen.automaticService,reason}},target,{...proof,latestVersion:'1.15.2'}).offerPhone,true);
 for(const reason of [0,1,2,3,4,5,6,7,8,9,10,17,18,19,20,21,22,23])assert.equal(automaticUpdateEvidence({...unseen,automaticService:{...unseen.automaticService,reason}},target,{...proof,latestVersion:'1.15.2'}).kind,'waiting');
 for(const fields of [{state:0},{state:1},{state:2},{state:4},{donorWaitMs:1}])assert.equal(automaticUpdateEvidence({...unseen,automaticService:{...unseen.automaticService,...fields}},target,{...proof,latestVersion:'1.15.2'}).kind,'waiting');
 assert.equal(automaticUpdateEvidence(unseen,target,{...proof,latestVersion:'1.15.1'}).kind,'healthy');
 const pending=automaticUpdateEvidence({...unseen,automaticService:{...unseen.automaticService,state:6,reason:24}},target,{...proof,latestVersion:'1.15.2'});
 assert.equal(pending.kind,'pending');assert(!automaticUpdateCardMessage({automaticAttention:pending},target,{now:1500}).includes('Tap Update'));
});

test('optional automatic-service bounds are negotiated without executable or private fields',()=>{
 for(const fields of [{version:2},{state:7},{reason:25},{retryInMs:21600001},{donorWaitMs:30001},{internetAttempts:65536},{donorOffers:-1},{attention:'true'},{phoneFallback:1},{newerSeen:null}])assert.equal(automaticUpdateEvidence({...automatic(),automaticService:{...service(),...fields}},target,proof),null);
 const bounded=automaticUpdateEvidence({...automatic(),automaticService:{...service(),retryInMs:21600000,password:'private'}},target,proof);assert(bounded);assert(!JSON.stringify(bounded).includes('private'));
 assert.equal(automaticUpdateEvidence({...automatic(),automaticService:undefined},target,proof),null);
});

test('inconsistent phone-fallback flags cannot prompt a phone update during quiet, group, busy or commit holds',()=>{
 for(const reason of [1,2,3,4,5,6,7,8,9,10,17,18,19,20,21,22,23,24]){
  const evidence=automaticUpdateEvidence({...automatic(),automaticService:{...service(),reason}},target,proof);
  assert.notEqual(evidence.offerPhone,true);
  assert(!automaticUpdateCardMessage({automaticAttention:evidence,automaticEnabled:true},target,{now:1500}).includes('Tap Update'));
 }
});

test('commit or restart uncertainty remains dominant over equal-version running-image health',()=>{
 for(const fields of [{phase:4},{automaticService:{...service(),state:6}},{automaticService:{...service(),reason:24}}]){
  const evidence=automaticUpdateEvidence({...automatic(),latest:'1.15.1',...fields},target,proof);
  assert.equal(evidence.kind,'pending');assert(!automaticUpdateCardMessage({automaticAttention:evidence},target,{now:1500}).includes('Tap Update'));
 }
 assert.equal(automaticUpdateEvidence({...automatic(),phase:4,latest:'1.15.1',automaticService:undefined},target,proof).kind,'pending');
});
