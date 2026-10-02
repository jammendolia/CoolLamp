// Group codes are credentials: never store them in localStorage or discovery metadata.
export function parseGroupCode(code) {
  const match=/^CL1-([0-9a-f]{12})-([0-9a-f]{32})$/i.exec(String(code).trim());
  if(!match)throw new Error('Paste the complete group code from the coordinator.');
  return {leader:match[1].toLowerCase(),key:match[2].toLowerCase()};
}
export function createGroupCode(identity,random=globalThis.crypto) {
  if(!/^[0-9a-f]{12}$/.test(identity))throw new Error('Connect to a lamp with a valid device identity.');
  const bytes=random.getRandomValues(new Uint8Array(16));
  return 'CL1-'+identity+'-'+Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
}
export function groupStatus(sync) {
  if(!sync)return 'Connect over Wi-Fi to firmware with lamp groups.';
  if(sync.role===1)return `Coordinating · ${sync.members??0} ${(sync.members??0)===1?'lamp':'lamps'} following`;
  if(sync.role===2)return sync.paused?'Paused · using local settings':sync.active?'Following · shared light and sound':'Waiting for coordinator · using local settings';
  return 'Independent · ready to join';
}
