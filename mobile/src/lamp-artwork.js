// Editable vector silhouettes traced from the lamp references, without photo assets.
// Artwork names are presentation variants, not firmware style codes or capabilities.
const variants=new Set(['helix','large-helix','corkscrew','edison','sonata','knot']);
const labels={helix:'Helix lamp','large-helix':'Large helix lamp',corkscrew:'Corkscrew lamp',edison:'Edison lamp',sonata:'Sonata lamp',knot:'Knot lamp prototype',unspecified:'Lamp'};
let sequence=0;
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
export const LAMP_ARTWORK_DARK_PALETTE=Object.freeze({frame:'#93a196',baseStart:'#849187',baseMiddle:'#9daa9f',baseEnd:'#7f8d81',baseTop:'#abb6a9',baseBottom:'#859287'});

function blackBase(id,tones,wide=false){
 const radius=wide?31:29;
 return `<g class="lamp-artwork-base" data-base="dark"><ellipse cx="60" cy="195" rx="35" ry="3" fill="${wide?'#252b291a':'#252b2920'}"/>
 <rect class="lamp-artwork-base-side" x="${60-radius}" y="180" width="${radius*2}" height="13" rx="${wide?4:3}" fill="url(#${id}-base)"/>
 <ellipse class="lamp-artwork-base-bottom" cx="60" cy="193" rx="${radius}" ry="4" fill="${tones?.baseBottom||'#1b1d20'}"/>
 <ellipse class="lamp-artwork-base-top" cx="60" cy="180" rx="${radius}" ry="${wide?6:5}" fill="${tones?.baseTop||'#363b40'}"/></g>`;
}
const ribbon=(path,id,width=8)=>`<path class="lamp-artwork-ribbon" d="${path}" stroke="url(#${id}-light)" stroke-width="${width}"/><path d="${path}" stroke="#ffffff" stroke-opacity=".48" stroke-width="1.3"/>`;

