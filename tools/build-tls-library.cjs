// Rebuild the pinned C3 SDK's SSL objects with a smaller transmit buffer.
// Certificate roots, certificate verification and crypto objects remain in the SDK.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

const SOURCE = '9d669eadb1955d348986b9280156710aaaadf79f';
const ARCHIVE_SHA = '45f5e3ca387dfc1dbc41bd221f56971a6d254eb1a88d8a0faadfa9e0d193719d';
const INPUT = 16384, OUTPUT = 4096;
const headers = ['mbedtls/ssl.h','mbedtls/build_info.h','mbedtls/x509_crt.h','mbedtls/pk.h'];
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
function properties(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const equal = line.indexOf('=');
    if (equal > 0) result[line.slice(0,equal)] = line.slice(equal+1);
  }
  return result;
}
function run(command,args,options={}) {
  const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true,...options});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`${path.basename(command)} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
function tool(directory,name) {
  const file=path.join(directory,name);
  return process.platform==='win32'&&fs.existsSync(file+'.exe')?file+'.exe':file;
}
function exported(text,selected) {
  const result=new Set();let member;
  for(const line of text.split(/\r?\n/)) {
    if(line.endsWith(':'))member=line.slice(0,-1);
    const symbol=line.match(/^[0-9a-fA-F]+\s+[A-Za-z]\s+(\S+)$/);
    if(symbol&&(!selected||selected.has(member)))result.add(symbol[1]);
  }
  return result;
}
function layout(text) {
  const result={};
  for(const line of text.split(/\r?\n/)) {
    const value=line.match(/^[0-9a-fA-F]+\s+([0-9a-fA-F]+)\s+\w\s+(probe_\w+)$/);
    if(value)result[value[2]]=parseInt(value[1],16);
  }
  return result;
}
function validateExports(before,after) {
  if(!before.size||!after.size||before.size!==after.size||[...before].some(name=>!after.has(name)))throw Error('Optimized TLS exports differ from the SDK or could not be read.');
}
function validateLayouts(sdkLayout,newLayout) {
  for(const name of ['probe_context','probe_config','probe_session']) {
    if(!Number.isSafeInteger(sdkLayout[name])||sdkLayout[name]<=0||sdkLayout[name]!==newLayout[name])throw Error('TLS public ABI changed or probe missing: '+name);
  }
  if(sdkLayout.probe_input!==INPUT||sdkLayout.probe_output!==INPUT)throw Error('Unexpected SDK TLS buffer configuration.');
  if(newLayout.probe_input!==INPUT||newLayout.probe_output!==OUTPUT)throw Error('TLS buffer configuration did not apply.');
}
async function ensureTlsLibrary({cli,board,sketch,root}) {
  const props=properties(run(cli,['compile','--fqbn',board,'--build-path',path.join(root,'.build/tls-properties'),'--show-properties=expanded',sketch]));
  if(props['build.mcu']!=='esp32c3')throw Error('The optimized TLS build currently targets ESP32-C3.');
  if(props.version!=='3.3.11')throw Error('Install the pinned ESP32 Arduino core 3.3.11 before building optimized TLS.');
  const sdk=props['compiler.sdk.path'],bin=props['compiler.path'];
  if(!sdk||!bin||!props['compiler.c.cmd'])throw Error('Arduino did not return the SDK/toolchain paths.');
  const sdkHeaders=path.join(sdk,'include/mbedtls/mbedtls/include');
  const config=path.join(sdk,props['build.memory_type']||'qio_qspi','include');
  const flags=path.join(sdk,'flags');
  const original=path.join(sdk,'lib/libmbedtls_2.a');
  const version=fs.readFileSync(path.join(sdkHeaders,'mbedtls/build_info.h'),'utf8');
  if(!version.includes('MBEDTLS_VERSION_STRING         "3.6.6"'))throw Error('Install the pinned ESP32 Arduino core 3.3.11 before building optimized TLS.');
  const compiler=tool(bin,props['compiler.c.cmd']);
  const stem=props['compiler.c.cmd'].replace(/gcc(?:\.exe)?$/,'');
  const ar=tool(bin,stem+'ar'),nm=tool(bin,stem+'nm');
  const settings=['c_flags','defines','includes'].map(name=>fs.readFileSync(path.join(flags,name)));
  const fingerprint=digest(Buffer.concat([Buffer.from(SOURCE+INPUT+':'+OUTPUT+run(compiler,['--version'])),
    ...settings,...headers.map(name=>fs.readFileSync(path.join(sdkHeaders,name))),
    fs.readFileSync(path.join(config,'sdkconfig.h')),fs.readFileSync(original),fs.readFileSync(__filename)]));
  const cache=path.join(root,'.build/tls-library',fingerprint);fs.mkdirSync(cache,{recursive:true});
  const library=path.join(cache,'libmbedtls-ota.a'),recordPath=path.join(cache,'build.json');
  if(fs.existsSync(library)&&fs.existsSync(recordPath)) {
    const record=JSON.parse(fs.readFileSync(recordPath,'utf8'));
    if(record.fingerprint===fingerprint&&record.sha256===digest(fs.readFileSync(library)))return library;
  }
  const archive=path.join(root,'.build/tls-library','source-'+SOURCE+'.tar.gz');
  if(!fs.existsSync(archive)||digest(fs.readFileSync(archive))!==ARCHIVE_SHA) {
    const response=await fetch('https://codeload.github.com/espressif/mbedtls/tar.gz/'+SOURCE,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('Could not download the pinned TLS source: HTTP '+response.status);
    const data=Buffer.from(await response.arrayBuffer());
    if(data.length>25000000||digest(data)!==ARCHIVE_SHA)throw Error('TLS source archive verification failed.');
    fs.writeFileSync(archive,data);
  }
  const prefix='mbedtls-'+SOURCE;
  run('tar',['-xzf',archive,'-C',cache,prefix+'/library',prefix+'/include']);
  const source=path.join(cache,prefix);
  for(const name of headers) {
    if(!fs.readFileSync(path.join(source,'include',name)).equals(fs.readFileSync(path.join(sdkHeaders,name))))throw Error('TLS source/SDK header mismatch: '+name);
  }
  const base=['-c','-Os','-mabi=ilp32','@'+path.join(flags,'c_flags'),'@'+path.join(flags,'defines'),
    '-I'+config,'-I'+path.join(source,'library'),'-iprefix',path.join(sdk,'include')+path.sep,'@'+path.join(flags,'includes')];
  const small=['-DCONFIG_MBEDTLS_ASYMMETRIC_CONTENT_LEN=1','-DCONFIG_MBEDTLS_SSL_IN_CONTENT_LEN='+INPUT,'-DCONFIG_MBEDTLS_SSL_OUT_CONTENT_LEN='+OUTPUT];
  const members=run(ar,['t',original]).trim().split(/\r?\n/).filter(name=>name.startsWith('ssl_')||name.startsWith('mps_')||name==='debug.c.obj');
  if(!members.includes('ssl_tls.c.obj')||!members.includes('ssl_msg.c.obj'))throw Error('Unexpected SDK TLS archive.');
  const objects=[];
  for(const name of members) {
    if(!/^[a-z0-9_]+\.c\.obj$/.test(name))throw Error('Unexpected TLS object name.');
    const file=path.join(source,'library',name.slice(0,-4)),output=path.join(cache,name);
    run(compiler,[...base,...small,file,'-o',output]);objects.push(output);
  }
  if(fs.existsSync(library))fs.unlinkSync(library);
  run(ar,['rcs',library,...objects]);
  const before=exported(run(nm,['-g','--defined-only',original]),new Set(members));
  const after=exported(run(nm,['-g','--defined-only',library]));
  validateExports(before,after);
  const probe=path.join(cache,'abi.c');
  fs.writeFileSync(probe,'#include <mbedtls/ssl.h>\nchar probe_context[sizeof(mbedtls_ssl_context)];\nchar probe_config[sizeof(mbedtls_ssl_config)];\nchar probe_session[sizeof(mbedtls_ssl_session)];\nchar probe_input[MBEDTLS_SSL_IN_CONTENT_LEN];\nchar probe_output[MBEDTLS_SSL_OUT_CONTENT_LEN];\n');
  const layouts=[];
  for(const [name,options] of [['sdk',[]],['small',small]]) {
    const output=path.join(cache,'abi-'+name+'.o');run(compiler,[...base,...options,probe,'-o',output]);
    layouts.push(layout(run(nm,['-S','--defined-only',output])));
  }
  const [sdkLayout,newLayout]=layouts;
  validateLayouts(sdkLayout,newLayout);
  fs.writeFileSync(recordPath,JSON.stringify({fingerprint,source:SOURCE,sourceSha256:ARCHIVE_SHA,sha256:digest(fs.readFileSync(library)),layouts,members},null,2)+'\n');
  console.log('Built verified C3 TLS library: 16 KB receive / 4 KB transmit.');
  return library;
}
module.exports={ensureTlsLibrary,properties,exported,layout,validateExports,validateLayouts,INPUT,OUTPUT,SOURCE,ARCHIVE_SHA};
