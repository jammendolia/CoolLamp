export const NETWORK_NAME_MAX=31;
export const NETWORK_NAME_STEM_MAX=15;
export const NETWORK_NAME_SOURCE_MAX=48;
const encoder=new TextEncoder();
const label=value=>typeof value==='string'&&value.length>=1&&value.length<=NETWORK_NAME_MAX&&
  /^coollamp-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export function deriveNetworkName(source,suffix) {
  if(typeof source!=='string'||typeof suffix!=='string'||!/^[0-9a-f]{6}$/i.test(suffix))throw Error('Router name needs a valid lamp suffix.');
  const stable=suffix.toLowerCase();
  if(source.slice(0,9).toLowerCase()==='coollamp-')source=source.slice(9);
  if(source.length===6&&source.toLowerCase()===stable)source='';
  let normalized='',separator=false;
  for(const character of source){
    if(/[A-Za-z0-9]/.test(character)){
      if(separator&&normalized)normalized+='-';
      normalized+=character.toLowerCase();separator=false;
    }else if([' ','\t','-','_','.'].includes(character))separator=Boolean(normalized);
  }
  if(normalized.length>NETWORK_NAME_STEM_MAX){
    const cut=normalized.slice(0,NETWORK_NAME_STEM_MAX);
    const boundary=cut.lastIndexOf('-');
    normalized=boundary>0&&normalized[NETWORK_NAME_STEM_MAX]!=='-'?cut.slice(0,boundary):cut;
  }
  normalized=normalized.replace(/-+$/,'');
  const result='coollamp-'+(normalized?normalized+'-':'')+stable;
  if(!label(result))throw Error('Router name could not be made safe.');
  return result;
}

export function validNetworkHostname(value) {
  if(typeof value!=='string'||!value.endsWith('.local'))return false;
  return label(value.slice(0,-6));
}

export function validNetworkNameSource(value) {
  return typeof value==='string'&&encoder.encode(value).length>=1&&encoder.encode(value).length<=NETWORK_NAME_SOURCE_MAX&&
    !/[\u0000-\u001f\u007f]/.test(value);
}

export function parseNetworkNameConfiguration(value,expectedDeviceId) {
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{throw Error('Invalid router-name response.');}}
  const canonical=typeof value?.deviceId==='string'&&/^[0-9a-f]{12}$/.test(value.deviceId);
  const display=typeof value?.displayName==='string'&&encoder.encode(value.displayName).length>=1&&encoder.encode(value.displayName).length<=48&&!/[\u0000-\u001f\u007f]/.test(value.displayName);
  const custom=value?.customName===''||validNetworkNameSource(value?.customName);
  const revision=Number.isInteger(value?.revision)&&value.revision>=0&&value.revision<=0xffffffff;
  const activeSuffix=typeof value?.active==='string'?value.active.match(/-([0-9a-f]{6})$/i):null;
  const desiredSuffix=typeof value?.desired==='string'?value.desired.match(/-([0-9a-f]{6})$/i):null;
  if(value?.version!==1||!canonical||expectedDeviceId&&value.deviceId!==expectedDeviceId||!display||!custom||
    typeof value.automatic!=='boolean'||typeof value.pending!=='boolean'||!label(value.active)||!label(value.desired)||
    !activeSuffix||!desiredSuffix||activeSuffix[1].toLowerCase()!==desiredSuffix[1].toLowerCase()||!revision||
    value.pending!==(value.active!==value.desired))
    throw Error('Invalid router-name response.');
  const managed=value.revision>0,suffix=desiredSuffix[1].toLowerCase();
  if(managed){
    if(!value.automatic&&!value.customName)throw Error('Invalid router-name response.');
    if(deriveNetworkName(value.automatic?value.displayName:value.customName,suffix)!==value.desired)throw Error('Invalid router-name response.');
  }else if(value.desired!==value.active)throw Error('Invalid router-name response.');
  return Object.freeze({...value,managed,suffix,maxLength:NETWORK_NAME_MAX});
}
