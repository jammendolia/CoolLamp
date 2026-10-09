#include "LampMeshAdapter.h"
#include "LampMeshCore.h"
#include "LampFirmwareRelay.h"
#include "LampSyncRadioCrypto.h"
#include "LampUpdate.h"
#include "LampCommission.h"
#include "LampVersion.h"
#include <WiFi.h>
#include <esp_mac.h>
#include <esp_system.h>
#include <esp_random.h>
#include <mbedtls/base64.h>
#include <mbedtls/sha256.h>

extern String lampName;
namespace LampMeshAdapter {
namespace {
LampMesh::Core core;
uint8_t self[6]{},key[16]{},fingerprint[32]{};
uint64_t boot=0;uint32_t lastSent=0,completedAt=0;bool consumed=false,paused=true,terminalObserved=false;
void erase(void* memory,size_t n){volatile uint8_t* p=static_cast<volatile uint8_t*>(memory);while(n--)*p++=0;}
String id(const uint8_t* mac){char text[13]{};if(!LampSyncRadioCrypto::identityFromMac(mac,text))return "";return String(text);}
String hex(uint64_t n){char out[17]{};snprintf(out,sizeof(out),"%08lx%08lx",static_cast<unsigned long>(n>>32),static_cast<unsigned long>(uint32_t(n)));return String(out);}
bool transaction(const String& text,uint64_t& out){
 if(text.length()!=16)return false;
 out=0;for(unsigned i=0;i<16;++i){const char c=text[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;out=out<<4|uint8_t(c<='9'?c-'0':c-'a'+10);}return out!=0;
}
bool number(const String& text,uint32_t max,uint32_t& out){
 if(text.isEmpty()||text.length()>5)return false;
 out=0;for(unsigned i=0;i<text.length();++i){if(text[i]<'0'||text[i]>'9')return false;out=out*10+uint8_t(text[i]-'0');if(out>max)return false;}return true;
}
String quote(const char* text){String result="\"";for(const uint8_t* p=reinterpret_cast<const uint8_t*>(text);*p;++p){if(*p=='"'||*p=='\\')result+='\\';if(*p<32){char escaped[7];snprintf(escaped,sizeof(escaped),"\\u%04x",*p);result+=escaped;}else result+=char(*p);}return result+'"';}
bool trusted(void*,const uint8_t* mac){return LampMeshWire::mac(mac)&&!LampMeshWire::same(mac,self);}
bool send(void*,const uint8_t* data,size_t size){
 const uint32_t now=millis();if(lastSent&&now-lastSent<12)return false;
 // Non-priority broadcast frames would coalesce. Pace copied priority packets
 // so group traffic gets radio time and callbacks remain bounded/copy-only.
 if(!LampEspNow::enqueue(data,size,nullptr,true))return false;
 lastSent=now;return true;
}
bool allowed(uint8_t endpoint,uint8_t method){
 using namespace LampControlEndpoint;
 if(method==1)return endpoint==State||endpoint==Sync||endpoint==Firmware||endpoint==Effects||endpoint==MeshNew;
 if(method!=2)return false;
 return (endpoint>=SyncInvite&&endpoint<=AudioTest)||endpoint==FirmwareAutomatic||endpoint==Style||(endpoint>=Power&&endpoint<=EffectOptions)||(endpoint>=EnrollStart&&endpoint<=EnrollCancel);
}
uint16_t execute(void*,const uint8_t*,uint64_t,const uint8_t* bytes,size_t size,uint8_t* response,size_t capacity,size_t& used){
 used=0;if(size<2||!allowed(bytes[0],bytes[1])){constexpr char message[]="This action requires a direct Bluetooth or Wi-Fi connection.";used=min(capacity,sizeof(message)-1);memcpy(response,message,used);return 403;}
 if(lampUpdateOwnsResources())return 409;
 String form;if(size>2&&(!form.reserve(size-2)||!form.concat(reinterpret_cast<const char*>(bytes+2),size-2)))return 507;
 auto reply=lampControlRequest(bytes[0],bytes[1]==2,form);if(form.length())erase(const_cast<char*>(form.c_str()),form.length());form=static_cast<const char*>(nullptr);
 if(reply.body.length()>capacity){if(reply.body.length())erase(const_cast<char*>(reply.body.c_str()),reply.body.length());return 507;}
 used=reply.body.length();if(used)memcpy(response,reply.body.c_str(),used);if(used)erase(const_cast<char*>(reply.body.c_str()),used);return reply.status;
}
String prefix(const uint8_t* target,uint64_t requestId,const char* status,bool executed){return String("{\"version\":1,\"target\":")+quote(id(target).c_str())+",\"requestId\":\""+hex(requestId)+"\",\"status\":\""+status+"\",\"executed\":"+(executed?"true":"false");}
}
void begin(){esp_read_mac(self,ESP_MAC_WIFI_STA);boot=(uint64_t(esp_random())<<32|esp_random())|1;lastSent=0;}
bool receive(const LampEspNow::Received& message){
 if(message.length<4||memcmp(message.data,"CLM\1",4))return false;
 if(!paused&&core.active()&&millis()-message.receivedAt<1500)core.receive(message.source,message.data,message.length,millis());
 return true;
}
void service(uint32_t now,bool blocked){
 if(blocked){core.service(now,false);paused=true;return;}
 if(!core.active()&&LampFirmwareRelay::copyFleetKey(key)){
  LampMesh::Hooks hooks;hooks.trusted=trusted;hooks.send=send;hooks.execute=execute;
  core.begin(self,key,boot,hooks);erase(key,sizeof(key));
 }
 paused=false;core.setAnnouncement(lampName.c_str(),LAMP_FIRMWARE_VERSION,WiFi.status()==WL_CONNECTED);core.service(now);
 if(!terminalObserved&&core.result().state==LampMesh::State::Complete){terminalObserved=true;completedAt=now;}
 bool livePeer=false;
 for(unsigned i=0;i<LampMesh::MaxPeers;++i){
  const auto& peer=core.peers()[i];
  if(core.online(peer.mac,now)){livePeer=true;break;}
 }
 // An offline independent lamp must stay on the channel where it proved a
 // fleet neighbor. Otherwise seeking moves it away between app commands.
 // Expired peers release this hold so channel discovery can resume.
 if(core.working()||livePeer)LampEspNow::holdChannel(now+1500);
}
bool working(){return !paused&&core.working();}
bool enabled(){return core.active();}
bool online(const uint8_t* mac){return !paused&&core.online(mac,millis());}
String statusJson(){
 String out="{\"version\":1,\"deviceId\":"+quote(id(self).c_str())+",\"fleetId\":"+quote(LampFirmwareRelay::fleetId().c_str())+",\"available\":"+(!paused&&core.active()?"true":"false")+",\"peers\":[";bool comma=false;
 const auto* peers=core.peers();for(unsigned i=0;i<LampMesh::MaxPeers;++i){const auto& p=peers[i];if(!p.boot||!p.active)continue;if(comma)out+=',';comma=true;out+="{\"id\":"+quote(id(p.mac).c_str())+",\"name\":"+quote(p.name)+",\"firmwareVersion\":"+quote(p.version)+",\"online\":"+(core.online(p.mac,millis())?"true":"false")+",\"hops\":"+String(p.hops)+",\"connected\":"+(p.wifiConnected?"true":"false")+",\"boot\":\""+hex(p.boot)+"\"}";}
 return out+"]}";
}
LampControlReply request(const String& target,const String& requestId,const String& endpoint,const String& method,const String& form){
 uint8_t mac[6]{};uint64_t tx=0;uint32_t ep=0,op=0;
 if(!LampSyncRadioCrypto::macFromIdentity(target.c_str(),mac)||!transaction(requestId,tx)||!number(endpoint,39,ep)||!number(method,2,op)||!allowed(ep,op)||form.length()>1022)return {400,"Invalid or direct-only mesh request."};
 if(paused||!core.active()||lampUpdateOwnsResources())return {409,"Lamp mesh bridge is unavailable or busy."};
 uint8_t payload[1024]{},digest[32]{};payload[0]=ep;payload[1]=op;memcpy(payload+2,form.c_str(),form.length());mbedtls_sha256_context h;mbedtls_sha256_init(&h);mbedtls_sha256_starts(&h,0);mbedtls_sha256_update(&h,mac,6);mbedtls_sha256_update(&h,payload,form.length()+2);mbedtls_sha256_finish(&h,digest);mbedtls_sha256_free(&h);
 const auto& old=core.result();if(old.requestId==tx){erase(payload,sizeof(payload));if(!LampMeshWire::same(old.target,mac)||memcmp(fingerprint,digest,32)){erase(digest,sizeof(digest));return {409,"A request identifier was reused with different content."};}erase(digest,sizeof(digest));return result(target,requestId,"0");}
 if(old.state==LampMesh::State::Pending||old.state==LampMesh::State::Executed||(old.state==LampMesh::State::Complete&&!consumed&&(!terminalObserved||millis()-completedAt<15000))){erase(payload,sizeof(payload));erase(digest,sizeof(digest));return {409,"Another mesh request is still active."};}
 if(!core.online(mac,millis())){erase(payload,sizeof(payload));erase(digest,sizeof(digest));return {200,prefix(mac,tx,"no-route",false)+",\"httpStatus\":503,\"total\":0,\"offset\":0,\"data\":\"\"}"};}
 core.clearResult();const bool started=core.startRequest(mac,tx,payload,form.length()+2,millis());erase(payload,sizeof(payload));if(!started){erase(digest,sizeof(digest));return {409,"Mesh request could not start."};}memcpy(fingerprint,digest,32);erase(digest,sizeof(digest));consumed=false;terminalObserved=false;completedAt=0;return {202,prefix(mac,tx,"pending",false)+"}"};
}
LampControlReply result(const String& target,const String& requestId,const String& page){
 uint8_t mac[6]{};uint64_t tx=0;uint32_t at=0;if(!LampSyncRadioCrypto::macFromIdentity(target.c_str(),mac)||!transaction(requestId,tx)||!number(page,8192,at))return {400,"Invalid mesh result request."};
 const auto& value=core.result();if(value.requestId!=tx||!LampMeshWire::same(value.target,mac))return {404,"Mesh request result is unavailable. A missing result does not prove the command was not applied."};
 if(value.state==LampMesh::State::Pending||value.state==LampMesh::State::Executed)return {200,prefix(mac,tx,"pending",value.executed)+",\"targetBoot\":\""+hex(value.targetBoot)+"\"}"};
 const bool success=value.state==LampMesh::State::Complete;
 // A completed authenticated response includes the target's HTTP status/body,
 // including validation errors. Transport failure is a separate result.
 const char* phase=success?"ok":value.failure==LampMesh::Failure::NoRoute?"no-route":"rejected";
 if(at>value.length)return {400,"Invalid mesh result offset."};
 const size_t count=min(size_t(256),size_t(value.length-at));char encoded[345]{};size_t produced=0;
 if(count&&mbedtls_base64_encode(reinterpret_cast<uint8_t*>(encoded),sizeof(encoded),&produced,value.body+at,count))return {507,"Could not encode mesh result."};
 if(at+count==value.length){consumed=true;completedAt=millis();}
 return {200,prefix(mac,tx,phase,value.executed)+",\"targetBoot\":\""+hex(value.targetBoot)+"\",\"httpStatus\":"+String(value.status?value.status:503)+",\"total\":"+String(value.length)+",\"offset\":"+String(at)+",\"data\":\""+encoded+"\",\"uncertain\":"+(!success&&value.failure!=LampMesh::Failure::Rejected?"true":"false")+"}"};
}
}
