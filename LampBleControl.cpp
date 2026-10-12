#include "LampBleControl.h"
#include "LampControlEndpoint.h"
#include "LampUpdate.h"
#include "LampVersion.h"
#include "LampFirmwareRelay.h"
#include "LampControlResourcePolicy.h"
#include <utility>

namespace {
// Construct before Transfer so its destructor releases this owner first.
String retainedResponse;
LampBleControlWire::Transfer transfer;
constexpr char metadata[]="{\"version\":1,\"capabilities\":[\"control\",\"groups\",\"espnow\",\"firmware-relay\",\"mesh-control\",\"mesh-onboarding\",\"descriptor-v2\",\"effect-schema-v2\",\"partial-state-v1\",\"appearance-v2\",\"receipts-v1\"],\"maxRequest\":1024,\"maxResponse\":8192,\"pageBytes\":480,\"maxEndpoint\":52,\"firmware\":\"" LAMP_FIRMWARE_VERSION "\"}";
static_assert(sizeof(metadata)-1<=LampBleControlWire::PageBytes,"BLE capabilities must fit one metadata page");
void clearText(String& text){
  if(text.length())LampBleControlWire::zero(const_cast<char*>(text.c_str()),text.length());
  // Core 3.3.11's empty String move can retain an allocated buffer. Release the
  // wiped form before retaining the response, and release oversized replies
  // before allocating their error text on the constrained C3 heap.
  text=static_cast<const char*>(nullptr);
}
void releaseResponse(void* owner,size_t){clearText(*static_cast<String*>(owner));}
bool retainResponse(uint16_t status,String& body){
  const size_t size=body.length();
  clearText(retainedResponse);
  // Tiny replies use a supported copy followed by a wipe of the source. This
  // avoids private bytes remaining in a moved-from inline String buffer. Large
  // replies move their existing allocation; no second full response is made.
  if(size<=15)retainedResponse=body;
  else retainedResponse=std::move(body);
  const bool complete=retainedResponse.length()==size;
  clearText(body);
  if(!complete){clearText(retainedResponse);return false;}
  if(transfer.finishOwned(status,reinterpret_cast<const uint8_t*>(retainedResponse.c_str()),size,&retainedResponse,releaseResponse))return true;
  clearText(retainedResponse);return false;
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
    const bool read=LampControlResourcePolicy::readEndpoint(transfer.endpointId(),transfer.mutation());
    if(!(read?LampControlResourcePolicy::readReady(ESP.getFreeHeap(),ESP.getMaxAllocHeap(),transfer.bodySize(),true):
              LampControlResourcePolicy::replyReady(ESP.getFreeHeap(),ESP.getMaxAllocHeap()))){
      constexpr char denied[]="Control resources unavailable. No command executed.";
      String body=denied;
      const bool saved=body.length()==sizeof(denied)-1&&retainResponse(503,body);
      clearText(body);
      if(!saved){transfer.clearPayload();replySize=lampBleControlMetadata(reply,capacity);return 4;}
      replySize=transfer.page(0,reply,capacity);return replySize?0:4;
    }
    String form;
    if(!form.reserve(transfer.bodySize())||!form.concat(reinterpret_cast<const char*>(transfer.body()),transfer.bodySize())){
      clearText(form);transfer.clearPayload();replySize=lampBleControlMetadata(reply,capacity);return 4;
    }
    LampControlReply response=transfer.endpointId()==LampControlEndpoint::FirmwareFleet?LampFirmwareRelay::control(transfer.mutation(),form):lampControlRequest(transfer.endpointId(),transfer.mutation(),form,true);
    clearText(form);
    const bool sizeOkay=response.body.length()<=MaxResponse&&(!updating||response.body.length()<=PageBytes);
    if(!sizeOkay){
      constexpr char exceeded[]="Control response exceeds the bounded Bluetooth transfer.";
      clearText(response.body);response.status=507;response.body=exceeded;
      if(response.body.length()!=sizeof(exceeded)-1){clearText(response.body);transfer.clearPayload();replySize=lampBleControlMetadata(reply,capacity);return 4;}
    }
    const bool saved=retainResponse(response.status,response.body);
    if(!saved){transfer.clearPayload();replySize=lampBleControlMetadata(reply,capacity);return 4;}
    replySize=transfer.page(0,reply,capacity);return replySize?0:4;
  }
  if(frame[2]==Page){
    if(!transfer.selectPage(frame,size,generation,millis()))return 2;
    replySize=transfer.page(u16(frame+5),reply,capacity);return replySize?0:4;
  }
  return 2;
}
