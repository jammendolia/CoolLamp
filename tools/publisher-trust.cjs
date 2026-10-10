const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===fields.sort().join(',');
const epoch=n=>Number.isInteger(n)&&n>=1&&n<0xffffffff;
function validate(value){
 if(!exact(value,['version','minimumEpoch','keys'])||value.version!==1||!epoch(value.minimumEpoch)||!Array.isArray(value.keys)||value.keys.length<1||value.keys.length>4)throw Error('Invalid public publisher trust configuration.');
 const ids=new Set();
 for(const key of value.keys){
  if(!exact(key,['id','firstEpoch','lastEpoch','publicKey'])||typeof key.id!=='string'||!/^[0-9a-f]{8}$/.test(key.id)||key.id==='00000000'||ids.has(key.id)||!epoch(key.firstEpoch)||!epoch(key.lastEpoch)||key.firstEpoch>key.lastEpoch||typeof key.publicKey!=='string'||!/^04[0-9a-f]{128}$/.test(key.publicKey))throw Error('Invalid or duplicate public publisher key.');
  const bytes=Buffer.from(key.publicKey,'hex');
  try{crypto.createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:bytes.subarray(1,33).toString('base64url'),y:bytes.subarray(33).toString('base64url')}});}catch{throw Error('Publisher public key is not a valid P256 point.');}
  ids.add(key.id);
 }
 if(!value.keys.some(key=>key.firstEpoch<=value.minimumEpoch&&key.lastEpoch>=value.minimumEpoch))throw Error('No publisher key permits the configured security floor.');
 return value;
}
function header(value){
 validate(value);
 return '// Generated from validated public-only JSON. No private material.\n'+
  'static constexpr UpdatePublisher::TrustedKey publisherKeys[]={\n'+value.keys.map(key=>'  {0x'+key.id+','+key.firstEpoch+'u,'+key.lastEpoch+'u,{'+[...Buffer.from(key.publicKey,'hex')].map(n=>'0x'+n.toString(16).padStart(2,'0')).join(',')+'}}').join(',\n')+'\n};\n'+
  'static constexpr uint32_t publisherMinimumEpoch='+value.minimumEpoch+'u;\n';
}
function load(filename){
 const source=path.resolve(filename),bytes=fs.readFileSync(source);if(bytes.length>8192)throw Error('Publisher trust JSON exceeds 8192 bytes.');
 let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw Error('Publisher trust must be public-only JSON.');}
 validate(value);const generated=header(value);
 return {header:generated,provenance:{version:1,source,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),headerSha256:crypto.createHash('sha256').update(generated).digest('hex'),minimumEpoch:value.minimumEpoch,keyIds:value.keys.map(key=>key.id)}};
}
module.exports={validate,header,load};
