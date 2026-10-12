// Local guide progress is display metadata. It never proves lamp ownership or
// authorizes a command; the existing verified-target adapters do that work.
export const GUIDE_STORAGE_LIMIT=32768;
const canonical=value=>typeof value==='string'&&/^[0-9a-f]{12}$/.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function ownedGuideIds(model){
 if(!Array.isArray(model?.ownedLampIds))return null;
 return [...new Set(model.ownedLampIds.filter(id=>typeof id==='string'&&id.length<=128))].slice(0,256);
}
export function confirmedGuideTarget(model,result){
 const target=model?.selected?.id;
 // The bounded first/second classification above is not an inventory ceiling.
 return Boolean(result?.connected&&model?.connected&&canonical(target)&&result.id===target&&Array.isArray(model.ownedLampIds)&&model.ownedLampIds.includes(target));
}
export class OnboardingGuide {
 constructor(preferences,save,{ownedIds,stored=false}={}){
  this.preferences=preferences;this.save=save;
  const raw=preferences.onboarding,existing=stored||ownedIds===null||Boolean(ownedIds?.length);
  this.compatible=!object(raw)||raw.version===1;
  this.state={...(object(raw)&&raw.version===1?raw:{}),version:1,
   welcomeSeen:typeof raw?.welcomeSeen==='boolean'?raw.welcomeSeen:existing,
   firstComplete:typeof raw?.firstComplete==='boolean'?raw.firstComplete:existing,
   secondGroupSeen:typeof raw?.secondGroupSeen==='boolean'?raw.secondGroupSeen:existing&&(ownedIds===null||ownedIds?.length>=2),
   laterGuides:typeof raw?.laterGuides==='boolean'?raw.laterGuides:true};
  const pending=raw?.pending;
  this.state.pending=object(pending)&&canonical(pending.target)&&['paired','details','ready'].includes(pending.stage)?{target:pending.target,stage:pending.stage,needsReview:Boolean(pending.needsReview)}:null;
 }
 commit(){if(!this.compatible)return false;this.preferences.onboarding={...this.state};try{return this.save()===true;}catch{return false;}}
 welcome(){if(!this.compatible||this.state.welcomeSeen)return false;this.state.welcomeSeen=true;this.commit();return true;}
 paired(target){if(!canonical(target))return false;this.state.pending={target,stage:'paired',needsReview:false};return this.commit();}
 details(target){if(this.state.pending?.target!==target)return false;this.state.pending={target,stage:'details',needsReview:false};return this.commit();}
 review(target){if(!canonical(target))return false;this.state.pending={target,stage:this.state.pending?.target===target?this.state.pending.stage:'paired',needsReview:true};return this.commit();}
 complete(target){if(this.state.pending?.target!==target)return false;this.state.firstComplete=true;this.state.pending=null;return this.commit();}
 second(model){
  const ids=ownedGuideIds(model);if(!this.compatible||this.state.secondGroupSeen||!this.state.firstComplete||ids?.length!==2||!ids.every(canonical))return false;
  return Boolean(model.connected&&canonical(model.selected?.id)&&ids.includes(model.selected.id)&&!(model.groups||[]).length);
 }
 offeredGroup(){this.state.secondGroupSeen=true;return this.commit();}
 setLater(value){this.state.laterGuides=Boolean(value);return this.commit();}
}
export const guideHelp=Object.freeze({
 general:'Each lamp can play on its own, or lamps can play together in a group. Choose a lamp to see its current light. Your saved hardware settings stay with that lamp.',
 center:'The effect center is where the two sides of mirrored effects meet. Fine-tuning shows a blinking white marker: turn the knob to move it and click once to save. Waiting ten seconds cancels the adjustment and keeps the previous center. This does not change the number of LEDs.',
 audio:'Sound effects respond to the room. No saved audio recordings or audio sent to the Internet. Nearby group lamps share sound levels and rhythm so they can move together. Local status and optional USB diagnostics show sound measurements. Quiet sound is not proof that a microphone is missing.',
 tuning:'Start with your usual room sound, then choose a sound effect. Sensitivity changes amplification; the noise gate keeps small background sounds dark; scale changes how sound maps to light. Use the existing sound controls and save when it feels right. Tuning is shared across this lamp’s sound effects; group followers use the main lamp’s sound.'
});
