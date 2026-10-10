#include "LampHousehold.h"
#include <Arduino.h>
#include "LampMeshWire.h"
#include <Preferences.h>
#include <esp_mac.h>
#include <esp_random.h>
#include <mbedtls/md.h>
#include <mbedtls/sha256.h>

namespace LampHousehold {
using namespace LampMeshWire;
void erase(void* p,size_t n){volatile uint8_t* out=static_cast<volatile uint8_t*>(p);while(n--)*out++=0;}
namespace {
constexpr size_t Header=12,Entry=56,RecordSize=Header+Capacity*Entry+4;
enum State:uint8_t {Empty=0,Pending=1,Active=2,Revoked=3};
enum Operation:uint8_t {Invite=1,Adopt=2,Revoke=3};
struct Runtime {uint8_t challenge[16]{},lastProof[32]{};uint32_t sequence=0;uint64_t request=0;};
uint8_t record[RecordSize]{};Runtime runtime[Capacity]{};uint8_t target[6]{};uint64_t boot=0;bool available=false;
uint64_t nonce(){return (uint64_t(esp_random())<<32|esp_random())|1;}
void randomBytes(uint8_t* out,size_t size){while(size){const uint32_t value=esp_random();const size_t n=size<4?size:4;memcpy(out,&value,n);out+=n;size-=n;}}
bool nonzero(const uint8_t* id,size_t n){if(!id)return false;uint8_t bits=0;for(size_t i=0;i<n;++i)bits|=id[i];return bits!=0;}
uint32_t checksum(const uint8_t* bytes,size_t size){uint32_t crc=UINT32_MAX;for(size_t i=0;i<size;++i){crc^=bytes[i];for(unsigned bit=0;bit<8;++bit)crc=(crc>>1)^((crc&1)?0xedb88320:0);}return ~crc;}
uint8_t* entry(uint8_t* bytes,unsigned index){return bytes+Header+index*Entry;}
int indexOf(const uint8_t* phone){if(!nonzero(phone,PhoneBytes))return -1;for(unsigned i=0;i<Capacity;++i){const uint8_t* p=entry(record,i);if(p[28]!=Empty&&!memcmp(p,phone,PhoneBytes))return int(i);}return -1;}
bool valid(const uint8_t* bytes){
 if(memcmp(bytes,"CLH\1",4)||!u32(bytes+4)||u32(bytes+8)||u32(bytes+RecordSize-4)!=checksum(bytes,RecordSize-4))return false;
 for(unsigned i=0;i<Capacity;++i){const uint8_t* p=bytes+Header+i*Entry;
  if(p[28]>Revoked||p[29]>Revoke||p[30]||p[31]||u32(p+52))return false;
  if(p[28]==Empty){for(unsigned j=0;j<Entry;++j)if(p[j])return false;continue;}
  if(!nonzero(p,PhoneBytes)||!u32(p+24)||!p[29]||!u64(p+32))return false;
  if(p[28]==Revoked){if(nonzero(p+8,KeyBytes)||p[29]!=Revoke)return false;}
  else if(!nonzero(p+8,KeyBytes))return false;
  if(p[28]==Pending&&(!u64(p+40)||p[29]!=Invite))return false;
  if(p[28]==Active&&p[29]!=Adopt)return false;
  for(unsigned j=0;j<i;++j){const uint8_t* other=bytes+Header+j*Entry;if(other[28]!=Empty&&!memcmp(other,p,PhoneBytes))return false;}
 }
 return true;
}
Result persist(uint8_t* next){
 put32(next+RecordSize-4,checksum(next,RecordSize-4));
 if(!valid(next))return Result::Rejected;
 Preferences prefs;if(!prefs.begin("coollamp",false))return Result::StorageFailure;
 prefs.putBytes("householdV1",next,RecordSize);
 uint8_t readback[RecordSize]{};const bool read=prefs.getBytesLength("householdV1")==RecordSize&&prefs.getBytes("householdV1",readback,RecordSize)==RecordSize;
 Result result=Result::Uncertain;
 if(read&&!memcmp(readback,next,RecordSize)){memcpy(record,next,RecordSize);result=Result::Persisted;}
 else if(read&&!memcmp(readback,record,RecordSize))result=Result::StorageFailure;
 else if(!prefs.isKey("householdV1")&&u32(record+4)==1)result=Result::StorageFailure;
 if(result==Result::Uncertain)available=false;
 prefs.end();erase(readback,sizeof(readback));return result;
}
bool bump(uint8_t* next){const uint32_t revision=u32(next+4);if(revision==UINT32_MAX)return false;put32(next+4,revision+1);return true;}
bool sameProof(const uint8_t* a,const uint8_t* b){uint8_t difference=0;for(unsigned i=0;i<ProofBytes;++i)difference|=a[i]^b[i];return difference==0;}
bool hmac(const uint8_t* secret,const uint8_t* bytes,size_t n,uint8_t* output){return secret&&output&&mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),secret,KeyBytes,bytes,n,output)==0;}
bool fillChallenge(unsigned index,Challenge& out){
 const uint8_t* p=entry(record,index);out=Challenge{};memcpy(out.phone,p,PhoneBytes);memcpy(out.target,target,6);memcpy(out.nonce,runtime[index].challenge,16);out.epoch=u32(p+24);out.boot=boot;return true;
}
bool pendingFresh(const uint8_t* p){return u64(p+40)==boot&&uint32_t(millis()-u32(p+48))<InvitationLifetime;}
}
void begin(){
 erase(record,sizeof(record));erase(runtime,sizeof(runtime));available=false;esp_read_mac(target,ESP_MAC_WIFI_STA);boot=nonce();
 Preferences prefs;if(!prefs.begin("coollamp",false))return;
 if(!prefs.isKey("householdV1")){memcpy(record,"CLH\1",4);put32(record+4,1);put32(record+RecordSize-4,checksum(record,RecordSize-4));available=true;}
 else available=prefs.getBytesLength("householdV1")==RecordSize&&prefs.getBytes("householdV1",record,RecordSize)==RecordSize&&valid(record);
 prefs.end();if(!available){erase(record,sizeof(record));return;}
 for(auto& session:runtime)randomBytes(session.challenge,sizeof(session.challenge));
}
Status status(){Status out;out.available=available;out.revision=available?u32(record+4):0;out.boot=boot;memcpy(out.target,target,6);if(!available)return out;for(unsigned i=0;i<Capacity;++i){switch(entry(record,i)[28]){case Active:++out.active;break;case Pending:++out.pending;break;case Revoked:++out.revoked;break;}}return out;}
Result invite(const uint8_t* phone,uint64_t request,uint32_t revision,Invitation& out){
 erase(&out,sizeof(out));if(!available)return Result::Uncertain;if(!nonzero(phone,PhoneBytes)||!request)return Result::Rejected;
 int index=indexOf(phone);if(index>=0){const uint8_t* p=entry(record,index);
  if(p[29]==Invite&&u64(p+32)==request){if(!pendingFresh(p))return Result::Expired;memcpy(out.phone,p,PhoneBytes);memcpy(out.secret,p+8,KeyBytes);memcpy(out.target,target,6);out.epoch=u32(p+24);out.boot=boot;out.requestId=request;out.expiresAt=u32(p+48)+InvitationLifetime;return Result::Persisted;}
  if(p[28]!=Revoked)return Result::Conflict;
 }
 if(revision!=u32(record+4))return Result::Conflict;
 if(index<0)for(unsigned i=0;i<Capacity;++i)if(entry(record,i)[28]==Empty){index=i;break;}
 if(index<0)return Result::CapacityFull;
 const uint32_t epoch=u32(entry(record,index)+24);if(epoch==UINT32_MAX)return Result::Conflict;
 uint8_t next[RecordSize];memcpy(next,record,sizeof(next));if(!bump(next)){erase(next,sizeof(next));return Result::Conflict;}
 uint8_t* p=entry(next,index);memset(p,0,Entry);memcpy(p,phone,PhoneBytes);randomBytes(p+8,KeyBytes);put32(p+24,epoch+1);p[28]=Pending;p[29]=Invite;put64(p+32,request);put64(p+40,boot);put32(p+48,millis());
 const auto result=persist(next);erase(next,sizeof(next));
 if(result==Result::Persisted){erase(&runtime[index],sizeof(Runtime));randomBytes(runtime[index].challenge,16);return invite(phone,request,revision,out);}return result;
}
Result challenge(const uint8_t* phone,Challenge& out){
 out=Challenge{};if(!available)return Result::Uncertain;const int index=indexOf(phone);if(index<0)return Result::Rejected;const uint8_t* p=entry(record,index);
 if(p[28]==Revoked)return Result::Rejected;
 if(p[28]==Pending&&!pendingFresh(p))return Result::Expired;
 fillChallenge(index,out);return Result::Accepted;
}
bool adoptionProof(const uint8_t* secret,const Challenge& c,uint64_t request,uint8_t* proof){
 if(!secret||!proof||!nonzero(c.phone,PhoneBytes)||!mac(c.target)||!c.boot||!c.epoch||!request)return false;
 constexpr char domain[]="CoolLamp household adoption v1";uint8_t bytes[sizeof(domain)-1+6+8+8+4+16+8];size_t at=sizeof(domain)-1;memcpy(bytes,domain,at);memcpy(bytes+at,c.target,6);at+=6;put64(bytes+at,c.boot);at+=8;memcpy(bytes+at,c.phone,8);at+=8;put32(bytes+at,c.epoch);at+=4;memcpy(bytes+at,c.nonce,16);at+=16;put64(bytes+at,request);
 const bool okay=hmac(secret,bytes,sizeof(bytes),proof);erase(bytes,sizeof(bytes));return okay;
}
Result adopt(const uint8_t* phone,uint64_t request,const uint8_t* proof){
 if(!available)return Result::Uncertain;
 if(!request||!proof)return Result::Rejected;
 const int index=indexOf(phone);if(index<0)return Result::Rejected;const uint8_t* p=entry(record,index);
 if(p[28]==Active&&p[29]==Adopt&&u64(p+32)==request)return Result::Persisted;
 if(p[28]!=Pending||u64(p+32)!=request)return Result::Rejected;
 if(!pendingFresh(p))return Result::Expired;
 Challenge c;fillChallenge(index,c);uint8_t expected[ProofBytes]{};const bool verified=adoptionProof(p+8,c,request,expected)&&sameProof(expected,proof);erase(expected,sizeof(expected));if(!verified)return Result::Rejected;
 uint8_t next[RecordSize];memcpy(next,record,sizeof(next));if(!bump(next)){erase(next,sizeof(next));return Result::Conflict;}uint8_t* changed=entry(next,index);changed[28]=Active;changed[29]=Adopt;
 const auto result=persist(next);erase(next,sizeof(next));return result;
}
Result revoke(const uint8_t* phone,uint64_t request,uint32_t revision){
 if(!available)return Result::Uncertain;
 if(!request)return Result::Rejected;
 const int index=indexOf(phone);if(index<0)return Result::Rejected;const uint8_t* p=entry(record,index);
 if(p[28]==Revoked&&p[29]==Revoke&&u64(p+32)==request)return Result::Persisted;
 if(revision!=u32(record+4))return Result::Conflict;
 const uint32_t epoch=u32(p+24);if(epoch==UINT32_MAX)return Result::Conflict;uint8_t next[RecordSize];memcpy(next,record,sizeof(next));if(!bump(next)){erase(next,sizeof(next));return Result::Conflict;}
 uint8_t* changed=entry(next,index);erase(changed+8,KeyBytes);put32(changed+24,epoch+1);changed[28]=Revoked;changed[29]=Revoke;put64(changed+32,request);put64(changed+40,0);put32(changed+48,0);
 const auto result=persist(next);erase(next,sizeof(next));if(result==Result::Persisted)erase(&runtime[index],sizeof(Runtime));return result;
}
bool commandProof(const uint8_t* secret,const Challenge& c,const Authorization& a,const uint8_t* body,size_t size,uint8_t* proof){
 if(!secret||!proof||!a.sequence||!a.requestId||!a.endpoint||(a.method!=1&&a.method!=2)||size>BodyLimit||(size&&!body)||a.boot!=c.boot||a.epoch!=c.epoch||memcmp(a.phone,c.phone,PhoneBytes))return false;
 constexpr char domain[]="CoolLamp household command v1";uint8_t bytes[sizeof(domain)-1+6+8+8+4+16+4+8+2+32];size_t at=sizeof(domain)-1;memcpy(bytes,domain,at);memcpy(bytes+at,c.target,6);at+=6;put64(bytes+at,c.boot);at+=8;memcpy(bytes+at,c.phone,8);at+=8;put32(bytes+at,c.epoch);at+=4;memcpy(bytes+at,c.nonce,16);at+=16;put32(bytes+at,a.sequence);at+=4;put64(bytes+at,a.requestId);at+=8;bytes[at++]=a.endpoint;bytes[at++]=a.method;
 const bool okay=!mbedtls_sha256(body,size,bytes+at,0)&&hmac(secret,bytes,sizeof(bytes),proof);erase(bytes,sizeof(bytes));return okay;
}
Result authorize(const Authorization& a,const uint8_t* body,size_t size){
 if(!available)return Result::Uncertain;
 // V1 invitations grant household light control, not administrator authority.
 // In particular they cannot read private invites, rotate credentials, enroll
 // another phone, reset ownership or reconfigure the network through a route
 // that accidentally treats this proof like the legacy shared admin password.
 const bool allowedRead=a.method==1&&(a.endpoint==1||a.endpoint==2||a.endpoint==18||a.endpoint==24||a.endpoint==26||a.endpoint==40||a.endpoint==41||a.endpoint==44||a.endpoint==45||a.endpoint==47);
 const bool allowedMutation=a.method==2&&(a.endpoint==5||a.endpoint==6||a.endpoint==31||a.endpoint==32||a.endpoint==34||a.endpoint==35||a.endpoint==41||a.endpoint==42||a.endpoint==43||a.endpoint==44||a.endpoint==47);
 if(!allowedRead&&!allowedMutation)return Result::Rejected;
 const int index=indexOf(a.phone);if(index<0)return Result::Rejected;const uint8_t* p=entry(record,index);if(p[28]!=Active||a.boot!=boot||a.epoch!=u32(p+24))return Result::Rejected;
 Challenge c;fillChallenge(index,c);uint8_t expected[ProofBytes]{};const bool verified=commandProof(p+8,c,a,body,size,expected)&&sameProof(expected,a.proof);erase(expected,sizeof(expected));if(!verified)return Result::Rejected;
 Runtime& session=runtime[index];if(a.sequence<session.sequence)return Result::Expired;
 if(a.sequence==session.sequence)return a.requestId==session.request&&sameProof(a.proof,session.lastProof)?Result::Duplicate:Result::Rejected;
 session.sequence=a.sequence;session.request=a.requestId;memcpy(session.lastProof,a.proof,ProofBytes);return Result::Accepted;
}
bool responseProof(const uint8_t* secret,const Challenge& c,const Authorization& a,uint16_t status,const uint8_t* body,size_t size,uint8_t* proof){
 if(!secret||!proof||!a.sequence||!a.requestId||status<100||status>599||size>8192||(size&&!body)||a.boot!=c.boot||a.epoch!=c.epoch||memcmp(a.phone,c.phone,PhoneBytes))return false;
 constexpr char domain[]="CoolLamp household response v1";uint8_t bytes[sizeof(domain)-1+6+8+8+4+16+4+8+2+32];size_t at=sizeof(domain)-1;memcpy(bytes,domain,at);memcpy(bytes+at,c.target,6);at+=6;put64(bytes+at,c.boot);at+=8;memcpy(bytes+at,c.phone,8);at+=8;put32(bytes+at,c.epoch);at+=4;memcpy(bytes+at,c.nonce,16);at+=16;put32(bytes+at,a.sequence);at+=4;put64(bytes+at,a.requestId);at+=8;bytes[at++]=uint8_t(status);bytes[at++]=uint8_t(status>>8);
 const bool okay=!mbedtls_sha256(body,size,bytes+at,0)&&hmac(secret,bytes,sizeof(bytes),proof);erase(bytes,sizeof(bytes));return okay;
}
bool signResponse(const Authorization& a,uint16_t status,const uint8_t* body,size_t size,uint8_t* proof){
 if(!available||!proof)return false;
 const int index=indexOf(a.phone);if(index<0)return false;const uint8_t* p=entry(record,index);
 if(p[28]!=Active||a.boot!=boot||a.epoch!=u32(p+24))return false;
 if(runtime[index].sequence!=a.sequence||runtime[index].request!=a.requestId||!sameProof(runtime[index].lastProof,a.proof))return false;
 Challenge c;fillChallenge(index,c);return responseProof(p+8,c,a,status,body,size,proof);
}
}
