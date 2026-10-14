#include "bridge/BridgeArtifact.h"
#include "bridge/BridgeDonation.h"
#include <mbedtls/sha256.h>
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

namespace {
using namespace LampFirmwareRelayWire;
using Artifact=BridgeArtifact::Artifact;
const uint8_t self[6]={0x24,0xec,0x4a,0,0,1},peer[6]={0x80,0xf1,0xb2,0,0,2},other[6]={0x80,0xf1,0xb2,0,0,3};
const uint8_t broadcast[6]={255,255,255,255,255,255},fleet[16]={1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16};
constexpr uint64_t PeerBoot=0x12345678,Session=0x3456789a;
struct Memory {
 std::vector<uint8_t> bytes;
 bool fail=false;
 unsigned calls=0;
 static bool read(void* ctx,uint32_t at,uint8_t* out,size_t n){auto& m=*static_cast<Memory*>(ctx);++m.calls;if(m.fail||at>m.bytes.size()||n>m.bytes.size()-at)return false;memcpy(out,m.bytes.data()+at,n);return true;}
 BridgeArtifact::Source source(){return {this,read,uint32_t(bytes.size())};}
};
Memory image(bool marker=true){
 Memory m;m.bytes.resize(65584);m.bytes[0]=0xe9;m.bytes[1]=1;m.bytes[12]=5;m.bytes[23]=1;put32(m.bytes.data()+28,65504);put32(m.bytes.data()+32,0xabcd5432);
 if(marker){constexpr char tag[]="COOLLAMP-PUBLIC-1.15.4";memcpy(m.bytes.data()+507,tag,sizeof(tag));}
 return m;
}
std::string manifest(const Memory& memory){
 uint8_t digest[32];assert(mbedtls_sha256(memory.bytes.data(),memory.bytes.size(),digest,0)==0);char hex[65]{},text[288]{};
 for(unsigned i=0;i<32;++i)snprintf(hex+i*2,3,"%02x",digest[i]);
 snprintf(text,sizeof(text),"COOLLAMP-OTA-1\n1.15.4\nesp32c3\ndual-ota-2031616\n%lu\n%s\n",static_cast<unsigned long>(memory.bytes.size()),hex);return text;
}
void ready(Artifact& artifact,Memory& memory){const auto text=manifest(memory);assert(artifact.begin(memory.source(),text.data(),text.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));while(artifact.state()==BridgeArtifact::State::Verifying)artifact.service(173);assert(artifact.ready());}
struct Packet {std::vector<uint8_t> wire;uint8_t destination[6]{};};
struct Radio {
 std::vector<Packet> packets;
 bool fail=false;
 uint64_t random=0x1122334400000000;
 unsigned holds=0;
 bool receiverAllowed=true;
 static bool send(void* ctx,const uint8_t* wire,size_t n,const uint8_t* destination){auto& r=*static_cast<Radio*>(ctx);assert(n<=250);if(r.fail)return false;Packet p;p.wire.assign(wire,wire+n);memcpy(p.destination,destination,6);r.packets.push_back(p);return true;}
 static uint64_t nonce(void* ctx){return ++static_cast<Radio*>(ctx)->random;}
 static void hold(void* ctx,uint32_t){++static_cast<Radio*>(ctx)->holds;}
 static bool allow(void* ctx,const uint8_t*){return static_cast<Radio*>(ctx)->receiverAllowed;}
 BridgeDonation::Hooks hooks(){return {this,send,nonce,hold,allow};}
};
std::vector<uint8_t> decode(const Packet& packet){
 uint8_t plain[BodyLimit];size_t n=0;assert(LampFirmwareRelayCrypto::open(packet.wire.data(),packet.wire.size(),self,packet.destination,fleet,plain,n));return {plain,plain+n};
}
void incoming(BridgeDonation::Sender& sender,const uint8_t* body,size_t n,uint32_t sequence,uint32_t now,const uint8_t* source=peer,uint64_t boot=PeerBoot,const uint8_t* key=fleet,uint32_t age=0){
 uint8_t wire[250];assert(LampFirmwareRelayCrypto::seal(body,n,source,self,key,boot,sequence,wire));assert(sender.receive(source,wire,Header+n+Tag,now-age,now));
}
void acknowledge(BridgeDonation::Sender& sender,uint32_t written,uint8_t code,uint32_t sequence,uint32_t now,uint64_t session=Session,const uint8_t* source=peer,uint64_t boot=PeerBoot){
 uint8_t body[14]{Ack};put64(body+1,session);put32(body+9,written);body[13]=code;incoming(sender,body,sizeof(body),sequence,now,source,boot);
}
struct Fixture {
 Memory memory=image();Artifact artifact;Radio radio;BridgeDonation::Sender sender;
 uint32_t now=40000,sequence=1;
 Fixture(){ready(artifact,memory);assert(sender.begin(self,fleet,0x123456789abcdef,radio.hooks()));assert(sender.setArtifact(&artifact));}
 std::vector<uint8_t> offer(){sender.service(now,true);assert(!radio.packets.empty());auto body=decode(radio.packets.back());assert(body[0]==Offer);assert(!memcmp(radio.packets.back().destination,broadcast,6));return body;}
 void request(const std::vector<uint8_t>& offer,const uint8_t* source=peer,const uint8_t* key=fleet,uint32_t age=0){uint8_t body[49]{Request};put64(body+1,Session);memcpy(body+9,offer.data()+11,32);put64(body+41,u64(offer.data()+43));incoming(sender,body,sizeof(body),sequence++,now,source,PeerBoot,key,age);}
 void start(){request(offer());assert(sender.sending()&&artifact.pinned());sender.service(now,true);auto ack=decode(radio.packets.back());assert(ack[0]==Ack&&ack[13]==0);acknowledge(sender,0,1,sequence++,now);assert(sender.snapshot().receiverReady);}
};
void artifactGates(){
 Memory memory=image();Artifact artifact;std::string text=manifest(memory);
 assert(!artifact.begin(memory.source(),text.data(),text.size(),BridgeArtifact::Trust::None));assert(artifact.error()==BridgeArtifact::Error::Untrusted);
 assert(!artifact.begin(memory.source(),text.data(),text.size(),BridgeArtifact::Trust::PublisherSignature));
 auto shortSource=memory.source();--shortSource.capacity;assert(!artifact.begin(shortSource,text.data(),text.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));
 std::string wrongTarget=text;wrongTarget.replace(wrongTarget.find("esp32c3"),7,"esp32s3");assert(!artifact.begin(memory.source(),wrongTarget.data(),wrongTarget.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));
 std::string extra=text+"\n";assert(!artifact.begin(memory.source(),extra.data(),extra.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));
 std::string noncanonical=text;noncanonical.insert(noncanonical.find("65584"),"0");assert(!artifact.begin(memory.source(),noncanonical.data(),noncanonical.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));
 memory.bytes[12]=9;text=manifest(memory);assert(!artifact.begin(memory.source(),text.data(),text.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));assert(artifact.error()==BridgeArtifact::Error::Image);
 memory=image();memory.bytes[28]=1;text=manifest(memory);assert(!artifact.begin(memory.source(),text.data(),text.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));
 memory=image(false);text=manifest(memory);assert(artifact.begin(memory.source(),text.data(),text.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));while(artifact.state()==BridgeArtifact::State::Verifying)artifact.service();assert(artifact.error()==BridgeArtifact::Error::Marker);
 memory=image();text=manifest(memory);memory.bytes[600]^=1;assert(artifact.begin(memory.source(),text.data(),text.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));while(artifact.state()==BridgeArtifact::State::Verifying)artifact.service();assert(artifact.error()==BridgeArtifact::Error::Hash);
 memory=image();text=manifest(memory);assert(artifact.begin(memory.source(),text.data(),text.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));artifact.service(SIZE_MAX);assert(artifact.verifiedBytes()==4096);while(artifact.state()==BridgeArtifact::State::Verifying)artifact.service();assert(artifact.ready());assert(artifact.acquire());assert(!artifact.begin(memory.source(),text.data(),text.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));assert(artifact.ready());assert(!artifact.clear());artifact.release();assert(artifact.clear());
 memory=image();text=manifest(memory);memory.fail=true;assert(!artifact.begin(memory.source(),text.data(),text.size(),BridgeArtifact::Trust::HttpsPinnedLegacy));assert(artifact.error()==BridgeArtifact::Error::Read);
}
void authenticationAndAdmission(){
 Fixture f;auto offer=f.offer();assert(offer.size()==51&&offer[1]==1&&offer[3]==15&&offer[5]==4&&u32(offer.data()+7)==f.memory.bytes.size());
 uint8_t wrongKey[16]{};wrongKey[0]=0xff;f.request(offer,peer,wrongKey);assert(!f.sender.sending());f.request(offer,peer,fleet,1501);assert(!f.sender.sending());
 auto wrongHash=offer;wrongHash[11]^=1;f.request(wrongHash);assert(!f.sender.sending());
 auto wrongToken=offer;wrongToken[43]^=1;f.request(wrongToken);assert(!f.sender.sending());
 uint8_t broken[4]={'C','L','F',1};assert(f.sender.receive(peer,broken,4,f.now,f.now));assert(!f.sender.sending());
 f.now+=10000;auto newer=f.offer();f.request(offer);assert(!f.sender.sending());f.request(newer);assert(f.sender.sending());assert(!f.sender.setArtifact(nullptr));f.request(newer,other);assert(f.sender.sending());
 f.sender.cancel();assert(!f.artifact.pinned());f.request(newer);assert(!f.sender.sending());
}
void excludedReceiverAdmission(){
 Fixture f;f.radio.receiverAllowed=false;auto offer=f.offer();f.request(offer);assert(!f.sender.sending()&&!f.artifact.pinned());
 f.radio.receiverAllowed=true;f.request(offer);assert(f.sender.sending()&&f.artifact.pinned());
 f.radio.receiverAllowed=false;f.sender.service(f.now,true);assert(f.sender.sending());
 f.sender.cancel();assert(!f.artifact.pinned());
}
void offsetsRetryAndCompletion(){
 Fixture f;f.start();uint32_t offset=0;std::vector<uint8_t> received;
 // Wrong MAC, boot, session and replayed sequence cannot admit a data ACK.
 acknowledge(f.sender,201,1,f.sequence++,f.now,Session,other);assert(f.sender.snapshot().written==0);
 acknowledge(f.sender,201,1,f.sequence++,f.now,Session,peer,PeerBoot+1);assert(f.sender.snapshot().written==0);
 acknowledge(f.sender,201,1,f.sequence++,f.now,Session+1);assert(f.sender.snapshot().written==0);
 f.radio.fail=true;f.sender.service(f.now,true);acknowledge(f.sender,201,1,f.sequence++,f.now);assert(f.sender.snapshot().written==0);
 f.radio.fail=false;f.now+=750;f.sender.service(f.now,true);auto chunk=decode(f.radio.packets.back());assert(chunk[0]==Data&&u32(chunk.data()+9)==0);
 // Lost data ACK repeats the same offset and bytes, despite a fresh AEAD nonce.
 auto original=chunk;f.now+=750;f.sender.service(f.now,true);chunk=decode(f.radio.packets.back());assert(chunk==original);
 acknowledge(f.sender,402,1,f.sequence++,f.now);assert(f.sender.snapshot().written==0);
 acknowledge(f.sender,201,1,f.sequence-2,f.now);assert(f.sender.snapshot().written==0);
 while(offset<f.memory.bytes.size()){
  f.sender.service(f.now,true);chunk=decode(f.radio.packets.back());assert(chunk[0]==Data&&u32(chunk.data()+9)==offset);assert(chunk.size()>=14&&chunk.size()<=214);
  received.insert(received.end(),chunk.begin()+13,chunk.end());offset+=uint32_t(chunk.size()-13);acknowledge(f.sender,offset,1,f.sequence++,f.now);assert(f.sender.snapshot().written==offset);
  // An already acknowledged chunk must not advance the next offset.
  acknowledge(f.sender,offset,1,f.sequence++,f.now);++f.now;
 }
 assert(received==f.memory.bytes);acknowledge(f.sender,offset,2,f.sequence++,f.now);assert(f.sender.sending());
 f.sender.service(f.now,true);auto finish=decode(f.radio.packets.back());assert(finish[0]==Finish);f.now+=750;f.sender.service(f.now,true);assert(decode(f.radio.packets.back())==finish);
 acknowledge(f.sender,offset,2,f.sequence++,f.now);assert(!f.sender.sending()&&!f.artifact.pinned());auto status=f.sender.snapshot();assert(status.completed==1&&status.failed==0&&status.lastResult==BridgeDonation::Result::Complete);assert(f.radio.holds>0);
}
void expiryRadioAndRead(){
 {Fixture f;f.start();f.now+=20001;f.sender.service(f.now,true);assert(!f.sender.sending()&&!f.artifact.pinned());assert(f.sender.snapshot().lastResult==BridgeDonation::Result::Timeout);}
 {Fixture f;f.start();f.sender.service(f.now,false);assert(!f.sender.sending()&&!f.artifact.pinned());assert(f.sender.snapshot().lastResult==BridgeDonation::Result::RadioLost);}
 {Fixture f;f.start();f.memory.fail=true;f.sender.service(f.now,true);assert(!f.sender.sending()&&!f.artifact.pinned()&&!f.artifact.ready());assert(f.sender.snapshot().lastResult==BridgeDonation::Result::ReadError);const auto count=f.radio.packets.size();f.now+=10000;f.sender.service(f.now,true);assert(f.radio.packets.size()==count);}
 {Fixture f;f.now=UINT32_MAX-1000;f.start();f.sender.service(f.now,true);assert(f.sender.sending());f.now+=20001;f.sender.service(f.now,true);assert(!f.sender.sending());}
 {Fixture f;f.start();const uint32_t started=f.now;uint32_t offset=0;while(uint32_t(f.now-started)<=900000){f.sender.service(f.now,true);if(!f.sender.sending())break;auto data=decode(f.radio.packets.back());assert(data[0]==Data);offset+=uint32_t(data.size()-13);acknowledge(f.sender,offset,1,f.sequence++,f.now);f.now+=19000;}f.sender.service(f.now,true);assert(!f.sender.sending()&&f.sender.snapshot().lastResult==BridgeDonation::Result::Timeout);}
}
struct SignatureFixture {UpdatePublisher::Manifest metadata{};std::string original;unsigned calls=0;};
bool publisher(void* context,const char* text,size_t n,UpdatePublisher::Manifest& output){auto& fixture=*static_cast<SignatureFixture*>(context);++fixture.calls;if(fixture.original.size()!=n||memcmp(text,fixture.original.data(),n))return false;output=fixture.metadata;return true;}
void signedOriginalMetadata(){
 Memory memory=image();const auto unsignedText=manifest(memory);SignatureFixture fixture;char copy[288]{};memcpy(copy,unsignedText.data(),unsignedText.size());assert(parseFirmwareManifest(copy,fixture.metadata.image));fixture.metadata.epoch=7;fixture.metadata.keyId=0x42;for(unsigned i=0;i<64;++i)fixture.metadata.signature[i]=uint8_t(i+1);
 char digest[65]{},signature[129]{},text[288]{};for(unsigned i=0;i<32;++i)snprintf(digest+2*i,3,"%02x",fixture.metadata.image.sha256[i]);for(unsigned i=0;i<64;++i)snprintf(signature+2*i,3,"%02x",fixture.metadata.signature[i]);
 snprintf(text,sizeof(text),"COOLLAMP-OTA-2\n1.15.4\nesp32c3\ndual-ota-2031616\n65584\n%s\n7\n00000042\n%s\n",digest,signature);fixture.original=text;
 // The caller's signature verifier is an injected trust boundary. This fixture
 // tests rejection and exact original metadata retention/serialization; AEAD
 // and image hashes above use real crypto, not this verification adapter.
 Artifact artifact;assert(!artifact.begin(memory.source(),text,strlen(text),BridgeArtifact::Trust::PublisherSignature));assert(artifact.begin(memory.source(),text,strlen(text),BridgeArtifact::Trust::PublisherSignature,publisher,&fixture));while(artifact.state()==BridgeArtifact::State::Verifying)artifact.service();assert(artifact.ready());assert(artifact.metadata().originalLength==fixture.original.size());assert(!memcmp(artifact.metadata().original,text,strlen(text)));
 Radio radio;BridgeDonation::Sender sender;assert(sender.begin(self,fleet,5,radio.hooks()));assert(sender.setArtifact(&artifact));sender.service(40000,true);auto offer=decode(radio.packets.back());assert(offer[0]==SignedOffer&&offer.size()==123);assert(u32(offer.data()+51)==7&&u32(offer.data()+55)==0x42&&!memcmp(offer.data()+59,fixture.metadata.signature,64));assert(fixture.calls==1);
 std::string corrupt=fixture.original;corrupt[corrupt.size()-3]^=1;assert(!artifact.begin(memory.source(),corrupt.data(),corrupt.size(),BridgeArtifact::Trust::PublisherSignature,publisher,&fixture));assert(artifact.error()==BridgeArtifact::Error::Untrusted);
}
}
int main(){artifactGates();authenticationAndAdmission();excludedReceiverAdmission();offsetsRetryAndCompletion();expiryRadioAndRead();signedOriginalMetadata();std::cout<<"PASS bridge: C3 artifact on independent host, trust/hash/header/marker gates, bounded cache reads/pinning, real CLF1 AES-GCM, serving-policy admission/replay/offset ACKs, loss retries, expiry/radio/read failure, exact original signed metadata\n";}
