import test from 'node:test';
import assert from 'node:assert/strict';
import {commissionCheckSymbol,parseCommissionComparison} from '../src/commissioning.js';

const comparison=()=>{const symbols=[0,1,4,7,12,15];return {version:2,entropyBits:24,semanticKey:'commission.color-counts.v2',symbols,
 checkSymbol:commissionCheckSymbol(symbols),cycleMs:58000,pulseOnMs:350,pulsePeriodMs:700,countPeriodMs:3400,symbolPeriodMs:8000,approvalRequiresFullCycle:true};};
test('comparison v2 retains all 24 bits and redundant accessible counts, independent of color names',()=>{
 const value=comparison(),parsed=parseCommissionComparison({pattern:value.symbols.slice(0,4),comparison:value},2);
 assert.deepEqual(parsed.counts.slice(0,6),[[1,1],[1,2],[2,1],[2,4],[4,1],[4,4]]);
 assert.equal(parsed.entropyBits,24);assert.equal(parsed.counts.length,7);assert(Object.isFrozen(parsed)&&Object.isFrozen(parsed.counts[0]));
 value.symbols[0]=15;assert.equal(parsed.symbols[0],0);
});
test('unknown version, wrong timings, bad checksum, changed colors and truncated SAS fail closed',()=>{
 for(const patch of [{version:3},{entropyBits:16},{semanticKey:'executable'},{symbols:[1,2,3,4]},{symbols:[0,1,4,7,12,16]},
  {checkSymbol:16},{cycleMs:59000},{pulseOnMs:100},{pulsePeriodMs:100},{countPeriodMs:1},{symbolPeriodMs:1},{approvalRequiresFullCycle:false}])
  assert.throws(()=>parseCommissionComparison({comparison:{...comparison(),...patch}},2));
 const value=comparison();assert.throws(()=>parseCommissionComparison({pattern:[15,1,4,7],comparison:value},2));
 assert.throws(()=>parseCommissionComparison({pattern:[0,1,4,7]},2));
 assert.throws(()=>parseCommissionComparison({pattern:[0,1,4,7],comparison:value},1));
});
test('all 16 pulse count symbols round-trip and CRC4 detects every one-bit transcript error',()=>{
 const symbols=[0,1,4,7,12,15],check=commissionCheckSymbol(symbols);
 for(let i=0;i<6;++i)for(let bit=0;bit<4;++bit){const changed=[...symbols];changed[i]^=1<<bit;assert.notEqual(commissionCheckSymbol(changed),check);}
 for(let symbol=0;symbol<16;++symbol){const value=comparison();value.symbols.fill(symbol);value.checkSymbol=commissionCheckSymbol(value.symbols);
  const [first,second]=parseCommissionComparison({comparison:value},2).counts[0];assert.equal((first-1)*4+second-1,symbol);}
});
test('legacy comparison remains usable without new metadata',()=>{
 assert.deepEqual(parseCommissionComparison({pattern:[1,4,7,12]}),{version:1,entropyBits:16,symbols:[1,4,7,12]});
 assert.throws(()=>parseCommissionComparison({pattern:[1,4,7,12,13]}));
});
