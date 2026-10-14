#include "BridgeControl.h"
#include "LampSyncRadioCrypto.h"
#include <atomic>
#include <algorithm>
#include <cstdio>
#include <mbedtls/base64.h>
#include <mbedtls/sha256.h>

namespace BridgeControl {
namespace {
struct Received {
  uint8_t source[6]{},wire[LampMeshWire::WireLimit]{};
  uint16_t size=0;
  uint32_t at=0;
};
LampMesh::Core core;
Hooks hooks;
Received receiveQueue[ReceiveCapacity];
std::atomic<uint32_t> readIndex{0},writeIndex{0},dropped{0};
std::atomic<bool> accepting{false};
uint8_t self[6]{},fingerprint[32]{};
char deviceName[49]{},firmwareVersion[25]{};
uint64_t selfBoot=0;
uint32_t completedAt=0,nextKeyAttempt=0;
bool configured=false,started=false,paused=true,consumed=false,terminalObserved=false;
uint8_t commandEndpoint=0,commandMethod=0;
uint64_t commandExpectedBoot=0;
uint32_t commandAt=0,resultQueries=0,resultQueryAt=0;
uint16_t resultQueryStatus=0,resultQueryOffset=0;
bool resultQueryOffsetValid=false;
const char* resultQueryPhase="none";
uint32_t receivedProcessed=0,receivedAccepted=0,receivedRejected=0,receivedStale=0,receivedBlocked=0,transmitAccepted=0,transmitFailed=0,requestsSubmitted=0;

void erase(void* memory,size_t size){volatile uint8_t* p=static_cast<volatile uint8_t*>(memory);while(size--)*p++=0;}
bool due(uint32_t now,uint32_t at){return int32_t(now-at)>=0;}
String identity(const uint8_t* mac){char out[13]{};return LampSyncRadioCrypto::identityFromMac(mac,out)?String(out):String();}
String hex(uint64_t value){char out[17]{};snprintf(out,sizeof(out),"%08lx%08lx",static_cast<unsigned long>(value>>32),static_cast<unsigned long>(uint32_t(value)));return String(out);}
bool transaction(const String& value,uint64_t& result){
  if(value.length()!=16)return false;
  result=0;
  for(unsigned i=0;i<16;++i){const char c=value[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;result=result<<4|uint8_t(c<='9'?c-'0':c-'a'+10);}
  return result!=0;
}
bool number(const String& value,uint32_t maximum,uint32_t& result){
  if(value.isEmpty()||value.length()>5)return false;
  result=0;
  for(unsigned i=0;i<value.length();++i){if(value[i]<'0'||value[i]>'9')return false;result=result*10+uint8_t(value[i]-'0');if(result>maximum)return false;}
  return true;
}
String quote(const char* value){
  String out="\"";
  for(const uint8_t* p=reinterpret_cast<const uint8_t*>(value?value:"");*p;++p){
    if(*p=='"'||*p=='\\')out+='\\';
    if(*p<32){char escaped[7]{};snprintf(escaped,sizeof(escaped),"\\u%04x",*p);out+=escaped;}else out+=char(*p);
  }
  return out+'"';
}
String fleetId(){return hooks.fleetId?hooks.fleetId(hooks.context):String();}
bool trusted(void*,const uint8_t* mac){return LampMeshWire::mac(mac)&&!LampMeshWire::same(mac,self)&&(!hooks.trusted||hooks.trusted(hooks.context,mac));}
bool send(void*,const uint8_t* data,size_t size){const bool accepted=hooks.send&&hooks.send(hooks.context,data,size);if(accepted)++transmitAccepted;else ++transmitFailed;return accepted;}
bool allowed(uint8_t endpoint,uint8_t method){
  using namespace LampControlEndpoint;
  // Household operations require the protected Bluetooth origin the bridge
  // does not provide. Keep all other direct-only actions direct as well.
  if(method==1)return endpoint==State||endpoint==Sync||endpoint==Audio||endpoint==Firmware||endpoint==Effects||endpoint==MeshNew||endpoint==Descriptor||endpoint==Revision;
  if(method!=2)return false;
  return (endpoint>=SyncInvite&&endpoint<=AudioTest)||endpoint==FirmwareAutomatic||endpoint==Style||(endpoint>=Power&&endpoint<=EffectOptions)||(endpoint>=EnrollStart&&endpoint<=EnrollCancel)||(endpoint>=SchemaPage&&endpoint<=LampControlEndpoint::Receipt)||endpoint==UpdatePolicy||endpoint==GroupPage||endpoint==Rollout||endpoint==GroupRemove;
}
bool reconciliationRead(uint8_t endpoint,uint8_t method){
 using namespace LampControlEndpoint;
 // Receipt is a POST query in the production HTTP adapter. These endpoints
 // inspect identity/current state/receipt only; no mutation is synthesized.
 return (method==1&&(endpoint==State||endpoint==Descriptor||endpoint==Revision))||
        (method==2&&endpoint==LampControlEndpoint::Receipt);
}
String prefix(const uint8_t* target,uint64_t requestId,const char* status,bool executed){
  return String("{\"version\":1,\"target\":")+quote(identity(target).c_str())+",\"requestId\":\""+hex(requestId)+"\",\"status\":\""+status+"\",\"executed\":"+(executed?"true":"false");
}
uint16_t execute(void*,const uint8_t*,uint64_t,const uint8_t* bytes,size_t size,uint8_t* response,size_t capacity,size_t& used){
  used=0;
  const bool localGet=size==2&&bytes[1]==1&&(bytes[0]==LampControlEndpoint::State||bytes[0]==LampControlEndpoint::Descriptor||bytes[0]==LampControlEndpoint::Revision||bytes[0]==LampControlEndpoint::MeshStatus);
  if(!localGet){
    constexpr char denied[]="This device is a bridge. Select a lamp to control it.";
    used=std::min(capacity,sizeof(denied)-1);memcpy(response,denied,used);return 403;
  }
  if(hooks.localRead)return hooks.localRead(hooks.context,bytes[0],response,capacity,used);
  String body=bytes[0]==LampControlEndpoint::MeshStatus?statusJson():stateJson();
  if(body.length()>capacity)return 507;
  used=body.length();if(used)memcpy(response,body.c_str(),used);return 200;
}
const LampMesh::Peer* peerFor(const uint8_t* mac){
  for(unsigned i=0;i<LampMesh::MaxPeers;++i)if(LampMeshWire::same(core.peers()[i].mac,mac))return &core.peers()[i];
  return nullptr;
}
bool bootArgument(const String& value,uint64_t& boot){boot=0;return value.isEmpty()||transaction(value,boot);}
LampControlReply queried(uint16_t status,const String& body,const char* phase){
  resultQueryStatus=status;resultQueryPhase=phase;return {status,body};
}
void observeTerminal(uint32_t now){
  if(!terminalObserved&&core.result().state==LampMesh::State::Complete){terminalObserved=true;completedAt=now;}
}
}

bool begin(const uint8_t* mac,uint64_t boot,const char* name,const char* version,const Hooks& supplied){
  stop();
  if(!LampMeshWire::mac(mac)||!boot||!supplied.copyFleetKey||!supplied.fleetId||!supplied.send)return false;
  hooks=supplied;memcpy(self,mac,6);selfBoot=boot;
  snprintf(deviceName,sizeof(deviceName),"%s",name?name:"CoolLamp bridge");snprintf(firmwareVersion,sizeof(firmwareVersion),"%s",version?version:"unknown");
  configured=true;nextKeyAttempt=millis();accepting.store(true,std::memory_order_release);return true;
}
void stop(){
  accepting.store(false,std::memory_order_release);core.stop();
  for(auto& queued:receiveQueue)erase(&queued,sizeof(queued));
  readIndex.store(0,std::memory_order_relaxed);writeIndex.store(0,std::memory_order_relaxed);dropped.store(0,std::memory_order_relaxed);
  erase(fingerprint,sizeof(fingerprint));memset(self,0,sizeof(self));memset(deviceName,0,sizeof(deviceName));memset(firmwareVersion,0,sizeof(firmwareVersion));
  hooks=Hooks{};selfBoot=0;completedAt=nextKeyAttempt=0;configured=started=consumed=terminalObserved=false;paused=true;
  commandEndpoint=commandMethod=0;commandExpectedBoot=0;receivedProcessed=receivedAccepted=receivedRejected=receivedStale=receivedBlocked=transmitAccepted=transmitFailed=requestsSubmitted=0;
  commandAt=resultQueries=resultQueryAt=0;resultQueryStatus=resultQueryOffset=0;resultQueryOffsetValid=false;resultQueryPhase="none";
}
bool enqueueReceive(const uint8_t* source,const uint8_t* wire,size_t size,uint32_t at){
  if(!accepting.load(std::memory_order_acquire)||!source||!wire||size<4||size>LampMeshWire::WireLimit||memcmp(wire,"CLM\1",4))return false;
  const uint32_t write=writeIndex.load(std::memory_order_relaxed),read=readIndex.load(std::memory_order_acquire);
  if(uint32_t(write-read)>=ReceiveCapacity){dropped.fetch_add(1,std::memory_order_relaxed);return false;}
  Received& queued=receiveQueue[write%ReceiveCapacity];memcpy(queued.source,source,6);memcpy(queued.wire,wire,size);queued.size=uint16_t(size);queued.at=at;
  writeIndex.store(write+1,std::memory_order_release);return true;
}
void service(uint32_t now,bool wifiConnected,bool blocked){
  if(!configured)return;
  if(!blocked&&!started&&due(now,nextKeyAttempt)){
    nextKeyAttempt=now+1000;uint8_t key[16]{};uint64_t publicId=0;
    const bool available=transaction(fleetId(),publicId)&&hooks.copyFleetKey(hooks.context,key);
    if(available){LampMesh::Hooks h;h.trusted=trusted;h.send=send;h.execute=execute;started=core.begin(self,key,selfBoot,h);}
    erase(key,sizeof(key));
  }
  paused=blocked||!core.active();
  // Snapshot the producer bound once. Incoming traffic cannot extend this turn.
  const uint32_t limit=writeIndex.load(std::memory_order_acquire);
  uint32_t read=readIndex.load(std::memory_order_relaxed);
  unsigned processed=0;
  while(read!=limit&&processed++<ReceiveCapacity){
    Received& message=receiveQueue[read%ReceiveCapacity];
    ++receivedProcessed;
    if(paused)++receivedBlocked;
    else if(uint32_t(now-message.at)>=ReceiveMaxAge)++receivedStale;
    else if(core.receive(message.source,message.wire,message.size,now))++receivedAccepted;
    else ++receivedRejected;
    erase(&message,sizeof(message));++read;readIndex.store(read,std::memory_order_release);
  }
  core.setAnnouncement(deviceName,firmwareVersion,wifiConnected);core.service(now,!blocked);
  observeTerminal(now);
  if(hooks.holdChannel&&!paused&&core.active()){
    bool anchor=core.working();
    for(unsigned i=0;!anchor&&i<LampMesh::MaxPeers;++i)anchor=core.online(core.peers()[i].mac,now);
    if(anchor)hooks.holdChannel(hooks.context,now+1500);
  }
}
bool enabled(){return core.active();}
bool working(){return !paused&&core.working();}
bool policyChangeAllowed(){
 const auto& value=core.result();
 if(value.state==LampMesh::State::Pending||value.state==LampMesh::State::Executed)return false;
 if(value.state==LampMesh::State::Complete&&!consumed&&(!terminalObserved||uint32_t(millis()-completedAt)<ResultRetention))return false;
 return true;
}
bool online(const uint8_t* address){return address&&!paused&&core.online(address,millis());}
uint32_t receiveDropped(){return dropped.load(std::memory_order_relaxed);}
String stateJson(){
  return String("{\"version\":1,\"deviceId\":")+quote(identity(self).c_str())+",\"name\":"+quote(deviceName)+",\"role\":\"bridge\",\"capabilities\":[\"mesh-control\"],\"firmware\":{\"version\":"+quote(firmwareVersion)+"},\"mesh\":{\"version\":1,\"available\":"+(!paused&&core.active()?"true":"false")+"},\"boot\":\""+hex(selfBoot)+"\"}";
}
String statusJson(){
  const uint32_t now=millis();
  String out="{\"version\":1,\"deviceId\":"+quote(identity(self).c_str())+",\"fleetId\":"+quote(fleetId().c_str())+",\"role\":\"bridge\",\"available\":"+(!paused&&core.active()?"true":"false")+",\"peers\":[";bool comma=false;
  for(unsigned i=0;i<LampMesh::MaxPeers;++i){
    const auto& p=core.peers()[i];if(!p.boot||!p.active)continue;
    if(comma)out+=',';
    comma=true;
    out+="{\"id\":"+quote(identity(p.mac).c_str())+",\"name\":"+quote(p.name)+",\"firmwareVersion\":"+quote(p.version)+",\"online\":"+(!paused&&core.online(p.mac,now)?"true":"false")+",\"hops\":"+String(p.hops)+",\"connected\":"+(p.wifiConnected?"true":"false")+",\"boot\":\""+hex(p.boot)+"\"}";
  }
  return out+"],\"limits\":{\"localPresence\":16,\"forwardingHops\":4,\"requestBytes\":1024,\"responseBytes\":8192,\"resultPageBytes\":256,\"transactionTimeoutMs\":15000,\"resultRetentionMs\":15000,\"receiveQueue\":8},\"receiveDropped\":"+String(receiveDropped())+",\"snapshotUptimeMs\":"+String(now)+",\"boot\":\""+hex(selfBoot)+"\",\"inventoryScope\":\"local-neighborhood\",\"globalFleetCeiling\":null}";
}
String diagnosticJson(){
 const auto& result=core.result();
 const char* states[]={"idle","pending","executed","complete","failed"};
 const char* failures[]={"none","no-route","deadline","rejected","unavailable","session-changed","capacity"};
 char own[13]{},target[13]{},session[17]{},requestId[17]{},actualBoot[17]{},expectedBoot[17]{},total[24]="null",elapsed[24]="null",queryAt[24]="null",offset[24]="null";
 LampSyncRadioCrypto::identityFromMac(self,own);LampSyncRadioCrypto::identityFromMac(result.target,target);
 snprintf(session,sizeof(session),"%016llx",static_cast<unsigned long long>(selfBoot));snprintf(requestId,sizeof(requestId),"%016llx",static_cast<unsigned long long>(result.requestId));
 snprintf(actualBoot,sizeof(actualBoot),"%016llx",static_cast<unsigned long long>(result.targetBoot));snprintf(expectedBoot,sizeof(expectedBoot),"%016llx",static_cast<unsigned long long>(commandExpectedBoot));
 if(result.state==LampMesh::State::Complete)snprintf(total,sizeof(total),"%lu",static_cast<unsigned long>(result.length));
 if(result.requestId)snprintf(elapsed,sizeof(elapsed),"%lu",static_cast<unsigned long>(uint32_t(millis()-commandAt)));
 if(resultQueries&&result.requestId)snprintf(queryAt,sizeof(queryAt),"%lu",static_cast<unsigned long>(uint32_t(resultQueryAt-commandAt)));
 if(resultQueryOffsetValid)snprintf(offset,sizeof(offset),"%u",unsigned(resultQueryOffset));
 char out[DiagnosticCapacity]{};
 const int count=snprintf(out,sizeof(out),
  "{\"version\":1,\"deviceId\":\"%s\",\"boot\":\"%s\",\"available\":%s,\"working\":%s,\"paused\":%s,\"commandPresent\":%s,\"command\":{\"target\":\"%s\",\"requestId\":\"%s\",\"endpoint\":%u,\"method\":%u,\"state\":\"%s\",\"expectedTargetBoot\":\"%s\",\"targetBoot\":\"%s\",\"executionReceiptObserved\":%s,\"consumed\":%s,\"elapsedMs\":%s},\"reply\":{\"httpStatus\":%u,\"total\":%s,\"failure\":\"%s\"},\"counters\":{\"requestsSubmitted\":%lu,\"receiveProcessed\":%lu,\"receiveAccepted\":%lu,\"receiveRejected\":%lu,\"receiveStale\":%lu,\"receiveBlocked\":%lu,\"receiveDropped\":%lu,\"transmitEnqueued\":%lu,\"transmitRejected\":%lu},\"resultQuery\":{\"calls\":%lu,\"offset\":%s,\"status\":%u,\"phase\":\"%s\",\"atMs\":%s},\"fragmentProgressAvailable\":false}",
  own,session,!paused&&core.active()?"true":"false",core.working()?"true":"false",paused?"true":"false",result.requestId?"true":"false",target,requestId,unsigned(commandEndpoint),unsigned(commandMethod),states[unsigned(result.state)<=4?unsigned(result.state):0],expectedBoot,actualBoot,result.executed?"true":"false",consumed?"true":"false",elapsed,unsigned(result.status),total,failures[unsigned(result.failure)<=6?unsigned(result.failure):0],
  static_cast<unsigned long>(requestsSubmitted),static_cast<unsigned long>(receivedProcessed),static_cast<unsigned long>(receivedAccepted),static_cast<unsigned long>(receivedRejected),static_cast<unsigned long>(receivedStale),static_cast<unsigned long>(receivedBlocked),static_cast<unsigned long>(receiveDropped()),static_cast<unsigned long>(transmitAccepted),static_cast<unsigned long>(transmitFailed),static_cast<unsigned long>(resultQueries),offset,unsigned(resultQueryStatus),resultQueryPhase,queryAt);
 if(count<=0||size_t(count)>=sizeof(out))return String();
 String value;if(!value.reserve(size_t(count))||!value.concat(out,size_t(count)))return String();return value;
}
LampControlReply request(const String& target,const String& requestId,const String& endpoint,const String& method,const String& form,const String& expectedBoot){
  uint8_t mac[6]{};uint64_t tx=0,wantedBoot=0;uint32_t ep=0,op=0;
  if(!LampSyncRadioCrypto::macFromIdentity(target.c_str(),mac)||!transaction(requestId,tx)||!number(endpoint,52,ep)||!number(method,2,op)||form.length()>LampMeshWire::RequestLimit-2||!bootArgument(expectedBoot,wantedBoot))return {400,"Invalid or direct-only mesh request."};
  if(!allowed(uint8_t(ep),uint8_t(op)))return {ep==LampControlEndpoint::Household?uint16_t(403):uint16_t(400),"This action requires a direct connection to the lamp."};
  if(LampMeshWire::same(mac,self))return {400,"Select a lamp target. This device is a bridge."};
  if(paused||!core.active())return {409,"Bridge mesh is unavailable or busy."};
  uint8_t payload[LampMeshWire::RequestLimit]{},digest[32]{};payload[0]=uint8_t(ep);payload[1]=uint8_t(op);if(form.length())memcpy(payload+2,form.c_str(),form.length());
  mbedtls_sha256_context hash;mbedtls_sha256_init(&hash);
  int error=mbedtls_sha256_starts(&hash,0);if(!error)error=mbedtls_sha256_update(&hash,mac,6);if(!error)error=mbedtls_sha256_update(&hash,payload,form.length()+2);if(!error)error=mbedtls_sha256_finish(&hash,digest);mbedtls_sha256_free(&hash);
  if(error){erase(payload,sizeof(payload));erase(digest,sizeof(digest));return {507,"Could not prepare mesh request."};}
  const auto& old=core.result();
  if(old.requestId==tx){
    erase(payload,sizeof(payload));
    const bool changed=!LampMeshWire::same(old.target,mac)||memcmp(fingerprint,digest,32)||(wantedBoot&&wantedBoot!=old.targetBoot);erase(digest,sizeof(digest));
    if(changed)return {409,"A request identifier was reused with different content or target session."};
    return result(target,requestId,"0",expectedBoot);
  }
  if(!reconciliationRead(uint8_t(ep),uint8_t(op))&&hooks.allowRequest&&!hooks.allowRequest(hooks.context,mac)){erase(payload,sizeof(payload));erase(digest,sizeof(digest));return {403,"This lamp is removed from this bridge. Add it again to use this bridge."};}
  observeTerminal(millis());
  if(old.state==LampMesh::State::Pending||old.state==LampMesh::State::Executed||(old.state==LampMesh::State::Complete&&!consumed&&(!terminalObserved||uint32_t(millis()-completedAt)<ResultRetention))){erase(payload,sizeof(payload));erase(digest,sizeof(digest));return {409,"Another mesh request is still active."};}
  const auto* peer=peerFor(mac);
  if(wantedBoot&&peer&&peer->boot!=wantedBoot){erase(payload,sizeof(payload));erase(digest,sizeof(digest));return {409,"Target lamp restarted. Refresh it before sending a new command."};}
  if(!core.online(mac,millis())){erase(payload,sizeof(payload));erase(digest,sizeof(digest));return {200,prefix(mac,tx,"no-route",false)+",\"httpStatus\":503,\"total\":0,\"offset\":0,\"data\":\"\"}"};}
  core.clearResult();const bool submitted=core.startRequest(mac,tx,payload,form.length()+2,millis());erase(payload,sizeof(payload));
  if(!submitted){erase(digest,sizeof(digest));return {409,"Mesh request could not start. Use a fresh request identifier."};}
  commandEndpoint=uint8_t(ep);commandMethod=uint8_t(op);commandExpectedBoot=wantedBoot;++requestsSubmitted;
  commandAt=millis();resultQueries=resultQueryAt=0;resultQueryStatus=resultQueryOffset=0;resultQueryOffsetValid=false;resultQueryPhase="none";
  memcpy(fingerprint,digest,32);erase(digest,sizeof(digest));consumed=terminalObserved=false;completedAt=0;
  return {202,prefix(mac,tx,"pending",false)+"}"};
}
LampControlReply result(const String& target,const String& requestId,const String& offset,const String& expectedBoot){
  uint8_t mac[6]{};uint64_t tx=0,wantedBoot=0;uint32_t at=0;
  ++resultQueries;resultQueryAt=millis();resultQueryOffsetValid=number(offset,LampMeshWire::ResponseLimit,at);resultQueryOffset=uint16_t(at);
  if(!LampSyncRadioCrypto::macFromIdentity(target.c_str(),mac)||!transaction(requestId,tx)||!resultQueryOffsetValid||!bootArgument(expectedBoot,wantedBoot))return queried(400,"Invalid mesh result request.","invalid");
  const auto& value=core.result();
  if(value.requestId!=tx||!LampMeshWire::same(value.target,mac))return queried(404,"Mesh request result is unavailable. A missing result does not prove the command was not applied.","missing");
  if(wantedBoot&&wantedBoot!=value.targetBoot)return queried(409,"This result belongs to a different target lamp session.","session");
  if(value.state==LampMesh::State::Pending||value.state==LampMesh::State::Executed)return queried(200,prefix(mac,tx,"pending",value.executed)+",\"targetBoot\":\""+hex(value.targetBoot)+"\"}","pending");
  const bool success=value.state==LampMesh::State::Complete;
  const char* phase=success?"ok":value.failure==LampMesh::Failure::NoRoute?"no-route":"rejected";
  if(at>value.length)return queried(400,"Invalid mesh result offset.","offset");
  const size_t count=std::min<size_t>(ResultPageSize,size_t(value.length-at));char encoded[345]{};size_t produced=0;
  if(count&&mbedtls_base64_encode(reinterpret_cast<uint8_t*>(encoded),sizeof(encoded),&produced,value.body+at,count))return queried(507,"Could not encode mesh result.","encode");
  if(at+count==value.length){consumed=true;completedAt=millis();}
  return queried(200,prefix(mac,tx,phase,value.executed)+",\"targetBoot\":\""+hex(value.targetBoot)+"\",\"httpStatus\":"+String(value.status?value.status:503)+",\"total\":"+String(value.length)+",\"offset\":"+String(at)+",\"data\":\""+encoded+"\",\"uncertain\":"+(!success&&value.failure!=LampMesh::Failure::Rejected?"true":"false")+"}",phase);
}
}
