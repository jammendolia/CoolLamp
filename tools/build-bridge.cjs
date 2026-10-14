// Build only the optional Heltec ESP32-S3 bridge. No upload, release lookup,
// library downloads, lamp secrets, or C3-specific TLS archive is involved.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const CORE_VERSION = '3.3.11';
const BOARD = 'esp32:esp32:heltec_wifi_kit_32_V3';
const FLASH_BYTES = 0x800000;
const APP_BYTES = 0x200000;
const immutableSources = [
  'LampMeshCore.cpp', 'LampMeshCore.h', 'LampMeshCrypto.cpp', 'LampMeshCrypto.h', 'LampMeshWire.h',
  'LampFirmwareRelayCrypto.cpp', 'LampFirmwareRelayCrypto.h', 'LampFirmwareRelayWire.h',
  'LampEspNow.cpp', 'LampEspNow.h',
  'LampCommission.cpp', 'LampCommission.h', 'LampCommissionCrypto.cpp', 'LampCommissionCrypto.h', 'LampCommissionCue.h',
  'LampHttpServer.cpp', 'LampHttpServer.h', 'LampHttpSocketCleanup.cpp', 'LampHttpSocketCleanup.h',
  'UpdateHttp.cpp', 'UpdateHttp.h', 'LampSyncRadioCrypto.cpp', 'LampSyncRadioCrypto.h',
  'LampControlEndpoint.h', 'LampControl.h', 'LampMeshAdapter.h', 'LampFirmwareRelay.h', 'LampUpdate.h', 'UpdateManifest.h'
];

function parsePartitions(source) {
  const entries = source.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).map(line => {
    const [name, type, subtype, offset, size] = line.split(',').map(value => value.trim());
    const entry = { name, type, subtype, offset: Number(offset), size: Number(size) };
    if (!name || !Number.isSafeInteger(entry.offset) || !Number.isSafeInteger(entry.size) || entry.size <= 0)
      throw new Error('Invalid bridge partition entry.');
    return entry;
  });
  let end = 0x9000;
  const names = new Set();
  for (const entry of entries) {
    if (names.has(entry.name) || entry.offset < end || entry.offset % 0x1000 || entry.size % 0x1000)
      throw new Error('Bridge partitions must have unique names, sector alignment, and no overlaps.');
    if (entry.type === 'app' && entry.offset % 0x10000) throw new Error('Bridge apps must be 64 KiB aligned.');
    names.add(entry.name);
    end = entry.offset + entry.size;
    if (end > FLASH_BYTES) throw new Error('Bridge partitions exceed the board\'s 8 MiB flash.');
  }
  const apps = entries.filter(entry => entry.type === 'app');
  if (apps.length !== 2 || apps[0].name !== 'ota_0' || apps[0].offset !== 0x10000 || apps[0].subtype !== 'ota_0' ||
      apps[1].name !== 'ota_1' || apps[1].subtype !== 'ota_1' || apps.some(entry => entry.size !== APP_BYTES))
    throw new Error('Bridge requires two 2 MiB OTA application slots starting at 0x10000.');
  const cache = entries.find(entry => entry.name === 'bridge_cache');
  if (!cache || cache.type !== '0x40' || cache.subtype !== '0x00' || cache.size < 0x300000)
    throw new Error('The cached ESP32-C3 image must be in a separate custom data partition of at least 3 MiB.');
  if (!entries.some(entry => entry.name === 'nvs' && entry.type === 'data' && entry.subtype === 'nvs') ||
      !entries.some(entry => entry.name === 'otadata' && entry.type === 'data' && entry.subtype === 'ota'))
    throw new Error('Bridge NVS and OTA metadata partitions are required.');
  return entries;
}

function copyChanged(source, destination) {
  const bytes = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
  if (!fs.existsSync(destination) || !bytes.equals(fs.readFileSync(destination))) fs.writeFileSync(destination, bytes);
}

