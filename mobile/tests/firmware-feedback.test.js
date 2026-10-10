import test from 'node:test';
import assert from 'node:assert/strict';
import {FirmwareFeedback} from '../src/firmware-feedback.js';
const id='aabbccddeeff',other='112233445566';
function memory(){const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};}
test('terminal per-lamp feedback survives reloading without keeping radio session data',()=>{
 const storage=memory(),feedback=new FirmwareFeedback(storage),attempt=feedback.begin(id);
 feedback.update(attempt,{message:'Receiver timed out. 56% confirmed.',progress:56,terminal:true,session:'must not persist',key:'must not persist'});
 const restored=new FirmwareFeedback(storage);assert.deepEqual(restored.get(id),{message:'Receiver timed out. 56% confirmed.',progress:56,terminal:true});assert.equal(restored.get(other),undefined);
 assert(!storage.getItem('coollamp-firmware-feedback-v1').includes('must not persist'));
});
test('a new explicit attempt clears its own feedback and rejects callbacks from the old attempt',()=>{
 const feedback=new FirmwareFeedback(memory()),old=feedback.begin(id),unrelated=feedback.begin(other);
 feedback.update(unrelated,{message:'Other lamp updated.',terminal:true});feedback.update(old,{message:'First failed.',terminal:true});
 const fresh=feedback.begin(id);assert.equal(feedback.get(id),undefined);assert(!feedback.update(old,{message:'Late old failure.',terminal:true}));
 feedback.update(fresh,{message:'Sending firmware · 45%',progress:45});assert.equal(feedback.get(id).progress,45);assert.equal(feedback.get(other).message,'Other lamp updated.');
});
test('removal invalidates late callbacks and clears persisted feedback',()=>{
 const storage=memory(),feedback=new FirmwareFeedback(storage),attempt=feedback.begin(id);feedback.update(attempt,{message:'Sending',progress:22});feedback.remove(id);
 assert(!feedback.update(attempt,{message:'Late failure',terminal:true}));assert.equal(new FirmwareFeedback(storage).get(id),undefined);
});
test('finished attempts cannot overwrite their terminal result or a different lamp',()=>{
 const feedback=new FirmwareFeedback(memory()),attempt=feedback.begin(id);feedback.update(attempt,{message:'Failed',progress:45,terminal:true});
 assert(!feedback.update(attempt,{message:'Late progress',progress:60}));assert.equal(feedback.get(id).message,'Failed');assert.equal(feedback.get(other),undefined);
});
test('in-progress state does not pretend a transfer is still running after app reload',()=>{
 const storage=memory(),feedback=new FirmwareFeedback(storage);feedback.update(feedback.begin(id),{message:'Sending',progress:56});assert.equal(new FirmwareFeedback(storage).get(id),undefined);
});
test('malformed stored feedback and invalid percentages cannot enter the UI',()=>{
 const storage=memory();storage.setItem('coollamp-firmware-feedback-v1',JSON.stringify([{id:'wrong',message:'bad',terminal:true},{id,session:3,message:'Safe',progress:900,terminal:true}]));
 const feedback=new FirmwareFeedback(storage);assert.deepEqual(feedback.get(id),{message:'Safe',terminal:true});assert.throws(()=>feedback.begin('wrong'));
});
