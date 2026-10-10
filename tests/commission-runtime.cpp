#include <assert.h>
#include <algorithm>
#include <deque>
#include <iostream>
#include <string>
#include <vector>
#include "LampCommissionCrypto.h"
#include "LampFirmwareRelay.h"
#include "LampMeshAdapter.h"
#include "LampUpdate.h"
#include "LampMeshWire.h"
#include "esp_mac.h"
#include "esp_random.h"
using namespace LampMeshWire;
unsigned side=0;uint32_t now=1000;bool paired[2]{true,false},eligible[2]{false,true},persistence=true,blocked=false,onlineProof=false,radioHeld[2]{},sendBlocked=false;
unsigned writes=0,holds=0;uint8_t fleet[2][16]{},addresses[2][6]{{2,0,1,2,3,4},{2,0,1,2,3,5}};
unsigned power=1,group=0;String lampName="Brand new lamp";
struct Frame {unsigned from=0;std::vector<uint8_t> bytes;uint8_t destination[6]{};};
std::deque<Frame> frames;std::vector<Frame> captured;bool dropFinish=false,wrongOffer=false;
bool tamperTargetReveal=false,tamperBrokerReveal=false,dropBrokerReveal=false,renderCue=true,legacyOnly=false,downgradeReveal=false;
uint32_t millis(){return now;}
uint32_t esp_random(){static uint32_t number=17;number=number*1664525+1013904223;return number;}
int esp_read_mac(uint8_t* out,int){memcpy(out,addresses[side],6);return 0;}
bool lampMeshEnrollmentEligible(){return eligible[side]&&!paired[side];}
bool beginLampBluetoothUpdateRadio(){radioHeld[side]=true;return true;}
void finishLampBluetoothUpdateRadio(bool){radioHeld[side]=false;}
bool lampUpdateOwnsResources(){return false;}
namespace LampFirmwareRelay {
bool copyFleetKey(uint8_t* out){if(!paired[side])return false;memcpy(out,fleet[side],16);return true;}
bool provisionFleetKey(const uint8_t* key){if(paired[side])return !memcmp(key,fleet[side],16);++writes;if(!persistence)return false;memcpy(fleet[side],key,16);paired[side]=true;return true;}
bool ownsRadio(){return false;}
String fleetId(){return "";}
}
namespace LampMeshAdapter {bool online(const uint8_t* address){return onlineProof&&same(address,addresses[1])&&paired[1];}}
namespace LampEspNow {
bool enqueue(const uint8_t* data,size_t size,const uint8_t* destination,bool){
 if(sendBlocked)return false;
 assert(size<=250);Frame frame;frame.from=side;frame.bytes.assign(data,data+size);memcpy(frame.destination,destination,6);frames.push_back(frame);captured.push_back(frame);return true;
}
void holdChannel(uint32_t){++holds;}
Status status(){Status status;status.active=true;status.channel=11;return status;}
}
#define LampCommission Broker
#include "LampCommission.cpp"
#undef LampCommission
namespace Target {bool working();}
#define LampCommission Target
#include "LampCommission.cpp"
#undef LampCommission
const String targetId="050302010002",brokerId="040302010002",requestId="0000000000000001";
void deliver(){
 while(!frames.empty()){
  Frame frame=frames.front();frames.pop_front();
  if(legacyOnly&&frame.bytes[3]==2)continue;
  if(dropFinish&&frame.bytes.size()>=48&&!memcmp(frame.bytes.data(),"CCE",3)&&frame.bytes[40]==LampCommissionCrypto::Finish)continue;
  if(wrongOffer&&!memcmp(frame.bytes.data(),"CCO\1",4))frame.bytes[32]^=1;
  if(dropBrokerReveal&&!memcmp(frame.bytes.data(),"CCB\1",4))continue;
  if((tamperTargetReveal&&!memcmp(frame.bytes.data(),"CCT\1",4))||(tamperBrokerReveal&&!memcmp(frame.bytes.data(),"CCB\1",4)))frame.bytes[177]^=1;
  if(downgradeReveal&&!memcmp(frame.bytes.data(),"CCB",3))frame.bytes[3]=1;
  side=1-frame.from;LampEspNow::Received message;message.length=uint16_t(frame.bytes.size());message.receivedAt=now;memcpy(message.data,frame.bytes.data(),frame.bytes.size());memcpy(message.source,addresses[frame.from],6);
  if(side)Target::receive(message);else Broker::receive(message);
 }
}
void run(unsigned milliseconds){for(unsigned i=0;i<milliseconds;++i){side=0;Broker::service(now,blocked);deliver();side=1;Target::service(now,blocked);deliver();if(renderCue){uint8_t r,g,b;Target::cue(now,r,g,b);}++now;}}
void setup(bool expectConfirm=true,uint8_t version=1){for(unsigned i=0;i<16;++i)fleet[0][i]=uint8_t(i+1);side=0;Broker::begin();side=1;Target::begin();run(1000);side=0;assert(Broker::candidatesJson().find(targetId)!=std::string::npos);assert(Broker::start(targetId,requestId,brokerId,version).status==202);run(1500);if(expectConfirm)assert(!memcmp(Broker::session.pattern,Target::session.pattern,4));}
std::string brokerStatus(){side=0;auto result=Broker::status(targetId,requestId,brokerId);assert(result.status==200);return result.body;}
void approve(){side=1;assert(Target::physicalPending());Target::approvePhysical();assert(!Target::physicalPending());}
void crypto(){
 using namespace LampCommissionCrypto;Exchange a,b,c;assert(a.generate()&&b.generate()&&c.generate());Transcript t;memcpy(t.broker,addresses[0],6);memcpy(t.target,addresses[1],6);t.brokerBoot=42;t.targetBoot=43;t.requestId=1;memcpy(t.brokerPublic,a.publicKey(),65);memcpy(t.targetPublic,b.publicKey(),65);t.brokerNonce[0]=1;t.targetNonce[0]=2;assert(commitment(t.broker,t.brokerBoot,t.brokerPublic,t.brokerNonce,t.brokerCommit)&&commitment(t.target,t.targetBoot,t.targetPublic,t.targetNonce,t.targetCommit));uint8_t key[16]{};key[0]=1;assert(fleetIdentifier(key,t.fleetId));Keys ka,kb,kc;assert(a.derive(b.publicKey(),t,ka)&&b.derive(a.publicKey(),t,kb));assert(!memcmp(&ka,&kb,sizeof(ka)));
 Transcript changed=t;changed.requestId=2;assert(b.derive(a.publicKey(),changed,kc));assert(memcmp(ka.brokerToTarget,kc.brokerToTarget,16));assert(memcmp(ka.pattern,kc.pattern,4));changed=t;changed.fleetId[0]^=1;assert(b.derive(a.publicKey(),changed,kc));assert(memcmp(ka.digest,kc.digest,32));
 changed=t;changed.targetNonce[0]^=1;assert(!b.derive(a.publicKey(),changed,kc));assert(commitment(changed.target,changed.targetBoot,changed.targetPublic,changed.targetNonce,changed.targetCommit));assert(b.derive(a.publicKey(),changed,kc));assert(memcmp(ka.digest,kc.digest,32));
 uint8_t wire[96],opened[32],body[16]{},other[96];size_t size=0,n=0;uint8_t kind=0;uint32_t sequence=0;assert(seal(t,ka,0,Commit,1,body,sizeof(body),wire,size));assert(open(t,kb,addresses[0],wire,size,kind,sequence,opened,n)&&kind==Commit&&sequence==1&&n==16);
 for(size_t i=0;i<size;++i){wire[i]^=1;assert(!open(t,kb,addresses[0],wire,size,kind,sequence,opened,n));wire[i]^=1;}
 assert(!open(t,kb,addresses[1],wire,size,kind,sequence,opened,n));assert(!open(changed,kb,addresses[0],wire,size,kind,sequence,opened,n));assert(seal(t,ka,0,Commit,2,body,sizeof(body),other,n));assert(memcmp(wire+LampCommissionCrypto::HeaderSize,other+LampCommissionCrypto::HeaderSize,16));
 uint8_t invalid[65]{};assert(!a.derive(invalid,t,kc));a.clear();b.clear();c.clear();assert(!a.active()&&!b.active());
}
void pulseCounts(){
 for(unsigned value=0;value<16;++value){
  uint8_t symbols[6]{uint8_t(value)},first=0,second=0,r,g,b;
  LampCommissionCue::counts(value,first,second);assert(first>=1&&first<=4&&second>=1&&second<=4&&unsigned((first-1)*4+second-1)==value);
  for(unsigned group=0;group<2;++group){unsigned pulses=0;for(unsigned i=0;i<5;++i)pulses+=LampCommissionCue::render(symbols,group*LampCommissionCue::CountPeriod+i*LampCommissionCue::PulsePeriod,r,g,b);assert(pulses==(group?second:first));}
  assert(!LampCommissionCue::render(symbols,2*LampCommissionCue::CountPeriod,r,g,b)&&!r&&!g&&!b);
  const auto original=LampCommissionCue::check(symbols);
  for(unsigned i=0;i<6;++i)for(unsigned bit=0;bit<4;++bit){symbols[i]^=1<<bit;assert(LampCommissionCue::check(symbols)!=original);symbols[i]^=1<<bit;}
 }
 assert(LampCommissionCue::PulsePeriod>=700&&LampCommissionCue::Cycle==58000);
}
int main(int argc,char** argv){
 assert(argc==2);const std::string scenario=argv[1];
 if(scenario=="crypto"){crypto();std::cout<<"PASS commission crypto real P256, transcript/fleet/SAS binding, every-byte tamper, direction/sequence binding\n";return 0;}
 if(scenario=="cue-counts"){pulseCounts();std::cout<<"PASS all 16 redundant count symbols; CRC4 detects all single-bit errors; <1.5 Hz\n";return 0;}
 if(scenario=="resource-bounds"){
  setup(true,2);side=0;
  for(unsigned i=0;i<8;++i){auto& c=Broker::candidates[i];memcpy(c.mac,addresses[1],6);c.mac[5]+=i;c.boot=UINT64_MAX;c.observed=now;c.comparisonVersion=2;memset(c.name,1,48);c.name[48]=0;memset(c.version,1,24);c.version[24]=0;}
  memset(Broker::session.reason,1,48);Broker::session.reason[48]=0;
  const auto inventory=Broker::candidatesJson();const auto status=brokerStatus();assert(inventory.size()<=LampMeshWire::ResponseLimit&&status.size()<=LampMeshWire::ResponseLimit);
  std::cout<<"PASS commissioning bounds inventory="<<inventory.size()<<" status="<<status.size()<<" host Session="<<sizeof(Broker::session)<<" candidates="<<sizeof(Broker::candidates)<<" Keys="<<sizeof(LampCommissionCrypto::Keys)<<" maxWire="<<Broker::RevealSize<<"\n";return 0;
 }
 if(scenario=="legacy-negotiation"){
  legacyOnly=true;setup();side=0;assert(Broker::session.transcript.version==1);assert(Broker::start(targetId,requestId,brokerId,2).status==409);approve();run(2000);assert(writes==1);std::cout<<"PASS legacy commissioning retained; no v2 downgrade\n";return 0;
 }
 if(scenario.rfind("cue-v2",0)==0){
  if(scenario=="cue-v2-rollover")now=0xfffff000;
  downgradeReveal=scenario=="cue-v2-downgrade";renderCue=scenario!="cue-v2-unrendered";setup(!downgradeReveal,2);
  side=0;assert(Broker::start(targetId,requestId,brokerId,1).status==409);
  if(downgradeReveal){side=1;assert(!Target::physicalPending()&&!writes);downgradeReveal=false;run(2000);assert(Target::physicalPending());}
  assert(!memcmp(Broker::session.comparison,Target::session.comparison,6));
  const auto reply=brokerStatus();assert(reply.find("\"entropyBits\":24")!=std::string::npos&&reply.find("commission.color-counts.v2")!=std::string::npos&&reply.size()<1400);
  side=1;Target::approvePhysical();assert(Target::physicalPending()&&!writes);
  if(scenario=="cue-v2-stalled"){
   renderCue=false;run(LampCommissionCue::Cycle);side=1;uint8_t r,g,b;Target::cue(now,r,g,b);Target::approvePhysical();assert(Target::physicalPending()&&!writes);renderCue=true;
  }
  run(LampCommissionCue::Cycle+1);
  if(!renderCue){side=1;Target::approvePhysical();assert(Target::physicalPending()&&!writes);std::cout<<"PASS v2 physical approval requires rendered full cue\n";return 0;}
  if(scenario=="cue-v2-lost-finish")dropFinish=true;
  approve();run(2000);assert(paired[1]&&writes==1);
  if(dropFinish){assert(brokerStatus().find("\"phase\":\"approved\"")!=std::string::npos);dropFinish=false;run(1500);}
  assert(brokerStatus().find("\"phase\":\"complete\"")!=std::string::npos&&power==1&&group==0);assert(!radioHeld[0]&&!radioHeld[1]);
  std::cout<<"PASS "<<scenario<<" full 24-bit cue, one durable write, no replay\n";return 0;
 }
 if(scenario=="fresh-only"){
  for(unsigned i=0;i<16;++i)fleet[0][i]=uint8_t(i+1);
  eligible[1]=false;side=0;Broker::begin();side=1;Target::begin();run(2000);side=0;assert(Broker::candidatesJson().find(targetId)==std::string::npos);assert(!writes);std::cout<<"PASS commission fresh-only\n";return 0;
 }
 if(scenario=="commitment-hidden"||scenario=="wrong-target-reveal"||scenario=="wrong-broker-reveal"||scenario=="lost-broker-reveal"){
  tamperTargetReveal=scenario=="wrong-target-reveal";tamperBrokerReveal=scenario=="wrong-broker-reveal";dropBrokerReveal=scenario=="lost-broker-reveal";setup(scenario=="commitment-hidden");
  for(const auto& frame:captured)if(!memcmp(frame.bytes.data(),"CCA\1",4)){assert(frame.bytes.size()<125);assert(std::search(frame.bytes.begin(),frame.bytes.end(),Target::session.transcript.targetPublic,Target::session.transcript.targetPublic+65)==frame.bytes.end());}
  if(scenario!="commitment-hidden"){side=1;assert(!Target::physicalPending());assert(!writes&&!paired[1]);tamperTargetReveal=tamperBrokerReveal=dropBrokerReveal=false;run(1500);side=1;assert(Target::physicalPending());}
  assert(!writes&&!paired[1]);std::cout<<"PASS commission "<<scenario<<" no pattern/approval before verified commitments\n";return 0;
 }
 setup();assert(brokerStatus().find("\"phase\":\"confirm\"")!=std::string::npos);assert(!paired[1]&&!writes);side=1;assert(Target::physicalPending());
 if(scenario=="success"||scenario=="approval-preserves-state"||scenario=="lost-finish"||scenario=="lost-finish-proof"||scenario=="backpressure"){
  dropFinish=scenario=="lost-finish"||scenario=="lost-finish-proof";if(scenario=="backpressure")sendBlocked=true;approve();assert(power==1&&group==0);if(sendBlocked){run(1000);assert(!paired[1]);sendBlocked=false;}
  run(2000);assert(paired[1]&&writes==1&&!memcmp(fleet[0],fleet[1],16));
  if(scenario=="lost-finish"){assert(brokerStatus().find("\"phase\":\"approved\"")!=std::string::npos);dropFinish=false;run(1500);}
  if(scenario=="lost-finish-proof"){assert(brokerStatus().find("\"phase\":\"approved\"")!=std::string::npos);onlineProof=true;run(1);}
  assert(brokerStatus().find("\"phase\":\"complete\"")!=std::string::npos);assert(!radioHeld[0]&&!radioHeld[1]);
 }
 else if(scenario=="no-app-approval"||scenario=="wrong-pattern"){
  side=0;for(unsigned i=0;i<3;++i){assert(Broker::start(targetId,requestId,brokerId).status==200);assert(Broker::start(targetId,"0000000000000002",brokerId).status==409);}run(5000);assert(!paired[1]&&!writes);side=1;assert(Target::physicalPending());
  if(scenario=="wrong-pattern"){uint8_t r,g,b,display[4];memcpy(display,Broker::session.pattern,4);display[0]^=1;assert(memcmp(display,Target::session.pattern,4));assert(Target::cue(now,r,g,b));assert(!paired[1]);}
 }
 else if(scenario=="commit-before-physical"){
  uint8_t wire[96];size_t size=0;assert(LampCommissionCrypto::seal(Broker::session.transcript,Broker::session.keys,0,LampCommissionCrypto::Commit,1,fleet[0],16,wire,size));LampEspNow::Received message;message.length=size;message.receivedAt=now;memcpy(message.source,addresses[0],6);memcpy(message.data,wire,size);side=1;Target::receive(message);assert(!paired[1]&&!writes&&Target::physicalPending());
 }
 else if(scenario=="wrong-target-session"){
  for(const auto& frame:captured)if(!memcmp(frame.bytes.data(),"CCO\1",4)){LampEspNow::Received message;message.length=frame.bytes.size();message.receivedAt=now;memcpy(message.source,addresses[0],6);memcpy(message.data,frame.bytes.data(),frame.bytes.size());message.data[24]^=1;side=1;Target::receive(message);message.data[24]^=1;message.data[10]^=1;Target::receive(message);break;}
  assert(!paired[1]&&!writes);side=1;assert(Target::physicalPending());
 }
 else if(scenario=="cancel"){
  side=0;assert(Broker::cancel(targetId,requestId,brokerId).status==200);deliver();run(1000);assert(!paired[1]&&!writes);assert(brokerStatus().find("\"confirmedAbsent\":true")!=std::string::npos);side=1;Target::approvePhysical();assert(!paired[1]);assert(!Target::working()&&!radioHeld[1]);
  LampCommissionCrypto::Keys empty{};assert(!memcmp(&Target::session.keys,&empty,sizeof(empty))&&!memcmp(&Broker::session.keys,&empty,sizeof(empty)));assert(!Target::exchange.active()&&!Broker::exchange.active());
 }
 else if(scenario=="expiry"){
  run(121000);assert(!paired[1]&&!writes);side=1;assert(!Target::physicalPending());Target::approvePhysical();assert(!writes);assert(!radioHeld[0]&&!radioHeld[1]);
 }
 else if(scenario=="no-overwrite"){
  approve();
  for(unsigned i=0;i<16;++i)fleet[1][i]=99;
  paired[1]=true;
  uint8_t wire[96];size_t size=0;assert(LampCommissionCrypto::seal(Broker::session.transcript,Broker::session.keys,0,LampCommissionCrypto::Commit,1,fleet[0],16,wire,size));LampEspNow::Received message;message.length=size;message.receivedAt=now;memcpy(message.source,addresses[0],6);memcpy(message.data,wire,size);side=1;Target::receive(message);
  run(1000);assert(!writes);for(unsigned i=0;i<16;++i)assert(fleet[1][i]==99);assert(brokerStatus().find("\"phase\":\"complete\"")==std::string::npos);
 }
 else if(scenario=="nvs-failure"){
  persistence=false;approve();run(1500);assert(!paired[1]&&writes==1);assert(brokerStatus().find("\"phase\":\"failed\"")!=std::string::npos);assert(brokerStatus().find("\"confirmedAbsent\":false")!=std::string::npos);
 }
 else if(scenario=="replayed-offer"){
  const auto originalPattern=brokerStatus();side=0;assert(Broker::cancel(targetId,requestId,brokerId).status==200);deliver();run(1000);for(const auto& frame:captured)if(!memcmp(frame.bytes.data(),"CCO\1",4)){LampEspNow::Received message;message.length=frame.bytes.size();message.receivedAt=now;memcpy(message.source,addresses[0],6);memcpy(message.data,frame.bytes.data(),frame.bytes.size());side=1;Target::receive(message);break;}assert(!Target::physicalPending()&&!writes);(void)originalPattern;
 }
 else if(scenario=="blocked"){blocked=true;run(1);assert(!paired[1]&&!writes&&!radioHeld[0]&&!radioHeld[1]);side=1;Target::approvePhysical();assert(!writes);}
 else assert(false);
 assert(power==1&&group==0);std::cout<<"PASS commission "<<scenario<<" writes="<<writes<<" holds="<<holds<<"\n";
}
