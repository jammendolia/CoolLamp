import { BleClient } from '@capacitor-community/bluetooth-le';
import { LampTransport } from './transport.js';
import { effects } from './protocol.js';
import './style.css';

const $ = id => document.getElementById(id);
const status = message => { $('status').textContent = message; };
let state = null, editingBrightness = false, busy = false;
let savedDevice = null;
try { const saved = JSON.parse(localStorage.getItem('coollamp-device')); if (typeof saved?.deviceId === 'string') savedDevice = saved; } catch {}
$('reconnect').hidden = !savedDevice;
if (savedDevice) status('Reconnect to your saved lamp. There is no need to enter pairing mode again.');
const lamp = new LampTransport(BleClient, {
  onState(next) {
    state = next;
    if ($('effect').options.length !== next.effectCount) {
      $('effect').replaceChildren(...effects.slice(0, next.effectCount).map((name, i) => new Option(name, i + 1)));
    }
    $('colorControls').hidden = !next.supportsColor;
    $('colorUpgrade').hidden = next.supportsColor;
    if (next.color) {
      $('color').value = '#' + [next.color.r,next.color.g,next.color.b].map(v => v.toString(16).padStart(2,'0')).join('');
      $('colorHint').textContent = next.color.enabled ? 'Your color is active for this effect.' : 'Original colors are active. Pick a color to customize this effect.';
      $('resetColor').textContent = next.mode === 29 ? 'Reset color' : 'Restore original colors';
    }
    $('power').textContent = next.power ? 'Turn off' : 'Turn on';
    $('power').setAttribute('aria-pressed', String(next.power));
    if (!editingBrightness) { $('brightness').value = next.brightness; brightnessLabel(); }
    $('effect').value = next.mode;
  },
  onDisconnect() {
    state = null; $('controls').disabled = true; $('disconnect').hidden = true;
    $('connect').hidden = false; editingBrightness = false;
    $('reconnect').hidden = !savedDevice;
    status('Disconnected. Find your lamp to reconnect.');
  }
});
effects.forEach((name, i) => $('effect').add(new Option(name, i + 1)));
function brightnessLabel() { $('brightnessValue').value = Math.round(Number($('brightness').value) * 100 / 255) + '%'; }
async function change(operation, value) {
  if (busy) return;
  busy = true; $('controls').disabled = true;
  try { await lamp.command(operation, value); status(operation === 'saveDefaults' ? 'Startup settings saved.' : 'Connected • Changes applied.'); }
  catch (error) { status(error.message); }
  finally { busy = false; $('controls').disabled = !state; }
}
async function connect(saved = null) {
  $('connect').disabled = true; $('reconnect').disabled = true; status('Looking for your lamp…');
  try {
    const device = await lamp.connect(saved);
    savedDevice = device;
    try { localStorage.setItem('coollamp-device', JSON.stringify({ deviceId: device.deviceId, name: device.name })); } catch {}
    $('controls').disabled = false; $('connect').hidden = true; $('disconnect').hidden = false;
    $('reconnect').hidden = true;
    status('Connected to ' + (device.name || 'CoolLamp'));
  } catch (error) { status(error.message || 'Could not connect. Check Bluetooth permissions and pairing.'); }
  finally { $('connect').disabled = false; $('reconnect').disabled = false; }
}
$('connect').onclick = () => connect();
$('reconnect').onclick = () => connect(savedDevice);
$('disconnect').onclick = () => lamp.disconnect();
$('power').onclick = () => change('power', state.power ? 0 : 1);
$('effect').onchange = () => change('effect', Number($('effect').value));
$('brightness').oninput = () => { editingBrightness = true; brightnessLabel(); };
$('brightness').onchange = async () => { const value = Number($('brightness').value); editingBrightness = false; await change('brightness', value); };
$('save').onclick = () => change('saveDefaults');
$('color').onchange = () => {
  const hex = $('color').value.slice(1);
  change('color', {mode: state.mode, r: parseInt(hex.slice(0,2),16), g: parseInt(hex.slice(2,4),16), b: parseInt(hex.slice(4,6),16)});
};
$('resetColor').onclick = () => change('resetColor', state.mode);
