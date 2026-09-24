#include "LampVu.h"
#include <Preferences.h>
VuColor lampVuColors[3]={{0,255,0},{255,255,0},{255,0,0}};
void loadLampVuColors() {
  Preferences prefs;
  if(!prefs.begin("coollamp",true))return;
  uint8_t data[10]{};
  const bool ok=prefs.getBytesLength("vuColorsV1")==sizeof(data) && prefs.getBytes("vuColorsV1",data,sizeof(data))==sizeof(data);
  prefs.end();
  if(ok && data[0]==1)for(unsigned i=0;i<3;++i)lampVuColors[i]={data[1+i*3],data[2+i*3],data[3+i*3]};
}
bool saveLampVuColors(const VuColor* colors) {
  uint8_t data[10]={1};
  for(unsigned i=0;i<3;++i){data[1+i*3]=colors[i].r;data[2+i*3]=colors[i].g;data[3+i*3]=colors[i].b;}
  Preferences prefs;
  if(!prefs.begin("coollamp",false))return false;
  const bool ok=prefs.putBytes("vuColorsV1",data,sizeof(data))==sizeof(data);prefs.end();
  if(ok)for(unsigned i=0;i<3;++i)lampVuColors[i]=colors[i];
  return ok;
}
