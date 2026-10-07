const test = require('node:test');
const assert = require('node:assert/strict');
const tls = require('../tools/build-tls-library.cjs');

test('Arduino properties preserve Windows paths and embedded equals', () => {
  assert.deepEqual(tls.properties('compiler.path=C:\\SDK tools\\bin\\\r\nx=a=b\r\nignored'),
    {'compiler.path':'C:\\SDK tools\\bin\\',x:'a=b'});
});
test('exports select SSL members and reject empty or changed symbol sets', () => {
  const symbols = tls.exported('ssl_tls.c.obj:\r\n00000000 T ssl_one\r\nother.c.obj:\r\n00000000 T other\r\n',new Set(['ssl_tls.c.obj']));
  assert.deepEqual([...symbols],['ssl_one']);
  tls.validateExports(symbols,new Set(['ssl_one']));
  assert.throws(()=>tls.validateExports(new Set(),new Set()));
  assert.throws(()=>tls.validateExports(symbols,new Set(['different'])));
});
test('ABI probes require all structures and exact SDK and reduced buffer sizes', () => {
  const sdk = {probe_context:128,probe_config:256,probe_session:64,probe_input:16384,probe_output:16384};
  const small = {...sdk,probe_output:4096};
  tls.validateLayouts(sdk,small);
  for(const key of Object.keys(sdk)) {
    const missing = {...sdk}; delete missing[key];
    assert.throws(()=>tls.validateLayouts(missing,small));
    assert.throws(()=>tls.validateLayouts(sdk,{...small,[key]:0}));
  }
  assert.throws(()=>tls.validateLayouts({},{}));
  assert.deepEqual(tls.layout('00000000 00004000 B probe_input\r\n00004000 00001000 B probe_output\r\n'),{probe_input:16384,probe_output:4096});
});

test('unsupported target, source digest, and corrupt cache fail closed', async () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const vm = require('node:vm');
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'coollamp-tls-'));
  try {
    const sdk = path.join(root,'SDK with spaces');
    const header = path.join(sdk,'include/mbedtls/mbedtls/include/mbedtls/build_info.h');
    const put = (name,data) => {fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,data);};
    put(header,'MBEDTLS_VERSION_STRING         "3.6.6"');
    for(const name of ['ssl.h','x509_crt.h','pk.h'])put(path.join(path.dirname(header),name),'public header');
    put(path.join(sdk,'qio_qspi/include/sdkconfig.h'),'sdk config');
    put(path.join(sdk,'lib/libmbedtls_2.a'),'original SDK archive');
    for(const name of ['c_flags','defines','includes'])put(path.join(sdk,'flags',name),'');
    let target = 'esp32s3', downloads = 0;
    const filename = require.resolve('../tools/build-tls-library.cjs');
    const context = {module:{exports:{}},__filename:filename,process,Buffer,AbortSignal,console,
      fetch:async()=>{downloads++;return {ok:true,arrayBuffer:async()=>Buffer.from('wrong source archive')};},
      require:name=>name==='node:child_process'?{spawnSync:(_command,args)=>({status:0,stdout:args[0]==='compile'
        ? `version=3.3.11\nbuild.mcu=${target}\ncompiler.sdk.path=${sdk}\ncompiler.path=${root}\ncompiler.c.cmd=riscv-gcc\n`
        : 'pinned compiler',stderr:''})}:require(name)};
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),context);
    const build = ()=>context.module.exports.ensureTlsLibrary({cli:'mock-cli',board:'board',sketch:root,root});
    await assert.rejects(build(),/ESP32-C3/);
    assert.equal(downloads,0);
    target='esp32c3';
    put(header,'wrong SDK version');
    await assert.rejects(build(),/pinned ESP32/);
    put(header,'MBEDTLS_VERSION_STRING         "3.6.6"');
    await assert.rejects(build(),/archive verification failed/);
    const cacheRoot=path.join(root,'.build/tls-library');
    const fingerprint=fs.readdirSync(cacheRoot)[0];
    const cache=path.join(cacheRoot,fingerprint);
    put(path.join(cache,'libmbedtls-ota.a'),'corrupt cached archive');
    put(path.join(cache,'build.json'),JSON.stringify({fingerprint,sha256:'wrong hash'}));
    await assert.rejects(build(),/archive verification failed/);
    assert.equal(downloads,2);
    const sha256=require('node:crypto').createHash('sha256').update('corrupt cached archive').digest('hex');
    put(path.join(cache,'build.json'),JSON.stringify({fingerprint,sha256}));
    assert.equal(await build(),path.join(cache,'libmbedtls-ota.a'));
    assert.equal(downloads,2,'verified cache avoids fetching source again');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
