const slots=(value,count)=>Array.isArray(value)&&value.length===count&&value.every(slot=>Number.isInteger(slot)&&slot>=0&&slot<=15);
export function commissionCheckSymbol(symbols){
 if(!slots(symbols,6))throw Error('Invalid commissioning symbols.');
 let crc=0;for(const symbol of symbols)for(let bit=3;bit>=0;--bit){const high=((crc>>>3)^((symbol>>>bit)&1))&1;crc=(crc<<1)&15;if(high)crc^=3;}return crc;
}
// Data-only contract. Do not execute lamp metadata, infer a comparison from an
// effect name, or accept fewer symbols when a v2 attempt has been selected.
export function parseCommissionComparison(value,expectedVersion=1){
 if(![1,2].includes(expectedVersion))throw Error('Unsupported commissioning version.');
 if(expectedVersion===1){
  if(value?.comparison&&value.comparison.version!==1)throw Error('Commissioning version changed.');
  if(!slots(value?.pattern,4))throw Error('Invalid commissioning colors.');
  return Object.freeze({version:1,entropyBits:16,symbols:Object.freeze([...value.pattern])});
 }
 const data=value?.comparison;
 if(data?.version!==2||data.entropyBits!==24||data.semanticKey!=='commission.color-counts.v2'||!slots(data.symbols,6)||data.checkSymbol!==commissionCheckSymbol(data.symbols)||
    data.cycleMs!==58000||data.pulseOnMs!==350||data.pulsePeriodMs!==700||data.countPeriodMs!==3400||data.symbolPeriodMs!==8000||data.approvalRequiresFullCycle!==true)throw Error('Invalid commissioning comparison.');
 if(value.pattern&&!slots(value.pattern,4)||value.pattern&&value.pattern.some((slot,i)=>slot!==data.symbols[i]))throw Error('Commissioning colors changed.');
 const symbols=Object.freeze([...data.symbols]),display=Object.freeze([...symbols,data.checkSymbol]);
 return Object.freeze({version:2,entropyBits:24,semanticKey:data.semanticKey,symbols,checkSymbol:data.checkSymbol,
  counts:Object.freeze(display.map(symbol=>Object.freeze([1+(symbol>>>2),1+(symbol&3)]))),cycleMs:58000,
  pulseOnMs:350,pulsePeriodMs:700,countPeriodMs:3400,symbolPeriodMs:8000,approvalRequiresFullCycle:true});
}
