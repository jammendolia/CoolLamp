import test from 'node:test';
import assert from 'node:assert/strict';
import {firmwareUpdatePresentation,firmwareUpdateFailurePresentation,firmwareUpdateResultPresentation,firmwareUpdateRouteChoicePresentation} from '../src/firmware-update-ui.js';
test('phone download completion never displays lamp sending 100 percent',()=>{
 for(const stage of ['downloading','downloaded','preparing','connecting','checking-result']){
  const value=firmwareUpdatePresentation({stage,progress:100});assert.equal(value.progress,undefined);assert(!/100%/.test(value.message));
 }
 assert.match(firmwareUpdatePresentation({stage:'downloaded',progress:100}).message,/downloaded/i);
 assert.deepEqual(firmwareUpdatePresentation({stage:'transferring',progress:38}),{message:'Updating your lamp · 38%',progress:38});
});
test('unconfirmed installation copy delegates checking to the app without promising success or another install',()=>{
 const value=firmwareUpdateFailurePresentation(Error('Not connected to device.'),{pending:true});
 assert.match(value,/We’ll check your lamp/);assert(!/reconnect|retry|100|installed|updated/i.test(value));
 assert(!value.includes('Not connected to device.'));
});
test('known preflight failure gives one plain action and never asks users to choose a transport',()=>{
 const value=firmwareUpdateFailurePresentation(Error('Native operation error'));
 assert.match(value,/did not start/);assert.match(value,/Try again/);assert(!/reconnect|Bluetooth|Wi-Fi|Native/.test(value));
});
test('enumerated pre-attempt failures keep specific safe guidance without exposing supplied details',()=>{
 const cases=[
  ['public-release',/phone’s Internet connection/],
  ['installed-version',/Connect to the lamp/],
  ['screen-awake',/screen unlocked/]
 ];
 for(const [preflightFailure,expected] of cases){
  const value=firmwareUpdateFailurePresentation(Object.assign(Error('private native and credential detail'),{preflightFailure}));
  assert.match(value,expected);assert.match(value,/Nothing was sent/);assert(!value.includes('private'));
  const pending=firmwareUpdateFailurePresentation(Object.assign(Error('private native and credential detail'),{preflightFailure}),{pending:true});
  assert.match(pending,/We’ll check your lamp/);assert(!/Nothing was sent/.test(pending));assert(!pending.includes('private'));
 }
 for(const preflightFailure of ['native-private','',null]){
  const value=firmwareUpdateFailurePresentation(Object.assign(Error('private native and credential detail'),{preflightFailure}));
  assert.match(value,/did not start/);assert(!value.includes('private'));
 }
});
test('a reconciled unsent Wi-Fi failure keeps the next explicit attempt on the Internet path',()=>{
 const value=firmwareUpdateResultPresentation({outcome:'installationNotStarted'},{stages:[{stage:'wifi-preflight',code:'wifi-check-rejected',metadataIssued:false,beginAttempted:false,commitAttempted:false,wifiInstallAttempted:false}]});
 assert.match(value,/retry/i);assert.match(value,/Internet download/);assert(!/phone will send|Bluetooth|reconnect|unchanged/.test(value));
});
test('a confirmed memory rejection offers explicit Internet and phone choices without raw diagnostics',()=>{
 const error=Object.assign(Error('private allocator detail'),{fallbackRequiresConsent:true,phoneFallbackAvailable:true,directInternetRetryAvailable:true,
  confirmed:true,uncertain:false,installationNotStarted:true,safeBluetoothFallback:false,failedPath:'wifi',firmwarePhase:5,firmwareError:8});
 const value=firmwareUpdateRouteChoicePresentation(error,'Reading lamp');assert.equal(value.title,'Internet download couldn’t start');
 assert.match(value.message,/Reading lamp/);assert.match(value.message,/free memory/);assert.match(value.message,/No new firmware was installed/);
 assert.match(value.message,/keep CoolLamp open/i);assert.match(value.message,/keep the phone near the lamp/i);
 assert.equal(value.retryLabel,'Try Internet again');assert.equal(value.phoneLabel,'Send from phone');assert(!value.message.includes('private allocator'));
 const fallback=firmwareUpdateFailurePresentation(error);assert.match(fallback,/This lamp/);assert.match(fallback,/No new firmware was installed/);assert(!fallback.includes('private allocator'));
 for(const unsafe of [{...error,uncertain:true},{...error,uncertain:undefined},{...error,confirmed:false},{...error,installationNotStarted:false},{...error,safeBluetoothFallback:true},{...error,failedPath:'bluetooth'}])assert.equal(firmwareUpdateRouteChoicePresentation(unsafe),null);
});
test('an uncertain installation never offers the next transfer regardless of an earlier failure',()=>{
 const value=firmwareUpdateResultPresentation({outcome:'unresolved',message:'We’ll check your lamp.'},{stages:[{stage:'wifi-preflight',code:'wifi-check-rejected'}]});
 assert.equal(value,'We’ll check your lamp.');assert(!/Try again/.test(value));
});
test('service prerequisites and invalid status produce specific saved outcomes, without raw native errors',()=>{
 const result={outcome:'installationNotStarted'};
 assert.match(firmwareUpdateResultPresentation(result,{stages:[{code:'firmware-rejected',firmwareError:5}]}),/one-time service update/);
 assert.match(firmwareUpdateResultPresentation(result,{stages:[{code:'invalid-status',message:'SSID password secret'}]}),/status could not be read/);
 assert(!firmwareUpdateResultPresentation(result,{stages:[{code:'invalid-status',message:'SSID password secret'}]}).includes('secret'));
});
test('foreground interruption explains sending stopped without claiming cancellation or offering a replay',()=>{
 const diagnostic={stages:[{code:'app-hidden',commitAttempted:false}]};
 const message=firmwareUpdateResultPresentation({outcome:'unresolved',message:'Checking…'},diagnostic);
 assert.match(message,/Sending stopped when CoolLamp left the screen/);
 assert.match(message,/checking your lamp/);
 assert(!/unchanged|cancelled|Try again|100%/i.test(message));
 assert.match(firmwareUpdateFailurePresentation({stopReason:'app-hidden'},{pending:true}),/when you return/);
 for(const commitAttempted of [true,undefined])assert.equal(firmwareUpdateResultPresentation({outcome:'unresolved',message:'Checking installation.'},{stages:[{code:'app-hidden',commitAttempted}]}),'Checking installation.');
 assert.equal(firmwareUpdateResultPresentation({outcome:'installed'},diagnostic),'Your lamp is updated.');
});

test('confirmed disconnected transfer gives a plain result and action without extending that claim to uncertainty',()=>{
 const diagnostic={stages:[{stage:'bluetooth-transfer',code:'native-disconnect',commitAttempted:false}]};
 const message=firmwareUpdateResultPresentation({outcome:'transferStopped',installedVersion:'1.15.2'},diagnostic);
 assert.match(message,/connection to your lamp was interrupted/);
 assert.match(message,/Your lamp was not updated/);assert.match(message,/Try again/);
 assert(!/reconnect|native|transfer|firmware|Bluetooth|Wi-Fi/.test(message));
 const unresolved=firmwareUpdateResultPresentation({outcome:'unresolved',message:'We’ll check your lamp.'},diagnostic);
 assert.equal(unresolved,'We’ll check your lamp.');assert(!/Try again|not updated/.test(unresolved));
});
