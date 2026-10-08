#pragma once
#include "esp_wifi.h"
#include <vector>
#include <array>
constexpr int ESP_ERR_ESPNOW_EXIST=1,ESP_NOW_SEND_SUCCESS=0,ESP_NOW_SEND_FAIL=1;
using esp_now_send_status_t=int;
using esp_now_send_info_t=wifi_tx_info_t;
struct esp_now_recv_info_t {uint8_t* src_addr=nullptr;uint8_t* des_addr=nullptr;wifi_pkt_rx_ctrl_t* rx_ctrl=nullptr;};
struct esp_now_peer_info_t {uint8_t peer_addr[6]{},lmk[16]{};uint8_t channel=0;int ifidx=0;bool encrypt=false;void* priv=nullptr;};
using esp_now_recv_cb_t=void(*)(const esp_now_recv_info_t*,const uint8_t*,int);
using esp_now_send_cb_t=void(*)(const esp_now_send_info_t*,esp_now_send_status_t);
namespace FakeRadio {
struct Sent {std::array<uint8_t,6> destination{};std::vector<uint8_t> data;};
inline std::vector<Sent> sent;
inline std::vector<std::array<uint8_t,6>> peers;
inline esp_now_recv_cb_t receiver=nullptr;
inline esp_now_send_cb_t sender=nullptr;
inline bool initialized=false,autoComplete=true;
inline int sendResult=ESP_OK,initResult=ESP_OK;
inline unsigned initCalls=0,deinitCalls=0;
inline void complete(const uint8_t* mac,int result=ESP_NOW_SEND_SUCCESS){if(sender){wifi_tx_info_t info{const_cast<uint8_t*>(mac)};sender(&info,result);}}
inline void receive(const uint8_t* mac,const uint8_t* data,size_t length,uint8_t onChannel=0){if(receiver){wifi_pkt_rx_ctrl_t control;control.channel=onChannel?onChannel:channel;esp_now_recv_info_t info{const_cast<uint8_t*>(mac),nullptr,&control};receiver(&info,data,int(length));}}
}
inline int esp_now_init(){++FakeRadio::initCalls;FakeRadio::initialized=FakeRadio::initResult==0;return FakeRadio::initResult;}
inline int esp_now_deinit(){++FakeRadio::deinitCalls;FakeRadio::initialized=false;FakeRadio::peers.clear();return ESP_OK;}
inline int esp_now_register_recv_cb(esp_now_recv_cb_t cb){FakeRadio::receiver=cb;return ESP_OK;}
inline int esp_now_register_send_cb(esp_now_send_cb_t cb){FakeRadio::sender=cb;return ESP_OK;}
inline int esp_now_unregister_recv_cb(){FakeRadio::receiver=nullptr;return ESP_OK;}
inline int esp_now_unregister_send_cb(){FakeRadio::sender=nullptr;return ESP_OK;}
inline int esp_now_add_peer(const esp_now_peer_info_t* peer){std::array<uint8_t,6> mac;memcpy(mac.data(),peer->peer_addr,6);for(const auto& known:FakeRadio::peers)if(known==mac)return ESP_ERR_ESPNOW_EXIST;FakeRadio::peers.push_back(mac);return ESP_OK;}
inline int esp_now_del_peer(const uint8_t* peer){for(auto item=FakeRadio::peers.begin();item!=FakeRadio::peers.end();++item)if(!memcmp(item->data(),peer,6)){FakeRadio::peers.erase(item);break;}return ESP_OK;}
inline int esp_now_send(const uint8_t* mac,const uint8_t* data,size_t length){if(FakeRadio::sendResult!=ESP_OK)return FakeRadio::sendResult;FakeRadio::Sent item;memcpy(item.destination.data(),mac,6);item.data.assign(data,data+length);FakeRadio::sent.push_back(item);if(FakeRadio::autoComplete)FakeRadio::complete(mac);return ESP_OK;}
