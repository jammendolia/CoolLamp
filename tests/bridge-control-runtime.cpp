#include <assert.h>
#include <atomic>
#include <deque>
#include <iostream>
#include <string>
#include <thread>
#include <vector>
#include "bridge/BridgeControl.h"
#include "LampSyncRadioCrypto.h"
#include <mbedtls/base64.h>

using namespace LampMeshWire;
uint32_t now=1000;
uint32_t millis(){return now;}
namespace {
uint8_t addresses[3][6]{{2,0,1,2,3,4},{2,0,1,2,3,5},{2,0,1,2,3,6}};
uint8_t fleet[16]{};
LampMesh::Core relay,target;
struct Frame{unsigned from;std::vector<uint8_t> data;};
std::deque<Frame> frames;
bool credentialAvailable=true,dropReceipts=false,dropResponses=false;
bool outgoingAllowed=true;
unsigned calls=0,keyCalls=0,localReads=0;
unsigned channelHolds=0;
uint32_t channelUntil=0;
uint16_t targetStatus=200;
std::string targetBody="{\"power\":true}";
uint64_t targetBoot=10003;
bool trust(void*,const uint8_t* mac){return LampMeshWire::mac(mac);}
bool allowOutgoing(void*,const uint8_t*){return outgoingAllowed;}
bool send(void* context,const uint8_t* bytes,size_t size){frames.push_back({unsigned(reinterpret_cast<uintptr_t>(context)),{bytes,bytes+size}});return true;}
void holdChannel(void*,uint32_t until){++channelHolds;channelUntil=until;}
bool copyKey(void*,uint8_t* out){++keyCalls;if(!credentialAvailable)return false;memcpy(out,fleet,16);return true;}
String fleetId(void*){return "1122334455667788";}
uint16_t execute(void*,const uint8_t*,uint64_t,const uint8_t* bytes,size_t size,uint8_t* out,size_t capacity,size_t& used){
  assert(size>=2&&size<=RequestLimit);assert(bytes[0]==31||bytes[0]==1||bytes[0]==40||bytes[0]==44||bytes[0]==45);
  ++calls;used=targetBody.size();assert(used<=capacity);memcpy(out,targetBody.data(),used);return targetStatus;
}
uint16_t localRead(void*,uint8_t endpoint,uint8_t* out,size_t capacity,size_t& used){
  assert(endpoint==40);++localReads;const std::string body="{\"role\":\"bridge\",\"custom\":true}";
  used=body.size();assert(used<=capacity);memcpy(out,body.data(),used);return 200;
}
void beginTarget(const uint8_t* credential=fleet){
  LampMesh::Hooks h;h.context=reinterpret_cast<void*>(uintptr_t(2));h.trusted=trust;h.send=send;h.execute=execute;
  assert(target.begin(addresses[2],credential,targetBoot,h));target.setAnnouncement("Kitchen","1.15.0",false);
}
void setup(bool localHook=false,const uint8_t* targetCredential=fleet){
  for(unsigned i=0;i<16;++i)fleet[i]=uint8_t(i+1);
  BridgeControl::Hooks h;h.copyFleetKey=copyKey;h.fleetId=fleetId;h.send=send;h.holdChannel=holdChannel;h.localRead=localHook?localRead:nullptr;
  h.allowRequest=allowOutgoing;
  assert(BridgeControl::begin(addresses[0],10001,"Hall bridge","0.1.0",h));
  LampMesh::Hooks middle;middle.context=reinterpret_cast<void*>(uintptr_t(1));middle.trusted=trust;middle.send=send;
  assert(relay.begin(addresses[1],fleet,10002,middle));relay.setAnnouncement("Relay","1.15.0",false);
  beginTarget(targetCredential);
}
void deliver(){
  while(!frames.empty()){
    Frame f=frames.front();frames.pop_front();Packet p;assert(decode(f.data.data(),f.data.size(),p));
    if(dropReceipts&&p.kind==Receipt)continue;
    if(dropResponses&&p.kind==Response)continue;
    // Bridge and Kitchen cannot hear each other; actual immutable Core forwards.
    for(unsigned destination=0;destination<3;++destination){
      if(destination+1!=f.from&&f.from+1!=destination)continue;
      if(destination==0)BridgeControl::enqueueReceive(addresses[f.from],f.data.data(),f.data.size(),now);
      else (destination==1?relay:target).receive(addresses[f.from],f.data.data(),f.data.size(),now);
    }
  }
}
void run(unsigned duration,bool blocked=false,bool wifiConnected=true){
  for(unsigned i=0;i<duration;++i){BridgeControl::service(now,wifiConnected,blocked);relay.service(now);target.service(now);deliver();++now;}
}
String id(unsigned index){char out[13]{};assert(LampSyncRadioCrypto::identityFromMac(addresses[index],out));return out;}
const String requestId="0000000000000001",boot="0000000000002713";
LampControlReply start(const String& request=requestId,const String& form="power=1",const String& expected=String()){
  return BridgeControl::request(id(2),request,"31","2",form,expected);
}
LampControlReply result(unsigned offset=0,const String& request=requestId,const String& expected=String()){
  return BridgeControl::result(id(2),request,String(offset),expected);
}
std::string field(const String& json,const char* name){
  const std::string prefix=std::string("\"")+name+"\":\"";const size_t begin=json.find(prefix);assert(begin!=std::string::npos);
  const size_t start=begin+prefix.size(),end=json.find('"',start);assert(end!=std::string::npos);return json.substr(start,end-start);
}
unsigned numeric(const String& json,const char* name){
  const std::string prefix=std::string("\"")+name+"\":";const size_t begin=json.find(prefix);assert(begin!=std::string::npos);return unsigned(std::stoul(json.substr(begin+prefix.size())));
}
std::string decodePage(const String& json){
  const auto encoded=field(json,"data");uint8_t bytes[257]{};size_t used=0;
  assert(!mbedtls_base64_decode(bytes,sizeof(bytes),&used,reinterpret_cast<const uint8_t*>(encoded.data()),encoded.size()));return {reinterpret_cast<const char*>(bytes),used};
}
void complete(const String& request=requestId){
  for(unsigned i=0;i<LampMesh::TransactionTimeout;++i){run(1);const auto value=result(0,request);if(value.status==200&&field(value.body,"status")=="ok")return;}
  assert(false);
}
void warm(){run(6000);assert(BridgeControl::online(addresses[2]));assert(BridgeControl::statusJson().find("\"hops\":2")!=std::string::npos);}
}

