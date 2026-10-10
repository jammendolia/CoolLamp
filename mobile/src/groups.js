import { createGroupCode, parseGroupCode } from './sync.js';
import { availableGroupScenes, groupSceneSettings } from './group-scenes.js';
import { validFirmwareVersion } from './lamps.js';

const identity = /^[0-9a-f]{12}$/;
const problem = (message, fields = {}) => Object.assign(new Error(message), {groupPublic:true, ...fields});
const text = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').replace(/CL1-[0-9a-f]{12}-[0-9a-f]{32}/gi, '[private group information]').slice(0, 96) : '';
const uncertain = error => error?.uncertain === true || error?.code === 'COMMAND_NOT_CONFIRMED';
const copy = value => JSON.parse(JSON.stringify(value));
const fields = (source, names) => Object.fromEntries(names.filter(name => source?.[name] !== undefined).map(name => [name, copy(source[name])]));
const membership = raw => ({role:raw.sync.role, leader:raw.sync.role ? raw.sync.leader : null, version:raw.sync.version});
const sameMembership = (raw, expected) => ['role','leader','version'].every(key => membership(raw)[key] === expected[key]);
const session = lamp => typeof lamp.raw?.token === 'string' ? lamp.raw.token : null;

function descriptor(entry) {
  if (!identity.test(entry?.id)) return null;
  return {...fields(entry, ['address','deviceId','hostname','accessoryManaged','accessoryName','bluetoothName','newAuthorization']), id:entry.id, name:text(entry.name) || 'CoolLamp'};
}
function validate(raw, id) {
  if (raw?.deviceId !== id) throw problem('Lamp identity changed. Refresh Groups before trying again.', {stale:true});
  const sync = raw.sync;
  if (![1,2].includes(sync?.version) || ![0,1,2].includes(sync.role) ||
      sync.role === 1 && sync.leader !== id || sync.role === 2 && (!identity.test(sync.leader) || sync.leader === id)) {
    throw problem('This lamp returned incompatible group settings.', {incompatible:true});
  }
  return raw;
}
function publicSync(sync) {
  const result = {version:sync.version,role:sync.role,leader:sync.role?sync.leader:'',active:sync.active===true,paused:sync.paused===true};
  for(const key of ['members','sceneCount','scene','position','count','sceneSpeed','sceneIntensity'])if(Number.isInteger(sync[key])&&sync[key]>=0&&sync[key]<=65535)result[key]=sync[key];
  for(const key of ['scenePrimary','sceneSecondary'])if(Array.isArray(sync[key])&&sync[key].length===3&&sync[key].every(n=>Number.isInteger(n)&&n>=0&&n<=255))result[key]=[...sync[key]];
  result.transport=['udp','esp-now','hybrid','none'].includes(sync.transport)?sync.transport:'none';
  result.order = (Array.isArray(sync.order) ? sync.order : []).filter(entry => identity.test(entry?.id)).slice(0,9)
    .map(entry => ({id:entry.id,name:text(entry.name) || 'CoolLamp',online:entry.online === true}));
  result.peers = (Array.isArray(sync.peers) ? sync.peers : []).filter(entry => identity.test(entry?.id)).slice(0,8)
    .map(entry => ({id:entry.id,name:text(entry.name) || 'CoolLamp',address:typeof entry.address==='string'?entry.address:'',role:[0,1,2].includes(entry.role)?entry.role:null,microphone:entry.microphone===true,
      transport:['udp','esp-now','hybrid'].includes(entry.transport)?entry.transport:'none',channel:Number.isInteger(entry.channel)&&entry.channel>=0&&entry.channel<=14?entry.channel:0}));
  result.radio={available:sync.radio?.available===true,seeking:sync.radio?.seeking===true};
  if(sync.radio?.security==='aes-gcm-128')result.radio.security='aes-gcm-128';
  for(const key of ['channel','received','receiveDropped','sent','sendFailed','sendDropped','channelChanges'])if(Number.isInteger(sync.radio?.[key])&&sync.radio[key]>=0&&sync.radio[key]<=0xffffffff)result.radio[key]=sync.radio[key];
  return result;
}

