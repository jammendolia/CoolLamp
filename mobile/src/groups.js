import { createGroupCode, parseGroupCode, groupMemberLimit, supportsGroupProtocol } from './sync.js';
import { availableGroupScenes, groupSceneSettings } from './group-scenes.js';
import { validFirmwareVersion } from './lamps.js';

const identity = /^[0-9a-f]{12}$/;
const incarnation=value=>typeof value==='string'&&/^[0-9a-f]{32}$/.test(value)?value:'';
const problem = (message, fields = {}) => Object.assign(new Error(message), {groupPublic:true, ...fields});
const text = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').replace(/CL[13]-[0-9a-f]{12}-[0-9a-f]{32}/gi, '[private group information]').slice(0, 96) : '';
const uncertain = error => error?.uncertain === true || error?.code === 'COMMAND_NOT_CONFIRMED';
const copy = value => JSON.parse(JSON.stringify(value));
const fields = (source, names) => Object.fromEntries(names.filter(name => source?.[name] !== undefined).map(name => [name, copy(source[name])]));
const membership = raw => ({role:raw.sync.role, leader:raw.sync.role ? raw.sync.leader : null, version:raw.sync.version,incarnation:incarnation(raw.sync.incarnation)});
const sameMembership = (raw, expected) => ['role','leader','version','incarnation'].every(key => membership(raw)[key] === expected[key]);
const session = lamp => typeof lamp.raw?.token === 'string' ? lamp.raw.token : null;
const removalLimit=64, removalBytes=32768;
function removalIntents(value) {
  if(value==null)return {version:2,sources:[]};
  if(![1,2].includes(value?.version)||!Array.isArray(value.sources)||value.sources.length>removalLimit||Object.keys(value).some(key=>!['version','sources'].includes(key)))throw problem('Saved group removal details could not be verified.',{storageFailed:true});
  const sources=new Set();
  for(const row of value.sources){
    if(!row||Object.keys(row).some(key=>!['source','targets','dissolve',...(value.version===2?['incarnation']:[])].includes(key))||value.version===2&&(typeof row.incarnation!=='string'||row.incarnation!==''&&!incarnation(row.incarnation))||!identity.test(row.source)||sources.has(row.source)||typeof row.dissolve!=='boolean'||
      !Array.isArray(row.targets)||row.targets.length>31||new Set(row.targets).size!==row.targets.length||row.targets.some(id=>!identity.test(id)||id===row.source)||!row.dissolve&&!row.targets.length)throw problem('Saved group removal details could not be verified.',{storageFailed:true});
    sources.add(row.source);
  }
  const result={version:2,sources:value.sources.map(row=>({...copy(row),incarnation:value.version===1?'':row.incarnation}))};
  if(new TextEncoder().encode(JSON.stringify(result)).length>removalBytes)throw problem('Saved group removal details exceed their limit.',{storageFailed:true});
  return result;
}

function descriptor(entry) {
  if (!identity.test(entry?.id)) return null;
  return {...fields(entry, ['address','deviceId','hostname','accessoryManaged','accessoryName','bluetoothName','newAuthorization']), id:entry.id, name:text(entry.name) || 'CoolLamp'};
}
function validate(raw, id) {
  if (raw?.deviceId !== id) throw problem('Lamp identity changed. Refresh Groups before trying again.', {stale:true});
  const sync = raw.sync;
  if (![1,2,3].includes(sync?.version) || ![0,1,2].includes(sync.role) || sync.version===3&&!groupMemberLimit(sync) ||
      sync.maxSupportedMembers!==undefined&&(!Number.isInteger(sync.maxSupportedMembers)||sync.maxSupportedMembers<groupMemberLimit(sync)||sync.maxSupportedMembers>32) ||
      sync.role === 1 && sync.leader !== id || sync.role === 2 && (!identity.test(sync.leader) || sync.leader === id)) {
    throw problem('This lamp returned incompatible group settings.', {incompatible:true});
  }
  return raw;
}
function publicSync(sync) {
  const result = {version:sync.version,role:sync.role,leader:sync.role?sync.leader:'',active:sync.active===true,paused:sync.paused===true};
  result.maxMembers=groupMemberLimit(sync);
  if(Number.isInteger(sync.maxSupportedMembers)&&sync.maxSupportedMembers>=result.maxMembers&&sync.maxSupportedMembers<=32)result.maxSupportedMembers=sync.maxSupportedMembers;
  result.protocolVersions=Array.isArray(sync.protocolVersions)&&sync.protocolVersions.length<=3?[...new Set(sync.protocolVersions.filter(v=>[2,3].includes(v)))]:[sync.version];
  result.coordinatorMigration=sync.coordinatorMigration===true;
  result.dissolutionV1=sync.dissolutionV1===true;
  result.membershipLocked=sync.membershipLocked===true;
  if(/^[0-9a-f]{16}$/.test(sync.session))result.session=sync.session;
  if(incarnation(sync.incarnation))result.incarnation=sync.incarnation;
  for(const key of ['peerTotal','peerCursor','peerNext'])if(Number.isInteger(sync[key])&&sync[key]>=0&&sync[key]<=31)result[key]=sync[key];
  result.peerTruncated=sync.peerTruncated===true;
  for(const key of ['members','sceneCount','scene','position','count','sceneSpeed','sceneIntensity'])if(Number.isInteger(sync[key])&&sync[key]>=0&&sync[key]<=65535)result[key]=sync[key];
  for(const key of ['scenePrimary','sceneSecondary'])if(Array.isArray(sync[key])&&sync[key].length===3&&sync[key].every(n=>Number.isInteger(n)&&n>=0&&n<=255))result[key]=[...sync[key]];
  result.transport=['udp','esp-now','hybrid','none'].includes(sync.transport)?sync.transport:'none';
  result.order = (Array.isArray(sync.order) ? sync.order : []).filter(entry => identity.test(entry?.id)).slice(0,result.maxMembers)
    .map(entry => ({id:entry.id,name:text(entry.name) || 'CoolLamp',online:entry.online === true}));
  result.peers = (Array.isArray(sync.peers) ? sync.peers : []).filter(entry => identity.test(entry?.id)).slice(0,8)
    .map(entry => ({id:entry.id,name:text(entry.name) || 'CoolLamp',address:typeof entry.address==='string'?entry.address:'',role:[0,1,2].includes(entry.role)?entry.role:null,microphone:entry.microphone===true,
      transport:['udp','esp-now','hybrid'].includes(entry.transport)?entry.transport:'none',channel:Number.isInteger(entry.channel)&&entry.channel>=0&&entry.channel<=14?entry.channel:0}));
  result.radio={available:sync.radio?.available===true,seeking:sync.radio?.seeking===true};
  if(sync.radio?.security==='aes-gcm-128')result.radio.security='aes-gcm-128';
  for(const key of ['channel','received','receiveDropped','sent','sendFailed','sendDropped','channelChanges'])if(Number.isInteger(sync.radio?.[key])&&sync.radio[key]>=0&&sync.radio[key]<=0xffffffff)result.radio[key]=sync.radio[key];
  return result;
}