function loadBenchFixture(file) {
  const input = path.resolve(file);
  const inputStat = fs.statSync(input);
  if (!inputStat.isFile() || inputStat.size > 2048) throw new Error('Bench fixture JSON must be a file of at most2 KiB.');
  const value = JSON.parse(fs.readFileSync(input, 'utf8'));
  const fields = ['version', 'target', 'firmwareVersion', 'image', 'size', 'sha256', 'manifest', 'lifetimeMs'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)) ||
      value.version !== 1 || value.target !== '5894af4aec24' || value.firmwareVersion !== '1.15.5' ||
      typeof value.image !== 'string' || !value.image || !Number.isInteger(value.size) || value.size < 288 || value.size > 2031616 ||
      typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.manifest !== 'string' ||
      !Number.isInteger(value.lifetimeMs) || value.lifetimeMs <= 0 || value.lifetimeMs > 1200000)
    throw new Error('Bench fixture requires exact public pins for Corkscrew, diagnostic firmware1.15.5, and a lifetime at most20 minutes.');
  const image = fs.realpathSync(path.resolve(path.dirname(input), value.image));
  const imageStat = fs.statSync(image);
  if (!imageStat.isFile() || imageStat.size !== value.size || imageStat.size > 2031616)
    throw new Error('Bench image file size must exactly match its bounded pin.');
  const bytes = fs.readFileSync(image);
  const manifest = require('./package-firmware.cjs').manifestFor(bytes, value.firmwareVersion, { testImage: true });
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (value.size !== bytes.length || value.sha256 !== digest || value.manifest !== manifest ||
      !bytes.includes(Buffer.from('COOLLAMP-TEST-IMAGE-1.15.5')))
    throw new Error('Bench image, diagnostic identity and exact version/size/hash/manifest pins must agree.');
  const header = Buffer.from('#pragma once\n#include <stdint.h>\nnamespace BridgeBenchFixture {\n' +
    'constexpr char Manifest[]=' + JSON.stringify(manifest) + ';\n' +
    'constexpr char TargetIdentity[]="5894af4aec24";\n' +
    'constexpr uint8_t TargetMac[6]={0x24,0xec,0x4a,0xaf,0x94,0x58};\n' +
    'constexpr uint32_t LifetimeMs=' + value.lifetimeMs + ';\n}\n');
  return { header, provenance: { version: 1, input, image, target: value.target,
    firmwareVersion: value.firmwareVersion, imageBytes: bytes.length, imageSha256: digest,
    lifetimeMs: value.lifetimeMs, manifest, activation: 'one-shot-local-usb-only', publicationProhibited: true } };
}

