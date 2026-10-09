#include "LampBleControl.h"
#include "LampControlEndpoint.h"
#include "LampUpdate.h"
#include "LampVersion.h"
#include "LampFirmwareRelay.h"

namespace {
LampBleControlWire::Transfer transfer;
constexpr char metadata[]="{\"version\":1,\"capabilities\":[\"control\",\"groups\",\"espnow\",\"firmware-relay\"],\"maxRequest\":1024,\"maxResponse\":8192,\"pageBytes\":480,\"firmware\":\"" LAMP_FIRMWARE_VERSION "\"}";
void clearText(String& text){
  if(text.length())LampBleControlWire::zero(const_cast<char*>(text.c_str()),text.length());
  text=String();
}
}
size_t lampBleControlMetadata(uint8_t* out,size_t capacity){
  const size_t length=sizeof(metadata)-1;
  if(!out||capacity<LampBleControlWire::Header+length)return 0;
  LampBleControlWire::header(out,0,0,200,length,0,length);
  memcpy(out+LampBleControlWire::Header,metadata,length);return LampBleControlWire::Header+length;
}
void resetLampBleControlTransfer(uint32_t generation){transfer.reset(generation);}
bool serviceLampBleControlTransfer(uint32_t generation,bool authorized,bool updating){
  return transfer.service(generation,millis(),authorized,updating);
}
uint8_t lampBleControlCommand(const uint8_t* frame,size_t size,uint32_t generation,
                             uint8_t* reply,size_t capacity,size_t& replySize){
  using namespace LampBleControlWire;
  replySize=0;
  if(!validFrame(frame,size))return 2;
  const bool updating=lampUpdateOwnsResources();
  if(updating&&((frame[2]==Begin&&frame[5]&&frame[5]!=LampControlEndpoint::Firmware)||
       (frame[2]!=Begin&&transfer.endpointId()!=LampControlEndpoint::Firmware))){
    transfer.clearPayload();replySize=lampBleControlMetadata(reply,capacity);return 3;
  }
  if(frame[2]==Begin){
    if(!transfer.begin(frame,size,generation,millis()))return 2;
    replySize=transfer.active()?transfer.pending(reply,capacity):lampBleControlMetadata(reply,capacity);return 0;
  }
  if(frame[2]==Chunk)return transfer.append(frame,size,generation,millis())?0:2;
  if(frame[2]==Commit){
    if(!transfer.consume(frame,size,generation,millis()))return 2;
    String form;
    if(!form.reserve(transfer.bodySize())||!form.concat(reinterpret_cast<const char*>(transfer.body()),transfer.bodySize())){
      clearText(form);transfer.clearPayload();replySize=lampBleControlMetadata(reply,capacity);return 4;
    }
    LampControlReply response=transfer.endpointId()==LampControlEndpoint::FirmwareFleet?LampFirmwareRelay::control(transfer.mutation(),form):lampControlRequest(transfer.endpointId(),transfer.mutation(),form);
    clearText(form);
    const bool sizeOkay=response.body.length()<=MaxResponse&&(!updating||response.body.length()<=PageBytes);
    if(!sizeOkay){clearText(response.body);response.status=507;response.body="Control response exceeds the bounded Bluetooth transfer.";}
    const bool saved=transfer.finish(response.status,reinterpret_cast<const uint8_t*>(response.body.c_str()),response.body.length());
    clearText(response.body);
    if(!saved){transfer.clearPayload();replySize=lampBleControlMetadata(reply,capacity);return 4;}
    replySize=transfer.page(0,reply,capacity);return replySize?0:4;
  }
  if(frame[2]==Page){
    if(!transfer.selectPage(frame,size,generation,millis()))return 2;
    replySize=transfer.page(u16(frame+5),reply,capacity);return replySize?0:4;
  }
  return 2;
}
