const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),vm=require('node:vm');
const {compressedPage,compressedAsset,optimizedPage}=require('../tools/compress-lamp-page.cjs');
test('production page staging is deterministic, optimized, byte exact and flash mapped',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../LampPage.h'),'utf8'),legacy=compressedPage(source),a=await optimizedPage(source),b=await optimizedPage(source);
 assert(a.page.equals(b.page));assert(a.gzip.equals(b.gzip));assert.equal(a.header,b.header);assert.deepEqual(a.report,b.report);assert(zlib.gunzipSync(a.gzip).equals(a.page));
 assert(a.gzip.length<a.page.length);assert(a.gzip.includes(0));assert(a.header.includes('PROGMEM'));
 assert(a.header.includes('LAMP_PAGE_GZIP_SIZE=sizeof(LAMP_PAGE_GZIP)'));assert(a.report.noRuntimeCompression);
 assert.equal(a.report.rawBytes,legacy.page.length);assert.equal(a.report.minifiedBytes,a.page.length);assert.equal(a.report.gzipBytes,a.gzip.length);
 assert(a.report.minifiedBytes<a.report.rawBytes);assert(legacy.gzip.length-a.gzip.length>=1200,`expected at least 1200 bytes saved, got ${legacy.gzip.length-a.gzip.length}`);
 assert.deepEqual(a.report.optimizer,{terser:'5.51.4',zopfli:'1.0.15',terserPasses:3,zopfliIterations:200});
 assert.match(a.page.toString(),/^<!doctype html><html lang=en><head>/);
 assert.match(a.page.toString(),/<body><h1>Cool Lamp<\/h1>/);
 assert.match(a.page.toString(),/<\/script>$/);
 const html=a.page.toString('utf8'),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,1);new vm.Script(scripts[0][1]);
 for(const contract of ['id=status','id=image','id=upload','/api/state/current','/api/firmware/upload/prepare','/api/firmware/upload/status','COOLLAMP-OTA-1'])assert(html.includes(contract),`missing page contract ${contract}`);
 const encoded=Buffer.from([...a.header.matchAll(/0x([0-9a-f]{2})/g)].map(match=>parseInt(match[1],16)));assert(encoded.equals(a.gzip));
});
test('UTF8, embedded nulls and arbitrary binary bytes survive the generic compressor',()=>{
 const a=compressedPage('prefix R"HTML(<html>café \0 lamp</html>)HTML"; suffix');
 assert.equal(zlib.gunzipSync(a.gzip).toString('utf8'),'<html>café \0 lamp</html>');assert(a.gzip.length>0);
 const binary=Buffer.from([0x00,0xff,0x80,0x7f,0x00,0xc3,0x28,0x0a]),b=compressedAsset(binary,{symbol:'BINARY_GZIP'});
 assert(zlib.gunzipSync(b.gzip).equals(binary));assert(b.header.includes('BINARY_GZIP_SIZE=sizeof(BINARY_GZIP)'));
});
test('missing, duplicated, empty or oversized page fails closed',()=>{
 for(const source of ['', 'R"HTML()HTML";', 'R"HTML(a)HTML"; R"HTML(b)HTML";', 'R"HTML('+ 'x'.repeat(65537)+')HTML";'])assert.throws(()=>compressedPage(source));
});
test('production optimizer rejects ambiguous or malformed scripts',async()=>{
 await assert.rejects(optimizedPage('R"HTML(<script>a()</script><script>b()</script>)HTML";'),/one inline setup page script/);
 await assert.rejects(optimizedPage('R"HTML(<script>a())HTML";'),/one inline setup page script/);
 await assert.rejects(optimizedPage('R"HTML(<script>function {</script>)HTML";'));
});
