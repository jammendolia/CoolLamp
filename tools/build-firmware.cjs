const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const wifiOnly = process.argv.includes('--wifi-only');
const publicRelease = process.argv.includes('--public');
const stackUsage=process.argv.includes('--stack-usage');
const trustOptions=process.argv.filter(arg=>arg.startsWith('--publisher-trust='));
if(process.argv.includes('--publisher-trust'))throw new Error('Use --publisher-trust=<public-only JSON path>.');
if(trustOptions.length>1||trustOptions.some(arg=>arg==='--publisher-trust='))throw new Error('Specify one public publisher-trust JSON file.');
const publisherTrust=trustOptions.length?require('./publisher-trust.cjs').load(trustOptions[0].slice('--publisher-trust='.length)):null;
if (publicRelease && wifiOnly) throw new Error('Public releases require Bluetooth and the dual OTA layout.');
const bundledCli = path.join(process.env.LOCALAPPDATA || '', 'Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe');
const cli = process.env.ARDUINO_CLI || (process.platform === 'win32' && fs.existsSync(bundledCli) ? bundledCli : 'arduino-cli');
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
const stageRoot = path.join(root, publicRelease ? '.build/sketch-public' : '.build/sketch');
const sketch = path.join(stageRoot, 'CoolLamp');
fs.mkdirSync(sketch, { recursive: true });
// Keep the sketch path stable for Arduino's compiler cache; remove stale source copies only.
for (const entry of fs.readdirSync(sketch, { withFileTypes: true })) {
  if (entry.isFile() && /\.(ino|cpp|h)$/.test(entry.name) && (!fs.existsSync(path.join(root, entry.name)) || (entry.name === 'LampSecrets.h'))) fs.unlinkSync(path.join(sketch, entry.name));
}
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ino|cpp|h)$/.test(entry.name) || (entry.name === 'LampSecrets.h')) continue;
  const source = fs.readFileSync(path.join(root, entry.name));
  const target = path.join(sketch, entry.name);
  if (!fs.existsSync(target) || !source.equals(fs.readFileSync(target))) fs.writeFileSync(target, source);
}
if(publisherTrust){
  fs.writeFileSync(path.join(sketch,'LampPublisherTrust.generated.h'),publisherTrust.header);
  console.log('Publisher public trust configuration SHA-256: '+publisherTrust.provenance.sha256);
}
const flavor = publicRelease ? 'public' : wifiOnly ? 'wifi' : 'ble';
const board = 'esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=no_fs';
const jobs = Math.max(1, Math.min(8, Math.floor(require('node:os').availableParallelism() / 2)));
const args = ['compile', '--fqbn', board, '--jobs', String(jobs), '--build-path', path.join(root, '.build/cache-' + flavor),
  '--output-dir', path.join(root, 'firmware', flavor)];
const cppFlags=[];
if (wifiOnly) cppFlags.push('-DCOOL_LAMP_BLE=0');
if (publicRelease) cppFlags.push('-DCOOL_LAMP_PUBLIC_RELEASE=1');
if (publisherTrust)cppFlags.push('-DCOOL_LAMP_PUBLISHER_TRUST_PROVISIONED=1');
if(stackUsage)cppFlags.push('-fstack-usage');
if(cppFlags.length)args.push('--build-property','compiler.cpp.extra_flags='+cppFlags.join(' '));
if(stackUsage)args.push('--build-property','compiler.c.extra_flags=-fstack-usage');
if(publisherTrust)fs.writeFileSync(path.join(root,'.build','publisher-trust-'+flavor+'.json'),JSON.stringify(publisherTrust.provenance,null,2)+'\n');
args.push(sketch);
(async()=>{
  const library=await require('./build-tls-library.cjs').ensureTlsLibrary({cli,board,sketch,root});
  const quoted='"'+library.replace(/\\/g,'/').replace(/"/g,'\\"')+'"';
  args.push('--build-property','compiler.c.elf.extra_flags=-Wl,--wrap=esp_wifi_init,--wrap=esp_bt_controller_init -Wl,--whole-archive '+quoted+' -Wl,--no-whole-archive');
  console.log('Building ' + flavor + ' firmware from an isolated sketch. No device will be flashed.');
  const result = spawnSync(cli, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
