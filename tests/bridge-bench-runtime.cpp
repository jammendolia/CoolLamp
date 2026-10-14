// Host SDK/storage adapters only. Decisions are production Artifact, Sender,
// and compile-time bench Session code; no fixture copies their admission rule.
#include "Arduino.h"
#include "bridge/BridgeArtifact.h"
#include "bridge/BridgeDonation.h"
#include "bridge/BridgeBench.h"
#include "BridgeBenchFixture.generated.h"
#include "LampHttpJson.h"
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
#include <vector>

using BridgeArtifact::Artifact;
using BridgeArtifact::Trust;
using namespace LampFirmwareRelayWire;

struct Memory {
 std::vector<uint8_t> bytes;
 bool fail=false;
 unsigned reads=0;
 size_t readBytes=0;
 static bool read(void* context,uint32_t at,uint8_t* out,size_t n){
  auto& memory=*static_cast<Memory*>(context);++memory.reads;memory.readBytes+=n;
  if(memory.fail||at>memory.bytes.size()||n>memory.bytes.size()-at)return false;
  memcpy(out,memory.bytes.data()+at,n);return true;
 }
 BridgeArtifact::Source source(){return {this,read,uint32_t(bytes.size())};}
};
Memory original;
void settleArtifact(Artifact& artifact){
 for(unsigned i=0;i<1000&&artifact.state()==BridgeArtifact::State::Verifying;++i){
  artifact.service(173);
 }
 assert(artifact.state()!=BridgeArtifact::State::Verifying);
}
std::string manifestFor(const Memory& memory,const char* version="1.15.5"){
 uint8_t digest[32];assert(!mbedtls_sha256(memory.bytes.data(),memory.bytes.size(),digest,0));
 char hex[65]{};for(unsigned i=0;i<32;++i)snprintf(hex+i*2,3,"%02x",digest[i]);
 char manifest[288]{};const int used=snprintf(manifest,sizeof(manifest),
  "COOLLAMP-OTA-1\n%s\nesp32c3\ndual-ota-2031616\n%lu\n%s\n",version,
  static_cast<unsigned long>(memory.bytes.size()),hex);
 assert(used>0&&size_t(used)<sizeof(manifest));return manifest;
}
void artifactGuards(){
 Memory memory=original;Artifact artifact;
 constexpr const char* pin=BridgeBenchFixture::Manifest;const size_t length=strlen(pin);
 assert(!artifact.begin(memory.source(),pin,length,Trust::None));
 assert(!artifact.begin(memory.source(),pin,length,static_cast<Trust>(254)));
 assert(!artifact.begin(memory.source(),pin,length,Trust::PublisherSignature));
 assert(artifact.begin(memory.source(),pin,length,Trust::HttpsPinnedLegacy));
 settleArtifact(artifact);
 // Diagnostic images cannot acquire normal public/HTTPS trust in either build.
 assert(!artifact.ready()&&artifact.error()==BridgeArtifact::Error::Untrusted);
#ifndef COOLLAMP_BRIDGE_BENCH
 const unsigned before=memory.reads;
 assert(!artifact.begin(memory.source(),pin,length,Trust::LocalPhysicalBench));
 assert(artifact.error()==BridgeArtifact::Error::Untrusted&&memory.reads==before);
#else
 assert(artifact.begin(memory.source(),pin,length,Trust::LocalPhysicalBench));
 const auto beforeBytes=memory.readBytes;artifact.service(SIZE_MAX);
 assert(memory.readBytes-beforeBytes<=4096); // Production service clamps callers.
 settleArtifact(artifact);assert(artifact.ready());
 uint8_t byte=0;assert(!artifact.read(uint32_t(memory.bytes.size()),&byte,1));
 assert(!artifact.ready());
 assert(artifact.begin(memory.source(),pin,length,Trust::LocalPhysicalBench));
 settleArtifact(artifact);assert(artifact.acquire());
 assert(!artifact.clear()&&!artifact.begin(memory.source(),pin,length,Trust::LocalPhysicalBench));
 assert(artifact.pinned()&&artifact.ready());artifact.release();assert(artifact.clear());
 std::string malformed=pin;malformed.insert(0," ");
 assert(!artifact.begin(memory.source(),malformed.data(),malformed.size(),Trust::LocalPhysicalBench));
 std::string wrongVersion=pin;wrongVersion.replace(wrongVersion.find("1.15.5"),6,"1.15.6");
 assert(!artifact.begin(memory.source(),wrongVersion.data(),wrongVersion.size(),Trust::LocalPhysicalBench));
 std::string wrongDigest=pin;const size_t digestAt=wrongDigest.find_last_of('\n',wrongDigest.size()-2)+1;
 wrongDigest[digestAt]=wrongDigest[digestAt]=='a'?'b':'a';
 assert(!artifact.begin(memory.source(),wrongDigest.data(),wrongDigest.size(),Trust::LocalPhysicalBench));
 auto source=memory.source();source.capacity--;
 assert(!artifact.begin(source,pin,length,Trust::LocalPhysicalBench));
 source=memory.source();source.read=nullptr;
 assert(!artifact.begin(source,pin,length,Trust::LocalPhysicalBench));
 memory=original;memory.bytes[12]=9;
 assert(!artifact.begin(memory.source(),pin,length,Trust::LocalPhysicalBench));
 assert(artifact.error()==BridgeArtifact::Error::Image);
 memory=original;memory.bytes[1]=17;
 assert(!artifact.begin(memory.source(),pin,length,Trust::LocalPhysicalBench));
 memory=original;memory.bytes[32]^=1;
 assert(!artifact.begin(memory.source(),pin,length,Trust::LocalPhysicalBench));
 memory=original;memory.bytes[25000]^=1;
 assert(artifact.begin(memory.source(),pin,length,Trust::LocalPhysicalBench));settleArtifact(artifact);
 assert(!artifact.ready()&&artifact.error()==BridgeArtifact::Error::Hash);
 memory=original;memory.fail=true;
 assert(!artifact.begin(memory.source(),pin,length,Trust::LocalPhysicalBench));
 // A different canonical image/hash is still not the exact compiled bench pin.
 memory=original;memory.bytes[40000]^=1;const auto different=manifestFor(memory);
 assert(!artifact.begin(memory.source(),different.data(),different.size(),Trust::LocalPhysicalBench));
#endif
}

