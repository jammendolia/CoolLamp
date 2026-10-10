// Test-only ephemeral material stays under ignored .build/. Never a product key.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const relay=process.argv.includes('--relay');
const directory=path.resolve(__dirname,'../.build/publisher-fixtures'+(relay?'/relay':''));fs.mkdirSync(directory,{recursive:true});
const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const version=/LAMP_FIRMWARE_VERSION "([^"]+)"/.exec(fs.readFileSync(path.resolve(__dirname,'../LampVersion.h'),'utf8'))[1];
const artifact=Buffer.alloc(relay?65584:512);artifact[0]=0xe9;artifact.writeUInt16LE(5,12);artifact.writeUInt32LE(0xabcd5432,32);artifact.write('COOLLAMP-PUBLIC-'+version+'\0',300);
if(relay){artifact[1]=1;artifact[23]=1;artifact.writeUInt32LE(65504,28);}
const digest=crypto.createHash('sha256').update(artifact).digest('hex');
const body=`COOLLAMP-OTA-2\n${version}\nesp32c3\ndual-ota-2031616\n${artifact.length}\n${digest}\n7\n00000042\n`;
const signature=crypto.sign('sha256',Buffer.from(body),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('hex');
const jwk=publicKey.export({format:'jwk'}),raw=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
fs.writeFileSync(path.join(directory,'development-private-key.pem'),privateKey.export({format:'pem',type:'pkcs8'}));
fs.writeFileSync(path.join(directory,'fixture.json'),JSON.stringify({manifest:body+signature+'\n',publicKey:raw.toString('hex'),sha256:digest,artifact:Array.from(artifact)}));
console.log('Generated untracked development fixture: .build/publisher-fixtures/fixture.json');
