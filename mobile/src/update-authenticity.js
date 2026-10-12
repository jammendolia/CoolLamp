// Publisher authority is separate from household/fleet authorization. No test
// or built-in invented publisher key is trusted by the app.
const verifiedPackages=new WeakSet();
const fail=message=>{throw new Error(message);};
const hexBytes=text=>Uint8Array.from(text.match(/../g),value=>parseInt(value,16));
export function parseSignedManifest(text){
 if(typeof text!=='string'||text.length>=288||! /^[\x20-\x7e\n]+$/.test(text))fail('Invalid signed firmware manifest.');
 const lines=text.split('\n'),version=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
 if(lines.length!==10||lines[9]!==''||lines[0]!=='COOLLAMP-OTA-2'||!version.test(lines[1])||lines[1].split('.').some(n=>Number(n)>65535)||lines[2]!=='esp32c3'||lines[3]!=='dual-ota-2031616'||!/^[1-9]\d{2,6}$/.test(lines[4])||Number(lines[4])<288||Number(lines[4])>2031616||!/^[0-9a-f]{64}$/.test(lines[5])||!/^[1-9]\d{0,9}$/.test(lines[6])||Number(lines[6])>=0xffffffff||!/^[0-9a-f]{8}$/.test(lines[7])||lines[7]==='00000000'||!/^[0-9a-f]{128}$/.test(lines[8]))fail('Incompatible signed firmware metadata.');
 return Object.freeze({version:lines[1],size:Number(lines[4]),sha256:lines[5],epoch:Number(lines[6]),keyId:lines[7],signature:lines[8],signedText:lines.slice(0,8).join('\n')+'\n',text});
}
export async function verifySignedManifest(text,{keys=[],minimumEpoch=0,minimumVersion='0.0.0',verifySignature}={}){
 const manifest=parseSignedManifest(text);
 if(!Array.isArray(keys)||keys.length<1||keys.length>4||!Number.isInteger(minimumEpoch)||minimumEpoch<0||minimumEpoch>0xffffffff)fail('Publisher trust has not been provisioned.');
 const matches=keys.filter(key=>key.id===manifest.keyId);
 if(matches.length!==1)fail('Unknown or ambiguous publisher key.');
 const key=matches[0];
 if(!Number.isInteger(key.firstEpoch)||!Number.isInteger(key.lastEpoch)||key.firstEpoch<1||key.lastEpoch>0xffffffff||key.lastEpoch<key.firstEpoch||manifest.epoch<minimumEpoch||manifest.epoch<key.firstEpoch||manifest.epoch>key.lastEpoch||typeof key.publicKey!=='string'||!/^04[0-9a-f]{128}$/.test(key.publicKey))fail('Publisher key or security epoch is not permitted.');
 const minimum=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(minimumVersion)&&minimumVersion.split('.').map(Number);
 if(!minimum||minimum.some(n=>n>65535))fail('Invalid installed firmware version.');
 const next=manifest.version.split('.').map(Number);for(let i=0;i<3;i++){if(next[i]<minimum[i])fail('Firmware downgrade is not authorized.');if(next[i]>minimum[i])break;}
 const bytes=new TextEncoder().encode(manifest.signedText),signature=hexBytes(manifest.signature),publicKey=hexBytes(key.publicKey);
 let valid=false;
 if(verifySignature)valid=await verifySignature({algorithm:'ECDSA-P256-SHA256',publicKey,signature,bytes});
 else{
  if(!globalThis.crypto?.subtle)fail('Publisher verification requires a supported native verifier.');
  const imported=await crypto.subtle.importKey('raw',publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  valid=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},imported,signature,bytes);
 }
 if(valid!==true)fail('Publisher signature verification failed.');
 return manifest;
}
export async function prepareSignedPhoneFirmware(text,image,trust){
 const manifest=await verifySignedManifest(text,trust);
 if(!(image instanceof Uint8Array)||image.length!==manifest.size)fail('Signed firmware image size does not match.');
 const view=new DataView(image.buffer,image.byteOffset,image.byteLength);
 if(image[0]!==0xe9||view.getUint16(12,true)!==5||view.getUint32(32,true)!==0xabcd5432)fail('Signed image is not an ESP32-C3 application.');
 const digest=trust?.digest?await trust.digest(image):[...new Uint8Array(await crypto.subtle.digest('SHA-256',image))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 if(digest!==manifest.sha256)fail('Signed firmware image digest does not match.');
 const prepared=Object.freeze({manifest,image});verifiedPackages.add(prepared);return prepared;
}
export function isVerifiedPublisherPackage(value){return value&&verifiedPackages.has(value);}
export function parseUpdateStatusV2(value){
 const integer=(n,max)=>Number.isInteger(n)&&n>=0&&n<=max;
 if(!value||value.updateContractVersion!==2||typeof value.version!=='string'||! /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version)||!integer(value.phase,5)||!integer(value.progress,100)||!integer(value.error,8)||!integer(value.route,4)||!integer(value.checkedAt,0xffffffff)||typeof value.receiver!=='boolean'||!integer(value.writtenOffset,2031616)||!integer(value.totalBytes,2031616)||value.totalBytes&&value.writtenOffset>value.totalBytes||typeof value.publisherEnforced!=='boolean'||typeof value.bootHealthy!=='boolean')fail('Unsupported or malformed update status.');
 const admission=value.policy?.groupCoordination===undefined?null:value.policy;
 if(admission&&(!integer(admission.eligibility,5)||!integer(admission.groupCoordination,4)||typeof admission.automaticEligible!=='boolean'||admission.automaticEligible!==(admission.eligibility===0&&admission.groupCoordination===0)))fail('Malformed automatic update admission.');
 const attempt=value.attemptGuard??null;
 if(attempt&&(attempt.version!==1||typeof attempt.storageReady!=='boolean'||!integer(attempt.unconfirmedArtifacts,4)||attempt.capacity!==4||!integer(attempt.candidateReason,3)||attempt.sameArtifactRequiresManual!==true||attempt.rollbackProven!==false||!attempt.storageReady&&attempt.candidateReason!==3))fail('Unsupported or malformed update attempt guard.');
 return Object.freeze({contractVersion:2,version:value.version,phase:value.phase,route:['none','internet','bluetooth','donation','manual-upload'][value.route],receiver:value.receiver,progress:value.progress,writtenOffset:value.writtenOffset,totalBytes:value.totalBytes||null,error:value.error,checkedAt:value.checkedAt,publisherEnforced:value.publisherEnforced,bootHealthy:value.bootHealthy,
  bleResumeLifetimeMs:value.bleResumeLifetimeMs===120000?120000:null,bleResumeMinMtu:value.bleResumeMinMtu===53?53:null,bleResumeAcrossReboot:value.bleResumeAcrossReboot===true,
  fleetLease:value.fleetLease===true,automaticRadioRollout:value.automaticRadioRollout===true,
  automaticAdmission:admission?Object.freeze({allowed:admission.automaticEligible,policyReason:admission.eligibility,groupCoordination:admission.groupCoordination}):null,
  attemptGuard:attempt?Object.freeze({storageReady:attempt.storageReady,unconfirmedArtifacts:attempt.unconfirmedArtifacts,capacity:4,candidateReason:attempt.candidateReason,sameArtifactRequiresManual:true,rollbackProven:false}):null});
}
