// /api/config saves all four hardware values and the SSID together. Build a
// complete payload from saved values, then apply only the visible form's draft.
export function configurationPayload(raw, section, draft) {
  const saved = {ssid:raw.ssid ?? '',leds:raw.leds,milliamps:raw.milliamps,
    mode:raw.startupMode ?? raw.mode,brightness:raw.startupBrightness ?? raw.brightness};
  if(section==='hardware')return {...saved,leds:draft.leds,milliamps:draft.milliamps,
    mode:draft.startupMode,brightness:draft.startupBrightness};
  if(section==='network')return {...saved,ssid:draft.ssid,wifiPassword:draft.wifiPassword,
    adminPassword:draft.adminPassword,openNetwork:Number(draft.openNetwork),forgetWifi:Number(draft.forgetWifi)};
  throw new Error('Unknown settings section.');
}
