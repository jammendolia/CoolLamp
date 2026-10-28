import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Read the authoritative firmware registry, including IDs and capability traits.
// This is test data from the firmware, not another app-owned effect catalog.
const source=readFileSync(new URL('../../../LampEffectRegistry.h',import.meta.url),'utf8');
const rows=[...source.matchAll(/^\s*X\((\d+),\s*("(?:\\.|[^"\\])*"),\s*("(?:\\.|[^"\\])*"),\s*(\w+),\s*(\w+)\)/gm)];
const count=source.match(/\bCount=(\d+)\s*;/);
assert(count,'Read the firmware registry count.');
assert.equal(rows.length,Number(count[1]),'Read every firmware registry entry.');
export const firmwareEffectCatalog=Object.freeze(rows.map((row,index)=>{
  assert.equal(Number(row[1]),index+1,'Keep the firmware effect IDs dense and unchanged.');
  return Object.freeze({id:Number(row[1]),name:JSON.parse(row[2]),key:JSON.parse(row[3]),family:row[4],requirement:row[5]});
}));
