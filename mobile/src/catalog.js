import { effects } from './protocol.js';
export const CATALOG = '7b610007-6e2b-4f3d-9a71-28e45c001001';
// Catalog v1 uses stable, contiguous wire IDs 1..N, independent of lamp style.
export function validateCatalog(value, count) {
  if (!Array.isArray(value) || !Number.isInteger(count) || count<1 || count>255 || value.length!==count) throw new Error('Invalid lamp effect catalog.');
  return value.map((entry,i)=>{
    if (!entry || entry.id!==i+1 || typeof entry.name!=='string' || !entry.name.trim() || new TextEncoder().encode(entry.name).length>96 || /[\x00-\x1f]/.test(entry.name) || typeof entry.category!=='string' || typeof entry.speed!=='boolean') throw new Error('Invalid lamp effect catalog.');
    return {id:entry.id,name:entry.name,category:['calm','fire','color'].includes(entry.category)?entry.category:'other',speed:entry.speed};
  });
}
export function legacyCatalog(names) {
  if (!Array.isArray(names)) throw new Error('Invalid lamp effect catalog.');
  const calm=[1,2,3,13,30,32,33,36,37,38];
  const oldNames={'Split fire':'Split fire - rising','Split fire - outward':'Split fire - falling',
    'Split fire - reversed colors':'Split fire - rising, reversed colors','Bouncing droplets':'Bouncing droplets - rising'};
  return validateCatalog(names.map((name,i)=>{
    // Legacy Wi-Fi supplies names, but has no metadata. Never classify by its local ID.
    const known=effects.indexOf(oldNames[name] || name)+1;
    return {id:i+1,name,category:known>=4&&known<=12?'fire':calm.includes(known)?'calm':known?'color':'other',speed:!(known>=21&&known<=29)};
  }),names.length);
}
