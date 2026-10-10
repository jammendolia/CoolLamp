#include "LampBleUpdate.h"
#include "LampCommission.h"
#include "LampUpdate.h"
#include "LampUpdateAttempt.h"
#include "LampRollout.h"
#include "UpdateManifest.h"
#include "UpdatePublisher.h"
#include <esp_ota_ops.h>
#include <esp_app_format.h>
#include <mbedtls/sha256.h>
#include <Arduino.h>

namespace {
using namespace LampBleUpdateWire;
Queue queue;
uint8_t phase=Idle,error=Ok,settle=0;
uint32_t owner=0,session=0,offset=0,touched=0;
uint32_t sessionBegan=0;
uint16_t ack=0,manifestUsed=0;
char text[ManifestCapacity]{};
FirmwareManifest manifest{};
const esp_partition_t* target=nullptr;
esp_ota_handle_t ota=0;
bool reserved=false,hashing=false,headerValid=false,markerFound=false;
bool resumable=false,detached=false,publisherVerified=false;
uint32_t signedEpoch=0,detachedAt=0;
constexpr uint32_t ResumeLifetimeMs=120000;
constexpr uint32_t SessionLifetimeMs=3600000;
uint32_t radioOwner=0;
constexpr size_t Prefix=sizeof(esp_image_header_t)+sizeof(esp_image_segment_header_t)+sizeof(esp_app_desc_t);
uint8_t prefix[Prefix]{};size_t prefixUsed=0,markerAt=0;
char marker[64]{};
mbedtls_sha256_context hash;
void release(bool cancelled=false){
 if(ota){esp_ota_abort(ota);ota=0;}
 if(hashing){mbedtls_sha256_free(&hash);hashing=false;}
 if(reserved){finishLampBluetoothUpdate(false,cancelled);reserved=false;}
}
void fail(uint8_t reason){release(reason==Cancelled);phase=Error;error=reason;}
void reset(){release(true);phase=Idle;error=Ok;session=0;offset=0;ack=0;manifestUsed=0;manifest={};target=nullptr;memset(text,0,sizeof(text));prefixUsed=0;markerAt=0;markerFound=false;headerValid=false;settle=0;resumable=false;detached=false;publisherVerified=false;signedEpoch=0;detachedAt=0;}
bool readyImage(){
 const uint16_t current[3]={LAMP_VERSION_MAJOR,LAMP_VERSION_MINOR,LAMP_VERSION_PATCH};
 if(!strncmp(text,"COOLLAMP-OTA-2\n",15)){
  UpdatePublisher::Manifest signedManifest;
  if(!UpdatePublisher::verifyProvisioned(text,manifestUsed,signedManifest))return false;
  manifest=signedManifest.image;signedEpoch=signedManifest.epoch;publisherVerified=true;return true;
 }
 if(UpdatePublisher::enforced())return false;
 return parseFirmwareManifest(text,manifest)&&!firmwareIsNewer(current,manifest.version);
}
bool append(const uint8_t* bytes,size_t size){
 if(size>manifest.size-offset)return false;
 if(mbedtls_sha256_update(&hash,bytes,size))return false;
 const size_t markerLength=strlen(marker)+1;
 for(size_t i=0;i<size;++i){
  if(bytes[i]==uint8_t(marker[markerAt])){if(++markerAt==markerLength){markerFound=true;markerAt=0;}}
  else markerAt=bytes[i]==uint8_t(marker[0])?1:0;
 }
 size_t consumed=0;
 if(!headerValid){
  const size_t take=min(size,Prefix-prefixUsed);memcpy(prefix+prefixUsed,bytes,take);prefixUsed+=take;consumed+=take;
  if(prefixUsed==Prefix){
   esp_image_header_t image;esp_app_desc_t app;memcpy(&image,prefix,sizeof(image));memcpy(&app,prefix+sizeof(image)+sizeof(esp_image_segment_header_t),sizeof(app));
   if(image.magic!=ESP_IMAGE_HEADER_MAGIC||image.chip_id!=CONFIG_IDF_FIRMWARE_CHIP_ID||app.magic_word!=ESP_APP_DESC_MAGIC_WORD)return false;
   if(esp_ota_write(ota,prefix,Prefix)!=ESP_OK)return false;
   headerValid=true;
  }
 }
 if(headerValid&&consumed<size&&esp_ota_write(ota,bytes+consumed,size-consumed)!=ESP_OK)return false;
 offset+=size;setLampBluetoothUpdateProgress(headerValid?offset:0,manifest.size);return true;
}
void consume(const Frame& frame){
 if(phase==Restarting)return;
 const uint8_t* p=frame.bytes;const uint8_t op=p[1];const uint32_t tx=u32(p+2);const uint16_t request=u16(p+6);
 if(op==Resume){
  // Authorized bonded reconnection may only take the original in-RAM lease.
  // Rejected proofs never erase the unfinished image or extend its lifetime.
  if(!resumable||!detached||phase!=Receiving||tx!=session||uint32_t(millis()-detachedAt)>=ResumeLifetimeMs||
     u32(p+8)!=manifest.size||memcmp(p+12,manifest.sha256,32))return;
  for(unsigned i=0;i<3;++i)if(u16(p+44+2*i)!=manifest.version[i])return;
  owner=frame.generation;detached=false;ack=request;touched=millis();return;
 }
 if(op==Manifest&&u16(p+8)==0&&(phase==Idle||phase==Error)){reset();session=tx;owner=frame.generation;sessionBegan=millis();}
 if(tx!=session||frame.generation!=owner)return;
 ack=request;touched=millis();
 if(op==Cancel){if(phase!=Restarting){release(true);phase=Error;error=Cancelled;}return;}
 if(op==Manifest){
  if(phase!=Idle||u16(p+8)!=manifestUsed){fail(Offset);return;}
  const size_t count=frame.length-10;memcpy(text+manifestUsed,p+10,count);manifestUsed+=count;text[manifestUsed]=0;return;
 }
 if(op==Start||op==StartWithLease){
  if(phase!=Idle||!manifestUsed||!readyImage()){fail(Invalid);return;}
  if(!lampRolloutAllowsAutomaticUpdate(manifest)){fail(Busy);return;}
  if(radioOwner&&!LampUpdateAttempt::automaticAllowed(manifest)){fail(Busy);return;}
  if(!beginLampBluetoothUpdate()){fail(Busy);return;}
  reserved=true;resumable=op==StartWithLease&&!radioOwner;phase=Preparing;settle=2;offset=0;prefixUsed=0;markerAt=0;markerFound=false;headerValid=false;
  if(!lampRolloutAutomaticUpdateStarted(manifest)){fail(Flash);return;}
  snprintf(marker,sizeof(marker),"COOLLAMP-PUBLIC-%u.%u.%u",manifest.version[0],manifest.version[1],manifest.version[2]);return;
 }
 if(op==Data){
  if(phase!=Receiving||u32(p+8)!=offset){fail(Offset);return;}
  if(!append(p+DataHeader,frame.length-DataHeader)){fail(Image);return;}return;
 }
 if(op==Finish){
  if(phase!=Receiving||offset!=manifest.size||!headerValid||!markerFound){fail(Image);return;}
  phase=Verifying;uint8_t digest[32];const int hashed=mbedtls_sha256_finish(&hash,digest);mbedtls_sha256_free(&hash);hashing=false;
  if(hashed){fail(Image);return;}
  if(memcmp(digest,manifest.sha256,32)){fail(Image);return;}
  const auto handle=ota;ota=0;
  if(esp_ota_end(handle)!=ESP_OK){fail(Image);return;}
  if(publisherVerified&&(!UpdatePublisher::retainManifest(text,manifestUsed)||!UpdatePublisher::recordEpoch(signedEpoch))){fail(Flash);return;}
  if(!LampUpdateAttempt::prepare(manifest,!radioOwner)){fail(Flash);return;}
  if(esp_ota_set_boot_partition(target)!=ESP_OK){fail(Flash);return;}
  phase=Restarting;error=Ok;finishLampBluetoothUpdate(true);reserved=false;
 }
}
}
bool enqueueLampBleUpdate(const uint8_t* bytes,size_t size,uint32_t generation){
 if(!LampBleUpdateWire::valid(bytes,size))return false;
 LampBleUpdateWire::Frame frame;frame.generation=generation;frame.length=size;memcpy(frame.bytes,bytes,size);return queue.push(frame);
}
static void serviceReceiver(uint32_t generation,bool bonded){
 using namespace LampBleUpdateWire;
 // Commit is durable. Disconnect after Finish never cancels its scheduled boot.
 if(phase==Restarting)return;
 if(!bonded||(owner&&owner!=generation)){
  if(session&&resumable&&phase==Receiving){if(!detached){detached=true;detachedAt=millis();}owner=0;}
  else{if(session)reset();owner=generation;}
 }
 if(session&&(uint32_t(millis()-sessionBegan)>=SessionLifetimeMs||(detached?uint32_t(millis()-detachedAt)>=ResumeLifetimeMs:uint32_t(millis()-touched)>30000))){fail(Expired);session=0;detached=false;}
 // Wait across complete subsequent loop passes for UDP/radio/RPC cleanup.
 if(phase==Preparing&&settle&&!--settle){
  target=esp_ota_get_next_update_partition(nullptr);
  if(!target||target->size<2031616||esp_ota_begin(target,OTA_WITH_SEQUENTIAL_WRITES,&ota)!=ESP_OK){fail(Partition);}
  else{mbedtls_sha256_init(&hash);hashing=true;if(mbedtls_sha256_starts(&hash,0))fail(Image);else phase=Receiving;}
 }
 Frame frame;for(unsigned i=0;i<DataWriteWithoutResponseWindow&&queue.pop(frame);++i)if(bonded&&frame.generation==generation&&(!detached||frame.bytes[1]==Resume))consume(frame);
}
void serviceLampBleUpdate(uint32_t generation,bool bonded){if(!radioOwner)serviceReceiver(generation,bonded);}
bool beginLampRadioFirmwareReceiver(uint32_t generation){
 if(!generation||radioOwner||reserved||phase==LampBleUpdateWire::Restarting||LampCommission::working()||lampUpdateOwnsResources())return false;
 reset();radioOwner=generation;return true;
}
bool enqueueLampRadioFirmwareFrame(const uint8_t* bytes,size_t size){return radioOwner&&enqueueLampBleUpdate(bytes,size,radioOwner);}
void serviceLampRadioFirmwareReceiver(){if(radioOwner)serviceReceiver(radioOwner,true);}
void abortLampRadioFirmwareReceiver(){if(radioOwner&&phase!=LampBleUpdateWire::Restarting){reset();radioOwner=0;}}
void getLampBleUpdateStatus(uint8_t* out){
 using namespace LampBleUpdateWire;memset(out,0,20);out[0]=1;out[1]=phase;out[2]=error;
 out[3]=DataWriteWithoutResponseFourFlag|ResumeLeaseFlag|(detached?DetachedFlag:0)|(phase==Restarting?CommittedFlag:0);
 put32(out+4,session);put32(out+8,manifest.size);put32(out+12,offset);put16(out+16,ack);put16(out+18,MaxData);
}
