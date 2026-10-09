#include "LampCommission.h"
#include "LampCommissionCrypto.h"
#include "LampFirmwareRelay.h"
#include "LampMeshAdapter.h"
#include "LampMeshWire.h"
#include "LampUpdate.h"
#include "LampVersion.h"
#include <esp_mac.h>
#include <esp_system.h>
#include <esp_random.h>

extern String lampName;
namespace LampCommission {
namespace {
using namespace LampMeshWire;
using LampCommissionCrypto::Transcript;
using LampCommissionCrypto::Keys;
constexpr uint32_t Lifetime=120000,CandidateTimeout=12000,AdvertPeriod=250,RetryPeriod=650;
constexpr size_t AdvertHeader=52,OfferSize=112,RevealSize=193;
enum Role:uint8_t {NoRole,BrokerRole,TargetRole};
enum Phase:uint8_t {Idle,Exchange,Confirm,Approved,Complete,Failed};
enum Error:uint8_t {CancelledBeforeApproval=1,StorageFailure=2,TrustConflict=3,EligibilityLost=4};
struct Candidate {uint8_t mac[6]{},commitment[32]{};uint64_t boot=0;uint32_t observed=0;char name[49]{},version[25]{};};
struct Session {
 Role role=NoRole;Phase phase=Idle;Transcript transcript{};Keys keys{};
 uint8_t fleet[16]{},wire[250]{},kind=0;size_t wireSize=0;
 uint32_t started=0,nextSend=0,sequence=0,received=0;
 bool approved=false,commitSent=false,uncertain=false,confirmedAbsent=false,terminalSent=false,revealed=false;
 uint8_t pattern[4]{};
 char reason[49]{};
} session;
Candidate candidates[8]{};uint8_t self[6]{};uint64_t boot=0,advertBoot=0;
uint8_t advertNonce[16]{},advertCommit[32]{};
uint32_t nextAdvert=0,cooldownUntil=0;bool radioHeld=false,blocked=false;
LampCommissionCrypto::Exchange exchange;
const uint8_t broadcast[6]{255,255,255,255,255,255};
bool due(uint32_t now,uint32_t at){return int32_t(now-at)>=0;}
uint64_t nonce(){return (uint64_t(esp_random())<<32|esp_random())|1;}
void randomBytes(uint8_t* out){for(unsigned i=0;i<4;++i)put32(out+4*i,esp_random());}
void text(char* out,const char* in,size_t capacity){size_t n=in?strlen(in):0;if(n>=capacity){n=capacity-1;while(n&&(uint8_t(in[n])&0xc0)==0x80)--n;}if(n)memcpy(out,in,n);out[n]=0;}
String id(const uint8_t* address){char out[13]{};if(mac(address))snprintf(out,sizeof(out),"%02x%02x%02x%02x%02x%02x",address[5],address[4],address[3],address[2],address[1],address[0]);return String(out);}
String hex(uint64_t number){char out[17];snprintf(out,sizeof(out),"%08lx%08lx",static_cast<unsigned long>(number>>32),static_cast<unsigned long>(uint32_t(number)));return String(out);}
bool parseHex(const String& value,uint64_t& out){if(value.length()!=16)return false;out=0;for(unsigned i=0;i<16;++i){const char c=value[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;out=out<<4|uint8_t(c<='9'?c-'0':c-'a'+10);}return out!=0;}
bool parseId(const String& value,uint8_t* out){if(value.length()!=12)return false;for(unsigned i=0;i<6;++i){uint8_t byte=0;for(unsigned j=0;j<2;++j){const char c=value[(5-i)*2+j];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;byte=uint8_t(byte*16+(c<='9'?c-'0':c-'a'+10));}out[i]=byte;}return mac(out);}
String quote(const char* value){String out="\"";for(const uint8_t* p=reinterpret_cast<const uint8_t*>(value);*p;++p){if(*p=='"'||*p=='\\')out+='\\';if(*p<32){char escaped[7];snprintf(escaped,sizeof(escaped),"\\u%04x",*p);out+=escaped;}else out+=char(*p);}return out+'"';}
const char* phaseName(){switch(session.phase){case Exchange:return "exchange";case Confirm:return "confirm";case Approved:return "approved";case Complete:return "complete";case Failed:return "failed";default:return "idle";}}
String json(){
 String out="{\"version\":1,\"target\":"+quote(id(session.transcript.target).c_str())+",\"requestId\":"+quote(hex(session.transcript.requestId).c_str())+",\"broker\":"+quote(id(session.transcript.broker).c_str())+",\"targetBoot\":"+quote(hex(session.transcript.targetBoot).c_str())+",\"phase\":"+quote(phaseName())+",\"pattern\":[";
 for(unsigned i=0;i<4;++i){if(i)out+=',';out+=String(session.pattern[i]);}
 uint64_t fleet=0;for(unsigned i=0;i<8;++i)fleet=fleet<<8|session.transcript.fleetId[i];
 out+="],\"fleetId\":"+quote(hex(fleet).c_str())+",\"approved\":"+(session.approved?"true":"false")+",\"uncertain\":"+(session.uncertain?"true":"false")+",\"confirmedAbsent\":"+(session.confirmedAbsent?"true":"false")+",\"reason\":"+quote(session.reason)+",\"expiresAt\":"+String(session.started+Lifetime)+"}";return out;
}
void releaseRadio(){if(radioHeld){finishLampBluetoothUpdateRadio(false);radioHeld=false;}}
void erasePrivateTranscript(){
 LampCommissionCrypto::erase(session.transcript.brokerNonce,16);LampCommissionCrypto::erase(session.transcript.targetNonce,16);
 LampCommissionCrypto::erase(session.transcript.brokerPublic,65);LampCommissionCrypto::erase(session.transcript.targetPublic,65);
 LampCommissionCrypto::erase(advertNonce,sizeof(advertNonce));
}
void clearSecrets(){exchange.clear();erasePrivateTranscript();LampCommissionCrypto::erase(&session.keys,sizeof(session.keys));LampCommissionCrypto::erase(session.fleet,sizeof(session.fleet));LampCommissionCrypto::erase(session.wire,sizeof(session.wire));session.wireSize=0;session.kind=0;}
void fail(const char* reason,bool absent=false){session.phase=Failed;session.confirmedAbsent=absent;session.uncertain=!absent;text(session.reason,reason,sizeof(session.reason));releaseRadio();}
bool sendCached(uint32_t now){
 if(!session.wireSize||!due(now,session.nextSend))return false;
 const uint8_t* destination=session.role==BrokerRole?session.transcript.target:session.transcript.broker;
 if(!LampEspNow::enqueue(session.wire,session.wireSize,destination,true))return false;
 session.nextSend=now+RetryPeriod;
 if(session.kind==LampCommissionCrypto::Commit)session.commitSent=true;
 if(session.phase==Complete||session.phase==Failed)session.terminalSent=true;
 return true;
}
bool prepare(uint8_t kind,const uint8_t* body=nullptr,size_t size=0){
 if(session.kind==kind&&session.wireSize)return true;
 if(session.sequence==UINT32_MAX)return false;
 session.kind=kind;session.wireSize=0;session.nextSend=millis();session.terminalSent=false;
 return LampCommissionCrypto::seal(session.transcript,session.keys,session.role==TargetRole?1:0,kind,++session.sequence,body,size,session.wire,session.wireSize);
}
void reject(uint8_t error,const char* reason,bool absent){
 prepare(LampCommissionCrypto::Failed,&error,1);fail(reason,absent);
 // The failure response is already sealed. Keep only that public ciphertext
 // for retries; cancellation/error cannot retain a private exchange or reopen
 // a credential write when a delayed Commit arrives.
 exchange.clear();erasePrivateTranscript();LampCommissionCrypto::erase(&session.keys,sizeof(session.keys));LampCommissionCrypto::erase(session.fleet,sizeof(session.fleet));
}
void offer(uint32_t now){
 uint8_t bytes[OfferSize];const Transcript& t=session.transcript;memcpy(bytes,"CCO\1",4);memcpy(bytes+4,t.broker,6);memcpy(bytes+10,t.target,6);put64(bytes+16,t.brokerBoot);put64(bytes+24,t.targetBoot);put64(bytes+32,t.requestId);
 memcpy(bytes+40,t.fleetId,8);memcpy(bytes+48,t.brokerCommit,32);memcpy(bytes+80,t.targetCommit,32);
 if(LampEspNow::enqueue(bytes,sizeof(bytes),t.target,true))session.nextSend=now+RetryPeriod;
}
void base(const Transcript& t,const char* magic,uint8_t* bytes){memcpy(bytes,magic,4);memcpy(bytes+4,t.broker,6);memcpy(bytes+10,t.target,6);put64(bytes+16,t.brokerBoot);put64(bytes+24,t.targetBoot);put64(bytes+32,t.requestId);memcpy(bytes+40,t.fleetId,8);memcpy(bytes+48,t.brokerCommit,32);memcpy(bytes+80,t.targetCommit,32);}
void reveal(bool broker){
 const uint8_t kind=broker?101:102;if(session.kind==kind&&session.wireSize)return;
 base(session.transcript,broker?"CCB\1":"CCT\1",session.wire);memcpy(session.wire+OfferSize,broker?session.transcript.brokerPublic:session.transcript.targetPublic,65);memcpy(session.wire+OfferSize+65,broker?session.transcript.brokerNonce:session.transcript.targetNonce,16);
 session.kind=kind;session.wireSize=RevealSize;session.nextSend=millis();session.terminalSent=false;
}
bool matches(const String& target,const String& requestId,const String& broker){uint8_t address[6],brokerAddress[6];uint64_t request=0;return session.role==BrokerRole&&parseId(target,address)&&parseId(broker,brokerAddress)&&parseHex(requestId,request)&&same(address,session.transcript.target)&&same(brokerAddress,self)&&request==session.transcript.requestId;}
void advertise(uint32_t now){
 if(!exchange.active()){
  if(!exchange.generate()){nextAdvert=now+5000;return;}advertBoot=nonce();randomBytes(advertNonce);
  if(!LampCommissionCrypto::commitment(self,advertBoot,exchange.publicKey(),advertNonce,advertCommit)){exchange.clear();nextAdvert=now+5000;return;}
 }
 char name[49],version[25];text(name,lampName.c_str(),sizeof(name));text(version,LAMP_FIRMWARE_VERSION,sizeof(version));const size_t n=strlen(name),v=strlen(version);
 uint8_t bytes[AdvertHeader+48+24];memcpy(bytes,"CCA\1",4);memcpy(bytes+4,self,6);put64(bytes+10,advertBoot);memcpy(bytes+18,advertCommit,32);bytes[50]=uint8_t(n);bytes[51]=uint8_t(v);memcpy(bytes+52,name,n);memcpy(bytes+52+n,version,v);
 if(LampEspNow::enqueue(bytes,AdvertHeader+n+v,broadcast,true))nextAdvert=now+AdvertPeriod;
}
bool advert(const LampEspNow::Received& message,uint32_t now){
 if(message.length<AdvertHeader||message.length>AdvertHeader+72||!mac(message.source)||same(message.source,self)||memcmp(message.data+4,message.source,6)||!u64(message.data+10))return true;
 const uint8_t n=message.data[50],v=message.data[51];if(n>48||v>24||message.length!=AdvertHeader+n+v)return true;
 uint8_t fleet[16];const bool owner=LampFirmwareRelay::copyFleetKey(fleet);LampCommissionCrypto::erase(fleet,sizeof(fleet));if(!owner||LampMeshAdapter::online(message.source))return true;
 if(session.role==BrokerRole&&same(message.source,session.transcript.target)&&working())return true;
 Candidate* candidate=nullptr;for(auto& c:candidates)if(same(c.mac,message.source)){candidate=&c;break;}
 if(!candidate)for(auto& c:candidates)if(zeroMac(c.mac)||uint32_t(now-c.observed)>=CandidateTimeout){candidate=&c;break;}
 if(!candidate)return true;
 memcpy(candidate->mac,message.source,6);candidate->boot=u64(message.data+10);candidate->observed=now;memcpy(candidate->commitment,message.data+18,32);memset(candidate->name,0,sizeof(candidate->name));memset(candidate->version,0,sizeof(candidate->version));memcpy(candidate->name,message.data+52,n);memcpy(candidate->version,message.data+52+n,v);return true;
}
bool receiveOffer(const LampEspNow::Received& message,uint32_t now){
 if(message.length!=OfferSize||!mac(message.source)||same(message.source,self)||memcmp(message.data+4,message.source,6)||memcmp(message.data+10,self,6)||!u64(message.data+16)||!u64(message.data+24)||!u64(message.data+32))return true;
 if(session.role!=NoRole){
  const Transcript& t=session.transcript;
  uint8_t expected[OfferSize];base(t,"CCO\1",expected);
  if(session.role==TargetRole&&!memcmp(message.data,expected,sizeof(expected))){session.nextSend=now;session.terminalSent=false;}
  return true;
 }
 if(blocked||!lampMeshEnrollmentEligible()||!due(now,cooldownUntil)||!exchange.active()||u64(message.data+24)!=advertBoot||memcmp(message.data+80,advertCommit,32))return true;
 Transcript t;memcpy(t.broker,message.source,6);memcpy(t.target,self,6);t.brokerBoot=u64(message.data+16);t.targetBoot=advertBoot;t.requestId=u64(message.data+32);memcpy(t.targetPublic,exchange.publicKey(),65);memcpy(t.targetNonce,advertNonce,16);memcpy(t.fleetId,message.data+40,8);memcpy(t.brokerCommit,message.data+48,32);memcpy(t.targetCommit,advertCommit,32);
 session=Session{};session.role=TargetRole;session.phase=Exchange;session.transcript=t;session.started=now;cooldownUntil=now+Lifetime;
 if(!beginLampBluetoothUpdateRadio()){fail("Radio is busy",true);clearSecrets();return true;}radioHeld=true;reveal(false);return true;
}
bool receiveReveal(const LampEspNow::Received& message,uint32_t now,bool brokerReveal){
 if(session.role==NoRole||message.length!=RevealSize||uint32_t(now-session.started)>=Lifetime)return true;
 if(brokerReveal!=(session.role==TargetRole)||!same(message.source,brokerReveal?session.transcript.broker:session.transcript.target))return true;
 uint8_t expected[OfferSize];base(session.transcript,brokerReveal?"CCB\1":"CCT\1",expected);if(memcmp(message.data,expected,sizeof(expected))||message.data[OfferSize]!=4)return true;
 uint8_t computed[32];const uint8_t* publicKey=message.data+OfferSize;const uint8_t* publicNonce=message.data+OfferSize+65;
 if(!LampCommissionCrypto::commitment(message.source,brokerReveal?session.transcript.brokerBoot:session.transcript.targetBoot,publicKey,publicNonce,computed)||memcmp(computed,brokerReveal?session.transcript.brokerCommit:session.transcript.targetCommit,32))return true;
 if(session.revealed){if(session.phase==Exchange||session.phase==Confirm||session.phase==Approved){session.nextSend=now;session.terminalSent=false;}return true;}
 if(session.phase!=Exchange||!exchange.active())return true;
 memcpy(brokerReveal?session.transcript.brokerPublic:session.transcript.targetPublic,publicKey,65);memcpy(brokerReveal?session.transcript.brokerNonce:session.transcript.targetNonce,publicNonce,16);
 if(!exchange.derive(publicKey,session.transcript,session.keys)){fail("Invalid committed public key");clearSecrets();return true;}
 session.revealed=true;memcpy(session.pattern,session.keys.pattern,4);exchange.clear();
 if(brokerReveal){session.phase=Confirm;prepare(LampCommissionCrypto::Ready);}else reveal(true);
 return true;
}
}
bool working(){return session.phase==Exchange||session.phase==Confirm||session.phase==Approved;}
void begin(){clearSecrets();releaseRadio();session=Session{};for(auto& c:candidates)c=Candidate{};esp_read_mac(self,ESP_MAC_WIFI_STA);boot=nonce();advertBoot=0;nextAdvert=cooldownUntil=0;blocked=false;}
bool physicalPending(){return session.role==TargetRole&&session.phase==Confirm&&!blocked&&uint32_t(millis()-session.started)<Lifetime;}
void approvePhysical(){
 if(!physicalPending()||!lampMeshEnrollmentEligible())return;
 session.approved=true;session.phase=Approved;prepare(LampCommissionCrypto::Approved);
}
bool cue(uint32_t now,uint8_t& red,uint8_t& green,uint8_t& blue){
 if(!physicalPending())return false;
 static const uint8_t colors[16][3]={{255,0,0},{255,96,0},{255,220,0},{128,255,0},{0,255,0},{0,255,96},{0,220,255},{0,96,255},{0,0,255},{96,0,255},{180,0,255},{255,0,220},{255,0,96},{255,170,96},{128,180,255},{255,255,255}};
 const uint32_t at=(now-session.started)%6000;red=green=blue=0;if(at>=5000||at%1250>=1000)return true;
 const uint8_t* color=colors[session.keys.pattern[at/1250]];red=color[0];green=color[1];blue=color[2];return true;
}
String candidatesJson(){
 String out="{\"version\":1,\"broker\":"+quote(id(self).c_str())+",\"candidates\":[";bool comma=false;const uint32_t now=millis();
 for(const auto& c:candidates)if(mac(c.mac)&&uint32_t(now-c.observed)<CandidateTimeout&&!LampMeshAdapter::online(c.mac)){
  if(comma)out+=',';
  comma=true;out+="{\"id\":"+quote(id(c.mac).c_str())+",\"name\":"+quote(c.name)+",\"firmwareVersion\":"+quote(c.version)+",\"broker\":"+quote(id(self).c_str())+",\"online\":true,\"claimed\":false,\"observedAt\":"+String(c.observed)+"}";
 }
 return out+"]}";
}
LampControlReply start(const String& target,const String& requestId,const String& broker){
 uint8_t address[6],brokerAddress[6],fleet[16]{};uint64_t request=0;const uint32_t now=millis();
 if(!parseId(target,address)||!parseId(broker,brokerAddress)||!same(brokerAddress,self)||!parseHex(requestId,request)||same(address,self))return {400,"Invalid commissioning target, broker or request"};
 if(matches(target,requestId,broker))return {200,json()};
 if(session.role==BrokerRole&&same(address,session.transcript.target)&&uint32_t(now-session.started)<Lifetime)return {409,"This physical attempt is still locked"};
 if(blocked||working()||lampUpdateOwnsResources()||LampFirmwareRelay::ownsRadio())return {409,"Commissioning or updater is busy"};
 if(!LampFirmwareRelay::copyFleetKey(fleet))return {409,"Broker has no paired owner fleet"};
 Candidate* candidate=nullptr;for(auto& c:candidates)if(same(c.mac,address)&&uint32_t(now-c.observed)<CandidateTimeout){candidate=&c;break;}
 if(!candidate||LampMeshAdapter::online(address)){LampCommissionCrypto::erase(fleet,sizeof(fleet));return {404,"New lamp is no longer available"};}
 clearSecrets();session=Session{};
 if(!exchange.generate()){LampCommissionCrypto::erase(fleet,sizeof(fleet));return {503,"Could not allocate commissioning exchange"};}
 session.role=BrokerRole;session.phase=Exchange;session.started=now;Transcript& t=session.transcript;memcpy(t.broker,self,6);memcpy(t.target,address,6);t.brokerBoot=boot;t.targetBoot=candidate->boot;t.requestId=request;memcpy(t.brokerPublic,exchange.publicKey(),65);randomBytes(t.brokerNonce);memcpy(t.targetCommit,candidate->commitment,32);memcpy(session.fleet,fleet,16);LampCommissionCrypto::erase(fleet,sizeof(fleet));
 if(!LampCommissionCrypto::fleetIdentifier(session.fleet,t.fleetId)||!LampCommissionCrypto::commitment(self,boot,t.brokerPublic,t.brokerNonce,t.brokerCommit)){clearSecrets();fail("Could not commit commissioning key",true);return {400,json()};}
 if(!beginLampBluetoothUpdateRadio()){clearSecrets();fail("Radio is busy",true);return {409,json()};}radioHeld=true;session.nextSend=now;return {202,json()};
}
LampControlReply status(const String& target,const String& requestId,const String& broker){if(!matches(target,requestId,broker))return {404,"Commissioning session not found"};return {200,json()};}
LampControlReply cancel(const String& target,const String& requestId,const String& broker){
 if(!matches(target,requestId,broker))return {404,"Commissioning session not found"};
 if(session.phase==Complete||session.phase==Failed)return {200,json()};
 if(!session.revealed){fail("Cancelled before public key reveal",true);clearSecrets();return {200,json()};}
 if(session.commitSent){session.wireSize=0;session.kind=0;fail("Credential commit confirmation is uncertain");return {200,json()};}
 prepare(LampCommissionCrypto::Cancel);sendCached(millis());LampCommissionCrypto::erase(session.fleet,sizeof(session.fleet));fail("Cancellation awaiting target confirmation");return {200,json()};
}
bool receive(const LampEspNow::Received& message){
 if(message.length<4)return false;
 const bool advertisement=!memcmp(message.data,"CCA\1",4),offered=!memcmp(message.data,"CCO\1",4),encrypted=!memcmp(message.data,"CCE\1",4),brokerReveal=!memcmp(message.data,"CCB\1",4),targetReveal=!memcmp(message.data,"CCT\1",4);if(!advertisement&&!offered&&!encrypted&&!brokerReveal&&!targetReveal)return false;
 const uint32_t now=millis();if(blocked||uint32_t(now-message.receivedAt)>1500)return true;if(advertisement)return advert(message,now);if(offered)return receiveOffer(message,now);if(brokerReveal||targetReveal)return receiveReveal(message,now,brokerReveal);
 if(session.role==NoRole||uint32_t(now-session.started)>=Lifetime)return true;
 uint8_t kind=0,body[32]{};uint32_t sequence=0;size_t size=0;if(!LampCommissionCrypto::open(session.transcript,session.keys,message.source,message.data,message.length,kind,sequence,body,size))return true;
 const bool duplicate=sequence<=session.received;
 if(duplicate){if(session.role==TargetRole&&session.phase==Complete&&kind==LampCommissionCrypto::Commit)session.terminalSent=false;LampCommissionCrypto::erase(body,sizeof(body));return true;}
 session.received=sequence;
 if(session.role==BrokerRole){
  if(kind==LampCommissionCrypto::Ready&&session.phase==Exchange){session.phase=Confirm;session.kind=0;session.wireSize=0;}
  else if(kind==LampCommissionCrypto::Approved&&(session.phase==Confirm||session.phase==Exchange)){session.approved=true;session.phase=Approved;prepare(LampCommissionCrypto::Commit,session.fleet,16);}
  else if(kind==LampCommissionCrypto::Finish&&session.approved&&session.commitSent){session.phase=Complete;session.uncertain=false;session.confirmedAbsent=false;clearSecrets();releaseRadio();}
  else if(kind==LampCommissionCrypto::Failed){const bool absent=body[0]==CancelledBeforeApproval||body[0]==EligibilityLost;fail(body[0]==StorageFailure?"New lamp could not save trust":"New lamp rejected commissioning",absent);clearSecrets();}
 }
 else{
  if(kind==LampCommissionCrypto::Cancel){const bool before=!session.approved&&session.phase!=Complete;reject(before?CancelledBeforeApproval:TrustConflict,before?"Cancelled before physical approval":"Physical approval already consumed",before);}
  else if(kind==LampCommissionCrypto::Commit&&(session.phase==Approved||session.phase==Complete)){
   uint8_t identifier[8]{},existing[16]{};const bool matching=LampCommissionCrypto::fleetIdentifier(body,identifier)&&!memcmp(identifier,session.transcript.fleetId,8);const bool owned=LampFirmwareRelay::copyFleetKey(existing);
   if(!matching||(owned&&memcmp(existing,body,16)))reject(TrustConflict,"Existing fleet trust preserved",false);
   else if(session.phase==Complete||LampFirmwareRelay::provisionFleetKey(body)){session.phase=Complete;session.uncertain=false;prepare(LampCommissionCrypto::Finish);session.terminalSent=false;releaseRadio();}
   else reject(StorageFailure,"Could not durably save fleet trust",false);
   LampCommissionCrypto::erase(existing,sizeof(existing));LampCommissionCrypto::erase(identifier,sizeof(identifier));
  }
 }
 LampCommissionCrypto::erase(body,sizeof(body));return true;
}
void service(uint32_t now,bool busy){
 blocked=busy;
 if(busy){if(working())fail("Commissioning interrupted");clearSecrets();releaseRadio();return;}
 if(session.role!=NoRole&&uint32_t(now-session.started)>=Lifetime){
  if(working())fail("Physical confirmation expired");
  clearSecrets();releaseRadio();
  if(session.role==TargetRole&&lampMeshEnrollmentEligible()&&due(now,cooldownUntil)){session=Session{};advertBoot=0;nextAdvert=now;}
 }
 if(working()){
  LampEspNow::holdChannel(now+15000);
  if(session.role==TargetRole&&!lampMeshEnrollmentEligible()){reject(EligibilityLost,"New lamp setup changed",!session.approved);}
 }
 if(session.role==BrokerRole&&session.approved&&session.commitSent&&(session.phase==Approved||(session.phase==Failed&&session.uncertain))&&uint32_t(now-session.started)<Lifetime&&LampMeshAdapter::online(session.transcript.target)){session.phase=Complete;session.uncertain=false;clearSecrets();releaseRadio();}
 if(session.role==BrokerRole&&session.phase==Exchange&&!session.revealed&&due(now,session.nextSend))offer(now);
 else if(session.wireSize&&(session.phase!=Complete||!session.terminalSent))sendCached(now);
 if(session.role==NoRole&&lampMeshEnrollmentEligible()&&due(now,cooldownUntil)&&due(now,nextAdvert))advertise(now);
 if(session.role==NoRole&&!lampMeshEnrollmentEligible()){exchange.clear();LampCommissionCrypto::erase(advertNonce,sizeof(advertNonce));}
}
}
