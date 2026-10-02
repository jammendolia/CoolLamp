// Transient overlays never write the coordinator's settings into this lamp's NVS.
static LampControlState syncLocalControl{};
static bool syncControlSaved=false;

void applyLampSyncControl(const LampSyncWire::Visual* visual) {
  if(visual) {
    if(!syncControlSaved){syncLocalControl={Mode,Brightness,PowerOn};syncControlSaved=true;}
    if(Mode!=visual->mode)fill_solid(leds,NUM_LEDS,CRGB::Black);
    const bool changed=Mode!=visual->mode||Brightness!=visual->brightness||PowerOn!=bool(visual->power);
    Mode=visual->mode;Brightness=visual->brightness;PowerOn=visual->power;
    if(changed)syncLampKnob();
  } else if(syncControlSaved) {
    Mode=syncLocalControl.mode;Brightness=syncLocalControl.brightness;PowerOn=syncLocalControl.power;
    syncControlSaved=false;fill_solid(leds,NUM_LEDS,CRGB::Black);syncLampKnob();
  }
}
void captureLampSyncVisual(LampSyncWire::Visual& v) {
  v={};v.mode=Mode;v.brightness=Brightness;v.power=PowerOn;v.clock=effectClockMs;
  const auto o=getLampEffectOptions(Mode);v.speed=o.speed;v.intensity=o.intensity;v.dual=o.dual;
  v.secondary[0]=o.r;v.secondary[1]=o.g;v.secondary[2]=o.b;
  const auto c=getLampColor(Mode);v.primary[0]=c.enabled;v.primary[1]=c.r;v.primary[2]=c.g;v.primary[3]=c.b;
  for(unsigned i=0;i<3;++i){const auto vu=lampVuColors[i];v.vu[i*3]=vu.r;v.vu[i*3+1]=vu.g;v.vu[i*3+2]=vu.b;
    const auto f=fountainPaletteColor(i);v.fountain[i*3]=f.r;v.fountain[i*3+1]=f.g;v.fountain[i*3+2]=f.b;}
  const auto audio=getLampAudioFeatures();v.audioValid=audio.valid;v.level=audio.level;
  v.bass=audio.bass;v.mid=audio.mid;v.treble=audio.treble;v.beat=audio.beat;v.bassBeat=audio.bassBeat;
}
LampAudioFeatures getLampRenderAudio() {
  if(!lampSyncVisual)return getLampAudioFeatures();
  LampAudioFeatures audio{};const auto& v=*lampSyncVisual;
  audio.valid=v.audioValid;audio.running=true;audio.level=v.level;audio.bass=v.bass;audio.mid=v.mid;audio.treble=v.treble;
  audio.beat=v.beat;audio.bassBeat=v.bassBeat;return audio;
}
