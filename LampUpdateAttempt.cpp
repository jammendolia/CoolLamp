#include "LampUpdateAttempt.h"
#include <nvs.h>

namespace LampUpdateAttempt {
namespace {
constexpr char Name[]="lamptrust",Key[]="otaAttemptV1";
FirmwareManifest entries[Capacity]{};
uint8_t count=0;
bool readable=false;
portMUX_TYPE mux=portMUX_INITIALIZER_UNLOCKED;
void unreadable(){portENTER_CRITICAL(&mux);readable=false;portEXIT_CRITICAL(&mux);}
uint32_t u32(const uint8_t* p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
void put32(uint8_t* p,uint32_t v){for(unsigned i=0;i<4;++i)p[i]=uint8_t(v>>(i*8));}
uint32_t crc(const uint8_t* p,size_t n){uint32_t v=UINT32_MAX;while(n--){v^=*p++;for(unsigned i=0;i<8;++i)v=(v>>1)^(0xedb88320UL&uint32_t(-int32_t(v&1)));}return ~v;}
bool valid(const FirmwareManifest& image){return image.size>=288&&image.size<=2031616;}
void encode(uint8_t out[RecordSize],const FirmwareManifest* values,uint8_t used){
 memset(out,0,RecordSize);memcpy(out,"CLA1",4);out[4]=1;out[5]=used;
 for(unsigned i=0;i<used;++i){auto* p=out+8+i*44;for(unsigned j=0;j<3;++j){p[j*2]=values[i].version[j];p[j*2+1]=values[i].version[j]>>8;}put32(p+8,values[i].size);memcpy(p+12,values[i].sha256,32);}
 put32(out+RecordSize-4,crc(out,RecordSize-4));
}
bool decode(const uint8_t in[RecordSize]){
 if(memcmp(in,"CLA1",4)||in[4]!=1||in[5]>Capacity||in[6]||in[7]||u32(in+RecordSize-4)!=crc(in,RecordSize-4))return false;
 FirmwareManifest next[Capacity]{};const uint8_t used=in[5];
 for(unsigned i=0;i<Capacity;++i){const auto* p=in+8+i*44;
  if(i>=used){for(unsigned j=0;j<44;++j)if(p[j])return false;continue;}
  if(p[6]||p[7])return false;
  for(unsigned j=0;j<3;++j)next[i].version[j]=uint16_t(p[j*2])|uint16_t(p[j*2+1])<<8;
  next[i].size=u32(p+8);memcpy(next[i].sha256,p+12,32);if(!valid(next[i]))return false;
  for(unsigned j=0;j<i;++j)if(sameFirmwareManifest(next[i],next[j]))return false;
 }
 memcpy(entries,next,sizeof(entries));count=used;return true;
}
// NVS error codes retain absence versus read/type/length failure. Never use a
// default value to interpret a failed read as an empty quarantine.
bool read(uint8_t out[RecordSize],bool& absent){
 nvs_handle_t handle=0;const esp_err_t opened=nvs_open(Name,NVS_READONLY,&handle);
 absent=opened==ESP_ERR_NVS_NOT_FOUND;if(absent)return true;if(opened!=ESP_OK)return false;
 size_t size=RecordSize;const auto result=nvs_get_blob(handle,Key,out,&size);nvs_close(handle);
 absent=result==ESP_ERR_NVS_NOT_FOUND;return absent||(result==ESP_OK&&size==RecordSize);
}
bool save(const FirmwareManifest* next,uint8_t used){
 uint8_t encoded[RecordSize];encode(encoded,next,used);
 nvs_handle_t handle=0;if(nvs_open(Name,NVS_READWRITE,&handle)!=ESP_OK)return false;
 const bool saved=nvs_set_blob(handle,Key,encoded,sizeof(encoded))==ESP_OK&&nvs_commit(handle)==ESP_OK;nvs_close(handle);
 if(!saved){uint8_t observed[RecordSize]{};bool absent=false;
  if(!read(observed,absent)){unreadable();return false;}
  if(absent||memcmp(observed,encoded,sizeof(encoded))){
   uint8_t prior[RecordSize];portENTER_CRITICAL(&mux);encode(prior,entries,count);const bool empty=!count;portEXIT_CRITICAL(&mux);
   if(!(absent?empty:!memcmp(observed,prior,sizeof(prior))))unreadable();
   return false;
  }
 }
 portENTER_CRITICAL(&mux);memcpy(entries,next,sizeof(entries));count=used;portEXIT_CRITICAL(&mux);return true;
}
int find(const FirmwareManifest& image){for(unsigned i=0;i<count;++i)if(sameFirmwareManifest(entries[i],image))return int(i);return -1;}
}
void begin(){uint8_t bytes[RecordSize]{};bool absent=false;count=0;memset(entries,0,sizeof(entries));readable=read(bytes,absent)&&(absent||decode(bytes));}
bool automaticAllowed(const FirmwareManifest& image){portENTER_CRITICAL(&mux);const bool allowed=readable&&valid(image)&&find(image)<0&&count<Capacity;portEXIT_CRITICAL(&mux);return allowed;}
bool prepare(const FirmwareManifest& image,bool explicitRepair){
 FirmwareManifest next[Capacity];uint8_t used=0;
 portENTER_CRITICAL(&mux);
 if(!readable||!valid(image)){portEXIT_CRITICAL(&mux);return false;}
 if(find(image)>=0){portEXIT_CRITICAL(&mux);return explicitRepair;} // Original durable attempt retained.
 if(count==Capacity){portEXIT_CRITICAL(&mux);return false;} // Never evict quarantine.
 memcpy(next,entries,sizeof(next));used=count;next[used++]=image;portEXIT_CRITICAL(&mux);
 return save(next,used);
}
bool confirmHealthy(const FirmwareManifest& image){
 FirmwareManifest next[Capacity]{};uint8_t used=0;portENTER_CRITICAL(&mux);
 if(!readable||!valid(image)){portEXIT_CRITICAL(&mux);return false;}
 const int matched=find(image);if(matched<0){portEXIT_CRITICAL(&mux);return true;}
 for(unsigned i=0;i<count;++i)if(int(i)!=matched)next[used++]=entries[i];
 portEXIT_CRITICAL(&mux);return save(next,used);
}
String statusJson(const FirmwareManifest& image){
 portENTER_CRITICAL(&mux);const bool ready=readable;const uint8_t used=count,reason=!ready?3:find(image)>=0?1:count==Capacity?2:0;portEXIT_CRITICAL(&mux);
 return String("{\"version\":1,\"storageReady\":")+(ready?"true":"false")+",\"unconfirmedArtifacts\":"+String(unsigned(used))+",\"capacity\":4,\"candidateReason\":"+String(unsigned(reason))+",\"sameArtifactRequiresManual\":true,\"rollbackProven\":false}";
}
}
