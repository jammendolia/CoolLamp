// Use catalog names, not wire IDs: another lamp can advertise a different order.
const profiles = new Map();
function family(names, settings) { for (const name of names) profiles.set(name, settings); }
family(['White','Red','Green','Blue','Purple','Pink','Yellow','Cyan','Custom solid'], {
  description:'A steady wash of light. Make the color your own.', motion:false, intensity:false, colorLabel:'Light color'
});
family(['Fire','Split fire - rising','Split fire - falling','Split fire - rising, reversed colors','Blue gas fire','Witch fire','Purple fire'], {
  description:'Living flame, shaped around your lamp.', speedLabel:'Flame speed', speedHint:'From slow-burning embers to a lively flame.'
});
family(['Pacifica','Aurora','Embers','Lava','Plasma','Lava blobs'], {
  description:'Soft layers of color, always in motion.', speedLabel:'Flow speed', speedHint:'Slow down for a quieter atmosphere.'
});
family(['Rain'], {description:'Light falls from the center toward both ends.',speedLabel:'Fall speed'});
family(['Comet collision'], {description:'Two comets meet at your lamp’s center.',speedLabel:'Travel speed'});
family(['Bouncing droplets - rising','Bouncing droplets - falling'], {
  description:'Playful droplets travel and bounce along both sides.',speedLabel:'Travel speed',intensityLabel:'Density & glow',intensityHint:'Adds more droplets and increases their brightness.'
});
family(['Lightning storm'], {description:'A soft-edged storm with occasional flashes.',speedLabel:'Storm speed',intensityLabel:'Activity & glow',intensityHint:'Higher values bring brighter, more frequent strikes.'});
family(['Fireflies'], {description:'Small pools of light drift and shimmer.',speedLabel:'Drift speed',intensityLabel:'Density & glow',intensityHint:'Adds more fireflies and increases their brightness.'});
family(['Shooting stars'], {description:'Bright trails sweep across your lamp.',speedLabel:'Travel speed',intensityLabel:'Activity & glow',intensityHint:'Adds more shooting stars and increases their brightness.'});
family(['Color tide'], {description:'Two colors wash in from opposite ends.',speedLabel:'Tide speed'});
family(['Heartbeat','Breathing glow'], {description:'A gentle rhythm for a quieter space.',speedLabel:'Rhythm speed'});
family(['Sound glow'], {description:'The whole lamp glows with the volume around it.',speedLabel:'Response speed',speedHint:'Higher values fade faster between sounds.',colorLabel:'Glow color'});
family(['Sound meter'], {description:'Sound climbs from both ends toward the center.',speedLabel:'Response speed',speedHint:'Higher values make the meter fall faster.',colorLabel:'Base color',secondaryLabel:'Top color'});
family(['Spectrum Rise'], {description:'Volume becomes height. Frequency becomes color.',spectrum:true,speedLabel:'Response speed',speedHint:'Higher values make the column and peak marker fall faster.'});
family(['Bass Launch'], {description:'Bass hits launch color toward the center.',spectrum:true,speedLabel:'Pulse speed',speedHint:'Higher values send pulses to the top more quickly.'});
family(['Spectral Embers'], {description:'Warm bass flames meet cool treble sparks.',spectrum:true,speedLabel:'Response speed',speedHint:'Adjusts how quickly the flame follows falling sound levels.'});
family(['Beat Bloom'], {description:'Each attack blooms at the center and ripples outward.',spectrum:true,speedLabel:'Ripple speed',speedHint:'Higher values move ripples toward the ends more quickly.'});
family(['Three-band Fountain'], {description:'Bass, mids and treble rise in three layers of color.',spectrum:true,speedLabel:'Response speed',speedHint:'Higher values make the layers fall faster.'});
export function effectSettings(entry) {
  const known=profiles.get(entry?.name)||{};
  const audio=entry?.category==='audio';
  return {
    description:audio?'Light that follows the sound around you.':'Shape the color and movement of your light.',
    motion:entry?.speed!==false,intensity:true,speedLabel:audio?'Response speed':'Motion speed',
    speedHint:audio?'Adjust how quickly the light follows changes in sound.':'Set the pace of the animation.',
    intensityLabel:'Effect glow',intensityHint:'Brightness for this effect. Your lamp brightness is shared.',
    colorLabel:'Primary color',secondaryLabel:'Secondary color',spectrum:false,
    ...known, audio, motion:entry?.speed!==false && known.motion!==false,
  };
}
