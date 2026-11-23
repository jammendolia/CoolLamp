#pragma once

#include <nvs.h>

namespace LampTrustStorage {

enum ReadResult : uint8_t { Found, Absent, Error };
enum WriteResult : uint8_t { Complete, NotOpened, Uncertain };

__attribute__((noinline)) inline ReadResult read(const char* key, void* out, size_t expected) {
  nvs_handle_t handle=0;const esp_err_t opened=nvs_open("lamptrust",NVS_READONLY,&handle);
  if(opened==ESP_ERR_NVS_NOT_FOUND)return Absent;
  if(opened!=ESP_OK)return Error;
  size_t size=expected;const auto result=nvs_get_blob(handle,key,out,&size);nvs_close(handle);
  return result==ESP_ERR_NVS_NOT_FOUND?Absent:result==ESP_OK&&size==expected?Found:Error;
}

__attribute__((noinline)) inline WriteResult write(const char* key, const void* value, size_t size) {
  nvs_handle_t handle=0;if(nvs_open("lamptrust",NVS_READWRITE,&handle)!=ESP_OK)return NotOpened;
  const bool saved=nvs_set_blob(handle,key,value,size)==ESP_OK&&nvs_commit(handle)==ESP_OK;nvs_close(handle);return saved?Complete:Uncertain;
}

} // namespace LampTrustStorage