// The factory chooses a verified HTTP link or an already-authorized Bluetooth
// link. This model never selects a lamp, owns a phone credential or stores an
// invitation. Release callbacks decide whether a lease owns its connection.
export class Groups {
  constructor({getLamps = () => [], discover = async () => [], acquire, onStatus, now = Date.now, concurrency = 2, scanTimeout = 45000, random = globalThis.crypto} = {}) {
    if (typeof acquire !== 'function') throw Error('Groups needs a lamp connection factory.');
    Object.assign(this, {getLamps,discover,acquire,onStatus,now,random});
    this.concurrency = Math.max(1,Math.min(2,concurrency));
    this.scanTimeout=Math.max(1,scanTimeout);this.scanActive=0;this.slotWaiters=[];
    this.rows = new Map(); this.entries = new Map(); this.busy = new Set(); this.run = null;
    this.forgotten=new Set();this.authorizations=new Map();this.removedMemberships=new Map();
    this.scanning = false; this.cancelled = false;
  }
  snapshot() {
    const publicRows=new Map(this.rows);
    for(const [id,row] of this.removedMemberships)if(this.forgotten.has(id))publicRows.set(id,row);
    const lamps = [...publicRows.values()].map(copy), groups = new Map();
    for (const row of lamps) if (row.verified && row.role === 1) groups.set(row.id, {id:row.id,name:row.name,leader:row,followers:[],available:row.available,placeholder:false,capacity:8});
    for (const row of lamps) if ((row.verified||row.lastSeenMembership) && row.role === 2) {
      if (!groups.has(row.leader)) groups.set(row.leader, {id:row.leader,name:'Unavailable coordinator',available:false,placeholder:true,capacity:8,
        leader:{id:row.leader,name:'Unavailable coordinator',available:false,verified:false,state:'missing',role:1,leader:row.leader,sync:null,audio:null,message:'Coordinator has not been verified.'},followers:[]});
      groups.get(row.leader).followers.push(row);
    }
    for (const group of groups.values()) {
      group.usedSlots = Math.min(8,Math.max(group.followers.length, Number.isInteger(group.leader.sync?.members) ? group.leader.sync.members : 0,
        Math.max(0,(group.leader.sync?.order?.length || 1)-1)));
      group.remaining = 8-group.usedSlots;
    }
    return {lamps,groups:[...groups.values()],ungrouped:lamps.filter(row => row.verified && row.role === 0),
      unavailable:lamps.filter(row => (!row.verified || row.role === null)&&!row.lastSeenMembership),scanning:this.scanning,cancelled:this.cancelled,busyIds:[...this.busy]};
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
    if(raw.sync.version!==target.sync.version)throw problem('Update these lamps to matching group firmware before joining.');
    const order=Array.isArray(raw.sync.order)?raw.sync.order:[];
    if((order.length>=9||raw.sync.members>=8)&&!order.some(row=>row.id===target.deviceId))throw problem('This group is full (nine lamps).');
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
  create(id) {
    return this.action([id],()=>this.leased(id,false,async context=>{
      const raw=await this.fresh(context);this.expect(raw,0);
      let code=createGroupCode(id,this.random);
      try {const saved=await this.mutation(context,membership(raw),lamp=>lamp.configureSync(1,code),next=>next.sync.role===1&&next.sync.leader===id,'create-unconfirmed');return {id,leader:id,saved:true,phase:'created',active:saved.sync.active===true};}
      finally {code=null;}
    }));
  }
  leave(id) {
    return this.action([id],()=>this.leased(id,false,async context=>{
      const raw=await this.fresh(context);this.expect(raw,2);
      await this.mutation(context,membership(raw),lamp=>lamp.configureSync(0),next=>next.sync.role===0,'leave-unconfirmed');
      return {id,saved:true,phase:'left',leader:null};
    }));
  }
  stopCoordinating(id) {
    return this.action([id],()=>this.leased(id,false,async context=>{
      const raw=await this.fresh(context);this.expect(raw,1,id);
      await this.mutation(context,membership(raw),lamp=>lamp.configureSync(0),next=>next.sync.role===0,'stop-coordinating-unconfirmed');
      return {id,saved:true,phase:'stopped-coordinating',leader:null,
        message:'This lamp is now independent. Choose a group below to make it a follower. Former followers keep their saved membership; move them separately.'};
    }));
  }
  join(id,leaderId) {return this.transfer(id,leaderId,false);}
  move(id,leaderId) {return this.transfer(id,leaderId,true);}
  transfer(id,leaderId,moving) {
    if(id===leaderId)return Promise.reject(problem('A coordinator cannot follow itself.'));
    return this.action([id,leaderId],()=>this.leased(leaderId,false,coordinator=>this.leased(id,false,async target=>{
      let left=false,code=null;
      try {
        const original=await this.fresh(target);this.expect(original,moving?2:0);
        const old=membership(original);
        if(moving&&old.leader===leaderId)return {id,leader:leaderId,saved:true,phase:'already-member',active:original.sync.active===true};
        let destination=await this.fresh(coordinator);this.capacity(destination,original);
        code=await this.queued(coordinator,lamp=>lamp.syncInvite());
        let invitation;try {invitation=parseGroupCode(code);}catch {throw problem('Coordinator returned an invalid private invitation.');}
        if(invitation.leader!==leaderId)throw problem('Coordinator invitation changed. Refresh Groups.',{stale:true});
        invitation=null;
        destination=await this.fresh(coordinator);this.capacity(destination,original);
        const before=await this.fresh(target);if(!sameMembership(before,old))throw problem('Lamp membership changed before joining. Refresh Groups.',{stale:true});
        if(moving){
          await this.mutation(target,old,lamp=>lamp.configureSync(0),next=>next.sync.role===0,'leave-unconfirmed');left=true;
          destination=await this.fresh(coordinator);this.capacity(destination,original);
        }
        const independent=await this.fresh(target);this.expect(independent,0);
        this.guard(coordinator);this.capacity(coordinator.lamp.raw,independent);
        const joined=await this.mutation(target,membership(independent),lamp=>{
          this.guard(coordinator);this.capacity(coordinator.lamp.raw,lamp.raw);return lamp.configureSync(2,code);
        },next=>next.sync.role===2&&next.sync.leader===leaderId,'join-unconfirmed');
        return {id,leader:leaderId,saved:true,leftPrevious:left,phase:'joined',active:joined.sync.active===true};
      }catch(error){
        if(left)throw problem('Left the previous group; joining the new group was not confirmed. Refresh this lamp before trying again.',{leftPrevious:true,phase:'left',uncertain:uncertain(error)||error.uncertain===true});
        if(error.groupPublic)throw error;
        throw problem(uncertain(error)?'The private invitation or group change was not confirmed. Refresh before trying again.':'Could not prepare this group change. Refresh Groups and check both lamps.',{uncertain:uncertain(error),phase:'preflight'});
      }finally {code=null;}
    })));
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
