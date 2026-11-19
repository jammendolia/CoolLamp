import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const appV2=readFileSync(new URL('../src/app-v2.js',import.meta.url),'utf8');
const appV2Css=readFileSync(new URL('../src/app-v2.css',import.meta.url),'utf8');

test('the persistent app shell has exactly the approved four destinations',()=>{
 const nav=html.slice(html.indexOf('<nav aria-label="Main navigation">'),html.indexOf('</nav>')+6);
 const pages=[...nav.matchAll(/data-page="([^"]+)"/g)].map(match=>match[1]);
 assert.deepEqual(pages,['home','lights','automations','app-settings']);
 assert.match(nav,/>Home</);assert.match(nav,/>Lights</);assert.match(nav,/>Automations</);assert.match(nav,/>Settings</);
 assert.doesNotMatch(nav,/data-page="effects"|data-page="help"/);
 assert.match(html,/id="page-lights"/);assert.match(html,/id="page-automations"/);
 assert.match(html,/data-v2="people-access"[^>]*><span><strong>People &amp; access/);assert.match(html,/id="page-people-access"/);
 assert.match(html,/People &amp; access<\/strong><small>See who can use this Home/);assert.doesNotMatch(html,/Invite people and manage access|Invite people and choose/);
 const homePage=html.slice(html.indexOf('<section id="page-home"'),html.indexOf('<section id="page-lights"'));assert.doesNotMatch(homePage,/people|member|permitted|this phone can control/i);
 assert.doesNotMatch(html+appV2,/works locally|local control|No account required|Remote access ready/i);
 assert.match(appV2Css,/body\[data-v2-page=people-access\] #status/);
 assert.match(html,/Device care<\/strong><small>Updates and maintenance/);
 assert.doesNotMatch(html,/gift readiness/i);
});

test('opening Automations is presentation-only and highlights only Automations',()=>{
 const start=main.indexOf('function page(name,'),end=main.indexOf('\n\nconst $ =',start),calls=[],elements=new Map();
 const pages=['home','lights','automations','lamps','groups','settings','app-settings','people-access','help','bridges'];
 const nav=['home','lights','automations','app-settings'].map(page=>({dataset:{page},current:false,setAttribute(name,value){if(name==='aria-current')this.current=value;},removeAttribute(name){if(name==='aria-current')this.current=false;}}));
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',querySelector:()=>({focus(){calls.push('focus');}})});return elements.get(id);};
 const context={$:element,settingsView:'lighting',navigationSerial:0,wifiSettingsTarget:null,groupFocusSerial:0,pendingGroupFocus:null,meshWizard:null,
  appV2:{endTour(){},navigate:name=>calls.push('navigate:'+name)},settingsRecovery:{check(){calls.push('recovery-check');}},window:{scrollTo(){}},cancelPeopleAccessRefresh(){calls.push('cancel-people-access');},refreshPeopleAccess(){calls.push('refresh-people-access');},
  document:{querySelectorAll:()=>nav},cancelMeshSelection(){calls.push('cancel-selection');},hideWifiPassword(){calls.push('hide-password');},closeGroupEditor(){calls.push('close-group');},scheduleLampStatusRefresh(){calls.push('schedule-status');},
  renderLamps(){calls.push('render-lamps');},refreshLampFirmware(){calls.push('read-firmware');},refreshPublicFirmware(){calls.push('read-release');},refreshBasicBluetoothTelemetry(){calls.push('read-bluetooth');},refreshNewMeshLamps(){calls.push('read-new');},renderSettings(){calls.push('render-settings');},refreshGroupCoordinators(){calls.push('read-groups');},renderRoomGroups(){calls.push('render-groups');},refreshRoomGroups(){calls.push('read-room-groups');},bridgeManagementUi:{refresh(){calls.push('read-bridges');}},mergedLampEntries:()=>[]};
 runInNewContext(main.slice(start,end)+'\npage("automations");',context);
 for(const page of pages)assert.equal(element('page-'+page).hidden,page!=='automations',page);
 assert.equal(nav.find(item=>item.dataset.page==='automations').current,'page');assert(nav.filter(item=>item.current).length===1);
 assert(calls.includes('navigate:automations'));assert(!calls.some(value=>/^read-|^render-(lamps|settings|groups)/.test(value)));
});
