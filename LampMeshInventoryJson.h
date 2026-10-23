#pragma once
#include "LampMeshCore.h"
#include "LampJsonSink.h"
#include "LampSyncRadioCrypto.h"
#include <cstdio>

// One owner-task snapshot, encoded by the shared count/reserve/write path.
// These are recent reachability observations, never parent links or positions.
inline void appendLampMeshPeersJson(LampJsonSink& out,const LampMesh::Core& core,uint32_t now){
 out+='[';bool comma=false;
 for(unsigned i=0;i<LampMesh::MaxPeers;++i){
  const auto& peer=core.peers()[i];if(!peer.boot||!peer.active)continue;
  char identity[13]{},boot[17]{};
  if(!LampSyncRadioCrypto::identityFromMac(peer.mac,identity)){out.fail();return;}
  snprintf(boot,sizeof(boot),"%08lx%08lx",static_cast<unsigned long>(peer.boot>>32),static_cast<unsigned long>(uint32_t(peer.boot)));
  if(comma)out+=',';
  comma=true;
  out+="{\"id\":";out.quote(identity);out+=",\"name\":";out.quote(peer.name);
  out+=",\"firmwareVersion\":";out.quote(peer.version);out+=",\"online\":";out+=core.online(peer.mac,now)?"true":"false";
  out+=",\"hops\":";out+=peer.hops;out+=",\"connected\":";out+=peer.wifiConnected?"true":"false";
  out+=",\"boot\":";out.quote(boot);out+='}';
 }
 out+=']';
}