#ifdef COOLLAMP_BRIDGE_BENCH
using BridgeBench::Session;
struct LocalSession {
 Memory memory=original;Artifact artifact;Session session;BridgeDonation::Snapshot sender;
 uint32_t now=100000;
 bool arm(unsigned bank=0,bool eligible=true){return session.arm(artifact,memory.source(),uint16_t(bank),now,eligible,sender);}
 void settle(){for(unsigned i=0;i<1000&&session.running()&&!session.donating();++i){session.service(artifact,sender,now);++now;}assert(!session.running()||session.donating());}
};
void sessionGuards(){
 const uint8_t wrong[6]={0x24,0xec,0x4a,0xaf,0x94,0x59};
 for(unsigned bank=0;bank<2;++bank){
  LocalSession test;assert(!test.session.used()&&!test.session.active());
  assert(!test.session.allowsReceiver(BridgeBenchFixture::TargetMac));
  const unsigned before=test.memory.reads;
  assert(!test.arm(bank,false)&&!test.session.used()&&test.memory.reads==before);
  assert(!test.arm(2)&&!test.session.used());
  test.sender.sending=true;assert(!test.arm(bank)&&!test.session.used());test.sender.sending=false;
  assert(test.arm(bank)&&test.session.used()&&test.session.active()&&!test.session.donating());
  assert(!test.arm(bank));test.settle();
  assert(test.session.donating()&&test.session.allowsReceiver(BridgeBenchFixture::TargetMac));
  assert(!test.session.allowsReceiver(wrong)&&!test.session.allowsReceiver(nullptr));
  const auto status=test.session.statusJson(uint16_t(bank),0x410000,true,test.now);
  assert(LampHttpJson::complete(status.c_str(),status.length()));
  assert(status.find("\"durable\":false")!=std::string::npos&&status.find("local-physical-bench")!=std::string::npos);
  assert(status.find("\"seedBank\":"+std::to_string(1-bank))!=std::string::npos);
  assert(status.find("\"seedAllowed\":false")!=std::string::npos);
  const auto pin=manifestFor(test.memory);const size_t digestAt=pin.find_last_of('\n',pin.size()-2)+1;
  assert(status.find("\"sha256\":\""+pin.substr(digestAt,64)+"\"")!=std::string::npos);
  const auto invalidStatus=test.session.statusJson(2,0,true,test.now);
  assert(invalidStatus.find("\"seedBank\":null")!=std::string::npos&&invalidStatus.find("\"seedFlashOffset\":null")!=std::string::npos);
  // Fresh volatile session has no automatic arm, even when storage has a valid image.
  Session restarted;restarted.service(test.artifact,test.sender,test.now);
  assert(!restarted.active()&&!restarted.donating()&&!restarted.used());
  assert(!restarted.allowsReceiver(BridgeBenchFixture::TargetMac));
  test.sender.completed++;
  test.session.service(test.artifact,test.sender,++test.now);
  assert(test.session.needsRestore()&&!test.session.donating());
  test.session.beginRestore();test.session.restored(true);
  assert(!test.session.active()&&test.session.used()&&!test.arm(bank));
  assert(test.session.statusJson(bank,0x410000,true,test.now).find("\"phase\":\"complete\"")!=std::string::npos);
 }
 for(unsigned outcome=0;outcome<4;++outcome){
  LocalSession test;assert(test.arm());test.settle();
  if(outcome==0)test.sender.failed++;
  else if(outcome==1){test.sender.sending=true;test.session.service(test.artifact,test.sender,++test.now);test.sender.sending=false;}
  else if(outcome==2)test.now+=BridgeBenchFixture::LifetimeMs;
  else {assert(test.artifact.clear());}
  test.session.service(test.artifact,test.sender,test.now);
  assert(test.session.needsRestore()&&!test.session.donating());
  assert(!test.session.allowsReceiver(BridgeBenchFixture::TargetMac));
  test.session.beginRestore();test.session.restored(true);
  assert(!test.session.active()&&!test.arm());
 }
 LocalSession bad;bad.memory.bytes[12]=9;
 assert(bad.arm()&&bad.session.used()&&bad.session.needsRestore());
 bad.session.beginRestore();bad.session.restored(false);assert(!bad.session.active()&&!bad.arm());
 LocalSession rollover;rollover.now=UINT32_MAX-500;
 assert(rollover.arm());rollover.settle();
 rollover.now+=BridgeBenchFixture::LifetimeMs;rollover.session.service(rollover.artifact,rollover.sender,rollover.now);
 assert(rollover.session.needsRestore());
 LocalSession pinned;assert(pinned.arm());pinned.settle();assert(pinned.artifact.acquire());
 pinned.sender.sending=true;pinned.now+=BridgeBenchFixture::LifetimeMs;
 pinned.session.service(pinned.artifact,pinned.sender,pinned.now);
 assert(pinned.session.needsRestore()&&!pinned.artifact.clear());
 pinned.artifact.release();assert(pinned.artifact.clear());pinned.session.beginRestore();pinned.session.restored(true);
}
constexpr uint8_t self[6]={0x02,0,0,0,0,1},other[6]={0x24,0xec,0x4a,0xaf,0x94,0x59},broadcast[6]={255,255,255,255,255,255};
constexpr uint8_t fleet[16]={1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16};
struct Packet {std::vector<uint8_t> bytes;uint8_t destination[6]{};};
struct Radio {
 Session* session=nullptr;std::vector<Packet> packets;uint64_t random=17;bool suppress=false;
 static bool send(void* context,const uint8_t* bytes,size_t n,const uint8_t* target){auto& radio=*static_cast<Radio*>(context);Packet p;p.bytes={bytes,bytes+n};memcpy(p.destination,target,6);radio.packets.push_back(p);return true;}
 static uint64_t nonce(void* context){return ++static_cast<Radio*>(context)->random;}
 static bool allow(void* context,const uint8_t* target){return static_cast<Radio*>(context)->session->allowsReceiver(target);}
 static const uint8_t* target(void* context){auto& radio=*static_cast<Radio*>(context);return !radio.suppress&&radio.session->donating()?radio.session->targetMac():nullptr;}
 BridgeDonation::Hooks hooks(){return {this,send,nonce,nullptr,allow,target};}
};
void senderFence(){
 LocalSession test;assert(test.arm());test.settle();Radio radio;radio.session=&test.session;
 BridgeDonation::Sender sender;assert(sender.begin(self,fleet,7,radio.hooks()));assert(sender.setArtifact(&test.artifact));
 sender.service(test.now,true);assert(radio.packets.size()==1);
 const auto offer=radio.packets.back();assert(!memcmp(offer.destination,BridgeBenchFixture::TargetMac,6));
 uint8_t plain[BodyLimit]{};size_t used=0;
 assert(LampFirmwareRelayCrypto::open(offer.bytes.data(),offer.bytes.size(),self,BridgeBenchFixture::TargetMac,fleet,plain,used)&&plain[0]==Offer);
 const uint64_t token=u64(plain+43);
 assert(!LampFirmwareRelayCrypto::open(offer.bytes.data(),offer.bytes.size(),self,broadcast,fleet,plain,used));
 assert(!LampFirmwareRelayCrypto::open(offer.bytes.data(),offer.bytes.size(),self,other,fleet,plain,used));
 auto request=[&](const uint8_t* mac,uint32_t sequence){
  uint8_t body[49]{Request},wire[250];put64(body+1,77);memcpy(body+9,test.artifact.metadata().image.sha256,32);put64(body+41,token);
  assert(LampFirmwareRelayCrypto::seal(body,sizeof(body),mac,self,fleet,11,sequence,wire));
  assert(sender.receive(mac,wire,Header+sizeof(body)+Tag,test.now,test.now));
 };
 request(other,1);assert(!sender.sending()&&!test.artifact.pinned());
 request(BridgeBenchFixture::TargetMac,1);assert(sender.sending()&&test.artifact.pinned());
 test.session.service(test.artifact,sender.snapshot(),++test.now);assert(test.session.donating());
 // Expiry removes new admission but must not overwrite a source still pinned.
 test.now+=BridgeBenchFixture::LifetimeMs;test.session.service(test.artifact,sender.snapshot(),test.now);
 assert(test.session.needsRestore()&&!test.artifact.clear());
 sender.cancel();assert(!test.artifact.pinned());test.session.beginRestore();test.session.restored(true);
 const size_t packets=radio.packets.size();sender.service(test.now+10000,true);
 assert(radio.packets.size()==packets); // The optional callback suppresses idle offers.
 // Normal sender without target callback preserves legacy broadcast behavior.
 sender.cancel();auto hooks=radio.hooks();hooks.offerTarget=nullptr;
 assert(sender.begin(self,fleet,9,hooks));assert(sender.setArtifact(&test.artifact));sender.service(test.now+20000,true);
 assert(radio.packets.size()==packets+1&&!memcmp(radio.packets.back().destination,broadcast,6));
 assert(LampFirmwareRelayCrypto::open(radio.packets.back().bytes.data(),radio.packets.back().bytes.size(),self,broadcast,fleet,plain,used));
}
#endif

int main(int argc,char** argv){
 assert(argc==2);std::ifstream stream(argv[1],std::ios::binary);assert(stream);
 original.bytes={std::istreambuf_iterator<char>(stream),std::istreambuf_iterator<char>()};
 assert(original.bytes.size()==65584);
 artifactGuards();
#ifdef COOLLAMP_BRIDGE_BENCH
 sessionGuards();senderFence();std::cout<<"PASS bench pins, bounds, lifetime, one-shot/reboot, status, source pin and exact target-derived donor offers/admission\n";
#else
 std::cout<<"PASS default bridge refuses local/unknown/diagnostic release trust\n";
#endif
}
