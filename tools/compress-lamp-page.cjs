const zlib=require('node:zlib');
const crypto=require('node:crypto');
const {minify_sync}=require('terser');
const {gzipAsync}=require('@gfx/zopfli');

const TOOLCHAIN=Object.freeze({terser:'5.51.4',zopfli:'1.0.15'});
const TERSER_PASSES=3,ZOPFLI_ITERATIONS=200;
const terserOptions=()=>({ecma:2020,toplevel:true,mangle:{toplevel:true},compress:{passes:TERSER_PASSES,booleans_as_integers:true},format:{comments:false,ascii_only:true}});
const zopfliOptions=()=>({numiterations:ZOPFLI_ITERATIONS,blocksplitting:true,blocksplittingmax:15});
if(require('terser/package.json').version!==TOOLCHAIN.terser||require('@gfx/zopfli/package.json').version!==TOOLCHAIN.zopfli){
 throw Error('Install the pinned Lamp page optimizer dependencies with npm ci in tools.');
}

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function standalonePage(source,{start='R"HTML(',end=')HTML";'}={}){
 if(typeof source!=='string')throw Error('Mapped page source text is required.');
 const first=source.indexOf(start),last=source.lastIndexOf(end);
 if(first<0||last<=first||source.indexOf(start,first+start.length)>=0||source.indexOf(end)!==last)throw Error('Expected one standalone setup page.');
 const page=Buffer.from(source.slice(first+start.length,last),'utf8');
 if(!page.length||page.length>65536)throw Error('Setup page exceeds the bounded mapped response.');
 return page;
}

function mappedAsset(page,gzip,{symbol='LAMP_PAGE_GZIP',report}={}){
 if(!/^[A-Z][A-Z0-9_]*$/.test(symbol))throw Error('Invalid mapped page symbol.');
 if(!Buffer.isBuffer(page)||!page.length||page.length>65536)throw Error('Setup page exceeds the bounded mapped response.');
 if(!Buffer.isBuffer(gzip)||!gzip.length||gzip.length>65536||!zlib.gunzipSync(gzip).equals(page))throw Error('Setup page compression failed verification.');
 const lines=[];for(let at=0;at<gzip.length;at+=24)lines.push(' '+Array.from(gzip.subarray(at,at+24),byte=>'0x'+byte.toString(16).padStart(2,'0')).join(',')+',');
 const header='#pragma once\n#include <Arduino.h>\nstatic const uint8_t '+symbol+'[] PROGMEM={\n'+lines.join('\n')+'\n};\nstatic constexpr size_t '+symbol+'_SIZE=sizeof('+symbol+');\n';
 return {page,gzip,header,report:report||{version:1,rawBytes:page.length,gzipBytes:gzip.length,rawSha256:sha(page),gzipSha256:sha(gzip),noRuntimeCompression:true}};
}

function compressedAsset(page,{symbol='LAMP_PAGE_GZIP'}={}){
 if(!Buffer.isBuffer(page))throw Error('Mapped asset bytes are required.');
 if(!page.length||page.length>65536)throw Error('Setup page exceeds the bounded mapped response.');
 const gzip=zlib.gzipSync(page,{level:9});
 return mappedAsset(page,gzip,{symbol});
}

function compressedPage(source,{start='R"HTML(',end=')HTML";',symbol='LAMP_PAGE_GZIP'}={}){
 return compressedAsset(standalonePage(source,{start,end}),{symbol});
}

function minifiedPage(source,{start='R"HTML(',end=')HTML";'}={}){
 const originalPage=standalonePage(source,{start,end});
 const original=originalPage.toString('utf8');
 const scripts=[...original.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 if(scripts.length!==1||original.match(/<script\b/gi)?.length!==1||original.match(/<\/script>/gi)?.length!==1){
  throw Error('Expected one inline setup page script without attributes.');
 }
 const result=minify_sync(scripts[0][1],terserOptions());
 if(result.error||typeof result.code!=='string'||!result.code.length)throw result.error||Error('Setup page script minification failed.');
 const markup=fragment=>fragment
  .replace(/>\s*\r?\n\s*</g,'><')
  .replace('<style>\r\n','<style>').replace('<style>\n','<style>')
  .replace('\r\n</style>','</style>').replace('\n</style>','</style>')
  .replace(/<[A-Za-z][^>]*>/g,tag=>tag.replace(/([\t ])([A-Za-z_:][-A-Za-z0-9_:.]*)="([^\s"'`=<>]+)"/g,'$1$2=$3'))
  .replace('</head><body>','<body>').replace('</body></html>','').trim();
 const minified=markup(original.slice(0,scripts[0].index))+'<script>'+result.code+'</script>'+markup(original.slice(scripts[0].index+scripts[0][0].length));
 const page=Buffer.from(minified,'utf8');
 if(!page.length||page.length>originalPage.length||page.length>65536)throw Error('Setup page minification failed verification.');
 return {originalPage,page};
}

async function optimizedPage(source,{start='R"HTML(',end=')HTML";',symbol='LAMP_PAGE_GZIP'}={}){
 const {originalPage,page}=minifiedPage(source,{start,end});
 const gzip=Buffer.from(await gzipAsync(page,zopfliOptions()));
 const report={
  version:2,
  rawBytes:originalPage.length,
  minifiedBytes:page.length,
  gzipBytes:gzip.length,
  rawSha256:sha(originalPage),
  minifiedSha256:sha(page),
  gzipSha256:sha(gzip),
  optimizer:{terser:TOOLCHAIN.terser,zopfli:TOOLCHAIN.zopfli,terserPasses:TERSER_PASSES,zopfliIterations:ZOPFLI_ITERATIONS},
  noRuntimeCompression:true
 };
 return mappedAsset(page,gzip,{symbol,report});
}
module.exports={compressedPage,compressedAsset,minifiedPage,optimizedPage};
