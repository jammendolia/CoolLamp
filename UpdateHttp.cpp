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
std::atomic<UpdateHttp*> placementOwner{nullptr};
constexpr uint32_t tlsMemoryCaps=MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT;
#ifdef COOL_LAMP_TEST_IMAGE
// Bench-only best-effort numeric allocation evidence. The callback never
// allocates, logs, reads heap state, or retains the SDK's function-name pointer.
std::atomic<uint32_t> failedBytes{0},failedCaps{0},failedCount{0};
std::atomic<bool> allocationProbe{false};
void allocationFailed(size_t bytes,uint32_t caps,const char*){
  failedBytes.store(uint32_t(bytes),std::memory_order_relaxed);
  failedCaps.store(caps,std::memory_order_relaxed);
  failedCount.fetch_add(1,std::memory_order_relaxed);
}
#endif
bool splitUrl(String& url,String& host) {
  if(!url.startsWith("https://")||url.length()>2047)return false;
  for(size_t i=0;i<url.length();++i)if(uint8_t(url[i])<=32||url[i]==127||url[i]=='#')return false;
  const int slash=url.indexOf('/',8);if(slash<0)return false;
  host=url.substring(8,slash);
  if(!(host=="github.com"||host=="release-assets.githubusercontent.com"||host=="objects.githubusercontent.com"||host=="github-releases.githubusercontent.com"))return false;
  // Core 3.3.11 removes this prefix in place. Keep one validated long URL/path
  // allocation through TLS, rather than retaining a second signed asset path.
  // A redirect replaces url with an absolute URL before this validation repeats.
  url.remove(0,slash);return true;
}
}
void UpdateHttp::releaseInputPlacement(){
  if(inputPlacement){heap_caps_free(inputPlacement);inputPlacement=nullptr;}
}
void UpdateHttp::closeConnection(){
  if(tls)esp_tls_conn_destroy(tls);
  tls=nullptr;releaseInputPlacement();bundleAttached=false;cursor=buffered=0;
}
void UpdateHttp::close(){
  closeConnection();UpdateHttp* expected=this;
  placementOwner.compare_exchange_strong(expected,nullptr);
}
esp_err_t UpdateHttp::protectedBundle(void* config){
  UpdateHttp* owner=placementOwner.load();
  if(!owner)return ESP_ERR_INVALID_STATE;
  const auto result=esp_crt_bundle_attach(config);
  owner->bundleAttached=result==ESP_OK;
  return result;
}
esp_err_t UpdateHttp::protectedGithubBundle(void* config){
  static const int suites[]={MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,0};
  mbedtls_ssl_conf_ciphersuites(static_cast<mbedtls_ssl_config*>(config),suites);
  return protectedBundle(config);
}
bool UpdateHttp::allowed() const {
  return !cancelled()&&LampUpdateControlPolicy::withinBudget(millis(),started,budget);
}
String updateHttpDiagnostics(){return String(",\"httpStage\":")+httpStage.load()+",\"httpCode\":"+httpCode.load()+",\"httpHost\":"+httpHost.load()+",\"tlsError\":"+tlsError.load()+",\"tlsFlags\":"+tlsFlags.load()+",\"transportError\":"+transportError.load();}
UpdateHttpDiagnosticsSnapshot captureUpdateHttpDiagnostics(){
  UpdateHttpDiagnosticsSnapshot result{httpStage.load(),httpCode.load(),httpHost.load(),tlsError.load(),tlsFlags.load(),transportError.load()};
#ifdef COOL_LAMP_TEST_IMAGE
  result.allocationProbe=allocationProbe.load();result.failedBytes=failedBytes.load();result.failedCaps=failedCaps.load();result.failedCount=failedCount.load();
#endif
  return result;
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
UpdateHttp::HeaderResult UpdateHttp::readResponseHeaders(String& url,const String& host,int& code,int64_t& length){
  // This noinline frame starts only after certificate verification returns.
  // Neither a static parser nor another heap allocation is retained between jobs.
  UpdateHttpHeaders headers;
  httpStage=4;
  while(allowed()&&!headers.complete()){
    if(cursor==buffered){const int n=receive(buffer,sizeof(buffer));if(n<=0){close();return HeaderResult::Error;}cursor=0;buffered=n;}
    if(!headers.feed(char(buffer[cursor++]))){httpStage=5;close();return HeaderResult::Error;}
  }
  if(!allowed()){close();return HeaderResult::Error;}
  code=headers.code;length=headers.length;
  httpCode=code;httpStage=6;
  if(code==301||code==302||code==303||code==307||code==308){
    if(headers.location[0]=='/'&&headers.location[1]!='/')url=String("https://")+host+headers.location;
    else url=headers.location;
    closeConnection();return HeaderResult::Redirect;
  }
  // Release assets have Content-Length. Reject unsupported body framing rather
  // than guessing boundaries or accepting a truncated/encoded firmware image.
  if(code==200&&(length<0||headers.transferEncoded||headers.encoded)){close();return HeaderResult::Error;}
  remaining=length;done=length==0;return HeaderResult::Ready;
}
bool UpdateHttp::open(String url,int& code,int64_t& length,const std::atomic<bool>* cancel,uint32_t totalMs){
#ifdef COOL_LAMP_TEST_IMAGE
  if(!allocationProbe.load())allocationProbe=heap_caps_register_failed_alloc_callback(allocationFailed)==ESP_OK;
#endif
  close();done=false;started=millis();budget=totalMs;cancellation=cancel;memoryError=false;
  UpdateHttp* expected=nullptr;
  if(!placementOwner.compare_exchange_strong(expected,this))return false;
  httpStage=1;httpCode=0;tlsError=0;tlsFlags=0;transportError=0;
  for(unsigned redirects=0;redirects<6;++redirects){
    if(!allowed()){close();return false;}
    String host;if(!splitUrl(url,host)){close();return false;}
    httpHost=host=="github.com"?1:2;httpStage=2;
    // IDF 5.5.5's async entry still selects for cfg.timeout_ms while connecting.
    // Keep that SDK poll short; enforce the independent connection/TLS and
    // whole-request clocks here. DNS and individual crypto calls remain SDK work.
    esp_tls_cfg_t config{};config.timeout_ms=LampUpdateControlPolicy::ConnectPollMs;config.non_block=true;
    config.crt_bundle_attach=host=="github.com"?protectedGithubBundle:protectedBundle;
    if(!LampUpdateControlPolicy::memoryReady(heap_caps_get_free_size(tlsMemoryCaps),heap_caps_get_largest_free_block(tlsMemoryCaps))){memoryError=true;close();return false;}
    inputPlacement=heap_caps_malloc(LampUpdateControlPolicy::MinLargest,tlsMemoryCaps);
    if(!inputPlacement){memoryError=true;close();return false;}
    tls=esp_tls_init();if(!tls){memoryError=true;close();return false;}
    // Protect the input-sized region only while the SDK allocates its 2120-byte
    // context and16-byte tracker. Holding it through DNS/TCP can starve packets.
    // INIT may run TLS setup immediately, so do not assume an observable later
    // CONNECTING boundary. SDK input-allocation failure remains an honest error.
    releaseInputPlacement();
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
    if(connected!=1||!bundleAttached||!allowed()||!LampUpdateControlPolicy::withinBudget(millis(),connectingAt,LampUpdateControlPolicy::ConnectBudgetMs)){
      int error=0,flags=0;esp_tls_error_handle_t handle=nullptr;
      if(esp_tls_get_error_handle(tls,&handle)==ESP_OK)transportError=esp_tls_get_and_clear_last_error(handle,&error,&flags);
      // The pinned esp-tls error tracker can expose either sign. Preserve its
      // evidence while distinguishing this exact allocator failure from a
      // certificate, protocol or network failure.
      memoryError=error==MBEDTLS_ERR_SSL_ALLOC_FAILED||error==-MBEDTLS_ERR_SSL_ALLOC_FAILED;
      tlsError=error;tlsFlags=flags;close();return false;
    }
    httpStage=3;
    if(!send("GET ")||!send(url.c_str())||!send(" HTTP/1.1\r\nHost: ")||!send(host.c_str())||
       !send("\r\nUser-Agent: CoolLamp/" LAMP_FIRMWARE_VERSION "\r\nAccept-Encoding: identity\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n")){close();return false;}
    const auto response=readResponseHeaders(url,host,code,length);
    if(response==HeaderResult::Redirect)continue;
    return response==HeaderResult::Ready;
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
