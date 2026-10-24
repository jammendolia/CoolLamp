import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsConnectionMessage} from '../src/settings-recovery.js';

test('lost settings links describe automatic recovery without telling the user to reconnect',()=>{
 const context={active:true,connected:false,name:'Reading corner'};
 assert.equal(settingsConnectionMessage('Lamp did not respond. Reconnect before trying again.',context),'Reconnecting to Reading corner…');
 assert.equal(settingsConnectionMessage('Disconnected. Choose a lamp to reconnect.',{...context,unconfirmed:true}),'The earlier change was not confirmed. Reconnecting to Reading corner…');
});
test('healthy settings, unrelated errors and the inventory retain their actual messages',()=>{
 const message='Reconnect over Bluetooth to use phone updates.';
 assert.equal(settingsConnectionMessage(message,{active:true,connected:true,name:'Reading corner'}),message);
 assert.equal(settingsConnectionMessage(message,{active:false,connected:false,name:'Reading corner'}),message);
 assert.equal(settingsConnectionMessage('The lamp rejected these settings.',{active:true,connected:false,name:'Reading corner'}),'The lamp rejected these settings.');
});
