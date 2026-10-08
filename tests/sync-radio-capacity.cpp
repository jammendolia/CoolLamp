#define ARDUINO 1
#include "../LampSync.cpp"
#include <esp_now.h>
#include <cassert>
#include <iostream>
bool lampHasMicrophone(){return true;}
LampAudioFeatures getLampAudioFeatures(){return {};}
void applyLampSyncControl(const Visual*){}
void captureLampSyncVisual(Visual& v){v={};v.mode=46;v.power=1;v.brightness=100;v.speed=50;}
int main(){
 fakeEfuseMac=0xaabbccddee00ULL;WiFi.state=0;fakeNow=1000;beginLampSync();
 assert(configureLampSync(1,identity,"0123456789abcdef0123456789abcdef"));serviceLampSync("Leader",false);
 char names[8][13];uint8_t addresses[8][6]{},local[6]{};assert(LampSyncRadioCrypto::macFromIdentity(identity,local));
 for(unsigned i=0;i<8;++i){
  snprintf(names[i],13,"11223344%04x",16+i*2);assert(LampSyncRadioCrypto::macFromIdentity(names[i],addresses[i]));
  Packet p=packet(Subscribe,"Follower");strcpy(p.sender,names[i]);strcpy(p.leader,identity);p.role=2;p.session=800+i;p.target=nonce;p.sequence=1;
  LampSyncRadioCrypto::SendNonce previous;uint8_t body[LampSyncRadioCrypto::EnvelopeSize];assert(LampSyncRadioCrypto::seal(p,identity,keyBytes,body,sizeof(body),previous));FakeRadio::receive(addresses[i],body,sizeof(body));
 }
 fakeNow+=40;serviceLampSync("Leader",false);serviceLampSync("Leader",false);assert(sceneConfig.count==9);
 for(unsigned i=0;i<30;++i){fakeNow+=2;serviceLampSync("Leader",false);}
 assert(FakeRadio::peers.size()==9); // broadcast plus eight application-AEAD peers
 for(unsigned i=0;i<8;++i){bool clock=false,frame=false;for(const auto& sent:FakeRadio::sent){
  if(memcmp(sent.destination.data(),addresses[i],6))continue;
  Packet p{};
  if(!LampSyncRadioCrypto::open(sent.data.data(),sent.data.size(),local,names[i],keyBytes,p))continue;
  if(p.kind==ClockReply&&p.target==800+i)clock=true;
  if(p.kind==Frame&&p.target==800+i&&p.visual.count==9&&p.visual.position==i+1)frame=true;
 }assert(clock&&frame);}
 WiFi.state=WL_CONNECTED;Packet p=packet(Subscribe,"Dual route");strcpy(p.sender,names[0]);strcpy(p.leader,identity);p.role=2;p.session=800;p.target=nonce;digest(p,p.mac);
 const auto* bytes=reinterpret_cast<const uint8_t*>(&p);WiFiUDP::incoming.emplace_back(bytes,bytes+sizeof(p));fakeNow+=40;serviceLampSync("Leader",false);
 bool udpFrame=false;for(const auto& bytesOut:WiFiUDP::outgoing){Packet result{};memcpy(&result,bytesOut.data(),sizeof(result));if(result.kind==Frame&&result.target==800&&result.visual.count==9){assert(authenticated(result));udpFrame=true;}}
 assert(udpFrame&&started&&LampEspNow::status().active);
 const auto before=Preferences::storage;serviceLampSync("Leader",true);assert(Preferences::storage==before);
 std::cout<<"PASS: eight encrypted radio followers retain nine-lamp room capacity, individual positions/clock nonces, bounded SDK peer table, simultaneous authenticated UDP and radio, resource/NVS isolation\n";
}
