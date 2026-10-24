// A negotiated projection retains configuration and catalog order while marking
// unrequested appearance slots explicitly absent. Never invent those values.
export function validCurrentStateView(raw){
 const colors=raw?.colors,options=raw?.effectOptions;
 if(raw?.stateView!==1||!Array.isArray(raw.effects)||!Array.isArray(colors)||!Array.isArray(options)||colors.length!==options.length||colors.length<raw.effects.length||colors.length>255)return false;
 const color=colors[raw.mode-1],tuning=options[raw.mode-1];
 const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
 if(!Array.isArray(color)||color.length!==4||!integer(color[0],0,1)||!color.slice(1).every(value=>integer(value,0,255))||
   !Array.isArray(tuning)||tuning.length!==6||!integer(tuning[0],1,100)||!integer(tuning[1],0,100)||!integer(tuning[2],0,1)||!tuning.slice(3).every(value=>integer(value,0,255)))return false;
 return colors.every((value,index)=>index===raw.mode-1||value===null)&&options.every((value,index)=>index===raw.mode-1||value===null);
}