int main(int argc,char** argv){
  assert(argc==2);const std::string scenario=argv[1];
  if(scenario=="missing-credential"){
    credentialAvailable=false;setup();run(2500);assert(!BridgeControl::enabled()&&keyCalls==3&&!calls);
    assert(start().status==409);credentialAvailable=true;run(5000);assert(BridgeControl::enabled()&&BridgeControl::online(addresses[2]));
  }else if(scenario=="wrong-fleet"){
    uint8_t otherFleet[16]{99};setup(false,otherFleet);run(7000);assert(!BridgeControl::online(addresses[2]));
    const auto value=start();assert(value.status==200&&field(value.body,"status")=="no-route"&&!calls);
  }else if(scenario=="queue-bound-stale"){
    setup();BridgeControl::service(now,true);const uint8_t invalid[4]{'C','L','M',1};
    for(unsigned i=0;i<BridgeControl::ReceiveCapacity;++i)assert(BridgeControl::enqueueReceive(addresses[2],invalid,4,now));
    assert(!BridgeControl::enqueueReceive(addresses[2],invalid,4,now)&&BridgeControl::receiveDropped()==1);
    assert(!BridgeControl::enqueueReceive(addresses[2],invalid,251,now));run(1);assert(BridgeControl::enqueueReceive(addresses[2],invalid,4,now));
    BridgeControl::service(now,true);frames.clear();relay.stop();target.stop();
    Packet presence;memcpy(presence.origin,addresses[2],6);presence.boot=10003;presence.sequence=1;presence.kind=Presence;presence.totalSize=presence.payloadSize=3;
    const uint8_t plain[3]{};uint8_t wire[WireLimit]{};size_t size=0;assert(LampMeshCrypto::seal(presence,plain,fleet,addresses[2],3,0,wire,size));
    assert(BridgeControl::enqueueReceive(addresses[2],wire,size,now-BridgeControl::ReceiveMaxAge));BridgeControl::service(now,true);assert(BridgeControl::statusJson().find("\"peers\":[]")!=std::string::npos);
    ++presence.sequence;assert(LampMeshCrypto::seal(presence,plain,fleet,addresses[2],3,0,wire,size));wire[size-1]^=1;
    assert(BridgeControl::enqueueReceive(addresses[2],wire,size,now));BridgeControl::service(now,true);assert(BridgeControl::statusJson().find("\"peers\":[]")!=std::string::npos);
  }else if(scenario=="concurrent-copy"){
    setup();BridgeControl::service(now,true);frames.clear();relay.stop();target.stop();
    std::atomic<bool> done{false};std::atomic<unsigned> accepted{0};const uint8_t invalid[4]{'C','L','M',1};
    std::thread producer([&]{for(unsigned i=0;i<100000;++i)if(BridgeControl::enqueueReceive(addresses[2],invalid,4,1000))++accepted;done.store(true,std::memory_order_release);});
    while(!done.load(std::memory_order_acquire)){BridgeControl::service(now,true);++now;}producer.join();BridgeControl::service(now,true);
    assert(accepted+BridgeControl::receiveDropped()==100000&&!calls);
  }else if(scenario=="channel-hold-idle-expiry"){
    setup();run(6000,false,false);assert(BridgeControl::online(addresses[2])&&channelHolds>0);
    run(1000,false,false);assert(!BridgeControl::working()&&!calls&&uint32_t(channelUntil-now)<=1500);
    relay.stop();target.stop();run(LampMesh::PeerTimeout+2000,false,false);
    assert(!BridgeControl::online(addresses[2])&&int32_t(now-channelUntil)>0);
    const unsigned expired=channelHolds;run(1000,false,false);assert(channelHolds==expired);
    assert(start().status==200);run(20,false,false);assert(channelHolds==expired&&!calls);
  }else if(scenario=="channel-hold-block-reboot"){
    setup();warm();assert(channelHolds>0);const unsigned before=channelHolds;
    run(2000,true,false);assert(channelHolds==before&&int32_t(now-channelUntil)>0);
    run(1000,false,false);assert(channelHolds>before);
    BridgeControl::stop();frames.clear();relay.stop();target.stop();const unsigned stopped=channelHolds;
    BridgeControl::Hooks h;h.copyFleetKey=copyKey;h.fleetId=fleetId;h.send=send;h.holdChannel=holdChannel;
    assert(BridgeControl::begin(addresses[0],10004,"Rebooted bridge","0.1.0",h));run(3000,false,false);
    assert(channelHolds==stopped&&!BridgeControl::online(addresses[2])&&!calls);
  }else if(scenario=="channel-hold-rollover-work"){
    setup();warm();relay.stop();target.stop();frames.clear();now=UINT32_MAX-500;
    // Refresh the already challenged target session at the rollover boundary.
    // No live test radio will emit this manually reserved high sequence later.
    Packet presence;memcpy(presence.origin,addresses[2],6);presence.boot=10003;presence.sequence=1000;presence.kind=Presence;presence.totalSize=presence.payloadSize=3;
    const uint8_t plain[3]{};uint8_t wire[WireLimit]{};size_t size=0;
    assert(LampMeshCrypto::seal(presence,plain,fleet,addresses[2],3,0,wire,size));assert(BridgeControl::enqueueReceive(addresses[2],wire,size,now));
    BridgeControl::service(now,false);assert(BridgeControl::online(addresses[2])&&channelUntil<now);
    assert(start().status==202);run(3000,false,false);
    assert(channelHolds>0&&int32_t(channelUntil-now)>0&&int32_t(channelUntil-now)<=1500);
    run(LampMesh::PeerTimeout+2000,false,false);
    const unsigned expired=channelHolds;run(1000,false,false);assert(channelHolds==expired&&int32_t(now-channelUntil)>0&&!calls);
  }else if(scenario=="channel-hold-no-false-peer"){
    setup();BridgeControl::service(now,false);frames.clear();relay.stop();target.stop();assert(channelHolds==0);
    Packet presence;memcpy(presence.origin,addresses[2],6);presence.boot=10003;presence.sequence=1;presence.kind=Presence;presence.totalSize=presence.payloadSize=3;
    const uint8_t plain[3]{},foreign[16]{99};uint8_t wire[WireLimit]{};size_t size=0;
    assert(LampMeshCrypto::seal(presence,plain,foreign,addresses[2],3,0,wire,size));assert(BridgeControl::enqueueReceive(addresses[2],wire,size,now));
    run(1000,false,false);assert(channelHolds==0&&!BridgeControl::online(addresses[2]));
    ++presence.sequence;assert(LampMeshCrypto::seal(presence,plain,fleet,addresses[2],3,0,wire,size));wire[size-1]^=1;
    assert(BridgeControl::enqueueReceive(addresses[2],wire,size,now));run(1000,false,false);assert(channelHolds==0);
    ++presence.sequence;assert(LampMeshCrypto::seal(presence,plain,fleet,addresses[2],3,0,wire,size));
    assert(BridgeControl::enqueueReceive(addresses[2],wire,size,now-BridgeControl::ReceiveMaxAge));run(1000,false,false);assert(channelHolds==0);
  }else{
    setup(scenario=="local-descriptor");warm();
    if(scenario=="excluded-origin-request"){
      outgoingAllowed=false;assert(start().status==403&&!calls);
      assert(BridgeControl::online(addresses[2])&&BridgeControl::statusJson().find("Kitchen")!=std::string::npos);
      outgoingAllowed=true;assert(start().status==202);complete();assert(calls==1);
      outgoingAllowed=false;assert(start().status==200&&calls==1);assert(result().status==200);assert(start("0000000000000002").status==403&&calls==1);
    }else if(scenario=="excluded-reconciliation"){
      assert(start().status==202);complete();assert(calls==1);outgoingAllowed=false;
      assert(result().status==200);run(BridgeControl::ResultRetention+1);
      unsigned request=2;
      for(const auto endpoint:{LampControlEndpoint::State,LampControlEndpoint::Descriptor,LampControlEndpoint::Revision,LampControlEndpoint::Receipt}){
        char value[17]{};snprintf(value,sizeof(value),"%016x",request++);const String query=value;
        assert(BridgeControl::request(id(2),query,String(unsigned(endpoint)),endpoint==LampControlEndpoint::Receipt?"2":"1",endpoint==LampControlEndpoint::Receipt?String("target=")+id(2)+"&bootSession=0000000000002713&commandId=0000000000000001":String(),boot).status==202);
        complete(query);
      }
      assert(calls==5&&start("0000000000000007").status==403);
      assert(BridgeControl::request(id(2),"0000000000000008","42","2","power=0",boot).status==403&&calls==5);
      assert(BridgeControl::request(id(2),"0000000000000009","40","1","","0000000000002712").status==409&&calls==5);
    }else if(scenario=="read-only-diagnostics"){
      const auto idle=BridgeControl::diagnosticJson();assert(idle.length()<BridgeControl::DiagnosticCapacity&&idle.find("\"commandPresent\":false")!=std::string::npos);
      const auto beforeKey=keyCalls,beforeCalls=calls,beforeHolds=channelHolds;const auto beforeFrames=frames.size();
      for(unsigned i=0;i<20;++i)assert(BridgeControl::diagnosticJson()==idle);
      assert(keyCalls==beforeKey&&calls==beforeCalls&&channelHolds==beforeHolds&&frames.size()==beforeFrames);
      targetBody="private fixture body and password SSID token fleet key";
      assert(start(requestId,"power=1",boot).status==202);
      auto pending=BridgeControl::diagnosticJson();assert(pending.find("\"state\":\"pending\"")!=std::string::npos&&field(pending,"target")==id(2)&&field(pending,"requestId")==requestId&&field(pending,"expectedTargetBoot")==boot&&numeric(pending,"endpoint")==31&&numeric(pending,"method")==2&&numeric(pending,"requestsSubmitted")==1);
      complete();const auto done=BridgeControl::diagnosticJson();assert(done.find("\"state\":\"complete\"")!=std::string::npos&&numeric(done,"httpStatus")==200&&numeric(done,"total")==targetBody.size()&&done.find("private fixture body")==std::string::npos&&done.find("power=1")==std::string::npos&&done.find("Kitchen")==std::string::npos);
      assert(done.find("\"fragmentProgressAvailable\":false")!=std::string::npos&&done.length()<BridgeControl::DiagnosticCapacity);
      dropReceipts=dropResponses=true;assert(start("0000000000000002","power=0",boot).status==202);run(LampMesh::TransactionTimeout+1000);
      const auto failed=BridgeControl::diagnosticJson();assert(field(failed,"state")=="failed"&&field(failed,"failure")=="deadline"&&numeric(failed,"requestsSubmitted")==2&&failed.find("power=0")==std::string::npos);
    }else if(scenario=="result-query-diagnostics"){
      targetBody=std::string(5529,'x');assert(start(requestId,"power=1",boot).status==202);
      auto snapshot=BridgeControl::diagnosticJson();assert(numeric(snapshot,"calls")==0&&snapshot.find("\"offset\":null")!=std::string::npos);
      assert(result(0,requestId,boot).status==200);snapshot=BridgeControl::diagnosticJson();assert(numeric(snapshot,"calls")==1&&field(snapshot,"phase")=="pending"&&numeric(snapshot,"status")==200&&numeric(snapshot,"offset")==0&&numeric(snapshot,"atMs")==0);
      run(6000);snapshot=BridgeControl::diagnosticJson();assert(field(snapshot,"state")=="complete"&&snapshot.find("\"consumed\":false")!=std::string::npos&&numeric(snapshot,"calls")==1&&numeric(snapshot,"elapsedMs")==6000);
      assert(BridgeControl::result(id(2),requestId,"invalid",boot).status==400);snapshot=BridgeControl::diagnosticJson();assert(field(snapshot,"phase")=="invalid"&&snapshot.find("\"offset\":null")!=std::string::npos);
      assert(result(0,"0000000000000002",boot).status==404&&field(BridgeControl::diagnosticJson(),"phase")=="missing");
      assert(result(0,requestId,"0000000000002712").status==409&&field(BridgeControl::diagnosticJson(),"phase")=="session");
      assert(result(6000,requestId,boot).status==400&&field(BridgeControl::diagnosticJson(),"phase")=="offset");
      std::string reconstructed;for(unsigned offset=0;offset<targetBody.size();offset+=BridgeControl::ResultPageSize){auto page=result(offset,requestId,boot);assert(page.status==200);reconstructed+=decodePage(page.body);snapshot=BridgeControl::diagnosticJson();assert(numeric(snapshot,"offset")==offset&&numeric(snapshot,"status")==200&&field(snapshot,"phase")=="ok"&&numeric(snapshot,"atMs")==6000&&snapshot.length()<BridgeControl::DiagnosticCapacity);}
      assert(reconstructed==targetBody&&numeric(snapshot,"calls")==27&&snapshot.find("\"consumed\":true")!=std::string::npos&&snapshot.find(targetBody)==std::string::npos);
      std::cout<<"DIAGNOSTIC_BYTES "<<snapshot.length()<<"\n";
      // Accepted new commands clear old query observations. Unsigned elapsed
      // arithmetic stays valid when millis wraps, even with query time zero.
      assert(start("0000000000000002","power=0",boot).status==202);snapshot=BridgeControl::diagnosticJson();assert(numeric(snapshot,"calls")==0&&field(snapshot,"phase")=="none");
      run(6000);for(unsigned offset=0;offset<targetBody.size();offset+=BridgeControl::ResultPageSize)assert(result(offset,"0000000000000002",boot).status==200);
      relay.stop();target.stop();frames.clear();now=UINT32_MAX-500;
      Packet presence;memcpy(presence.origin,addresses[2],6);presence.boot=10003;presence.sequence=1000;presence.kind=Presence;presence.totalSize=presence.payloadSize=3;
      const uint8_t plain[3]{};uint8_t wire[WireLimit]{};size_t size=0;assert(LampMeshCrypto::seal(presence,plain,fleet,addresses[2],3,0,wire,size));assert(BridgeControl::enqueueReceive(addresses[2],wire,size,now));BridgeControl::service(now,true);
      assert(start("0000000000000003","power=1",boot).status==202);run(700);assert(result(0,"0000000000000003",boot).status==200);snapshot=BridgeControl::diagnosticJson();assert(numeric(snapshot,"elapsedMs")==700&&numeric(snapshot,"atMs")==700&&field(snapshot,"phase")=="pending");
    }else if(scenario=="honest-inventory"){
      const auto state=BridgeControl::stateJson();assert(field(state,"deviceId")==id(0)&&field(state,"role")=="bridge");assert(state.find("effects")==std::string::npos&&state.find("brightness")==std::string::npos&&state.find("leds")==std::string::npos);
      const auto inventory=BridgeControl::statusJson();assert(field(inventory,"fleetId")=="1122334455667788"&&numeric(inventory,"requestBytes")==1024&&numeric(inventory,"responseBytes")==8192);assert(inventory.find("Kitchen")!=std::string::npos&&inventory.find("\"boot\":\"0000000000002713\"")!=std::string::npos);
      assert(start("NOT-A-REQUEST-ID").status==400);assert(BridgeControl::request(id(0),requestId,"31","2","power=1").status==400);
      for(const char* endpoint:{"19","20","22","24","48","49","50"})assert(BridgeControl::request(id(2),requestId,endpoint,"2","").status>=400);
      assert(BridgeControl::request(id(2),requestId,"31","2",String(std::string(1023,'x'))).status==400&&!calls);
    }else if(scenario=="forward-http400"){
      targetStatus=400;targetBody="Unsupported lamp setting.";assert(start().status==202);complete();const auto value=result();
      assert(numeric(value.body,"httpStatus")==400&&decodePage(value.body)==targetBody&&calls==1&&value.body.find("\"uncertain\":false")!=std::string::npos);
      assert(start().status==200&&calls==1);assert(start(requestId,"power=0").status==409);assert(BridgeControl::request(id(1),requestId,"31","2","power=1").status==409);
      assert(result(0,"0000000000000002").status==404&&BridgeControl::result(id(1),requestId,"0").status==404&&result(8193).status==400);
    }else if(scenario=="pages-retention"){
      targetBody.clear();for(unsigned i=0;i<ResponseLimit;++i)targetBody+=char('a'+i%26);
      assert(BridgeControl::policyChangeAllowed());assert(start().status==202&&!BridgeControl::policyChangeAllowed());complete();assert(!BridgeControl::policyChangeAllowed());assert(start("0000000000000002").status==409);std::string all;
      for(unsigned at=0;at<ResponseLimit;at+=BridgeControl::ResultPageSize){const auto value=result(at);assert(numeric(value.body,"total")==ResponseLimit&&numeric(value.body,"offset")==at);all+=decodePage(value.body);if(at<ResponseLimit-BridgeControl::ResultPageSize)assert(start("0000000000000002").status==409);}
      assert(all==targetBody&&BridgeControl::policyChangeAllowed());assert(start("0000000000000002").status==202);complete("0000000000000002");assert(calls==2);
    }else if(scenario=="retention-deadline"){
      assert(start().status==202);run(2000);assert(calls==1&&start("0000000000000002").status==409);run(14000);assert(start("0000000000000002").status==202);complete("0000000000000002");assert(calls==2);
    }else if(scenario=="target-boot"){
      assert(start(requestId,"power=1","0000000000002712").status==409&&!calls);
      assert(start(requestId,"power=1",boot).status==202);assert(result(0,requestId,"0000000000002712").status==409);complete();assert(field(result().body,"targetBoot")==boot);
      assert(start(requestId,"power=1","0000000000002712").status==409&&calls==1);
      ++targetBoot;beginTarget();run(6000);assert(start("0000000000000002","power=1",boot).status==409&&calls==1);
    }else if(scenario=="lost-replies"){
      dropReceipts=dropResponses=true;assert(start().status==202);run(LampMesh::TransactionTimeout+1000);const auto value=result();
      assert(calls==1&&field(value.body,"status")=="rejected"&&value.body.find("\"executed\":false")!=std::string::npos&&value.body.find("\"uncertain\":true")!=std::string::npos);assert(start().status==200&&calls==1);
    }else if(scenario=="blocked"){
      assert(start().status==202);run(1000);assert(calls==1);run(1,true);assert(!BridgeControl::working()&&start("0000000000000002").status==409);
      const auto value=result();assert(value.status==200&&value.body.find("\"uncertain\":true")!=std::string::npos);run(1000);assert(start("0000000000000002").status==202);complete("0000000000000002");assert(calls==2);
    }else if(scenario=="local-descriptor"||scenario=="local-mutation-denied"){
      uint8_t command[2]{scenario=="local-descriptor"?uint8_t(40):uint8_t(31),scenario=="local-descriptor"?uint8_t(1):uint8_t(2)};
      assert(target.startRequest(addresses[0],51,command,sizeof(command),now));run(3000);const auto& value=target.result();
      assert(value.state==LampMesh::State::Complete&&value.executed&&value.status==(scenario=="local-descriptor"?200:403)&&!calls);
      assert(localReads==(scenario=="local-descriptor"?1u:0u));
    }else if(scenario=="peer-expiry"){
      relay.stop();target.stop();run(LampMesh::PeerTimeout+1000);assert(!BridgeControl::online(addresses[2]));const auto value=start();assert(value.status==200&&field(value.body,"status")=="no-route"&&!calls);
    }else assert(false);
  }
  BridgeControl::stop();std::cout<<"PASS bridge control "<<scenario<<"\n";
}
