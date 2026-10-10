// Deterministic native exports of the approved CoolLamp 2 ribbon master.
// Sharp is local tooling only; no new dependency is included in the app.
// Usage: node tools/build-app2-icons.cjs --sharp-module /absolute/path/to/sharp
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const moduleIndex = process.argv.indexOf('--sharp-module');
const sharp = require(moduleIndex >= 0 ? process.argv[moduleIndex + 1] : 'sharp');
const source = path.join(root, 'docs/design/assets/coollamp-icon-master.png');
const background = { r: 3, g: 11, b: 24 };
const densities = [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]];
const clamp = value => Math.max(0, Math.min(1, value));

async function write(relative, bytes) {
  const destination = path.join(root, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
}

async function main() {
  const input = await sharp(source).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = input.info;
  if (width !== height || width < 1024 || channels !== 3) throw Error('Expected the approved opaque square RGB master.');
  const matte = Buffer.alloc(width * height * 4);
  let left = width, right = 0, top = height, bottom = 0;
  for (let i = 0; i < width * height; i++) {
    const r = input.data[i * 3], g = input.data[i * 3 + 1], b = input.data[i * 3 + 2];
    const x = i % width, y = Math.floor(i / width);
    // The approved mark is warm; the ink-blue backdrop keys out completely.
    // Retain a soft warm glow without bringing a square background into masks.
    let alpha = clamp(Math.min((r - 38) / 60, (r - b - 3) / 20));
    // The approved raster includes a warm floor reflection. Adaptive/themed
    // layers use the lamp itself; exclude that reflection below the base.
    if (y > height * 0.82 && (x < width * 0.393 || x > width * 0.609)) alpha = 0;
    alpha *= clamp((height * 0.883 - y) / 3);
    for (let channel = 0; channel < 3; channel++) {
      const value = [r, g, b][channel], base = [background.r, background.g, background.b][channel];
      matte[i * 4 + channel] = alpha ? Math.max(0, Math.min(255, Math.round((value - base * (1 - alpha)) / alpha))) : 0;
    }
    matte[i * 4 + 3] = Math.round(alpha * 255);
    if (alpha >= 0.96) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (left >= right || top >= bottom) throw Error('Could not isolate the approved ribbon silhouette.');
  const margin = 32;
  const crop = { left: Math.max(0, left - margin), top: Math.max(0, top - margin) };
  crop.width = Math.min(width, right + margin + 1) - crop.left;
  crop.height = Math.min(height, bottom + margin + 1) - crop.top;
  const cutout = await sharp(matte, { raw: { width, height, channels: 4 } }).extract(crop).png().toBuffer();
  const ios = await sharp(source).resize(1024, 1024).removeAlpha().png().toBuffer();
  await write('mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', ios);
  for (const [density, legacySize, layerSize] of densities) {
    const prefix = 'mobile/android/app/src/main/res/mipmap-' + density + '/';
    const legacy = await sharp(source).resize(legacySize, legacySize).removeAlpha().png().toBuffer();
    await write(prefix + 'ic_launcher.png', legacy);
    const circle = Buffer.from(`<svg width="${legacySize}" height="${legacySize}"><circle cx="${legacySize / 2}" cy="${legacySize / 2}" r="${legacySize / 2}" fill="white"/></svg>`);
    await write(prefix + 'ic_launcher_round.png', await sharp(legacy).ensureAlpha().composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer());
    const safeSize = Math.floor(layerSize * 66 / 108);
    const mark = await sharp(cutout).resize(safeSize, safeSize, { fit: 'inside' }).png().toBuffer();
    const metadata = await sharp(mark).metadata();
    const placement = { left: Math.floor((layerSize - metadata.width) / 2), top: Math.floor((layerSize - metadata.height) / 2) };
    const foreground = await sharp({ create: { width: layerSize, height: layerSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: mark, ...placement }]).png().toBuffer();
    await write(prefix + 'ic_launcher_foreground.png', foreground);
    const pixels = await sharp(foreground).raw().toBuffer();
    for (let i = 0; i < layerSize * layerSize; i++) {
      const alpha = pixels[i * 4 + 3];
      pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = 255;
      pixels[i * 4 + 3] = Math.round(clamp((alpha - 200) / 55) * 255);
    }
    await write(prefix + 'ic_launcher_monochrome.png', await sharp(pixels, { raw: { width: layerSize, height: layerSize, channels: 4 } }).png().toBuffer());
  }
  await write('mobile/android/app/src/main/res/values/ic_launcher_background.xml', Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#030B18</color>\n</resources>\n'));
  await write('mobile/android/app/src/main/res/drawable/ic_launcher_background.xml', Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n    <path android:fillColor="#030B18" android:pathData="M0,0h108v108h-108z"/>\n</vector>\n'));
  const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n';
  await write('mobile/android/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml', Buffer.from(adaptive));
  await write('mobile/android/app/src/main/res/mipmap-anydpi-v33/ic_launcher_round.xml', Buffer.from(adaptive));
  const iosMetadata = await sharp(ios).metadata();
  if (iosMetadata.width !== 1024 || iosMetadata.height !== 1024 || iosMetadata.hasAlpha || iosMetadata.channels !== 3) throw Error('iOS icon must be 1024 RGB without alpha.');
  for (const [density, legacySize, layerSize] of densities) {
    for (const [filename, expectedSize, alpha] of [['ic_launcher.png', legacySize, false], ['ic_launcher_round.png', legacySize, true], ['ic_launcher_foreground.png', layerSize, true], ['ic_launcher_monochrome.png', layerSize, true]]) {
      const metadata = await sharp(path.join(root, 'mobile/android/app/src/main/res/mipmap-' + density, filename)).metadata();
      if (metadata.width !== expectedSize || metadata.height !== expectedSize || metadata.hasAlpha !== alpha) throw Error('Invalid Android export: ' + density + '/' + filename);
    }
  }
  if (process.argv.includes('--preview')) {
    const circle = Buffer.from('<svg width="288" height="288"><circle cx="144" cy="144" r="144" fill="white"/></svg>');
    const previews = [];
    for (const filename of ['ic_launcher_foreground.png', 'ic_launcher_monochrome.png']) {
      const mark = await sharp(path.join(root, 'mobile/android/app/src/main/res/mipmap-xxxhdpi', filename)).extract({ left: 72, top: 72, width: 288, height: 288 }).png().toBuffer();
      const painted = await sharp({ create: { width: 288, height: 288, channels: 4, background: filename.includes('monochrome') ? '#617767' : '#030b18' } }).composite([{ input: mark }]).png().toBuffer();
      previews.push(await sharp(painted).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer());
    }
    await write('.build/app2-icon-preview.png', await sharp({ create: { width: 720, height: 340, channels: 3, background: '#161b25' } }).composite([{ input: previews[0], left: 48, top: 26 }, { input: previews[1], left: 384, top: 26 }]).png().toBuffer());
  }
  console.log(JSON.stringify({ source: path.relative(root, source), ios: { width: 1024, height: 1024, channels: 3, alpha: false }, android: { densities: densities.length, pngs: 20, safeRegionDp: 66, layerDp: 108 }, crop }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
