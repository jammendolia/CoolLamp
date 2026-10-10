import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BluetoothFirmwareTransfer, downloadPhoneFirmware, parsePhoneManifest, decodeBleUpdate, compareFirmwareVersions, firmwareBase64, bluetoothFirmwareFailureMessage, OTA_WRITE, OTA_STATUS} from '../src/bluetooth-firmware.js';
import {LampTransport} from '../src/transport.js';
const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
function packageValue(){
 const image=new Uint8Array(2048),view=new DataView(image.buffer);image[0]=0xe9;view.setUint16(12,5,true);view.setUint32(32,0xabcd5432,true);
 image.set(new TextEncoder().encode('COOLLAMP-PUBLIC-1.11.0\0'),300);
 const text=`COOLLAMP-OTA-1\n1.11.0\nesp32c3\ndual-ota-2031616\n${image.length}\n${checksum(image)}\n`;
 return {manifest:parsePhoneManifest(text),image};
}
class Radio {
 constructor(pkg=packageValue(),mtu=247){this.pkg=pkg;this.mtu=mtu;this.writes=[];this.reads=0;this.s={phase:0,error:0,session:0,size:0,offset:0,ack:0,maxData:232};this.current=true;this.clock=0;this.manifest=[];}
 async getMtu(){return this.mtu;}
 async read(id,service,char){
  if(char==='7b610006-6e2b-4f3d-9a71-28e45c001001')return new DataView(new TextEncoder().encode(this.identity||'aabbccddeeff').buffer);
  assert.equal(char,OTA_STATUS);++this.reads;if(this.unsupported)throw Error('missing characteristic');
  const data=new DataView(new ArrayBuffer(20));data.setUint8(0,1);data.setUint8(1,this.s.phase);data.setUint8(2,this.s.error);data.setUint8(3,this.s.committed?1:0);
  for(const [offset,field] of [[4,'session'],[8,'size'],[12,'offset']])data.setUint32(offset,this.s[field],true);
  data.setUint16(16,this.s.ack,true);data.setUint16(18,this.s.maxData,true);return data;
 }
 async write(id,service,char,data){
  assert.equal(char,OTA_WRITE);assert(data.byteLength<=Math.min(this.mtu-3,244));this.writes.push(new Uint8Array(data.buffer).slice());
  const op=data.getUint8(1),ack=data.getUint16(6,true);this.s.session=data.getUint32(2,true);
  if(op===1){assert.equal(data.getUint16(8,true),this.manifest.length);this.manifest.push(...new Uint8Array(data.buffer).slice(10));}
  if(op===2){assert.equal(new TextDecoder().decode(new Uint8Array(this.manifest)),this.pkg.manifest.text);this.s.phase=2;this.s.size=this.pkg.image.length;}
  if(op===3){assert.equal(data.getUint32(8,true),this.s.offset);const bytes=new Uint8Array(data.buffer).slice(12);assert.deepEqual(bytes,this.pkg.image.slice(this.s.offset,this.s.offset+bytes.length));this.s.offset+=bytes.length;}
  if(!this.loseAck)this.s.ack=ack;
  if(op===4){assert.equal(this.s.offset,this.pkg.image.length);this.s.phase=this.rejectFinish?5:4;this.s.error=this.rejectFinish?5:0;this.s.committed=!this.rejectFinish;if(this.loseFinish)throw Error('link ended');}
  if(op===5){this.s.phase=5;this.s.error=8;}
  if(op===3&&this.changeConnection)this.current=false;
  if(op===3&&this.duringData)await this.duringData();
 }
 transfer(onProgress=()=>{}){return new BluetoothFirmwareTransfer({ble:this,deviceId:'target',isCurrent:()=>this.current,onProgress,delay:async ms=>{this.clock+=ms;},now:()=>this.clock});}
}
test('phone pins the image to the validated manifest version and verifies native base64 download',async()=>{
 const pkg=packageValue(),requests=[],progress=[];
 const result=await downloadPhoneFirmware({request:async row=>{requests.push(row);return {status:200,url:row.url,data:firmwareBase64(requests.length===1?new TextEncoder().encode(pkg.manifest.text):pkg.image)};}},{onProgress:row=>progress.push(row)});
 assert.deepEqual(result.image,pkg.image);assert.equal(result.manifest.version,'1.11.0');
 assert(new URL(requests[0].url).pathname.endsWith('/latest/download/coollamp-manifest.txt'));assert(new URL(requests[1].url).pathname.endsWith('/download/firmware-v1.11.0/CoolLamp.ino.bin'));
 assert(requests.every(row=>row.responseType==='arraybuffer'&&row.headers['Cache-Control']==='no-cache, no-store, max-age=0'&&new URL(row.url).searchParams.has('check')));assert.deepEqual(progress.map(row=>row.stage),['downloading','downloaded']);
});
test('native digest can verify an image without browser subtle crypto',async()=>{
 const pkg=packageValue();let calls=0,native=0;
 const result=await downloadPhoneFirmware({request:async()=>({status:200,data:++calls===1?new TextEncoder().encode(pkg.manifest.text):pkg.image})},{digest:async bytes=>{++native;assert.deepEqual(bytes,pkg.image);return checksum(bytes);}});
 assert.equal(native,1);assert.equal(result.manifest.sha256,pkg.manifest.sha256);
});
for(const reason of ['digest','size','chip','magic','redirect','http'])test('phone rejects '+reason+' before transfer',async()=>{
 const pkg=packageValue();let calls=0;const image=pkg.image.slice();
 if(reason==='digest')image[400]^=1;if(reason==='chip')image[12]=8;if(reason==='magic')image[0]=0;
 await assert.rejects(downloadPhoneFirmware({request:async row=>{++calls;return {status:reason==='http'?503:200,url:reason==='redirect'?'https://example.com/image':row.url,data:calls===1?new TextEncoder().encode(pkg.manifest.text):reason==='size'?image.slice(1):image};}}));
});
test('cancel promptly releases an unresolved native HTTP request and discards its eventual response',async()=>{
 const abort=new AbortController();let resolve;
 const job=downloadPhoneFirmware({request:()=>new Promise(done=>resolve=done)},{signal:abort.signal});abort.abort();
 await assert.rejects(job,/cancelled/);resolve({status:200,data:new Uint8Array(512)});
});
test('strict phone manifest format and numerical version comparison',()=>{
 const {manifest}=packageValue();
 for(const value of [manifest.text.replace('esp32c3','esp32'),manifest.text.replace('1.11.0','1.011.0'),manifest.text.replace('1.11.0','1.65536.0'),manifest.text.replace('\n2048\n','\n2031617\n'),manifest.text.replaceAll('\n','\r\n'),manifest.text+'x'])assert.throws(()=>parsePhoneManifest(value));
 assert.equal(compareFirmwareVersions('1.11.0','1.9.9'),1);assert.equal(compareFirmwareVersions('1.11.0','1.11.0'),0);assert.equal(compareFirmwareVersions('1.11.0','1.12.0'),-1);
});
for(const mtu of [23,185,247,515])test('paced transfer respects negotiated MTU '+mtu+' and uses written-byte progress',async()=>{
 const radio=new Radio(packageValue(),mtu),progress=[];const result=await radio.transfer(row=>progress.push(row)).send(radio.pkg);
 assert.equal(result.committed,true);assert.equal(radio.s.offset,radio.pkg.image.length);assert.equal(radio.writes.at(-1)[1],4);
 const chunks=radio.writes.filter(row=>row[1]===3);assert(chunks.every(row=>row.length<=Math.min(244,mtu-3)));
 assert(progress.some(row=>row.stage==='transferring'&&row.progress===100));assert.equal(progress.at(-1).stage,'verifying');
});
test('missing BLE receiver exposes bootstrap requirement and writes nothing',async()=>{const radio=new Radio();radio.unsupported=true;await assert.rejects(radio.transfer().send(radio.pkg),/once over Wi-Fi/);assert.equal(radio.writes.length,0);});
test('malformed prepared package and status frames are rejected',async()=>{
 const radio=new Radio();await assert.rejects(radio.transfer().send({...radio.pkg,image:new Uint8Array(1)}));assert.equal(radio.writes.length,0);
 assert.throws(()=>decodeBleUpdate(new DataView(new ArrayBuffer(19))));
});
test('lost acknowledgments abort without replaying any data frame',async()=>{
 const radio=new Radio();radio.loseAck=true;await assert.rejects(radio.transfer().send(radio.pkg),/No data was replayed/);
 assert.deepEqual(radio.writes.map(row=>row[1]),[1,5]);
});
test('changed connection stops after the current frame without writing on the new link',async()=>{
 const radio=new Radio();radio.changeConnection=true;await assert.rejects(radio.transfer().send(radio.pkg),/Reconnect/);
 assert.equal(radio.writes.filter(row=>row[1]===3).length,1);assert(!radio.writes.some(row=>row[1]===4||row[1]===5));
});
test('cancel before commit sends exactly one abort and no finish',async()=>{
 const radio=new Radio(),transfer=radio.transfer();radio.duringData=async()=>{await Promise.all([transfer.cancel(),transfer.cancel()]);};
 await assert.rejects(transfer.send(radio.pkg),/stopped/);assert.equal(radio.writes.filter(row=>row[1]===5).length,1);assert(!radio.writes.some(row=>row[1]===4));
});
test('lost final reply requires installed-version verification and never replays commit or cancel',async()=>{
 const radio=new Radio();radio.loseFinish=true;const result=await radio.transfer().send(radio.pkg);
 assert.equal(result.verificationRequired,true);assert.equal(result.committed,false);assert.equal(radio.writes.filter(row=>row[1]===4).length,1);assert(!radio.writes.some(row=>row[1]===5));
});
test('confirmed image rejection is reported without a success result',async()=>{
 const radio=new Radio();radio.rejectFinish=true;await assert.rejects(radio.transfer().send(radio.pkg),/rejected/);assert.equal(radio.writes.filter(row=>row[1]===4).length,1);
});
test('receiver failure retains its acknowledged bytes and original reason after Cancel replaces status',async()=>{
 const radio=new Radio(),write=radio.write.bind(radio);let count=0;
 radio.write=async(...args)=>{const op=args[3].getUint8(1);if(op===3&&radio.s.phase===5)return;await write(...args);if(op===3&&++count===2){radio.s.phase=5;radio.s.error=7;}};
 let failure;try{await radio.transfer().send(radio.pkg);}catch(error){failure=error;}
 assert(failure.confirmed);assert.equal(failure.updateDiagnostic.phase,5);assert.equal(failure.updateDiagnostic.error,7);
 assert.equal(failure.updateDiagnostic.acknowledgedBytes,464);assert.equal(failure.updateDiagnostic.total,2048);assert.equal(failure.updateDiagnostic.progress,22);
 assert.equal(radio.s.error,8);assert.equal(radio.writes.filter(row=>row[1]===5).length,1);
 assert.match(bluetoothFirmwareFailureMessage(failure),/22%.*464 of 2,048 bytes confirmed/);assert.match(bluetoothFirmwareFailureMessage(failure),/code 7: receiver timed out/);
});
test('native write failure takes one bounded matching snapshot before Cancel and never replays bytes',async()=>{
 const radio=new Radio(),write=radio.write.bind(radio),read=radio.read.bind(radio);let count=0,failed=false,snapshots=0;
 radio.write=async(...args)=>{await write(...args);if(args[3].getUint8(1)===3&&++count===5){failed=true;throw Error('Native write timed out.');}};
 radio.read=async(...args)=>{if(failed){++snapshots;assert.equal(args[3].timeout,1200);}return read(...args);};
 let failure;try{await radio.transfer().send(radio.pkg);}catch(error){failure=error;}
 assert(failure.uncertain);assert.equal(snapshots,1);assert.equal(failure.updateDiagnostic.phase,2);
 assert.equal(failure.updateDiagnostic.acknowledgedBytes,1160);assert.equal(failure.updateDiagnostic.progress,56);assert.equal(radio.s.error,8);
 const data=radio.writes.filter(row=>row[1]===3);assert.equal(data.length,5);assert.equal(new Set(data.map(row=>new DataView(row.buffer).getUint32(8,true))).size,5);
 assert(!radio.writes.some(row=>row[1]===4));assert.match(bluetoothFirmwareFailureMessage(failure),/check the installed version before retrying/);
});
test('a foreign receiver snapshot cannot replace this transfer’s last acknowledged offset',async()=>{
 const radio=new Radio(),write=radio.write.bind(radio),read=radio.read.bind(radio);let count=0,failed=false;
 radio.write=async(...args)=>{await write(...args);if(args[3].getUint8(1)===3&&++count===5){failed=true;throw Error('Write failed.');}};
 radio.read=async(...args)=>{const result=await read(...args);if(failed)result.setUint32(4,radio.s.session^1,true);return result;};
 let failure;try{await radio.transfer().send(radio.pkg);}catch(error){failure=error;}
 assert.equal(failure.updateDiagnostic.acknowledgedBytes,928);assert.equal(failure.updateDiagnostic.progress,45);assert.equal(radio.writes.filter(row=>row[1]===5).length,1);
});
test('changed connection suppresses the diagnostic read and Cancel on the replacement link',async()=>{
 const radio=new Radio(),write=radio.write.bind(radio),read=radio.read.bind(radio);let count=0,failed=false,snapshots=0;
 radio.write=async(...args)=>{await write(...args);if(args[3].getUint8(1)===3&&++count===5){radio.current=false;failed=true;throw Error('Link ended.');}};
 radio.read=async(...args)=>{if(failed)++snapshots;return read(...args);};
 let failure;try{await radio.transfer().send(radio.pkg);}catch(error){failure=error;}
 assert.equal(snapshots,0);assert.equal(failure.updateDiagnostic.acknowledgedBytes,928);assert(!radio.writes.some(row=>row[1]===4||row[1]===5));
});
test('an unresolved diagnostic read is bounded and cannot delay Cancel indefinitely',async()=>{
 const radio=new Radio(),write=radio.write.bind(radio),read=radio.read.bind(radio);let failed=false,count=0,snapshots=0,release;
 radio.write=async(...args)=>{await write(...args);if(args[3].getUint8(1)===3&&++count===5){failed=true;throw Error('Write failed.');}};
 radio.read=async(...args)=>{if(failed){++snapshots;return new Promise(resolve=>release=resolve);}return read(...args);};
 let failure;try{await radio.transfer().send(radio.pkg);}catch(error){failure=error;}
 assert.equal(snapshots,1);assert.equal(failure.updateDiagnostic.acknowledgedBytes,928);assert.equal(radio.writes.filter(row=>row[1]===5).length,1);
 release(await read('target',null,OTA_STATUS));await Promise.resolve();assert.equal(failure.updateDiagnostic.error,0);
});
test('final rejection retains the receiver code without adding a diagnostic read or Cancel',async()=>{
 const radio=new Radio();radio.rejectFinish=true;let failure;try{await radio.transfer().send(radio.pkg);}catch(error){failure=error;}
 assert.equal(failure.updateDiagnostic.error,5);assert.equal(failure.updateDiagnostic.acknowledgedBytes,2048);assert.equal(failure.updateDiagnostic.progress,100);
 assert(!radio.writes.some(row=>row[1]===5));assert.match(bluetoothFirmwareFailureMessage(failure),/image verification failed/);
});
function transport(radio){const lamp=new LampTransport(radio);lamp.id='target';lamp.deviceIdentity='aabbccddeeff';lamp.control={capabilities:['control']};return lamp;}
test('protected identity is verified again before transfer',async t=>{
 const radio=new Radio(),lamp=transport(radio);t.after(()=>clearTimeout(lamp.controlTimer));radio.identity='112233445566';
 await assert.rejects(lamp.updateOverBluetooth(radio.pkg),/lamp changed/);assert.equal(radio.writes.length,0);assert.equal(lamp.bluetoothUpdate,null);
});
test('transfer waits for old command lanes, then rejects new mutations',async t=>{
 const radio=new Radio(),lamp=transport(radio);t.after(()=>clearTimeout(lamp.controlTimer));let release;lamp.tail=new Promise(resolve=>release=resolve);
 const work=lamp.updateOverBluetooth(radio.pkg);await Promise.resolve();assert.equal(radio.writes.length,0);release();
 let checked=false;radio.duringData=async()=>{if(!checked){checked=true;await assert.rejects(lamp.command('power',0),/transfer/);}};
 assert.equal((await work).committed,true);assert(checked);assert.equal(lamp.bluetoothUpdate,null);
});
test('cancellation while old command lanes drain never starts a receiver session',async t=>{
 const radio=new Radio(),lamp=transport(radio),abort=new AbortController();t.after(()=>clearTimeout(lamp.controlTimer));let release;lamp.tail=new Promise(resolve=>release=resolve);
 const work=lamp.updateOverBluetooth(radio.pkg,()=>{},{signal:abort.signal});abort.abort();release();await assert.rejects(work,/cancelled/);assert.equal(radio.writes.length,0);
});
