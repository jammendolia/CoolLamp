import { lampAddress } from './lamps.js';

export class WifiTransport {
  constructor(http, callbacks = {}) { this.http=http; this.callbacks=callbacks; this.epoch=0; this.tail=Promise.resolve(); }
  async request(path, data, epoch=this.epoch) {
    let response;
    try { response = await this.http.request({url:this.base+path,method:data===undefined?'GET':'POST',
      headers:{Authorization:this.authorization,...(data===undefined?{}:{'X-Lamp-Token':this.raw.token,'Content-Type':'application/x-www-form-urlencoded'})},
      ...(data===undefined?{}:{data:new URLSearchParams(data).toString()}),responseType:'text',connectTimeout:5000,readTimeout:8000,disableRedirects:true}); }
    catch { throw Object.assign(new Error('Lamp did not respond. Reconnect before trying again.'),{uncertain:true}); }
    if (epoch!==this.epoch) throw new Error('Connection changed.');
    if (response.status===401) throw new Error('Check the lamp access password.');
    if (response.status<200 || response.status>=300) throw new Error(typeof response.data==='string'?response.data:'Lamp rejected the request.');
    return response.data;
  }
  async connect(address,password,expectedId) {
    await this.disconnect(); this.base=lampAddress(address);
    this.authorization='Basic '+btoa(unescape(encodeURIComponent('lamp:'+password)));
    try { await this.refresh(expectedId); this.schedule(); return this.raw; }
    catch(e) { await this.disconnect(); throw e; }
  }
  async refresh(expectedId) {
    const result=await this.request('/api/state');
    const raw=typeof result==='string'?JSON.parse(result):result;
    if (typeof raw.token!=='string'||!Array.isArray(raw.effects)||!Number.isInteger(raw.mode)||raw.mode<1||raw.mode>raw.effects.length||!Number.isInteger(raw.brightness)||raw.brightness<1||raw.brightness>255||typeof raw.hostname!=='string') throw new Error('Invalid lamp response.');
    const identity=raw.deviceId || raw.hostname.replace(/\.local$/,'');
    if (expectedId && identity!==expectedId) throw new Error('This address belongs to a different lamp. Find your lamp again.');
    if (this.identity && identity!==this.identity) throw new Error('Lamp identity changed. Reconnect before controlling it.');
    this.identity=identity; this.raw=raw;
    const c=raw.colors?.[raw.mode-1];
    this.state={...raw,effectCount:raw.effects.length,capabilities:4|(c?2:0)|(raw.effectOptions?8:0),supportsColor:Boolean(c),color:c?{enabled:Boolean(c[0]),r:c[1],g:c[2],b:c[3]}:null};
    this.callbacks.onState?.(this.state); this.callbacks.onFirmware?.(raw.firmware);
    const o=raw.effectOptions?.[raw.mode-1];
    this.callbacks.onOptions?.(o?{mode:raw.mode,speed:o[0],intensity:o[1],dual:o[2],r:o[3],g:o[4],b:o[5]}:null);
    return raw;
  }
  schedule() {
    const epoch=this.epoch;
    this.timer=setTimeout(async()=>{
      try { await this.enqueue(()=>this.refresh()); if(epoch===this.epoch)this.schedule(); }
      catch(e) { if(epoch===this.epoch){await this.disconnect();this.callbacks.onError?.(e);} }
    },2500);
  }
  enqueue(fn) { const epoch=this.epoch; const next=this.tail.then(()=>{if(epoch!==this.epoch)throw new Error('Connection changed.');return fn();});this.tail=next.catch(()=>{});return next; }
  command(op,value=0) { return this.enqueue(async()=>{
    const paths={power:['/api/power',{on:value}],brightness:['/api/preview',{mode:this.state.mode,brightness:value}],effect:['/api/preview',{mode:value,brightness:this.state.brightness}],saveDefaults:['/api/defaults',{}],color:['/api/color',value],resetColor:['/api/color',{mode:value,reset:1}],effectOptions:['/api/effect-options',value],checkFirmware:['/api/firmware/check',{}],installFirmware:['/api/firmware/install',{}],autoUpdate:['/api/firmware/automatic',{enabled:value}]};
    if(!paths[op])throw new Error('Unsupported command.');
    try { await this.request(...paths[op]); await this.refresh(); }
    catch(e) { if(e.uncertain)await this.disconnect();throw e; }
  }); }
  async disconnect() { clearTimeout(this.timer);this.epoch++;this.identity=null;this.raw=null;this.state=null;this.authorization=null;this.callbacks.onDisconnect?.(); }
}
