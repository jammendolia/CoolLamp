#include "UpdateHttp.h"
#include "LampVersion.h"
#include "LampUpdateControlPolicy.h"
#include <esp_heap_caps.h>
#include <lwip/sockets.h>
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
bool UpdateHttp::allowed() const {
  return !cancelled()&&LampUpdateControlPolicy::withinBudget(millis(),started,budget);
}
String updateHttpDiagnostics(){return String(",\"httpStage\":")+httpStage.load()+",\"httpCode\":"+httpCode.load()+",\"httpHost\":"+httpHost.load()+",\"tlsError\":"+tlsError.load()+",\"tlsFlags\":"+tlsFlags.load()+",\"transportError\":"+transportError.load();}
UpdateHttpDiagnosticsSnapshot captureUpdateHttpDiagnostics(){
  return {httpStage.load(),httpCode.load(),httpHost.load(),tlsError.load(),tlsFlags.load(),transportError.load()};
}
int UpdateHttp::receive(void* output,size_t size){
  const uint32_t idle=millis();
  while(tls&&allowed()&&uint32_t(millis()-idle)<30000){
    const int n=esp_tls_conn_read(tls,output,size);
    if(n!=ESP_TLS_ERR_SSL_WANT_READ&&n!=ESP_TLS_ERR_SSL_WANT_WRITE){if(n<=0)transportError=n;return n;}
    vTaskDelay(1);
  }
  transportError=-1;return -1;
}
bool UpdateHttp::send(const char* text){
  size_t left=strlen(text);
  const uint32_t idle=millis();
  while(left&&tls&&allowed()&&uint32_t(millis()-idle)<30000){
    const size_t want=left>512?512:left;
    const int n=esp_tls_conn_write(tls,text,want);
    if(n==ESP_TLS_ERR_SSL_WANT_READ||n==ESP_TLS_ERR_SSL_WANT_WRITE){vTaskDelay(1);continue;}
    if(n<=0||size_t(n)>want){transportError=n;return false;}text+=n;left-=n;
    // Even a peer accepting a byte at a time cannot keep a worker running
    // without a scheduler boundary or reset the whole-request deadline.
    vTaskDelay(1);
  }
  return left==0;
}
bool UpdateHttp::open(String url,int& code,int64_t& length,const std::atomic<bool>* cancel,uint32_t totalMs){
  close();done=false;started=millis();budget=totalMs;cancellation=cancel;memoryError=false;httpStage=1;httpCode=0;tlsError=0;tlsFlags=0;transportError=0;
  for(unsigned redirects=0;redirects<6;++redirects){
    if(!allowed())return false;
    String host,path;if(!splitUrl(url,host,path))return false;
    httpHost=host=="github.com"?1:2;httpStage=2;
    // IDF 5.5.5's async entry still selects for cfg.timeout_ms while connecting.
    // Keep that SDK poll short; enforce the independent connection/TLS and
    // whole-request clocks here. DNS and individual crypto calls remain SDK work.
    esp_tls_cfg_t config{};config.timeout_ms=LampUpdateControlPolicy::ConnectPollMs;config.non_block=true;
    config.crt_bundle_attach=host=="github.com"?githubBundle:esp_crt_bundle_attach;
    if(!LampUpdateControlPolicy::memoryReady(heap_caps_get_free_size(MALLOC_CAP_8BIT),heap_caps_get_largest_free_block(MALLOC_CAP_8BIT))){memoryError=true;return false;}
    tls=esp_tls_init();if(!tls){memoryError=true;return false;}
    const uint32_t connectingAt=millis();
    int connected=0;
    while(allowed()&&LampUpdateControlPolicy::withinBudget(millis(),connectingAt,LampUpdateControlPolicy::ConnectBudgetMs)&&connected==0){
      esp_tls_conn_state_t state;
      if(esp_tls_get_conn_state(tls,&state)!=ESP_OK){connected=-1;break;}
      if(state==ESP_TLS_CONNECTING){
        // IDF 5.5.5 initializes its internal fd_sets only at INIT. lwIP clears
        // them on timeout, so a short async poll must not reuse those sets.
        // Poll the public socket afresh, then bypass that one SDK select. The
        // socket stays nonblocking: tcp_connect changes flags only at INIT;
        // the pinned Mbed TLS adapter does not consult cfg.non_block.
        int fd=-1;
        if(esp_tls_get_conn_sockfd(tls,&fd)!=ESP_OK||fd<0||fd>=FD_SETSIZE){connected=-1;break;}
        fd_set ready;FD_ZERO(&ready);FD_SET(fd,&ready);timeval poll{};
        const int pending=select(fd+1,nullptr,&ready,nullptr,&poll);
        if(pending<0){connected=-1;break;}
        if(!pending){vTaskDelay(1);continue;}
        int error=0;socklen_t size=sizeof(error);
        if(getsockopt(fd,SOL_SOCKET,SO_ERROR,&error,&size)!=0||error){connected=-1;break;}
        config.non_block=false;
      }
      connected=esp_tls_conn_new_async(host.c_str(),host.length(),443,&config,tls);
      config.non_block=true;
      if(!connected)vTaskDelay(1);
    }
    if(connected!=1||!allowed()||!LampUpdateControlPolicy::withinBudget(millis(),connectingAt,LampUpdateControlPolicy::ConnectBudgetMs)){
      int error=0,flags=0;esp_tls_error_handle_t handle=nullptr;
      if(esp_tls_get_error_handle(tls,&handle)==ESP_OK)transportError=esp_tls_get_and_clear_last_error(handle,&error,&flags);
      tlsError=error;tlsFlags=flags;close();return false;
    }
    httpStage=3;
    if(!send("GET ")||!send(path.c_str())||!send(" HTTP/1.1\r\nHost: ")||!send(host.c_str())||
       !send("\r\nUser-Agent: CoolLamp/" LAMP_FIRMWARE_VERSION "\r\nAccept-Encoding: identity\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n")){close();return false;}
    UpdateHttpHeaders headers;
    httpStage=4;
    while(allowed()&&!headers.complete()){
      if(cursor==buffered){const int n=receive(buffer,sizeof(buffer));if(n<=0){close();return false;}cursor=0;buffered=n;}
      if(!headers.feed(char(buffer[cursor++]))){httpStage=5;close();return false;}
    }
    if(!allowed()){close();return false;}
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
  if(!allowed())return -1;
  if(remaining==0){done=true;return 0;}
  if(remaining<0||!tls)return -1;
  size_t want=size;if(int64_t(want)>remaining)want=remaining;
  int n;
  if(cursor<buffered){if(want>buffered-cursor)want=buffered-cursor;memcpy(output,buffer+cursor,want);cursor+=want;n=want;}
  else n=receive(output,want);
  if(n<=0)return -1;
  remaining-=n;done=remaining==0;return n;
}
