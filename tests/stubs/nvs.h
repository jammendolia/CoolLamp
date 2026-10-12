#pragma once
#include <Preferences.h>
using esp_err_t=int;
constexpr esp_err_t ESP_OK=0,ESP_ERR_NVS_NOT_FOUND=1,ESP_ERR_NVS_INVALID_LENGTH=2;
inline esp_err_t nvs_get_blob(uint32_t,const char* key,void* data,size_t* length){
  const auto found=Preferences::storage.find(key);
  if(found==Preferences::storage.end())return ESP_ERR_NVS_NOT_FOUND;
  if(!data){*length=found->second.size();return ESP_OK;}
  if(*length<found->second.size())return ESP_ERR_NVS_INVALID_LENGTH;
  *length=found->second.size();
  memcpy(data,found->second.data(),*length);return ESP_OK;
}
