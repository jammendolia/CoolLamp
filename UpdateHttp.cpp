#include "UpdateHttp.h"
#include "LampVersion.h"
#include "UpdateIo.h"
#include <esp_crt_bundle.h>
#include <mbedtls/ssl.h>
#include <mbedtls/ssl_ciphersuites.h>
#include <string.h>
#include <atomic>

namespace {
std::atomic<int> httpStage{0}, httpCode{0}, httpHost{0}, tlsError{0}, tlsFlags{0}, transportError{0};
esp_err_t githubBundle(void* config) {
  static const int suites[]={MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,0};
  mbedtls_ssl_conf_ciphersuites(static_cast<mbedtls_ssl_config*>(config),suites);
  return esp_crt_bundle_attach(config);
}
bool splitUrl(const String& url,String& host,String& path) {
  if(!url.startsWith("https://")||url.length()>2047)return false;
  for(size_t i=0;i<url.length();++i)if(uint8_t(url[i])<=32||url[i]==127||url[i]=='#')return false;
  const int slash=url.indexOf('/',8);if(slash<0)return false;
  host=url.substring(8,slash);path=url.substring(slash);
  return host=="github.com"||host=="release-assets.githubusercontent.com"||host=="objects.githubusercontent.com"||host=="github-releases.githubusercontent.com";
}
}
void UpdateHttp::close(){if(tls)esp_tls_conn_destroy(tls);tls=nullptr;cursor=buffered=0;}
String updateHttpDiagnostics(){return String(",\"httpStage\":")+httpStage.load()+",\"httpCode\":"+httpCode.load()+",\"httpHost\":"+httpHost.load()+",\"tlsError\":"+tlsError.load()+",\"tlsFlags\":"+tlsFlags.load()+",\"transportError\":"+transportError.load();}
int UpdateHttp::receive(void* output,size_t size){
  if(!tls||uint32_t(millis()-started)>180000)return -1;
  const int n=updateIo([&]{return esp_tls_conn_read(tls,output,size);},[]{return millis();},[]{vTaskDelay(1);},
                       started,ESP_TLS_ERR_SSL_WANT_READ,ESP_TLS_ERR_SSL_WANT_WRITE);
  if(n<=0)transportError=n;return n;
}
bool UpdateHttp::send(const char* text){
  size_t left=strlen(text);
  while(left){
    const int n=updateIo([&]{return esp_tls_conn_write(tls,text,left);},[]{return millis();},[]{vTaskDelay(1);},
                         started,ESP_TLS_ERR_SSL_WANT_READ,ESP_TLS_ERR_SSL_WANT_WRITE);
    if(n<=0){transportError=n;return false;}text+=n;left-=n;
  }
  return true;
}
bool UpdateHttp::open(String url,int& code,int64_t& length){
  close();done=false;started=millis();httpStage=1;httpCode=0;tlsError=0;tlsFlags=0;transportError=0;
  for(unsigned redirects=0;redirects<6;++redirects){
    String host,path;if(!splitUrl(url,host,path))return false;
    httpHost=host=="github.com"?1:2;httpStage=2;
    esp_tls_cfg_t config{};config.timeout_ms=12000;
    config.crt_bundle_attach=host=="github.com"?githubBundle:esp_crt_bundle_attach;
    tls=esp_tls_init();if(!tls)return false;
    if(esp_tls_conn_new_sync(host.c_str(),host.length(),443,&config,tls)!=1){
      int error=0,flags=0;esp_tls_error_handle_t handle=nullptr;
      if(esp_tls_get_error_handle(tls,&handle)==ESP_OK)transportError=esp_tls_get_and_clear_last_error(handle,&error,&flags);
      tlsError=error;tlsFlags=flags;close();return false;
    }
    httpStage=3;
    if(!send("GET ")||!send(path.c_str())||!send(" HTTP/1.1\r\nHost: ")||!send(host.c_str())||
       !send("\r\nUser-Agent: CoolLamp/" LAMP_FIRMWARE_VERSION "\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n")){close();return false;}
    UpdateHttpHeaders headers;
    httpStage=4;
    while(!headers.complete()){
      if(cursor==buffered){const int n=receive(buffer,sizeof(buffer));if(n<=0){close();return false;}cursor=0;buffered=n;}
      if(!headers.feed(char(buffer[cursor++]))){httpStage=5;close();return false;}
    }
    code=headers.code;length=headers.length;
    httpCode=code;httpStage=6;
    if(code==301||code==302||code==303||code==307||code==308){
      if(headers.location[0]=='/'&&headers.location[1]!='/')url=String("https://")+host+headers.location;
      else url=headers.location;
      close();continue;
    }
    // Release assets have Content-Length. Reject unsupported body framing rather
    // than guessing boundaries or accepting a truncated/encoded firmware image.
    if(code==200&&(length<0||headers.transferEncoded||headers.encoded)){close();return false;}
    remaining=length;done=length==0;return true;
  }
  close();return false;
}
int UpdateHttp::read(void* output,size_t size){
  httpStage=7;
  if(remaining==0){done=true;return 0;}
  if(remaining<0||!tls)return -1;
  size_t want=size;if(int64_t(want)>remaining)want=remaining;
  int n;
  if(cursor<buffered){if(want>buffered-cursor)want=buffered-cursor;memcpy(output,buffer+cursor,want);cursor+=want;n=want;}
  else n=receive(output,want);
  if(n<=0)return -1;
  remaining-=n;done=remaining==0;return n;
}
