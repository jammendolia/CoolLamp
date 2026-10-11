import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('function refreshLampFirmware(');
const end=source.indexOf('\nasync function updateAllLamps(',start);
assert(start>=0&&end>start);
const handler=source.slice(start,end);
function fixture({cards=[],bluetooth=null,updating=false,pending=null}={}){
 const calls=[],context={Set,cardFirmwareTasks:new Map(cards.map(id=>[id,{}])),
  bluetoothFirmwareTask:bluetooth?{id:bluetooth}:null,fleetUpdating:updating,
  fleetRefreshRun:pending,fleetRefreshQueued:false,fleetSummary:'',renderFleetControls(){},
  fleet:{refresh(options){calls.push([...options.excludeIds]);return Promise.resolve({results:[],cancelled:false});}}};
 runInNewContext(handler+';globalThis.refresh=refreshLampFirmware;',context);
 return {context,calls,refresh:()=>context.refresh()};
}
test('production passive refresh excludes only card update targets',async()=>{
 const f=fixture({cards:['f0b950b2f180']});f.refresh();await f.context.fleetRefreshRun;
 assert.deepEqual(f.calls,[['f0b950b2f180']]);
});
test('production passive refresh excludes legacy Bluetooth update owner and deduplicates reused card owner',()=>{
 const f=fixture({cards:['f0b950b2f180'],bluetooth:'f0b950b2f180'});f.refresh();
 assert.deepEqual(f.calls,[['f0b950b2f180']]);
 const legacy=fixture({bluetooth:'aabbccddeeff'});legacy.refresh();assert.deepEqual(legacy.calls,[['aabbccddeeff']]);
});
test('ordinary passive refresh has no excluded lamps; a pending or fleet update starts no extra refresh',()=>{
 const f=fixture();f.refresh();assert.deepEqual(f.calls,[[]]);
 const pending=fixture({pending:Promise.resolve()});pending.refresh();assert.deepEqual(pending.calls,[]);
 const updating=fixture({updating:true});updating.refresh();assert.deepEqual(updating.calls,[]);
});
