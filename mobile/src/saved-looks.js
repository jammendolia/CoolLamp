import {effectSettings} from './effect-settings.js';

// Phone-local appearance records. They never include transport addresses,
// credentials, power, startup choices, hardware calibration or group commands.
export const SAVED_LOOKS_STORAGE_KEY='coollamp-saved-looks-v1';
export const SAVED_LOOK_LIMITS=Object.freeze({perLamp:32,total:128,nameBytes:64,storageBytes:256*1024});
const encoder=new TextEncoder();
const plain=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const canonical=value=>typeof value==='string'&&/^[0-9a-f]{12}$/.test(value);
const label=(value,max)=>typeof value==='string'&&value.trim().length>0&&encoder.encode(value).length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const semantic=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(value);
const tuple=(value,ranges)=>Array.isArray(value)&&value.length===ranges.length&&ranges.every(([min,max],index)=>integer(value[index],min,max));
const colorRanges=[[0,1],[0,255],[0,255],[0,255]];
const optionRanges=[[1,100],[0,100],[0,1],[0,255],[0,255],[0,255]];
function recordId(){
 const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);
 return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}

export class SavedLookError extends Error {
 constructor(code,message){super(message);this.name='SavedLookError';this.code=code;}
}
function fail(code,message){throw new SavedLookError(code,message);}
function target(value){if(!canonical(value))fail('invalid-target','Choose a verified lamp before using saved looks.');return value;}
function supportedPalette(entry){
 const controls=effectSettings(entry);
 if(controls.vu||controls.fountain)fail('unsupported-palette','This effect’s separate color zones cannot be saved as a complete look yet.');
}
function effect(value){
 if(!plain(value)||!integer(value.localId,1,255)||!label(value.name,96)||Object.hasOwn(value,'key')&&!semantic(value.key))fail('invalid-effect','This look does not contain a valid lamp effect.');
 return {localId:value.localId,name:value.name,...(Object.hasOwn(value,'key')?{key:value.key}:{})};
}

// Normalize at both capture and storage boundaries. Unknown properties are
// dropped rather than retaining unrelated fields from a full lamp response.
export function normalizeSavedLook(value,{stored=false}={}){
 if(!plain(value)||value.version!==1)fail('unsupported-look','This saved look uses an unsupported format.');
 target(value.lampId);
 if(!label(value.name,SAVED_LOOK_LIMITS.nameBytes))fail('invalid-name','Give this look a short name.');
 const appearance=value.appearance;
 if(!plain(appearance)||!integer(appearance.brightness,1,255)||!tuple(appearance.color,colorRanges)||!tuple(appearance.options,optionRanges))fail('invalid-appearance','Read the lamp’s complete appearance before saving this look.');
 const result={version:1,lampId:value.lampId,name:value.name.trim(),effect:effect(value.effect),
  appearance:{brightness:appearance.brightness,color:appearance.color.slice(),options:appearance.options.slice()}};
 if(stored){
  if(!identifier(value.id)||!Number.isSafeInteger(value.createdAt)||value.createdAt<1)fail('invalid-record','A saved look is damaged. Its stored copy has not been changed.');
  result.id=value.id;result.createdAt=value.createdAt;
 }
 return result;
}

function defaultName(name){
 let result='';for(const character of name){if(encoder.encode(result+character).length>SAVED_LOOK_LIMITS.nameBytes)break;result+=character;}
 return result.trim()||'My look';
}
function entryForMode(catalog,mode){
 if(!Array.isArray(catalog)||catalog.length<1||catalog.length>255)fail('invalid-catalog','Read this lamp’s effect list before saving a look.');
 const matches=catalog.filter(entry=>entry?.id===mode);
 if(matches.length!==1||!label(matches[0]?.name,96))fail('invalid-catalog','This effect could not be verified in the lamp’s effect list.');
 if(matches[0].available===false)fail('unavailable-effect','This effect is not available on this lamp.');
 return matches[0];
}

export function captureSavedLook({lampId,state,catalog,name,effectKey}={}){
 target(lampId);
 if(!plain(state)||state.deviceId!==lampId||!integer(state.mode,1,255))fail('target-mismatch','Read this lamp’s current light before saving a look.');
 const sync=state.sync;
 if(!plain(sync)||!integer(sync.role,0,2)||!integer(sync.scene,0,255))fail('unknown-scope','Read this lamp’s group status before saving a look.');
 if(sync.scene>0&&(sync.role===1||sync.role===2&&sync.active===true&&sync.paused!==true))fail('spatial-scene','Save a lamp effect rather than a shared group scene.');
 const entry=entryForMode(catalog,state.mode);supportedPalette(entry);
 // BLE's verified full refresh retains a separate target catalog and omits
 // the redundant names array. When supplied, the names must agree exactly.
 if(state.effects!==undefined&&(!Array.isArray(state.effects)||state.effects[state.mode-1]!==entry.name))fail('effect-mismatch','The lamp’s effect changed. Read its current light again.');
 const key=effectKey??entry.key;
 if(key!==undefined&&(!semantic(key)||entry.key!==undefined&&entry.key!==key))fail('invalid-effect','The effect’s identity could not be verified.');
 return normalizeSavedLook({version:1,lampId,name:name===undefined?defaultName(entry.name):name,
  effect:{localId:state.mode,name:entry.name,...(key===undefined?{}:{key})},
  appearance:{brightness:state.brightness,color:state.colors?.[state.mode-1],options:state.effectOptions?.[state.mode-1]}});
}

