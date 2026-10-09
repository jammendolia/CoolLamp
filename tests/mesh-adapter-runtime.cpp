#include <assert.h>
#include <algorithm>
#include <deque>
#include <iostream>
#include <string>
#include <vector>
#include "LampMeshCore.h"
#include "LampFirmwareRelay.h"
#include "LampUpdate.h"
#include "LampControlEndpoint.h"
#include "esp_mac.h"
#include "esp_random.h"
#include <mbedtls/base64.h>
using namespace LampMeshWire;
unsigned side=0,calls=0;uint32_t now=1000;bool updater=false,dropReceipts=false,dropResponses=false;
unsigned channelHolds[3]{};uint32_t channelUntil[3]{};
uint16_t replyStatus=200;String replyBody="{\"power\":true}";String lampName="Adapter fixture";
uint8_t addresses[3][6]{{2,0,1,2,3,4},{2,0,1,2,3,5},{2,0,1,2,3,6}},fleet[16]{};
struct Frame {unsigned from=0;std::vector<uint8_t> bytes;};
std::deque<Frame> frames;Frame held;uint32_t holdResponseUntil=0;
uint32_t millis(){return now;}
uint32_t esp_random(){static uint32_t value=17;value=value*1664525+1013904223;return value;}
int esp_read_mac(uint8_t* out,int){memcpy(out,addresses[side],6);return 0;}
bool lampUpdateOwnsResources(){return updater;}
LampControlReply lampControlRequest(uint8_t endpoint,bool mutation,const String& form){assert(side==2);assert(endpoint==LampControlEndpoint::State||endpoint==LampControlEndpoint::Power);assert((endpoint==LampControlEndpoint::Power)==mutation);assert(form=="power=1"||form.empty());++calls;return {replyStatus,replyBody};}
namespace LampFirmwareRelay {bool copyFleetKey(uint8_t* out){memcpy(out,fleet,16);return true;}String fleetId(){return "1122334455667788";}}
namespace LampEspNow {
bool enqueue(const uint8_t* bytes,size_t size,const uint8_t*,bool){assert(size<=250);frames.push_back({side,{bytes,bytes+size}});return true;}
void holdChannel(uint32_t until){++channelHolds[side];channelUntil[side]=until;}
Status status(){Status value;value.active=true;value.channel=11;return value;}
}
namespace Origin {LampControlReply result(const String&,const String&,const String&);}
#define LampMeshAdapter Origin
#include "LampMeshAdapter.cpp"
#undef LampMeshAdapter
namespace Bridge {LampControlReply result(const String&,const String&,const String&);}
#define LampMeshAdapter Bridge
#include "LampMeshAdapter.cpp"
#undef LampMeshAdapter
namespace Target {LampControlReply result(const String&,const String&,const String&);}
#define LampMeshAdapter Target
#include "LampMeshAdapter.cpp"
#undef LampMeshAdapter
const String targetId="060302010002",otherId="070302010002",requestId="0000000000000001";
void deliver(){
 if(holdResponseUntil&&now>=holdResponseUntil&&!held.bytes.empty()){frames.push_back(held);held.bytes.clear();holdResponseUntil=0;}
 while(!frames.empty()){
  Frame frame=frames.front();frames.pop_front();Packet packet;uint8_t body[160];assert(LampMeshCrypto::open(frame.bytes.data(),frame.bytes.size(),fleet,addresses[frame.from],packet,body));
  if(dropReceipts&&packet.kind==Receipt)continue;
  if(dropResponses&&packet.kind==Response)continue;
  if(holdResponseUntil&&packet.kind==Response&&now<holdResponseUntil){if(held.bytes.empty())held=frame;continue;}
  for(unsigned destination=0;destination<3;++destination)if(destination+1==frame.from||frame.from+1==destination){
   side=destination;LampEspNow::Received message;message.length=frame.bytes.size();message.receivedAt=now;memcpy(message.data,frame.bytes.data(),frame.bytes.size());memcpy(message.source,addresses[frame.from],6);
   if(!side)Origin::receive(message);else if(side==1)Bridge::receive(message);else Target::receive(message);
  }
 }
}
void run(unsigned milliseconds){for(unsigned i=0;i<milliseconds;++i){side=0;Origin::service(now,updater);side=1;Bridge::service(now,false);side=2;Target::service(now,false);deliver();++now;}}
void setup(){for(unsigned i=0;i<16;++i)fleet[i]=uint8_t(i+1);side=0;Origin::begin();side=1;Bridge::begin();side=2;Target::begin();run(6000);side=0;assert(Origin::online(addresses[2]));assert(Origin::statusJson().find("\"hops\":2")!=std::string::npos);}
LampControlReply start(const String& id=requestId){side=0;return Origin::request(targetId,id,"31","2","power=1");}
LampControlReply result(unsigned offset=0,const String& id=requestId,const String& target=targetId){side=0;return Origin::result(target,id,String(offset));}
std::string stringField(const String& json,const char* name){const std::string key=std::string("\"")+name+"\":\"";const size_t start=json.find(key);assert(start!=std::string::npos);const size_t first=start+key.size(),last=json.find('"',first);assert(last!=std::string::npos);return json.substr(first,last-first);}
unsigned numberField(const String& json,const char* name){const std::string key=std::string("\"")+name+"\":";const size_t start=json.find(key);assert(start!=std::string::npos);return unsigned(std::stoul(json.substr(start+key.size())));}
std::string decode(const String& json){const auto encoded=stringField(json,"data");std::vector<uint8_t> bytes(257);size_t size=0;assert(!mbedtls_base64_decode(bytes.data(),bytes.size(),&size,reinterpret_cast<const uint8_t*>(encoded.data()),encoded.size()));return {reinterpret_cast<const char*>(bytes.data()),size};}
void complete(){for(unsigned i=0;i<20000;++i){run(1);if(Origin::core.result().state==LampMesh::State::Complete)return;}assert(false);}
int main(int argc,char** argv){
 assert(argc==2);const std::string scenario=argv[1];
 if(scenario=="idle-auth-hold"){
  for(unsigned i=0;i<16;++i)fleet[i]=uint8_t(i+1);
  WiFi.state=0;side=0;Origin::begin();Origin::service(now,false);frames.clear();assert(!channelHolds[0]&&!Origin::core.working());
  LampEspNow::Received message;message.length=4;message.receivedAt=now;memcpy(message.data,"CCA\1",4);const uint8_t unknown[6]{2,9,9,9,9,9};memcpy(message.source,unknown,6);assert(!Origin::receive(message));
  Packet advertisement;memcpy(advertisement.origin,unknown,6);advertisement.boot=123;advertisement.sequence=1;advertisement.kind=Presence;advertisement.payloadSize=advertisement.totalSize=3;const uint8_t metadata[3]{},foreignFleet[16]{99};size_t wireSize=0;assert(LampMeshCrypto::seal(advertisement,metadata,foreignFleet,unknown,3,0,message.data,wireSize));message.length=wireSize;assert(Origin::receive(message));++now;Origin::service(now,false);frames.clear();assert(!channelHolds[0]&&!Origin::online(unknown));
  side=1;Bridge::begin();side=2;Target::begin();run(6000);side=0;assert(Origin::online(addresses[1])&&Origin::online(addresses[2]));assert(!Origin::core.working()&&Origin::core.result().state==LampMesh::State::Idle);
  const unsigned before=channelHolds[0];run(2000);assert(channelHolds[0]>before+1000&&channelUntil[0]>now);assert(Origin::core.result().state==LampMesh::State::Idle&&!calls);
  // Stop all other radios. Own announcements alone cannot refresh a fleet
  // neighbor's presence or keep the last authenticated channel anchored.
  for(unsigned i=0;i<18000;++i){side=0;Origin::service(now,false);frames.clear();++now;}
  assert(!Origin::online(addresses[1])&&!Origin::online(addresses[2])&&channelUntil[0]<now&&!Origin::working()&&Origin::enabled());
  const unsigned expired=channelHolds[0];message.receivedAt=now;side=0;assert(Origin::receive(message));for(unsigned i=0;i<2000;++i){Origin::service(now,false);frames.clear();++now;}assert(channelHolds[0]==expired);
  std::cout<<"PASS actual mesh adapter idle-auth-hold unknown/off-fleet ignored, idle proof extends hold, expiry releases seeking\n";return 0;
 }
 setup();
 if(scenario=="http400"){
  replyStatus=400;replyBody="{\"error\":\"Use an effect supported by this lamp.\"}";assert(start().status==202);complete();auto value=result();assert(value.status==200&&stringField(value.body,"status")=="ok"&&numberField(value.body,"httpStatus")==400);assert(decode(value.body)==replyBody&&calls==1);assert(value.body.find("\"uncertain\":false")!=std::string::npos);
 }
 else if(scenario=="pagination"){
  replyBody.clear();for(unsigned i=0;i<8192;++i)replyBody+=char('a'+i%26);assert(start().status==202);complete();std::string all;
  assert(start("0000000000000002").status==409);
  for(unsigned at=0;at<8192;at+=256){const auto value=result(at);assert(value.status==200&&numberField(value.body,"total")==8192&&numberField(value.body,"offset")==at&&stringField(value.body,"status")=="ok");all+=decode(value.body);if(at<7936)assert(start("0000000000000002").status==409);}
  assert(all==replyBody&&result(8193).status==400);replyBody="ok";assert(start("0000000000000002").status==202);complete();assert(decode(result(0,"0000000000000002").body)=="ok"&&calls==2);
 }
 else if(scenario=="retention"){
  replyBody="delayed";const uint32_t started=now;holdResponseUntil=started+14000;assert(start().status==202);complete();assert(now-started>=14000);run(2500);assert(start("0000000000000002").status==409);assert(decode(result().body)=="delayed");assert(start("0000000000000002").status==202);
 }
 else if(scenario=="no-route"){
  side=0;const auto before=frames.size();auto value=Origin::request(otherId,requestId,"31","2","power=1");assert(value.status==200&&stringField(value.body,"status")=="no-route"&&value.body.find("\"executed\":false")!=std::string::npos&&frames.size()==before&&!calls);
 }
 else if(scenario=="same-id-content"){
  assert(start().status==202);side=0;assert(Origin::request(targetId,requestId,"31","2","power=0").status==409);assert(Origin::request(otherId,requestId,"31","2","power=1").status==409);complete();assert(start().status==200);assert(calls==1);
 }
 else if(scenario=="wrong-result"){
  assert(start().status==202);assert(result(0,"0000000000000002").status==404);assert(result(0,requestId,otherId).status==404);complete();assert(result(0,"0000000000000002").status==404);
 }
 else if(scenario=="lost-receipts"){
  dropReceipts=dropResponses=true;assert(start().status==202);run(17000);assert(calls==1);const auto value=result();assert(value.status==200&&stringField(value.body,"status")=="rejected"&&value.body.find("\"uncertain\":true")!=std::string::npos&&value.body.find("\"executed\":false")!=std::string::npos&&numberField(value.body,"total")==0);assert(!Origin::core.result().body);
 }
 else if(scenario=="updater-pause"){
  replyBody.clear();for(unsigned i=0;i<8192;++i)replyBody+='x';assert(start().status==202);complete();assert(Origin::core.result().body);updater=true;run(1);assert(!Origin::core.result().body&&Origin::core.result().length==0);const auto value=result();assert(value.body.find("\"uncertain\":true")!=std::string::npos&&value.body.find("\"executed\":true")!=std::string::npos&&numberField(value.body,"httpStatus")==503);assert(start("0000000000000002").status==409);
 }
 else if(scenario=="direct-only"){
  side=0;for(unsigned endpoint:{20,22,23,24,27,28,29,30})assert(Origin::request(targetId,requestId,String(endpoint),"2","").status==400);assert(!calls);
 }
 else if(scenario=="remote-direct-only"){
  const uint8_t payload[2]{LampControlEndpoint::FirmwareInstall,2};assert(Origin::core.startRequest(addresses[2],1,payload,sizeof(payload),now));complete();const auto& value=Origin::core.result();assert(value.status==403&&std::string(reinterpret_cast<const char*>(value.body),value.length).find("direct Bluetooth")!=std::string::npos&&!calls);
 }
 else assert(false);
 std::cout<<"PASS actual mesh adapter "<<scenario<<" target dispatches="<<calls<<"\n";
}
