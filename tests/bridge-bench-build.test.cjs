const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {loadBenchFixture,stageBridge}=require('../tools/build-bridge.cjs');
const {manifestFor}=require('../tools/package-firmware.cjs');
const root=path.resolve(__dirname,'..');
function fixture(directory){
 // Image-shaped packaging fixture only; actual image/cache verification is
 // exercised by bridge-bench-runtime.py, not inferred from this byte buffer.
 const image=Buffer.alloc(512);image[0]=0xe9;image.writeUInt16LE(5,12);image.writeUInt32LE(0xabcd5432,32);
 image.write('COOLLAMP-PUBLIC-1.15.5\0',300);image.write('COOLLAMP-TEST-IMAGE-1.15.5',400);
 fs.writeFileSync(path.join(directory,'candidate.bin'),image);
 return {version:1,target:'5894af4aec24',firmwareVersion:'1.15.5',image:'candidate.bin',size:image.length,
  sha256:crypto.createHash('sha256').update(image).digest('hex'),manifest:manifestFor(image,'1.15.5',{testImage:true}),lifetimeMs:1200000};
}
function temporary(action){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'coollamp-bench-builder-'));try{return action(directory);}finally{fs.rmSync(directory,{recursive:true,force:true});}}
test('bench builder pins exact diagnostic image, receiver, manifest and bounded lifetime',()=>temporary(directory=>{
 const value=fixture(directory),input=path.join(directory,'fixture.json');fs.writeFileSync(input,JSON.stringify(value));
 const result=loadBenchFixture(input);assert.equal(result.provenance.imageBytes,value.size);assert.equal(result.provenance.imageSha256,value.sha256);
 assert.equal(result.provenance.publicationProhibited,true);assert.equal(result.provenance.activation,'one-shot-local-usb-only');
 assert.match(result.header.toString(),/TargetMac\[6\]=\{0x24,0xec,0x4a,0xaf,0x94,0x58\}/);
 for(const changes of [{target:'8c4856dab734'},{firmwareVersion:'1.15.4'},{version:2},{size:513},{sha256:'0'.repeat(64)},
  {manifest:value.manifest+'\n'},{manifest:value.manifest.replace('esp32c3','esp32s3')},{lifetimeMs:1200001},{lifetimeMs:0},{lifetimeMs:-1},
  {lifetimeMs:1.5},{password:'not-allowed'},{image:''}]){
  fs.writeFileSync(input,JSON.stringify({...value,...changes}));assert.throws(()=>loadBenchFixture(input));
 }
 for(const key of ['size','sha256','manifest','target','lifetimeMs']){const changed={...value};delete changed[key];fs.writeFileSync(input,JSON.stringify(changed));assert.throws(()=>loadBenchFixture(input));}
 fs.writeFileSync(input,JSON.stringify(value));const changed=fs.readFileSync(path.join(directory,'candidate.bin'));changed[500]^=1;fs.writeFileSync(path.join(directory,'candidate.bin'),changed);assert.throws(()=>loadBenchFixture(input));
}));
test('bench stage is isolated and never changes the normal stage or pins normal builds',()=>temporary(directory=>{
 for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isFile()&&/\.(h|cpp|ino)$/.test(entry.name)&&entry.name!=='LampSecrets.h')fs.copyFileSync(path.join(root,entry.name),path.join(directory,entry.name));
 fs.cpSync(path.join(root,'bridge'),path.join(directory,'bridge'),{recursive:true});
 fs.mkdirSync(path.join(directory,'examples','CoolLampBridge'),{recursive:true});fs.copyFileSync(path.join(root,'examples','CoolLampBridge','CoolLampBridge.ino'),path.join(directory,'examples','CoolLampBridge','CoolLampBridge.ino'));
 const value=fixture(directory),input=path.join(directory,'fixture.json');fs.writeFileSync(input,JSON.stringify(value));const pin=loadBenchFixture(input);
 const normal=stageBridge(directory),before=fs.readFileSync(path.join(normal.stageRoot,'source-provenance.json'));
 assert.equal(fs.existsSync(path.join(normal.sketch,'BridgeBenchFixture.generated.h')),false);
 const staged=stageBridge(directory,{benchFixture:pin});assert.equal(staged.stageRoot,path.join(directory,'.build','bridge-bench','sketch'));
 assert.equal(fs.readFileSync(path.join(staged.sketch,'BridgeBenchFixture.generated.h'),'utf8'),pin.header.toString());
 assert.deepEqual(fs.readFileSync(path.join(normal.stageRoot,'source-provenance.json')),before);
 assert.equal(JSON.parse(fs.readFileSync(path.join(staged.stageRoot,'source-provenance.json'))).developmentBench.publicationProhibited,true);
 stageBridge(directory);assert.equal(fs.existsSync(path.join(normal.sketch,'BridgeBenchFixture.generated.h')),false);
}));
test('bench loader rejects oversized JSON and mismatched image stat before reading artifacts',()=>temporary(directory=>{
 const value=fixture(directory),input=path.join(directory,'fixture.json');
 fs.writeFileSync(input,JSON.stringify(value)+' '.repeat(2049));assert.throws(()=>loadBenchFixture(input));
 fs.writeFileSync(input,JSON.stringify({...value,size:2031617}));assert.throws(()=>loadBenchFixture(input));
 fs.writeFileSync(input,JSON.stringify({...value,size:287}));assert.throws(()=>loadBenchFixture(input));
 fs.writeFileSync(input,JSON.stringify(value));
 const fd=fs.openSync(path.join(directory,'candidate.bin'),'r+');
 try{fs.ftruncateSync(fd,2031617);}finally{fs.closeSync(fd);}
 assert.throws(()=>loadBenchFixture(input));
}));
