import {normalizeSavedLook,resolveSavedLookEffect} from './saved-looks.js';
import {partialLight} from './experience-contracts.js';

// This is the existing bounded light contract, not an executable recipe saved
// in local storage. Never send power, startup, NVS, hardware or group changes.
export function planSavedLook(value,{lampId,catalog}={}){
 const look=normalizeSavedLook(value),entry=resolveSavedLookEffect(look,{lampId,catalog});
 if(typeof entry.speed!=='boolean')throw Error('Read this lamp’s effect controls before using a look.');
 const {brightness,color,options}=look.appearance,mode=entry.id;
 const tuning={mode,intensity:options[1],dual:options[2],r2:options[3],g2:options[4],b2:options[5]};
 if(entry.speed)tuning.speed=options[0];
 // Firmware deliberately rejects resetPalette together with RGB or tuning.
 // Automatic colors therefore need two receipt-fenced steps; placeholder
 // primary RGB must never be sent, since doing so enables a custom palette.
 const patches=color[0]===0?[{mode,brightness,resetPalette:1},tuning]:[
  {...tuning,brightness,r:color[1],g:color[2],b:color[3]}
 ];
 return Object.freeze({mode,patches:Object.freeze(patches.map(partialLight))});
}

export async function applySavedLook(look,{session,lampId,catalog,guard=()=>{}}={}){
 const plan=planSavedLook(look,{lampId,catalog});guard();
 if(session?.target!==lampId||typeof session.patch!=='function'||typeof session.fresh!=='function')throw Error('Reconnect to this lamp before using a look.');
 if(session.pending)throw Error('Check the previous unconfirmed change before using a saved look.');
 const controls=session.descriptor?.capabilities?.control;
 if(!controls?.includes('command-receipts-v1')||!controls.includes('group-revision-v1'))throw Error('Update this lamp’s software before using complete saved looks.');
 let appliedSteps=0,receipt;
 const totalSteps=plan.patches.length;
 try{
  const initial=await session.fresh();guard();
  if(initial.syncRole!==0)throw Error('The lamp’s group changed. Saved looks currently apply only to lamps outside a group.');
  let bootSession=initial.bootSession,expectedRevision=initial.revision;
  for(const patch of plan.patches){
   guard();receipt=await session.patch({target:lampId,bootSession,expectedRevision,patch});
   if(receipt.outcome==='uncertain'||receipt.executed!==true)return {outcome:receipt.outcome==='uncertain'?'uncertain':appliedSteps?'partial':'rejected',appliedSteps,totalSteps,receipt};
   ++appliedSteps;guard();
   if(appliedSteps<totalSteps){
    // A receipt's revision is the current state at reply time. Its separate
    // executionRevision fences the moment this command ran; using a newer
    // reply revision would silently accept an intervening knob/phone change.
    const executed=receipt.executionRevision;
    if(!Number.isInteger(executed)||executed<1||executed>0xffffffff||executed!==receipt.revision)
     return {outcome:'partial',appliedSteps,totalSteps,receipt};
    expectedRevision=executed;bootSession=receipt.bootSession;
   }
  }
  return {outcome:'executed',appliedSteps,totalSteps,receipt,
   changedAfter:Number.isInteger(receipt.executionRevision)&&receipt.executionRevision!==receipt.revision};
 }catch(error){
  // No retry, route fallback, rollback or receipt retirement. The owning
  // session retains an uncertain exact command for the existing Check flow.
  return {outcome:session.pending?'uncertain':appliedSteps===totalSteps?'executed':appliedSteps?'partial':'rejected',appliedSteps,totalSteps,receipt,error};
 }
}
