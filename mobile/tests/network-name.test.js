import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveNetworkName,parseNetworkNameConfiguration,validNetworkHostname,validNetworkNameSource} from '../src/network-name.js';

const markup=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');

test('router names stay readable, stable, compatible and within the ESP32 limit',()=>{
  assert.equal(deriveNetworkName('Reading corner','E2EA24'),'coollamp-reading-corner-e2ea24');
  assert.equal(deriveNetworkName('My cool a$$ l@mp that will make everyone jealous!','50B9AC'),'coollamp-my-cool-a-lmp-50b9ac');
  assert.equal(deriveNetworkName("Lisa's Helix",'e93254'),'coollamp-lisas-helix-e93254');
  assert.equal(deriveNetworkName('CoolLamp-E2EA24','e2ea24'),'coollamp-e2ea24');
  assert.equal(deriveNetworkName('coollamp-Kitchen-e2ea24.local','e2ea24'),'coollamp-kitchen-e2ea24-e2ea24');
  assert.equal(deriveNetworkName('✨é北','123abc'),'coollamp-123abc');
  assert.equal(deriveNetworkName('123456789012345678901234567890','abcdef'),'coollamp-123456789012345-abcdef');
  assert.equal(deriveNetworkName('Reading corner','e2ea24').length<=31,true);
  assert.notEqual(deriveNetworkName('Reading corner','e2ea24'),deriveNetworkName('Reading corner','50b9ac'));
  assert.throws(()=>deriveNetworkName('Lamp','bad'));
});

test('Wi-Fi setup accepts only complete bounded CoolLamp local names',()=>{
  assert.equal(validNetworkHostname('coollamp-reading-corner-e2ea24.local'),true);
  for(const value of ['reading-corner-e2ea24.local','coollamp-reading_corner.local','coollamp--lamp.local','coollamp-lamp-.local','coollamp-'+('x'.repeat(25))+'.local'])
    assert.equal(validNetworkHostname(value),false,value);
});

test('custom router-name source length is enforced in UTF-8 bytes',()=>{
  assert.equal(validNetworkNameSource('é'.repeat(24)),true);
  assert.equal(validNetworkNameSource('💡'.repeat(12)),true);
  assert.equal(validNetworkNameSource('💡'.repeat(13)),false);
  assert.equal(validNetworkNameSource('line\nbreak'),false);
  assert.equal(validNetworkNameSource(''),false);
});

test('network-name readback is identity fenced and internally consistent',()=>{
  const deviceId='24eae26e9e9c',base={version:1,deviceId,displayName:'Reading corner',automatic:true,customName:'',
    active:'coollamp-e2ea24',desired:'coollamp-reading-corner-e2ea24',pending:true,revision:7};
  const parsed=parseNetworkNameConfiguration(JSON.stringify(base),deviceId);assert.equal(parsed.suffix,'e2ea24');
  assert.equal(parsed.managed,true);assert.equal(parsed.maxLength,31);
  for(const invalid of [{...base,deviceId:'aaaaaaaaaaaa'},{...base,pending:false},{...base,desired:'coollamp-wrong-e2ea24'},{...base,desired:'coollamp-reading-corner-ffffff'},{...base,revision:0}])
    assert.throws(()=>parseNetworkNameConfiguration(invalid,deviceId));
  assert.deepEqual(parseNetworkNameConfiguration({...base,revision:0,desired:base.active,pending:false},deviceId).managed,false);
});

test('router naming stays a quiet settings detail with visible work and actionable recovery',()=>{
  const formStart=markup.indexOf('<form id="identityForm"'),detailStart=markup.indexOf('<details id="networkNameDetails"'),formEnd=markup.indexOf('</form>',formStart);
  assert(formStart>=0&&detailStart>formStart&&detailStart<formEnd);
  assert.match(markup,/Name shown in your router/);
  assert.match(markup,/Use lamp name automatically/);
  assert.doesNotMatch(markup,/\bhostname\b/i);
  assert.match(app,/Checking the name shown in your router…/);
  assert.match(app,/Checking what the lamp saved…/);
  assert.match(app,/Reconnect and check the lamp’s name before pressing Save again/);
  assert.match(app,/Connect to this lamp to view or change the name shown in your router/);
  assert.match(app,/!validNetworkNameSource\(namingDraft\.source\)/);
  assert.match(app,/Use a shorter custom router name without line breaks/);
  assert.match(app,/automatic:Number\(namingDraft\.automatic\)/);
  assert.doesNotMatch(app,/networkMode:/);
  assert.match(app,/parseNetworkNameConfiguration\(await target\.request\('\/api\/name'/);
  assert.match(app,/if\(reply!=='0'&&reply!=='1'\)/);
  assert.match(app,/reply==='0'\?Object\.freeze\(\{\.\.\.networkNameConfig,active:networkNameConfig\.desired,pending:false\}\)/);
  assert.match(app,/if\(acknowledged\.pending\)connectivity\?\.invalidate\(scope\.id\)/);
  assert.match(markup,/>Update router name<\/button>/);
  assert.match(markup,/id="routerNameCaveat" class="hint" hidden/);
  assert.doesNotMatch(app,/Currently shown in your router as/);
  assert.doesNotMatch(app,/pressing Restart again|ready for the next restart/);
  assert.match(markup,/id="meshSetupName" maxlength="48"/);
  assert.match(app,/new TextEncoder\(\)\.encode\(name\)\.length>48/);
});
