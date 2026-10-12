#pragma once
#include <Preferences.h>
#include <nvs.h>

// Pinned Arduino core 3.3.11 Preferences exposes this protected handle.
// Preserve raw read errors: its isKey()/getType() flatten failures into absence.
class LampNvsBlobPreferences:public Preferences{
public:
  esp_err_t readBlob(const char* key,void* buffer,size_t& length){
    return nvs_get_blob(_handle,key,buffer,&length);
  }
};
