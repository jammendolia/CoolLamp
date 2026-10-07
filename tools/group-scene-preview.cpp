// Offline developer preview. Compile from the repository root:
// g++ -std=c++17 -O2 -Wall -Wextra -pedantic tools/group-scene-preview.cpp -o .build/room-effects-preview-generator
// Run: .build/room-effects-preview-generator .build/room-effects-preview.html
// Windows: append .exe to the generator filename. This never connects to a lamp.
#include "../LampGroupScenes.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr unsigned Frames = 180, Fps = 15, Leds = 64, FirstScene = 19;
constexpr uint32_t GroupStart = 1000;
constexpr std::array<unsigned, 4> Counts{{2, 3, 5, 9}};
constexpr std::array<const char*, 14> Names{{
    "Bass cathedral", "Spectrum loom", "Resonant rings", "Velvet thunder",
    "Prism chorus", "Twin vortex", "Electric bloom", "Room groove",
    "Chromatic screw", "Mercury ribbon", "Bass turbine", "Prism torque",
    "Echo coils", "Aurora braid"
}};
constexpr double Tau = 6.2831853071795864769;

uint8_t feature(double x) { return uint8_t(std::clamp(x, 0.0, 255.0)); }

// Representative shared features only, not a microphone/FFT simulation.
// Every lamp receives the same features and beat timestamp, as in a group frame.
LampSyncWire::Visual input(unsigned id, unsigned count, bool music, unsigned frame) {
    LampSyncWire::Visual v{};
    v.scene = id; v.count = count; v.sceneSpeed = 60; v.sceneIntensity = 85;
    v.groupStart = GroupStart;
    v.scenePrimary[0] = 70; v.scenePrimary[1] = 220; v.scenePrimary[2] = 255;
    v.sceneSecondary[0] = 255; v.sceneSecondary[1] = 65; v.sceneSecondary[2] = 170;
    v.mode = 46; v.brightness = 55; v.power = 1; v.speed = 60; v.intensity = 85;
    v.audioValid = 1;
    const uint32_t elapsed = uint64_t(frame) * 1000 / Fps;
    v.groupMotionAt = GroupStart;
    v.groupMotion = elapsed;
    if (!music) return v;
    const double seconds = elapsed / 1000.0;
    const uint32_t age = elapsed % 500;
    const double pulse = std::exp(-double(age) / 145.0);
    const double phrase = 0.5 + 0.5 * std::sin(seconds * Tau / 6.0);
    v.level = feature(48.0 + pulse * 155.0 + phrase * 30.0);
    v.bass = uint16_t(feature(22.0 + pulse * 205.0)) * 257;
    v.mid = uint16_t(feature(42.0 + (0.5 + 0.5 * std::sin(seconds * Tau / 2.4)) * 140.0)) * 257;
    v.treble = uint16_t(feature(18.0 + (0.5 + 0.5 * std::sin(seconds * Tau * 3.0)) * (45.0 + phrase * 105.0))) * 257;
    v.groupBeat = elapsed / 500 + 1;
    v.groupBeatAt = GroupStart + elapsed - age;
    v.groupBeatLevel = v.groupBeat % 4 == 1 ? 245 : 185;
    return v;
}

void base64(std::ostream& out, const std::vector<uint8_t>& bytes) {
    constexpr char Alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (size_t i = 0; i < bytes.size(); i += 3) {
        const uint32_t n = uint32_t(bytes[i]) << 16 |
            (i + 1 < bytes.size() ? uint32_t(bytes[i + 1]) << 8 : 0) |
            (i + 2 < bytes.size() ? bytes[i + 2] : 0);
        out << Alphabet[n >> 18] << Alphabet[n >> 12 & 63]
            << (i + 1 < bytes.size() ? Alphabet[n >> 6 & 63] : '=')
            << (i + 2 < bytes.size() ? Alphabet[n & 63] : '=');
    }
}

