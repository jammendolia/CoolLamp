const identity=/^[0-9a-f]{12}$/;
const token=/^[0-9a-f]{16}$/;
const nonzero=value=>token.test(value)&&value!=='0000000000000000';
const phases=Object.freeze(['empty','ready','reserved','accepted','started','finished','armed','renew-ready']);
const actions=new Set(['start','arm','arm-reconcile','reserve','accept','health','reconcile','release','finish','release-reconcile','cancel','status','renew-proof','renew','renew-accept']);
const proofBytes=Object.freeze({arm:116,'arm-reconcile':92,accept:144,reconcile:144,finish:116,'release-reconcile':92,renew:144,'renew-accept':148});
const uint32=value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff;
const failure=()=>{throw Error('Invalid lamp rollout contract.');};
export function parseRolloutStatus(raw){
  if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{failure();}}
  if(raw?.version!==1||typeof raw.storageReady!=='boolean'||raw.distributedAutomaticService!==false||raw.requiresPhoneOrCoordinatorOrchestration!==true||raw.coordinatorLast!==true||
    !token.test(raw.ticket)||!token.test(raw.lease)||!token.test(raw.receiverTicket)||!token.test(raw.receiverLease)||!Number.isInteger(raw.phase)||!phases[raw.phase]||!Number.isInteger(raw.receiverPhase)||!phases[raw.receiverPhase]||
    !Number.isInteger(raw.members)||raw.members<0||raw.members>32||!uint32(raw.armedMask)||!uint32(raw.completedMask)||!uint32(raw.releasedMask)||typeof raw.target!=='string'||raw.target!==''&&!identity.test(raw.target)||raw.permitLifetimeMs!==300000||typeof raw.uncertainLease!=='boolean')failure();
  const allowed=raw.members===32?0xffffffff:2**raw.members-1;
  if(raw.armedMask>allowed||raw.completedMask>allowed||raw.releasedMask>allowed||raw.phase===2&&(!nonzero(raw.ticket)||!nonzero(raw.lease)||!identity.test(raw.target))||raw.uncertainLease!==(raw.phase===2))failure();
  return Object.freeze({...raw,phaseName:phases[raw.phase],receiverPhaseName:phases[raw.receiverPhase],automaticDistribution:false});
}
// Opaque authenticated proofs are forwarded unchanged. The app verifies the
// actual target identity/session and installed/control snapshot on each route;
// a broker delivery acknowledgment cannot substitute for those reads.
export function rolloutRequest(action,fields={}){
  if(!actions.has(action)||!fields||typeof fields!=='object'||Array.isArray(fields))failure();
  const allowed={start:['manifest','command'],arm:['proof'],'arm-reconcile':['proof'],reserve:['ticket','target','targetBoot','command'],accept:['proof'],health:[],reconcile:['proof'],release:[],finish:['proof'],'release-reconcile':['proof'],cancel:['ticket'],status:[],'renew-proof':[],renew:['proof','command'],'renew-accept':['proof']}[action];
  if(Object.keys(fields).some(key=>!allowed.includes(key))||allowed.some(key=>fields[key]===undefined))failure();
  const result={action};
  for(const field of allowed){const value=fields[field];
    if(field==='manifest'&&(typeof value!=='string'||!value.length||new TextEncoder().encode(value).length>512))failure();
    if(field==='command'&&(!uint32(value)||!value))failure();
    if(['ticket','targetBoot'].includes(field)&&!nonzero(value))failure();
    if(field==='target'&&!identity.test(value))failure();
    if(field==='proof'&&(typeof value!=='string'||value.length!==proofBytes[action]*2||!/^[0-9a-f]+$/.test(value)))failure();
    result[field]=value;
  }
  if(new TextEncoder().encode(new URLSearchParams(result).toString()).length>1024)failure();
  return Object.freeze(result);
}
export const rolloutEndpoint='/api/firmware/rollout';
