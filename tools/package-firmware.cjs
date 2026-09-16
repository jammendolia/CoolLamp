const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function parseVersion(version) {
  if (typeof version !== 'string' || version.trim() !== version) throw Error('Invalid firmware version.');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw Error('Use a stable major.minor.patch version.');
  const values = version.split('.').map(Number);
  if (values.some(n => n > 65535)) throw Error('Version component exceeds 65535.');
  return values;
}
function manifestFor(image, version) {
  parseVersion(version);
  if (image.length < 288 || image.length > 2031616 || image[0] !== 0xe9 || image.readUInt16LE(12) !== 5 || image.readUInt32LE(32) !== 0xabcd5432) throw Error('Not a compatible ESP32-C3 application image.');
  if (!image.includes(Buffer.from('COOLLAMP-PUBLIC-' + version + '\0')) || image.includes(Buffer.from('COOLLAMP-LOCAL-'))) throw Error('Only the matching public build can be released.');
  const sha = crypto.createHash('sha256').update(image).digest('hex');
  return `COOLLAMP-OTA-1\n${version}\nesp32c3\ndual-ota-2031616\n${image.length}\n${sha}\n`;
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const version = fs.readFileSync(path.join(root, 'LampVersion.h'), 'utf8').match(/^#define LAMP_FIRMWARE_VERSION "([^"]+)"/m)?.[1];
  if (process.env.RELEASE_VERSION && process.env.RELEASE_VERSION !== version) throw Error('Release version must match LampVersion.h.');
  const image = fs.readFileSync(path.join(root, 'firmware/public/CoolLamp.ino.bin'));
  const manifest = manifestFor(image, version);
  const secretPath = path.join(root, 'LampSecrets.h');
  if (fs.existsSync(secretPath)) {
    const secret = fs.readFileSync(secretPath, 'utf8').match(/DEFAULT_ADMIN_PASSWORD "([^"]+)"/)?.[1];
    if (!secret || image.includes(Buffer.from(secret))) throw Error('Public image credential exclusion check failed.');
  }
  fs.writeFileSync(path.join(root, 'firmware/public/coollamp-manifest.txt'), manifest);
  console.log(`Packaged firmware ${version}: ${image.length} bytes; public-build and credential checks passed.`);
}
module.exports = { parseVersion, manifestFor };
