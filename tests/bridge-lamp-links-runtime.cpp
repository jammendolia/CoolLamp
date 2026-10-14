#include "bridge/BridgeLampLinks.h"
#include "Preferences.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>

uint32_t fakeNow=1000;
uint32_t millis(){return fakeNow;}
const char bridgeId[]="8c4856dab734",lampId[]="5894af4aec24";
const uint8_t lampMac[6]={0x24,0xec,0x4a,0xaf,0x94,0x58};
const String boot="000000000000000b",newBoot="0000000000000016";
String command(unsigned n){char value[17]{};snprintf(value,sizeof(value),"%016x",n);return value;}
unsigned number(const String& json,const char* key){const std::string needle=std::string("\"")+key+"\":";const auto found=json.find(needle);assert(found!=std::string::npos);return unsigned(std::stoul(json.substr(found+needle.size())));}
unsigned revision(){return number(BridgeLampLinks::statusJson(),"revision");}
LampControlReply mutate(const String& action,const String& target,unsigned request,bool busy=false){return BridgeLampLinks::request(action,target,command(request),boot,String(revision()),busy);}
void fresh(){
 Preferences::storage.clear();Preferences::namespacePresent=false;Preferences::unavailable=Preferences::failReadOpen=Preferences::failWriteOpen=Preferences::wrongType=Preferences::keyLookupFailure=Preferences::keyReadFailure=false;Preferences::failure=Preferences::None;Preferences::opens=Preferences::reads=Preferences::writes=0;fakeNow=1000;fakeFreeHeap=fakeLargestHeap=65536;String::failedConcatLiteral=nullptr;
 // Household and radio configuration occupy separate namespaces.
 Preferences::storage["bridgecfg/configV2"]={4,3,2,1};
 Preferences::storage["coollamp/fleetKeyV1"]={1,2,3,4};
 assert(BridgeLampLinks::begin(bridgeId,11));
 assert(BridgeLampLinks::ready()&&BridgeLampLinks::allows(lampMac)&&revision()==1);
}
void independent(){assert(Preferences::storage["bridgecfg/configV2"]==std::vector<uint8_t>({4,3,2,1}));assert(Preferences::storage["coollamp/fleetKeyV1"]==std::vector<uint8_t>({1,2,3,4}));}
void basic(){
 fresh();const auto noChange=mutate("add",lampId,1);assert(noChange.status==200&&Preferences::writes==0&&revision()==1);
 auto removed=mutate("remove",lampId,2);assert(removed.status==200&&!BridgeLampLinks::allows(lampMac)&&revision()==2&&Preferences::writes==1);
 const auto afterRemove=Preferences::storage;
 assert(BridgeLampLinks::request("remove",lampId,command(2),boot,"1").status==200&&Preferences::storage==afterRemove);
 assert(BridgeLampLinks::request("add",lampId,command(2),boot,"1").status==409&&Preferences::writes==1);
 assert(mutate("remove",lampId,3).status==200&&Preferences::writes==1&&revision()==2);
 assert(BridgeLampLinks::request("add",lampId,command(4),boot,"1").status==409&&!BridgeLampLinks::allows(lampMac));
 assert(mutate("add",lampId,5,true).status==409&&Preferences::writes==1);
 const auto busyReceipt=BridgeLampLinks::receipt(command(5),boot);assert(busyReceipt.status==409&&busyReceipt.body.find("\"executed\":false")!=std::string::npos&&busyReceipt.body.find("\"uncertain\":false")!=std::string::npos);
 assert(mutate("add",lampId,6).status==200&&BridgeLampLinks::allows(lampMac)&&revision()==3&&Preferences::writes==2);
 assert(BridgeLampLinks::receipt(command(6),boot).status==200);
 const unsigned reads=Preferences::reads,opens=Preferences::opens,writes=Preferences::writes;
 for(unsigned i=0;i<100;++i){assert(!BridgeLampLinks::statusJson().isEmpty());BridgeLampLinks::receipt(command(6),boot);BridgeLampLinks::allows(lampMac);}
 assert(Preferences::reads==reads&&Preferences::opens==opens&&Preferences::writes==writes);independent();
 std::cout<<"PASS bridge links: default household access, desired policy idempotence, duplicate/multi-click/CAS/busy fences, GETs are RAM-only\n";
}
void invalidAndCapacity(){
 fresh();for(const char* bad:{"", "123", "5894AF4aec24", "000000000000", "ffffffffffff", "5894af4aec25", "5894af4aec2g",bridgeId})assert(mutate("remove",bad,1).status==400);
 String embedded=String(lampId);embedded+=char(0);embedded+='x';assert(mutate("remove",embedded,1).status==400);
 assert(mutate("erase",lampId,1).status==400);
 for(const char* bad:{"0","01","4294967296","-1","1x"})assert(BridgeLampLinks::request("remove",lampId,command(1),boot,bad).status==400);
 assert(BridgeLampLinks::request("remove",lampId,command(1),newBoot,"1").status==409);
 assert(BridgeLampLinks::request("remove",lampId,"0000000000000000",boot,"1").status==400&&Preferences::writes==0);
 uint8_t multicast[6]={1,2,3,4,5,6},zero[6]{};assert(!BridgeLampLinks::allows(multicast)&&!BridgeLampLinks::allows(zero)&&!BridgeLampLinks::allows(nullptr));
 for(unsigned i=0;i<BridgeLampLinks::MaximumExcluded;++i){char target[13]{};snprintf(target,sizeof(target),"112233%06x",i*2+2);assert(mutate("remove",target,i+1).status==200);}
 assert(Preferences::storage["bridgelinks/policyV1"].size()==848&&revision()==65);
 assert(mutate("remove",lampId,100).status==409&&revision()==65&&BridgeLampLinks::statusJson().length()<=BridgeLampLinks::StatusCapacity);
 std::cout<<"Worst 64-exclusion status "<<BridgeLampLinks::statusJson().length()<<" / "<<BridgeLampLinks::StatusCapacity<<" bytes\n";
 assert(mutate("add","112233000002",101).status==200);assert(mutate("remove",lampId,102).status==200);independent();
 std::cout<<"PASS bridge links: canonical IDs, future identity independence, 64 exclusions, sorted durable bounds, honest capacity\n";
}
void retainedAndBoot(){
 fresh();assert(mutate("remove",lampId,1).status==200);const auto durable=Preferences::storage;
 assert(BridgeLampLinks::begin(bridgeId,22)&&!BridgeLampLinks::allows(lampMac)&&revision()==2&&Preferences::storage==durable);
 const auto rebooted=BridgeLampLinks::receipt(command(1),boot);assert(rebooted.status==409&&rebooted.body.find("\"uncertain\":true")!=std::string::npos);
 assert(BridgeLampLinks::receipt(command(1),newBoot).status==404);
 fresh();fakeNow=UINT32_MAX-100;assert(mutate("remove",lampId,1).status==200);fakeNow=50;assert(BridgeLampLinks::receipt(command(1),boot).status==200);
 fakeNow+=BridgeLampLinks::ReceiptLifetimeMs;assert(BridgeLampLinks::receipt(command(1),boot).status==404);
 assert(BridgeLampLinks::request("remove",lampId,command(1),boot,"1").status==409&&Preferences::writes==1);
 fresh();for(unsigned i=1;i<=BridgeLampLinks::ReceiptCapacity+1;++i){char target[13]{};snprintf(target,sizeof(target),"112233%06x",i*2);assert(mutate("remove",target,i).status==200);}
 assert(BridgeLampLinks::receipt(command(1),boot).status==404);independent();
 std::cout<<"PASS bridge links: restart retains policy, receipts expire/evict honestly, boot and rollover fences\n";
}
void saveFaults(){
 for(const auto failure:{Preferences::Unapplied,Preferences::AppliedButShort,Preferences::Partial}){
  fresh();Preferences::failure=failure;
  const auto result=mutate("remove",lampId,1);assert(result.status==507&&!BridgeLampLinks::ready()&&!BridgeLampLinks::allows(lampMac));
  assert(result.body.find("\"uncertain\":true")!=std::string::npos&&Preferences::writes==1);
  const auto reads=Preferences::reads,opens=Preferences::opens;
  assert(BridgeLampLinks::receipt(command(1),boot).status==507);BridgeLampLinks::statusJson();assert(Preferences::reads==reads&&Preferences::opens==opens);
  for(unsigned i=2;i<10;++i)assert(mutate("add",lampId,i).status==507&&Preferences::writes==1);
  assert(BridgeLampLinks::receipt(command(1),boot).status==507);
  BridgeLampLinks::service(fakeNow,true);assert(!BridgeLampLinks::ready());
  Preferences::failure=Preferences::None;BridgeLampLinks::service(fakeNow,false);
  if(failure==Preferences::Partial){assert(!BridgeLampLinks::ready()&&!BridgeLampLinks::allows(lampMac));assert(BridgeLampLinks::receipt(command(1),boot).body.find("\"uncertain\":true")!=std::string::npos);}
  else{
   assert(BridgeLampLinks::ready());const auto reconciled=BridgeLampLinks::receipt(command(1),boot);
   if(failure==Preferences::AppliedButShort){assert(!BridgeLampLinks::allows(lampMac)&&revision()==2&&reconciled.status==200&&reconciled.body.find("\"persisted\":true")!=std::string::npos);}
   else assert(BridgeLampLinks::allows(lampMac)&&revision()==1&&reconciled.status==507&&reconciled.body.find("\"uncertain\":false")!=std::string::npos);
  }
  assert(Preferences::writes==1);independent();
 }
 fresh();Preferences::failWriteOpen=true;assert(mutate("remove",lampId,1).status==507&&!BridgeLampLinks::ready()&&Preferences::writes==0);Preferences::failWriteOpen=false;BridgeLampLinks::service(fakeNow);assert(BridgeLampLinks::ready()&&BridgeLampLinks::allows(lampMac)&&Preferences::writes==0);
 fresh();Preferences::unavailable=true;assert(!BridgeLampLinks::begin(bridgeId,11)&&!BridgeLampLinks::allows(lampMac));BridgeLampLinks::service(fakeNow);const auto openCount=Preferences::opens;BridgeLampLinks::service(fakeNow+999);assert(Preferences::opens==openCount);Preferences::unavailable=false;BridgeLampLinks::service(fakeNow+1000);assert(BridgeLampLinks::ready());
 fresh();assert(mutate("remove",lampId,1).status==200);auto& raw=Preferences::storage["bridgelinks/policyV1"];raw[5]=255;assert(!BridgeLampLinks::begin(bridgeId,11)&&!BridgeLampLinks::allows(lampMac));assert(BridgeLampLinks::statusJson().length()<BridgeLampLinks::StatusCapacity);independent();
 for(unsigned failure=0;failure<3;++failure){
  fresh();assert(mutate("remove",lampId,1).status==200);const auto durable=Preferences::storage;
  if(failure==0)Preferences::keyLookupFailure=true;
  if(failure==1)Preferences::keyReadFailure=true;
  if(failure==2)Preferences::wrongType=true;
  assert(!BridgeLampLinks::begin(bridgeId,11)&&!BridgeLampLinks::ready()&&!BridgeLampLinks::allows(lampMac));
  assert(Preferences::storage==durable&&Preferences::writes==1);
  BridgeLampLinks::service(fakeNow);assert(!BridgeLampLinks::ready());
  Preferences::keyLookupFailure=Preferences::keyReadFailure=Preferences::wrongType=false;BridgeLampLinks::service(fakeNow+1000);
  assert(BridgeLampLinks::ready()&&!BridgeLampLinks::allows(lampMac)&&revision()==2&&Preferences::storage==durable);
 }
 std::cout<<"PASS bridge links: NVS short/applied/partial/open/key-lookup/blob-read/type failures, ambiguous write readback, busy reconciliation, malformed storage, no silent serving\n";
}
void failedReply(){
 fresh();String::failedConcatLiteral="{\"version\":1,\"found\":true,\"deviceId\":";
 const auto lost=mutate("remove",lampId,1);assert(lost.status==200&&lost.body.isEmpty()&&Preferences::writes==1&&!BridgeLampLinks::allows(lampMac));
 String::failedConcatLiteral=nullptr;const auto saved=BridgeLampLinks::receipt(command(1),boot);assert(saved.status==200&&saved.body.find("\"persisted\":true")!=std::string::npos&&Preferences::writes==1);
 const auto reads=Preferences::reads;fakeLargestHeap=0;assert(BridgeLampLinks::statusJson().isEmpty()&&BridgeLampLinks::receipt(command(1),boot).body.isEmpty()&&Preferences::reads==reads&&Preferences::writes==1);
 fakeLargestHeap=65536;assert(BridgeLampLinks::receipt(command(1),boot).body.length()<=BridgeLampLinks::ReceiptJsonCapacity&&BridgeLampLinks::ready());
 std::cout<<"PASS bridge links: checked JSON bounds/allocation failure, durable mutation survives lost reply and reconciles without replay\n";
}
int main(){basic();invalidAndCapacity();retainedAndBoot();saveFaults();failedReply();std::cout<<"PASS production bridge lamp links; 848-byte separate NVS record, bounded four receipts60s, no credentials or lamp/group mutations\n";}
