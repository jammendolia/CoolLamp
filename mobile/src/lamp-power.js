import {validFirmwareVersion} from './lamps.js';
import {groupObservation,lightingObservation,wifiObservation} from './lamp-connectivity.js';

const canonical=value=>typeof value==='string'&&/^[0-9a-f]{12}$/.test(value);
const cancelled=(message,extra={})=>Object.assign(new Error(message),{confirmed:true,cancelled:true,needsReview:true,...extra});
export function legacyPowerWithoutGroups(value) {
  const parts=validFirmwareVersion(value)?.split('.').map(Number);
  return Boolean(parts&&parts[0]===1&&(parts[1]<6||parts[1]===6&&parts[2]<=6));
}
function membership(raw) {
  const group=groupObservation(raw);
  if(group)return group;
  return raw?.sync===undefined&&legacyPowerWithoutGroups(raw?.firmware?.version)?{role:0,leader:null}:null;
}
const sameGroup=(left,right)=>Boolean(left&&right&&left.role===right.role&&left.leader===right.leader);
const blocked=raw=>[1,3,4].includes(raw?.firmware?.phase)||raw?.calibration?.active===true;

// Public card telemetry only: never return an HTTP token or invitation key.
export function lampPowerSnapshot(raw,catalog,checkedAt=Date.now()) {
  if(!canonical(raw?.deviceId)||typeof raw.power!=='boolean'||!Number.isInteger(raw.mode)||raw.mode<1||raw.mode>255)return null;
  const snapshot={id:raw.deviceId,power:raw.power,mode:raw.mode,firmwareVersion:validFirmwareVersion(raw.firmware?.version),
    group:membership(raw),lighting:lightingObservation(raw,catalog),wifi:wifiObservation(raw),checkedAt,
    paused:typeof raw.sync?.paused==='boolean'?raw.sync.paused:null,
    firmwarePhase:Number.isInteger(raw.firmware?.phase)&&raw.firmware.phase>=0&&raw.firmware.phase<=5?raw.firmware.phase:null,
    calibrating:raw.calibration?.active===true};
  for(const value of [snapshot.group,snapshot.lighting,snapshot.wifi])if(value)Object.freeze(value);
  return Object.freeze(snapshot);
}

