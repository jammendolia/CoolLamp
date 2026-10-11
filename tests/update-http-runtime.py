"""Execute the production HTTPS client against nonblocking pinned-API fakes."""
from pathlib import Path
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
ARDUINO = r'''
#pragma once
#include <cstdint>
#include <cstring>
#include <string>
struct String:std::string{
 using std::string::string;using std::string::operator=;
 String(const std::string& s):std::string(s){}
 bool startsWith(const char* s)const{return compare(0,strlen(s),s)==0;}
 int indexOf(char c,size_t at=0)const{auto n=find(c,at);return n==npos?-1:int(n);}
 String substring(size_t at,size_t to=npos)const{return substr(at,to==npos?npos:to-at);}
};
inline String operator+(const String& s,int n){return std::string(s)+std::to_string(n);}
uint32_t millis();void vTaskDelay(unsigned);
'''
TLS = r'''
#pragma once
#include <cstddef>
#include <cstdint>
using esp_err_t=int;constexpr int ESP_OK=0;
constexpr int ESP_TLS_ERR_SSL_WANT_READ=-0x6900,ESP_TLS_ERR_SSL_WANT_WRITE=-0x6880;
enum esp_tls_conn_state_t{ESP_TLS_INIT,ESP_TLS_CONNECTING,ESP_TLS_HANDSHAKE,ESP_TLS_DONE};
struct esp_tls_t{unsigned response=0;size_t cursor=0;uint32_t started=0;esp_tls_conn_state_t state=ESP_TLS_INIT;bool internalSets=true;};
struct esp_tls_cfg_t{bool non_block=false;int timeout_ms=0;int(*crt_bundle_attach)(void*)=nullptr;};
using esp_tls_error_handle_t=void*;
esp_tls_t* esp_tls_init();void esp_tls_conn_destroy(esp_tls_t*);
int esp_tls_conn_new_async(const char*,int,int,const esp_tls_cfg_t*,esp_tls_t*);
int esp_tls_get_conn_state(esp_tls_t*,esp_tls_conn_state_t*);
int esp_tls_get_conn_sockfd(esp_tls_t*,int*);
int esp_tls_conn_read(esp_tls_t*,void*,size_t);
int esp_tls_conn_write(esp_tls_t*,const void*,size_t);
inline int esp_tls_get_error_handle(esp_tls_t*,void** out){*out=nullptr;return ESP_OK;}
inline int esp_tls_get_and_clear_last_error(void*,int* error,int* flags){*error=0;*flags=0;return 0;}
'''
SOCKETS = r'''
#pragma once
#include <cstdint>
struct LampFakeFdSet{uint32_t mask=0;};
struct LampFakeTimeval{long tv_sec=0,tv_usec=0;};
using LampFakeSocklen=unsigned;
#define fd_set LampFakeFdSet
#define timeval LampFakeTimeval
#define socklen_t LampFakeSocklen
#undef FD_ZERO
#undef FD_SET
#undef FD_SETSIZE
#define FD_SETSIZE 16
#define FD_ZERO(p) ((p)->mask=0)
#define FD_SET(fd,p) ((p)->mask|=(1u<<(fd)))
constexpr int SOL_SOCKET=1,SO_ERROR=2;
int fakeSelect(int,fd_set*,fd_set*,fd_set*,timeval*);
int fakeGetSockOpt(int,int,int,void*,socklen_t*);
#define select fakeSelect
#define getsockopt fakeGetSockOpt
'''
FIXTURE = r'''
#include <algorithm>
#include <cassert>
#include <cstring>
#include <iostream>
#include <vector>
#include "UpdateHttp.h"
#include "LampUpdateControlPolicy.h"
#include <lwip/sockets.h>
uint32_t clockMs=0,delayScale=1,connectMs=0,cancelAt=UINT32_MAX;
unsigned initCalls=0,destroyCalls=0,connectCalls=0,readCalls=0,writeCalls=0;
unsigned clearedSetBypasses=0;esp_tls_t* currentTls=nullptr;
bool neverConnect=false,neverRead=false,neverWrite=false,initFails=false,oneByteWrite=false;
bool wantReadOnce=false,wantWriteOnce=false;
size_t freeHeap=65536,largest=32768,maxWrite=0;
std::atomic<bool> cancel{false};
std::vector<std::string> responses;
uint32_t millis(){return clockMs;}
void vTaskDelay(unsigned n){clockMs+=n*delayScale;if(cancelAt!=UINT32_MAX&&clockMs>=cancelAt)cancel=true;}
size_t heap_caps_get_free_size(unsigned){return freeHeap;}
size_t heap_caps_get_largest_free_block(unsigned){return largest;}
esp_tls_t* esp_tls_init(){++initCalls;if(initFails)return nullptr;auto* p=new esp_tls_t;p->response=initCalls-1;p->started=clockMs;currentTls=p;return p;}
void esp_tls_conn_destroy(esp_tls_t* p){assert(p);++destroyCalls;delete p;}
int esp_tls_get_conn_state(esp_tls_t* p,esp_tls_conn_state_t* state){*state=p->state;return ESP_OK;}
int esp_tls_get_conn_sockfd(esp_tls_t*,int* fd){*fd=3;return ESP_OK;}
int fakeSelect(int count,fd_set* read,fd_set* write,fd_set* except,timeval* timeout){
 assert(count==4&&!read&&!except&&write&&write->mask==(1u<<3)&&timeout&&timeout->tv_sec==0&&timeout->tv_usec==0);
 const bool ready=!neverConnect&&uint32_t(clockMs-currentTls->started)>=connectMs;
 if(!ready)write->mask=0;
 return ready?1:0;
}
int fakeGetSockOpt(int fd,int level,int option,void* value,socklen_t* size){
 assert(fd==3&&level==SOL_SOCKET&&option==SO_ERROR&&*size==sizeof(int));*static_cast<int*>(value)=0;return 0;
}
int esp_tls_conn_new_async(const char* host,int length,int port,const esp_tls_cfg_t* cfg,esp_tls_t* p){
 ++connectCalls;assert(cfg->timeout_ms==10&&cfg->crt_bundle_attach);
 assert(length==int(strlen(host))&&port==443);
 // Emulate the pinned SDK transition, including lwIP clearing the SDK's own
 // select sets after a finite timeout. Repeated naive async calls cannot repair
 // those sets. The production client must use its public fresh socket poll.
 if(p->state==ESP_TLS_INIT){assert(cfg->non_block);p->state=ESP_TLS_CONNECTING;}
 if(p->state==ESP_TLS_CONNECTING){
  if(cfg->non_block){
   if(!p->internalSets)return 0;
   if(neverConnect||uint32_t(clockMs-p->started)<connectMs){clockMs+=10;p->internalSets=false;return 0;}
  }else{
   assert(!neverConnect&&uint32_t(clockMs-p->started)>=connectMs);
   if(!p->internalSets)++clearedSetBypasses;
  }
  p->state=ESP_TLS_HANDSHAKE;return 0;
 }
 assert(p->state==ESP_TLS_HANDSHAKE&&cfg->non_block);p->state=ESP_TLS_DONE;return 1;
}
int esp_tls_conn_write(esp_tls_t*,const void*,size_t size){
 ++writeCalls;maxWrite=std::max(maxWrite,size);assert(size<=512);
 if(wantWriteOnce){wantWriteOnce=false;return ESP_TLS_ERR_SSL_WANT_WRITE;}
 if(neverWrite)return ESP_TLS_ERR_SSL_WANT_READ;
 return oneByteWrite?1:int(size);
}
int esp_tls_conn_read(esp_tls_t* p,void* out,size_t size){
 ++readCalls;if(wantReadOnce){wantReadOnce=false;return ESP_TLS_ERR_SSL_WANT_READ;}
 if(neverRead)return ESP_TLS_ERR_SSL_WANT_WRITE;
 assert(p->response<responses.size());const auto& text=responses[p->response];
 const auto n=std::min(size,text.size()-p->cursor);memcpy(out,text.data()+p->cursor,n);p->cursor+=n;return n;
}
int main(int argc,char** argv){
 assert(argc==2);const std::string test=argv[1];
 const String url="https://github.com/jammendolia/CoolLamp/releases/latest/download/coollamp-manifest.txt";
 responses={"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc"};
 if(test=="slow-connect")neverConnect=true;
 if(test=="read-deadline")neverRead=true;
 if(test=="write-deadline")neverWrite=true;
 if(test=="write-trickle"){oneByteWrite=true;delayScale=100;}
 if(test=="cancel-connect"){neverConnect=true;cancelAt=7;}
 if(test=="cancel-read"){neverRead=true;cancelAt=20;}
 if(test=="cancel-write"){neverWrite=true;cancelAt=20;}
 if(test=="partial"){wantReadOnce=wantWriteOnce=true;connectMs=40;oneByteWrite=true;}
 if(test=="rollover"){clockMs=UINT32_MAX-2;connectMs=5;}
 if(test=="low-free")freeHeap=24575;
 if(test=="low-largest")largest=16383;
 if(test=="allocation")initFails=true;
 if(test=="already-cancelled")cancel=true;
 if(test=="redirect"||test=="redirect-deadline"){
  const std::string redirect="HTTP/1.1 302 Found\r\nLocation: https://release-assets.githubusercontent.com/test\r\nContent-Length: 0\r\n\r\n";
  responses={redirect,redirect,redirect,redirect,responses[0]};
  connectMs=test=="redirect-deadline"?2000:10;
 }
 if(test=="explicit") {neverRead=true;delayScale=100;}
 if(test=="explicit-connect")neverConnect=true;
 if(test=="explicit-not-cancelled")cancel=true;
 const uint32_t start=clockMs;
 {
  UpdateHttp client;int code=0;int64_t length=-1;
  const bool explicitOperation=test=="explicit"||test=="explicit-connect"||test=="explicit-not-cancelled";
  const bool ok=client.open(url,code,length,explicitOperation?nullptr:&cancel,explicitOperation?180000:6000);
  if(test=="normal"||test=="partial"||test=="rollover"||test=="redirect"||test=="explicit-not-cancelled"){
   assert(ok&&code==200&&length==3);char body[4]{};assert(client.read(body,2)==2);assert(client.read(body+2,2)==1);
   assert(!strcmp(body,"abc")&&client.complete()&&client.read(body,1)==0);
   if(test=="partial")assert(readCalls>=2&&writeCalls>100&&connectCalls>1&&clearedSetBypasses==1);
   if(test=="rollover")assert(clockMs<100);
   if(test=="redirect")assert(initCalls==5);
  }else{
   assert(!ok);
   if(test=="low-free"||test=="low-largest"||test=="allocation")assert(client.memoryFailure()&&initCalls==(test=="allocation"?1u:0u));
   if(test.rfind("cancel-",0)==0||test=="already-cancelled")assert(client.cancelled()&&uint32_t(clockMs-start)<6000);
   if(test=="already-cancelled")assert(!initCalls);
   if(test=="slow-connect"||test=="read-deadline"||test=="write-deadline"||test=="write-trickle"||test=="redirect-deadline")assert(uint32_t(clockMs-start)==6000);
   if(test=="redirect-deadline")assert(initCalls==3);
   if(test=="explicit")assert(uint32_t(clockMs-start)>=30000&&uint32_t(clockMs-start)<180000);
   if(test=="explicit-connect")assert(uint32_t(clockMs-start)==12000);
  }
 }
 assert(destroyCalls==initCalls-(initFails?1u:0u));
 // A denied/cancelled check frees its own TLS and admits a later fresh request.
 cancel=false;neverConnect=neverRead=neverWrite=initFails=oneByteWrite=false;
 cancelAt=UINT32_MAX;delayScale=1;freeHeap=65536;largest=32768;connectMs=0;
 responses.assign(initCalls+8,"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
 {UpdateHttp next;int code;int64_t length;assert(next.open(url,code,length));assert(next.complete());}
 assert(destroyCalls==initCalls-(test=="allocation"?1u:0u));
 std::cout<<"PASS: production HTTPS "<<test<<"\n";
}
'''


