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
export function firmwareUpdateRouteChoicePresentation(error,name='This lamp'){
 if(error?.fallbackRequiresConsent!==true||error?.phoneFallbackAvailable!==true||error?.directInternetRetryAvailable!==true||
  error?.confirmed!==true||error?.uncertain!==false||error?.installationNotStarted!==true||error?.safeBluetoothFallback!==false||error?.failedPath!=='wifi')return null;
 const subject=typeof name==='string'&&name.trim()?name.trim():'This lamp';
 const reason=error.firmwareError===8?' because it did not have enough free memory':'';
 return Object.freeze({title:'Internet download couldn’t start',
  message:subject+' could not start its Internet download'+reason+'. No new firmware was installed. Try the Internet download again, send the update from this phone, or stop for now. If you send it from this phone, keep CoolLamp open and keep the phone near the lamp until it finishes.',
  retryLabel:'Try Internet again',phoneLabel:'Send from phone',cancelLabel:'Not now'});
}
export function firmwareUpdateFailurePresentation(error,{pending=false}={}){
 const route=firmwareUpdateRouteChoicePresentation(error);
 if(route)return route.message;
 if(pending&&error?.stopReason==='app-hidden')return 'Sending stopped when CoolLamp left the screen. We’ll check your lamp when you return. Keep it powered.';
 if(pending)return 'The connection was lost. We’ll check your lamp when it is available. Keep it powered and nearby.';
 if(error?.stopReason==='user')return 'Update cancelled. Nothing more will be sent to your lamp.';
 if(error?.stopReason==='app-hidden'||error?.cancelled)return 'The update stopped when the app closed. Keep CoolLamp open during updates.';
 if(error?.identity)return 'We found a different lamp. Your update was not sent. Check that the intended lamp is nearby.';
 if(error?.unauthorized||error?.authentication)return 'First approve this lamp on your phone using its Bluetooth icon. No update was sent.';
 if(error?.storageFailure||error?.journalFailure)return 'This phone could not save the update status. No new update was sent. Free some phone storage and try again.';
 if(error?.bootstrapRequired)return 'This lamp needs a one-time service update before phone updates can work. Your lamp is unchanged.';
 return 'The update did not start. Keep your lamp powered and nearby, then tap Try again.';
}
export function firmwareUpdateResultPresentation(result,diagnostic){
 if(result?.outcome==='installed')return 'Your lamp is updated.';
 const last=diagnostic?.stages?.at(-1);
 if(last?.code==='app-hidden'&&last.commitAttempted===false)return 'Sending stopped when CoolLamp left the screen. We’re checking your lamp. Keep it powered.';
 if(!['installationNotStarted','transferStopped'].includes(result?.outcome))return result?.message||'We’ll check your lamp when it is available. Keep it powered and nearby.';
 const failure=diagnostic?.stages?.at(-1);
 if(failure?.code==='authorization-required'&&failure.stage==='bluetooth-preflight')return 'First approve this lamp on your phone using its Bluetooth icon. No update was sent.';
 if(failure?.code==='bootstrap-required'||failure?.code==='firmware-rejected'&&failure.firmwareError===5)return 'This lamp needs a one-time service update before phone updates can work. No new firmware was installed.';
 if(result.outcome==='installationNotStarted'&&failure?.stage==='wifi-preflight'&&failure.metadataIssued===false&&failure.beginAttempted===false&&failure.commitAttempted===false&&failure.wifiInstallAttempted===false)
  return failure.firmwareError===8?'The lamp could not start its Internet download because it did not have enough free memory. No new firmware was installed. Tap Try again to retry the Internet download.':
   'The Internet download did not start. No new firmware was installed. Tap Try again to retry it.';
 if(failure?.code==='native-not-connected')return 'The connection closed before the update finished. Keep your lamp powered and nearby. The app will restore its connection on your next attempt.';
 if(result.outcome==='transferStopped'&&failure?.code==='native-disconnect')return 'The connection to your lamp was interrupted. Your lamp was not updated. Keep it powered and nearby, then tap Try again.';
 if(failure?.code==='invalid-status')return 'The lamp’s update status could not be read correctly. No new firmware was installed. Update details are saved below.';
 return result.outcome==='transferStopped'?'The transfer stopped before installation. Your lamp is still on its previous firmware. Update details are saved below.':'The update did not start. No new firmware was installed. Update details are saved below.';
}