function helix(id,tones){
 // Three open loops. The two diagonal front ribbons cross the dark rear ribbon.
 const frame='M60 177 C98 177 104 150 77 131 L43 111 C16 95 23 80 60 64 C97 47 103 19 65 13 C31 8 18 34 38 53 C52 67 77 81 88 91 C106 108 79 121 59 131 C32 146 18 169 43 176 Q51 179 60 177';
 return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
 <path class="lamp-artwork-frame" d="${frame}" stroke="${tones?.frame||'#282d31'}" stroke-width="9.5"/>
 <path d="M29 37 C20 17 45 8 65 13 C88 16 100 35 82 52" stroke="#a8c8df" stroke-width="3.3"/>
 ${ribbon('M28 40 C31 56 58 71 79 85 C102 99 99 112 64 128',id,8.5)}
 ${ribbon('M25 95 C23 106 45 117 72 131 C102 149 99 175 60 177',id,8.5)}
 <path d="M60 177 C45 181 31 176 27 164" stroke="#b9d9ed" stroke-width="3.5"/>
 </g>${blackBase(id,tones)}`;
}
function largeHelix(id,tones){
 // The broad crossing arms between the two loops distinguish the larger design.
 const frame='M60 177 C24 178 21 153 37 129 C52 106 76 99 102 100 C80 90 45 82 30 53 C17 27 35 10 61 12 C91 10 105 36 89 61 C72 87 42 101 16 98 C43 97 76 112 91 139 C109 169 91 179 60 177';
 return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
 <path class="lamp-artwork-frame" d="${frame}" stroke="${tones?.frame||'#252a2e'}" stroke-width="9.5"/>
 <path d="M30 47 C21 20 41 9 61 12 C78 11 91 22 94 36" stroke="#a4c5e4" stroke-width="3.5"/>
 ${ribbon('M16 98 C38 103 74 84 89 58 C104 32 88 12 61 12',id,8.8)}
 ${ribbon('M102 100 C80 88 42 117 31 143 C19 167 37 179 60 177',id,8.8)}
 </g>${blackBase(id,tones)}`;
}
function corkscrew(id,tones){
 // A separate straight support on the right carries the free hanging spiral.
 const support='M88 179 C89 151 92 104 92 63 C95 31 79 15 54 13 C36 10 24 15 25 23';
 const coil='M25 23 C47 15 75 24 79 41 C69 54 36 59 25 52 C17 47 23 41 39 40 C70 37 86 52 79 68 C72 85 37 88 27 81 C18 75 25 69 42 67 C68 65 85 81 77 97 C69 113 39 120 27 113 C18 108 26 101 42 101 C67 100 80 115 74 132 C66 146 50 151 42 153';
 return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
 <path class="lamp-artwork-support" d="${support}" stroke="url(#${id}-base)" stroke-width="8"/>
 <g transform="translate(1.2 0)">${ribbon(support,id,4.2)}</g>
 <path class="lamp-artwork-coil-back" d="${coil}" stroke="url(#${id}-base)" stroke-width="8.5"/>
 ${ribbon('M25 23 C47 15 75 24 79 41 C69 54 36 59 25 52',id,8.3)}
 ${ribbon('M79 68 C72 85 37 88 27 81',id,8.3)}
 ${ribbon('M77 97 C69 113 39 120 27 113',id,8.3)}
 ${ribbon('M74 132 C66 146 50 151 42 153',id,8.3)}
 <circle cx="42" cy="153" r="4.2" fill="#e7eddf" stroke="#c6d6cc" stroke-width=".6"/>
 </g>${blackBase(id,tones,true)}`;
}
function knot(id,tones){
 // An asymmetric outer oval wraps a small standing loop and a diagonal front ribbon.
 const frame='M60 178 C24 178 21 157 33 139 L71 91 C82 73 80 58 68 60 C54 65 42 105 53 122 C70 145 98 99 101 68 C107 36 88 13 65 12 C32 9 18 27 22 53 C29 78 61 90 78 116 C103 153 93 178 60 178';
 return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
 <path class="lamp-artwork-frame" d="${frame}" stroke="${tones?.frame||'#262c30'}" stroke-width="10"/>
 <path d="M65 12 C94 12 109 42 101 68 C94 97 70 140 53 122" stroke="#c9d6df" stroke-width="6.3"/>
 <path d="M60 178 C99 182 99 152 85 128" stroke="#9eacb5" stroke-width="3"/>
 ${ribbon('M32 155 C25 139 50 115 64 95 C81 72 87 48 68 60',id,9)}
 </g>${blackBase(id,tones)}`;
}
function edison(id,tones){
 // A broad round bulb-shaped loop above two smaller screw-like coils. The
 // separate straight support is dark; geometry here is artwork, not LED order.
 const support='M60 177V104';
 const bulb='M60 109 C60 98 43 99 30 89 C5 74 0 42 18 20 C35 -1 68 -2 91 17 C119 40 115 75 89 94 C80 101 70 104 60 104';
 const coil='M43 99 C27 96 28 103 48 108 C64 111 84 114 85 120 C85 128 56 131 39 127 C22 124 28 119 45 120 C63 120 85 127 85 133 C85 141 63 145 47 145';
 return `<g fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 3)">
 <path class="lamp-artwork-frame lamp-artwork-support" d="${support}" stroke="${tones?.frame||'#282d31'}" stroke-width="5"/>
 <g class="lamp-artwork-edison-bulb-group" transform="translate(0 -23.92) scale(1 1.23)">
 <path class="lamp-artwork-frame lamp-artwork-edison-bulb" d="${bulb}" stroke="${tones?.frame||'#282d31'}" stroke-width="9"/>
 ${ribbon('M60 104 C80 104 100 87 107 66 C118 36 91 8 65 6 C43 3 23 14 15 34',id,3.8)}
 </g><g class="lamp-artwork-edison-threads" transform="translate(0 8)">
 <path class="lamp-artwork-frame lamp-artwork-coil-back" d="${coil}" stroke="${tones?.frame||'#282d31'}" stroke-width="8"/>
 ${ribbon('M43 99 C27 96 28 103 48 108 C64 111 84 114 85 120',id,7.5)}
 ${ribbon('M39 127 C22 124 28 119 45 120 C63 120 85 127 85 133',id,7.5)}
 </g></g>${blackBase(id,tones)}`;
}
function sonata(id,tones){
 // One open S-shaped ribbon, with inward-curling free tips and no crossing.
 // The rectangular base and knob follow the reference; this is not LED order.
 const curve='M58 39 C57 56 74 65 88 53 C108 35 94 11 75 10 C45 6 25 31 24 58 C23 84 46 94 64 108 C83 124 101 141 88 164 C78 183 49 184 33 169 C19 154 28 130 45 127 C63 123 79 140 70 153 L63 163';
 return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
 <path class="lamp-artwork-frame lamp-artwork-sonata-curve" d="${curve}" stroke="${tones?.frame||'#282d31'}" stroke-width="10"/>
 ${ribbon(curve,id,4.7)}
 <path class="lamp-artwork-sonata-tip" d="M58 37L58 41M62 164L65 161" stroke="#c9d3d6" stroke-width="6"/>
 </g><g class="lamp-artwork-base" data-base="dark"><ellipse cx="60" cy="196" rx="43" ry="3" fill="#252b291a"/>
 <rect class="lamp-artwork-base-side" x="19" y="181" width="82" height="14" rx="2.5" fill="url(#${id}-base)"/>
 <path class="lamp-artwork-base-top" d="M22 181H98" stroke="${tones?.baseTop||'#454b50'}" stroke-width="2"/>
 <rect x="89" y="175" width="3" height="6" fill="${tones?.frame||'#878c8f'}"/>
 <rect class="lamp-artwork-sonata-knob" x="87" y="169" width="7" height="8" rx="1.6" fill="${tones?.baseEnd||'#22272a'}"/></g>`;
}
function generic(id,tones){
 return `<g fill="none" stroke-linecap="round"><path class="lamp-artwork-frame lamp-artwork-generic-frame" d="M60 177V45" stroke="${tones?.frame||'#6f7975'}" stroke-width="5"/><path d="M37 44C37 12 83 12 83 44" stroke="#c3ccc4" stroke-width="6"/><path d="M37 44h46" stroke="url(#${id}-light)" stroke-width="6"/></g>${blackBase(id,tones)}`;
}

/** Returns standalone SVG. A unique prefix prevents gradients colliding between cards. */
export function lampArtworkSvg(style='helix',{className='lamp-artwork',label,idPrefix,lit=true,theme='light',updateProgress,updateSource,decorative=false}={}){
 const variant=variants.has(style)?style:'unspecified';
 const id=typeof idPrefix==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(idPrefix)?idPrefix:'coollamp-art-'+(++sequence);
 const colors=lit?['#c7dff4','#edd6f7','#bce9df']:['#ced5d8','#e9ece9','#c6d2cb'];
 const tones=theme==='dark'?LAMP_ARTWORK_DARK_PALETTE:null;
 const body=({helix,'large-helix':largeHelix,corkscrew,edison,sonata,knot,unspecified:generic})[variant](id,tones);
 // This is receiver-written progress supplied by the update presentation, not
 // phone download progress. Unknown values retain the ordinary neutral drawing.
 const updating=Number.isInteger(updateProgress)&&updateProgress>=0&&updateProgress<=100;
 const source=updating&&['bluetooth','internet','donation','manual-upload'].includes(updateSource)?updateSource:null;
 // Edison's taller illustration has real headroom above the legacy canvas.
 // Existing model SVG output remains byte-identical; progress covers its
 // complete new body, including that headroom, at one hundred percent.
 const progressSpan=variant==='edison'?210:180;
 const height=updating?progressSpan*updateProgress/100:0;
 const updateClip=updating?`\n <clipPath id="${id}-update-clip" clipPathUnits="userSpaceOnUse"><rect x="0" y="${180-height}" width="120" height="${height}"/></clipPath>`:'';
 // Every trusted drawing ends with its separate base. Its physical light body
 // fills upwards, while the base retains exactly the original artwork/colors.
 const baseStart=body.indexOf('<g class="lamp-artwork-base"');
 const updateBody=updating?`<g class="lamp-artwork-update-fill" clip-path="url(#${id}-update-clip)">${body.slice(0,baseStart)}</g>`:'';
 const rest=updating?`<g class="lamp-artwork-update-rest">${body.slice(0,baseStart)}</g>${body.slice(baseStart)}`:body;
 const semantics=decorative?'aria-hidden="true"':`role="img" aria-label="${escape(label||labels[variant])}"`;
 return `<svg xmlns="http://www.w3.org/2000/svg" class="${escape(className)}" data-lamp-artwork="${variant}"${updating?` data-update-progress="${updateProgress}"`:''}${source?` data-update-source="${source}"`:''} viewBox="${variant==='edison'?'0 -30 120 230':'0 0 120 200'}"${variant==='edison'?' preserveAspectRatio="xMidYMax meet"':''} ${semantics} focusable="false">
 <defs>
 <linearGradient id="${id}-light" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="${colors[0]}"/><stop offset=".5" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/></linearGradient>
 <linearGradient id="${id}-base" x1="0" y1="0" x2="1" y2="0"><stop class="lamp-artwork-base-start" stop-color="${tones?.baseStart||'#161a1c'}"/><stop class="lamp-artwork-base-middle" offset=".52" stop-color="${tones?.baseMiddle||'#383d41'}"/><stop class="lamp-artwork-base-end" offset="1" stop-color="${tones?.baseEnd||'#171b1e'}"/></linearGradient>
 ${updateClip}</defs>${rest}${updateBody}</svg>`;
}
