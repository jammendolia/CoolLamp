#include "LampMeshCore.h"
#include <assert.h>
#include <deque>
#include <iostream>
#include <memory>
#include <string>
#include <vector>
using namespace LampMeshWire;
using LampMesh::Core;
struct Envelope {unsigned sender;std::vector<uint8_t> bytes;};
struct Network;
struct Node {
 Network* network=nullptr;unsigned id=0,executions=0;uint8_t mac[6]{2,0,0,0,0,0},key[16]{};
 uint64_t boot=0;Core core;bool enabled=true,allowSend=true,sendBlocked=false;int untrusted=-1;
 size_t responseSize=8192;
};
struct Network {
 std::vector<std::unique_ptr<Node>> nodes;std::deque<Envelope> queue;
 std::vector<Envelope> captured;uint32_t now=0;unsigned sent=0;
 bool dropExecuted=false,dropResponses=false,dropFragment=false,fragmentDropped=false,duplicate=false,reorder=false;
 bool holdFirst=false,firstHeld=false,outOfOrder=false;Envelope held{};
 static bool trust(void* context,const uint8_t* address){auto& node=*static_cast<Node*>(context);return mac(address)&&int(address[5])!=node.untrusted;}
 static bool send(void* context,const uint8_t* bytes,size_t size){
  auto& node=*static_cast<Node*>(context);if(node.sendBlocked)return false;
  assert(size<=250);Envelope e{node.id,{bytes,bytes+size}};node.network->queue.push_back(e);node.network->captured.push_back(e);++node.network->sent;return true;
 }
 static uint16_t execute(void* context,const uint8_t*,uint64_t,const uint8_t* request,size_t size,uint8_t* out,size_t capacity,size_t& outputSize){
  auto& node=*static_cast<Node*>(context);++node.executions;assert(size==1024||size==2);for(size_t i=0;i<size;++i)assert(request[i]==uint8_t(i%251));
  outputSize=node.responseSize;assert(outputSize<=capacity);for(size_t i=0;i<outputSize;++i)out[i]=uint8_t((i*7+node.id)%251);return 200;
 }
 explicit Network(unsigned count=3){
  for(unsigned i=0;i<count;++i){auto node=std::make_unique<Node>();node->network=this;node->id=i;node->mac[5]=uint8_t(i+1);node->boot=1000+i;for(unsigned k=0;k<16;++k)node->key[k]=uint8_t(k+1);nodes.push_back(std::move(node));}
  for(auto& node:nodes)begin(*node);
 }
 void begin(Node& node){assert(node.core.begin(node.mac,node.key,node.boot,{&node,trust,send,execute}));node.core.setAnnouncement(("lamp-"+std::to_string(node.id)).c_str(),"1.11.0",node.id==0);}
 bool adjacent(unsigned a,unsigned b)const{return a+1==b||b+1==a;}
 void deliver(){
  while(!queue.empty()){
   Envelope e=reorder?queue.back():queue.front();if(reorder)queue.pop_back();else queue.pop_front();
   Packet p;uint8_t plain[PayloadLimit];assert(LampMeshCrypto::open(e.bytes.data(),e.bytes.size(),nodes[e.sender]->key,nodes[e.sender]->mac,p,plain));
   if(dropExecuted&&p.kind==Receipt&&plain[0]==Executed)continue;
   if(dropResponses&&p.kind==Response)continue;
   if(dropFragment&&!fragmentDropped&&p.kind==Request&&p.index==2){fragmentDropped=true;continue;}
   if(holdFirst&&!firstHeld&&e.sender==1&&p.kind==Request&&p.index==0){held=e;firstHeld=true;continue;}
   for(auto& node:nodes)if(node->enabled&&adjacent(e.sender,node->id)){
    node->core.receive(nodes[e.sender]->mac,e.bytes.data(),e.bytes.size(),now);
    if(duplicate)node->core.receive(nodes[e.sender]->mac,e.bytes.data(),e.bytes.size(),now);
   }
   if(holdFirst&&firstHeld&&!held.bytes.empty()&&e.sender==1&&p.kind==Request&&p.index==1){outOfOrder=true;queue.push_back(held);held.bytes.clear();}
  }
 }
 void run(unsigned milliseconds){for(unsigned i=0;i<milliseconds;++i){for(auto& node:nodes)if(node->enabled)node->core.service(now,node->allowSend);deliver();++now;}}
 void warm(){run(6000);assert(nodes[0]->core.online(nodes[2]->mac,now));assert(nodes[2]->core.online(nodes[0]->mac,now));}
 void start(uint64_t id=99,size_t size=1024){std::vector<uint8_t> bytes(size);for(size_t i=0;i<size;++i)bytes[i]=uint8_t(i%251);assert(nodes[0]->core.startRequest(nodes[2]->mac,id,bytes.data(),size,now));}
 void success(){const auto& r=nodes[0]->core.result();assert(r.state==LampMesh::State::Complete);assert(r.executed&&r.status==200&&r.length==nodes[2]->responseSize&&r.targetBoot==nodes[2]->boot);for(size_t i=0;i<r.length;++i)assert(r.body[i]==uint8_t((i*7+2)%251));}
 const Envelope& capturedKind(uint8_t kind,unsigned sender)const{for(const auto& e:captured){Packet p;if(e.sender==sender&&decode(e.bytes.data(),e.bytes.size(),p)&&p.kind==kind)return e;}assert(false);return captured[0];}
};
void crypto(){
 uint8_t fleet[16],a[6]{2,1,2,3,4,5},b[6]{2,1,2,3,4,6},c[6]{2,1,2,3,4,7};for(unsigned i=0;i<16;++i)fleet[i]=uint8_t(i+1);
 Packet p;memcpy(p.origin,a,6);memcpy(p.target,c,6);p.boot=123;p.targetBoot=456;p.requestId=789;p.sequence=1;p.kind=Request;p.payloadSize=p.totalSize=2;
 uint8_t body[2]{1,2},sealed[250]{},decoded[160]{},second[250]{},retry[250]{};size_t size=0,n=0;assert(LampMeshCrypto::seal(p,body,fleet,a,3,0,sealed,size));
 Packet opened;assert(LampMeshCrypto::open(sealed,size,fleet,a,opened,decoded)&&!memcmp(decoded,body,2));
 for(size_t i=0;i<size;++i){sealed[i]^=1;assert(!LampMeshCrypto::open(sealed,size,fleet,a,opened,decoded));sealed[i]^=1;}
 assert(!LampMeshCrypto::open(sealed,size,fleet,b,opened,decoded));uint8_t wrong[16]{};assert(!LampMeshCrypto::open(sealed,size,wrong,a,opened,decoded));
 // Changing only sequence must change the AES-GCM keystream. This directly
 // detects accidental use of boot+targetBoot as nonce instead of boot+sequence.
 ++p.sequence;assert(LampMeshCrypto::seal(p,body,fleet,a,3,0,second,n));assert(memcmp(sealed+HeaderSize+HopSize,second+HeaderSize+HopSize,2));
 --p.sequence;assert(LampMeshCrypto::seal(p,body,fleet,a,3,1,retry,n));assert(!memcmp(sealed,retry,HeaderSize));assert(!memcmp(sealed+HeaderSize+HopSize,retry+HeaderSize+HopSize,2+TagSize));
 assert(LampMeshCrypto::forward(sealed,size,fleet,b,second));assert(second[HeaderSize]==2);assert(LampMeshCrypto::open(second,size,fleet,b,opened,decoded));assert(!LampMeshCrypto::open(second,size,fleet,a,opened,decoded));
}
const LampMesh::Peer& peer(const Core& core,const uint8_t* address){for(unsigned i=0;i<LampMesh::MaxPeers;++i)if(same(core.peers()[i].mac,address))return core.peers()[i];assert(false);return core.peers()[0];}
void inject(Node& origin,Node& target,Packet& p,const uint8_t* bytes,uint32_t now,bool expected=true){uint8_t wire[250];size_t size=0;assert(LampMeshCrypto::seal(p,bytes,origin.key,origin.mac,3,0,wire,size));assert(target.core.receive(origin.mac,wire,size,now)==expected);}
int main(int argc,char** argv){
 assert(argc==2);const std::string scenario=argv[1];
 if(scenario=="crypto"){crypto();std::cout<<"PASS mesh crypto every-byte tamper, physical-source/key binding, distinct nonce, identical retry ciphertext\n";return 0;}
 if(scenario=="ttl"){
  Network mesh(6);mesh.run(10000);assert(mesh.nodes[0]->core.online(mesh.nodes[4]->mac,mesh.now));assert(!mesh.nodes[0]->core.online(mesh.nodes[5]->mac,mesh.now));assert(mesh.sent<6000);std::cout<<"PASS mesh TTL four hops, no fifth-hop discovery\n";return 0;
 }
 Network mesh;
 if(scenario=="wrong-fleet"){mesh.nodes[2]->key[0]^=1;++mesh.nodes[2]->boot;mesh.begin(*mesh.nodes[2]);mesh.run(7000);assert(!mesh.nodes[0]->core.online(mesh.nodes[2]->mac,mesh.now));mesh.start();assert(mesh.nodes[0]->core.result().failure==LampMesh::Failure::NoRoute);assert(!mesh.nodes[2]->executions);}
 else if(scenario=="wrong-target-trust"){mesh.nodes[1]->untrusted=3;mesh.run(7000);assert(!mesh.nodes[0]->core.online(mesh.nodes[2]->mac,mesh.now));mesh.start();assert(!mesh.nodes[2]->executions);}
 else if(scenario=="capacity"){
  uint8_t source[6]{2,9,9,9,9,1};uint8_t plain[3]{},sealed[250];size_t n=0;
  for(unsigned i=0;i<17;++i){source[5]=uint8_t(i+10);Packet p;memcpy(p.origin,source,6);p.boot=50+i;p.sequence=1;p.kind=Presence;p.payloadSize=p.totalSize=3;assert(LampMeshCrypto::seal(p,plain,mesh.nodes[0]->key,source,3,0,sealed,n));const bool accepted=mesh.nodes[0]->core.receive(source,sealed,n,mesh.now);assert(accepted==(i<16));}
  unsigned count=0;for(unsigned i=0;i<LampMesh::MaxPeers;++i)if(mac(mesh.nodes[0]->core.peers()[i].mac))++count;assert(count==16);
 }
 else{
  mesh.warm();
  if(scenario=="peer-expiry"){
   mesh.nodes[2]->enabled=false;mesh.run(LampMesh::PeerTimeout+1000);assert(!mesh.nodes[0]->core.online(mesh.nodes[2]->mac,mesh.now));mesh.nodes[2]->enabled=true;mesh.run(6000);assert(mesh.nodes[0]->core.online(mesh.nodes[2]->mac,mesh.now));
  }
  else if(scenario=="boot-rollover"){
   const Envelope old=mesh.capturedKind(Presence,1);const uint64_t oldBoot=mesh.nodes[2]->boot;mesh.start();++mesh.nodes[2]->boot;mesh.begin(*mesh.nodes[2]);mesh.run(6500);assert(mesh.nodes[0]->core.result().state==LampMesh::State::Failed);assert(mesh.nodes[0]->core.result().failure==LampMesh::Failure::SessionChanged);assert(mesh.nodes[0]->core.online(mesh.nodes[2]->mac,mesh.now));
   Packet p;uint8_t plaintext[160];bool found=false;for(const auto& e:mesh.captured)if(e.sender==1&&LampMeshCrypto::open(e.bytes.data(),e.bytes.size(),mesh.nodes[1]->key,mesh.nodes[1]->mac,p,plaintext)&&p.kind==Presence&&same(p.origin,mesh.nodes[2]->mac)&&p.boot==oldBoot){assert(!mesh.nodes[0]->core.receive(mesh.nodes[1]->mac,e.bytes.data(),e.bytes.size(),mesh.now));found=true;break;}assert(found);(void)old;
  }
  else if(scenario=="nonce-restart"){
   auto& node=*mesh.nodes[0];node.core.stop();assert(!node.core.begin(node.mac,node.key,node.boot,{&node,Network::trust,Network::send,Network::execute}));++node.boot;mesh.begin(node);
  }
  else if(scenario=="malformed-noop"){
   mesh.run(300);Node& target=*mesh.nodes[2];Node& origin=*mesh.nodes[1];
   const LampMesh::Peer saved=peer(target.core,origin.mac);Packet p;memcpy(p.origin,origin.mac,6);p.boot=origin.boot;p.sequence=saved.sequence+1000;p.kind=Presence;p.payloadSize=p.totalSize=3;
   uint8_t bad[3]{0,49,0};inject(origin,target,p,bad,mesh.now,false);assert(!memcmp(&saved,&peer(target.core,origin.mac),sizeof(saved)));
   uint8_t good[3]{},wire[250];size_t size=0;assert(LampMeshCrypto::seal(p,good,origin.key,origin.mac,3,0,wire,size));wire[HeaderSize+1]^=1;assert(!target.core.receive(origin.mac,wire,size,mesh.now));assert(!memcmp(&saved,&peer(target.core,origin.mac),sizeof(saved)));
  }
  else if(scenario=="target-deadline-before-service"){
   Node& origin=*mesh.nodes[0];Node& target=*mesh.nodes[2];const uint32_t base=peer(target.core,origin.mac).sequence+1000;const uint32_t started=mesh.now;
   Packet p;memcpy(p.origin,origin.mac,6);memcpy(p.target,target.mac,6);p.boot=origin.boot;p.targetBoot=target.boot;p.requestId=300;p.kind=Request;p.totalSize=1024;p.count=7;p.index=0;p.sequence=base;p.payloadSize=160;uint8_t bytes[160]{};
   inject(origin,target,p,bytes,started);assert(!target.executions);
   Packet presence;memcpy(presence.origin,origin.mac,6);presence.boot=origin.boot;presence.sequence=base+8;presence.kind=Presence;presence.payloadSize=presence.totalSize=3;uint8_t metadata[3]{};inject(origin,target,presence,metadata,started+LampMesh::TransactionTimeout-1);
   for(unsigned i=1;i<7;++i){p.index=uint8_t(i);p.sequence=base+i;p.payloadSize=uint8_t(fragmentSize(1024,p.index));inject(origin,target,p,bytes,started+LampMesh::TransactionTimeout+1);}
   assert(!target.executions);
  }
  else if(scenario=="changed-request-id"){
   mesh.start();uint8_t different[1024]{};assert(!mesh.nodes[0]->core.startRequest(mesh.nodes[2]->mac,99,different,sizeof(different),mesh.now));mesh.run(7000);mesh.success();mesh.nodes[0]->core.clearResult();assert(!mesh.nodes[0]->core.startRequest(mesh.nodes[2]->mac,99,different,sizeof(different),mesh.now));
   Node& origin=*mesh.nodes[0];Node& target=*mesh.nodes[2];Packet p;memcpy(p.origin,origin.mac,6);memcpy(p.target,target.mac,6);p.boot=origin.boot;p.targetBoot=target.boot;p.requestId=99;p.kind=Request;p.sequence=peer(target.core,origin.mac).sequence+1000;p.payloadSize=p.totalSize=2;uint8_t changed[2]{1,1};inject(origin,target,p,changed,mesh.now);assert(target.executions==1);
  }
  else{
   mesh.dropExecuted=scenario=="lost-ack"||scenario=="deadline-replay";mesh.dropFragment=scenario=="lost-fragment";mesh.duplicate=scenario=="reorder-duplicate";mesh.reorder=scenario=="reorder-duplicate";mesh.holdFirst=scenario=="reorder-duplicate";mesh.dropResponses=scenario=="deadline-replay";
   if(scenario=="send-backpressure")mesh.nodes[0]->sendBlocked=true;
   mesh.start();
   if(scenario=="send-backpressure"){mesh.run(500);mesh.nodes[0]->sendBlocked=false;}
   if(scenario=="pause"){
    mesh.run(300);mesh.nodes[0]->allowSend=false;mesh.nodes[2]->allowSend=false;mesh.run(1);assert(mesh.nodes[0]->core.result().state==LampMesh::State::Failed);assert(mesh.nodes[0]->core.result().failure==LampMesh::Failure::Unavailable);assert(!mesh.nodes[0]->core.result().body);assert(!mesh.nodes[2]->core.working());
   }
   else if(scenario=="deadline-replay"){
    mesh.run(LampMesh::TransactionTimeout+2000);assert(mesh.nodes[2]->executions==1);const auto& r=mesh.nodes[0]->core.result();assert(r.state==LampMesh::State::Failed&&r.failure==LampMesh::Failure::Deadline&&!r.executed&&!r.body);
    const unsigned before=mesh.nodes[2]->executions;for(const auto& e:mesh.captured){Packet p;if(decode(e.bytes.data(),e.bytes.size(),p)&&p.kind==Request&&e.sender==1)mesh.nodes[2]->core.receive(mesh.nodes[1]->mac,e.bytes.data(),e.bytes.size(),mesh.now);}mesh.run(200);assert(mesh.nodes[2]->executions==before);assert(mesh.nodes[0]->core.result().state==LampMesh::State::Failed);
   }
   else{
    mesh.run(7000);mesh.success();assert(mesh.nodes[2]->executions==1);if(mesh.dropFragment)assert(mesh.fragmentDropped);if(mesh.holdFirst)assert(mesh.outOfOrder);
    if(scenario=="sequential")for(unsigned i=0;i<3;++i){mesh.nodes[0]->core.clearResult();mesh.start(100+i,2);mesh.run(2500);mesh.success();assert(mesh.nodes[2]->executions==2+i);}
   }
  }
 }
 std::cout<<"PASS mesh "<<scenario<<" sent="<<mesh.sent<<" target executions="<<mesh.nodes[2]->executions<<" core bytes="<<sizeof(Core)<<"\n";
}
