#pragma once
#include <stdint.h>
#include <cstring>
using esp_err_t=int;
constexpr int ESP_OK=0,WIFI_IF_STA=0,WIFI_SECOND_CHAN_NONE=0;
using wifi_second_chan_t=int;
struct wifi_country_t {char cc[3]={'U','S',0};uint8_t schan=1,nchan=11;};
struct wifi_pkt_rx_ctrl_t {int8_t rssi=-40;uint8_t channel=1;};
struct wifi_tx_info_t {uint8_t* des_addr=nullptr;};
struct wifi_ap_record_t {uint8_t primary=1;};
namespace FakeRadio {
inline uint8_t channel=1;
inline bool scanning=false;
inline bool associated=false;
inline unsigned channelSets=0;
}
inline int esp_wifi_get_channel(uint8_t* channel,wifi_second_chan_t* second){*channel=FakeRadio::channel;*second=0;return ESP_OK;}
inline int esp_wifi_set_channel(uint8_t channel,wifi_second_chan_t){if(FakeRadio::scanning)return -1;FakeRadio::channel=channel;++FakeRadio::channelSets;return ESP_OK;}
inline int esp_wifi_get_country(wifi_country_t* country){*country=wifi_country_t{};return ESP_OK;}
inline int esp_wifi_sta_get_ap_info(wifi_ap_record_t* info){if(!FakeRadio::associated)return -1;info->primary=FakeRadio::channel;return ESP_OK;}
