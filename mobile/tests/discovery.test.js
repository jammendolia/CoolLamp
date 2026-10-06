import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LampDiscoverySession} from '../src/lamps.js';

test('session keeps unconnected discoveries across empty/partial refreshes and updates addresses',()=>{
 const session=new LampDiscoverySession();
 const a={id:'one',name:'Lamp 1',address:'192.168.1.154'};
 const b={id:'two',name:'Lamp 2',address:'192.168.1.222'};
 session.remember([a,b]);
 assert.equal(session.items.length,2);
 session.remember([]);
 assert.equal(session.items.length,2);
 session.remember([{...b,address:'192.168.1.223'}]);
 assert.equal(session.items.length,2);
 assert.equal(session.items.find(x=>x.id==='two').address,'http://192.168.1.223');
 assert.equal(session.scanned,true);
 const restarted=new LampDiscoverySession();
 assert.deepEqual(restarted.items,[]);
 assert.equal(restarted.scanned,false);
});

test('session rejects malformed/nonlocal discoveries and does not retain credentials',()=>{
 const session=new LampDiscoverySession();
 session.remember([null,{id:'',address:'192.168.1.2'},{id:'bad',address:'https://example.com'},
  {id:'ok',address:'192.168.1.2',password:'secret',token:'secret'}]);
 assert.equal(session.items.length,1);
 assert.equal(session.items[0].password,undefined);
 assert.equal(session.items[0].token,undefined);
});
test('removal drops cached discovery, ignores late results and permits explicit rediscovery',()=>{
 const session=new LampDiscoverySession(),lamp={id:'one',name:'Lamp',address:'192.168.1.2'};
 session.remember([lamp]);session.forget('one');assert.deepEqual(session.items,[]);
 session.remember([lamp]);assert.deepEqual(session.items,[]);
 session.beginRefresh();session.remember([lamp]);assert.equal(session.items.length,1);
 session.beginRefresh();session.forget('one');session.remember([lamp]);assert.deepEqual(session.items,[]);
});
