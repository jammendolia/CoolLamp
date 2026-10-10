// Group codes are credentials: never store them in localStorage or discovery metadata.
export function parseGroupCode(code) {
  const match=/^CL([13])-([0-9a-f]{12})-([0-9a-f]{32})$/i.exec(String(code).trim());
  if(!match)throw new Error('Paste the complete group code from the coordinator.');
  return {leader:match[2].toLowerCase(),key:match[3].toLowerCase(),...(match[1]==='3'?{protocol:3}:{})};
}
export function createGroupCode(identity,random=globalThis.crypto,protocol=2) {
  if(!/^[0-9a-f]{12}$/.test(identity))throw new Error('Connect to a lamp with a valid device identity.');
  if(![2,3].includes(protocol))throw new Error('Choose a supported group protocol.');
  const bytes=random.getRandomValues(new Uint8Array(16));
  return (protocol===3?'CL3-':'CL1-')+identity+'-'+Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
}
export function groupMemberLimit(sync) {
  if(sync?.version!==3)return 9;
  return Number.isInteger(sync.maxMembers)&&sync.maxMembers>=1&&sync.maxMembers<=32?sync.maxMembers:0;
}
export function supportsGroupProtocol(sync,version) {
  return [1,2,3].includes(version)&&(sync?.version===version||[2,3].includes(version)&&Array.isArray(sync?.protocolVersions)&&sync.protocolVersions.length<=3&&sync.protocolVersions.includes(version));
}
export function groupStatus(sync) {
  if(!sync)return 'Connect over Wi-Fi to firmware with lamp groups.';
  if(sync.role===1)return `Coordinating · ${sync.members??0} ${(sync.members??0)===1?'lamp':'lamps'} following`;
  if(sync.role===2)return sync.paused?'Paused · using local settings':sync.active?'Following · shared light and sound':'Waiting for coordinator · using local settings';
  return 'Independent · ready to join';
}
