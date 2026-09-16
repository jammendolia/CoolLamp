const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const wifiOnly = process.argv.includes('--wifi-only');
const publicRelease = process.argv.includes('--public');
if (publicRelease && wifiOnly) throw new Error('Public releases require Bluetooth and the dual OTA layout.');
const bundledCli = path.join(process.env.LOCALAPPDATA || '', 'Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe');
const cli = process.env.ARDUINO_CLI || (process.platform === 'win32' && fs.existsSync(bundledCli) ? bundledCli : 'arduino-cli');
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
const stageRoot = path.join(root, publicRelease ? '.build/sketch-public' : '.build/sketch');
const sketch = path.join(stageRoot, 'CoolLamp');
fs.mkdirSync(sketch, { recursive: true });
// Keep the sketch path stable for Arduino's compiler cache; remove stale source copies only.
for (const entry of fs.readdirSync(sketch, { withFileTypes: true })) {
  if (entry.isFile() && /\.(ino|cpp|h)$/.test(entry.name) && (!fs.existsSync(path.join(root, entry.name)) || (publicRelease && entry.name === 'LampSecrets.h'))) fs.unlinkSync(path.join(sketch, entry.name));
}
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ino|cpp|h)$/.test(entry.name) || (publicRelease && entry.name === 'LampSecrets.h')) continue;
  const source = fs.readFileSync(path.join(root, entry.name));
  const target = path.join(sketch, entry.name);
  if (!fs.existsSync(target) || !source.equals(fs.readFileSync(target))) fs.writeFileSync(target, source);
}
if (!publicRelease && !fs.existsSync(path.join(sketch, 'LampSecrets.h'))) throw new Error('Run node tools/setup-secrets.cjs before building.');
const flavor = publicRelease ? 'public' : wifiOnly ? 'wifi' : 'ble';
const board = 'esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=no_fs';
const jobs = Math.max(1, Math.min(8, Math.floor(require('node:os').availableParallelism() / 2)));
const args = ['compile', '--fqbn', board, '--jobs', String(jobs), '--build-path', path.join(root, '.build/cache-' + flavor),
  '--output-dir', path.join(root, 'firmware', flavor)];
if (wifiOnly) args.push('--build-property', 'compiler.cpp.extra_flags=-DCOOL_LAMP_BLE=0');
if (publicRelease) args.push('--build-property', 'compiler.cpp.extra_flags=-DCOOL_LAMP_PUBLIC_RELEASE=1');
args.push(sketch);
console.log('Building ' + flavor + ' firmware from an isolated sketch. No device will be flashed.');
const result = spawnSync(cli, args, { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
