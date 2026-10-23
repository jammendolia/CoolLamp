#pragma once
// These legacy protocol fixtures exercise descriptorV1 via Preferences. Factory
// V2 storage/faults/service are covered with real production code separately.
#include <stddef.h>
using esp_err_t=int;using nvs_handle_t=unsigned;
constexpr esp_err_t ESP_OK=0,ESP_ERR_NVS_NOT_FOUND=1;
constexpr int NVS_READONLY=0;
inline esp_err_t nvs_open(const char*,int,nvs_handle_t*){return ESP_ERR_NVS_NOT_FOUND;}
inline void nvs_close(nvs_handle_t){}
inline esp_err_t nvs_get_blob(nvs_handle_t,const char*,void*,size_t*){return ESP_ERR_NVS_NOT_FOUND;}
