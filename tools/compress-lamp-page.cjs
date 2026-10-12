const zlib=require('node:zlib');
const crypto=require('node:crypto');
function compressedPage(source){
 const start='R"HTML(',end=')HTML";',first=source.indexOf(start),last=source.lastIndexOf(end);
 if(first<0||last<=first||source.indexOf(start,first+start.length)>=0)throw Error('Expected one standalone setup page.');
 const page=Buffer.from(source.slice(first+start.length,last),'utf8');
 if(!page.length||page.length>65536)throw Error('Setup page exceeds the bounded mapped response.');
 const gzip=zlib.gzipSync(page,{level:9});
 if(!gzip.length||gzip.length>65536||!zlib.gunzipSync(gzip).equals(page))throw Error('Setup page compression failed verification.');
 const lines=[];for(let at=0;at<gzip.length;at+=24)lines.push(' '+Array.from(gzip.subarray(at,at+24),byte=>'0x'+byte.toString(16).padStart(2,'0')).join(',')+',');
 const header='#pragma once\n#include <Arduino.h>\nstatic const uint8_t LAMP_PAGE_GZIP[] PROGMEM={\n'+lines.join('\n')+'\n};\nstatic constexpr size_t LAMP_PAGE_GZIP_SIZE=sizeof(LAMP_PAGE_GZIP);\n';
 const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 return {page,gzip,header,report:{version:1,rawBytes:page.length,gzipBytes:gzip.length,rawSha256:sha(page),gzipSha256:sha(gzip),noRuntimeCompression:true}};
}
module.exports={compressedPage};