// The caller owns its per-card request and address/device-UUID revision through
// isCurrent(). acquire must borrow the selected transport with a no-op release,
// or create an independently owned lease without changing main selection.
export async function runLampPower({id,expected=null,acquire,isCurrent=()=>true,onSnapshot=()=>{},now=Date.now}) {
  if(!canonical(id))throw cancelled('Find this lamp again so its identity can be verified.');
  if(typeof acquire!=='function')throw new Error('A lamp connection is required.');
  const expectedPower=typeof expected?.power==='boolean'?expected.power:null;
  const expectedGroup=expected?.group?groupObservation({deviceId:id,sync:{...expected.group,version:2}}):null;
  const desired=expectedPower===null?null:!expectedPower;
  let lease,lamp,epoch,address,legacyFirmware=null,lastSnapshot=null,attempted=false;
  const requestCurrent=()=>{
    if(!isCurrent(id))throw cancelled('This lamp card changed. Refresh it before trying again.');
  };
  const identityCurrent=()=>{
    requestCurrent();
    if(!lamp||lamp.identity!==id||lamp.epoch!==epoch||lamp.base!==address)
      throw cancelled('The lamp connection changed. Refresh this card before trying again.');
  };
  const currentRaw=()=>lamp.raw || (legacyFirmware?{...lamp.state,deviceId:lamp.identity,firmware:legacyFirmware}:null);
  const publish=(raw,checkedAt)=>{
    identityCurrent();
    const snapshot=lampPowerSnapshot(raw,lamp.catalog,checkedAt);
    if(!snapshot||snapshot.id!==id)throw cancelled('This connection did not return the correct lamp’s power state.');
    lastSnapshot=snapshot;onSnapshot(snapshot);identityCurrent();return snapshot;
  };
  const read=async()=>{
    identityCurrent();
    // Older BLE has no full RPC snapshot. Its protected identity and fresh
    // typed firmware prove the no-group generation; op5 requests state only.
    if(lamp.supportsOfflineControl===false&&lamp.id&&typeof lamp.refreshFirmware==='function') {
      let checkedAt;
      await lamp.enqueue(async()=>{identityCurrent();checkedAt=now();legacyFirmware=await lamp.refreshFirmware();identityCurrent();});
      // Keep the read-only binary command outside the action enqueue too: its
      // transport implementation owns its own command scheduling.
      await lamp.command('refresh',0,null,identityCurrent);identityCurrent();
      return lamp.enqueue(async()=>{
        identityCurrent();const raw=currentRaw();
        if(raw?.deviceId!==id)throw cancelled('This connection returned a different lamp. Refresh its card.');
        return {raw,snapshot:publish(raw,checkedAt)};
      });
    }
    return lamp.enqueue(async()=>{
      identityCurrent();const checkedAt=now();const result=await lamp.refresh(id);identityCurrent();const raw=result || lamp.raw;
      if(raw?.deviceId!==id)throw cancelled('This address belongs to a different lamp. Refresh the lamp list.');
      return {raw,snapshot:publish(raw,checkedAt)};
    });
  };
  try{
    requestCurrent();lease=await acquire(id,{readOnly:expectedPower===null||!expectedGroup,purpose:'power'});
    lamp=lease?.lamp || lease?.transport;
    requestCurrent();
    if(!lamp||lamp.identity!==id||!Number.isInteger(lamp.epoch)||typeof lamp.base!=='string'||typeof lamp.enqueue!=='function')
      throw cancelled('The connection did not verify this lamp’s identity.');
    epoch=lamp.epoch;address=lamp.base;
    const first=await read();identityCurrent();
    // A stale/unknown icon is a refresh action. Never infer a toggle from the
    // newly learned value during that same click.
    if(expectedPower===null||!expectedGroup)return {changed:false,refreshed:true,desired:null,snapshot:first.snapshot};
    if(!sameGroup(first.snapshot.group,expectedGroup))throw cancelled('This lamp’s group membership changed. Review its card before changing power.',{groupChanged:true});
    const satisfied=snapshot=>snapshot.power===desired&&!(expectedGroup.role===2&&!desired&&snapshot.paused!==true);
    // A follower can look off because its leader is off. An explicit local Off
    // must still invoke the setter once when following has not been paused.
    if(satisfied(first.snapshot))return {changed:false,noop:true,desired,snapshot:first.snapshot};
    if(blocked(first.raw))throw cancelled('Finish this lamp’s update or LED setup before changing power.',{blocked:true});
    const beforeWrite=()=>{
      identityCurrent();const raw=currentRaw(),current=lampPowerSnapshot(raw,lamp.catalog,now());
      if(!current||current.id!==id)throw cancelled('The lamp’s current power state could not be verified.');
      if(!sameGroup(current.group,expectedGroup)){publish(raw,now());throw cancelled('This lamp’s group membership changed. Review its card before changing power.',{groupChanged:true});}
      if(blocked(raw)){publish(raw,now());throw cancelled('Finish this lamp’s update or LED setup before changing power.',{blocked:true});}
      if(satisfied(current)){publish(raw,now());throw cancelled('The requested state is already active.',{alreadyDesired:true});}
      if(current.power!==first.snapshot.power){publish(raw,now());throw cancelled('Power changed while this request was waiting. Its current state is shown on the card.',{powerChanged:true,alreadyDesired:false});}
      attempted=true;
    };
    try{
      const command=()=>lamp.command('power',Number(desired),null,beforeWrite);
      // BLE has an action queue for RPC and a distinct binary wire queue.
      // Serialize power with both so an in-flight Leave cannot be overtaken.
      // Wi-Fi command owns the same queue as enqueue and must stay outside it.
      if(typeof lamp.id==='string'&&lamp.id&&typeof lamp.supportsOfflineControl==='boolean')
        await lamp.enqueue(()=>{identityCurrent();return command();});
      else await command();
    }catch(error){
      if(error.cancelled&&error.alreadyDesired&&!attempted)return {changed:false,noop:true,desired,snapshot:lastSnapshot};
      throw error;
    }
    identityCurrent();
    const confirmed=await read();identityCurrent();
    if(!sameGroup(confirmed.snapshot.group,expectedGroup)||confirmed.snapshot.power!==desired)
      throw Object.assign(new Error('The lamp did not confirm the requested power state. Refresh its card before trying again.'),{uncertain:true});
    // Off pauses the follower at runtime. Membership stays saved, and turning
    // back on does not send a Resume action or promise persistence over reboot.
    if(expectedGroup.role===2&&!desired&&confirmed.snapshot.paused!==true)
      throw Object.assign(new Error('The lamp did not confirm that following was paused. Refresh its group status.'),{uncertain:true});
    return {changed:true,desired,snapshot:confirmed.snapshot};
  }catch(failure){
    // No retry/reconnect/mutation verification path is allowed after an
    // uncertain reply. The owner can refresh separately on a later user action.
    const error=failure instanceof Error?failure:new Error('Lamp power could not be verified. Refresh this card before trying again.');
    if(attempted&&!error.confirmed&&!error.uncertain)error.uncertain=true;
    throw error;
  }finally{await lease?.release?.();}
}