class UpdateHttpRuntimeTests(unittest.TestCase):
    def test_actual_tls_client(self):
        with tempfile.TemporaryDirectory(prefix='lamp-update-http-') as directory:
            folder = Path(directory)
            (folder/'mbedtls').mkdir()
            (folder/'lwip').mkdir()
            (folder/'Arduino.h').write_text(ARDUINO)
            (folder/'esp_tls.h').write_text(TLS)
            (folder/'lwip/sockets.h').write_text(SOCKETS)
            (folder/'esp_heap_caps.h').write_text('#pragma once\n#include <cstddef>\nconstexpr unsigned MALLOC_CAP_8BIT=1;\nsize_t heap_caps_get_free_size(unsigned);size_t heap_caps_get_largest_free_block(unsigned);\n')
            (folder/'esp_crt_bundle.h').write_text('#pragma once\ninline int esp_crt_bundle_attach(void*){return 0;}\n')
            (folder/'mbedtls/ssl.h').write_text('#pragma once\nstruct mbedtls_ssl_config{};\ninline void mbedtls_ssl_conf_ciphersuites(mbedtls_ssl_config*,const int*){}\n')
            (folder/'mbedtls/ssl_ciphersuites.h').write_text('#pragma once\n#define MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 1\n#define MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384 2\n')
            cpp, binary = folder/'test.cpp', folder/'test'
            cpp.write_text(FIXTURE)
            subprocess.run(['c++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,
                            '-I'+str(folder),'-I'+str(ROOT),str(cpp),str(ROOT/'UpdateHttp.cpp'),'-o',str(binary)],check=True)
            for case in ('normal','partial','rollover','redirect','redirect-deadline','slow-connect',
                         'read-deadline','write-deadline','write-trickle','cancel-connect','cancel-read',
                         'cancel-write','already-cancelled','low-free','low-largest','allocation',
                         'explicit','explicit-connect','explicit-not-cancelled'):
                subprocess.run([str(binary),case],check=True)


if __name__ == '__main__':
    unittest.main()
