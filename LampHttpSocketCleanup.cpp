#include "LampHttpSocketCleanup.h"
#include "LampHttpParser.h"
#include <Arduino.h>
#include <esp_arduino_version.h>
#include <esp_idf_version.h>
#include <lwip/api.h>
#include <lwip/tcp.h>
#include <lwip/tcpip.h>
// The pinned Espressif header declares the debug getter outside its own C++
// linkage block. The library exports a C symbol (verified with its nm tool).
extern "C" {
#include <lwip/priv/sockets_priv.h>
}
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
#include <atomic>
#include <errno.h>
#include <stddef.h>

// This is deliberately a pinned compatibility shim, not a portable socket API.
// Re-audit sockets.c/api_msg.c/tcp.c before changing the platform. Core 3.3.11
// bundles IDF 5.5.5, esp-lwIP fd432e4ee2cfb7f7f1c7eb7227e0173412e7b84e.
#if ESP_ARDUINO_VERSION != ESP_ARDUINO_VERSION_VAL(3,3,11) || ESP_IDF_VERSION != ESP_IDF_VERSION_VAL(5,5,5)
#error "Re-audit the CoolLamp detached HTTP socket shim for this platform version."
#endif
#if !LWIP_TCPIP_CORE_LOCKING || !LWIP_NETCONN_FULLDUPLEX || !LWIP_SOCKET || !LWIP_TCP
#error "CoolLamp HTTP socket cleanup requires the audited core-locking socket configuration."
#endif
static_assert(offsetof(lwip_sock,conn)==0,"Pinned socket layout changed");

