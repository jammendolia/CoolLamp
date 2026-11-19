import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_LOCAL_HOME,microphoneProvisioningDefault,normalizeHomeContext,readHomeContext,buildLightsOverview,automationPresentation} from '../src/ecosystem-foundation.js';

test('local home fallback is non-destructive and rejects malformed saved context',()=>{
 let writes=0;const storage={getItem:()=>'{bad',setItem:()=>writes++};
 const value=readHomeContext(storage);
 assert.equal(value.activeHomeId,DEFAULT_LOCAL_HOME.id);assert.equal(value.active.name,'My home');assert.equal(writes,0);
 assert.equal(normalizeHomeContext({activeHomeId:'missing',homes:[{id:'lake',name:'Lake house',mode:'hybrid'}]}).activeHomeId,'lake');
});

test('microphone provisioning defaults follow product rules and explicit exceptions',()=>{
 assert.equal(microphoneProvisioningDefault('lamp'),true);
 assert.equal(microphoneProvisioningDefault('super-lamp'),true);
 assert.equal(microphoneProvisioningDefault('bridge'),false);
 assert.equal(microphoneProvisioningDefault('controller'),false);
 assert.equal(microphoneProvisioningDefault('lamp',false),false);
 assert.equal(microphoneProvisioningDefault('bridge',true),true);
});

test('lights overview keeps rooms, synchronized groups and every physical device distinct without leaking routes',()=>{
 const leader={id:'a',name:'Left',room:'Living room',sync:{role:1,active:true},address:'192.168.1.9',token:'secret'},follower={id:'b',name:'Right',sync:{role:2,active:false,paused:true}},hall={id:'c',name:'Hall strip',productKind:'strip'};
 const view=buildLightsOverview({lamps:[leader,follower,hall],groups:[{id:'a',name:'Old name',leader,followers:[follower],available:true}]},{rooms:{b:'Living room',c:'Hallway'},groupNames:{a:'Window lights'}});
 assert.deepEqual(view.rooms.map(room=>[room.name,room.devices.length]),[['Hallway',1],['Living room',2]]);
 assert.deepEqual(view.groups.map(group=>({name:group.name,count:group.count,separate:group.separate})),[{name:'Window lights',count:2,separate:1}]);
 assert.deepEqual(view.devices.map(device=>device.id),['a','b','c']);
 assert.equal(view.devices[0].source,undefined);assert.doesNotMatch(JSON.stringify(view),/192\.168|secret/);
});

test('automation presentation accepts only bounded semantic schedule fields',()=>{
 const missing=automationPresentation();assert.equal(missing.state,'not-configured');assert.equal(missing.schedules.length,0);assert.match(missing.empty.title,/coming soon/);
 const checking=automationPresentation({state:'checking',lastUpdatedAt:60000,schedules:[{id:'night',name:'Window display',state:'on',nextEvent:{action:'turn-off',when:{kind:'midnight'}},token:'secret',address:'192.168.1.4'}]},{now:180000});
 assert.equal(checking.notice.kind,'checking');assert.equal(checking.next,null);assert.match(checking.notice.detail,/2 minutes ago/);assert.equal(checking.schedules[0].status,'Last checked');assert.equal(checking.schedules[0].detail,'On · Every day · Sunset to midnight');assert.equal(checking.schedules[0].next,null);assert.equal(checking.schedules[0].token,undefined);assert.doesNotMatch(JSON.stringify(checking),/secret|192\.168/);
 const failed=automationPresentation({state:'unreachable',lastUpdatedAt:60000,schedules:[{id:'night',name:'Window display',state:'on',nextEvent:{action:'turn-off',when:{kind:'midnight'}}}]},{now:180000});assert.equal(failed.notice.action.id,'retry-automations');assert.match(failed.notice.detail,/2 minutes ago/);assert.equal(failed.next,null);assert.equal(failed.schedules[0].status,'Last checked');assert.match(failed.schedules[0].detail,/On · Every day/);
 const changed=automationPresentation({state:'ready',schedules:[{id:'night',name:'Window display',state:'changed',manualHold:true,nextEvent:{action:'turn-on',when:{kind:'clock',value:'17:33'}}}]});assert.equal(changed.schedules[0].detail,'Changed until 5:33 PM');assert.match(changed.next.label,/returns to its schedule/);
 const location=automationPresentation({state:'ready',schedules:[{id:'night',name:'Window display',state:'attention',reasonCode:'home-location-needed',primaryAction:'set-home-location'}]});assert.equal(location.schedules[0].action.id,'automation-location-help');
 const recovery=automationPresentation({state:'ready',schedules:[{id:'night',name:'Window display',state:'attention',reasonCode:'saved-schedule-needs-recovery',primaryAction:'view-recovery'}]});assert.equal(recovery.schedules[0].action.id,'automation-storage-help');
 const malicious=automationPresentation({state:'ready',canCreate:true,executorName:'Router 192.168.1.9',schedules:[{id:'x',name:'<script>',state:'made-up',next:'Last run successful'}]});assert.equal(malicious.canCreate,undefined);assert.equal(malicious.executorName,undefined);assert.equal(malicious.schedules[0].state,'attention');assert.doesNotMatch(JSON.stringify(malicious),/192\.168|Last run successful/);
});
