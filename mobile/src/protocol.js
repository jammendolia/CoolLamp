export const SERVICE = '7b610001-6e2b-4f3d-9a71-28e45c001001';
export const COMMAND = '7b610002-6e2b-4f3d-9a71-28e45c001001';
export const STATE = '7b610003-6e2b-4f3d-9a71-28e45c001001';
export const effects = ['Pacifica','Aurora','Rain','Fire','Split fire','Split fire - outward',
  'Split fire - reversed colors','Blue gas fire','Witch fire','Purple fire','Embers','Lava','Plasma',
  'Rainbow','Rainbow with glitter','Confetti','Comet collision','Sinelon','BPM','Juggle',
  'White','Red','Green','Blue','Purple','Pink','Yellow','Cyan'];
const operations = { power: 1, brightness: 2, effect: 3, saveDefaults: 4, refresh: 5 };
export function encodeCommand(id, operation, value = 0) {
  const op = operations[operation];
  if (!Number.isInteger(id) || id < 1 || id > 255 || !op || !Number.isInteger(value)) throw new Error('Invalid command.');
  const valid = op === 1 ? value >= 0 && value <= 1 : op === 2 ? value >= 1 && value <= 255 :
    op === 3 ? value >= 1 && value <= effects.length : value === 0;
  if (!valid) throw new Error('Value is outside the lamp’s supported range.');
  return new DataView(Uint8Array.of(1, id, op, value).buffer);
}
export function decodeState(data) {
  if (!(data instanceof DataView) || data.byteLength !== 12) throw new Error('Invalid response from lamp.');
  if (data.getUint8(0) !== 1) throw new Error('This lamp needs a different app version.');
  const state = { id: data.getUint8(1), result: data.getUint8(2), mode: data.getUint8(3),
    brightness: data.getUint8(4), power: data.getUint8(5) === 1, effectCount: data.getUint8(6),
    capabilities: data.getUint8(7), revision: data.getUint32(8, true) };
  if (data.getUint8(5) > 1 || state.mode < 1 || state.mode > state.effectCount || state.brightness < 1 || state.effectCount !== effects.length) {
    throw new Error('Unsupported lamp state.');
  }
  return state;
}
export function resultError(result) {
  return ['', 'App and lamp protocol do not match.', 'The lamp rejected that value.',
    'Wait for the firmware update to finish.', 'The lamp could not save settings.'][result] || 'The lamp rejected the command.';
}