// The builder negotiates the entire selection before creating any coordinator.
// A saved/current v2 group limit is not its hardware's advertised v3 capacity.
export function groupCreationPlan(rows) {
  if(!Array.isArray(rows)||rows.length<2||rows.length>32||new Set(rows.map(row=>row?.id)).size!==rows.length||
    rows.some(row=>!identity.test(row?.id||'')||row.verified!==true||row.available!==true||row.role!==0||row.sync?.role!==0||![1,2,3].includes(row.sync?.version)))
    throw problem('Choose two or more available independent lamps. Refresh their connections first.');
  if(rows.some(row=>row.sync.membershipLocked===true))throw problem('Finish updating the selected lamps before creating their group.');
  const protocol=rows.every(row=>supportsGroupProtocol(row.sync,3))?3:rows.every(row=>supportsGroupProtocol(row.sync,2))?2:null;
  if(!protocol)throw problem('Update the selected lamps to compatible group firmware before creating their group.',{incompatible:true});
  let capacity=9;
  if(protocol===3){
    capacity=Math.min(...rows.map(row=>{
      const sync=row.sync,active=groupMemberLimit(sync),reported=sync.maxSupportedMembers;
      if(!active||reported!==undefined&&(!Number.isInteger(reported)||reported<active||reported>32))
        throw problem('A selected lamp did not report a valid group capacity. Refresh its connection.',{incompatible:true});
      // Missing optional upgrade capacity cannot inflate a currently-v2 lamp.
      return reported??(sync.version===3?active:9);
    }));
  }
  if(rows.length>capacity)throw problem('This selection supports up to '+capacity+' lamps in one group.',{incompatible:true});
  const main=rows.find(row=>row.audio?.installed===true)||rows[0];
  return {leader:copy(main),followers:rows.filter(row=>row.id!==main.id).map(copy),protocol,capacity};
}

