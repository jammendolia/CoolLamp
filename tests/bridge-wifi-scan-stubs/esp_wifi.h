#pragma once
#include "esp_event.h"
constexpr int32_t WIFI_EVENT_SCAN_DONE = 1;
constexpr esp_err_t ESP_ERR_WIFI_STATE = 100;
enum wifi_auth_mode_t {
 WIFI_AUTH_OPEN, WIFI_AUTH_WEP, WIFI_AUTH_WPA_PSK, WIFI_AUTH_WPA2_PSK,
 WIFI_AUTH_WPA_WPA2_PSK, WIFI_AUTH_ENTERPRISE, WIFI_AUTH_WPA2_ENTERPRISE = WIFI_AUTH_ENTERPRISE,
 WIFI_AUTH_WPA3_PSK, WIFI_AUTH_WPA2_WPA3_PSK, WIFI_AUTH_WAPI_PSK, WIFI_AUTH_OWE,
 WIFI_AUTH_WPA3_ENT_192, WIFI_AUTH_WPA3_EXT_PSK, WIFI_AUTH_WPA3_EXT_PSK_MIXED_MODE,
 WIFI_AUTH_DPP, WIFI_AUTH_WPA3_ENTERPRISE, WIFI_AUTH_WPA2_WPA3_ENTERPRISE,
 WIFI_AUTH_WPA_ENTERPRISE, WIFI_AUTH_MAX
};
enum wifi_scan_type_t { WIFI_SCAN_TYPE_ACTIVE, WIFI_SCAN_TYPE_PASSIVE };
struct wifi_scan_config_t {
 uint8_t* ssid; uint8_t* bssid; uint8_t channel; bool show_hidden;
 wifi_scan_type_t scan_type;
 struct { struct { uint32_t min, max; } active; uint32_t passive; } scan_time;
 uint8_t home_chan_dwell_time;
};
struct wifi_event_sta_scan_done_t { uint32_t status; uint8_t number, scan_id; };
struct wifi_ap_record_t { uint8_t ssid[33]; int8_t rssi; uint8_t primary; wifi_auth_mode_t authmode; };
esp_err_t esp_wifi_scan_start(const wifi_scan_config_t*, bool);
esp_err_t esp_wifi_scan_stop();
esp_err_t esp_wifi_clear_ap_list();
esp_err_t esp_wifi_scan_get_ap_num(uint16_t*);
esp_err_t esp_wifi_scan_get_ap_record(wifi_ap_record_t*);
