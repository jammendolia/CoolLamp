export const NAVIGATION_SESSION_KEY='coollamp-navigation-v1';
const VERSION=1;
const ROUTES=new Set(['home','lights','automations','lamps','groups','settings','app-settings','people-access','help','bridges']);
const SETTINGS_SECTIONS=new Set(['lighting','overview','design','hardware','network','updates']);

const route=value=>ROUTES.has(value)?value:'home';
const section=value=>SETTINGS_SECTIONS.has(value)?value:'lighting';
const target=value=>typeof value==='string'&&/^[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;
const offset=value=>Number.isFinite(value)&&value>=0?Math.min(Math.round(value),1000000):0;

export function defaultNavigationSession(){
 return {version:VERSION,route:'home',settingsSection:'lighting',targetId:null,returnRoute:'home',scroll:{}};
}

export function readNavigationSession(storage=globalThis.localStorage){
 try{
  const raw=storage?.getItem?.(NAVIGATION_SESSION_KEY);if(!raw||raw.length>4096)return defaultNavigationSession();
  const parsed=JSON.parse(raw);if(!parsed||parsed.version!==VERSION||typeof parsed!=='object'||Array.isArray(parsed))return defaultNavigationSession();
  const scroll={};
  if(parsed.scroll&&typeof parsed.scroll==='object'&&!Array.isArray(parsed.scroll))for(const [key,value] of Object.entries(parsed.scroll))if(ROUTES.has(key))scroll[key]=offset(value);
  return {version:VERSION,route:route(parsed.route),settingsSection:section(parsed.settingsSection),targetId:target(parsed.targetId),returnRoute:route(parsed.returnRoute),scroll};
 }catch{return defaultNavigationSession();}
}

export function writeNavigationSession(storage,value){
 try{storage?.setItem?.(NAVIGATION_SESSION_KEY,JSON.stringify(value));return true;}catch{return false;}
}

export function rememberNavigation(current,{route:nextRoute,settingsSection,targetId,returnRoute,scrollRoute,scrollY,preserveTarget=false}={}){
 const previous=readNavigationSession({getItem:()=>JSON.stringify(current)}),next={...previous,scroll:{...previous.scroll}};
 if(scrollRoute&&ROUTES.has(scrollRoute))next.scroll[scrollRoute]=offset(scrollY);
 if(nextRoute!==undefined)next.route=route(nextRoute);
 if(settingsSection!==undefined)next.settingsSection=section(settingsSection);
 if(returnRoute!==undefined)next.returnRoute=route(returnRoute);
 if(targetId!==undefined)next.targetId=target(targetId);
 else if(next.route!=='settings'&&!preserveTarget)next.targetId=null;
 return next;
}

export function resumableLampTask(session,lamps=[]){
 const value=readNavigationSession({getItem:()=>JSON.stringify(session)});
 if(value.route!=='settings'||!value.targetId||!lamps.some(lamp=>lamp?.id?.toLowerCase?.()===value.targetId))return null;
 return {id:value.targetId,section:value.settingsSection,returnRoute:value.returnRoute,scrollY:value.scroll.settings||0};
}