namespace LampHttpSocketCleanup {
namespace {
QueueHandle_t closeQueue=nullptr;
TaskHandle_t closeTask=nullptr;
std::atomic<uint32_t> queued{0},attempts{0},failures{0},aborts{0},pending{0},maxOwned{0};
void increment(std::atomic<uint32_t>& value){auto n=value.load(std::memory_order_relaxed);while(n!=UINT32_MAX&&!value.compare_exchange_weak(n,n+1,std::memory_order_relaxed)){};}
void maximum(std::atomic<uint32_t>& value,uint32_t n){auto previous=value.load(std::memory_order_relaxed);while(previous<n&&!value.compare_exchange_weak(previous,n,std::memory_order_relaxed)){};}
struct Snapshot {bool busy=false,tcp=false,listener=false,pending=false;uint32_t bytes=0,segments=0;};
Snapshot inspect(int fd,bool abandon,bool cancelled=false){
  Snapshot result;
  // Only this task owns the detached fd, and it has not successfully closed it.
  // The getter does not acquire a socket reference. Exclusive fd ownership and
  // the core lock protect the conn/PCB lifetime; no pointer escapes this call.
  LOCK_TCPIP_CORE();
  auto* socket=lwip_socket_dbg_get_socket(fd);
  if(socket&&socket->conn){
    auto* conn=socket->conn;
    if(socket->fd_used||socket->fd_free_pending)result.busy=true;
    else if(NETCONNTYPE_GROUP(netconn_type(conn))==NETCONN_TCP){
      result.tcp=true;auto* pcb=conn->pcb.tcp;
      if(pcb){
        result.listener=pcb->state==LISTEN;
        if(!result.listener){
          result.pending=pcb->unsent||pcb->unacked;
          result.bytes=TCP_SND_BUF-tcp_sndbuf(pcb);result.segments=tcp_sndqueuelen(pcb);
          if(abandon&&(cancelled||result.pending)){
            // tcp_abort frees unsent/unacked pbufs and calls the netconn error
            // callback, which clears conn->pcb. Never touch pcb afterwards.
            tcp_abort(pcb);increment(aborts);result.pending=false;
          }
        }
      }
    }
  }
  UNLOCK_TCPIP_CORE();
  return result;
}
void closeWorker(void*){
  for(;;){
    Request request;
    if(xQueueReceive(closeQueue,&request,portMAX_DELAY)!=pdTRUE||request.fd<0)continue;
    Owner owner(request);
    // At most one worker-owned fd plus four queue entries. Failed close retains
    // ownership and backpressures admissions; it is never dropped after retries.
    while(!owner.step(millis()))vTaskDelay(pdMS_TO_TICKS(10)?pdMS_TO_TICKS(10):1);
    pending.fetch_sub(1,std::memory_order_relaxed);
  }
}
}
TransmitCredit transmitCredit(int fd){
  if(fd<0)return {0,true};
  // IDF 5.5.5 sys_mutex_t is SemaphoreHandle_t and sys_mutex_new creates a
  // nonrecursive mutex. Mirror its holder marking, with zero wait instead of
  // LOCK_TCPIP_CORE's portMAX_DELAY. Never call a socket API while holding it.
  if(!lock_tcpip_core||xSemaphoreTake(lock_tcpip_core,0)!=pdTRUE)return {};
  sys_thread_tcpip(LWIP_CORE_LOCK_MARK_HOLDER);
  TransmitCredit result;
  auto* socket=lwip_socket_dbg_get_socket(fd);
  if(!socket||!socket->conn)result.disconnected=true;
  else if(!socket->fd_used&&!socket->fd_free_pending){
    auto* conn=socket->conn;
    if(NETCONNTYPE_GROUP(netconn_type(conn))!=NETCONN_TCP)result.disconnected=true;
    else {
      const auto* pcb=conn->pcb.tcp;
      if(!pcb||(pcb->state!=ESTABLISHED&&pcb->state!=CLOSE_WAIT))result.disconnected=true;
      else {
        result.observed=true;
        result.pendingBytes=uint16_t(TCP_SND_BUF-tcp_sndbuf(pcb));
        result.pendingSegments=uint16_t(tcp_sndqueuelen(pcb));
        if(!pcb->unsent&&!pcb->unacked&&!result.pendingSegments&&tcp_sndbuf(pcb)==TCP_SND_BUF){
          // Clamp initial enqueue to payload MSS. tcp_mss subtracts timestamps;
          // later SDK window splits/retransmission may use additional pbufs.
          const uint16_t payload=tcp_mss(pcb);
          if(payload)result.bytes=payload<MaxTransmitFlightBytes?payload:MaxTransmitFlightBytes;
        }
      }
    }
  }
  sys_thread_tcpip(LWIP_CORE_LOCK_UNMARK_HOLDER);
  xSemaphoreGive(lock_tcpip_core);
  return result;
}
bool Owner::step(uint32_t now){
  if(!active_)return true;
  maximum(maxOwned,uint32_t(now-request_.acceptedAt));
  if(!closing_){
    const auto state=inspect(request_.fd,false);
    if(state.busy)return false;
    if(observed_&&(state.bytes<previousBytes_||state.segments<previousSegments_))request_.progressAt=now;
    observed_=true;previousBytes_=state.bytes;previousSegments_=state.segments;
    const bool expired=LampHttpParser::elapsed(now,request_.acceptedAt,request_.absoluteTimeoutMs)||
      LampHttpParser::elapsed(now,request_.progressAt,state.pending?AckWaitTimeoutMs:LampHttpParser::IdleTimeoutMs);
    if(state.tcp&&!state.listener&&(request_.cancelled||(state.pending&&expired))){
      // Recheck under the lock: ACK delivery may have freed the queue since the
      // first observation. Cancelling is terminal; normal drained data is kept.
      const auto final=inspect(request_.fd,true,request_.cancelled);
      if(final.busy)return false;
      closing_=true;
    }else if(state.pending)return false;
    else closing_=true;
  }
  increment(attempts);
  const int result=close(request_.fd);
  if(result==0||errno==EBADF){active_=false;request_.fd=-1;return true;}
  // In this exact lwIP implementation close -1 leaves the descriptor allocated.
  // The single owner retains it with a 10ms worker backoff, bounded queue space
  // and honest pending metrics, rather than leaking or touching a reused fd.
  increment(failures);return false;
}
bool start(uint32_t stackBytes){
  if(stackBytes<2048||stackBytes>8192)return false;
  if(closeQueue)return true;
  closeQueue=xQueueCreate(4,sizeof(Request));if(!closeQueue)return false;
  if(xTaskCreate(closeWorker,"lamp-http-close",stackBytes,nullptr,1,&closeTask)!=pdPASS){vQueueDelete(closeQueue);closeQueue=nullptr;closeTask=nullptr;return false;}
  return true;
}
bool enqueue(const Request& request){
  if(request.fd<0)return true;if(!closeQueue)return false;
  // Publish ownership before waking the consumer so its decrement cannot race
  // ahead of this increment. Failed enqueue leaves ownership with the caller.
  pending.fetch_add(1,std::memory_order_relaxed);
  if(xQueueSend(closeQueue,&request,0)!=pdTRUE){pending.fetch_sub(1,std::memory_order_relaxed);return false;}
  increment(queued);return true;
}
uint32_t taskStackMinimumBytes(){return closeTask?uint32_t(uxTaskGetStackHighWaterMark(closeTask)):0;}
Metrics metrics(){return {queued.load(std::memory_order_relaxed),attempts.load(std::memory_order_relaxed),failures.load(std::memory_order_relaxed),aborts.load(std::memory_order_relaxed),pending.load(std::memory_order_relaxed),maxOwned.load(std::memory_order_relaxed)};}
}
