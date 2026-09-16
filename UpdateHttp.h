#pragma once
#include <Arduino.h>
#include <esp_tls.h>
#include "UpdateHttpHeaders.h"

class UpdateHttp {
  esp_tls_t* tls=nullptr;
  uint8_t buffer[512];
  size_t cursor=0, buffered=0;
  int64_t remaining=0;
  bool done=false;
  uint32_t started=0;
  int receive(void* output,size_t size);
  bool send(const char* text);
public:
  void close();
  ~UpdateHttp(){close();}
  bool open(String url,int& code,int64_t& length);
  int read(void* output,size_t size);
  bool complete() const {return done;}
};
