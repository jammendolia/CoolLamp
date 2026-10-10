const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const trust=require('../tools/publisher-trust.cjs');
function config(){const pair=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'});return {version:1,minimumEpoch:1,keys:[{id:'00000042',firstEpoch:1,lastEpoch:9,publicKey:Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('hex')}]};}
test('public-only trust JSON is bounded, validated, emits immutable header and records exact provenance digest',()=>{
 const value=config(),directory=fs.mkdtempSync(path.resolve(__dirname,'../.build/publisher-config-test-'));
 try{const filename=path.join(directory,'public.json'),bytes=JSON.stringify(value);fs.writeFileSync(filename,bytes);const result=trust.load(filename);assert.equal(result.provenance.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(result.provenance.headerSha256,crypto.createHash('sha256').update(result.header).digest('hex'));assert.match(result.header,/publisherMinimumEpoch=1u/);assert.deepEqual(result.provenance.keyIds,['00000042']);assert(!result.header.includes('PRIVATE'));}finally{assert(fs.realpathSync(directory).startsWith(fs.realpathSync(path.resolve(__dirname,'../.build'))+path.sep));fs.rmSync(directory,{recursive:true,force:true});}
});
test('trust rejects private/unknown fields, malformed points, duplicate keys, capacity and epoch mistakes',()=>{
 const value=config();for(const bad of [{...value,privateKey:'must never stage'}, {...value,version:2},{...value,minimumEpoch:0},{...value,minimumEpoch:10},{...value,keys:[]},{...value,keys:[...value.keys,...value.keys]}, {...value,keys:[{...value.keys[0],privateKey:'secret'}]},{...value,keys:[{...value.keys[0],publicKey:'04'+'00'.repeat(64)}]},{...value,keys:[{...value.keys[0],lastEpoch:0xffffffff}]},{...value,keys:[{...value.keys[0],firstEpoch:10,lastEpoch:9}]},{...value,keys:[{...value.keys[0],id:'00000000'}]},{...value,keys:Array.from({length:5},(_,i)=>({...value.keys[0],id:(i+1).toString(16).padStart(8,'0')}))}])assert.throws(()=>trust.validate(bad));
});
test('actual build helper combines public/provisioned flags, stages only generated public header, and leaves default args unchanged',async()=>{
 const vm=require('node:vm'),source=fs.readFileSync(path.resolve(__dirname,'../tools/build-firmware.cjs'),'utf8');
 for(const configured of [false,true]){
  const writes=new Map(),configuration={header:trust.header(config()),provenance:{sha256:'a'.repeat(64),keyIds:['00000042']}};let command;
  const virtualFs={existsSync:()=>false,mkdirSync:()=>{},readdirSync:()=>[],writeFileSync:(file,bytes)=>writes.set(file,bytes)};
  const processContext={argv:['node','helper','--public',...(configured?['--publisher-trust=public.json']:[])],env:{ARDUINO_CLI:'mock-cli'},platform:'win32'};
  const context={__dirname:path.resolve(__dirname,'../tools'),process:processContext,console:{log:()=>{},error:()=>{}},require:name=>name==='node:fs'?virtualFs:name==='node:child_process'?{spawnSync:(cli,args)=>{command={cli,args};return {status:0};}}:name==='./build-tls-library.cjs'?{ensureTlsLibrary:async()=>'/sdk/tls.a'}:name==='./publisher-trust.cjs'?{load:()=>configuration}:require(name)};
  await vm.runInNewContext(source,context);
  assert.equal(command.cli,'mock-cli');assert(command.args.includes('esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=no_fs'));
  const flags=Array.from(command.args).filter(value=>value.startsWith('compiler.cpp.extra_flags='));assert.deepEqual(flags,['compiler.cpp.extra_flags=-DCOOL_LAMP_PUBLIC_RELEASE=1'+(configured?' -DCOOL_LAMP_PUBLISHER_TRUST_PROVISIONED=1':'')]);
  assert.equal([...writes.keys()].some(file=>file.endsWith('LampPublisherTrust.generated.h')),configured);
  if(configured)assert([...writes.entries()].some(([file,bytes])=>file.endsWith('publisher-trust-public.json')&&JSON.parse(bytes).sha256===configuration.provenance.sha256));
  assert.equal(processContext.exitCode,0);
 }
});
