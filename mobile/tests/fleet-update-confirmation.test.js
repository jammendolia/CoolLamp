import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const confirmation=source.slice(source.indexOf('function cardUpdateConfirmation('),source.indexOf('\nfunction cardPhoneFirmwareAvailable('));
const updateAll=source.slice(source.indexOf('async function updateAllLamps('),source.indexOf("\n$('refreshLampFirmware')"));
const release=Object.freeze({version:'1.15.9'});

test('bulk update removes a failed confirmation dialog and starts no fleet or journal mutation',async()=>{
 const calls=[],journalWrites=[];
 const element=tag=>({tag,children:[],attributes:{},append(...children){this.children.push(...children);},setAttribute(name,value){this.attributes[name]=value;},
  addEventListener(){},remove(){calls.push('dialog-removed');},showModal(){calls.push('show-modal');throw Error('private WKWebView modal detail');}});
 const context={Error,Object,Map,document:{createElement:element,body:{append(){calls.push('dialog-appended');}}},
  fleetUpdating:false,bluetoothFirmwareTask:null,cardFirmwareTasks:new Map(),status:message=>calls.push(['status',message]),
  pauseFirmwareBackgroundWork:()=>calls.push('pause-background'),fleetRefreshQueued:true,publicFirmwareFresh:true,publicFirmware:release,
  fleetSummary:'',renderFleetControls:()=>calls.push('render-controls'),refreshPublicFirmware:async options=>{calls.push(['release-check',options.force]);return release;},
  fleetApprovedRelease:null,fleetUpdateAttempts:new Map(),fleet:{updateAll:async()=>{calls.push('fleet-update');return {results:[]};}},
  firmwareAttempts:{begin(...args){journalWrites.push(['begin',...args]);},settle(...args){journalWrites.push(['settle',...args]);},abandonUnstarted(...args){journalWrites.push(['abandon',...args]);},pending:()=>[]},
  legacyFirmwareReceipts:new Map(),cardFirmwareUnconfirmed:new Map(),renderLamps:()=>{},renderPower:()=>{},renderFirmware:()=>{},renderOptions:()=>{},renderSettings:()=>{},
  resumePendingFirmwareChecks:()=>calls.push('resume-checks')};
 runInNewContext(`${confirmation}\n${updateAll}\nglobalThis.run=updateAllLamps;`,context);
 await context.run();
 assert(calls.includes('dialog-appended'));assert(calls.includes('show-modal'));assert(calls.includes('dialog-removed'));
 assert(!calls.includes('fleet-update'));assert.deepEqual(journalWrites,[]);assert.equal(context.fleetUpdateAttempts.size,0);assert.equal(context.fleetApprovedRelease,null);
 assert.equal(context.fleetSummary,'Could not open the update choices. No updates started. Return to CoolLamp and tap Update all lamps again.');
 assert(!context.fleetSummary.includes('private WKWebView modal detail'));
});
