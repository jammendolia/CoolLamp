#pragma once
#include <Arduino.h>
#include <esp_tls.h>
#include <atomic>
#include "UpdateHttpHeaders.h"
#include "UpdateHttpDiagnostics.h"
String updateHttpDiagnostics();

class UpdateHttp {
  esp_tls_t* tls=nullptr;
  void* inputPlacement=nullptr;
  bool bundleAttached=false;
  uint8_t buffer[512];
  size_t cursor=0, buffered=0;
  int64_t remaining=0;
  bool done=false;
  uint32_t started=0;
  uint32_t budget=180000;
  const std::atomic<bool>* cancellation=nullptr;
  bool memoryError=false;
  void releaseInputPlacement();
  void closeConnection();
  static esp_err_t protectedBundle(void* config);
  static esp_err_t protectedGithubBundle(void* config);
  bool allowed() const;
  int receive(void* output,size_t size);
  bool send(const char* text);
  enum class HeaderResult:uint8_t {Error,Redirect,Ready};
  // Keep the bounded 2 KiB redirect workspace off the TLS handshake's stack.
  __attribute__((noinline)) HeaderResult readResponseHeaders(String& url,const String& host,int& code,int64_t& length);
public:
  UpdateHttp()=default;
  UpdateHttp(const UpdateHttp&)=delete;
  UpdateHttp& operator=(const UpdateHttp&)=delete;
  void close();
  ~UpdateHttp(){close();}
  bool open(String url,int& code,int64_t& length,
            const std::atomic<bool>* cancel=nullptr,uint32_t totalMs=180000);
  int read(void* output,size_t size);
  bool complete() const {return done;}
  bool cancelled() const {return cancellation&&cancellation->load();}
  bool memoryFailure() const {return memoryError;}
};
