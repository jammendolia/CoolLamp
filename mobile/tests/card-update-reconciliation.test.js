import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {updateCardFirmware} from '../src/card-firmware.js';
import {BluetoothFirmwareTransfer,parsePhoneManifest} from '../src/bluetooth-firmware.js';
import {FirmwareAttemptJournal,reconcileFirmwareAttempt} from '../src/firmware-attempt.js';

const identity='f0b950b2f180';
function fixture({loseFinalReply=false,reinstall=false,failAcquire=0,failSnapshot=0}={}){
 const image=new Uint8Array(2048);image[0]=0xe9;
 const digest=createHash('sha256').update(image).digest('hex');
 const manifest=parsePhoneManifest(`COOLLAMP-OTA-1\n1.15.1\nesp32c3\ndual-ota-2031616\n2048\n${digest}\n`);
 const storage=new Map(),journal=new FirmwareAttemptJournal({getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)});
 let installed=reinstall?'1.15.1':'1.13.0',acquisitions=0,downloads=0,transfers=0,clock=1000,snapshots=0;
 const operations=[],progress=[],state={phase:0,error:0,session:0,size:0,offset:0,ack:0};
 const ble={getMtu:async()=>247,read:async()=>{
  const out=new DataView(new ArrayBuffer(20));out.setUint8(0,1);out.setUint8(1,state.phase);out.setUint8(2,state.error);out.setUint8(3,state.phase===4?1:0);
  for(const [offset,key]of [[4,'session'],[8,'size'],[12,'offset']])out.setUint32(offset,state[key],true);
  out.setUint16(16,state.ack,true);out.setUint16(18,232,true);return out;
 },write:async(_device,_service,_characteristic,frame)=>{
  const op=frame.getUint8(1);operations.push(op);state.session=frame.getUint32(2,true);state.ack=frame.getUint16(6,true);
  if(op===2){state.phase=2;state.size=image.length;}
  if(op===3){assert.equal(frame.getUint32(8,true),state.offset);state.offset+=frame.byteLength-12;}
  if(op===4){assert.equal(state.offset,image.length);state.phase=4;installed=manifest.version;if(loseFinalReply)throw Error('Final native reply lost.');}
  if(op===5){state.phase=5;state.error=8;}
 }};
 const acquire=async()=>{
  if(++acquisitions===failAcquire)throw Error('Not connected to device.');
  return {lamp:{identity,refreshFirmware:async()=>({version:installed,phase:0}),
   readFirmwareUpdateSnapshot:async options=>{
    assert(options?.isCurrent?.()!==false);if(++snapshots===failSnapshot)throw Error('Not connected to device.');
    return {identity,observedAt:Date.now(),firmware:{version:installed,phase:0},state:{mode:46,effectCount:47,brightness:55,power:true},receiver:{...state,committed:state.phase===4}};
   },updateOverBluetooth:async(prepared,notify,options)=>{
    transfers++;const sender=new BluetoothFirmwareTransfer({ble,deviceId:'saved',onProgress:notify,delay:async ms=>{clock+=ms;},now:()=>clock});
    return sender.send(prepared,{onBeforeWrite:options.onBeforeWrite});
   }},release:async()=>{state.phase=0;state.error=0;state.session=0;state.size=0;state.offset=0;state.ack=0;}};
 };
 const run=()=>updateCardFirmware({entry:{id:identity,deviceId:'saved'},manifest,attemptJournal:journal,allowReinstall:reinstall,
  acquireBluetooth:acquire,download:async selected=>{downloads++;assert.equal(selected.text,manifest.text);return {manifest:selected,image};},
  onProgress:value=>progress.push(value),reconcile:(attempt,options)=>reconcileFirmwareAttempt({attempt,...options,acquire,maxAttempts:1,delay:async()=>{}})});
 return {run,journal,operations,progress,manifest,get acquisitions(){return acquisitions;},get downloads(){return downloads;},get transfers(){return transfers;}};
}
test('actual card, sender and durable journal confirm installed version after protected reconnect',async()=>{
 const f=fixture();const result=await f.run();assert.equal(result.outcome,'installed');assert.equal(result.installedVersion,'1.15.1');
 assert.equal(f.downloads,1);assert.equal(f.transfers,1);assert.equal(f.acquisitions,3);assert.equal(f.operations.filter(op=>op===4).length,1);
 assert.equal(f.journal.pending().length,0);assert.equal(f.journal.get(identity).commitAcknowledged,true);
 assert(f.progress.some(value=>value.stage==='transferring'&&value.acknowledgedBytes===2048));
});
for(const field of ['failAcquire','failSnapshot'])test('known zero-write '+field+' recovers once with the same verified download',async()=>{
 const f=fixture({[field]:2});const result=await f.run();assert.equal(result.outcome,'installed');assert.equal(f.downloads,1);assert.equal(f.transfers,1);
 assert.equal(f.acquisitions,4);assert.equal(f.operations.filter(op=>op===2).length,1);assert.equal(f.operations.filter(op=>op===4).length,1);
 assert(f.progress.some(value=>value.stage==='recovering-connection'));
});
test('lost final native reply is resolved by protected installed-version reads, never another Finish',async()=>{
 const f=fixture({loseFinalReply:true});const result=await f.run();assert.equal(result.outcome,'installed');assert.equal(f.transfers,1);
 assert.equal(f.operations.filter(op=>op===4).length,1);assert.equal(f.journal.get(identity).commitAcknowledged,false);
 assert.equal(result.artifactDigestVerified,false);assert.equal(result.bootHealthVerified,false);
});
test('same-version repair with a lost final reply stays fenced despite an equal running version',async()=>{
 const f=fixture({loseFinalReply:true,reinstall:true});const result=await f.run();assert.equal(result.pending,true);
 assert.equal(f.journal.pending().length,1);assert.equal(f.operations.filter(op=>op===4).length,1);assert.equal(f.transfers,1);
});
test('same-version repair requires its matching receipt and fresh protected inactive receiver',async()=>{
 const f=fixture({reinstall:true});const result=await f.run();assert.equal(result.outcome,'installed');assert.equal(f.journal.get(identity).commitAcknowledged,true);
 assert.equal(f.transfers,1);assert.equal(f.operations.filter(op=>op===4).length,1);
});
