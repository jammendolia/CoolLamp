#include "LampModel.h"
#include <Preferences.h>
#include <cstring>
#include <nvs.h>
#include "LampJsonSink.h"
namespace LampModel {
namespace {
Record model;
// Unreadable storage is locked until service can establish its contents.
uint8_t factoryState=2;char style[33]{};
}
bool valid(const Record& value){return LampFactoryDesign::valid(value);}
void begin(){
  model={};strcpy(model.id,"custom");strcpy(model.name,"CoolLamp");strcpy(model.artwork,"generic");strcpy(model.hardware,"unspecified");
  factoryState=2;style[0]=0;
  nvs_handle_t handle;const esp_err_t opened=nvs_open(LampFactoryDesign::Namespace,NVS_READONLY,&handle);
  if(opened==ESP_OK){
    LampFactoryDesign::Record saved;size_t size=sizeof(saved);
    const esp_err_t read=nvs_get_blob(handle,LampFactoryDesign::Key,&saved,&size);nvs_close(handle);
    if(read==ESP_OK&&size==sizeof(saved)&&LampFactoryDesign::valid(saved)){model=saved.model;memcpy(style,saved.style,sizeof(style));factoryState=1;return;}
    if(read!=ESP_ERR_NVS_NOT_FOUND)return;
  }else if(opened!=ESP_ERR_NVS_NOT_FOUND)return;
  factoryState=0;
  Preferences prefs;if(!prefs.begin("lampmodel",true))return;Record saved{};
  const bool loaded=prefs.getBytesLength("descriptorV1")==sizeof(saved)&&prefs.getBytes("descriptorV1",&saved,sizeof(saved))==sizeof(saved);prefs.end();if(loaded&&LampModel::valid(saved))model=saved;
}
const Record& current(){return model;}
bool locked(){return factoryState!=0;}
bool factoryAvailable(){return factoryState==1;}
const char* factoryStyle(){return style;}
bool provision(const Record& value){if(locked()||!LampModel::valid(value))return false;Preferences prefs;if(!prefs.begin("lampmodel",false))return false;const bool ok=prefs.putBytes("descriptorV1",&value,sizeof(value))==sizeof(value);prefs.end();if(ok)model=value;return ok;}
void appendJson(LampJsonSink& out){
    out.concat("{\"version\":1,\"id\":");out.quote(model.id);out.concat(",\"displayName\":");out.quote(model.name);
    out.concat(",\"artworkFamily\":");out.quote(model.artwork);out.concat(",\"hardwareRevision\":");out.quote(model.hardware);
    out.concat(",\"preconfigured\":");out.concat(model.preconfigured?"true":"false");out.concat('}');
}
String json(){return lampJsonReply(appendJson);}
}
