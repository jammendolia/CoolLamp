import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {verifySignedManifest,prepareSignedPhoneFirmware,parseSignedManifest,isVerifiedPublisherPackage,parseUpdateStatusV2} from '../src/update-authenticity.js';
import {BluetoothFirmwareTransfer,parsePhoneManifest,downloadSignedPhoneFirmware} from '../src/bluetooth-firmware.js';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function image(){const result=new Uint8Array(512),view=new DataView(result.buffer);result[0]=0xe9;view.setUint16(12,5,true);view.setUint32(32,0xabcd5432,true);return result;}
function signedFixture(){
 const bytes=image(),pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'}),publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('hex');
 const body=`COOLLAMP-OTA-2\n1.14.0\nesp32c3\ndual-ota-2031616\n512\n${digest(bytes)}\n7\n00000042\n`,signature=sign('sha256',Buffer.from(body),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('hex');
 return {bytes,text:body+signature+'\n',trust:{keys:[{id:'00000042',firstEpoch:1,lastEpoch:9,publicKey}],minimumEpoch:1,minimumVersion:'1.13.0'}};
}
test('app verifies publisher P256 signature and image; caller boolean cannot create a verified package',async()=>{
 const f=signedFixture(),prepared=await prepareSignedPhoneFirmware(f.text,f.bytes,f.trust);
 assert(isVerifiedPublisherPackage(prepared));assert(!isVerifiedPublisherPackage({...prepared,publisherVerified:true}));assert.equal(prepared.manifest.epoch,7);
 for(const mutate of [text=>text.replace('1.14.0','1.14.1'),text=>text.replace('esp32c3','esp32c6'),text=>text.replace('\n7\n','\n8\n'),text=>text.replace('\n512\n','\n0512\n'),text=>text.slice(0,-1),text=>text+'x'])await assert.rejects(verifySignedManifest(mutate(f.text),f.trust));
 const corrupt=f.bytes.slice();corrupt[400]^=1;await assert.rejects(prepareSignedPhoneFirmware(f.text,corrupt,f.trust),/digest/);
});
test('app rejects absent trust, revoked/unknown keys, duplicate key ids, old security epoch and downgrade',async()=>{
 const f=signedFixture();await assert.rejects(verifySignedManifest(f.text),/provisioned/);
 for(const trust of [{...f.trust,minimumEpoch:8},{...f.trust,minimumVersion:'1.15.0'},{...f.trust,keys:[{...f.trust.keys[0],lastEpoch:6}]},{...f.trust,keys:[{...f.trust.keys[0],id:'00000043'}]},{...f.trust,keys:[...f.trust.keys,...f.trust.keys]}])await assert.rejects(verifySignedManifest(f.text,trust));
 assert.throws(()=>parseSignedManifest(f.text.replace('\n7\n','\n4294967295\n')));
 const maximum='COOLLAMP-OTA-2\n65535.65535.65535\nesp32c3\ndual-ota-2031616\n2031616\n'+'ff'.repeat(32)+'\n4294967294\nffffffff\n'+'ff'.repeat(64)+'\n';assert.equal(maximum.length,280);assert.equal(parseSignedManifest(maximum).size,2031616);
});
test('signed download rechecks the exact approved version and never replaces its manifest with Latest',async()=>{
 const f=signedFixture(),requests=[];
 const http={request:async row=>{requests.push(row.url);return {status:200,url:row.url,data:new URL(row.url).pathname.endsWith('.bin')?f.bytes:new TextEncoder().encode(f.text)};}};
 const prepared=await downloadSignedPhoneFirmware(http,{publisherTrust:f.trust,expectedManifest:{text:f.text}});
 assert(isVerifiedPublisherPackage(prepared));assert.equal(requests.length,2);assert(requests.every(url=>url.includes('/download/firmware-v1.14.0/')));
 await assert.rejects(downloadSignedPhoneFirmware({request:async row=>({status:200,url:row.url,data:new TextEncoder().encode(f.text.replace('\n7\n','\n8\n'))})},{publisherTrust:f.trust,expectedManifest:{text:f.text}}),/changed/);
});
test('unified receiver route/progress remains separate from Wi-Fi association and boot health',()=>{
 const snapshot={updateContractVersion:2,version:'1.14.0',phase:3,progress:50,error:0,route:3,checkedAt:1234,receiver:true,writtenOffset:1000,totalBytes:2000,publisherEnforced:true,bootHealthy:true,wifi:false,bleResumeLifetimeMs:120000,bleResumeMinMtu:53,bleResumeAcrossReboot:false,fleetLease:true,automaticRadioRollout:false};
 const parsed=parseUpdateStatusV2(snapshot);assert.equal(parsed.route,'donation');assert.equal(parsed.totalBytes,2000);assert.equal(parsed.automaticRadioRollout,false);assert(!('wifi' in parsed));
 assert.equal(parsed.automaticAdmission,null); // Earlier v2 snapshots remain negotiated safely.
 for(let reason=1;reason<=4;reason++)assert.deepEqual(parseUpdateStatusV2({...snapshot,policy:{eligibility:0,groupCoordination:reason,automaticEligible:false}}).automaticAdmission,{allowed:false,policyReason:0,groupCoordination:reason});
 assert.deepEqual(parseUpdateStatusV2({...snapshot,policy:{eligibility:0,groupCoordination:0,automaticEligible:true}}).automaticAdmission,{allowed:true,policyReason:0,groupCoordination:0});
 assert.throws(()=>parseUpdateStatusV2({...snapshot,policy:{eligibility:0,groupCoordination:1,automaticEligible:true}}));
 assert.throws(()=>parseUpdateStatusV2({...snapshot,policy:{eligibility:0,groupCoordination:99,automaticEligible:false}}));
 const unknown=parseUpdateStatusV2({...snapshot,route:4,totalBytes:0,progress:0});assert.equal(unknown.totalBytes,null);
 for(const changed of [{route:9},{writtenOffset:2001},{phase:99},{publisherEnforced:'true'},{updateContractVersion:99}])assert.throws(()=>parseUpdateStatusV2({...snapshot,...changed}));
});
class Receiver {
 constructor(){this.image=image();this.manifest=parsePhoneManifest(`COOLLAMP-OTA-1\n1.14.0\nesp32c3\ndual-ota-2031616\n512\n${digest(this.image)}\n`);this.flags=4;this.phase=0;this.session=0;this.offset=0;this.size=0;this.ack=0;this.error=0;this.writes=[];this.current=true;this.disconnect=false;this.clock=0;this.mtu=247;}
 async getMtu(){return this.mtu;}
 async read(){const p=new DataView(new ArrayBuffer(20));p.setUint8(0,1);p.setUint8(1,this.phase);p.setUint8(2,this.error);p.setUint8(3,this.flags);p.setUint32(4,this.session,true);p.setUint32(8,this.size,true);p.setUint32(12,this.offset,true);p.setUint16(16,this.ack,true);p.setUint16(18,232,true);return p;}
 async write(id,service,characteristic,p){
  const op=p.getUint8(1);this.writes.push(op);this.session=p.getUint32(2,true);this.ack=p.getUint16(6,true);
  if(op===6||op===2){this.phase=2;this.size=512;}
  if(op===7){assert.equal(p.byteLength,50);assert.equal(p.getUint32(8,true),512);assert.equal(Buffer.from(p.buffer).subarray(12,44).toString('hex'),this.manifest.sha256);this.flags=4;}
  if(op===3){assert.equal(p.getUint32(8,true),this.offset);this.offset+=p.byteLength-12;if(this.disconnect){this.disconnect=false;this.flags=12;this.current=false;}}
  if(op===4){assert.equal(this.offset,512);this.phase=4;this.flags=5;}
  if(op===5){this.phase=5;this.error=8;}
 }
 transfer(){return new BluetoothFirmwareTransfer({ble:this,deviceId:'verified-target',isCurrent:()=>this.current,delay:async ms=>{this.clock+=ms;},now:()=>this.clock});}
 package(){return {manifest:this.manifest,image:this.image};}
}
test('opt-in phone lease resumes only retained written offset without repeating metadata, start or commit',async()=>{
 const receiver=new Receiver(),first=receiver.transfer();receiver.disconnect=true;
 await assert.rejects(first.send(receiver.package(),{enableResume:true}));const lease=first.getResumeLease();assert(lease&&receiver.offset===232);assert.equal(receiver.writes.filter(op=>op===6).length,1);
 const before=receiver.writes.length;receiver.current=true;const resumed=receiver.transfer();assert.equal((await resumed.send(receiver.package(),{resumeLease:lease})).committed,true);
 assert.equal(receiver.writes[before],7);assert(!receiver.writes.slice(before).some(op=>op===1||op===2||op===6));assert.equal(receiver.writes.filter(op=>op===4).length,1);assert.equal(resumed.getResumeLease(),null);
});
test('wrong artifact/session, expired receiver or insufficient resume MTU never starts a replacement image',async()=>{
 for(const reason of ['artifact','session','expired','mtu']){
  const receiver=new Receiver(),first=receiver.transfer();receiver.disconnect=true;await assert.rejects(first.send(receiver.package(),{enableResume:true}));const lease={...first.getResumeLease()};receiver.current=true;
  if(reason==='artifact')lease.sha256='0'.repeat(64);if(reason==='session')++lease.session;if(reason==='expired'){receiver.phase=5;receiver.error=7;}if(reason==='mtu')receiver.mtu=23;
  const before=receiver.writes.length;await assert.rejects(receiver.transfer().send(receiver.package(),{resumeLease:lease}));assert.equal(receiver.writes.length,before);
 }
});
