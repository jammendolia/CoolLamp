// Public progress describes work actually completed, never downloaded bytes as
// bytes written to a lamp. Native errors stay in diagnostics, not the main task.
export function firmwareUpdatePresentation(value={}){
 const messages={wifi:'Preparing your lamp…',connecting:'Connecting to your lamp…',
  'recovering-connection':'Restoring the connection to your lamp…',downloading:'Getting the update on your phone…',
  downloaded:'Update downloaded. Preparing your lamp…',preparing:'Preparing your lamp…',
  verifying:'Finishing the update. Keep your lamp powered…',restarting:'Your lamp is restarting…',
  'checking-result':'Checking that your lamp finished updating…'};
 const percent=Number.isInteger(value.progress)&&value.progress>=0&&value.progress<=100?value.progress:undefined;
 if(value.stage==='transferring')return {message:percent===undefined?'Sending the update to your lamp…':'Updating your lamp · '+percent+'%',progress:percent};
 return {message:messages[value.stage]||'Checking your lamp…'};
}
export function firmwareUpdateFailurePresentation(error,{pending=false}={}){
 if(pending)return 'The connection was lost. We’ll check your lamp when it is available. Keep it powered and nearby.';
 if(error?.stopReason==='user')return 'Update cancelled. Nothing more will be sent to your lamp.';
 if(error?.stopReason==='app-hidden'||error?.cancelled)return 'The update stopped when the app closed. Keep CoolLamp open during updates.';
 if(error?.identity)return 'We found a different lamp. Your update was not sent. Check that the intended lamp is nearby.';
 if(error?.storageFailure||error?.journalFailure)return 'This phone could not save the update status. No new update was sent. Free some phone storage and try again.';
 if(error?.bootstrapRequired)return 'This lamp needs a one-time service update before phone updates can work. Your lamp is unchanged.';
 return 'The update did not start. Keep your lamp powered and nearby, then tap Try again.';
}
