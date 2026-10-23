#pragma once
#if !defined(COOLLAMP_FACTORY_SERVICE) || defined(COOL_LAMP_PUBLIC_RELEASE)
#error "Factory writer is USB service firmware only; never include in production."
#endif
#include "LampFactoryDesign.h"
#include <nvs.h>

namespace LampFactoryDesign {
enum class Save {Saved,Invalid,Failed,Uncertain};
// Only this standalone service includes the writer. One committed NVS blob;
// never erase a namespace or touch Wi-Fi, household, geometry or user settings.
inline Save save(const Record& record){
  if(!valid(record))return Save::Invalid;
  nvs_handle_t handle;if(nvs_open(Namespace,NVS_READWRITE,&handle)!=ESP_OK)return Save::Failed;
  const esp_err_t written=nvs_set_blob(handle,Key,&record,sizeof(record));
  const esp_err_t committed=written==ESP_OK?nvs_commit(handle):written;nvs_close(handle);
  if(written!=ESP_OK||committed!=ESP_OK)return Save::Uncertain;
  if(nvs_open(Namespace,NVS_READONLY,&handle)!=ESP_OK)return Save::Uncertain;
  Record found;size_t length=sizeof(found);const esp_err_t read=nvs_get_blob(handle,Key,&found,&length);nvs_close(handle);
  return read==ESP_OK&&length==sizeof(found)&&!memcmp(&found,&record,sizeof(found))?Save::Saved:Save::Uncertain;
}
}
