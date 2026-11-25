import {observedReceiverUpdate,observedSenderUpdate,updateSourceLabel} from './update-source.js';
import {firmwareUpdatePresentation} from './firmware-update-ui.js';

// Presentation only. No connection, polling, mutation or installation replay.
export function lampUpdatePresentation(target,{task,feedback,attempt,pending=false,observation,selectedSnapshot,selectedObservedAt=0,now=Date.now()}={}){
 const valid=Number.isInteger;
 const percent=value=>valid(value)&&value>=0&&value<=100?value:undefined;
 if(typeof target!=='string'||!/^[a-f0-9]{12}$/.test(target))return {active:false};
 const proof={verified:true,fresh:true,now};
 const selectedSender=observedSenderUpdate(selectedSnapshot,target,{...proof,observedAt:selectedObservedAt});
 const fleetSender=observedSenderUpdate(observation?.senderSnapshot,target,{verified:observation?.verified,fresh:observation?.fresh,now,observedAt:observation?.senderSnapshotAt});
 const sending=selectedSender!==null&&(fleetSender===null||selectedObservedAt>=observation.senderSnapshotAt)?selectedSender:fleetSender===true;
 const selectedReceiver=observedReceiverUpdate(selectedSnapshot,target,{...proof,observedAt:selectedObservedAt});
 const fleetReceiver=observation?.receiverSnapshot&&!['restarting','failed','offline','unsupported','needs-password','pending'].includes(observation.state)?
  observedReceiverUpdate(observation.receiverSnapshot,target,{...proof,observedAt:observation.receiverSnapshotAt}):null;
 const receiver=!pending&&!task?.cancelRequested&&!task?.reconciling&&(!task||task.stage==='wifi')&&(selectedReceiver||fleetReceiver);
 const directWifi=Boolean(!pending&&task?.stage==='wifi'&&!task.reconciling&&!task.cancelRequested);
 const fleetState=directWifi&&['checking','updating','restarting'].includes(observation?.state)?observation.state:null;
 const fleetProgress=directWifi&&fleetState==='updating'&&observation.verified===true&&observation.fresh===true?percent(observation.progress):undefined;
 const written=!pending&&task&&!task.reconciling&&!task.cancelRequested&&task.stage==='transferring'?percent(feedback?.progress):
  fleetProgress??(!task&&!pending&&observation?.state==='updating'&&observation.verified===true&&observation.fresh===true?percent(observation.progress):undefined);
 const progress=written??receiver?.progress;
 const source=task?.stage==='transferring'&&progress!==undefined?task.updateSource:receiver?.source;
 const receiverActive=['updating','restarting'].includes(observation?.state);
 const pendingOnly=Boolean(pending&&!task&&!receiverActive);
 const active=Boolean(task||receiver||receiverActive);
 // Persisted uncertainty is not evidence that a check is running. Keep it
 // visible as a bounded needs-attention result with a navigation escape.
 if(pendingOnly){
  const message=feedback?.terminal===true&&typeof feedback.message==='string'&&feedback.message.length<=240?
   feedback.message:'The previous update still needs a status check. No check is running now.';
  return {active:false,sending,terminal:true,attemptId:attempt?.attemptId,outcome:'needsAttention',percent:undefined,
   source:undefined,sourceLabel:'',receiver:null,stage:'needs-attention',message,keepOpen:false};
 }
 // A durable, settled attempt keeps its result visible after the connection
 // owner has gone. It is a result, not current receiver or progress evidence.
 const terminal=!active&&feedback?.terminal===true&&typeof feedback.message==='string'&&
  attempt?.identity===target&&/^[0-9a-f]{32}$/.test(attempt.attemptId)&&attempt.commitUnconfirmed!==true&&
  ['transferStopped','installationNotStarted'].includes(attempt.outcome);
 if(terminal)return {active:false,sending,terminal:true,attemptId:attempt.attemptId,outcome:attempt.outcome,
  percent:undefined,source:undefined,sourceLabel:'',receiver:null,stage:'stopped',message:feedback.message,keepOpen:false};
 const stage=(pending&&task)||task?.reconciling?'checking-result':task?.cancelRequested?'stopping':fleetState==='restarting'||observation?.state==='restarting'?'restarting':
  receiver||progress!==undefined?'transferring':fleetState||(task?task.stage||'preparing':'checking-result');
 const pendingMessage=pending&&feedback?.terminal&&['verification-required','verified-restarting'].includes(feedback.outcome)&&typeof feedback.message==='string'?feedback.message:null;
 const fleetMessage=fleetState&&typeof observation?.message==='string'&&observation.message.length>0&&observation.message.length<=160?observation.message:null;
 const message=pendingMessage||(stage==='stopping'?'Stopping the update. We’ll check your lamp…':fleetMessage||firmwareUpdatePresentation({stage,progress}).message);
 return {active,sending,percent:progress,source,sourceLabel:updateSourceLabel(source),receiver:receiver||null,stage,message,
  keepOpen:Boolean(task?.path==='bluetooth'&&!task.reconciling&&!task.cancelRequested)};
}
