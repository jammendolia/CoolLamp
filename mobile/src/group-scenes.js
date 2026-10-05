export const groupScenes = [
 {id:0,name:'Mirror effects',description:'Every lamp follows the selected light effect.',audio:false},
 {id:1,name:'Portal',description:'A comet climbs one lamp and emerges from the next. Arrange lamps in travel order.',audio:false},
 {id:2,name:'Ping-pong',description:'A ball of light bounces across the group. Sound adds speed when a microphone is installed.',audio:true,optionalAudio:true},
 {id:3,name:'Stereo fountain',description:'Bass fills odd-positioned lamps; treble fills even ones. Both use the controller’s microphone—not stereo channels.',audio:true},
 {id:4,name:'Duet',description:'Detected beats take turns across the lamps. Strong accents bring everyone together.',audio:true},
 {id:5,name:'Orbit',description:'Two colored bands circulate through the lamps as one continuous loop.',audio:false},
 {id:6,name:'Storm front',description:'A flickering storm travels across the group, changing direction with each strike.',audio:false},
 {id:7,name:'Ember exchange',description:'Music feeds the flames while glowing embers launch into a neighboring lamp.',audio:true},
 {id:8,name:'Color wave',description:'A flowing blend of two colors rolls across the ordered group.',audio:false},
 {id:9,name:'Newton’s cradle',description:'A falling ball transfers its energy across the lamp bases and rises at the far end, then reverses.',audio:false,speedLabel:'Swing speed'},
 {id:10,name:'Conversation',description:'A three-note light phrase passes from lamp to lamp. Each reply adds a different color.',audio:false,speedLabel:'Conversation pace'},
 {id:11,name:'Constellation',description:'Quiet stars twinkle while a bright sequence traces a constellation across the room.',audio:false,speedLabel:'Tracing speed'},
 {id:12,name:'Tidal basin',description:'A shared volume of light rocks between the lamps. As one fills, the others drain.',audio:false,speedLabel:'Tide speed'},
 {id:13,name:'Firefly courtship',description:'Small fireflies answer flashes from neighboring lamps, then glow together.',audio:false,speedLabel:'Flash pace'},
 {id:14,name:'Rocket relay',description:'A rocket launches on one lamp and becomes a firework on the next, which launches the next rocket.',audio:false,speedLabel:'Launch pace'},
 {id:15,name:'Prism split',description:'White light separates into a fixed rainbow across the group, then returns and reunites as white.',audio:false,speedLabel:'Prism speed',fixedColors:true},
 {id:16,name:'Rhythm section',description:'Bass surges, midrange ribbons and treble sparkles take different lamps. With two lamps, the second combines mids and treble.',audio:true,speedLabel:'Ribbon & sparkle speed'},
 {id:17,name:'Beat chase',description:'Each beat passes an accent to the next lamp. Direction alternates every eight beats; strong beats add an opposite accent.',audio:true,speedLabel:'Accent speed'},
 {id:18,name:'Shared heartbeat',description:'Double pulses spread through the group, converge into one heartbeat, then drift apart.',audio:false,speedLabel:'Heartbeat pace'},
];
export function groupSceneSettings(sync,patch={}) {
 const value={scene:sync?.scene??0,speed:sync?.sceneSpeed||50,intensity:sync?.sceneIntensity??85,
  primary:sync?.scenePrimary||[70,220,255],secondary:sync?.sceneSecondary||[255,65,170],...patch};
 if(!Number.isInteger(value.scene)||value.scene<0||value.scene>18||
    !Number.isInteger(value.speed)||value.speed<1||value.speed>100||
    !Number.isInteger(value.intensity)||value.intensity<0||value.intensity>100||
    [value.primary,value.secondary].some(c=>!Array.isArray(c)||c.length!==3||c.some(v=>!Number.isInteger(v)||v<0||v>255)))throw Error('Check the group scene settings.');
 return value;
}
export function moveGroupLamp(order,id,direction) {
 if(direction!==-1&&direction!==1)throw Error('Choose an adjacent position.');
 const ids=order.map(x=>typeof x==='string'?x:x.id),index=ids.indexOf(id),next=index+direction;
 if(index<0||next<0||next>=ids.length)throw Error('Lamp cannot move further.');
 [ids[index],ids[next]]=[ids[next],ids[index]];return ids;
}

export function availableGroupScenes(sync) {
 const count=Number.isInteger(sync?.sceneCount)?Math.max(0,Math.min(18,sync.sceneCount)):8;
 return groupScenes.filter(scene=>scene.id<=count);
}
