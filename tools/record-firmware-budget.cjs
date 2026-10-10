// Record local build evidence. No flashing, signing or publication.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const [label,logName]=process.argv.slice(2);
if(!/^[a-z][a-z0-9-]{1,60}$/.test(label||'')||!logName)throw Error('Use a bounded profile label and build-log path.');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const log=fs.readFileSync(path.resolve(root,logName),'utf8');
const program=/Sketch uses (\d+) bytes.*Maximum is (\d+) bytes/.exec(log);
const globals=/Global variables use (\d+) bytes.*leaving (\d+) bytes.*Maximum is (\d+) bytes/.exec(log);
if(!program||!globals)throw Error('A successful compiler size report is required.');
const stage=path.join(root,'.build/sketch-public/CoolLamp');
const destination=path.join(root,'.build/experience-'+label);fs.mkdirSync(destination,{recursive:true});
const files=['CoolLamp.ino.bin','CoolLamp.ino.elf','CoolLamp.ino.map','CoolLamp.ino.partitions.bin','CoolLamp.ino.bootloader.bin'];
if(!fs.existsSync(path.join(stage,'LampPublisherTrust.generated.h')))files.push('coollamp-manifest.txt');
const artifacts={};for(const name of files){const bytes=fs.readFileSync(path.join(root,'firmware/public',name));fs.writeFileSync(path.join(destination,name),bytes);artifacts[name]={path:path.relative(root,path.join(destination,name)).replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)};}
const slot=Number(program[2]),binary=artifacts['CoolLamp.ino.bin'];if(binary.bytes>slot)throw Error('Actual binary exceeds OTA slot.');
const sourceHashes={};for(const name of fs.readdirSync(stage).filter(name=>/\.(ino|cpp|h)$/.test(name)))sourceHashes[name]=sha(fs.readFileSync(path.join(stage,name)));
const functions=new Map();let stackFiles=0;
function scan(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);if(entry.isDirectory())scan(target);else if(entry.name.endsWith('.su')){++stackFiles;for(const line of fs.readFileSync(target,'utf8').split(/\r?\n/)){const [location,bytes,bound]=line.split('\t');const match=/^(.*?):(\d+):(\d+):(.*)$/.exec(location||'');if(!match||!/^\d+$/.test(bytes||''))continue;const source=match[1].replaceAll('\\','/');if(!source.includes('/sketch-public/CoolLamp/'))continue;const name=path.basename(source),signature=match[4];const key=name+':'+signature,value={source:name,line:Number(match[2]),function:signature,bytes:Number(bytes),bound};if(!functions.has(key)||functions.get(key).bytes<value.bytes)functions.set(key,value);}}}}
scan(path.join(root,'.build/cache-public'));
const stack={files:stackFiles,firmwareFunctions:functions.size,largestFirmwareFunctions:[...functions.values()].sort((a,b)=>b.bytes-a.bytes).slice(0,30),limitations:'Per-function compiler estimates only; prebuilt SDK/TLS archives and caller chains excluded. Runtime high-water/heap measurement pending.'};
const reportPath=path.join(root,'.build/experience-artifacts.json');
const report=fs.existsSync(reportPath)?JSON.parse(fs.readFileSync(reportPath,'utf8')):{version:'1.15.0',hardwareTouched:false,publicationPerformed:false,slotBytes:slot,profiles:{}};
report.profiles[label]={programBytes:Number(program[1]),staticGlobalsBytes:Number(globals[1]),compilerArithmeticFreeBytes:Number(globals[2]),programMarginBytes:slot-Number(program[1]),binaryMarginBytes:slot-binary.bytes,publisherPublicRootsProvisioned:fs.existsSync(path.join(stage,'LampPublisherTrust.generated.h')),runtimeMeasured:false,artifacts,sourceHashes,stack};
fs.copyFileSync(path.resolve(root,logName),path.join(destination,'build.log'));
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(`${label}: actual binary ${binary.bytes}; OTA margin ${slot-binary.bytes}; static globals ${globals[1]}; evidence .build/experience-artifacts.json`);
