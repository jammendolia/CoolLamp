#include "LampHousehold.h"
#include "LampHouseholdAdapter.h"
#include "LampControlHttpAdapter.h"
#include <mbedtls/base64.h>
extern LampControlHttpAdapter lampServer;

namespace {
String householdHex(const uint8_t* bytes,size_t length){String out;out.reserve(length*2);for(size_t i=0;i<length;++i){const char digits[]="0123456789abcdef";out+=digits[bytes[i]>>4];out+=digits[bytes[i]&15];}return out;}
bool householdUnhex(const String& text,uint8_t* bytes,size_t length){if(text.length()!=length*2)return false;for(size_t i=0;i<length;++i){uint8_t value=0;for(unsigned j=0;j<2;++j){const char c=text[i*2+j];if(c>='0'&&c<='9')value=(value<<4)|(c-'0');else if(c>='a'&&c<='f')value=(value<<4)|(c-'a'+10);else return false;}bytes[i]=value;}return true;}
String householdStatusJson(){const auto status=LampHousehold::status();return String("{\"version\":1,\"deviceId\":")+jsonText(lampIdentity())+",\"available\":"+(status.available?"true":"false")+",\"active\":"+String(status.active)+",\"pending\":"+String(status.pending)+",\"revoked\":"+String(status.revoked)+",\"capacity\":8,\"revision\":"+String(status.revision)+",\"bootSession\":\""+commandHex(status.boot)+"\",\"targetMac\":\""+householdHex(status.target,6)+"\",\"permissions\":\"light-control\",\"invitationTransport\":\"protected-direct-ble\",\"bleBondRequired\":true}";}
void householdResult(LampHousehold::Result result){using Result=LampHousehold::Result;const bool saved=result==Result::Persisted||result==Result::Accepted;const uint16_t status=saved?200:result==Result::Uncertain?503:result==Result::StorageFailure?500:result==Result::CapacityFull?429:409;
 const char* outcome=saved?"persisted":result==Result::Uncertain||result==Result::Duplicate?"uncertain":result==Result::StorageFailure?"save-failed":"rejected";
 lampServer.send(status,"application/json",String("{\"version\":1,\"deviceId\":")+jsonText(lampIdentity())+",\"outcome\":\""+outcome+"\",\"result\":"+String(uint8_t(result))+",\"status\":"+householdStatusJson()+"}");
}
bool householdAdminBound(uint8_t* phone,uint64_t& request,uint32_t& revision){return householdUnhex(lampServer.arg("phone"),phone,8)&&commandHexParse(lampServer.arg("requestId"),request)&&commandRevisionParse(lampServer.arg("expectedRevision"),revision);}
}
void handleLampHouseholdAdmin(){
  if(!authorizedLampRequest(true))return;
  if(lampUpdateOwnsResources()||lampFactoryResetPending()){lampServer.send(409,"text/plain","Wait for the update or reset.");return;}
  const String action=lampServer.arg("action");const char* const fields[]={"action","phone","requestId","expectedRevision"};
  if(!lampServer.fieldsAllowed(fields,4)){lampServer.send(400,"text/plain","Invalid household fields.");return;}
  if(action=="status"){lampServer.send(200,"application/json",householdStatusJson());return;}
  uint8_t phone[8]{};uint64_t request=0;uint32_t revision=0;
  if(!householdAdminBound(phone,request,revision)){lampServer.send(400,"text/plain","Invalid household identity or revision.");return;}
  if(action=="revoke"){householdResult(LampHousehold::revoke(phone,request,revision));return;}
  if(action!="invite"){lampServer.send(400,"text/plain","Unsupported household operation.");return;}
  // HTTP is not a confidential credential-sharing channel. Only an already
  // protected direct BLE RPC can receive the new per-phone invitation secret.
  if(!lampServer.controlConfidential()){lampServer.send(403,"text/plain","Use a protected Bluetooth connection, directly or through a trusted lamp, to create a household invitation.");return;}
  LampHousehold::Invitation invitation;const auto result=LampHousehold::invite(phone,request,revision,invitation);
  if(result!=LampHousehold::Result::Persisted){LampHousehold::erase(&invitation,sizeof(invitation));householdResult(result);return;}
  String body=String("{\"version\":1,\"deviceId\":")+jsonText(lampIdentity())+",\"phone\":\""+householdHex(invitation.phone,8)+"\",\"secret\":\""+householdHex(invitation.secret,16)+"\",\"epoch\":"+String(invitation.epoch)+",\"bootSession\":\""+commandHex(invitation.boot)+"\",\"requestId\":\""+commandHex(invitation.requestId)+"\",\"targetMac\":\""+householdHex(invitation.target,6)+"\",\"expiresAtUptimeMs\":"+String(invitation.expiresAt)+"}";
  LampHousehold::erase(&invitation,sizeof(invitation));lampServer.send(200,"application/json",body);if(body.length())LampHousehold::erase(const_cast<char*>(body.c_str()),body.length());
}
void handleLampHouseholdChallenge(){
  lampServer.sendHeader("Cache-Control","no-store");
  const char* const fields[]={"action","phone","requestId","proof"};uint8_t phone[8]{};
  if(!lampServer.fieldsAllowed(fields,4)||!householdUnhex(lampServer.arg("phone"),phone,8)){lampServer.send(400,"text/plain","Invalid phone identity.");return;}
  if(lampServer.arg("action")=="adopt"){
    if(lampUpdateOwnsResources()||lampFactoryResetPending()){lampServer.send(409,"text/plain","Wait for the update or reset before accepting a household invitation.");return;}
    uint64_t request=0;uint8_t proof[32]{};if(!commandHexParse(lampServer.arg("requestId"),request)||!householdUnhex(lampServer.arg("proof"),proof,32)){lampServer.send(400,"text/plain","Invalid adoption proof.");return;}
    const auto result=LampHousehold::adopt(phone,request,proof);LampHousehold::erase(proof,sizeof(proof));householdResult(result);return;
  }
  if(lampServer.arg("action")!="challenge"){lampServer.send(400,"text/plain","Unsupported phone operation.");return;}
  LampHousehold::Challenge challenge;const auto result=LampHousehold::challenge(phone,challenge);
  if(result!=LampHousehold::Result::Accepted){householdResult(result);return;}
  lampServer.send(200,"application/json",String("{\"version\":1,\"deviceId\":")+jsonText(lampIdentity())+",\"phone\":\""+householdHex(challenge.phone,8)+"\",\"bootSession\":\""+commandHex(challenge.boot)+"\",\"epoch\":"+String(challenge.epoch)+",\"nonce\":\""+householdHex(challenge.nonce,16)+"\",\"targetMac\":\""+householdHex(challenge.target,6)+"\"}");
}
void handleLampHouseholdControl(){
  lampServer.sendHeader("Cache-Control","no-store");
  const char* const fields[]={"phone","bootSession","epoch","sequence","requestId","endpoint","method","proof","body"};
  LampHousehold::Authorization authorization;uint32_t endpoint=0,method=0;const String body=lampServer.arg("body");
  if(!lampServer.fieldsAllowed(fields,9,2048)||body.length()>LampHousehold::BodyLimit||!householdUnhex(lampServer.arg("phone"),authorization.phone,8)||!householdUnhex(lampServer.arg("proof"),authorization.proof,32)||!commandHexParse(lampServer.arg("bootSession"),authorization.boot)||!commandHexParse(lampServer.arg("requestId"),authorization.requestId)||!commandRevisionParse(lampServer.arg("epoch"),authorization.epoch)||!commandRevisionParse(lampServer.arg("sequence"),authorization.sequence)||!readNumber("endpoint",1,47,endpoint)||!readNumber("method",1,2,method)){LampHousehold::erase(&authorization,sizeof(authorization));lampServer.send(400,"text/plain","Invalid household control envelope.");return;}
  authorization.endpoint=endpoint;authorization.method=method;
  const auto result=LampHousehold::authorize(authorization,reinterpret_cast<const uint8_t*>(body.c_str()),body.length());
  if(result!=LampHousehold::Result::Accepted){LampHousehold::erase(&authorization,sizeof(authorization));householdResult(result);return;}
  auto reply=lampControlRequest(endpoint,method==2,body);uint8_t proof[32]{};
  if(reply.body.length()>8192||!LampHousehold::signResponse(authorization,reply.status,reinterpret_cast<const uint8_t*>(reply.body.c_str()),reply.body.length(),proof)){LampHousehold::erase(&authorization,sizeof(authorization));LampHousehold::erase(proof,sizeof(proof));lampServer.send(503,"text/plain","The target response could not be authenticated. Reconcile before retrying.");return;}
  // Direct HTTP only: base64 bounds the wrapped 8 KiB response at 11 KiB.
  String encoded;const size_t capacity=4*((reply.body.length()+2)/3)+1;size_t used=0;
  if(!encoded.reserve(capacity)){LampHousehold::erase(&authorization,sizeof(authorization));LampHousehold::erase(proof,sizeof(proof));lampServer.send(503,"text/plain","No response memory. Reconcile before retrying.");return;}
  for(size_t i=0;i<capacity;++i)encoded+=' ';
  if(mbedtls_base64_encode(reinterpret_cast<uint8_t*>(const_cast<char*>(encoded.c_str())),capacity,&used,reinterpret_cast<const uint8_t*>(reply.body.c_str()),reply.body.length())){LampHousehold::erase(&authorization,sizeof(authorization));LampHousehold::erase(proof,sizeof(proof));lampServer.send(503,"text/plain","Response encoding failed. Reconcile before retrying.");return;}
  encoded.remove(used);
  const String envelope=String("{\"version\":1,\"deviceId\":")+jsonText(lampIdentity())+",\"phone\":\""+householdHex(authorization.phone,8)+"\",\"bootSession\":\""+commandHex(authorization.boot)+"\",\"epoch\":"+String(authorization.epoch)+",\"sequence\":"+String(authorization.sequence)+",\"requestId\":\""+commandHex(authorization.requestId)+"\",\"status\":"+String(reply.status)+",\"bodyEncoding\":\"base64\",\"body\":\""+encoded+"\",\"proof\":\""+householdHex(proof,32)+"\"}";
  LampHousehold::erase(&authorization,sizeof(authorization));LampHousehold::erase(proof,sizeof(proof));lampServer.send(200,"application/json",envelope);
}
