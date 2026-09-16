export const SERVICE = '7b610001-6e2b-4f3d-9a71-28e45c001001';
export const COMMAND = '7b610002-6e2b-4f3d-9a71-28e45c001001';
export const STATE = '7b610003-6e2b-4f3d-9a71-28e45c001001';
export const effects = ['Pacifica','Aurora','Rain','Fire','Split fire','Split fire - outward',
  'Split fire - reversed colors','Blue gas fire','Witch fire','Purple fire','Embers','Lava','Plasma',
  'Rainbow','Rainbow with glitter','Confetti','Comet collision','Sinelon','BPM','Juggle',
  'White','Red','Green','Blue','Purple','Pink','Yellow','Cyan','Custom solid'];
const operations = { power: 1, brightness: 2, effect: 3, saveDefaults: 4, refresh: 5, color: 6, resetColor: 7 };
export function encodeCommand(id, operation, value = 0) {
  const op = operations[operation];
  if (operation === 'color') {
    if (!Number.isInteger(id) || id < 1 || id > 255 || !value ||
        !Number.isInteger(value.mode) || value.mode < 1 || value.mode > effects.length ||
        ![value.r, value.g, value.b].every(v => Number.isInteger(v) && v >= 0 && v <= 255)) throw new Error('Invalid RGB color.');
    return new DataView(Uint8Array.of(1, id, op, value.mode, value.r, value.g, value.b).buffer);
  }
  if (!Number.isInteger(id) || id < 1 || id > 255 || !op || !Number.isInteger(value)) throw new Error('Invalid command.');
  const valid = op === 1 ? value >= 0 && value <= 1 : op === 2 ? value >= 1 && value <= 255 :
    op === 3 || op === 7 ? value >= 1 && value <= effects.length : value === 0;
  if (!valid) throw new Error('Value is outside the lamp’s supported range.');
  return new DataView(Uint8Array.of(1, id, op, value).buffer);
}
export function decodeState(data) {
  if (!(data instanceof DataView) || ![12,16].includes(data.byteLength)) throw new Error('Invalid response from lamp.');
  if (data.getUint8(0) !== 1) throw new Error('This lamp needs a different app version.');
  const state = { id: data.getUint8(1), result: data.getUint8(2), mode: data.getUint8(3),
    brightness: data.getUint8(4), power: data.getUint8(5) === 1, effectCount: data.getUint8(6),
    capabilities: data.getUint8(7), revision: data.getUint32(8, true) };
  if (data.getUint8(5) > 1 || state.mode < 1 || state.mode > state.effectCount || state.brightness < 1 || ![28,29].includes(state.effectCount)) {
    throw new Error('Unsupported lamp state.');
  }
  state.supportsColor = Boolean(state.capabilities & 2);
  if (state.supportsColor) {
    if (data.byteLength !== 16 || data.getUint8(12) > 1) throw new Error('Invalid color response.');
    state.color = { enabled: Boolean(data.getUint8(12)), r: data.getUint8(13), g: data.getUint8(14), b: data.getUint8(15) };
  }
  return state;
}
export function resultError(result) {
  return ['', 'App and lamp protocol do not match.', 'The lamp rejected that value.',
    'Wait for the firmware update to finish.', 'The lamp could not save settings.'][result] || 'The lamp rejected the command.';
}
