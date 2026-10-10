// Derive editable lamp illustrations and platform master from vector geometry.
// Reference photos are never copied into application or publication assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {lampArtworkSvg} from '../mobile/src/lamp-artwork.js';
const require=createRequire(import.meta.url),index=process.argv.indexOf('--sharp-module');
const sharp=require(index>=0?process.argv[index+1]:'sharp');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=path.join(root,'docs/design/assets');await fs.mkdir(assets,{recursive:true});
for(const style of ['helix','large-helix','corkscrew','knot']){
 const svg=lampArtworkSvg(style,{idPrefix:'asset-'+style,lit:style!=='knot'});
 await fs.writeFile(path.join(assets,'lamp-'+style+'.svg'),svg);
 await sharp(Buffer.from(svg)).resize(600,1000).png().toFile(path.join(assets,'lamp-'+style+'.png'));
}
const mark=lampArtworkSvg('helix',{idPrefix:'app-icon'});
await fs.writeFile(path.join(assets,'coollamp-icon-foreground.svg'),mark);
const master='<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#f6f3ed"/>'+mark.replace('<svg ','<svg x="212" y="52" width="600" height="920" ')+'</svg>';
await fs.writeFile(path.join(assets,'coollamp-icon-master.svg'),master);
const bytes=await sharp(Buffer.from(master)).removeAlpha().png().toBuffer();
await fs.writeFile(path.join(assets,'coollamp-icon-master.png'),bytes);
for(const size of [1024,512,192,64,32])await sharp(bytes).resize(size,size).png().toFile(path.join(assets,size===1024?'coollamp-icon.png':`coollamp-icon-${size}.png`));
await sharp(bytes).resize(192,192).png().toFile(path.join(root,'mobile/public/app-icon.png'));
console.log('Exported four lamp illustrations and the photo-informed app icon master.');
