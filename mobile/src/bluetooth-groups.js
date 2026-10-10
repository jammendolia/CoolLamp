import { LampTransport } from './transport.js';
import { parseGroupCode, groupMemberLimit, supportsGroupProtocol } from './sync.js';

export async function initializeGroupRadio({transport,ble,platform,pairing,accessories,knownDevices,onAuthorized=()=>{}}) {
  if(transport.initialization)return transport.initialization;
  if(platform==='ios'){
    const current=await accessories.list();
    if(current.supported){
      const enrolled=new Set(current.devices.map(device=>device.deviceId.toLowerCase()));
      const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if(knownDevices().some(device=>uuid.test(device.deviceId||'')&&!device.accessoryManaged&&!enrolled.has(device.deviceId.toLowerCase())))
        throw Object.assign(Error('Connect a previously saved lamp from Lamps to finish iPhone authorization before using Bluetooth groups.'),{needsAuthorization:true});
      onAuthorized(current.devices);
    }
  }
  // Background discovery must never present the legacy migration picker. The
  // explicit main connection still performs that authorization before init.
  if(!transport.initialization)transport.initialization=ble.initialize({androidNeverForLocation:true}).catch(error=>{transport.initialization=null;throw error;});
  await transport.initialization;pairing.radioStarted=true;return transport.initialization;
}

// Radio advertisements are hints. Invitations come only from a protected,
// identity-verified connection to a coordinator already saved on this phone.
export class BluetoothGroups {
  constructor({ble,getTarget,getLamps,onStatus=()=>{},acquire=null,createTransport=options=>new LampTransport(ble,options)}) {
    Object.assign(this,{ble,getTarget,getLamps,onStatus,createTransport,acquire});this.generation=0;this.links=new Set();
  }
  cancel() { ++this.generation;for(const link of this.links)link.disconnect().catch(()=>{});this.links.clear(); }
  snapshot() {
    const lamp=this.getTarget();
    if(!lamp?.supportsOfflineGroups||!lamp.identity)throw Error('Connect to a lamp with offline Bluetooth groups.');
    return {lamp,id:lamp.identity,base:lamp.base,epoch:lamp.epoch,wire:lamp.raw?.sync?.version,role:lamp.raw?.sync?.role};
  }
  guard(target,generation) {
    const current=this.getTarget();
    if(generation!==this.generation||current!==target.lamp||current.identity!==target.id||current.base!==target.base||
      current.epoch!==target.epoch||current.raw?.sync?.version!==target.wire||current.raw?.sync?.role!==target.role)
      throw Error('The selected lamp changed. Choose Join again.');
  }
  candidates(target) {
    const entries=new Map();
    for(const peer of target.lamp.raw?.sync?.peers||[])if(peer.role===1&&/^[0-9a-f]{12}$/.test(peer.id)&&peer.id!==target.id)
      entries.set(peer.id,{id:peer.id,name:peer.name});
    for(const known of this.getLamps()||[])if(/^[0-9a-f]{12}$/.test(known.id)&&known.id!==target.id&&known.deviceId)
      entries.set(known.id,{...entries.get(known.id),...known});
    return [...entries.values()];
  }
  async withCoordinator(entry,target,generation,action,readOnly=false) {
    if(!entry?.deviceId)throw Error('Pair the coordinator with this phone first. Hold its knob for six seconds, connect by Bluetooth, then return to this lamp.');
    this.guard(target,generation);
    // Sharing initialization is essential: initializing a second native manager
    // can orphan the selected lamp's existing connection.
    if(!target.lamp.initialization)throw Error('Bluetooth radio is not ready. Reconnect this lamp.');
    const lease=this.acquire?await this.acquire(entry.id,{entry,readOnly,purpose:'offline-groups'}):null;
    const link=lease?.lamp||this.createTransport({sharedInitialization:target.lamp.initialization,expectedDeviceIdentity:entry.id,controlOnly:true});
    const cleanup=lease?lease.release:()=>link.disconnect();
    const owned={disconnect:cleanup};this.links.add(owned);
    try{
      if(!lease)await link.connect({...entry,lampId:entry.id});
      this.guard(target,generation);await link.enqueue(()=>link.refresh(entry.id));this.guard(target,generation);
      if(!link.supportsOfflineGroups||link.identity!==entry.id)throw Error('Update the coordinator to firmware 1.10.0 for offline groups.');
      if(link.raw?.sync?.role!==1)throw Object.assign(Error('This lamp is not a coordinator.'),{notCoordinator:true});
      return await action(link);
    }finally{this.links.delete(owned);await cleanup();}
  }
  async scan() {
    const target=this.snapshot(),generation=++this.generation,results=[];
    await target.lamp.enqueue(()=>target.lamp.refresh(target.id));this.guard(target,generation);
    for(const entry of this.candidates(target)){
      this.guard(target,generation);
      const publish=value=>{this.guard(target,generation);const status={id:entry.id,name:entry.name||'CoolLamp',...value};results.push(status);this.onStatus(entry.id,status);};
      if(!entry.deviceId){publish({state:'needs-pairing',verified:false});continue;}
      this.onStatus(entry.id,{id:entry.id,name:entry.name||'CoolLamp',state:'checking',verified:false});
      try{await this.withCoordinator(entry,target,generation,async link=>{
        const sync=link.raw.sync;
        publish({state:'coordinator',verified:true,role:1,members:sync.members??0,checkedAt:Date.now(),
          joinable:supportsGroupProtocol(target.lamp.raw?.sync,sync.version)&&groupMemberLimit(sync)>0&&(sync.members??0)<groupMemberLimit(sync)-1,
          message:!supportsGroupProtocol(target.lamp.raw?.sync,sync.version)?'Update both lamps to compatible group firmware.':
            !groupMemberLimit(sync)||(sync.members??0)>=groupMemberLimit(sync)-1?'Group is full.':'Coordinator · '+(sync.members??0)+' following · Bluetooth'});
      },true);}catch(error){this.guard(target,generation);publish({state:error.notCoordinator?'not-coordinator':'failed',verified:false,
        message:error.notCoordinator?'Independent lamp.':'Could not verify this saved Bluetooth lamp. Bring it nearby or open its six-second pairing window and reconnect.'});}
    }
    return {results,coordinators:results.filter(value=>value.state==='coordinator'),cancelled:false};
  }
  async invite(id) {
    const target=this.snapshot(),generation=this.generation;
    if(target.role!==0)throw Error('Leave this lamp’s current group before joining another.');
    if(id===target.id)throw Error('A lamp cannot follow itself.');
    const entry=this.candidates(target).find(value=>value.id===id);
    return this.withCoordinator(entry,target,generation,async link=>{
      const sync=link.raw.sync;
      if(!supportsGroupProtocol(target.lamp.raw?.sync,sync.version))throw Error('Update both lamps to compatible group firmware.');
      if(!groupMemberLimit(sync)||!Number.isInteger(sync.members)||sync.members>=groupMemberLimit(sync)-1||
        (sync.order?.length??0)>=groupMemberLimit(sync))throw Error('The coordinator group is full or unavailable.');
      const code=await link.enqueue(()=>link.syncInvite());this.guard(target,generation);
      if(parseGroupCode(code).leader!==id)throw Error('The coordinator invitation changed. Refresh and try again.');
      await link.enqueue(()=>link.refresh(id));this.guard(target,generation);
      if(link.raw.sync.role!==1||!supportsGroupProtocol(target.lamp.raw?.sync,link.raw.sync.version))throw Error('The coordinator changed. Refresh and try again.');
      return {id,code,targetId:target.id};
    });
  }
}
