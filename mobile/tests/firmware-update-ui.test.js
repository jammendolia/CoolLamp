import test from 'node:test';
import assert from 'node:assert/strict';
import {firmwareUpdatePresentation,firmwareUpdateFailurePresentation} from '../src/firmware-update-ui.js';
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