// The factory chooses a verified HTTP link or an already-authorized Bluetooth
// link. This model never selects a lamp, owns a phone credential or stores an
// invitation. Release callbacks decide whether a lease owns its connection.
export class Groups {
  constructor({getLamps = () => [], discover = async () => [], acquire, onStatus, now = Date.now, concurrency = 2, scanTimeout = 45000, random = globalThis.crypto, loadRemovalIntents,saveRemovalIntents} = {}) {
    if (typeof acquire !== 'function') throw Error('Groups needs a lamp connection factory.');
    Object.assign(this, {getLamps,discover,acquire,onStatus,now,random});
    this.concurrency = Math.max(1,Math.min(2,concurrency));
    this.scanTimeout=Math.max(1,scanTimeout);this.scanActive=0;this.slotWaiters=[];
    this.rows = new Map(); this.entries = new Map(); this.busy = new Set(); this.run = null;
    this.forgotten=new Set();this.authorizations=new Map();this.removedMemberships=new Map();
    if((typeof loadRemovalIntents==='function')!==(typeof saveRemovalIntents==='function'))throw Error('Group removal persistence needs both load and save callbacks.');
    this.pendingRemovals=new Map();this.dissolving=new Set();this.removalIncarnations=new Map();this.saveRemovalIntents=saveRemovalIntents;
    this.removalStorage=typeof saveRemovalIntents==='function'?'loading':'session';this.removalStorageError=null;
    this.removalReady=Promise.resolve().then(()=>loadRemovalIntents?.()).then(value=>{
      const retained=removalIntents(value);this.pendingRemovals=new Map(retained.sources.map(row=>[row.source,new Set(row.targets)]));
      this.dissolving=new Set(retained.sources.filter(row=>row.dissolve).map(row=>row.source));
      this.removalIncarnations=new Map(retained.sources.map(row=>[row.source,row.incarnation]));
      if(this.saveRemovalIntents)this.removalStorage='ready';
    }).catch(error=>{this.removalStorage='failed';this.removalStorageError=error;});
    this.removalTail=this.removalReady;
    this.scanning = false; this.cancelled = false;
  }
  snapshot() {
    const publicRows=new Map(this.rows);
    for(const [id,row] of this.removedMemberships)if(this.forgotten.has(id))publicRows.set(id,row);
    const lamps = [...publicRows.values()].map(copy), groups = new Map();
    for (const row of lamps) if (row.verified && row.role === 1) groups.set(row.id, {id:row.id,name:row.name,leader:row,followers:[],available:row.available,placeholder:false,capacity:Math.max(0,groupMemberLimit(row.sync)-1)});
    for (const row of lamps) if ((row.verified||row.lastSeenMembership) && row.role === 2) {
      if (!groups.has(row.leader)) groups.set(row.leader, {id:row.leader,name:'Unavailable coordinator',available:false,placeholder:true,capacity:8,
        leader:{id:row.leader,name:'Unavailable coordinator',available:false,verified:false,state:'missing',role:1,leader:row.leader,sync:null,audio:null,message:'Coordinator has not been verified.'},followers:[]});
      groups.get(row.leader).followers.push(row);
    }
    for(const id of new Set([...this.pendingRemovals.keys(),...this.dissolving]))if(!groups.has(id))groups.set(id,{id,name:'Pending group removal',available:false,placeholder:true,capacity:31,
      leader:{id,name:'Pending group removal',available:false,verified:false,state:'missing',role:1,leader:id,sync:null,audio:null,message:'Refresh the coordinator to confirm this saved removal.'},followers:[]});
    for (const group of groups.values()) {
      group.pendingRemovalIds=[...(this.pendingRemovals.get(group.id)||[])];
      group.removalPending=group.pendingRemovalIds.length>0||this.dissolving.has(group.id);
      group.dissolutionPending=this.dissolving.has(group.id);
      group.removalNeedsReconfirmation=group.removalPending&&group.leader.role===1&&(!this.removalIncarnations.get(group.id)||this.removalIncarnations.get(group.id)!==incarnation(group.leader.sync?.incarnation));
      group.pendingAdditionalIds=group.dissolutionPending?(group.leader.sync?.order||[]).map(row=>row.id).filter(id=>id!==group.id&&!group.pendingRemovalIds.includes(id)):[];
      group.removalNeedsReconfirmation||=group.pendingAdditionalIds.length>0;
      group.usedSlots = Math.min(group.capacity,Math.max(group.followers.length, Number.isInteger(group.leader.sync?.members) ? group.leader.sync.members : 0,
        Math.max(0,(group.leader.sync?.order?.length || 1)-1)));
      group.remaining = group.capacity-group.usedSlots;
    }
    return {lamps,groups:[...groups.values()],ungrouped:lamps.filter(row => row.verified && row.role === 0),
      unavailable:lamps.filter(row => (!row.verified || row.role === null)&&!row.lastSeenMembership),scanning:this.scanning,cancelled:this.cancelled,busyIds:[...this.busy],removalIntentStorage:this.removalStorage};
  }
  emit() {const snapshot=this.snapshot();this.onStatus?.(snapshot);return snapshot;}
  revision(id){return this.authorizations.get(id)||0;}
  source(value){
    const entry=descriptor(value);
    if(entry&&this.forgotten.has(entry.id))return fields(entry,['id','name','address','hostname']);
    return entry;
  }
  forget(id){
    const previous=this.rows.get(id);
    if(previous?.verified&&previous.role===2)this.removedMemberships.set(id,{id,name:previous.name,role:2,leader:previous.leader,available:false,verified:false,lastSeenMembership:true,
      checkedAt:previous.checkedAt,state:'needs-pairing',message:'Last seen in this group. Authorize the lamp again to check or change its membership.',
      sync:{version:previous.sync.version,role:2,leader:previous.leader,active:false,paused:previous.sync.paused===true},audio:null,firmwareVersion:null,transport:null});
    this.authorizations.set(id,this.revision(id)+1);this.forgotten.add(id);
    this.entries.delete(id);this.rows.delete(id);this.run?.notify?.();return this.emit();
  }
  allow(id){
    this.authorizations.set(id,this.revision(id)+1);this.forgotten.delete(id);
    this.entries.delete(id);this.rows.delete(id);this.removedMemberships.delete(id);return this.emit();
  }
  remember(raw, id, fallback) {
    validate(raw,id);
    const row = {id,name:text(raw.name) || fallback?.name || 'CoolLamp',available:true,verified:true,state:'online',message:'',checkedAt:this.now(),
      ...membership(raw),firmwareVersion:validFirmwareVersion(raw.firmware?.version),transport:['udp','esp-now','hybrid','none'].includes(raw.sync.transport)?raw.sync.transport:'available',
      sync:publicSync(raw.sync),audio:{installed:raw.audio?.installed===true,liveTuning:raw.audio?.liveTuning===true}};
    for(const key of ['gain','gate','scale'])if(Number.isInteger(raw.audio?.[key])&&raw.audio[key]>=0&&raw.audio[key]<=65535)row.audio[key]=raw.audio[key];
    this.rows.set(id,row);if(this.run&&!this.run.cancelled)this.run.addPeers?.(row.sync.peers);this.emit();return row;
  }
  status(entry, error) {
    if(this.forgotten.has(entry.id))error={needsAuthorization:true};
    const previous = this.rows.get(entry.id);
    const state = error?.needsPairing || error?.needsAuthorization ? 'needs-pairing' : error?.needsPassword ? 'needs-password' : error?.stale || error?.incompatible ? 'failed' : 'offline';
    const message = state === 'needs-pairing' ? 'Authorize this lamp with its six-second pairing window first.' : state === 'needs-password' ? 'Enter this lamp’s access password.' :
      previous?.verified ? 'Unavailable now. Group settings are from the last successful read.' : 'Lamp could not be verified. Bring it nearby or refresh discovery.';
    this.rows.set(entry.id,{...(previous || {id:entry.id,name:entry.name,verified:false,role:null,leader:null,sync:null,audio:null,checkedAt:null,firmwareVersion:null,transport:null}),available:false,state,message});
    this.emit();
  }
  cancel() {if(this.run){this.run.cancelled=true;this.run.notify?.();this.run.finish?.();}this.run=null;this.scanning=false;this.cancelled=true;return this.emit();}
  candidates(values) {
    const candidates = new Map();
    for (const row of this.rows.values()) for (const peer of row.sync?.peers || []) {const entry=this.source(peer);if(entry)candidates.set(entry.id,entry);}
    for (const value of values) {const entry=this.source(value);if(entry)candidates.set(entry.id,{...candidates.get(entry.id),...entry});}
    this.entries=candidates;return [...candidates.values()].slice(0,64);
  }
  async leased(id, readOnly, operation, run = null) {
    if(this.forgotten.has(id))throw problem('Authorize this lamp again before managing its groups.',{needsAuthorization:true});
    const current=(this.getLamps() || []).map(value=>this.source(value)).find(value=>value?.id===id);
    const retained=this.entries.get(id);
    const entry=current || (readOnly&&retained?fields(retained,['id','name','address','hostname']):null);
    if (!entry) throw problem('This lamp is no longer in discovery. Refresh Groups.', {stale:true});
    const revision=this.revision(id),locator=current?JSON.stringify(fields(current,['address','deviceId','accessoryManaged'])):null;
    const lease = await this.acquire(id,{entry,readOnly,purpose:readOnly?'groups-scan':'groups-action'});
    const lamp=lease?.lamp || lease?.transport;
    try {
      if (!lamp || typeof lamp.refresh !== 'function' || typeof lease.release !== 'function') throw problem('Lamp connection could not be verified.');
      const context={id,lamp,epoch:lamp.epoch,base:lamp.base,token:session(lamp),run,revision,locator};
      this.guard(context);return await operation(context);
    } finally {try {await lease?.release?.();} catch { /* A cleanup failure cannot replay or change a group action. */ }}
  }
  guard(context) {
    const {lamp,id,epoch,base,run}=context;
    if (run?.cancelled) throw problem('Group discovery cancelled.', {cancelled:true});
    if(this.forgotten.has(id)||context.revision!==this.revision(id))throw problem('Lamp authorization changed. Refresh Groups before trying again.',{stale:true,needsAuthorization:true});
    if(context.locator!==null){
      const current=(this.getLamps() || []).map(value=>this.source(value)).find(value=>value?.id===id);
      if(!current||JSON.stringify(fields(current,['address','deviceId','accessoryManaged']))!==context.locator)throw problem('Lamp discovery or authorization changed. Refresh Groups.',{stale:true});
    }
    if (lamp.identity !== id || lamp.epoch !== epoch || lamp.base !== base || context.token !== null && session(lamp) !== context.token) {
      throw problem('Lamp connection changed. Refresh Groups before trying again.', {stale:true});
    }
  }
  queued(context, action) {
    this.guard(context);
    const run=async()=>{this.guard(context);const result=await action(context.lamp);this.guard(context);return result;};
    return typeof context.lamp.enqueue === 'function' ? context.lamp.enqueue(run) : run();
  }
  async fresh(context) {
    const result=await this.queued(context,lamp=>lamp.refresh(context.id));
    const raw=validate(result || context.lamp.raw,context.id);this.remember(raw,context.id,this.entries.get(context.id));return raw;
  }
  async scanRead(entry,run){
    while(this.scanActive>=this.concurrency&&!run.cancelled)await new Promise(resolve=>this.slotWaiters.push(resolve));
    if(run.cancelled)throw problem('Group discovery cancelled.',{cancelled:true});
    ++this.scanActive;
    try{return await this.leased(entry.id,true,context=>this.fresh(context),run);}
    finally{--this.scanActive;for(const wake of this.slotWaiters.splice(0))wake();}
  }
  async refresh() {
    await this.removalReady;
    if(this.run){this.run.cancelled=true;this.run.notify?.();this.run.finish?.();}
    const waiters=[];
    const run={cancelled:false,notify:()=>{for(const wake of waiters.splice(0))wake();for(const wake of this.slotWaiters.splice(0))wake();},completed:new Set()};
    this.run=run;this.scanning=true;this.cancelled=false;this.emit();
    const entries=this.candidates(this.getLamps() || []),seen=new Set(entries.map(entry=>entry.id));
    let index=0,discoveryDone=false,timer,deadline;
    const add=values=>{
      if(run.cancelled)return;
      for(const value of values || []){
        const entry=this.source(value);if(!entry)continue;
        this.entries.set(entry.id,{...this.entries.get(entry.id),...entry});
        if(!seen.has(entry.id)&&entries.length<64){seen.add(entry.id);entries.push(entry);}
      }
      run.notify();
    };
    run.addPeers=add;
    // Known lamps begin immediately. Slow mDNS does not postpone saved/radio
    // inventory; discovery and newly read peer hints join the same bounded queue.
    Promise.race([Promise.resolve().then(()=>this.discover()),new Promise(resolve=>{timer=setTimeout(()=>resolve([]),Math.min(9000,this.scanTimeout));})])
      .then(values=>add(Array.isArray(values)?values:values?.lamps || []))
      .catch(()=>{})
      .finally(()=>{clearTimeout(timer);discoveryDone=true;run.notify();});
    const worker=async()=>{
      while(!run.cancelled){
        if(index>=entries.length){if(discoveryDone)return;await new Promise(resolve=>waiters.push(resolve));continue;}
        const entry=entries[index++];
        try {await this.scanRead(entry,run);}
        catch(error){if(!run.cancelled&&!error.cancelled)this.status(entry,error);}
        finally{run.completed.add(entry.id);}
      }
    };
    const timeout=new Promise(resolve=>{
      run.finish=resolve;
      deadline=setTimeout(()=>{
        if(this.run===run){for(const entry of entries)if(!run.completed.has(entry.id))this.status(entry,{});}
        run.cancelled=true;run.notify();resolve();
      },this.scanTimeout);
    });
    await Promise.race([Promise.all(Array.from({length:this.concurrency},worker)),timeout]);
    clearTimeout(timer);clearTimeout(deadline);
    if(this.run===run){this.run=null;this.scanning=false;this.cancelled=run.cancelled;return this.emit();}
    return this.snapshot();
  }
  async action(ids, operation) {
    await this.removalReady;
    if(ids.some(id=>!identity.test(id)))throw problem('Choose a verified lamp.');
    if(ids.some(id=>this.busy.has(id)))throw problem('Wait for this lamp’s current group action.');
    const revisions=ids.map(id=>this.revision(id));
    ids.forEach(id=>this.busy.add(id));this.emit();
    try {
      const result=await operation();
      if(ids.some((id,index)=>this.forgotten.has(id)||this.revision(id)!==revisions[index]))throw problem('Lamp authorization changed during the group action. Refresh before trying again.',{stale:true,uncertain:true});
      return result;
    }
    catch(error){if(error.groupPublic)throw error;throw problem(uncertain(error)?'The lamp did not confirm the group change. Refresh before trying again.':'Group action could not complete. Refresh Groups and check the lamp.',{uncertain:uncertain(error)});}
    finally {ids.forEach(id=>this.busy.delete(id));this.emit();}
  }
  expect(raw, role, leader) {
    if(raw.sync.role!==role || leader !== undefined && raw.sync.leader!==leader)throw problem('Lamp group membership changed. Refresh Groups before trying again.',{stale:true});
    if(raw.calibration?.active || [1,3,4].includes(raw.firmware?.phase))throw problem('Finish setup or updating on this lamp first.');
  }
  capacity(raw,target) {
    this.expect(raw,1,raw.deviceId);
    if(raw.sync.membershipLocked)throw problem('Finish this group’s staged update before changing membership.');
    if(!supportsGroupProtocol(target.sync,raw.sync.version))throw problem('Update these lamps to matching group firmware before joining.');
    const order=Array.isArray(raw.sync.order)?raw.sync.order:[];
    const limit=groupMemberLimit(raw.sync);
    if(!limit)throw problem('Coordinator did not report a valid group capacity.');
    if((order.length>=limit||raw.sync.members>=limit-1)&&!order.some(row=>row.id===target.deviceId))throw problem('This group is full ('+limit+' lamps).');
  }
  async mutation(context, expected, operation, accepts, phase) {
    let error;
    try {
      await this.queued(context,lamp=>{if(!sameMembership(lamp.raw,expected))throw problem('Lamp group membership changed. Refresh Groups.',{stale:true});return operation(lamp);});
    }catch(caught){if(!uncertain(caught))throw caught;error=caught;}
    let raw;
    try {raw=await this.fresh(context);}catch(caught){if(error)throw problem('The group change was not confirmed. Refresh this lamp before trying again.',{uncertain:true,phase});throw caught;}
    if(!accepts(raw))throw problem('The lamp did not confirm the requested group settings.',{uncertain:Boolean(error),phase});
    return raw;
  }
  create(id,{protocol:requestedProtocol}={}) {
    return this.action([id],()=>this.leased(id,false,async context=>{
      const raw=await this.fresh(context);this.expect(raw,0);
      const protocol=requestedProtocol??(supportsGroupProtocol(raw.sync,3)?3:2);
      if(![2,3].includes(protocol)||!supportsGroupProtocol(raw.sync,protocol))throw problem('Update this lamp to support the selected group protocol.',{incompatible:true});
      if(raw.sync.membershipLocked)throw problem('Finish this lamp’s staged update before creating a group.');
      let code=createGroupCode(id,this.random,protocol);
      try {const saved=await this.mutation(context,membership(raw),lamp=>{
        if(!supportsGroupProtocol(lamp.raw.sync,protocol)||lamp.raw.sync.membershipLocked)throw problem('The lamp’s group support changed. Refresh before creating its group.',{incompatible:true});
        return lamp.configureSync(1,code);
      },next=>next.sync.role===1&&next.sync.leader===id&&next.sync.version===protocol,'create-unconfirmed');return {id,leader:id,saved:true,phase:'created',active:saved.sync.active===true,protocol};}
      finally {code=null;}
    }));
  }
  leave(id) {
    return this.action([id],async()=>{
      let source,sourceIncarnation;
      await this.leased(id,false,async context=>{const raw=await this.fresh(context);this.expect(raw,2);source=raw.sync.leader;
        if(raw.sync.membershipLocked)throw problem('Finish this group’s staged update before leaving.');
        sourceIncarnation=incarnation(raw.sync.incarnation);await this.pending(source,id,sourceIncarnation,true);
        await this.mutation(context,membership(raw),lamp=>lamp.configureSync(0,'',sourceIncarnation),next=>next.sync.role===0,'leave-unconfirmed');});
      const sourceCleanup=await this.cleanupSource(source,id,sourceIncarnation);
      return {id,saved:true,phase:'left',leader:null,sourceCleanup};
    });
  }
  stopCoordinating(id) {
    return this.dissolve(id,{allowLegacy:true});
  }
  updateRemovalIntents(change){
    const run=async()=>{
      if(this.removalStorageError)throw problem('Saved group removal details are unavailable. Restore phone storage before changing this group.',{storageFailed:true});
      const pending=new Map([...this.pendingRemovals].map(([source,ids])=>[source,new Set(ids)])),dissolving=new Set(this.dissolving),incarnations=new Map(this.removalIncarnations);
      change(pending,dissolving,incarnations);
      for(const [source,ids] of pending)if(!ids.size&&!dissolving.has(source))pending.delete(source);
      const next=removalIntents({version:2,sources:[...new Set([...pending.keys(),...dissolving])].sort().map(source=>({source,targets:[...(pending.get(source)||[])].sort(),dissolve:dissolving.has(source),incarnation:incarnations.get(source)||''}))});
      const current=JSON.stringify({version:2,sources:[...new Set([...this.pendingRemovals.keys(),...this.dissolving])].sort().map(source=>({source,targets:[...(this.pendingRemovals.get(source)||[])].sort(),dissolve:this.dissolving.has(source),incarnation:this.removalIncarnations.get(source)||''}))});
      if(JSON.stringify(next)!==current&&this.saveRemovalIntents){
        try{if(await this.saveRemovalIntents(copy(next))===false)throw Error('Storage rejected removal details.');}
        catch{throw problem('Group removal details could not be saved. Confirm phone storage and reconcile this group.',{storageFailed:true});}
      }
      this.pendingRemovals=pending;this.dissolving=dissolving;this.removalIncarnations=incarnations;this.emit();
    };
    const result=this.removalTail.then(run);this.removalTail=result.catch(()=>{});return result;
  }
  intentFence(source,current){if(!current||this.removalIncarnations.get(source)!==current)throw problem('This saved removal belongs to an unknown or previous group. Review and approve the current group before changing it.',{needsReconfirmation:true,stale:true});}
  pending(source,target,current,freshDeparture=false){return this.updateRemovalIntents((pending,_,incarnations)=>{if(!pending.has(source)&&!this.dissolving.has(source))incarnations.set(source,current||'');else if(!freshDeparture&&current!==undefined&&incarnations.get(source)!==current)throw problem('Review this group’s pending removal before changing its membership.',{needsReconfirmation:true,stale:true});const ids=pending.get(source)||new Set();ids.add(target);pending.set(source,ids);});}
  clearPending(source,target){return this.updateRemovalIntents(pending=>pending.get(source)?.delete(target));}
  beginDissolve(source,targets,current,reconfirm=false){return this.updateRemovalIntents((pending,dissolving,incarnations)=>{if((pending.has(source)||dissolving.has(source))&&!reconfirm&&incarnations.get(source)!==current)throw problem('Review and approve the current group before removing it.',{needsReconfirmation:true,stale:true});if(!current)throw problem('This lamp needs a stable group identity before confirmed removal.',{needsReconfirmation:true,incompatible:true});const ids=pending.get(source)||new Set();for(const target of targets)ids.add(target);pending.set(source,ids);dissolving.add(source);incarnations.set(source,current);});}
  clearSource(source){return this.updateRemovalIntents((pending,dissolving,incarnations)=>{pending.delete(source);dissolving.delete(source);incarnations.delete(source);});}
  async departMember(source,target){
    if(this.busy.has(target))throw problem('Wait for this lamp’s current group action.');
    this.busy.add(target);this.emit();
    try{await this.leased(target,false,async context=>{
      const current=await this.fresh(context);
      if(current.sync.role===2&&current.sync.leader===source){this.intentFence(source,incarnation(current.sync.incarnation));await this.mutation(context,membership(current),lamp=>lamp.configureSync(0,'',incarnation(current.sync.incarnation)),next=>next.sync.role===0,'dissolve-follower-unconfirmed');}
    });}finally{this.busy.delete(target);this.emit();}
  }
  async prune(context,target){
    const raw=await this.fresh(context);this.expect(raw,1,context.id);
    this.intentFence(context.id,incarnation(raw.sync.incarnation));
    if(!raw.sync.dissolutionV1||!/^[0-9a-f]{16}$/.test(raw.sync.session))return {supported:false};
    if(raw.sync.order.some(row=>row.id===target)){
      const order=raw.sync.order.map(row=>row.id).join(','),session=raw.sync.session;
      await this.mutation(context,membership(raw),lamp=>lamp.request('/api/group/remove',{target,order,session}),next=>next.sync.role===1&&!next.sync.order.some(row=>row.id===target),'prune-unconfirmed');
    }
    return {supported:true};
  }
  async cleanupSource(source,target,departedIncarnation=this.removalIncarnations.get(source)||''){
    if(!identity.test(source))return {phase:'unsupported',pending:false};
    if(this.busy.has(source)){await this.pending(source,target);return {phase:'pending',pending:true,uncertain:false};}
    this.busy.add(source);this.emit();
    try{return await this.leased(source,false,async context=>{
      const raw=await this.fresh(context);
      if(raw.sync.role===0){await this.clearPending(source,target);if(!this.pendingRemovals.get(source)?.size)await this.clearSource(source);return {phase:'dissolved',pending:false};}
      this.expect(raw,1,source);
      if(!raw.sync.dissolutionV1){await this.clearPending(source,target);return {phase:'legacy',pending:false};}
      if(!departedIncarnation||incarnation(raw.sync.incarnation)!==departedIncarnation)throw problem('The source lamp now coordinates another group. Review its current membership before cleanup.',{needsReconfirmation:true,stale:true});
      const prune=await this.prune(context,target);if(!prune.supported)throw problem('Coordinator removal contract is unavailable.');
      const remaining=await this.fresh(context);
      if(remaining.sync.order.length===1){this.intentFence(source,incarnation(remaining.sync.incarnation));await this.beginDissolve(source,[],incarnation(remaining.sync.incarnation));await this.mutation(context,membership(remaining),lamp=>lamp.configureSync(0,'',incarnation(remaining.sync.incarnation)),next=>next.sync.role===0,'source-stop-unconfirmed');await this.clearSource(source);return {phase:'dissolved',pending:false};}
      await this.clearPending(source,target);
      return {phase:'member-removed',pending:false};
    });}catch(error){try{await this.pending(source,target);}catch{/* The previously saved departure intent remains pending. */}return {phase:'pending',pending:true,uncertain:uncertain(error),storageFailed:error?.storageFailed===true,needsReconfirmation:error?.needsReconfirmation===true};}
    finally{this.busy.delete(source);this.emit();}
  }
  dissolve(id,{allowLegacy=false,reconfirm=false,expectedIncarnation}={}){
    return this.action([id],()=>this.leased(id,false,async coordinator=>{
      let raw=await this.fresh(coordinator);
      if(reconfirm&&(!incarnation(expectedIncarnation)||incarnation(raw.sync.incarnation)!==expectedIncarnation))throw problem('The reviewed group changed. Refresh its members before approving removal.',{needsReconfirmation:true,stale:true});
      if(raw.sync.role===0&&(this.pendingRemovals.has(id)||this.dissolving.has(id))){
        const confirmed=[],pending=[];
        for(const target of this.pendingRemovals.get(id)||[]){
          try{await this.departMember(id,target);await this.clearPending(id,target);confirmed.push(target);}
          catch(error){pending.push({id:target,uncertain:uncertain(error),storageFailed:error?.storageFailed===true,needsReconfirmation:error?.needsReconfirmation===true});}
        }
        if(pending.length)return {id,saved:false,phase:'dissolution-pending',confirmed,pending,coordinatorStopped:true};
        await this.clearSource(id);return {id,saved:true,phase:'dissolved',confirmed,pending:[],coordinatorStopped:true};
      }
      this.expect(raw,1,id);
      if(raw.sync.membershipLocked)throw problem('Finish this group’s staged update before removing it.');
      if(!raw.sync.dissolutionV1){
        if(!allowLegacy)throw problem('Update this coordinator to support confirmed group removal.',{incompatible:true});
        if(raw.sync.version===3&&raw.sync.order?.length>1&&!raw.sync.coordinatorMigration)throw problem('Move every member out before removing this coordinator. Coordinator migration is not supported.');
        await this.mutation(coordinator,membership(raw),lamp=>lamp.configureSync(0,'',incarnation(raw.sync.incarnation)),next=>next.sync.role===0,'stop-coordinating-unconfirmed');
        return {id,saved:true,phase:'stopped-coordinating',leader:null};
      }
      const retained=this.dissolving.has(id),current=incarnation(raw.sync.incarnation);
      if(retained&&!reconfirm)this.intentFence(id,current);
      const targets=retained&&!reconfirm?[...(this.pendingRemovals.get(id)||[])]:[...new Set([...(this.pendingRemovals.get(id)||[]),...raw.sync.order.map(row=>row.id).filter(target=>target!==id)])];
      await this.beginDissolve(id,targets,current,reconfirm);
      const confirmed=[],pending=[];
      for(const target of targets){
        try{
          // Already independent/moved targets are verified without re-enrollment.
          await this.departMember(id,target);
          const pruned=await this.prune(coordinator,target);if(!pruned.supported)throw problem('Coordinator removal contract is unavailable.');
          await this.clearPending(id,target);confirmed.push(target);
        }catch(error){pending.push({id:target,uncertain:uncertain(error),storageFailed:error?.storageFailed===true,needsReconfirmation:error?.needsReconfirmation===true});try{await this.pending(id,target);}catch{/* Initial durable intent is retained. */}}
      }
      raw=await this.fresh(coordinator);
      this.intentFence(id,incarnation(raw.sync.incarnation));
      for(const row of raw.sync.order)if(row.id!==id&&!pending.some(item=>item.id===row.id)){pending.push({id:row.id,uncertain:false,needsReconfirmation:!targets.includes(row.id)});}
      if(pending.length)return {id,saved:false,phase:'dissolution-pending',confirmed,pending,coordinatorStopped:false};
      await this.mutation(coordinator,membership(raw),lamp=>lamp.configureSync(0,'',incarnation(raw.sync.incarnation)),next=>next.sync.role===0,'dissolve-coordinator-unconfirmed');
      await this.clearSource(id);return {id,saved:true,phase:'dissolved',confirmed,pending:[],coordinatorStopped:true};
    }));
  }
  join(id,leaderId) {return this.transfer(id,leaderId,false);}
  move(id,leaderId) {return this.transfer(id,leaderId,true);}
  transfer(id,leaderId,moving) {
    if(id===leaderId)return Promise.reject(problem('A coordinator cannot follow itself.'));
    return this.action([id,leaderId],async()=>{
      let source=null,sourceIncarnation='',left=false,outcome,failure;
      try{outcome=await this.leased(leaderId,false,coordinator=>this.leased(id,false,async target=>{
      let code=null;
      try {
        const original=await this.fresh(target);this.expect(original,moving?2:0);
        const old=membership(original);
        if(moving)source=old.leader;
        if(moving&&old.leader===leaderId)return {id,leader:leaderId,saved:true,phase:'already-member',active:original.sync.active===true};
        let destination=await this.fresh(coordinator);this.capacity(destination,original);
        code=await this.queued(coordinator,lamp=>lamp.syncInvite());
        let invitation;try {invitation=parseGroupCode(code);}catch {throw problem('Coordinator returned an invalid private invitation.');}
        if(invitation.leader!==leaderId)throw problem('Coordinator invitation changed. Refresh Groups.',{stale:true});
        if((invitation.protocol===3)!==(destination.sync.version===3))throw problem('Coordinator invitation protocol changed. Refresh Groups.',{stale:true});
        invitation=null;
        destination=await this.fresh(coordinator);this.capacity(destination,original);
        const before=await this.fresh(target);if(!sameMembership(before,old))throw problem('Lamp membership changed before joining. Refresh Groups.',{stale:true});
        if(moving){
          sourceIncarnation=incarnation(before.sync.incarnation);await this.pending(source,id,sourceIncarnation,true);
          await this.mutation(target,old,lamp=>lamp.configureSync(0,'',sourceIncarnation),next=>next.sync.role===0,'leave-unconfirmed');left=true;
          destination=await this.fresh(coordinator);this.capacity(destination,original);
        }
        const independent=await this.fresh(target);this.expect(independent,0);
        this.guard(coordinator);this.capacity(coordinator.lamp.raw,independent);
        const joined=await this.mutation(target,membership(independent),lamp=>{
          this.guard(coordinator);this.capacity(coordinator.lamp.raw,lamp.raw);return lamp.configureSync(2,code);
        },next=>next.sync.role===2&&next.sync.leader===leaderId&&(destination.sync.version!==3||next.sync.version===3),'join-unconfirmed');
        return {id,leader:leaderId,saved:true,leftPrevious:left,phase:'joined',active:joined.sync.active===true};
      }catch(error){
        if(left)throw problem('Left the previous group; joining the new group was not confirmed. Refresh this lamp before trying again.',{leftPrevious:true,phase:'left',uncertain:uncertain(error)||error.uncertain===true});
        if(error.groupPublic)throw error;
        throw problem(uncertain(error)?'The private invitation or group change was not confirmed. Refresh before trying again.':'Could not prepare this group change. Refresh Groups and check both lamps.',{uncertain:uncertain(error),phase:'preflight'});
      }finally {code=null;}
    }));}catch(error){failure=error;}
      // Release destination/target links before touching the source coordinator.
      // Source cleanup still runs if the destination join failed after departure.
      const sourceCleanup=left?await this.cleanupSource(source,id,sourceIncarnation):null;
      if(failure){if(sourceCleanup)failure.sourceCleanup=sourceCleanup;throw failure;}
      return {...outcome,...(sourceCleanup?{sourceCleanup}:{})};
    });
  }
  async reconcileRemovals(source){
    await this.removalReady;
    if(!identity.test(source))throw problem('Choose a verified group.');
    if(this.dissolving.has(source))return this.dissolve(source);
    const targets=[...(this.pendingRemovals.get(source)||[])],confirmed=[],pending=[];
    for(const target of targets){
      try{
        const result=await this.action([target],async()=>{
          await this.leased(target,false,async context=>{const raw=await this.fresh(context);if(raw.sync.role===2&&raw.sync.leader===source)throw problem('This lamp has not confirmed leaving the source group.',{uncertain:true});});
          return this.cleanupSource(source,target);
        });
        if(result.pending)pending.push({id:target,...result});else confirmed.push(target);
      }catch(error){pending.push({id:target,uncertain:uncertain(error),storageFailed:error?.storageFailed===true});}
    }
    return {id:source,saved:!pending.length,phase:pending.length?'removal-pending':'removal-reconciled',confirmed,pending};
  }
  coordinator(id, operation) {
    return this.action([id],()=>this.leased(id,false,async context=>{
      const raw=await this.fresh(context);this.expect(raw,1,id);
      await this.queued(context,lamp=>{this.expect(lamp.raw,1,id);return operation(lamp,raw);});
      await this.fresh(context);return {id,leader:id,saved:true,phase:'updated'};
    }));
  }
  scene(id, patch) {
    return this.coordinator(id,(lamp,raw)=>{
      const value=groupSceneSettings(raw.sync,patch),scene=availableGroupScenes(raw.sync).find(item=>item.id===value.scene);
      if(!scene)throw problem('Update this coordinator to firmware that supports the chosen scene.');
      if(scene.audio&&!scene.optionalAudio&&!raw.audio?.installed)throw problem('This scene needs a microphone in its coordinator.');
      return lamp.configureGroupScene(value);
    });
  }
  order(id, ids) {return this.coordinator(id,lamp=>lamp.configureGroupOrder(ids));}
  audio(id, patch) {
    return this.coordinator(id,(lamp,raw)=>{
      if(!raw.audio?.installed)throw problem('This coordinator needs an installed microphone.');
      if(!Number.isInteger(patch?.gain)||patch.gain<1||patch.gain>64||!Number.isInteger(patch.gate)||patch.gate<0||patch.gate>1024||!Number.isInteger(patch.scale)||patch.scale<100||patch.scale>400)throw problem('Check microphone tuning ranges.');
      return lamp.request('/api/audio/tuning',patch);
    });
  }
  followerAction(id, action) {
    return this.action([id],()=>this.leased(id,false,async context=>{
      const raw=await this.fresh(context);this.expect(raw,2);const expected=membership(raw);
      await this.mutation(context,expected,lamp=>lamp.syncAction(action),next=>sameMembership(next,expected)&&(action==='pause'?next.sync.paused===true:next.sync.paused===false),action+'-unconfirmed');
      return {id,leader:expected.leader,saved:true,phase:action==='pause'?'paused':'resumed'};
    }));
  }
  pause(id) {return this.followerAction(id,'pause');}
  resume(id) {return this.followerAction(id,'resume');}
}
export { Groups as LampGroups };
