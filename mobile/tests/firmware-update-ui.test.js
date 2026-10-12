import test from 'node:test';
import assert from 'node:assert/strict';
import {firmwareUpdatePresentation,firmwareUpdateFailurePresentation,firmwareUpdateResultPresentation} from '../src/firmware-update-ui.js';
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
test('a reconciled unsent Wi-Fi failure explains the phone path on the next explicit attempt',()=>{
 const value=firmwareUpdateResultPresentation({outcome:'installationNotStarted'},{stages:[{stage:'wifi-preflight',code:'wifi-check-rejected',metadataIssued:false,beginAttempted:false,commitAttempted:false,wifiInstallAttempted:false}]});
 assert.match(value,/your phone will send it/);assert(!/Bluetooth|Wi-Fi|reconnect|unchanged/.test(value));
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
