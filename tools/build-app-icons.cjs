// Render the editable helix SVGs into native app icons. Requires Playwright and
// its Chromium browser; neither is bundled in the app. Run from the repo root.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const master=fs.readFileSync(path.join(root,'mobile/assets/app-icon.svg'),'utf8');
const foreground=fs.readFileSync(path.join(root,'mobile/assets/app-icon-foreground.svg'),'utf8');
const output=file=>path.join(root,file);
const densities=[['mdpi',48,108],['hdpi',72,162],['xhdpi',96,216],['xxhdpi',144,324],['xxxhdpi',192,432]];
// Chromium can write an RGBA PNG even for an opaque canvas. Apple's icon
// asset must omit the alpha channel, so losslessly re-encode opaque pixels as RGB.
function opaquePNG(png){
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
 if(png[25]===2)return png;
 if(png[24]!==8||png[25]!==6||png[28]!==0)throw Error('Unsupported generated PNG format.');
 const parts=[];for(let offset=8;offset<png.length;){const length=png.readUInt32BE(offset);if(png.toString('ascii',offset+4,offset+8)==='IDAT')parts.push(png.subarray(offset+8,offset+8+length));offset+=length+12;}
 const encoded=zlib.inflateSync(Buffer.concat(parts)),stride=width*4,pixels=Buffer.alloc(stride*height),rgb=Buffer.alloc((width*3+1)*height);
 const paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
 for(let y=0;y<height;y++){
  const filter=encoded[y*(stride+1)];if(filter>4)throw Error('Unknown PNG filter.');
  for(let x=0;x<stride;x++){
   const left=x>=4?pixels[y*stride+x-4]:0,up=y?pixels[(y-1)*stride+x]:0,corner=y&&x>=4?pixels[(y-1)*stride+x-4]:0;
   const prediction=[0,left,up,Math.floor((left+up)/2),paeth(left,up,corner)][filter];
   pixels[y*stride+x]=(encoded[y*(stride+1)+1+x]+prediction)&255;
  }
  for(let x=0;x<width;x++){
   const from=y*stride+x*4,to=y*(width*3+1)+1+x*3;
   if(pixels[from+3]!==255)throw Error('iOS app icon contains a transparent pixel.');
   pixels.copy(rgb,to,from,from+3);
  }
 }
 function chunk(type,data){
  const bytes=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const header=Buffer.alloc(4),footer=Buffer.alloc(4);header.writeUInt32BE(data.length);footer.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([header,bytes,footer]);
 }
 const ihdr=Buffer.from(png.subarray(16,29));ihdr[9]=2;
 return Buffer.concat([png.subarray(0,8),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(rgb,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  async function render(svg,size,mask='none',opaque=false){
   const encoded=await page.evaluate(async({svg,size,mask,opaque})=>{
    const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    const context=canvas.getContext('2d',{alpha:!opaque});
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    if(opaque){context.fillStyle='#10141d';context.fillRect(0,0,size,size);}
    if(mask==='circle'){context.beginPath();context.arc(size/2,size/2,size/2,0,Math.PI*2);context.clip();}
    if(mask==='rounded'){context.beginPath();context.roundRect(0,0,size,size,size*.21);context.clip();}
    context.drawImage(image,0,0,size,size);
    return canvas.toDataURL('image/png').split(',')[1];
   },{svg,size,mask,opaque});
   const png=Buffer.from(encoded,'base64');return opaque?opaquePNG(png):png;
  }
  fs.writeFileSync(output('mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'),await render(master,1024,'none',true));
  for(const [density,legacySize,foregroundSize] of densities){
   const dir=output('mobile/android/app/src/main/res/mipmap-'+density);
   fs.writeFileSync(path.join(dir,'ic_launcher.png'),await render(master,legacySize,'rounded'));
   fs.writeFileSync(path.join(dir,'ic_launcher_round.png'),await render(master,legacySize,'circle'));
   fs.writeFileSync(path.join(dir,'ic_launcher_foreground.png'),await render(foreground,foregroundSize));
  }
  const preview=output('docs/ui/previews/app-icon.png');
  fs.writeFileSync(preview,await render(master,1024,'none',true));
  // Preview typical home-screen sizes, including Android's circular safe crop.
  const imageURL='data:image/svg+xml;base64,'+Buffer.from(master).toString('base64');
  const foregroundURL='data:image/svg+xml;base64,'+Buffer.from(foreground).toString('base64');
  await page.setViewportSize({width:720,height:300});
  await page.setContent(`<style>
   *{box-sizing:border-box}body{margin:0;background:#10141d;color:#bbc4d4;font:13px -apple-system,BlinkMacSystemFont,sans-serif;padding:28px}
   h1{color:#f4f3ed;font-size:18px;margin:0 0 28px}section{display:flex;gap:32px;align-items:end}figure{margin:0;text-align:center}figcaption{margin-top:15px}
   img{display:block;border-radius:22%;}.adaptive{width:96px;height:96px;position:relative;border-radius:50%;overflow:hidden;background:#10141d;border:1px solid #394559}
   .adaptive img{position:absolute;width:144px;height:144px;left:-24px;top:-24px;border-radius:0}
   </style><h1>CoolLamp · Helix app icon</h1><section>
   ${[128,60,48,32].map(size=>`<figure><img src="${imageURL}" width="${size}" height="${size}"><figcaption>${size}px</figcaption></figure>`).join('')}
   <figure><div class="adaptive"><img src="${foregroundURL}"></div><figcaption>Android adaptive</figcaption></figure>
   </section>`);
  await page.screenshot({path:output('docs/ui/previews/app-icon-sizes.png')});
  console.log('Generated iOS 1024px icon, 15 Android density assets and two previews.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
