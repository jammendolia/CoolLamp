const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib');
const {compressedPage}=require('../tools/compress-lamp-page.cjs');
test('production page staging is deterministic, byte exact and flash mapped',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../LampPage.h'),'utf8'),a=compressedPage(source),b=compressedPage(source);
 assert(a.gzip.equals(b.gzip));assert.equal(a.header,b.header);assert(zlib.gunzipSync(a.gzip).equals(a.page));
 assert(a.gzip.length<a.page.length);assert(a.gzip.includes(0));assert(a.header.includes('PROGMEM'));
 assert(a.header.includes('LAMP_PAGE_GZIP_SIZE=sizeof(LAMP_PAGE_GZIP)'));assert(a.report.noRuntimeCompression);
 const encoded=Buffer.from([...a.header.matchAll(/0x([0-9a-f]{2})/g)].map(match=>parseInt(match[1],16)));assert(encoded.equals(a.gzip));
});
test('UTF8, embedded nulls and binary length survive the real compressor',()=>{
 const a=compressedPage('prefix R"HTML(<html>café \0 lamp</html>)HTML"; suffix');
 assert.equal(zlib.gunzipSync(a.gzip).toString('utf8'),'<html>café \0 lamp</html>');assert(a.gzip.length>0);
});
test('missing, duplicated, empty or oversized page fails closed',()=>{
 for(const source of ['', 'R"HTML()HTML";', 'R"HTML(a)HTML"; R"HTML(b)HTML";', 'R"HTML('+ 'x'.repeat(65537)+')HTML";'])assert.throws(()=>compressedPage(source));
});