function stageBridge(root, { benchFixture = null } = {}) {
  const stageRoot = benchFixture ? path.join(root, '.build', 'bridge-bench', 'sketch') : path.join(root, '.build', 'sketch-bridge');
  const sketch = path.join(stageRoot, 'CoolLampBridge');
  const bridge = path.join(root, 'bridge');
  const main = path.join(root, 'examples', 'CoolLampBridge', 'CoolLampBridge.ino');
  if (!fs.existsSync(main)) throw new Error('The bridge sketch is missing: examples/CoolLampBridge/CoolLampBridge.ino.');
  const partitions = parsePartitions(fs.readFileSync(path.join(bridge, 'partitions.csv'), 'utf8'));
  fs.mkdirSync(sketch, { recursive: true });
  const sources = new Map([['CoolLampBridge.ino', main]]);
  for (const name of immutableSources) sources.set(name, path.join(root, name));
  for (const entry of fs.readdirSync(bridge, { withFileTypes: true })) {
    if (entry.isFile() && /\.(cpp|h)$/.test(entry.name)) {
      if (sources.has(entry.name)) throw new Error('Bridge source collides with an immutable lamp source: ' + entry.name);
      sources.set(entry.name, path.join(bridge, entry.name));
    }
  }
  // Copy declaration-only dependencies of the immutable interfaces, without
  // pulling in the lamp updater, strip renderer, Bluetooth, or lamp adapters.
  for (const [name, location] of sources) {
    if (!fs.existsSync(location)) throw new Error('Required bridge source is missing: ' + name);
    for (const match of fs.readFileSync(location, 'utf8').matchAll(/^\s*#\s*include\s*"([^"\r\n]+)"/gm)) {
      const dependency = match[1];
      if (dependency === 'LampSecrets.h') throw new Error('Bridge builds cannot include lamp secrets.');
      if (dependency === 'LampVersion.h' || sources.has(dependency)) continue;
      if (path.basename(dependency) !== dependency || !dependency.endsWith('.h')) continue;
      const header = path.join(root, dependency);
      if (fs.existsSync(header)) sources.set(dependency, header);
    }
  }
  if (!sources.has('BridgeVersion.h')) throw new Error('bridge/BridgeVersion.h is required for independent bridge identity.');
  sources.set('partitions.csv', path.join(bridge, 'partitions.csv'));
  const generatedVersion = Buffer.from('#pragma once\n#include "BridgeVersion.h"\n' +
    '#define LAMP_FIRMWARE_VERSION COOLLAMP_BRIDGE_VERSION\n' +
    '#define LAMP_VERSION_MAJOR COOLLAMP_BRIDGE_VERSION_MAJOR\n' +
    '#define LAMP_VERSION_MINOR COOLLAMP_BRIDGE_VERSION_MINOR\n' +
    '#define LAMP_VERSION_PATCH COOLLAMP_BRIDGE_VERSION_PATCH\n');
  // Stable paths preserve Arduino's build cache; remove only stale staged files.
  const expected = new Set([...sources.keys(), 'LampVersion.h']);
  if (benchFixture) expected.add('BridgeBenchFixture.generated.h');
  for (const entry of fs.readdirSync(sketch, { withFileTypes: true })) {
    if (entry.isFile() && !expected.has(entry.name)) fs.unlinkSync(path.join(sketch, entry.name));
  }
  const provenance = [];
  for (const [name, source] of sources) {
    copyChanged(source, path.join(sketch, name));
    provenance.push({ file: path.relative(root, source).replaceAll('\\', '/'), staged: name,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex') });
  }
  copyChanged(generatedVersion, path.join(sketch, 'LampVersion.h'));
  if (benchFixture) copyChanged(benchFixture.header, path.join(sketch, 'BridgeBenchFixture.generated.h'));
  fs.writeFileSync(path.join(stageRoot, 'source-provenance.json'), JSON.stringify({ core: CORE_VERSION, board: BOARD,
    partitions, sources: provenance, generatedVersion: 'BridgeVersion.h',
    ...(benchFixture ? { developmentBench: benchFixture.provenance } : {}) }, null, 2) + '\n');
  return { sketch, partitions, stageRoot };
}

function installedCore(cli) {
  const result = spawnSync(cli, ['core', 'list', '--format', 'json'], { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Could not inspect the installed Arduino cores. ' + (result.stderr || '').trim());
  const platform = JSON.parse(result.stdout).platforms?.find(item => item.id === 'esp32:esp32');
  if (platform?.installed_version !== CORE_VERSION)
    throw new Error('Bridge requires the already-installed official esp32:esp32 core ' + CORE_VERSION +
      '; found ' + (platform?.installed_version || 'none') + '. No toolchain will be downloaded automatically.');
}

function main() {
  const flags = process.argv.slice(2);
  const benchOptions = flags.filter(flag => flag.startsWith('--bench-fixture='));
  if (benchOptions.length > 1 || benchOptions.some(flag => flag === '--bench-fixture=') ||
      flags.some(flag => !['--stage-only', '--verbose'].includes(flag) && !flag.startsWith('--bench-fixture=')))
    throw new Error('Supported bridge build options: --stage-only, --verbose, --bench-fixture=<public JSON>. This builder never uploads.');
  const benchFixture = benchOptions.length ? loadBenchFixture(benchOptions[0].slice('--bench-fixture='.length)) : null;
  const root = path.resolve(__dirname, '..');
  const bundledCli = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Arduino IDE', 'resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli.exe');
  const cli = process.env.ARDUINO_CLI || (process.platform === 'win32' && fs.existsSync(bundledCli) ? bundledCli : 'arduino-cli');
  installedCore(cli);
  const { sketch, stageRoot } = stageBridge(root, { benchFixture });
  if (flags.includes('--stage-only')) {
    console.log('Staged the isolated CoolLampBridge sketch for ESP32-S3 / 8 MiB. No device accessed.');
    return;
  }
  const build = benchFixture ? path.join(root, '.build', 'bridge-bench', 'build') : path.join(root, '.build', 'cache-bridge');
  const output = benchFixture ? path.join(root, '.build', 'bridge-bench', 'firmware') : path.join(root, 'firmware', 'bridge');
  const args = ['compile', '--fqbn', BOARD, '--jobs', String(Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 2)))),
    '--build-path', build, '--output-dir', output,
    '--build-property', 'build.flash_size=8MB', '--build-property', 'build.flash_mode=dio',
    '--build-property', 'build.flash_freq=80m', '--build-property', 'build.cdc_on_boot=0',
    '--build-property', 'build.msc_on_boot=0', '--build-property', 'build.dfu_on_boot=0',
    '--build-property', 'build.usb_mode=1', '--build-property', 'upload.maximum_size=' + APP_BYTES,
    '--build-property', 'compiler.cpp.extra_flags=-DCOOLLAMP_BRIDGE=1' + (benchFixture ? ' -DCOOLLAMP_BRIDGE_BENCH=1' : '')];
  if (flags.includes('--verbose')) args.push('--verbose');
  args.push(sketch);
  console.log('Building CoolLamp Bridge for Heltec WiFi Kit 32 V3 with official core ' + CORE_VERSION + '. No device will be flashed.');
  const result = spawnSync(cli, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; return; }
  const image = path.join(output, 'CoolLampBridge.ino.bin');
  const bytes = fs.statSync(image).size;
  if (bytes > APP_BYTES) throw new Error('Bridge image exceeds its dedicated 2 MiB application slot.');
  if (!fs.readFileSync(path.join(build, 'partitions.csv')).equals(fs.readFileSync(path.join(root, 'bridge', 'partitions.csv'))))
    throw new Error('Compiled partition table does not match bridge/partitions.csv. Do not flash this build.');
  const summary = { target: 'esp32s3', flashBytes: FLASH_BYTES, appSlotBytes: APP_BYTES, imageBytes: bytes,
    imageSha256: crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex'), core: CORE_VERSION, board: BOARD,
    usbSerial: 'CP2102 / UART0, native CDC disabled', sources: path.join(stageRoot, 'source-provenance.json'),
    ...(benchFixture ? { developmentBench: benchFixture.provenance, publicationProhibited: true } : {}) };
  fs.writeFileSync(path.join(output, 'bridge-build.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('Bridge image: ' + bytes + ' bytes; ' + (APP_BYTES - bytes) + ' bytes free in its OTA slot.');
}

module.exports = { CORE_VERSION, BOARD, parsePartitions, stageBridge, installedCore, loadBenchFixture };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
