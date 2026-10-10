#include <assert.h>
#include <iostream>
#include <string>
#include <iomanip>
#include "Arduino.h"
#include "Preferences.h"
#include "LampHousehold.h"
#include "esp_mac.h"
#include "esp_random.h"

uint32_t now=1000;uint32_t millis(){return now;}
uint32_t esp_random(){static uint32_t n=19;n=n*1664525+1013904223;return n;}
int esp_read_mac(uint8_t* out,int){const uint8_t id[6]{2,1,2,3,4,5};memcpy(out,id,6);return 0;}
using namespace LampHousehold;
const uint8_t phone[8]{1,2,3,4,5,6,7,8};
Invitation issued;
void setup(){Preferences::reset();begin();assert(status().available);assert(invite(phone,1,status().revision,issued)==Result::Persisted);}
Challenge approved(){setup();Challenge c;assert(challenge(phone,c)==Result::Accepted);uint8_t proof[32];assert(adoptionProof(issued.secret,c,1,proof));assert(adopt(phone,1,proof)==Result::Persisted);assert(status().active==1);return c;}
Authorization command(const Challenge& c,uint32_t sequence=1){Authorization a;memcpy(a.phone,phone,8);a.epoch=c.epoch;a.boot=c.boot;a.sequence=sequence;a.requestId=10;a.endpoint=42;a.method=2;const uint8_t body[]{1,2,3};assert(commandProof(issued.secret,c,a,body,3,a.proof));return a;}
int main(int argc,char** argv){
 assert(argc==2);const std::string scenario=argv[1];
 if(scenario=="proof-vector"){
  const uint8_t key[16]{0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15};Challenge c;memcpy(c.phone,phone,8);esp_read_mac(c.target,0);for(unsigned i=0;i<16;++i)c.nonce[i]=i+16;c.epoch=7;c.boot=0x0102030405060708ULL;
  Authorization a;memcpy(a.phone,phone,8);a.boot=c.boot;a.epoch=c.epoch;a.sequence=9;a.requestId=0x1112131415161718ULL;a.endpoint=42;a.method=2;const char body[]="power=1&brightness=99";const char response[]="{\"deviceId\":\"050403020102\",\"power\":true}";uint8_t out[32];
  assert(commandProof(key,c,a,reinterpret_cast<const uint8_t*>(body),strlen(body),out));std::cout<<"command ";for(auto b:out)std::cout<<std::hex<<std::setw(2)<<std::setfill('0')<<unsigned(b);std::cout<<"\n";
  assert(adoptionProof(key,c,a.requestId,out));std::cout<<"adopt ";for(auto b:out)std::cout<<std::hex<<std::setw(2)<<std::setfill('0')<<unsigned(b);std::cout<<"\n";
  assert(responseProof(key,c,a,200,reinterpret_cast<const uint8_t*>(response),strlen(response),out));std::cout<<"response ";for(auto b:out)std::cout<<std::hex<<std::setw(2)<<std::setfill('0')<<unsigned(b);std::cout<<"\n";return 0;
 }else if(scenario=="adopt"){
  setup();const auto revision=status().revision;Invitation repeated;assert(invite(phone,1,0,repeated)==Result::Persisted&&status().revision==revision&&!memcmp(issued.secret,repeated.secret,16));
  Challenge c;assert(challenge(phone,c)==Result::Accepted);uint8_t proof[32];assert(adoptionProof(issued.secret,c,1,proof));
  for(unsigned i=0;i<32;++i){proof[i]^=1;assert(adopt(phone,1,proof)==Result::Rejected);proof[i]^=1;}
  assert(adopt(phone,1,proof)==Result::Persisted);const auto adopted=status().revision;assert(adopt(phone,1,proof)==Result::Persisted&&status().revision==adopted);assert(invite(phone,2,adopted,repeated)==Result::Conflict);erase(proof,sizeof(proof));
 }else if(scenario=="auth-binding"){
  const auto c=approved();const auto original=command(c);const uint8_t body[]{1,2,3};
  for(unsigned i=0;i<32;++i){auto changed=original;changed.proof[i]^=1;assert(authorize(changed,body,3)==Result::Rejected);}
  for(unsigned field=0;field<7;++field){auto a=original;switch(field){case 0:a.phone[0]^=1;break;case 1:++a.epoch;break;case 2:++a.boot;break;case 3:++a.sequence;break;case 4:++a.requestId;break;case 5:++a.endpoint;break;case 6:a.method=1;break;}assert(authorize(a,body,3)==Result::Rejected);}
  const uint8_t wrong[]{1,2,4};assert(authorize(original,wrong,3)==Result::Rejected);
  for(uint8_t privateEndpoint:{uint8_t(3),uint8_t(7),uint8_t(11),uint8_t(20),uint8_t(22),uint8_t(27),uint8_t(37)}){auto privateCommand=original;privateCommand.endpoint=privateEndpoint;assert(commandProof(issued.secret,c,privateCommand,body,3,privateCommand.proof));assert(authorize(privateCommand,body,3)==Result::Rejected);}
  uint8_t signedReply[32],expectedReply[32];assert(!signResponse(original,200,body,3,signedReply));
  assert(authorize(original,body,3)==Result::Accepted);assert(authorize(original,body,3)==Result::Duplicate);
  assert(signResponse(original,200,body,3,signedReply)&&responseProof(issued.secret,c,original,200,body,3,expectedReply)&&!memcmp(signedReply,expectedReply,32));
  auto changed=original;changed.requestId++;assert(!signResponse(changed,200,body,3,signedReply));assert(!signResponse(original,200,body,8193,signedReply));
  auto next=command(c,2);assert(authorize(next,body,3)==Result::Accepted);assert(authorize(original,body,3)==Result::Expired);begin();assert(authorize(next,body,3)==Result::Rejected);
 }else if(scenario=="revoke"){
  const auto c=approved();auto a=command(c);const uint8_t body[]{1,2,3};assert(revoke(phone,2,0)==Result::Conflict);assert(revoke(phone,2,status().revision)==Result::Persisted);const auto revoked=status().revision;assert(revoke(phone,2,0)==Result::Persisted&&status().revision==revoked);assert(authorize(a,body,3)==Result::Rejected);begin();assert(authorize(a,body,3)==Result::Rejected);assert(challenge(phone,const_cast<Challenge&>(c))==Result::Rejected);
  Invitation replacement;assert(invite(phone,3,status().revision,replacement)==Result::Persisted&&replacement.epoch>issued.epoch&&memcmp(replacement.secret,issued.secret,16));assert(status().pending==1&&status().active==0);
 }else if(scenario=="expired"||scenario=="rollover"||scenario=="reboot-pending"){
  if(scenario=="rollover")now=0xffff0000;
  setup();Challenge c;assert(challenge(phone,c)==Result::Accepted);uint8_t proof[32];assert(adoptionProof(issued.secret,c,1,proof));
  if(scenario=="reboot-pending")begin();else now+=InvitationLifetime;
  assert(adopt(phone,1,proof)==Result::Expired);assert(challenge(phone,c)==Result::Expired);Invitation replacement;assert(invite(phone,1,status().revision,replacement)==Result::Expired);assert(invite(phone,2,status().revision,replacement)==Result::Conflict);assert(!status().active);
 }else if(scenario=="capacity"){
  setup();for(unsigned i=1;i<Capacity;++i){uint8_t other[8];memcpy(other,phone,8);other[0]+=i;Invitation out;assert(invite(other,1+i,status().revision,out)==Result::Persisted);}
  const uint8_t ninth[8]{9};Invitation out;assert(invite(ninth,20,status().revision,out)==Result::CapacityFull);assert(status().pending==Capacity);assert(revoke(phone,21,status().revision)==Result::Persisted);assert(invite(ninth,22,status().revision,out)==Result::CapacityFull);assert(invite(phone,23,status().revision,out)==Result::Persisted&&status().pending==Capacity);
 }else if(scenario=="storage-failures"){
  Preferences::reset();begin();const auto rev=status().revision;Preferences::failWrites=true;assert(invite(phone,1,rev,issued)==Result::StorageFailure&&!status().pending);Preferences::failWrites=false;assert(invite(phone,1,rev,issued)==Result::Persisted);Challenge c;assert(challenge(phone,c)==Result::Accepted);uint8_t proof[32];assert(adoptionProof(issued.secret,c,1,proof));Preferences::failWrites=true;assert(adopt(phone,1,proof)==Result::StorageFailure&&status().pending==1);Preferences::failWrites=false;assert(adopt(phone,1,proof)==Result::Persisted);Preferences::failWrites=true;assert(revoke(phone,2,status().revision)==Result::StorageFailure&&status().active==1);Preferences::failWrites=false;assert(revoke(phone,2,status().revision)==Result::Persisted);
 }else if(scenario=="readback-failure"){
  Preferences::reset();begin();const auto revision=status().revision;Preferences::failRead=true;assert(invite(phone,1,revision,issued)==Result::Uncertain&&!status().available);for(auto byte:issued.secret)assert(byte==0);Preferences::failRead=false;begin();assert(status().pending==1&&!status().active);assert(invite(phone,1,status().revision,issued)==Result::Expired);assert(revoke(phone,2,status().revision)==Result::Persisted);
 }else if(scenario=="invite-interruption"){
  Preferences::reset();begin();Preferences::faults(0,1);try{invite(phone,1,status().revision,issued);assert(false);}catch(const PowerLoss&){}Preferences::faults();begin();assert(status().pending==1&&!status().active);Challenge c;assert(challenge(phone,c)==Result::Expired);assert(revoke(phone,2,status().revision)==Result::Persisted);
 }else if(scenario=="interruption"){
  setup();Challenge c;assert(challenge(phone,c)==Result::Accepted);uint8_t proof[32];assert(adoptionProof(issued.secret,c,1,proof));Preferences::faults(0,1);try{adopt(phone,1,proof);assert(false);}catch(const PowerLoss&){}Preferences::faults();begin();assert(status().active==1);assert(adopt(phone,1,proof)==Result::Persisted);const auto rev=status().revision;Preferences::faults(0,1);try{revoke(phone,2,rev);assert(false);}catch(const PowerLoss&){}Preferences::faults();begin();assert(status().revoked==1);assert(revoke(phone,2,0)==Result::Persisted);
 }else if(scenario=="malformed"){
  setup();auto& bytes=Preferences::storage["coollamp"]["householdV1"];for(size_t i=0;i<bytes.size();++i){bytes[i]^=1;begin();assert(!status().available);bytes[i]^=1;begin();assert(status().available);}Preferences::failBegin="coollamp";begin();assert(!status().available);
 }else if(scenario=="reset"){
  approved();Preferences p;p.begin("coollamp",false);const uint8_t hardware[]{99,100};p.putBytes("hardwareModel",hardware,2);p.clear();begin();assert(status().available&&!status().active&&!status().pending);Challenge c;assert(challenge(phone,c)==Result::Rejected);
 }else assert(false);
 std::cout<<"PASS household "<<scenario<<"; no secret output\n";
}
