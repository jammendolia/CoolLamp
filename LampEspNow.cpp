#include "LampEspNow.h"
#include <Arduino.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <atomic>
#include <cstring>

namespace LampEspNow {
namespace {
constexpr uint8_t broadcast[6]={255,255,255,255,255,255};
constexpr uint32_t Dwell=340, SendTimeout=200;
struct SendItem { uint8_t data[PayloadLimit]{},destination[6]{};uint16_t length=0;bool priority=false; };
Received incoming[ReceiveCapacity];
SendItem outgoing[SendCapacity];
unsigned sendCount=0;
std::atomic<uint32_t> head{0},tail{0},rxTotal{0},rxDropped{0},epoch{0};
std::atomic<bool> accepting{false},inFlight{false},completed{false},successful{false};
uint8_t pendingDestination[6]{},driverPeers[9][6]{};
unsigned driverPeerCount=0;
uint32_t sentAt=0,retryAt=0,dwellAt=0,holdUntil=0;
bool deferredHop=false;
uint8_t firstChannel=1,lastChannel=11,anchor=0;
Status state;
bool due(uint32_t now,uint32_t when){return int32_t(now-when)>=0;}
void onReceive(const esp_now_recv_info_t* info,const uint8_t* data,int length) {
  if(!accepting.load(std::memory_order_acquire)||!info||!info->src_addr||!info->rx_ctrl||!data||length<=0||length>int(PayloadLimit))return;
  const auto generation=epoch.load(std::memory_order_acquire),write=head.load(std::memory_order_relaxed);
  if(write-tail.load(std::memory_order_acquire)>=ReceiveCapacity){rxDropped.fetch_add(1,std::memory_order_relaxed);return;}
  auto& item=incoming[write%ReceiveCapacity];
  memcpy(item.data,data,size_t(length));memcpy(item.source,info->src_addr,6);item.length=uint16_t(length);
  item.channel=info->rx_ctrl->channel;item.rssi=info->rx_ctrl->rssi;item.receivedAt=millis();
  if(!accepting.load(std::memory_order_acquire)||generation!=epoch.load(std::memory_order_acquire))return;
  head.store(write+1,std::memory_order_release);rxTotal.fetch_add(1,std::memory_order_relaxed);
}
void onSend(const esp_now_send_info_t* info,esp_now_send_status_t result) {
  if(!accepting.load(std::memory_order_acquire)||!inFlight.load(std::memory_order_acquire)||!info||!info->des_addr||memcmp(info->des_addr,pendingDestination,6))return;
  successful.store(result==ESP_NOW_SEND_SUCCESS,std::memory_order_relaxed);
  completed.store(true,std::memory_order_release);
}
void discard(){tail.store(head.load(std::memory_order_acquire),std::memory_order_release);sendCount=0;completed=false;inFlight=false;}
void deactivate() {
  accepting.store(false,std::memory_order_release);epoch.fetch_add(1,std::memory_order_acq_rel);
  if(state.active){esp_now_unregister_recv_cb();esp_now_unregister_send_cb();esp_now_deinit();}
  state.active=false;state.generation=epoch.load();driverPeerCount=0;discard();
}
bool addPeer(const uint8_t* mac) {
  for(unsigned i=0;i<driverPeerCount;++i)if(!memcmp(driverPeers[i],mac,6))return true;
  // Broadcast plus eight cached destinations keeps the SDK table bounded.
  // Expanded groups broadcast their frames; targeted clock/control destinations
  // rotate through this cache. Application AEAD supplies payload protection.
  if(driverPeerCount>=9){esp_now_del_peer(driverPeers[1]);memmove(driverPeers[1],driverPeers[2],7*6);driverPeerCount=8;}
  esp_now_peer_info_t peer{};memcpy(peer.peer_addr,mac,6);peer.ifidx=WIFI_IF_STA;peer.channel=0;peer.encrypt=false;
  const auto result=esp_now_add_peer(&peer);
  if(result!=ESP_OK&&result!=ESP_ERR_ESPNOW_EXIST)return false;
  memcpy(driverPeers[driverPeerCount++],mac,6);return true;
}
void flush(uint32_t now) {
  if(inFlight.load(std::memory_order_acquire)) {
    if(completed.exchange(false,std::memory_order_acq_rel)) {
      if(successful.load(std::memory_order_relaxed))++state.sent;else ++state.sendFailed;
      inFlight.store(false,std::memory_order_release);
    } else if(now-sentAt>SendTimeout) {
      ++state.sendFailed;state.sendDropped+=sendCount;deactivate();retryAt=now+1000;return;
    } else return;
  }
  if(!sendCount)return;
  // Copy the one selected packet; remove it before sending. A timeout/failure
  // never replays it or reuses a stale queue after a channel/resource change.
  const SendItem item=outgoing[0];memmove(outgoing,outgoing+1,(--sendCount)*sizeof(SendItem));
  if(!addPeer(item.destination)){++state.sendFailed;return;}
  memcpy(pendingDestination,item.destination,6);sentAt=now;completed=false;
  inFlight.store(true,std::memory_order_release);
  if(esp_now_send(item.destination,item.data,item.length)!=ESP_OK){inFlight=false;completed=false;++state.sendFailed;}
}
bool changeChannel(uint8_t channel,uint32_t now) {
  if(esp_wifi_set_channel(channel,WIFI_SECOND_CHAN_NONE)!=ESP_OK)return false;
  state.sendDropped+=sendCount;discard();epoch.fetch_add(1,std::memory_order_acq_rel);
  state.generation=epoch.load();state.channel=channel;++state.channelChanges;dwellAt=now;deferredHop=false;return true;
}
}
void stop(){state.sendDropped+=sendCount;deactivate();holdUntil=0;state.seeking=false;state.suspended=true;}
void holdChannel(uint32_t until){holdUntil=until;}
void service(uint32_t now,bool blocked,bool scanning,bool associated,bool seeking) {
  if(blocked){if(state.active)stop();return;}
  if(scanning){
    if(state.active){state.sendDropped+=sendCount;deactivate();}
    state.suspended=true;return;
  }
  uint8_t current=0;wifi_second_chan_t second;
  if(esp_wifi_get_channel(&current,&second)!=ESP_OK||current<1||current>14){if(state.active)stop();return;}
  if(!state.active) {
    if(!due(now,retryAt))return;
    if(!associated&&!seeking&&anchor>=firstChannel&&anchor<=lastChannel&&current!=anchor){
      if(esp_wifi_set_channel(anchor,WIFI_SECOND_CHAN_NONE)!=ESP_OK)return;
      current=anchor;
    }
    if(esp_now_init()!=ESP_OK){retryAt=now+1000;return;}
    state.active=true;
    if(esp_now_register_recv_cb(onReceive)!=ESP_OK||esp_now_register_send_cb(onSend)!=ESP_OK||!addPeer(broadcast)){deactivate();retryAt=now+1000;return;}
    wifi_country_t country{};
    if(esp_wifi_get_country(&country)==ESP_OK&&country.schan>=1&&country.nchan>=1&&country.schan+country.nchan<=15){firstChannel=country.schan;lastChannel=country.schan+country.nchan-1;}
    state.channel=current;anchor=current;dwellAt=now;epoch.fetch_add(1);state.generation=epoch.load();
  }
  if(state.suspended){discard();epoch.fetch_add(1);state.generation=epoch.load();dwellAt=now;}
  if(state.seeking&&!seeking&&!associated)anchor=current;
  state.suspended=false;state.seeking=seeking&&!associated;
  if(associated) {
    anchor=current;
    if(current!=state.channel){state.sendDropped+=sendCount;deactivate();state.channel=current;++state.channelChanges;retryAt=now;return;}
  } else if(!seeking) {
    if(anchor<firstChannel||anchor>lastChannel)anchor=firstChannel;
    if(current!=anchor&&!inFlight.load()&&!changeChannel(anchor,now)){state.suspended=true;return;}
  } else if(due(now,holdUntil)&&now-dwellAt>=Dwell&&!inFlight.load()) {
    const bool pending=head.load(std::memory_order_acquire)!=tail.load(std::memory_order_acquire);
    if(pending&&!deferredHop)deferredHop=true;
    else {const uint8_t next=state.channel<firstChannel||state.channel>=lastChannel?firstChannel:state.channel+1;if(!changeChannel(next,now)){state.suspended=true;return;}}
  }
  accepting.store(true,std::memory_order_release);flush(now);
}
bool receive(Received& item) {
  if(!state.active||state.suspended)return false;
  const auto read=tail.load(std::memory_order_relaxed);
  if(read==head.load(std::memory_order_acquire))return false;
  item=incoming[read%ReceiveCapacity];tail.store(read+1,std::memory_order_release);return true;
}
bool enqueue(const uint8_t* data,size_t length,const uint8_t* destination,bool priority) {
  if(!state.active||state.suspended||!data||!length||length>PayloadLimit)return false;
  const uint8_t* mac=destination?destination:broadcast;
  // Latest normal frame replaces the older queued frame for this recipient.
  unsigned index=sendCount;
  if(!priority)for(unsigned i=0;i<sendCount;++i)if(!outgoing[i].priority&&!memcmp(outgoing[i].destination,mac,6)){index=i;break;}
  if(index==sendCount&&sendCount>=SendCapacity){
    if(priority){for(unsigned i=0;i<sendCount;++i)if(!outgoing[i].priority){index=i;break;}}
    if(index==sendCount){++state.sendDropped;return false;}
    ++state.sendDropped;
  }
  if(index==sendCount)++sendCount;
  else if(!priority)++state.sendDropped;
  auto& item=outgoing[index];memcpy(item.data,data,length);memcpy(item.destination,mac,6);item.length=uint16_t(length);item.priority=priority;
  if(priority&&index){const SendItem copy=item;memmove(outgoing+1,outgoing,index*sizeof(SendItem));outgoing[0]=copy;}
  return true;
}
Status status(){auto result=state;result.received=rxTotal.load();result.receiveDropped=rxDropped.load();return result;}
}
