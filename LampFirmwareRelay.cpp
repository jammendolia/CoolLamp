#include "LampFirmwareRelay.h"
#include "LampFirmwareRelayCrypto.h"
#include "LampBleUpdate.h"
#include "LampUpdate.h"
#include "LampCommission.h"
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <esp_app_format.h>
#include <mbedtls/sha256.h>
#include <mbedtls/md.h>
#include <esp_system.h>
#include <esp_wifi.h>
#include <esp_mac.h>

namespace LampFirmwareRelay {
namespace {
using namespace LampFirmwareRelayWire;
const uint8_t broadcast[6]={255,255,255,255,255,255};
const uint16_t current[3]={LAMP_VERSION_MAJOR,LAMP_VERSION_MINOR,LAMP_VERSION_PATCH};
enum State:uint8_t {Idle,AwaitDonor,Receiving,Sending};
State state=Idle;
uint8_t fleet[16]{},self[6]{},peer[6]{},ownHash[32]{},offeredHash[32]{},body[BodyLimit]{},wire[250]{},readBuffer[512]{},bleFrame[244]{};
bool paired=false,described=false,hashing=false,donorReserved=false,senderReady=false,ownMarker=false;
size_t ownMarkerAt=0;
const esp_partition_t* running=nullptr;
uint64_t boot=0,session=0,offerToken=0,expectedPeerBoot=0;
uint32_t sequence=0,lastPeerSequence=0,imageSize=0,hashOffset=0,offeredSize=0,offset=0,touched=0,started=0,lastSent=0,lastOffer=0,retryAt=0;
uint16_t offeredVersion[3]{},bleSequence=0;
mbedtls_sha256_context hash;
void erase(void* data,size_t size){volatile uint8_t* p=static_cast<volatile uint8_t*>(data);while(size--)*p++=0;}
uint64_t randomSession(){return (uint64_t(esp_random())<<32|esp_random())|1;}
bool newer(const uint16_t* a,const uint16_t* b){for(unsigned i=0;i<3;++i)if(a[i]!=b[i])return a[i]>b[i];return false;}
bool send(const uint8_t* bytes,size_t size,const uint8_t* destination){
 if(!paired||!boot||sequence==UINT32_MAX)return false;
 if(!LampFirmwareRelayCrypto::seal(bytes,size,self,destination,fleet,boot,++sequence,wire))return false;
 return LampEspNow::enqueue(wire,Header+size+Tag,destination,true);
}
void stop(uint32_t now){
 if(state==Receiving)abortLampRadioFirmwareReceiver();
 if(donorReserved){releaseLampManualUpdate();finishLampBluetoothUpdateRadio(false);donorReserved=false;}
 state=Idle;session=0;offset=0;senderReady=false;offerToken=0;retryAt=now+60000;erase(offeredHash,sizeof(offeredHash));
}
void acknowledge(uint8_t code){uint8_t p[14]{Ack};put64(p+1,session);put32(p+9,offset);p[13]=code;send(p,sizeof(p),peer);}
void request(){uint8_t p[49]{Request};put64(p+1,session);memcpy(p+9,offeredHash,32);put64(p+41,offerToken);send(p,sizeof(p),peer);}
bool describe(){
#ifndef COOL_LAMP_PUBLIC_RELEASE
 return false;
#else
 running=esp_ota_get_running_partition();if(!running)return false;
 esp_image_header_t header{};if(esp_partition_read(running,0,&header,sizeof(header))!=ESP_OK||header.magic!=ESP_IMAGE_HEADER_MAGIC||header.chip_id!=CONFIG_IDF_FIRMWARE_CHIP_ID||!header.hash_appended||!header.segment_count||header.segment_count>16)return false;
 uint32_t end=sizeof(header);
 for(unsigned i=0;i<header.segment_count;++i){esp_image_segment_header_t segment{};if(end>running->size-sizeof(segment)||esp_partition_read(running,end,&segment,sizeof(segment))!=ESP_OK)return false;end+=sizeof(segment);if(segment.data_len>running->size-end)return false;end+=segment.data_len;}
 // ESP-IDF app images place the checksum at the end of a 16-byte block,
 // followed by their 32-byte appended digest. The release has no extra padding.
 imageSize=(end+16)&~uint32_t(15);imageSize+=32;if(imageSize>2031616||imageSize>running->size)return false;
 esp_app_desc_t description{};if(esp_ota_get_partition_description(running,&description)!=ESP_OK||description.magic_word!=ESP_APP_DESC_MAGIC_WORD)return false;
 mbedtls_sha256_init(&hash);if(mbedtls_sha256_starts(&hash,0)){mbedtls_sha256_free(&hash);return false;}hashing=true;hashOffset=0;return true;
#endif
}
bool startReceiver(){
 if(!getLampUpdateStatus().automatic||!beginLampRadioFirmwareReceiver(uint32_t(session)))return false;
 char digest[65],manifest[192];for(unsigned i=0;i<32;++i)snprintf(digest+i*2,3,"%02x",offeredHash[i]);
 const int length=snprintf(manifest,sizeof(manifest),"COOLLAMP-OTA-1\n%u.%u.%u\nesp32c3\ndual-ota-2031616\n%lu\n%s\n",offeredVersion[0],offeredVersion[1],offeredVersion[2],static_cast<unsigned long>(offeredSize),digest);
 if(length<=0||length>=192){abortLampRadioFirmwareReceiver();return false;}
 memset(bleFrame,0,sizeof(bleFrame));bleFrame[0]=1;bleFrame[1]=LampBleUpdateWire::Manifest;put32(bleFrame+2,uint32_t(session));LampBleUpdateWire::put16(bleFrame+6,++bleSequence);memcpy(bleFrame+10,manifest,size_t(length));
 if(!enqueueLampRadioFirmwareFrame(bleFrame,10+size_t(length))){abortLampRadioFirmwareReceiver();return false;}
 bleFrame[1]=LampBleUpdateWire::Start;LampBleUpdateWire::put16(bleFrame+6,++bleSequence);
 if(!enqueueLampRadioFirmwareFrame(bleFrame,8)){abortLampRadioFirmwareReceiver();return false;}
 state=Receiving;serviceLampRadioFirmwareReceiver();return true;
}
bool receiverStatus(uint8_t* status){getLampBleUpdateStatus(status);return status[1]==LampBleUpdateWire::Receiving;}
}
void begin(){
 esp_read_mac(self,ESP_MAC_WIFI_STA);boot=randomSession();sequence=0;
 Preferences prefs;if(prefs.begin("coollamp",true)){paired=prefs.getBytesLength("fleetKeyV1")==16&&prefs.getBytes("fleetKeyV1",fleet,16)==16;prefs.end();}
}
bool ownsRadio(){return state==Receiving||state==Sending;}
void suspend(){if(state!=Idle)stop(millis());}
bool receive(const LampEspNow::Received& message){
 if(message.length<4||memcmp(message.data,"CLF\1",4))return false;
 if(!paired||millis()-message.receivedAt>1500)return true;
 size_t count=0;
 // Offers use a separate broadcast-derived key. Every other packet is bound
 // to the exact sender and recipient MAC, with its boot nonce in the AEAD AAD.
 bool opened=LampFirmwareRelayCrypto::open(message.data,message.length,message.source,self,fleet,body,count);
 if(!opened)opened=LampFirmwareRelayCrypto::open(message.data,message.length,message.source,broadcast,fleet,body,count)&&body[0]==Offer;
 if(!opened)return true;
 const uint32_t now=millis(),incomingSequence=u32(message.data+12);const uint64_t incomingBoot=u64(message.data+4);
 if(body[0]==Offer){
  if(state!=Idle||int32_t(now-retryAt)<0||!getLampUpdateStatus().automatic||LampCommission::working()||lampUpdateOwnsResources()||now<35000)return true;
  uint16_t version[3];for(unsigned i=0;i<3;++i)version[i]=LampBleUpdateWire::u16(body+1+2*i);
  if(!newer(version,current))return true;
  memcpy(offeredVersion,version,sizeof(version));offeredSize=u32(body+7);memcpy(offeredHash,body+11,32);offerToken=u64(body+43);
  if(!offerToken)return true;
  memcpy(peer,message.source,6);expectedPeerBoot=incomingBoot;lastPeerSequence=incomingSequence;session=randomSession();while(!uint32_t(session))session=randomSession();state=AwaitDonor;started=touched=now;lastSent=0;offset=0;return true;
 }
 if(body[0]==Request){
  if(state!=Idle||!described||!offerToken||u64(body+41)!=offerToken||memcmp(body+9,ownHash,32)||now<35000||lampUpdateOwnsResources())return true;
  if(!reserveLampManualUpdate())return true;
  if(!beginLampBluetoothUpdateRadio()){releaseLampManualUpdate();return true;}
  donorReserved=true;state=Sending;memcpy(peer,message.source,6);session=u64(body+1);expectedPeerBoot=incomingBoot;lastPeerSequence=incomingSequence;offerToken=0;offset=0;senderReady=false;started=touched=now;lastSent=0;return true;
 }
 if(state==Idle||memcmp(peer,message.source,6)||incomingBoot!=expectedPeerBoot||u64(body+1)!=session||incomingSequence<=lastPeerSequence)return true;
 lastPeerSequence=incomingSequence;
 if(body[0]==Reject){stop(now);return true;}
 if(state==AwaitDonor&&body[0]==Ack&&body[13]==0){if(!startReceiver())stop(now);else touched=now;return true;}
 if(state==Sending&&body[0]==Ack){
  const uint32_t written=u32(body+9),next=offset+min(uint32_t(DataLimit),imageSize-offset);
  if(body[13]==2&&offset==imageSize&&written==imageSize){stop(now);return true;}
  if(body[13]!=1)return true;
  if(!senderReady){if(written)return true;senderReady=true;lastSent=0;touched=now;return true;}
  if(written==next&&offset<imageSize){offset=written;lastSent=0;touched=now;}
  return true;
 }
 if(state!=Receiving)return true;
 if(!getLampUpdateStatus().automatic){stop(now);return true;}
 uint8_t status[20];getLampBleUpdateStatus(status);
 if(status[1]==LampBleUpdateWire::Restarting){if(body[0]==Finish)acknowledge(2);return true;}
 if(body[0]==Data){
  const uint32_t at=u32(body+9);const size_t bytes=count-13;
  if(duplicate(at,bytes,offset)){acknowledge(1);return true;}
  if(at!=offset||!receiverStatus(status)||bytes>offeredSize-offset)return true;
  memset(bleFrame,0,12);bleFrame[0]=1;bleFrame[1]=LampBleUpdateWire::Data;put32(bleFrame+2,uint32_t(session));LampBleUpdateWire::put16(bleFrame+6,++bleSequence);put32(bleFrame+8,offset);memcpy(bleFrame+12,body+13,bytes);
  if(!enqueueLampRadioFirmwareFrame(bleFrame,12+bytes)){stop(now);return true;}serviceLampRadioFirmwareReceiver();getLampBleUpdateStatus(status);
  if(status[1]!=LampBleUpdateWire::Receiving){stop(now);return true;}offset=u32(status+12);touched=now;acknowledge(1);return true;
 }
 if(body[0]==Finish&&offset==offeredSize&&receiverStatus(status)){
  memset(bleFrame,0,8);bleFrame[0]=1;bleFrame[1]=LampBleUpdateWire::Finish;put32(bleFrame+2,uint32_t(session));LampBleUpdateWire::put16(bleFrame+6,++bleSequence);
  if(!enqueueLampRadioFirmwareFrame(bleFrame,8)){stop(now);return true;}serviceLampRadioFirmwareReceiver();getLampBleUpdateStatus(status);
  if(status[1]==LampBleUpdateWire::Restarting)acknowledge(2);else stop(now);
 }
 return true;
}
void service(uint32_t now){
 if(!paired)return;
 const auto radio=LampEspNow::status();
 if(state!=Idle){
  if(state==Receiving){uint8_t status[20];serviceLampRadioFirmwareReceiver();getLampBleUpdateStatus(status);if(status[1]==LampBleUpdateWire::Restarting){LampEspNow::holdChannel(now+5000);return;}if(!getLampUpdateStatus().automatic||status[1]==LampBleUpdateWire::Error){stop(now);return;}}
  if(now-started>900000||now-touched>20000||!radio.active||radio.suspended){stop(now);return;}
  LampEspNow::holdChannel(now+5000);
  if(lastSent&&now-lastSent<750)return;
  lastSent=now;
  if(state==AwaitDonor){request();return;}
  if(state==Receiving){uint8_t status[20];if(receiverStatus(status))acknowledge(1);return;}
  if(!senderReady){acknowledge(0);return;}
  if(offset==imageSize){uint8_t p[9]{Finish};put64(p+1,session);send(p,sizeof(p),peer);return;}
  uint8_t p[13+DataLimit]{Data};put64(p+1,session);put32(p+9,offset);const size_t n=min(uint32_t(DataLimit),imageSize-offset);
  if(esp_partition_read(running,offset,p+13,n)!=ESP_OK){stop(now);return;}send(p,13+n,peer);return;
 }
 if(lampUpdateOwnsResources()||now<35000||!radio.active||radio.suspended)return;
 if(!described){
  if(!hashing){if(!describe())return;}
  const size_t n=min(uint32_t(sizeof(readBuffer)),imageSize-hashOffset);
  if(esp_partition_read(running,hashOffset,readBuffer,n)!=ESP_OK||mbedtls_sha256_update(&hash,readBuffer,n)){mbedtls_sha256_free(&hash);hashing=false;return;}
  constexpr char marker[]="COOLLAMP-PUBLIC-" LAMP_FIRMWARE_VERSION;
  for(size_t i=0;i<n;++i){if(readBuffer[i]==uint8_t(marker[ownMarkerAt])){if(++ownMarkerAt==sizeof(marker)){ownMarker=true;ownMarkerAt=0;}}else ownMarkerAt=readBuffer[i]==uint8_t(marker[0])?1:0;}
  hashOffset+=n;if(hashOffset<imageSize)return;
  const bool okay=mbedtls_sha256_finish(&hash,ownHash)==0&&ownMarker;mbedtls_sha256_free(&hash);hashing=false;described=okay;if(!okay)return;
 }
 if(now-lastOffer>=10000){lastOffer=now;offerToken=randomSession();uint8_t p[51]{Offer};for(unsigned i=0;i<3;++i)LampBleUpdateWire::put16(p+1+2*i,current[i]);put32(p+7,imageSize);memcpy(p+11,ownHash,32);put64(p+43,offerToken);send(p,sizeof(p),broadcast);}
}
bool copyFleetKey(uint8_t* out){if(!out||!paired)return false;memcpy(out,fleet,16);return true;}
bool provisionFleetKey(const uint8_t* next){
 if(!next||ownsRadio()||lampUpdateOwnsResources())return false;
 uint8_t any=0;for(unsigned i=0;i<16;++i)any|=next[i];if(!any)return false;
 if(paired)return memcmp(next,fleet,16)==0;
 Preferences prefs;if(!prefs.begin("coollamp",false))return false;
 const bool saved=prefs.putBytes("fleetKeyV1",next,16)==16;prefs.end();if(!saved)return false;
 memcpy(fleet,next,16);paired=true;return true;
}
String fleetId(){
 uint8_t digest[32]{};char id[17]{};
 constexpr char domain[]="CoolLamp fleet identifier v1";
 if(paired&&mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),fleet,16,reinterpret_cast<const uint8_t*>(domain),sizeof(domain)-1,digest)==0){for(unsigned i=0;i<8;++i)snprintf(id+i*2,3,"%02x",digest[i]);}
 erase(digest,sizeof(digest));return String(id);
}
LampControlReply control(bool mutation,const String& form){
 if(mutation){
  if(ownsRadio()||lampUpdateOwnsResources())return {409,"Firmware updater is busy."};
  if(!form.startsWith("key=")||form.length()!=36)return {400,"Invalid fleet credential."};
  uint8_t next[16]{};for(unsigned i=0;i<32;++i){const char c=form[4+i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f'))){erase(next,sizeof(next));return {400,"Invalid fleet credential."};}next[i/2]|=uint8_t(c<='9'?c-'0':c-'a'+10)<<(i%2?0:4);}
  uint8_t any=0;for(const auto byte:next)any|=byte;if(!any){erase(next,sizeof(next));return {400,"Invalid fleet credential."};}
  if(paired&&memcmp(next,fleet,16)){erase(next,sizeof(next));return {409,"Lamp belongs to another paired fleet. Existing trust was preserved."};}
  if(!provisionFleetKey(next)){erase(next,sizeof(next));return {507,"Could not save fleet trust."};}
  erase(next,sizeof(next));
 }
 return {200,String("{\"version\":1,\"paired\":")+(paired?"true":"false")+",\"fleetId\":\""+fleetId()+"\",\"automatic\":"+(getLampUpdateStatus().automatic?"true":"false")+",\"active\":"+(ownsRadio()?"true":"false")+"}"};
}
}