// An explicit semantic key may resolve a changed local wire ID. Without one,
// both the lamp-local ID and exact advertised name must still match; no name
// table, universal numeric catalog or nearest-effect substitution is used.
export function resolveSavedLookEffect(value,{lampId,catalog}={}){
 const look=normalizeSavedLook(value);target(lampId);
 if(look.lampId!==lampId)fail('target-mismatch','This look belongs to a different lamp.');
 if(!Array.isArray(catalog)||catalog.length<1||catalog.length>255)fail('invalid-catalog','Read this lamp’s effect list before using a saved look.');
 const keyed=look.effect.key?catalog.filter(entry=>entry?.key===look.effect.key):[];
 let entry;
 if(keyed.length){
  if(keyed.length!==1)fail('effect-mismatch','The saved effect’s identity is ambiguous. Nothing changed.');
  entry=keyed[0];
 }else{
  entry=entryForMode(catalog,look.effect.localId);
  if(entry.name!==look.effect.name||look.effect.key&&entry.key!==undefined&&entry.key!==look.effect.key)fail('effect-mismatch','This lamp’s effect list has changed. Nothing changed.');
 }
 if(!integer(entry?.id,1,255)||!label(entry?.name,96))fail('invalid-effect','The saved effect could not be verified.');
 if(entry.available===false)fail('unavailable-effect','This effect is not available on this lamp.');
 supportedPalette(entry);
 return {...entry};
}

export class SavedLooksStore {
 constructor(storage,{now=Date.now,id=recordId}={}){
  this.storage=storage;this.now=now;this.id=id;
 }
 load(){
  let raw;
  try{raw=this.storage.getItem(SAVED_LOOKS_STORAGE_KEY);}catch{fail('storage-unavailable','Saved looks are unavailable on this phone. Nothing was saved.');}
  if(raw===null||raw===undefined)return [];
  if(typeof raw!=='string'||encoder.encode(raw).length>SAVED_LOOK_LIMITS.storageBytes)fail('invalid-storage','Saved looks could not be read. Their stored copies have not been changed.');
  let envelope;try{envelope=JSON.parse(raw);}catch{fail('invalid-storage','Saved looks could not be read. Their stored copies have not been changed.');}
  if(!plain(envelope)||envelope.version!==1)fail('unsupported-storage','These saved looks use an unsupported format. Their stored copies have not been changed.');
  if(!Array.isArray(envelope.looks)||envelope.looks.length>SAVED_LOOK_LIMITS.total)fail('invalid-storage','Saved looks could not be read. Their stored copies have not been changed.');
  const counts=new Map(),ids=new Set();const records=envelope.looks.map(value=>normalizeSavedLook(value,{stored:true}));
  for(const value of records){
   const count=(counts.get(value.lampId)||0)+1;counts.set(value.lampId,count);
   if(ids.has(value.id)||count>SAVED_LOOK_LIMITS.perLamp)fail('invalid-storage','Saved looks could not be read. Their stored copies have not been changed.');
   ids.add(value.id);
  }
  return records;
 }
 list(lampId=null){
  if(lampId!==null)target(lampId);
  return this.load().filter(value=>lampId===null||value.lampId===lampId).sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
 }
 write(looks){
  const raw=JSON.stringify({version:1,looks});
  if(encoder.encode(raw).length>SAVED_LOOK_LIMITS.storageBytes)fail('storage-limit','There is no room for another saved look. Remove an old one first.');
  try{this.storage.setItem(SAVED_LOOKS_STORAGE_KEY,raw);}catch{fail('storage-unavailable','This look could not be saved on your phone. Please try again.');}
 }
 save(value){
  const draft=normalizeSavedLook(value);supportedPalette({name:draft.effect.name});const records=this.load();
  if(records.length>=SAVED_LOOK_LIMITS.total||records.filter(row=>row.lampId===draft.lampId).length>=SAVED_LOOK_LIMITS.perLamp)fail('look-limit','You have reached the saved-look limit. Remove an old look first.');
  let id,createdAt;try{id=this.id();createdAt=this.now();}catch{fail('record-unavailable','This look could not be saved. Please try again.');}
  const record=normalizeSavedLook({...draft,id,createdAt},{stored:true});
  if(records.some(row=>row.id===id))fail('record-unavailable','This look could not be saved. Please try again.');
  this.write([...records,record]);return record;
 }
 remove(id,lampId){
  target(lampId);if(!identifier(id))fail('invalid-record','Choose a saved look to remove.');
  const records=this.load(),next=records.filter(value=>value.id!==id||value.lampId!==lampId);
  if(next.length===records.length)return false;
  this.write(next);return true;
 }
}
