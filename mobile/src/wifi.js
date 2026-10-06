import { legacyCatalog, validateCatalog } from './catalog.js';
import { lampAddress } from './lamps.js';
import { parseGroupCode } from './sync.js';
import { availableGroupScenes, groupSceneSettings } from './group-scenes.js';

export class WifiTransport {
  constructor(http, callbacks = {}) { this.http=http; this.callbacks=callbacks; this.epoch=0; this.tail=Promise.resolve(); }
  async request(path, data, epoch=this.epoch) {
    let response;
    try { response = await this.http.request({url:this.base+path,method:data===undefined?'GET':'POST',
      headers:{Authorization:this.authorization,...(data===undefined?{}:{'X-Lamp-Token':this.raw.token,'Content-Type':'application/x-www-form-urlencoded'})},
      ...(data===undefined?{}:{data:new URLSearchParams(data).toString()}),responseType:'text',connectTimeout:5000,readTimeout:8000,disableRedirects:true}); }
    catch { throw Object.assign(new Error('Lamp did not respond. Reconnect before trying again.'),{uncertain:true}); }
    if (epoch!==this.epoch) throw new Error('Connection changed.');
    if (response.status===401) throw Object.assign(new Error('Check the lamp access password.'),{confirmed:true});
    if (response.status<200 || response.status>=300) throw Object.assign(new Error(typeof response.data==='string'?response.data:'Lamp rejected the request.'),{confirmed:true});
    return response.data;
  }
  async connect(address,password,expectedId) {
    await this.disconnect(); this.base=lampAddress(address);
    this.authorization='Basic '+btoa(unescape(encodeURIComponent('lamp:'+password)));
    try { await this.refresh(expectedId); this.schedule(); return this.raw; }
    catch(e) { await this.disconnect(); throw e; }
  }
  async refresh(expectedId,retryCatalog=true) {
    const result=await this.request('/api/state');
    const raw=typeof result==='string'?JSON.parse(result):result;
    if (typeof raw.token!=='string'||!Array.isArray(raw.effects)||!Number.isInteger(raw.mode)||raw.mode<1||raw.mode>raw.effects.length||!Number.isInteger(raw.brightness)||raw.brightness<1||raw.brightness>255||typeof raw.hostname!=='string') throw new Error('Invalid lamp response.');
    const identity=raw.deviceId || raw.hostname.replace(/\.local$/,'');
    const legacyIdentity=raw.hostname.replace(/\.local$/,'');
    if (expectedId && identity!==expectedId && expectedId!==legacyIdentity) throw new Error('This address belongs to a different lamp. Find your lamp again.');
    if (this.identity && identity!==this.identity) throw new Error('Lamp identity changed. Reconnect before controlling it.');
    if (!this.catalog || this.raw?.token!==raw.token || this.catalog.length!==raw.effects.length) {
      if (raw.catalogVersion===1) {
        const data=await this.request('/api/effects');
        const entries=typeof data==='string'?JSON.parse(data):data;
        if(Array.isArray(entries)&&entries.length!==raw.effects.length&&retryCatalog)return this.refresh(expectedId,false);
        this.catalog=validateCatalog(entries,raw.effects.length);
      } else this.catalog=legacyCatalog(raw.effects);
    }
    if(this.catalog.length!==raw.effects.length)throw new Error('Lamp effects changed. Reconnect to reload them.');
    this.identity=identity; this.raw=raw;
    const c=raw.colors?.[raw.mode-1];
    this.state={...raw,effectCount:raw.effects.length,capabilities:4|(c?2:0)|(raw.effectOptions?8:0)|(raw.factoryReset?128:0),supportsColor:Boolean(c),color:c?{enabled:Boolean(c[0]),r:c[1],g:c[2],b:c[3]}:null};
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
  factoryReset() {
    if(!this.raw?.factoryReset)return Promise.reject(Error('Update this lamp to firmware 1.9.1 or newer for factory reset.'));
    return this.enqueue(async()=>{const message=await this.request('/api/factory-reset',{confirm:'RESET'});clearTimeout(this.timer);return message;});
  }
  async configureGroupScene(patch) {
    if(this.raw?.sync?.version!==2||this.raw.sync.role!==1)throw Error('Connect to the coordinator running firmware 1.8.0 or newer.');
    const v=groupSceneSettings(this.raw.sync,patch);
    if(!availableGroupScenes(this.raw.sync).some(scene=>scene.id===v.scene))throw Error('Update every lamp to firmware 1.8.1 or newer to use the new group scenes.');
    const message=await this.request('/api/sync/scene',{scene:v.scene,speed:v.speed,intensity:v.intensity,
      r:v.primary[0],g:v.primary[1],b:v.primary[2],r2:v.secondary[0],g2:v.secondary[1],b2:v.secondary[2]});
    await this.refresh();return message;
  }
  async configureGroupOrder(ids) {
    const order=this.raw?.sync?.order;
    if(this.raw?.sync?.version!==2||this.raw.sync.role!==1||!Array.isArray(order))throw Error('Connect to the coordinator to arrange lamps.');
    if(!Array.isArray(ids)||ids.length<1||ids.length>9||new Set(ids).size!==ids.length||
       !ids.includes(this.identity)||ids.some(id=>!order.some(x=>x.id===id))||
       order.some(x=>x.online&&!ids.includes(x.id)))throw Error('Keep every connected lamp in the order.');
    const message=await this.request('/api/sync/order',{order:ids.join(',')});
    await this.refresh();return message;
  }
  async configureSync(role,code='') {
    if(![1,2].includes(this.raw?.sync?.version))throw new Error('Update lamp firmware to use Wi-Fi groups.');
    if(![0,1,2].includes(role))throw new Error('Choose a valid group role.');
    const fields=role?parseGroupCode(code):{};
    if(role===1&&fields.leader!==this.identity)throw new Error('Create the group on its coordinator.');
    if(role===2&&fields.leader===this.identity)throw new Error('A lamp cannot follow itself.');
    const message=await this.request('/api/sync',{role,...fields});
    await this.refresh();return message;
  }
  async syncAction(action) {
    if(!['pause','resume'].includes(action)||![1,2].includes(this.raw?.sync?.version))throw new Error('Group control is unavailable.');
    const message=await this.request('/api/sync',{action});await this.refresh();return message;
  }
  async syncInvite() {
    if(this.raw?.sync?.role!==1)throw new Error('Select the coordinator to get its group code.');
    const code=await this.request('/api/sync/invite',{});parseGroupCode(code);return code;
  }
  async calibrateLeds(action,position) {
    if(!this.raw?.calibration)throw Error('Update lamp firmware to use LED setup.');
    if(!['start','move','save','cancel'].includes(action))throw Error('Choose a valid setup action.');
    if(action==='start' && this.raw.sync?.role)throw Error('Leave the lamp group before sizing this lamp, then rejoin afterward.');
    if(action==='move' && (!Number.isInteger(position)||position<1||position>1024))throw Error('Choose an LED from 1 to 1024.');
    const message=await this.request('/api/calibration',{action,...(action==='move'?{position}:{})});
    if(action!=='save')await this.refresh();
    return message;
  }
  async calibrateCenter(action,position) {
    if(!this.raw?.calibration?.centerSupported)throw Error('Update this lamp to firmware 1.9.1 or newer to fine-tune its center.');
    if(!['start','move','save','cancel'].includes(action))throw Error('Choose a valid center action.');
    if(action==='move'&&(!Number.isInteger(position)||position<1||position>=this.raw.leds))throw Error('Choose a boundary inside this strip.');
    const message=await this.request('/api/calibration',{action,kind:'center',...(action==='move'?{position}:{})});
    await this.refresh();return message;
  }
  async configureRotation({enabled,random,category,seconds}) {
    if(!this.raw?.rotation)throw Error('Update lamp firmware to rotate effects.');
    if(typeof enabled!=='boolean'||typeof random!=='boolean'||![0,1,2].includes(category)||!Number.isInteger(seconds)||seconds<5||seconds>86400)throw Error('Choose an interval from 5 seconds to 24 hours.');
    if(enabled && (this.raw.sync?.role===2 || this.raw.sync?.scene || (category===2&&!this.raw.audio?.installed)))throw Error('Use the controller with Mirror effects selected. Audio-only needs a microphone.');
    const message=await this.request('/api/rotation',{enabled:Number(enabled),random:Number(random),category,seconds});
    await this.refresh();return message;
  }
  async configureGeometry(midpoint) {
    if(this.raw?.midpoint===undefined) throw new Error('Update lamp firmware to adjust its center point.');
    if(!Number.isInteger(midpoint) || midpoint<0 || midpoint>=this.raw.leds) throw new Error('Center must be 0 (automatic) or a boundary before the last LED.');
    const message=await this.request('/api/geometry',{midpoint});
    await this.refresh();
    return message;
  }
  // Apply from the active effect pane. Older firmware retains its restart behavior.
  async configureFountainColors(colors) {
    if(!this.raw?.fountainColors)throw new Error('Connect over Wi-Fi to firmware 1.6.6 or newer to set fountain colors.');
    const values={};
    if(colors===null)values.reset=1;
    else {
      if(!Array.isArray(colors)||colors.length!==3||colors.some(c=>!Array.isArray(c)||c.length!==3||c.some(v=>!Number.isInteger(v)||v<0||v>255)))throw new Error('Choose three valid RGB colors.');
      colors.forEach((c,i)=>['r','g','b'].forEach((channel,j)=>values[channel+i]=c[j]));
    }
    const message=await this.request('/api/fountain-colors',values);
    await this.refresh();return message;
  }
  async configureVuColors(colors) {
    if(!this.raw?.vuColors)throw new Error('Connect over Wi-Fi to firmware 1.6.2 or newer to set meter colors.');
    const values={};
    if(colors===null)values.reset=1;
    else {
      if(!Array.isArray(colors)||colors.length!==3||colors.some(c=>!Array.isArray(c)||c.length!==3||c.some(v=>!Number.isInteger(v)||v<0||v>255)))throw new Error('Choose three valid RGB colors.');
      colors.forEach((c,i)=>['r','g','b'].forEach((channel,j)=>values[channel+i]=c[j]));
    }
    const message=await this.request('/api/vu-colors',values);
    await this.refresh();return message;
  }
  async tuneAudio({gain,gate,scale}) {
    const audio=this.raw?.audio;
    if(!audio?.installed) throw new Error('Connect to a lamp with an installed microphone.');
    if(!Number.isInteger(gain)||gain<1||gain>64||!Number.isInteger(gate)||gate<0||gate>1024||
      (scale!==undefined && (!Number.isInteger(scale)||scale<100||scale>400))) throw new Error('Check audio tuning ranges.');
    if(!audio.liveTuning)return this.configureAudio({enabled:1,gain,gate,...(scale===undefined?{}:{scale})});
    const message=await this.request('/api/audio/tuning',{gain,gate,scale:scale??audio.scale});
    await this.refresh();
    return message;
  }
  // Call inside enqueue, like the other advanced settings actions. Save restarts the device.
  async configureAudio({enabled,gain,gate,scale}) {
    if (!this.raw?.audio) throw new Error('This firmware does not support microphone settings.');
    if (![0,1].includes(enabled) || !Number.isInteger(gain) || gain<1 || gain>64 ||
        !Number.isInteger(gate) || gate<0 || gate>1024) throw new Error('Check microphone sensitivity and noise gate ranges.');
    if(scale!==undefined && (!Number.isInteger(scale) || scale<100 || scale>400)) throw new Error('Check scale factor ranges.');
    if(scale!==undefined && this.raw.audio.scale===undefined) throw new Error('Update lamp firmware to adjust scale factor.');
    const message=await this.request('/api/audio',{enabled,gain,gate,...(scale===undefined?{}:{scale})});
    await this.disconnect();
    return message;
  }
  command(op,value=0) { return this.enqueue(async()=>{
    const epoch=this.epoch;
    if(this.raw?.sync?.active && ['brightness','effect','saveDefaults','color','resetColor','effectOptions'].includes(op))throw new Error('Edit the coordinator or pause this lamp’s group first.');
    if(['brightness','effect'].includes(op) && !this.state.power && !this.raw.apiVersion) throw new Error('Turn the lamp on first, or use Bluetooth to adjust it while off. Firmware 1.4 adds this Wi-Fi control.');
    const paths={power:['/api/power',{on:value}],brightness:['/api/preview',{mode:this.state.mode,brightness:value,keepPower:1}],effect:['/api/preview',{mode:value,brightness:this.state.brightness,keepPower:1}],saveDefaults:['/api/defaults',{}],color:['/api/color',value],resetColor:['/api/color',{mode:value,reset:1}],effectOptions:['/api/effect-options',value],checkFirmware:['/api/firmware/check',{}],installFirmware:['/api/firmware/install',{}],autoUpdate:['/api/firmware/automatic',{enabled:value}]};
    const mode=op==='effect'||op==='resetColor'?value:['color','effectOptions'].includes(op)?value.mode:null;
    if(mode!==null && !this.catalog?.some(x=>x.id===mode))throw new Error('This effect is not available on the selected lamp.');
    if(!paths[op])throw new Error('Unsupported command.');
    try { if(op==='effect' && this.raw?.sync?.role===1 && this.raw.sync.scene)await this.configureGroupScene({scene:0}); await this.request(...paths[op]); await this.refresh(); }
    catch(e) { if(!e.confirmed && epoch===this.epoch)await this.disconnect();throw e; }
  }); }
  async disconnect() { clearTimeout(this.timer);this.epoch++;this.identity=null;this.catalog=null;this.raw=null;this.state=null;this.authorization=null;this.callbacks.onDisconnect?.(); }
}