const char* HtmlHead = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'">
<title>CoolLamp · Room effects preview</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#10151b;color:#e8eff6}
*{box-sizing:border-box}body{margin:0}main{max-width:1260px;margin:auto;padding:30px 34px 26px}
.eyebrow{color:#96a8bc;font-size:12px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:12px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}h1{font-size:clamp(25px,3.5vw,42px);font-weight:600;letter-spacing:-.04em;margin:0 0 8px}
header p{margin:0;color:#a1afbf;font-size:14px}.tag{font-size:12px;border:1px solid #354451;border-radius:30px;padding:8px 13px;color:#9ddce4;white-space:nowrap}
.controls{display:flex;gap:14px;align-items:flex-end;margin-top:25px;flex-wrap:wrap}.field{display:grid;gap:8px}.field.effect{flex:1;min-width:190px}.field label{font-size:11px;color:#9fafbf;text-transform:uppercase;letter-spacing:.12em}
select,button{font:inherit;color:#e8eff6;background:#1b2630;border:1px solid #3a4b5b;border-radius:9px;padding:11px 13px;font-size:14px;min-height:42px}
select{cursor:pointer}button{cursor:pointer}button:hover{border-color:#75bec8}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #82d2dd;outline-offset:3px}
button#play{background:#c5e8e6;color:#142527;border-color:#c5e8e6;min-width:98px;font-weight:600}
.room{position:relative;margin-top:20px;border:1px solid #2b3945;border-radius:16px;overflow:hidden;background:radial-gradient(ellipse at 50% 70%,#1b2229 0,#111820 74%)}
.room-top{position:absolute;top:18px;left:22px;right:22px;display:flex;align-items:center;justify-content:space-between;gap:12px;pointer-events:none}.room-title{font-size:12px;color:#9cabbc}.live{font-size:11px;letter-spacing:.06em;color:#a4cfcf}
canvas{display:block;width:100%;height:560px}.legend{position:absolute;bottom:17px;left:22px;right:22px;color:#9cabbc;font-size:11px;line-height:1.4}
.scene-description{margin:14px 2px 0;max-width:920px;color:#acbdcc;font-size:13px;line-height:1.55}.scene-description strong{color:#c5e8e6;font-weight:600}
.player{display:flex;gap:18px;align-items:center;padding:15px 4px 4px}.time{font-variant-numeric:tabular-nums;font-size:12px;color:#b5c4d5;min-width:85px}input[type=range]{width:100%;accent-color:#8ad1d9;cursor:pointer}
.details{display:grid;grid-template-columns:1.1fr 1fr;gap:28px;margin-top:21px}.signal{background:#171f27;border:1px solid #2a3947;border-radius:12px;padding:17px 20px}.signal-title{font-size:12px;color:#b9c8d8;margin-bottom:15px;display:flex;justify-content:space-between;gap:10px}
.bars{display:flex;gap:16px}.band{flex:1}.band label{display:block;color:#93a5b8;font-size:11px;margin-bottom:8px}.track{height:5px;border-radius:9px;background:#293642;overflow:hidden}.track i{display:block;height:100%;width:0;background:#70cad4;transition:width .035s linear}.band:nth-child(3) i{background:#d887c1}
.note{font-size:12px;color:#97a8ba;line-height:1.6;margin:0;padding:2px 0}.note strong{font-weight:500;color:#c3d3e3}.readout{font-size:12px;color:#c4dddd;line-height:1.5;margin-top:13px}
footer{display:flex;justify-content:space-between;gap:16px;margin-top:23px;border-top:1px solid #2a3642;padding-top:16px;font-size:11px;color:#7f92a6;line-height:1.6}
@media(max-width:720px){main{padding:22px 16px}.tag{display:none}.controls{gap:10px}.field.effect{flex-basis:100%}.field{flex:1 1 140px;min-width:0}select{width:100%}#play{flex-basis:100%}canvas{height:490px}.details{grid-template-columns:1fr;gap:16px}footer{flex-direction:column;gap:4px}.room-top{left:15px;right:15px}.legend{left:15px}.live{font-size:10px}}
</style></head><body><main>
<div class="eyebrow">CoolLamp / Group studio</div>
<header><div><h1>Light shaped by motion.</h1><p>Six new scenes for corkscrews, helices and a room full of both.</p></div><div class="tag">Offline developer preview</div></header>
<div class="controls">
<div class="field effect"><label for="effect">Room effect</label><select id="effect"></select></div>
<div class="field"><label for="count">Lamps</label><select id="count"><option value="2">2 lamps</option><option value="3" selected>3 lamps</option><option value="5">5 lamps</option><option value="9">9 lamps</option></select></div>
<div class="field"><label for="geometry">Design</label><select id="geometry"><option value="corkscrew">Corkscrew</option><option value="helix">Helix</option><option value="mixed">Mixed room</option></select></div>
<div class="field"><label for="audio">Shared input</label><select id="audio"><option value="1">Simulated audio</option><option value="0">Silence</option></select></div>
<button id="play" type="button" aria-label="Pause playback">Pause</button></div>
<p class="scene-description"><strong id="kind"></strong> <span id="description"></span></p>
<section class="room" aria-label="Room layout with all lamps visible"><div class="room-top"><span class="room-title" id="title"></span><span class="live" id="live">SIMULATED AUDIO · 120 BPM</span></div>
<canvas id="room" role="img" aria-label="Exact firmware RGB samples on distributed lamps"></canvas><div class="legend" id="geometry-note">Illustrative corkscrew · rising spine + descending spiral · folded strip mapping</div></section>
<div class="player"><div class="time" id="time">0.0 / 12.0 s</div><input id="seek" aria-label="Playback position" type="range" min="0" step="1" value="0"></div>
<div class="details"><section class="signal"><div class="signal-title"><span>Shared audio features</span><span id="beat">Beat 1</span></div><div class="bars">
<div class="band"><label>Level</label><div class="track"><i id="level"></i></div></div><div class="band"><label>Bass</label><div class="track"><i id="bass"></i></div></div><div class="band"><label>Mids</label><div class="track"><i id="mid"></i></div></div><div class="band"><label>Treble</label><div class="track"><i id="treble"></i></div></div>
</div><div class="readout" id="coverage" aria-live="off"></div></section>
<p class="note"><strong>Exact renderer; illustrative geometry.</strong> Every displayed RGB sample is generated by <code>LampGroupScenes::pixel</code>, using the existing folded-strip height mapping. Speed 60, intensity 85, cyan / magenta palette. Simulated audio supplies synthetic bass, mids, treble and shared beats; silence keeps audio features at zero. Ambient scenes ignore this input. All six new scenes keep a visible field on every lamp. Playback loops for comparison.<br><br><strong>Mapping assumption:</strong> one strip leg rises from base to top and the second returns to the base, with the real lamp's configured midpoint marking the turn. The corkscrew illustration has a straight spine and a 3.5-turn spiral; the helix has two winding legs. Exact strip lengths, turn count, orientation, diffuser optics, global brightness, power limiting, network timing and hardware are not simulated.</p></div>
<footer><span>No network requests · no microphone access · no hardware control</span><span>Generated from C++ firmware · 64 samples / lamp · 15 frames / second</span></footer>
</main><script type="application/octet-stream" id="frame-data">)HTML";

const char* HtmlTail = R"HTML(
const bytes = Uint8Array.from(atob(document.getElementById('frame-data').textContent.trim()), c => c.charCodeAt(0));
const $ = id => document.getElementById(id);
const canvas = $('room'), ctx = canvas.getContext('2d');
const effect = $('effect'), count = $('count'), audio = $('audio'), geometry = $('geometry'), play = $('play'), seek = $('seek');
const newGroup=document.createElement('optgroup'), earlierGroup=document.createElement('optgroup');
newGroup.label='New · corkscrew collection';earlierGroup.label='Earlier · room audio';
names.forEach((name,i)=>(i>=8?newGroup:earlierGroup).append(new Option(name+(i===8||i===9?' · ambient':' · audio'),String(i))));
effect.append(newGroup,earlierGroup);effect.value='8';
const descriptions=[
  'Bass lifts tall columns together, with staggered ridges around the room.',
  'Three broad spectral ribbons interleave on every lamp.',
  'Shared onsets send expanding rings through local phases.',
  'Broad bass pressure supports fine treble shimmer.',
  'Every lamp sustains a complementary palette harmony.',
  'Counter-moving ribbons twist above a steady color field.',
  'Each lamp opens a bloom on shared beats.',
  'Complementary bass, mid and treble roles share a rhythmic bed.',
  'Continuous color bands wind through the spiral; neighboring lamps hold different phases of the same motion.',
  'Wide reflective-looking ribbons slide through a colored field, making each curve read as a flowing surface.',
  'Bass adds rotating pressure ridges while every lamp keeps an illuminated core.',
  'Shared beats reverse twist accents while mids and treble animate complementary color bands.',
  'A shared pulse opens repeated coil accents on every lamp, with broad echoes above the ambient field.',
  'Interlaced color ribbons respond to the whole spectrum, keeping the room filled between beats.'
];
seek.max = frames - 1;
let frame = 0, playing = true, anchor = performance.now(), previousFrame = -1, redraw = true;
// A callback timestamp can precede an anchor set later in the same browser frame.
// Keep the frame index valid so drawing cannot stop the animation loop.
function playbackFrame(now) { return Math.floor(Math.max(0, now-anchor)*fps/1000)%frames; }
function paint() { draw(); previousFrame = frame; redraw = false; }
function select() { frame = 0; previousFrame = -1; seek.value = 0; anchor = performance.now(); paint(); }
[effect,count,audio,geometry].forEach(control => control.addEventListener('change', select));
play.addEventListener('click', () => { const now = performance.now(); if (playing) frame = playbackFrame(now); playing = !playing; anchor = now - frame * 1000 / fps; play.textContent = playing ? 'Pause' : 'Play'; play.setAttribute('aria-label', playing ? 'Pause playback' : 'Play playback'); paint(); });
seek.addEventListener('input', () => { frame = Number(seek.value); anchor = performance.now() - frame * 1000 / fps; paint(); });
function resize() { const box = canvas.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(box.width * ratio); canvas.height = Math.round(box.height * ratio); ctx.setTransform(ratio,0,0,ratio,0,0); paint(); }
addEventListener('resize',resize); resize();
function roundRect(x,y,w,h,r) { ctx.beginPath(); ctx.roundRect(x,y,w,h,r); }
function ellipse(x,y,rx,ry) { ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); }
function color(r,g,b,a=1) { return `rgba(${r},${g},${b},${a})`; }
function arrangement(n, w, h) {
  if(n===9&&w<600) return [[.2,.39],[.5,.35],[.8,.39],[.8,.59],[.8,.85],[.5,.88],[.2,.85],[.2,.59],[.5,.59]].map(([x,y])=>[x*w,y*h]);
  if(n===2) return [[.25,.68],[.75,.68]].map(([x,y])=>[x*w,y*h]);
  if(n===3) return [[.19,.51],[.80,.52],[.5,.85]].map(([x,y])=>[x*w,y*h]);
  if(n===5) return [[.2,.50],[.73,.43],[.85,.83],[.48,.88],[.13,.79]].map(([x,y])=>[x*w,y*h]);
  return Array.from({length:n},(_,i)=>{const angle=-Math.PI/2+i*2*Math.PI/n;return [w*(.5+.365*Math.cos(angle)),h*(.66+.22*Math.sin(angle))];});
}
function designForLamp(lamp){return geometry.value==='mixed'?(lamp%2?'helix':'corkscrew'):geometry.value;}
// Shape affects only where the renderer's stored RGB samples are drawn.
// No effect colors or audio-dependent motion are synthesized by JavaScript.
function stripPoint(design,side,u,x,y,height){
  const radius=height*(design==='corkscrew'?.205:.16);
  if(design==='corkscrew'&&side===0)return [x-radius,y-u*height,-.25];
  const angle=design==='corkscrew'?(1-u)*Math.PI*7+Math.PI:u*Math.PI*5.6+side*Math.PI;
  return [x+Math.cos(angle)*radius,y-u*height,Math.sin(angle)];
}
function drawStrip(design,x,y,height,offset){
  const half=leds/2,segments=[];
  for(let led=0;led<leds;led++){
    const row=led<half?led:leds-1-led,side=led<half?0:1;
    const start=Math.max(0,(row-.5)/(half-1)),end=Math.min(1,(row+.5)/(half-1));
    const points=Array.from({length:6},(_,i)=>stripPoint(design,side,start+(end-start)*i/5,x,y,height));
    segments.push({points,led,z:stripPoint(design,side,(start+end)/2,x,y,height)[2]});
  }
  segments.sort((a,b)=>a.z-b.z);
  const width=Math.max(2.2,height*.034);
  ctx.lineCap='round';ctx.lineJoin='round';
  for(const segment of segments){
    const p=offset+segment.led*3,r=bytes[p],g=bytes[p+1],b=bytes[p+2];
    ctx.beginPath();segment.points.forEach(([sx,sy],i)=>i?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy));
    ctx.shadowBlur=0;ctx.lineWidth=width+2;ctx.strokeStyle='#53606a';ctx.stroke();
    ctx.lineWidth=width;ctx.strokeStyle=color(r,g,b);ctx.shadowColor=color(r,g,b,.55);ctx.shadowBlur=5;ctx.stroke();
  }
  ctx.shadowBlur=0;
}
function draw() {
  const w=canvas.getBoundingClientRect().width,h=canvas.getBoundingClientRect().height,n=Number(count.value),ci=counts.indexOf(n),ei=Number(effect.value),ai=Number(audio.value);
  const offset=variants[(ei*counts.length+ci)*2+ai]+frame*n*leds*3;
  ctx.clearRect(0,0,w,h);
  // Room furniture and outlines establish placement only; no effect pixels are calculated here.
  ctx.strokeStyle='#2b3945';ctx.lineWidth=1;ellipse(w*.5,h*.64,w*.43,h*.29);ctx.stroke();
  ctx.strokeStyle='#22313d';ellipse(w*.5,h*.64,w*.31,h*.21);ctx.stroke();
  ctx.fillStyle='#1e2933';roundRect(w*.41,h*.63,w*.18,h*.07,9);ctx.fill();
  ctx.strokeStyle='#30404d';ctx.stroke();ctx.fillStyle='#708396';ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText('ROOM',w*.5,h*.665);
  const positions=arrangement(n,w,h).map(([x,y])=>[x,Math.min(y,h-(w<600?94:60))]),lampHeight=Math.min(174,h*.29,n>=9?w*.17:w*.26);
  let active=0,minimum=leds;
  for(let lamp=0;lamp<n;lamp++) {
    const [x,y]=positions[lamp];let red=0,green=0,blue=0,lit=0;
    for(let led=0;led<leds;led++){const p=offset+(lamp*leds+led)*3;red+=bytes[p];green+=bytes[p+1];blue+=bytes[p+2];if(bytes[p]+bytes[p+1]+bytes[p+2])lit++;}
    active+=lit>0;minimum=Math.min(minimum,lit);red=Math.round(red/leds);green=Math.round(green/leds);blue=Math.round(blue/leds);
    const glow=ctx.createRadialGradient(x,y-lampHeight*.48,4,x,y-lampHeight*.48,lampHeight*.7);
    glow.addColorStop(0,color(red,green,blue,.12));glow.addColorStop(1,color(red,green,blue,0));ctx.fillStyle=glow;ctx.fillRect(x-lampHeight*.7,y-lampHeight*1.2,lampHeight*1.4,lampHeight*1.5);
    ctx.fillStyle=color(red,green,blue,.2);ellipse(x,y+1,lampHeight*.20,6);ctx.fill();
    drawStrip(designForLamp(lamp),x,y,lampHeight,offset+lamp*leds*3);
    ctx.fillStyle='#31404c';ellipse(x,y+5,lampHeight*.16,5);ctx.fill();
    ctx.font='11px system-ui';ctx.fillStyle='#c0cedc';ctx.fillText(`Lamp ${lamp+1}`,x,y+27);
  }
  $('title').textContent=`${names[ei]} · ${n} lamps`;
  $('live').textContent=ai?'SIMULATED AUDIO · 120 BPM':'SILENCE · ZERO AUDIO FEATURES';
  $('kind').textContent=ei===8||ei===9?'AMBIENT SCENE.':'AUDIO SCENE.';
  $('description').textContent=descriptions[ei];
  $('geometry-note').textContent=geometry.value==='corkscrew'?'Illustrative corkscrew · rising spine + descending 3.5-turn spiral':geometry.value==='helix'?'Illustrative helix · two winding legs · configured midpoint at the top':'Mixed room · odd lamps corkscrew, even lamps helix · identical height mapping';
  $('coverage').textContent=`${active} / ${n} lamps lit · minimum ${minimum} / ${leds} sampled LEDs lit on any lamp`;
  const features=signals[ai][frame];['level','bass','mid','treble'].forEach((id,i)=>$(id).style.width=`${features[i]*100/255}%`);
  $('beat').textContent=ai?`Beat ${features[4]}`:'No beats';
  $('time').textContent=`${(frame/fps).toFixed(1)} / ${(frames/fps).toFixed(1)} s`;
  canvas.setAttribute('aria-label',`${names[ei]}, ${n} lamps; ${active} lit. ${geometry.options[geometry.selectedIndex].text}. ${ai?'Simulated audio':'Silence'}. Frame ${frame+1} of ${frames}.`);
  seek.value=frame;
}
function tick(now){if(playing)frame=playbackFrame(now);if(frame!==previousFrame||redraw)paint();requestAnimationFrame(tick);}
window.coolLampPreview={frames,fps,leds,counts,names,variants,bytes,signals,selectFrame:(f)=>{playing=false;frame=Math.max(0,Math.min(frames-1,f));anchor=performance.now()-frame*1000/fps;play.textContent='Play';play.setAttribute('aria-label','Play playback');paint();}};
requestAnimationFrame(tick);
</script></body></html>
)HTML";
} // namespace

int main(int argc, char** argv) {
    try {
        if (argc > 2) throw std::runtime_error("usage: group-scene-preview [output.html]");
        if (LampSyncWire::SceneCount < FirstScene + Names.size() - 1)
            throw std::runtime_error("This source does not yet contain all room scenes (19..32).");
        const auto output = std::filesystem::path(argc == 2 ? argv[1] : ".build/room-effects-preview.html");
        if (!output.parent_path().empty()) std::filesystem::create_directories(output.parent_path());
        std::vector<uint8_t> pixels;
        std::vector<size_t> offsets;
        unsigned totalLamps = 0;
        for (const auto count : Counts) totalLamps += count;
        pixels.reserve(Names.size() * totalLamps * 2 * Frames * Leds * 3);
        for (unsigned id = FirstScene; id < FirstScene + Names.size(); ++id)
            for (unsigned count : Counts)
                for (unsigned music = 0; music <= 1; ++music) {
                    offsets.push_back(pixels.size());
                    unsigned minimumLit = Leds, darkLampFrames = 0;
                    for (unsigned frame = 0; frame < Frames; ++frame) {
                        auto v = input(id, count, music, frame);
                        const uint32_t now = GroupStart + uint64_t(frame) * 1000 / Fps;
                        for (unsigned position = 0; position < count; ++position) {
                            v.position = position; unsigned lit = 0;
                            for (uint16_t led = 0; led < Leds; ++led) {
                                const auto h = LampGroupScenes::height(led, Leds, Leds / 2);
                                const auto c = LampGroupScenes::pixel(v, h, now);
                                pixels.push_back(c.r); pixels.push_back(c.g); pixels.push_back(c.b);
                                lit += unsigned(c.r) + c.g + c.b != 0;
                            }
                            minimumLit = std::min(minimumLit, lit); darkLampFrames += lit == 0;
                        }
                    }
                    std::cout << Names[id - FirstScene] << ": " << count << " lamps, "
                              << (music ? "synthetic audio" : "silence") << ", minimum "
                              << minimumLit << "/" << Leds << " samples lit; " << darkLampFrames << " dark lamp frames\n";
                }
        std::ofstream out(output, std::ios::binary);
        if (!out) throw std::runtime_error("Unable to write preview: " + output.string());
        out << HtmlHead;
        base64(out, pixels);
        out << "</script><script>\nconst frames=" << Frames << ",fps=" << Fps << ",leds=" << Leds << ";\nconst counts=[";
        for (unsigned i = 0; i < Counts.size(); ++i) out << (i ? "," : "") << Counts[i];
        out << "];\nconst names=[";
        for (unsigned i = 0; i < Names.size(); ++i) out << (i ? "," : "") << '"' << Names[i] << '"';
        out << "];\nconst variants=[";
        for (unsigned i = 0; i < offsets.size(); ++i) out << (i ? "," : "") << offsets[i];
        out << "];\nconst signals=[";
        for (unsigned music = 0; music <= 1; ++music) {
            out << (music ? ",[" : "[");
            for (unsigned frame = 0; frame < Frames; ++frame) {
                const auto v = input(FirstScene, 3, music, frame);
                out << (frame ? "," : "") << '[' << unsigned(v.level) << ',' << v.bass / 257
                    << ',' << v.mid / 257 << ',' << v.treble / 257 << ',' << v.groupBeat << ']';
            }
            out << ']';
        }
        out << "];\n" << HtmlTail;
        out.close();
        if (!out) throw std::runtime_error("Preview output write failed.");
        std::cout << "Wrote " << output.string() << " (" << std::filesystem::file_size(output)
                  << " bytes, " << pixels.size() << " exact RGB bytes)\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}
