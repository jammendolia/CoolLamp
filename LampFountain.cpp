#include "LampFountain.h"
#include <Preferences.h>
FountainColor lampFountainColors[3]={{255,65,0},{0,230,130},{75,30,255}};
bool lampFountainCustom=false;
void loadLampFountainColors(){
  lampFountainCustom=false;
  Preferences prefs;if(!prefs.begin("coollamp",true))return;
  uint8_t data[10]{};
  const bool ok=prefs.getBytesLength("fountainV1")==sizeof(data) && prefs.getBytes("fountainV1",data,sizeof(data))==sizeof(data);
  prefs.end();
  if(ok && data[0]==1){for(unsigned i=0;i<3;++i)lampFountainColors[i]={data[1+i*3],data[2+i*3],data[3+i*3]};lampFountainCustom=true;}
}
bool saveLampFountainColors(const FountainColor* colors){
  uint8_t data[10]={1};for(unsigned i=0;i<3;++i){data[1+i*3]=colors[i].r;data[2+i*3]=colors[i].g;data[3+i*3]=colors[i].b;}
  Preferences prefs;if(!prefs.begin("coollamp",false))return false;
  const bool ok=prefs.putBytes("fountainV1",data,sizeof(data))==sizeof(data);prefs.end();
  if(ok){for(unsigned i=0;i<3;++i)lampFountainColors[i]=colors[i];lampFountainCustom=true;}return ok;
}
