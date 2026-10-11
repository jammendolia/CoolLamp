#include "LampHttpSocketCleanup.h"
#include <lwip/api.h>
#include <lwip/tcpip.h>
extern "C" {
#include <lwip/priv/sockets_priv.h>
}
#include <freertos/queue.h>
#include <freertos/task.h>
#include <cassert>
#include <errno.h>
#include <map>
#include <deque>
#include <cstring>
#include <iostream>
#include <string>
using namespace LampHttpSocketCleanup;
#if defined(LAMP_HTTP_LEGACY_ACK_POLICY_FIXTURE)
static_assert(AckWaitTimeoutMs==3500,"Legacy policy comparison drifted");
#else
static_assert(AckWaitTimeoutMs==5000,"Copied-data idle contract drifted");
#endif
static uint32_t clockMs=0;
static unsigned locks=0,unlocks=0,lookups=0,closeCalls=0,abortCalls=0;
static bool locked=false,inWorker=true;
static bool tryContended=false,holderMarked=false;
static unsigned tryLocks=0;
SemaphoreHandle_t lock_tcpip_core=reinterpret_cast<void*>(1);
BaseType_t xSemaphoreTake(SemaphoreHandle_t semaphore,TickType_t ticks){
  assert(semaphore==lock_tcpip_core&&ticks==0&&!inWorker&&!locked);++tryLocks;
  if(tryContended)return pdFALSE;locked=true;++locks;return pdTRUE;
}
BaseType_t xSemaphoreGive(SemaphoreHandle_t semaphore){assert(semaphore==lock_tcpip_core&&!inWorker&&locked&&!holderMarked);locked=false;++unlocks;return pdTRUE;}
bool sys_thread_tcpip(sys_thread_core_lock_t type){
  assert(!inWorker&&locked);if(type==LWIP_CORE_LOCK_MARK_HOLDER){assert(!holderMarked);holderMarked=true;}
  else if(type==LWIP_CORE_LOCK_UNMARK_HOLDER){assert(holderMarked);holderMarked=false;}else assert(holderMarked);return true;
}
static tcp_seg pendingSegment;
static unsigned drainAtLookup=0;
struct Peer {tcp_pcb pcb;netconn conn;lwip_sock socket;unsigned generation=0,failClose=0;bool foreverFail=false,closed=false;};
static std::map<int,Peer> peers;
uint32_t millis(){return clockMs;}
void testLock(){assert(inWorker&&!locked);locked=true;++locks;}
void testUnlock(){assert(locked);locked=false;++unlocks;}
static Peer& create(int fd,unsigned generation=1){auto& p=peers[fd];p=Peer{};p.generation=generation;p.conn.pcb.tcp=&p.pcb;p.socket.conn=&p.conn;return p;}
static void buffered(Peer& p,uint32_t bytes){p.pcb.unsent=bytes?&pendingSegment:nullptr;p.pcb.snd_buf=TCP_SND_BUF-bytes;p.pcb.snd_queuelen=bytes?1:0;}
extern "C" lwip_sock* lwip_socket_dbg_get_socket(int fd){assert(locked&&(inWorker||holderMarked));++lookups;auto it=peers.find(fd);if(it!=peers.end()&&lookups==drainAtLookup)buffered(it->second,0);return it==peers.end()?nullptr:&it->second.socket;}
void tcp_abort(tcp_pcb* pcb){
  assert(locked&&inWorker&&pcb->state!=LISTEN);++abortCalls;
  bool found=false;for(auto& pair:peers)if(&pair.second.pcb==pcb){auto& p=pair.second;assert(!p.closed);buffered(p,0);p.conn.pcb.tcp=nullptr;found=true;break;}assert(found);
}
extern "C" int close(int fd){
  assert(inWorker&&!locked);++closeCalls;
  auto it=peers.find(fd);if(it==peers.end()){errno=EBADF;return -1;}
  auto& p=it->second;assert(!p.closed);
  if(p.failClose||p.foreverFail){if(p.failClose)--p.failClose;errno=ENOMEM;return -1;}
  // A successful ordinary close must never carry undrained copied TCP data.
  assert(p.conn.pcb.tcp==nullptr||(!p.pcb.unsent&&!p.pcb.unacked)||p.pcb.state==LISTEN);
  p.closed=true;p.socket.conn=nullptr;return 0;
}
struct FakeQueue {unsigned capacity;std::deque<Request> values;};
struct Suspended{};
static TaskFunction_t worker=nullptr;
static bool queueFailure=false,taskFailure=false,queueDeleted=false;
QueueHandle_t xQueueCreate(UBaseType_t n,UBaseType_t bytes){assert(n==4&&bytes==sizeof(Request));if(queueFailure)return nullptr;return new FakeQueue{n,{}};}
BaseType_t xQueueSend(QueueHandle_t q,const void* data,TickType_t ticks){assert(!locked&&ticks==0);if(q->values.size()==q->capacity)return pdFALSE;q->values.push_back(*static_cast<const Request*>(data));return pdTRUE;}
BaseType_t xQueueReceive(QueueHandle_t q,void* data,TickType_t ticks){assert(inWorker&&!locked&&ticks==portMAX_DELAY);if(q->values.empty())throw Suspended{};*static_cast<Request*>(data)=q->values.front();q->values.pop_front();return pdTRUE;}
void vQueueDelete(QueueHandle_t q){queueDeleted=true;delete q;}
BaseType_t xTaskCreate(TaskFunction_t task,const char* name,uint32_t stack,void*,UBaseType_t priority,TaskHandle_t* handle){assert(!strcmp(name,"lamp-http-close")&&stack==2048&&priority==1);if(taskFailure)return pdFALSE;worker=task;*handle=reinterpret_cast<void*>(1);return pdPASS;}
UBaseType_t uxTaskGetStackHighWaterMark(TaskHandle_t handle){assert(handle);return 800;}
void vTaskDelay(TickType_t ticks){assert(!locked&&ticks==10);clockMs+=ticks;assert(clockMs<10000);}
static void runWorker(){try{worker(nullptr);}catch(const Suspended&){}assert(!locked);}
int main(int argc,char** argv){
  assert(argc==2);const std::string scenario=argv[1];

  if(scenario=="policy-owner-ack-3.6"||scenario=="policy-owner-ack-rollover"){
    const uint32_t began=scenario=="policy-owner-ack-rollover"?UINT32_MAX-1500:0;auto& p=create(70);buffered(p,1024);Owner owner({70,began,began,5000,false,1024});assert(!owner.step(began));
    const bool finished=owner.step(began+3501);
    if(AckWaitTimeoutMs==3500)assert(finished&&p.closed&&abortCalls==1);
    else {assert(!finished&&!p.closed&&!abortCalls);buffered(p,0);assert(owner.step(began+3600)&&p.closed&&!abortCalls);}
    const auto before=lookups;create(70,2);assert(owner.step(began+7000)&&lookups==before&&!peers[70].closed);
  }else if(scenario=="policy-owner-no-progress-absolute"){
    auto& p=create(71);buffered(p,1024);Owner owner({71,0,0,5000,false,1024});assert(!owner.step(0));
    const bool finished=owner.step(4000);if(AckWaitTimeoutMs==3500)assert(finished&&p.closed);else {assert(!finished&&!p.closed);assert(owner.step(5000)&&p.closed);}assert(abortCalls==1);
  }else if(scenario=="policy-owner-copied-idle-bulk"){
    auto& p=create(72);buffered(p,1024);Owner html({72,0,0,15000,false,1024});assert(!html.step(0));
    assert(!html.step(AckWaitTimeoutMs-1));assert(html.step(AckWaitTimeoutMs)&&p.closed&&abortCalls==1);
    auto& upload=create(73);buffered(upload,1024);Owner ota({73,0,0,180000,false,1024});assert(ota.step(AckWaitTimeoutMs)&&upload.closed&&abortCalls==2);
  }else if(scenario=="policy-owner-cancel-and-equal"){
    auto& p=create(74);buffered(p,256);Owner owner({74,0,0,5000,true,1024});assert(owner.step(1)&&p.closed&&abortCalls==1);
    auto& q=create(75);buffered(q,1024);Owner equal({75,0,0,5000,false,1024});for(uint32_t now=0;now<AckWaitTimeoutMs&&now<5000;now+=500)assert(!equal.step(now));assert(equal.step(AckWaitTimeoutMs<5000?AckWaitTimeoutMs:5000)&&q.closed&&abortCalls==2);
  }else if(scenario=="normal-ack-and-fd-reuse"){
    auto& p=create(7);buffered(p,2000);Owner owner({7,0,0,5000,false});
    assert(!owner.step(0)&&!closeCalls);buffered(p,1000);assert(!owner.step(1000));
    assert(!owner.step(2000));buffered(p,0);assert(owner.step(2100)&&p.closed&&!abortCalls);
    const auto before=lookups;create(7,2).conn.type=NETCONN_UDP;assert(owner.step(6000)&&lookups==before&&!peers[7].closed&&peers[7].generation==2);
  }else if(scenario=="ack-between-observation-and-abort"){
    auto& p=create(6);buffered(p,200);Owner owner({6,0,0,5000,false});drainAtLookup=lookups+2;
    assert(owner.step(5000)&&p.closed&&!abortCalls&&closeCalls==1);
  }else if(scenario=="zero-window-idle-and-absolute"){
    auto& p=create(8);buffered(p,5744);Owner owner({8,0,0,5000,false});assert(!owner.step(4999));assert(owner.step(5000)&&p.closed&&abortCalls==1);
    auto& p2=create(9);buffered(p2,5000);Owner second({9,0,0,5000,false});
    for(uint32_t now=1000;now<5000;now+=1000){buffered(p2,5000-now/10);assert(!second.step(now));}
    assert(second.step(5000)&&p2.closed&&abortCalls==2);
  }else if(scenario=="cancel-and-upload-lifetime"){
    auto& p=create(10);buffered(p,200);Owner cancelled({10,0,0,5000,true});assert(cancelled.step(1)&&p.closed&&abortCalls==1);
    auto& upload=create(11);buffered(upload,100);Owner owner({11,0,10000,180000,false});assert(!owner.step(10001));buffered(upload,0);assert(owner.step(10002)&&upload.closed&&abortCalls==1);
  }else if(scenario=="rollover"){
    const uint32_t began=UINT32_MAX-700;auto& p=create(12);buffered(p,100);Owner owner({12,began,began,5000,false});assert(!owner.step(began+4999));assert(owner.step(began+5000)&&p.closed&&abortCalls==1);
  }else if(scenario=="html-custom-lifetime-and-fd-reuse"){
    const uint32_t began=UINT32_MAX-1000;auto& p=create(50);buffered(p,100);Owner html({50,began,began+14000,15000,false});
    assert(!html.step(began+14999)&&!p.closed&&!abortCalls);assert(html.step(began+15000)&&p.closed&&abortCalls==1);
    const auto before=lookups;create(50,2);assert(html.step(began+30000)&&lookups==before&&!peers[50].closed&&peers[50].generation==2);
    auto& idle=create(51);buffered(idle,10);Owner shortIdle({51,0,1000,15000,false});assert(!shortIdle.step(5999));assert(shortIdle.step(6000)&&idle.closed&&abortCalls==2);
  }else if(scenario=="last-data-ack-loss-recovers-at-three-seconds"){
    const uint32_t began=UINT32_MAX-500;auto& p=create(52);buffered(p,40);Owner owner({52,began,began,5000,false});
    assert(!owner.step(began+1501)&&!p.closed&&!abortCalls);buffered(p,0);assert(owner.step(began+3000)&&p.closed&&!abortCalls);
    const auto before=lookups;create(52,2);assert(owner.step(began+7000)&&lookups==before&&!peers[52].closed);
  }else if(scenario=="partial-ack-progress-total-cancel-and-rollover"){
    const uint32_t began=UINT32_MAX-1500;auto& p=create(53);buffered(p,1024);Owner owner({53,began,began,5000,false});assert(!owner.step(began));
    for(uint32_t elapsed=1000;elapsed<4000;elapsed+=1000){buffered(p,1024-elapsed/4);assert(!owner.step(began+elapsed)&&!p.closed&&!abortCalls);}
    buffered(p,0);assert(owner.step(began+4000)&&p.closed&&!abortCalls);
    const auto before=lookups;create(53,2);assert(owner.step(began+8000)&&lookups==before&&!peers[53].closed);
    auto& equal=create(54);buffered(equal,1024);Owner idle({54,0,0,5000,false});
    for(uint32_t now=0;now<5000;now+=500)assert(!idle.step(now));assert(idle.step(5000)&&equal.closed&&abortCalls==1);
    auto& total=create(55);buffered(total,1024);Owner hard({55,0,0,5000,false});assert(!hard.step(0));
    for(uint32_t now=1000;now<5000;now+=1000){buffered(total,1024-now/10);assert(!hard.step(now));}
    buffered(total,500);assert(hard.step(5000)&&total.closed&&abortCalls==2);
    auto& cancelled=create(56);buffered(cancelled,512);Owner stop({56,0,1000,5000,true});assert(stop.step(1001)&&cancelled.closed&&abortCalls==3);
  }else if(scenario=="delayed-first-partial-known-flight-baseline"){
    const uint32_t began=UINT32_MAX-1500;auto& p=create(57);buffered(p,256);
    // The queue delayed inspection; ACKed bytes were freed before the first
    // snapshot. The actual last write baseline, not sampling alone, proves it.
    Owner owner({57,began,began,15000,false,1024});assert(!owner.step(began+5600)&&!p.closed&&!abortCalls);
    buffered(p,0);assert(owner.step(began+6000)&&p.closed&&!abortCalls);
    const auto before=lookups;create(57,2);assert(owner.step(began+8000)&&lookups==before&&!peers[57].closed);
    auto& equal=create(58);buffered(equal,1024);Owner unchanged({58,0,0,15000,false,1024});assert(unchanged.step(5600)&&equal.closed&&abortCalls==1);
    auto& total=create(59);buffered(total,256);Owner absolute({59,0,0,5000,false,1024});assert(absolute.step(5000)&&total.closed&&abortCalls==2);
    auto& stop=create(60);buffered(stop,256);Owner cancelled({60,0,0,5000,true,1024});assert(cancelled.step(1)&&stop.closed&&abortCalls==3);
    auto& busy=create(61);buffered(busy,1024);busy.socket.fd_used=1;Owner unavailable({61,0,0,15000,false,1024});assert(!unavailable.step(5400)&&!busy.closed);
    busy.socket.fd_used=0;assert(unavailable.step(5600)&&busy.closed&&abortCalls==4); // No observed decrease.
    auto& unknown=create(62);buffered(unknown,256);Owner noBaseline({62,0,0,15000,false});assert(noBaseline.step(5600)&&unknown.closed&&abortCalls==5);
    auto& listener=create(63);listener.pcb.state=LISTEN;Owner listen({63,0,0,5000,false});assert(listen.step(3600)&&listener.closed&&abortCalls==5);
    assert(sizeof(Request)==20);
  }else if(scenario=="close-failure-retains-ownership"){
    auto& p=create(13);p.failClose=2;Owner owner({13,0,0,5000,false});assert(!owner.step(0));const auto before=lookups;
    assert(!owner.step(10)&&lookups==before&&!p.closed);assert(owner.step(20)&&lookups==before&&p.closed&&closeCalls==3);
    assert(metrics().closeFailures==2);
    auto& q=create(14);q.foreverFail=true;Owner quarantined({14,0,0,5000,false});for(unsigned n=0;n<10;++n)assert(!quarantined.step(n*10));assert(quarantined.active()&&!q.closed);
  }else if(scenario=="listener-nontcp-disconnected-and-busy"){
    auto& listener=create(15);listener.pcb.state=LISTEN;Owner one({15,0,0,5000,true});assert(one.step(1)&&listener.closed&&!abortCalls);
    auto& udp=create(16);udp.conn.type=NETCONN_UDP;Owner two({16,0,0,5000,true});assert(two.step(1)&&udp.closed&&!abortCalls);
    auto& gone=create(17);gone.conn.pcb.tcp=nullptr;Owner three({17,0,0,5000,false});assert(three.step(1));
    auto& busy=create(18);busy.socket.fd_used=1;buffered(busy,100);Owner four({18,0,0,5000,true});assert(!four.step(6000)&&!busy.closed);busy.socket.fd_used=0;assert(four.step(6010)&&busy.closed&&abortCalls==1);
    Owner missing({19,0,0,5000,false});assert(missing.step(1));
  }else if(scenario=="production-worker-queue-and-bounded-backoff"){
    assert(start()&&taskStackMinimumBytes()==800);for(int fd=20;fd<24;++fd){auto& p=create(fd);buffered(p,100);p.failClose=1;assert(enqueue({fd,0,0,5000,false}));}
    create(24);assert(!enqueue({24,0,0,5000,false})&&metrics().pendingOwned==4);runWorker();assert(metrics().pendingOwned==0&&metrics().queued==4&&metrics().closeFailures==4&&metrics().aborts==4);
    assert(clockMs>=5000&&clockMs<=5050);for(int fd=20;fd<24;++fd)assert(peers[fd].closed);assert(!peers[24].closed);
  }else if(scenario=="creation-failures"){
    queueFailure=true;assert(!start());queueFailure=false;taskFailure=true;assert(!start()&&queueDeleted);taskFailure=false;assert(start());assert(enqueue({-1,0,0,5000,false})&&metrics().pendingOwned==0);
  }else if(scenario=="transmit-credit-ack-partial-and-cap"){
    inWorker=false;auto& p=create(40);auto credit=transmitCredit(40);assert(credit.bytes==1024&&!credit.disconnected&&credit.observed&&!credit.pendingBytes&&!credit.pendingSegments&&!locked&&!holderMarked);
    // Either byte ownership or pbuf ownership alone is sufficient to defer.
    buffered(p,1024);credit=transmitCredit(40);assert(!credit.bytes&&credit.observed&&credit.pendingBytes==1024&&credit.pendingSegments==1);
    buffered(p,768);credit=transmitCredit(40);assert(!credit.bytes&&credit.observed&&credit.pendingBytes==768&&credit.pendingSegments==1);
    buffered(p,128);assert(!transmitCredit(40).bytes);buffered(p,0);p.pcb.unacked=&pendingSegment;credit=transmitCredit(40);assert(!credit.bytes&&credit.observed&&!credit.pendingBytes);
    p.pcb.unacked=nullptr;
    // SDK splits/retransmission may retain several pbufs for one application
    // write. Credit waits for every queue entry, not an assumed single pbuf.
    for(uint32_t entries:{1U,2U,16U}){p.pcb.snd_queuelen=entries;credit=transmitCredit(40);assert(!credit.bytes&&credit.observed&&credit.pendingSegments==entries);}
    p.pcb.snd_queuelen=0;p.pcb.snd_buf=TCP_SND_BUF-1;assert(!transmitCredit(40).bytes);
    p.pcb.snd_buf=TCP_SND_BUF;assert(transmitCredit(40).bytes==1024);p.pcb.mss=300;assert(transmitCredit(40).bytes==300);p.pcb.mss=0;assert(!transmitCredit(40).bytes);
    p.pcb.mss=1436;p.pcb.state=CLOSE_WAIT;assert(transmitCredit(40).bytes==1024);assert(!closeCalls&&!abortCalls);
  }else if(scenario=="transmit-credit-contention-errors-and-fd-reuse"){
    inWorker=false;auto& p=create(41);const auto before=lookups;tryContended=true;auto credit=transmitCredit(41);assert(!credit.bytes&&!credit.observed&&lookups==before&&!holderMarked&&!locked);
    tryContended=false;assert(transmitCredit(41).bytes==1024);p.socket.fd_used=1;credit=transmitCredit(41);assert(!credit.bytes&&!credit.observed);p.socket.fd_used=0;p.socket.fd_free_pending=1;credit=transmitCredit(41);assert(!credit.bytes&&!credit.observed);p.socket.fd_free_pending=0;
    p.pcb.state=LISTEN;assert(transmitCredit(41).disconnected);p.pcb.state=ESTABLISHED;p.conn.type=NETCONN_UDP;assert(transmitCredit(41).disconnected);
    p.conn.type=NETCONN_TCP;p.conn.pcb.tcp=nullptr;assert(transmitCredit(41).disconnected);p.socket.conn=nullptr;assert(transmitCredit(41).disconnected);assert(transmitCredit(42).disconnected&&transmitCredit(-1).disconnected);
    create(41,2);assert(transmitCredit(41).bytes==1024&&peers[41].generation==2&&!closeCalls&&!abortCalls);
    auto* saved=lock_tcpip_core;lock_tcpip_core=nullptr;const auto without=lookups;assert(!transmitCredit(41).bytes&&lookups==without);lock_tcpip_core=saved;assert(tryLocks);
  }else return 2;
  assert(locks==unlocks&&!locked);std::cout<<scenario<<" passed\n";
}
