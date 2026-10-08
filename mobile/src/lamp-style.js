// Physical style is display/recommendation metadata. It never changes strip
// geometry, effect IDs, capability checks or the lamp's actual effect catalog.
export const LAMP_STYLES = Object.freeze([
  {id:'unspecified',code:0,family:'unspecified',label:'Not specified'},
  {id:'helix',code:1,family:'helix',label:'Helix'},
  {id:'large-helix',code:2,family:'helix',label:'Large helix'},
  {id:'corkscrew',code:3,family:'corkscrew',label:'Corkscrew'}
].map(value=>Object.freeze(value)));

const definitions = new Map(LAMP_STYLES.map(value=>[value.id,value]));

export function styleDefinition(value) {
  if(typeof value==='string')return definitions.get(value) || null;
  if(!value || typeof value!=='object' || Array.isArray(value) || value.version!==1)return null;
  const definition=definitions.get(value.id);
  return definition && value.code===definition.code && value.family===definition.family ? definition : null;
}

export function normalizeLampStyle(value) {
  const definition=styleDefinition(value);
  if(!definition)return null;
  const {code,id,family}=definition;
  return {version:1,code,id,family};
}

export const styleFamily = value => styleDefinition(value)?.family || 'unspecified';
export const styleLabel = value => styleDefinition(value)?.label || 'Not specified';

export function resolveLampStyle(firmwareStyle,phoneStyle) {
  const lamp=styleDefinition(firmwareStyle);
  if(lamp && lamp.id!=='unspecified')return {id:lamp.id,source:'lamp'};
  const phone=typeof phoneStyle==='string'?styleDefinition(phoneStyle):null;
  return phone && phone.id!=='unspecified' ? {id:phone.id,source:'phone'} : {id:'unspecified',source:'unspecified'};
}

// Reviewed against FireSplit, Atmosphere, NewEffects and AudioEffects. Folded
// height patterns scale the two sides independently at the saved center; these
// suit both paired helix strands and a corkscrew's spiral/straight spine.
const heightPatterns = [
  'Rain','Split fire - rising','Split fire - falling','Split fire - rising, reversed colors',
  'Blue gas fire','Witch fire','Purple fire','Comet collision','Bouncing droplets - rising',
  'Bouncing droplets - falling','Heartbeat','Sound meter','Spectrum Rise','Bass Launch',
  'Spectral Embers','Beat Bloom','Three-band Fountain','VU Meter','Rainbow Embers'
];

// Continuous bands and travelling accents trace the corkscrew path. They are
// still usable on a helix; this is a short list to try, never an incompatibility.
const pathPatterns = [
  'Pacifica','Aurora','Lava','Plasma','Rainbow','Rainbow with glitter','Sinelon','BPM',
  'Juggle','Color tide','Shooting stars','Lava blobs'
];

// Uniform fills, random speckles and whole-lamp pulses do not distinguish the
// shapes. Keep them classified as general rather than claiming a style benefit.
const generalPatterns = [
  'Fire','Embers','Confetti','White','Red','Green','Blue','Purple','Pink','Yellow','Cyan',
  'Custom solid','Lightning storm','Fireflies','Breathing glow','Sound glow'
];

const normalizeName = value => typeof value==='string'?value.trim().toLowerCase():null;
const recommendations = new Map([
  ...heightPatterns.map(name=>[normalizeName(name),['helix','corkscrew']]),
  ...pathPatterns.map(name=>[normalizeName(name),['corkscrew']]),
  ...generalPatterns.map(name=>[normalizeName(name),[]])
]);
for(const [oldName,currentName] of [
  ['Split fire','Split fire - rising'],['Split fire - outward','Split fire - falling'],
  ['Split fire - reversed colors','Split fire - rising, reversed colors'],
  ['Bouncing droplets','Bouncing droplets - rising']
])recommendations.set(normalizeName(oldName),recommendations.get(normalizeName(currentName)));

// Entries may eventually advertise explicit recommended styles. An unknown or
// malformed declaration stays unclassified; never guess from an effect ID or
// overwrite a new firmware declaration with the local legacy name table.
function entryFamilies(entry) {
  if(!entry || typeof entry!=='object')return null;
  if(Object.prototype.hasOwnProperty.call(entry,'styles')) {
    if(!Array.isArray(entry.styles) || entry.styles.length>16)return null;
    const families=[];
    for(const value of entry.styles) {
      const definition=typeof value==='string'?styleDefinition(value):null;
      if(!definition || definition.id==='unspecified')return null;
      families.push(definition.family);
    }
    return families;
  }
  return recommendations.get(normalizeName(entry.name)) ?? null;
}

// 'general' means available but not highlighted, not unsupported. Unknown new
// styles/effects are intentionally visible in the default unfiltered catalog.
export function effectRecommendation(entry,style) {
  const family=styleFamily(style);
  if(family==='unspecified')return 'unclassified';
  const families=entryFamilies(entry);
  return families===null?'unclassified':families.includes(family)?'recommended':'general';
}

export const effectRecommended = (entry,style) => effectRecommendation(entry,style)==='recommended';

export function recommendedEffects(catalog,style) {
  if(!Array.isArray(catalog))return [];
  return styleFamily(style)==='unspecified' ? catalog.slice() : catalog.filter(entry=>effectRecommended(entry,style));
}
