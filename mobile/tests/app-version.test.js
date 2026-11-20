import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {APP_VERSION,APP_VERSION_LABEL} from '../src/app-version.js';

test('the Settings footer uses the mobile package version as its source of truth',()=>{
 const metadata=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.equal(APP_VERSION,metadata.version);
 assert.equal(APP_VERSION_LABEL,`CoolLamp ${metadata.version}`);
 assert.doesNotMatch(html,/id="v2Version">CoolLamp \d/);
});
