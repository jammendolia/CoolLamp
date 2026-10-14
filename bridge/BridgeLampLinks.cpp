#include "BridgeLampLinks.h"
#include "LampJsonSink.h"
#include <Preferences.h>
#include <nvs.h>
#include <string.h>
#include <stdio.h>

namespace BridgeLampLinks {
namespace {
constexpr uint32_t Magic=0x314b4c42;
constexpr const char* Namespace="bridgelinks",*Key="policyV1";
struct Record {
 uint32_t magic=Magic;
 uint8_t version=1,count=0;
 uint16_t reserved=0;
 uint32_t revision=1;
 char excluded[MaximumExcluded][13]{};
 uint32_t checksum=0;
};
static_assert(sizeof(Record)==848,"Bridge link record is fixed and versioned");
struct Receipt {
 uint64_t command=0;
 char target[13]{};
 uint32_t expectedRevision=0,revision=0,at=0;
 uint16_t status=0;
 uint8_t action=0,reason=0;
 bool persisted=false,executed=false,uncertain=false;
};
static_assert(sizeof(Receipt)<=56,"Bridge link receipt ring is bounded");
Record record,pending;
Receipt receipts[ReceiptCapacity];
char identity[13]{};
uint64_t boot=0,pendingCommand=0;
uint32_t retryAt=0;
size_t nextReceipt=0;
bool configured=false,storageFault=false,writeUncertain=false,pendingSave=false;
uint32_t crc(const void* memory,size_t size){uint32_t value=~uint32_t(0);const auto* p=static_cast<const uint8_t*>(memory);while(size--){value^=*p++;for(unsigned i=0;i<8;++i)value=(value>>1)^(0xedb88320u&uint32_t(-int32_t(value&1)));}return ~value;}
void seal(Record& value){value.checksum=crc(&value,offsetof(Record,checksum));}
bool id(const char* text){
 if(!text||strlen(text)!=12)return false;
 uint8_t any=0;
 for(unsigned i=0;i<12;++i){const char c=text[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;any|=uint8_t(c!='0');}
 // Canonical identity is reverse-byte MAC; the low hex digit at index11
 // therefore carries the radio source's multicast bit.
 const char last=text[11];const uint8_t low=uint8_t(last<='9'?last-'0':last-'a'+10);
 return any&&!(low&1);
}
bool valid(const Record& value){
 if(value.magic!=Magic||value.version!=1||value.reserved||!value.revision||value.count>MaximumExcluded||value.checksum!=crc(&value,offsetof(Record,checksum)))return false;
 for(size_t i=0;i<MaximumExcluded;++i){
  if(i<value.count){if(value.excluded[i][12]||!id(value.excluded[i])||(i&&strcmp(value.excluded[i-1],value.excluded[i])>=0))return false;}
  else for(char c:value.excluded[i])if(c)return false;
 }
 return true;
}
enum class Read:uint8_t {Ok,Unavailable,Invalid};
Read read(Record& output){
 nvs_handle_t handle;const auto opened=nvs_open(Namespace,NVS_READONLY,&handle);
 if(opened==ESP_ERR_NVS_NOT_FOUND){output=Record{};seal(output);return Read::Ok;}
 if(opened!=ESP_OK)return Read::Unavailable;
 // Preferences::isKey() maps storage errors to false. Only an explicit NVS
 // NOT_FOUND may select the implicit default; I/O/type/length failures fence
 // the serving policy rather than forgetting previously excluded lamps.
 size_t length=0;const auto found=nvs_get_blob(handle,Key,nullptr,&length);
 if(found==ESP_ERR_NVS_NOT_FOUND){nvs_close(handle);output=Record{};seal(output);return Read::Ok;}
 if(found!=ESP_OK){nvs_close(handle);return Read::Unavailable;}
 if(length!=sizeof(Record)){nvs_close(handle);return Read::Invalid;}
 Record value{};
 const auto fetched=nvs_get_blob(handle,Key,&value,&length);nvs_close(handle);
 const bool copied=fetched==ESP_OK&&length==sizeof(value);
 if(!copied||!valid(value))return Read::Invalid;
 output=value;return Read::Ok;
}
bool number(const String& text,uint32_t& value){
 if(text.isEmpty()||text.length()>10||(text.length()>1&&text[0]=='0'))return false;
 uint64_t n=0;for(size_t i=0;i<text.length();++i){if(text[i]<'0'||text[i]>'9')return false;n=n*10+uint8_t(text[i]-'0');if(n>UINT32_MAX)return false;}value=uint32_t(n);return value!=0;
}
bool transaction(const String& text,uint64_t& value){
 if(text.length()!=16)return false;
 value=0;for(unsigned i=0;i<16;++i){const char c=text[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;value=(value<<4)|uint8_t(c<='9'?c-'0':c-'a'+10);}return value!=0;
}
void hex(uint64_t value,char (&out)[17]){snprintf(out,sizeof(out),"%08lx%08lx",static_cast<unsigned long>(value>>32),static_cast<unsigned long>(uint32_t(value)));}
int position(const char* target){for(unsigned i=0;i<record.count;++i)if(!strcmp(record.excluded[i],target))return int(i);return -1;}
Receipt* find(uint64_t command,uint32_t now){for(auto& value:receipts)if(value.command==command&&uint32_t(now-value.at)<ReceiptLifetimeMs)return &value;return nullptr;}
Receipt& remember(uint64_t command,const char* target,uint8_t action,uint32_t expectedRevision,uint16_t status,bool executed,bool persisted){
 Receipt& value=receipts[nextReceipt++%ReceiptCapacity];value=Receipt{};value.command=command;memcpy(value.target,target,13);value.action=action;value.at=millis();value.expectedRevision=expectedRevision;value.revision=record.revision;value.status=status;value.executed=executed;value.persisted=persisted;return value;
}
String json(const Receipt& value){
 const char* reasons[]={"none","bridge-busy","stale-revision","link-capacity","revision-exhausted","link-storage-unavailable"};
 char session[17]{},command[17]{};hex(boot,session);hex(value.command,command);
 return lampJsonReply([&](LampJsonSink& out){
  out+="{\"version\":1,\"found\":true,\"deviceId\":";out.quote(identity);out+=",\"boot\":";out.quote(session);out+=",\"requestId\":";out.quote(command);out+=",\"target\":";out.quote(value.target);out+=",\"action\":";out.quote(value.action==1?"add":"remove");out+=",\"reason\":";out.quote(reasons[value.reason<=5?value.reason:0]);out+=",\"revision\":";out+=value.revision;out+=",\"executed\":";out+=value.uncertain?"null":value.executed?"true":"false";out+=",\"persisted\":";out+=value.persisted?"true":"false";out+=",\"uncertain\":";out+=value.uncertain?"true":"false";out+=",\"httpStatus\":";out+=value.status;out+='}';
 },ReceiptJsonCapacity);
}
LampControlReply rejected(uint16_t status,const char* reason,bool uncertain=false){
 char session[17]{};hex(boot,session);
 return {status,lampJsonReply([&](LampJsonSink& out){out+="{\"version\":1,\"reason\":";out.quote(reason);out+=",\"executed\":";out+=uncertain?"null":"false";out+=",\"persisted\":false,\"uncertain\":";out+=uncertain?"true":"false";out+=",\"revision\":";out+=record.revision;out+=",\"boot\":";out.quote(session);out+='}';},ReceiptJsonCapacity)};
}
LampControlReply missingReceipt(uint16_t status,uint64_t requested,const char* reason){
 char session[17]{},command[17]{};hex(boot,session);hex(requested,command);
 return {status,lampJsonReply([&](LampJsonSink& out){out+="{\"version\":1,\"found\":false,\"deviceId\":";out.quote(identity);out+=",\"boot\":";out.quote(session);out+=",\"requestId\":";out.quote(command);out+=",\"revision\":";out+=record.revision;out+=",\"reason\":";out.quote(reason);out+=",\"executed\":null,\"persisted\":false,\"uncertain\":true}";},ReceiptJsonCapacity)};
}
}
bool begin(const char* bridgeIdentity,uint64_t session){
 configured=false;storageFault=writeUncertain=pendingSave=false;pendingCommand=0;boot=0;identity[0]=0;nextReceipt=0;retryAt=millis();
 for(auto& value:receipts)value=Receipt{};
 record=Record{};pending=Record{};seal(record);
 if(!id(bridgeIdentity)||!session)return false;
 memcpy(identity,bridgeIdentity,13);boot=session;configured=true;
 const auto result=read(record);storageFault=result!=Read::Ok;
 return !storageFault;
}
bool ready(){return configured&&!storageFault&&!writeUncertain;}
bool allows(const uint8_t* mac){
 if(!ready()||!mac||(mac[0]&1))return false;
 char target[13]{};uint8_t any=0;for(unsigned i=0;i<6;++i){any|=mac[i];snprintf(target+2*i,3,"%02x",mac[5-i]);}
 return any&&strcmp(target,identity)&&position(target)<0;
}
void service(uint32_t now,bool busy){
 if(!configured||busy||(!storageFault&&!writeUncertain)||int32_t(now-retryAt)<0)return;
 retryAt=now+StorageRetryMs;
 Record stored{};if(read(stored)!=Read::Ok){storageFault=true;return;}
 if(pendingSave){
  const bool applied=!memcmp(&stored,&pending,sizeof(stored)),unchanged=!memcmp(&stored,&record,sizeof(stored));
  if(!applied&&!unchanged){storageFault=true;return;}
  for(auto& value:receipts)if(value.command==pendingCommand){value.uncertain=false;value.executed=applied;value.persisted=applied;value.status=applied?200:507;value.revision=stored.revision;}
  pendingSave=false;pendingCommand=0;
 }
 record=stored;storageFault=writeUncertain=false;
}
String statusJson(){
 char session[17]{};hex(boot,session);
 return lampJsonReply([&](LampJsonSink& out){
  out+="{\"version\":1,\"deviceId\":";out.quote(identity);out+=",\"boot\":";out.quote(session);out+=",\"revision\":";out+=record.revision;out+=",\"ready\":";out+=ready()?"true":"false";out+=",\"persisted\":";out+=ready()?"true":"false";out+=",\"storageFault\":";out+=storageFault?"true":"false";out+=",\"uncertain\":";out+=writeUncertain?"true":"false";out+=",\"defaultHouseholdAllowed\":true,\"scope\":\"this-bridge-serving-only\",\"excluded\":[";
  for(unsigned i=0;i<record.count;++i){if(i)out+=',';out.quote(record.excluded[i]);}
  out+="],\"limits\":{\"excluded\":";out+=MaximumExcluded;out+=",\"receipts\":";out+=ReceiptCapacity;out+=",\"receiptLifetimeMs\":";out+=ReceiptLifetimeMs;out+=",\"statusBytes\":";out+=StatusCapacity;out+=",\"receiptBytes\":";out+=ReceiptJsonCapacity;out+="}}";
 },StatusCapacity);
}
LampControlReply receipt(const String& requestId,const String& expectedBoot){
 uint64_t command=0,session=0;if(!transaction(requestId,command)||!transaction(expectedBoot,session))return rejected(400,"invalid-receipt");
 if(!configured||session!=boot)return missingReceipt(409,command,"bridge-restarted");
 const auto* value=find(command,millis());return value?LampControlReply{value->status,json(*value)}:missingReceipt(404,command,"receipt-unavailable");
}
LampControlReply request(const String& action,const String& target,const String& requestId,const String& expectedBoot,const String& expectedRevision,bool busy){
 const uint8_t op=action=="add"?1:action=="remove"?2:0;
 uint64_t command=0,session=0;uint32_t revision=0;
 if(!op||target.length()!=12||!id(target.c_str())||!transaction(requestId,command)||!transaction(expectedBoot,session)||!number(expectedRevision,revision))return rejected(400,"invalid-link-request");
 if(!configured||session!=boot)return rejected(409,"bridge-restarted",true);
 if(!strcmp(target.c_str(),identity))return rejected(400,"bridge-is-not-a-lamp");
 if(auto* old=find(command,millis())){
  if(old->action!=op||strcmp(old->target,target.c_str())||old->expectedRevision!=revision)return rejected(409,"request-id-reused");
  return {old->status,json(*old)};
 }
 const auto knownRejected=[&](uint16_t status,const char* reason){
  // While a save is uncertain, preserve its original ring entry. A new
  // well-formed request is still rejected before execution, but may not evict
  // the very receipt needed to reconcile that previous write.
  if(pendingSave)return rejected(status,reason);
  auto& failed=remember(command,target.c_str(),op,revision,status,false,false);
  failed.reason=!strcmp(reason,"bridge-busy")?1:!strcmp(reason,"stale-revision")?2:!strcmp(reason,"link-capacity")?3:!strcmp(reason,"revision-exhausted")?4:5;
  return LampControlReply{status,json(failed)};
 };
 if(!ready())return knownRejected(507,"link-storage-unavailable");
 if(busy)return knownRejected(409,"bridge-busy");
 if(revision!=record.revision)return knownRejected(409,"stale-revision");
 const int index=position(target.c_str());
 if(op==2&&index<0&&record.count==MaximumExcluded)return knownRejected(409,"link-capacity");
 const bool changed=(op==1&&index>=0)||(op==2&&index<0);
 if(changed&&record.revision==UINT32_MAX)return knownRejected(409,"revision-exhausted");
 Receipt& value=remember(command,target.c_str(),op,revision,200,true,true);
 if(!changed)return {200,json(value)};
 pending=record;
 if(op==1){for(unsigned i=unsigned(index);i+1<pending.count;++i)memcpy(pending.excluded[i],pending.excluded[i+1],13);memset(pending.excluded[--pending.count],0,13);}
 else{
  unsigned at=0;while(at<pending.count&&strcmp(pending.excluded[at],target.c_str())<0)++at;
  for(unsigned i=pending.count;i>at;--i)memcpy(pending.excluded[i],pending.excluded[i-1],13);
  memcpy(pending.excluded[at],target.c_str(),13);++pending.count;
 }
 ++pending.revision;seal(pending);
 Preferences prefs;bool saved=false;
 if(prefs.begin(Namespace,false)){saved=prefs.putBytes(Key,&pending,sizeof(pending))==sizeof(pending);prefs.end();}
 if(saved){record=pending;value.revision=record.revision;return {200,json(value)};}
 // A short write may have become durable. Fence every new bridge-origin
 // request until loop-owned readback proves exact old or exact proposed state.
 value.status=507;value.executed=false;value.persisted=false;value.uncertain=true;writeUncertain=pendingSave=true;pendingCommand=command;retryAt=millis();
 return {507,json(value)};
}
}
