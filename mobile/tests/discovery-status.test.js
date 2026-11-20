import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('async function discover('),end=source.indexOf("\n$('discover').onclick",start);
const implementation=source.slice(start,end)+'\nthis.discover=discover;';

function fixture(currentPage='settings'){
 const messages=[],button={disabled:false},lamps=[{id:'aabbccddeeff'}],calls=[];
 const context={isNative:true,currentPage,discovered:[],
  $:id=>{assert.equal(id,'discover');return button;},status:value=>messages.push(value),
  discovery:{beginRefresh:()=>calls.push('begin'),remember:value=>value},
  readNativeLampDiscovery:async()=>({lamps}),renderLamps:()=>calls.push('render'),
  refreshLampFirmware:options=>calls.push(options)};
 runInNewContext(implementation,context);
 return {discover:context.discover,messages,button,calls};
}

test('background discovery refreshes cached lamps without interrupting a resumed task',async()=>{
 const f=fixture();await f.discover();
 assert.deepEqual(f.messages,[]);
 assert.equal(f.button.disabled,false);
 assert.equal(f.calls[0],'render');assert.equal(f.calls[1].newDiscovery,true);
});

test('an explicit discovery gives relevant progress and result text',async()=>{
 const f=fixture();await f.discover(true);
 assert.deepEqual(f.messages,['Looking for lamps on your Wi-Fi…','Found 1 lamp. Choose a lamp to continue.']);
 assert.equal(f.button.disabled,false);
 assert.equal(f.calls[0],'begin');assert.equal(f.calls[1],'render');assert.equal(f.calls[2].newDiscovery,true);
});
