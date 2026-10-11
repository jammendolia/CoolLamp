#include "LampControlHttpAdapter.h"
#include "LampPage.h"
#include "LampHttpSocketCleanup.h"
#include <lwip/sockets.h>
#include <fcntl.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <cassert>
#include <cstring>
#include <cerrno>
#include <deque>
#include <map>
#include <vector>
#include <string>
#include <iostream>
#include <memory>
#include <algorithm>
#include <cstdlib>
#include <new>
#if defined(LAMP_HTTP_LEGACY_ACK_POLICY_FIXTURE)
static_assert(LampHttpSocketCleanup::AckWaitTimeoutMs==3500,"Legacy policy comparison drifted");
#else
static_assert(LampHttpSocketCleanup::AckWaitTimeoutMs==5000,"Copied-data idle contract drifted");
#endif

// Track the real production Parser allocations. This fixture does not infer
// release from implementation text or substitute a second request processor.
static void* parserAllocations[64]{};
static size_t liveParsers=0;
struct BodyAllocation {void* memory=nullptr;size_t bytes=0;};
static BodyAllocation bodyAllocations[8]{};
static size_t liveBodies=0,wipedBodies=0,totalBodies=0,lastBodyBytes=0;
static bool failBodyAllocation=false;
// Optional heap-coalescing fixture: only deletion of the actual production
// CompactParser releases these bytes. It does not bypass server admission.
static uint32_t parserFreeCredit=0,parserLargestCredit=0;
void* operator new(std::size_t size){
  void* memory=std::malloc(size);if(!memory)throw std::bad_alloc();
  if(size==sizeof(LampHttpParser::CompactParser)){
    bool recorded=false;for(auto& slot:parserAllocations)if(!slot){slot=memory;recorded=true;break;}
    assert(recorded);++liveParsers;
  }
  return memory;
}
void* operator new[](std::size_t size){
  if(size>LampHttpParser::CompactParser::StorageCapacity&&size<=LampHttpParser::BodyLimit+1){
    if(failBodyAllocation)throw std::bad_alloc();void* memory=::operator new(size);
    bool recorded=false;for(auto& slot:bodyAllocations)if(!slot.memory){slot={memory,size};recorded=true;break;}
    assert(recorded);++liveBodies;++totalBodies;lastBodyBytes=size;return memory;
  }
  return ::operator new(size);
}
void operator delete(void* memory)noexcept{
  for(auto& slot:parserAllocations)if(slot==memory&&memory){
    static_assert(std::is_standard_layout<LampHttpParser::CompactParser>::value,"Request metadata is the parser's first member");
    const auto* bytes=static_cast<const uint8_t*>(memory);for(size_t i=0;i<sizeof(LampHttpParser::Request);++i)assert(!bytes[i]);
    slot=nullptr;--liveParsers;fakeFreeHeap+=parserFreeCredit;fakeLargestFreeBlock+=parserLargestCredit;break;
  }
  for(auto& slot:bodyAllocations)if(slot.memory==memory&&memory){
    const auto* bytes=static_cast<const uint8_t*>(memory);for(size_t i=0;i<slot.bytes;++i)assert(!bytes[i]);
    slot={};--liveBodies;++wipedBodies;break;
  }
  std::free(memory);
}
void operator delete[](void* memory)noexcept{::operator delete(memory);}
void operator delete(void* memory,std::size_t)noexcept{::operator delete(memory);}
void operator delete[](void* memory,std::size_t)noexcept{::operator delete(memory);}

String lampToken="development-token";
static uint64_t clockUs=0;
static uint32_t callCostUs=10, ioCostUs=20;
static bool inService=false,inCloseWorker=false,inControl=false,forceQueueFull=false;
static size_t turnRx=0,turnTx=0,largestRead=0,largestWrite=0;
static unsigned closeCalls=0,taskCreates=0,lastListener=0;
static bool creditContended=false;
static char bulkPage[16385]{};
uint32_t millis(){return uint32_t(clockUs/1000);}
uint32_t micros(){clockUs+=callCostUs;return uint32_t(clockUs);}
struct Socket {
  std::string incoming,outgoing;
  size_t at=0,readLimit=SIZE_MAX,writeLimit=SIZE_MAX;
  bool disconnected=false,readHalfClosed=false,sendBlocked=false,closed=false,nonblocking=false,listener=false;
  uint32_t sendTimeoutUs=0;
  size_t transmitCapacity=SIZE_MAX,bufferedTransmit=0;
  uint32_t heapCostPerByte=0,retainedHeap=0;
  uint32_t ackDelayMs=0,ackAtMs=0,pendingHeapCost=0;
  size_t unackedBytes=0;uint16_t unackedSegments=0;bool ackBlocked=false;
  std::deque<int> accepted;
};
static std::map<int,Socket> sockets;
static int nextFd=10;
int socket(int family,int type,int protocol){assert(family==AF_INET&&type==SOCK_STREAM&&protocol==IPPROTO_TCP);const int fd=nextFd++;sockets[fd].listener=true;lastListener=unsigned(fd);return fd;}
int setsockopt(int fd,int level,int option,const void* value,socklen_t length){
  assert(level==SOL_SOCKET);
  if(option==SO_SNDTIMEO){assert(length==sizeof(timeval));const auto& timeout=*static_cast<const timeval*>(value);sockets[fd].sendTimeoutUs=uint32_t(timeout.tv_sec*1000000+timeout.tv_usec);}
  else assert(option==SO_REUSEADDR);
  return 0;
}
int fcntl(int fd,int command,int flags){assert(command==F_SETFL&&flags==O_NONBLOCK);sockets[fd].nonblocking=true;return 0;}
int bind(int fd,const sockaddr*,socklen_t){assert(sockets[fd].listener);return 0;}
int listen(int fd,int backlog){assert(sockets[fd].listener&&backlog==3);return 0;}
int accept(int fd,sockaddr*,socklen_t*){
  assert(inService&&!inCloseWorker&&sockets[fd].nonblocking);clockUs+=ioCostUs;
  auto& pending=sockets[fd].accepted;if(pending.empty()){errno=EAGAIN;return -1;}const int accepted=pending.front();pending.pop_front();return accepted;
}
int recv(int fd,void* data,size_t size,int flags){
  assert(inService&&!inCloseWorker&&(flags==MSG_DONTWAIT||flags==(MSG_DONTWAIT|MSG_PEEK))&&sockets[fd].nonblocking);clockUs+=ioCostUs;
  auto& peer=sockets[fd];largestRead=std::max(largestRead,size);
  assert(size<=LampHttpServer::TurnReceiveBytes);
  if(peer.disconnected){if(flags&MSG_PEEK){errno=ECONNRESET;return -1;}return 0;}
  const size_t n=std::min({size,peer.incoming.size()-peer.at,peer.readLimit});
  if(!n){if(peer.readHalfClosed&&peer.at==peer.incoming.size())return 0;errno=EAGAIN;return -1;}
  memcpy(data,peer.incoming.data()+peer.at,n);if(!(flags&MSG_PEEK))peer.at+=n;turnRx+=n;return int(n);
}
int send(int fd,const void* data,size_t size,int flags){
  assert(inService&&!inCloseWorker&&flags==MSG_DONTWAIT&&sockets[fd].nonblocking);clockUs+=ioCostUs;
  auto& peer=sockets[fd];largestWrite=std::max(largestWrite,size);assert(size<=LampHttpServer::TurnSendBytes);
  if(peer.disconnected){errno=ECONNRESET;return -1;}
  if(peer.sendBlocked||peer.bufferedTransmit==peer.transmitCapacity){errno=EAGAIN;return -1;}
  const size_t n=std::min({size,peer.writeLimit,peer.transmitCapacity-peer.bufferedTransmit});
  const uint32_t cost=uint32_t(n)*peer.heapCostPerByte;assert(fakeFreeHeap>=cost);fakeFreeHeap-=cost;peer.retainedHeap+=cost;peer.bufferedTransmit+=n;
  assert(!peer.unackedBytes&&n<=LampHttpSocketCleanup::MaxTransmitFlightBytes);peer.unackedBytes=n;peer.unackedSegments=1;peer.pendingHeapCost=cost;peer.ackAtMs=millis()+peer.ackDelayMs;
  peer.outgoing.append(static_cast<const char*>(data),n);turnTx+=n;return int(n);
}
int close(int fd){assert(inCloseWorker&&!inService&&!inControl);++closeCalls;auto& peer=sockets[fd];peer.closed=true;fakeFreeHeap+=peer.retainedHeap;peer.retainedHeap=0;return 0;}
struct FakeQueue {size_t length;std::deque<int> values;};
struct TaskSuspended{};
static TaskFunction_t worker=nullptr;
static void* workerArgument=nullptr;
QueueHandle_t xQueueCreate(UBaseType_t length,UBaseType_t itemSize){assert(length==4&&itemSize==sizeof(int));return new FakeQueue{length,{}};}
BaseType_t xQueueSend(QueueHandle_t queue,const void* item,TickType_t ticks){assert(!inCloseWorker&&ticks==0);if(forceQueueFull||queue->values.size()==queue->length)return pdFALSE;queue->values.push_back(*static_cast<const int*>(item));return pdTRUE;}
BaseType_t xQueueReceive(QueueHandle_t queue,void* item,TickType_t ticks){assert(inCloseWorker&&ticks==portMAX_DELAY);if(queue->values.empty())throw TaskSuspended{};*static_cast<int*>(item)=queue->values.front();queue->values.pop_front();return pdTRUE;}
void vQueueDelete(QueueHandle_t queue){delete queue;}
BaseType_t xTaskCreate(TaskFunction_t task,const char* name,uint32_t stackBytes,void* argument,UBaseType_t priority,TaskHandle_t*){assert(!strcmp(name,"lamp-http-close")&&stackBytes==2048&&priority==1);worker=task;workerArgument=argument;++taskCreates;return pdPASS;}
static void runCloser(){assert(worker&&!inService);inCloseWorker=true;try{worker(workerArgument);}catch(const TaskSuspended&){}inCloseWorker=false;}
// The raw-server integration fixture mocks only the detached cleanup service.
// Its actual pinned shim/Owner/queue are separately exercised by the cleanup
// runtime suite. Metadata captured here proves release preserves each deadline
// and cancellation flag while the real transport remains main-loop owned.
static std::map<int,LampHttpSocketCleanup::Request> detachedRequests;
namespace LampHttpSocketCleanup {
static QueueHandle_t fixtureQueue=nullptr;
static Metrics fixtureMetrics;
static void fixtureCloser(void*){
  for(;;){int fd=-1;if(xQueueReceive(fixtureQueue,&fd,portMAX_DELAY)==pdTRUE&&fd>=0){++fixtureMetrics.closeAttempts;close(fd);--fixtureMetrics.pendingOwned;}}
}
bool start(){if(fixtureQueue)return true;fixtureQueue=xQueueCreate(4,sizeof(int));return xTaskCreate(fixtureCloser,"lamp-http-close",2048,nullptr,1,nullptr)==pdPASS;}
bool enqueue(const Request& request){
  assert(!inCloseWorker);if(request.fd<0)return true;if(!fixtureQueue)return false;
  if(xQueueSend(fixtureQueue,&request.fd,0)!=pdTRUE)return false;
  detachedRequests[request.fd]=request;++fixtureMetrics.queued;++fixtureMetrics.pendingOwned;return true;
}
uint32_t taskStackMinimumBytes(){return 1024;}
Metrics metrics(){return fixtureMetrics;}
TransmitCredit transmitCredit(int fd){
  assert(inService&&!inCloseWorker);if(creditContended)return {};
  auto& peer=sockets.at(fd);if(peer.closed||peer.disconnected||peer.listener)return {0,true};
  if(peer.unackedBytes){
    if(peer.ackBlocked||int32_t(millis()-peer.ackAtMs)<0)return {0,false,true,uint16_t(peer.unackedBytes),peer.unackedSegments};
    fakeFreeHeap+=peer.pendingHeapCost;peer.retainedHeap-=peer.pendingHeapCost;peer.pendingHeapCost=0;peer.unackedBytes=0;peer.unackedSegments=0;
  }
  return {MaxTransmitFlightBytes,false,true,0,0};
}
}
static void turn(LampHttpServer& server,uint32_t advanceMs=0){
  clockUs+=uint64_t(advanceMs)*1000;turnRx=turnTx=0;inService=true;server.handleClient();inService=false;
  assert(turnRx<=LampHttpServer::TurnReceiveBytes&&turnTx<=LampHttpServer::TurnSendBytes);
  assert(server.metrics().maxReceiveBytes<=LampHttpServer::TurnReceiveBytes&&server.metrics().maxSendBytes<=LampHttpServer::TurnSendBytes);
}
static int connect(int listener,const std::string& request){const int fd=nextFd++;sockets[fd].incoming=request;sockets[listener].accepted.push_back(fd);return fd;}
static std::string get(const std::string& route="/api/state",const std::string& auth="Basic bGFtcDpkZXZlbG9wbWVudA=="){
  return "GET "+route+" HTTP/1.1\r\nAuthorization: "+auth+"\r\n\r\n";
}
static std::string post(const std::string& route,const std::string& form,const std::string& token="development-token"){
  return "POST "+route+" HTTP/1.1\r\nAuthorization: Basic bGFtcDpkZXZlbG9wbWVudA==\r\nX-Lamp-Token: "+token+"\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: "+std::to_string(form.size())+"\r\n\r\n"+form;
}
static std::string multipartBody(const std::string& data,const std::string& closing="--\r\n"){
  return "--fixture-boundary\r\nContent-Disposition: form-data; name=\"firmware\"; filename=\"image.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n"+data+"\r\n--fixture-boundary"+closing;
}
static std::string upload(const std::string& body,const std::string& token="development-token"){
  return "POST /update HTTP/1.1\r\nAuthorization: Basic bGFtcDpkZXZlbG9wbWVudA==\r\nX-Lamp-Token: "+token+"\r\nContent-Type: multipart/form-data; boundary=fixture-boundary\r\nContent-Length: "+std::to_string(body.size())+"\r\n\r\n"+body;
}
struct Fixture {
  LampControlHttpAdapter server{80};
  unsigned listener=0,reads=0,mutations=0,uploadStarts=0,uploadWrites=0,uploadEnds=0,uploadAborts=0,uploadFinalCalls=0,restarts=0;
  bool updateOwned=false,uploadComplete=false,failWrite=false,requireParserReleased=false;
  std::vector<uint8_t> written;
  void owner(){assert((inService||inControl)&&!inCloseWorker);if(requireParserReleased)assert(!liveParsers&&!liveBodies);}
  bool auth(bool mutation=false){
    owner();
    if(!server.authenticate("lamp","development")){server.requestAuthentication();return false;}
    if(mutation&&server.header("X-Lamp-Token")!=lampToken){server.send(403,"text/plain","Token required.");return false;}
    return true;
  }
  Fixture(){
    server.on("/api/state",HTTP_GET,[this](){if(!auth())return;++reads;server.send(200,"application/json",server.controlActive()?"{\"deviceId\":\"aabbccddeeff\"}":"{\"deviceId\":\"aabbccddeeff\",\"token\":\"development-token\"}");});
    server.on("/api/power",HTTP_POST,[this](){if(!auth(true))return;const char* const fields[]={"on"};if(!server.fieldsAllowed(fields,1)||server.arg("on")!="1"){server.send(400,"text/plain","Invalid form.");return;}++mutations;server.send(200,"text/plain","Light on.");});
    server.on("/large",HTTP_GET,[this](){if(!auth())return;++reads;server.send(200,"text/plain",String(std::string(4000,'a')));});
    server.on("/full-json",HTTP_GET,[this](){if(!auth())return;++reads;server.send(200,"application/json",String(std::string("\"")+std::string(5998,'a')+"\""));});
    server.on("/max-json",HTTP_GET,[this](){if(!auth())return;++reads;server.send(200,"application/json",String(std::string("\"")+std::string(8190,'a')+"\""));});
    server.on("/giant",HTTP_GET,[this](){if(!auth())return;++reads;server.send(200,"text/plain",String(std::string(8193,'a')));});
    server.on("/page",HTTP_GET,[this](){if(!auth())return;++reads;server.send_P(200,"text/html","immutable-flash-page");});
    server.on("/bulk-page",HTTP_GET,[this](){if(!auth())return;++reads;server.send_P(200,"text/html; charset=utf-8",bulkPage);});
    server.on("/setup-page",HTTP_GET,[this](){if(!auth())return;++reads;server.send_P(200,"text/html; charset=utf-8",LAMP_PAGE);});
    server.on("/mut-json",HTTP_POST,[this](){
      if(!auth(true))return;++mutations;
      if(server.arg("kind")=="truncated"){server.send(200,"application/json","{\"persisted\":true");return;}
      const String response="{\"persisted\":true}";fakeStringReserveFailure=true;
      server.send(200,"application/json",response);fakeStringReserveFailure=false;
    });
    server.on("/form",HTTP_POST,[this](){if(!auth(true))return;const char* const fields[]={"value"};if(!server.fieldsAllowed(fields,1)||!server.hasArg("value")){server.send(400,"text/plain","Invalid form.");return;}++mutations;server.send(200,"text/plain","Saved.");});
    server.on("/api/household/control",HTTP_POST,[this](){
      if(!auth(true))return;const char* const fields[]={"blob"};
      if(!server.fieldsAllowed(fields,1,2048)){server.send(400,"text/plain","Invalid envelope.");return;}
      const String accepted=server.arg("blob");
      const auto result=server.executeControl(LampControlEndpoint::State,false,"",true);
      assert(result.status==200&&accepted.length()>1024&&result.body.find("development-token")==std::string::npos);
      server.send(200,"application/json",String(std::string("\"")+std::string(10998,'a')+"\""));
    });
    server.on("/update",HTTP_POST,[this](){++uploadFinalCalls;if(!auth(true))return;server.send(uploadComplete?200:400,"text/plain",uploadComplete?"Verified.":"Not completed.");if(uploadComplete)++restarts;},[this](){
      owner();auto& transfer=server.upload();
      if(transfer.status==UPLOAD_FILE_START){++uploadStarts;uploadComplete=false;const bool accepted=server.authenticate("lamp","development")&&server.header("X-Lamp-Token")==lampToken&&!updateOwned;server.acceptUpload(accepted);if(accepted)updateOwned=true;}
      else if(transfer.status==UPLOAD_FILE_WRITE){assert(updateOwned&&transfer.currentSize<=512);++uploadWrites;written.insert(written.end(),transfer.buf,transfer.buf+transfer.currentSize);if(failWrite){failWrite=false;updateOwned=false;server.acceptUpload(false);}}
      else if(transfer.status==UPLOAD_FILE_END){assert(updateOwned);++uploadEnds;uploadComplete=true;updateOwned=false;}
      else if(transfer.status==UPLOAD_FILE_ABORTED){assert(updateOwned);++uploadAborts;updateOwned=false;}
    });
    server.onNotFound([this](){owner();server.send(404,"text/plain","Not found.");});
    server.begin();listener=lastListener;assert(sockets[int(listener)].sendTimeoutUs==1000);
  }
  void finish(int fd,unsigned max=1000,uint32_t advanceMs=0){
    for(unsigned i=0;i<max&&!sockets[fd].closed;++i){turn(server,advanceMs);runCloser();}
    assert(sockets[fd].closed);
  }
};
static void contains(int fd,const char* needle){assert(sockets[fd].outgoing.find(needle)!=std::string::npos);}
static void completeMappedPage(int fd){
  contains(fd,"200 OK");const auto body=sockets[fd].outgoing.find("\r\n\r\n");assert(body!=std::string::npos);
  assert(sockets[fd].outgoing.substr(body+4)==LAMP_PAGE&&sockets[fd].outgoing.size()-body-4==24012);
  assert(detachedRequests.at(fd).absoluteTimeoutMs==15000&&!detachedRequests.at(fd).cancelled);
}

int main(int argc,char** argv){
  assert(argc==2);const std::string scenario=argv[1];
  memset(bulkPage,'p',sizeof(bulkPage)-1);

  if(scenario=="policy-header-ack-3.6"||scenario=="policy-header-ack-rollover"){
    Fixture f;if(scenario=="policy-header-ack-rollover")clockUs=uint64_t(UINT32_MAX-1500)*1000;
    const uint32_t began=millis();const int fd=connect(f.listener,get("/max-json"));auto& peer=sockets[fd];peer.ackDelayMs=3600;
    for(unsigned i=0;i<30&&peer.outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    contains(fd,"200 OK");contains(fd,"Content-Length: 8192");const auto body=peer.outgoing.find("\r\n\r\n")+4;
    assert(peer.outgoing.size()==body&&f.reads==1);peer.ackDelayMs=0;
    turn(f.server,3501);runCloser();
    if(LampHttpSocketCleanup::AckWaitTimeoutMs==3500){assert(peer.closed&&peer.outgoing.size()==body&&detachedRequests.at(fd).cancelled);}
    else {assert(!peer.closed&&peer.outgoing.size()==body);turn(f.server,110);f.finish(fd);assert(peer.outgoing.size()-body==8192&&uint32_t(millis()-began)<5000&&!detachedRequests.at(fd).cancelled);}
    assert(f.reads==1&&detachedRequests.at(fd).absoluteTimeoutMs==5000);
    std::cout<<"MEASURE copiedACKpolicyMs="<<LampHttpSocketCleanup::AckWaitTimeoutMs<<" header200/bodyBytes="<<peer.outgoing.size()-body<<" elapsedMs="<<uint32_t(millis()-began)<<"\n";
  }else if(scenario=="policy-header-no-progress-absolute"||scenario=="policy-header-no-progress-rollover"){
    Fixture f;if(scenario=="policy-header-no-progress-rollover")clockUs=uint64_t(UINT32_MAX-1500)*1000;
    const uint32_t began=millis();const int fd=connect(f.listener,get("/max-json"));auto& peer=sockets[fd];peer.ackDelayMs=10000;
    for(unsigned i=0;i<30&&peer.outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    const auto body=peer.outgoing.find("\r\n\r\n")+4;assert(peer.outgoing.size()==body);turn(f.server,4000);runCloser();
    if(LampHttpSocketCleanup::AckWaitTimeoutMs==3500)assert(peer.closed);
    else {assert(!peer.closed);turn(f.server,1001);runCloser();assert(peer.closed&&uint32_t(millis()-began)>=5000&&uint32_t(millis()-began)<5010);}
    assert(peer.outgoing.size()==body&&detachedRequests.at(fd).cancelled&&detachedRequests.at(fd).absoluteTimeoutMs==5000&&f.reads==1);
  }else if(scenario=="policy-header-cancel-uncertain-once"){
    Fixture f;const int fd=connect(f.listener,post("/api/power","on=1"));auto& peer=sockets[fd];peer.ackDelayMs=10000;
    for(unsigned i=0;i<30&&peer.outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    assert(f.mutations==1);peer.disconnected=true;turn(f.server,1000);runCloser();assert(peer.closed&&detachedRequests.at(fd).cancelled);
    for(unsigned i=0;i<20;++i)turn(f.server);assert(f.mutations==1);
  }else if(scenario=="partial-ack-html-progress-beyond-five"){
    Fixture f;clockUs=uint64_t(UINT32_MAX-1500)*1000;const uint32_t began=millis();const int fd=connect(f.listener,get("/setup-page"));auto& peer=sockets[fd];
    for(unsigned i=0;i<30&&peer.outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    turn(f.server);peer.ackBlocked=true;assert(peer.unackedBytes==1024);const auto copied=peer.outgoing.size();
    for(size_t pending:{896U,768U,640U,512U,384U}){peer.unackedBytes=pending;turn(f.server,1000);runCloser();assert(!peer.closed&&peer.outgoing.size()==copied);}
    turn(f.server,600);runCloser();assert(!peer.closed);peer.unackedBytes=0;peer.unackedSegments=0;peer.ackBlocked=false;
    turn(f.server,400);f.finish(fd);const auto body=peer.outgoing.find("\r\n\r\n")+4;
    assert(peer.outgoing.substr(body)==LAMP_PAGE&&uint32_t(millis()-began)>6000&&uint32_t(millis()-began)<15000&&f.reads==1&&!f.server.metrics().deadlines);
  }else if(scenario=="authentication"){
    Fixture f;
    int fd=connect(f.listener,get());f.finish(fd);contains(fd,"200 OK");contains(fd,"development-token");assert(f.reads==1&&f.server.metrics().dispatches==1);
    fd=connect(f.listener,get("/api/state","Basic incorrect"));f.finish(fd);contains(fd,"401 Unauthorized");contains(fd,"WWW-Authenticate: Basic realm=\"CoolLamp\"");assert(f.reads==1);
    fd=connect(f.listener,post("/api/power","on=1","wrong-token"));f.finish(fd);contains(fd,"403 Forbidden");assert(!f.mutations);
    fd=connect(f.listener,post("/api/power","on=1"));f.finish(fd);contains(fd,"200 OK");assert(f.mutations==1);
    fd=connect(f.listener,post("/api/power","on=1&on=0"));f.finish(fd);contains(fd,"400 Bad Request");assert(f.mutations==1);
    fd=connect(f.listener,post("/api/power","on=%00"));f.finish(fd);contains(fd,"400 Bad Request");assert(f.mutations==1);
    fd=connect(f.listener,get("/page"));f.finish(fd);contains(fd,"immutable-flash-page");
    inControl=true;const auto reply=f.server.executeControl(LampControlEndpoint::State,false,"",true);inControl=false;
    assert(reply.status==200&&reply.body.find("development-token")==std::string::npos&&f.reads==3);
  }else if(scenario=="released-request-metadata"){
    Fixture f;f.requireParserReleased=true;
    const int read=connect(f.listener,get());f.finish(read);contains(read,"200 OK");contains(read,"development-token");assert(!liveParsers&&f.reads==1);
    const int mutation=connect(f.listener,post("/api/power","on=1"));f.finish(mutation);contains(mutation,"200 OK");assert(!liveParsers&&f.mutations==1);
    const int wrong=connect(f.listener,post("/api/power","on=1","wrong"));f.finish(wrong);contains(wrong,"403 Forbidden");assert(!liveParsers&&f.mutations==1);
    const int household=connect(f.listener,post("/api/household/control","blob="+std::string(2000,'a')));f.finish(household);contains(household,"Content-Length: 11000");assert(!liveParsers&&f.reads==2);
    // A callback reads URI/header/form data after Parser destruction; both
    // direct authorization and the nested trusted-control reply remain valid.
    assert(f.server.header("Authorization").isEmpty()&&f.server.header("X-Lamp-Token").isEmpty()&&f.server.uri().isEmpty()&&!f.server.hasArg("on")&&!f.server.hasArg("blob"));
  }else if(scenario=="compact-parser-and-exact-bodies"){
    Fixture f;assert(!f.server.hasActiveClients());const int a=connect(f.listener,"GET /"),b=connect(f.listener,"GET /");
    for(unsigned i=0;i<6;++i)turn(f.server);
    assert(f.server.hasActiveClients()&&liveParsers==2&&!liveBodies&&!totalBodies&&sizeof(LampHttpParser::CompactParser)<1400);
    sockets[a].disconnected=sockets[b].disconnected=true;turn(f.server);runCloser();assert(!f.server.hasActiveClients()&&!liveParsers);
    for(size_t length : {size_t(384),size_t(385),size_t(1023),size_t(1024)}){
      const std::string form="value="+std::string(length-9,'s')+"%61";const int fd=connect(f.listener,post("/form",form));sockets[fd].readLimit=1;
      const size_t before=totalBodies;f.finish(fd,5000);contains(fd,"200 OK");assert(!liveBodies&&!liveParsers);
      if(length>=385){assert(totalBodies==before+1&&lastBodyBytes==length+1);}else assert(totalBodies==before);
    }
    const int household=connect(f.listener,post("/api/household/control","blob="+std::string(2040,'a')+"%61"));sockets[household].readLimit=1;f.finish(household,10000);
    contains(household,"200 OK");assert(lastBodyBytes==2049&&!liveBodies&&!liveParsers&&wipedBodies==totalBodies);
  }else if(scenario=="body-allocation-failure-and-cancel"){
    Fixture f;failBodyAllocation=true;const int denied=connect(f.listener,post("/form","value="+std::string(500,'s')));f.finish(denied);
    contains(denied,"503 Service Unavailable");contains(denied,"No command was executed");assert(!f.mutations&&!liveParsers&&!liveBodies);
    failBodyAllocation=false;const auto full=post("/form","value="+std::string(500,'s'));const int partial=connect(f.listener,full.substr(0,full.size()-1));
    for(unsigned i=0;i<10;++i)turn(f.server);assert(liveBodies==1&&lastBodyBytes==507&&!f.mutations);
    sockets[partial].disconnected=true;turn(f.server);runCloser();assert(!liveBodies&&!liveParsers&&!f.mutations&&wipedBodies==1);
    const int next=connect(f.listener,full);f.finish(next);contains(next,"200 OK");assert(f.mutations==1&&!liveBodies&&wipedBodies==2);
  }else if(scenario=="partial-and-cancel"){
    Fixture f;const auto full=post("/api/power","on=1");const int fd=connect(f.listener,full.substr(0,full.size()-1));
    for(unsigned i=0;i<20;++i)turn(f.server);assert(!f.mutations&&f.server.metrics().dispatches==0);
    sockets[fd].disconnected=true;turn(f.server);assert(!closeCalls&&!f.mutations);runCloser();assert(sockets[fd].closed&&f.server.metrics().cancelled==1);
    assert(detachedRequests.at(fd).cancelled&&detachedRequests.at(fd).absoluteTimeoutMs==LampHttpParser::RequestTimeoutMs);
    const int complete=connect(f.listener,full);f.finish(complete);assert(f.mutations==1);
  }else if(scenario=="idle-deadlines"){
    Fixture f;const int fd=connect(f.listener,"GET /api/state HTTP/1.1\r\nAuthorization: Basic bGFtcDpkZXZlbG9wbWVudA==\r\n");turn(f.server);
    turn(f.server,1490);assert(!sockets[fd].closed&&!f.reads);turn(f.server,20);runCloser();assert(sockets[fd].closed&&f.server.metrics().deadlines==1&&!f.reads);
    const auto full=post("/api/power","on=1");const int body=connect(f.listener,full.substr(0,full.size()-2));turn(f.server);turn(f.server,1501);runCloser();assert(sockets[body].closed&&!f.mutations&&f.server.metrics().deadlines==2);
  }else if(scenario=="absolute-and-rollover"){
    clockUs=(uint64_t(UINT32_MAX)-2000)*1000;Fixture f;const int fd=connect(f.listener,"G");turn(f.server);
    for(unsigned i=0;i<5;++i){sockets[fd].incoming+='E';turn(f.server,1000);}
    runCloser();assert(sockets[fd].closed&&!f.reads&&f.server.metrics().deadlines==1);
  }else if(scenario=="fairness-and-capacity"){
    Fixture f;const int a=connect(f.listener,"GET /"),b=connect(f.listener,"GET /"),good=connect(f.listener,get()),fourth=connect(f.listener,get());
    for(unsigned i=0;i<30&&!sockets[good].closed;++i){turn(f.server);runCloser();}
    assert(sockets[good].closed&&f.reads==1);assert(f.server.metrics().accepted==3&&sockets[f.listener].accepted.size()==1);assert(!sockets[a].closed&&!sockets[b].closed);
    f.finish(fourth);assert(f.reads==2);turn(f.server,1501);runCloser();assert(sockets[a].closed&&sockets[b].closed);
  }else if(scenario=="slow-reader-and-no-replay"){
    Fixture f;const int fd=connect(f.listener,post("/api/power","on=1"));sockets[fd].sendBlocked=true;
    for(unsigned i=0;i<30;++i)turn(f.server);assert(f.mutations==1&&f.server.metrics().blockedSends>0&&sockets[fd].outgoing.empty());
    const int healthy=connect(f.listener,get());f.finish(healthy);assert(f.reads==1&&f.mutations==1);
    turn(f.server,1501);runCloser();assert(sockets[fd].closed&&f.mutations==1&&f.server.metrics().deadlines>=1);
    for(unsigned i=0;i<30;++i)turn(f.server);assert(f.mutations==1);
  }else if(scenario=="trickled-response-hard-deadline"){
    Fixture f;const int fd=connect(f.listener,post("/api/power","on=1"));sockets[fd].writeLimit=1;
    for(unsigned i=0;i<30&&!f.mutations;++i)turn(f.server);assert(f.mutations==1);
    // Progress every second renews idle time, but never the connection's hard
    // lifetime. A reader consuming one byte at a time cannot keep a mutation
    // or response alive indefinitely.
    for(unsigned i=0;i<6&&!sockets[fd].closed;++i){turn(f.server,1000);runCloser();}
    assert(sockets[fd].closed&&f.server.metrics().deadlines==1&&f.mutations==1&&sockets[fd].outgoing.size()<10);
  }else if(scenario=="static-page-heap-guard"){
    Fixture f;const int page=connect(f.listener,get("/page"));
    for(unsigned i=0;i<12&&!f.reads;++i)turn(f.server);assert(f.reads==1);
    fakeFreeHeap=LampHttpServer::StaticPageHeapFloorBytes-1;for(unsigned i=0;i<12;++i)turn(f.server);
    assert(sockets[page].outgoing.empty()&&!sockets[page].closed&&f.server.metrics().blockedSends>0);
    // Admission requires24 KiB. Once executed, immutable small replies can
    // still drain below the bulk-send floor without calling their handler again.
    fakeFreeHeap=LampHttpServer::DispatchHeapFloorBytes;const int error=connect(f.listener,get("/missing"));
    const auto before=f.server.metrics().dispatches;for(unsigned i=0;i<12&&f.server.metrics().dispatches==before;++i)turn(f.server);
    fakeFreeHeap=LampHttpServer::StaticPageHeapFloorBytes-1;f.finish(error);contains(error,"404 Not Found");
    fakeFreeHeap=LampHttpServer::DispatchHeapFloorBytes;const int good=connect(f.listener,get());
    for(unsigned i=0;i<12&&f.reads==1;++i)turn(f.server);assert(f.reads==2);
    fakeFreeHeap=LampHttpServer::StaticPageHeapFloorBytes-1;f.finish(good);contains(good,"200 OK");assert(f.reads==2);
    fakeFreeHeap=LampHttpServer::StaticPageHeapFloorBytes;f.finish(page);contains(page,"immutable-flash-page");
  }else if(scenario=="static-page-shared-floor"){
    static_assert(LampHttpServer::StaticPageHeapFloorBytes==LampControlResourcePolicy::MinFreeHeapBytes);
    static_assert(LampHttpServer::StaticPageHeapFloorBytes==24576);
    Fixture f;const int page=connect(f.listener,get("/setup-page"));sockets[page].ackDelayMs=250;
    for(unsigned i=0;i<12&&!f.reads;++i)turn(f.server);assert(f.reads==1&&sockets[page].outgoing.empty());
    for(uint32_t heap:{20480u,24575u}){
      fakeFreeHeap=heap;for(unsigned i=0;i<10;++i)turn(f.server,10);
      assert(sockets[page].outgoing.empty()&&!sockets[page].closed);
    }
    fakeFreeHeap=24576;f.finish(page,2000,10);completeMappedPage(page);
    assert(f.reads==1&&!f.mutations&&!f.server.metrics().deadlines);
  }else if(scenario=="static-page-receiving-priority"){
    Fixture f;const int page=connect(f.listener,get("/setup-page"));sockets[page].ackDelayMs=250;
    for(unsigned i=0;i<12&&sockets[page].outgoing.empty();++i)turn(f.server);
    const auto pageBytes=sockets[page].outgoing.size();assert(pageBytes&&f.reads==1);
    const auto full=get();const int pending=connect(f.listener,full.substr(0,full.size()-2));
    for(unsigned i=0;i<5;++i)turn(f.server,100);
    assert(sockets[page].outgoing.size()==pageBytes&&!sockets[pending].closed&&f.reads==1);
    // Completing authenticated input lets that read finish first. The page
    // then continues from its original immutable bytes/lifetime.
    sockets[pending].incoming+=full.substr(full.size()-2);f.finish(pending);contains(pending,"200 OK");
    assert(f.reads==2&&!f.mutations&&detachedRequests.at(pending).absoluteTimeoutMs==5000);
    f.finish(page,2000,10);completeMappedPage(page);assert(!f.server.metrics().deadlines);
  }else if(scenario=="static-page-input-deadline-resumes"||scenario=="static-page-upload-deadline-resumes"){
    Fixture f;const int page=connect(f.listener,get("/setup-page"));sockets[page].ackDelayMs=3000;
    for(unsigned i=0;i<12&&sockets[page].outgoing.empty();++i)turn(f.server);
    const auto pageBytes=sockets[page].outgoing.size();assert(pageBytes&&f.reads==1);
    const bool multipart=scenario=="static-page-upload-deadline-resumes";
    const auto full=multipart?upload(multipartBody(std::string(1000,'f'))):get();
    const int pending=connect(f.listener,full.substr(0,full.size()-(multipart?12:2)));
    for(unsigned i=0;i<20;++i)turn(f.server);
    assert(sockets[page].outgoing.size()==pageBytes&&!sockets[pending].closed);
    if(multipart)assert(f.uploadStarts==1&&f.updateOwned&&!f.uploadEnds);
    // The abandoned input expires on its unchanged1.5s idle bound. Its
    // original5s API or180s upload lifetime remains intact in cleanup metadata.
    turn(f.server,1501);runCloser();
    assert(sockets[pending].closed&&!sockets[page].closed&&f.server.metrics().deadlines==1);
    assert(detachedRequests.at(pending).cancelled&&detachedRequests.at(pending).absoluteTimeoutMs==(multipart?180000u:5000u));
    if(multipart)assert(f.uploadAborts==1&&!f.updateOwned&&!f.uploadFinalCalls&&!f.restarts);
    assert(!f.mutations);sockets[page].ackDelayMs=0;
    f.finish(page,2000,10);completeMappedPage(page);assert(f.reads==1&&f.server.metrics().deadlines==1);
  }else if(scenario=="static-page-priority"){
    Fixture f;const int page=connect(f.listener,get("/bulk-page"));
    for(unsigned i=0;i<6;++i)turn(f.server);
    assert(!sockets[page].closed&&!sockets[page].outgoing.empty());
    const int good=connect(f.listener,get());sockets[good].sendBlocked=true;
    for(unsigned i=0;i<10;++i)turn(f.server);const auto before=sockets[page].outgoing.size();
    for(unsigned i=0;i<20;++i)turn(f.server);
    assert(sockets[page].outgoing.size()==before&&f.reads==2&&fakeFreeHeap>=LampHttpServer::StaticPageHeapFloorBytes);
    sockets[good].sendBlocked=false;f.finish(good);contains(good,"200 OK");f.finish(page);contains(page,"Content-Length: 16384");
  }else if(scenario=="static-page-pressure-deadline"){
    Fixture f;fakeFreeHeap=LampHttpServer::StaticPageHeapFloorBytes+4096;const int a=connect(f.listener,get("/bulk-page")),b=connect(f.listener,get("/bulk-page"));
    for(int fd:{a,b}){sockets[fd].heapCostPerByte=2;sockets[fd].transmitCapacity=5744;sockets[fd].ackBlocked=true;}
    for(unsigned i=0;i<30;++i)turn(f.server);
    assert(fakeFreeHeap>=LampHttpServer::StaticPageHeapFloorBytes&&!sockets[a].closed&&!sockets[b].closed&&sockets[a].unackedBytes<=1024&&sockets[b].unackedBytes<=1024);
    const auto beforeA=sockets[a].outgoing.size(),beforeB=sockets[b].outgoing.size();
    // Additional modeled SDK pressure leaves the ordinary request below its
    // admission floor. A page cannot enqueue again to consume that headroom.
    fakeFreeHeap=LampHttpServer::DispatchHeapFloorBytes-1;
    const auto withheldHeap=fakeFreeHeap,retained=sockets[a].retainedHeap+sockets[b].retainedHeap;
    const int good=connect(f.listener,get());for(unsigned i=0;i<12;++i)turn(f.server);assert(f.reads==2&&sockets[good].outgoing.empty());
    for(unsigned i=0;i<12;++i)turn(f.server);
    assert(sockets[a].outgoing.size()==beforeA&&sockets[b].outgoing.size()==beforeB);
    turn(f.server,5001);runCloser();assert(sockets[a].closed&&sockets[b].closed&&sockets[good].closed&&f.server.metrics().deadlines==3&&fakeFreeHeap==withheldHeap+retained&&f.reads==2);
    fakeFreeHeap=LampHttpServer::DispatchHeapFloorBytes;
    const int recovered=connect(f.listener,get());f.finish(recovered);contains(recovered,"200 OK");assert(f.reads==3);
  }else if(scenario=="control-memory-before-decode"){
    Fixture f;static_assert(LampControlResourcePolicy::MinFreeHeapBytes==24576);static_assert(LampControlResourcePolicy::MinLargestBlockBytes==6160);
    const auto reserves=fakeStringReserveCalls;
    for(const auto budget:{std::pair<uint32_t,uint32_t>{16384,24000},{24575,24000},{24576,6159}}){
      fakeFreeHeap=budget.first;fakeLargestFreeBlock=budget.second;
      for(const char* body:{"on=1","on=%QQ"}){
        inControl=true;const auto denied=f.server.executeControl(LampControlEndpoint::Power,true,body,true);inControl=false;
        assert(denied.status==503&&denied.body=="Control resources unavailable. This request was not executed.");
      }
      inControl=true;const auto denied=f.server.executeControl(LampControlEndpoint::State,false,"");inControl=false;
      assert(denied.status==503&&!f.reads&&!f.mutations&&fakeStringReserveCalls==reserves);
      assert(!f.server.controlActive()&&!f.server.hasArg("on")&&f.server.uri().isEmpty()&&f.server.header("Authorization").isEmpty());
      assert(f.server.executeControl(0,true,"on=1").status==404&&fakeStringReserveCalls==reserves);
    }
    fakeFreeHeap=24576;fakeLargestFreeBlock=6160;
    for(unsigned i=0;i<20;++i)turn(f.server);assert(!f.reads&&!f.mutations);
    inControl=true;const auto fresh=f.server.executeControl(LampControlEndpoint::Power,true,"on=1",true);inControl=false;
    assert(fresh.status==200&&f.mutations==1&&fakeStringReserveCalls>reserves&&!f.server.controlActive()&&!f.server.hasArg("on"));
    const int oldBudget=connect(f.listener,post("/api/power","on=1"));fakeFreeHeap=16384;
    for(unsigned i=0;i<12;++i)turn(f.server);assert(f.mutations==1&&!f.server.metrics().dispatches);
    turn(f.server,5000);runCloser();assert(sockets[oldBudget].closed&&f.mutations==1);
    fakeFreeHeap=24576;for(unsigned i=0;i<20;++i)turn(f.server);assert(f.mutations==1);
    const int current=connect(f.listener,post("/api/power","on=1"));f.finish(current);contains(current,"200 OK");assert(f.mutations==2&&f.server.metrics().dispatches==1);
  }else if(scenario=="ready-memory-before-mutation"){
    Fixture f;fakeFreeHeap=LampHttpServer::DispatchHeapFloorBytes-1;
    const int mutation=connect(f.listener,post("/api/power","on=1"));for(unsigned i=0;i<12;++i)turn(f.server);
    assert(!f.mutations&&f.server.metrics().dispatches==0&&sockets[mutation].outgoing.empty());
    fakeFreeHeap=LampHttpServer::DispatchHeapFloorBytes;fakeLargestFreeBlock=LampHttpServer::DispatchLargestBlockBytes-1;
    for(unsigned i=0;i<12;++i)turn(f.server);assert(!f.mutations&&f.server.metrics().dispatches==0);
    fakeLargestFreeBlock=LampHttpServer::DispatchLargestBlockBytes;f.finish(mutation);contains(mutation,"200 OK");assert(f.mutations==1);
    fakeFreeHeap=12000;const int expired=connect(f.listener,post("/api/power","on=1"));for(unsigned i=0;i<12;++i)turn(f.server);
    turn(f.server,1501);runCloser();assert(!sockets[expired].closed&&f.mutations==1);
    turn(f.server,3499);runCloser();assert(sockets[expired].closed&&f.mutations==1&&f.server.metrics().deadlines==1);
    fakeFreeHeap=fakeLargestFreeBlock=65536;const int fresh=connect(f.listener,get());f.finish(fresh);contains(fresh,"200 OK");assert(f.reads==1&&f.mutations==1);
  }else if(scenario=="stalled-json-memory-recovery"){
    Fixture f;const uint32_t initialHeap=LampHttpServer::DispatchHeapFloorBytes+4096;fakeFreeHeap=initialHeap;
    const int slow=connect(f.listener,get("/full-json"));sockets[slow].heapCostPerByte=3;sockets[slow].transmitCapacity=5744;sockets[slow].ackBlocked=true;
    for(unsigned i=0;i<30;++i)turn(f.server);
    assert(f.reads==1&&!sockets[slow].closed&&fakeFreeHeap>=LampHttpServer::DispatchHeapFloorBytes&&sockets[slow].unackedBytes<=1024);
    const int healthy=connect(f.listener,get());for(unsigned i=0;i<12;++i)turn(f.server);
    f.finish(healthy);contains(healthy,"503 Service Unavailable");contains(healthy,"This request was not executed");assert(f.reads==1);
    turn(f.server,5001);runCloser();assert(sockets[slow].closed&&fakeFreeHeap==initialHeap);
    // The bounded pending immutable reply is still protected independently of
    // TCP flight memory; a verified fresh read succeeds after idle cleanup.
    const int fresh=connect(f.listener,get());f.finish(fresh);contains(fresh,"200 OK");assert(!f.mutations);
  }else if(scenario=="prepared-releases-before-memory-admission"){
    Fixture f;const int slowA=connect(f.listener,"GET /"),slowB=connect(f.listener,"GET /");
    for(unsigned i=0;i<6;++i)turn(f.server);assert(liveParsers==2);
    fakeFreeHeap=LampHttpServer::DispatchHeapFloorBytes-1000;fakeLargestFreeBlock=LampHttpServer::DispatchLargestBlockBytes-1000;
    parserFreeCredit=parserLargestCredit=uint32_t(sizeof(LampHttpParser::CompactParser));
    const uint32_t before=millis();const int healthy=connect(f.listener,get());f.finish(healthy,30);
    contains(healthy,"200 OK");assert(f.reads==1&&liveParsers==2&&uint32_t(millis()-before)<100);
    assert(!sockets[slowA].closed&&!sockets[slowB].closed&&!f.server.metrics().deadlines);
    sockets[slowA].disconnected=sockets[slowB].disconnected=true;turn(f.server);runCloser();assert(!liveParsers);
  }else if(scenario=="prepared-raw-form-and-ble-isolation"){
    Fixture f;fakeFreeHeap=12000;const std::string raw="value="+std::string(500,'s');fakeStringWatchReserveBytes=raw.size();
    const int waiting=connect(f.listener,post("/form",raw));for(unsigned i=0;i<12;++i)turn(f.server);
    assert(!f.mutations&&!liveParsers&&!liveBodies&&fakeStringWatchedStorage&&!fakeStringWipedWatched);
    assert(!f.server.hasArg("value")&&f.server.header("Authorization").isEmpty()&&f.server.uri().isEmpty());
    inControl=true;const auto independent=f.server.executeControl(LampControlEndpoint::State,false,"",true);inControl=false;
    assert(independent.status==503&&!f.reads&&!f.mutations&&!f.server.hasArg("value")&&f.server.uri().isEmpty());
    fakeFreeHeap=fakeLargestFreeBlock=65536;
    inControl=true;const auto admitted=f.server.executeControl(LampControlEndpoint::State,false,"",true);inControl=false;
    assert(admitted.status==200&&admitted.body.find("development-token")==std::string::npos&&f.reads==1&&!f.mutations);
    fakeFreeHeap=fakeLargestFreeBlock=65536;f.finish(waiting);contains(waiting,"200 OK");assert(f.mutations==1&&fakeStringWipedWatched==1&&!fakeStringWatchedStorage);
    // The same exact raw staging allocation is wiped on both total expiration
    // and a reset socket, before a command or shared BLE form can execute.
    fakeFreeHeap=12000;const int expired=connect(f.listener,post("/form",raw));for(unsigned i=0;i<12;++i)turn(f.server);
    assert(!liveParsers&&fakeStringWatchedStorage);turn(f.server,5000);runCloser();assert(sockets[expired].closed&&f.mutations==1&&fakeStringWipedWatched==2);
    const int reset=connect(f.listener,post("/form",raw));for(unsigned i=0;i<12;++i)turn(f.server);
    sockets[reset].disconnected=true;turn(f.server);runCloser();assert(sockets[reset].closed&&f.mutations==1&&fakeStringWipedWatched==3&&detachedRequests.at(reset).cancelled);
    const int stopped=connect(f.listener,post("/form",raw));for(unsigned i=0;i<12;++i)turn(f.server);
    f.server.stop();runCloser();assert(sockets[stopped].closed&&f.mutations==1&&fakeStringWipedWatched==4&&!fakeStringWatchedStorage);
  }else if(scenario=="prepared-single-slot-and-half-close"){
    Fixture f;fakeFreeHeap=12000;
    const int a=connect(f.listener,post("/api/power","on=1")),b=connect(f.listener,post("/api/power","on=1")),c=connect(f.listener,post("/api/power","on=1"));
    sockets[a].readHalfClosed=true;
    for(unsigned i=0;i<18;++i)turn(f.server);assert(liveParsers==2&&!f.mutations&&!f.server.metrics().dispatches);
    inControl=true;const auto separate=f.server.executeControl(LampControlEndpoint::Power,true,"on=1",true);inControl=false;
    assert(separate.status==503&&!f.mutations&&!f.server.hasArg("on"));
    fakeFreeHeap=fakeLargestFreeBlock=65536;
    for(unsigned i=0;i<50&&(!sockets[a].closed||!sockets[b].closed||!sockets[c].closed);++i){
      const unsigned before=f.mutations;turn(f.server);assert(f.mutations-before<=1);runCloser();
    }
    for(int fd:{a,b,c}){assert(sockets[fd].closed);contains(fd,"200 OK");}
    assert(f.mutations==3&&f.server.metrics().dispatches==3&&!liveParsers);
  }else if(scenario=="prepared-form-allocation-failure"){
    Fixture f;fakeStringReserveFailure=true;const int denied=connect(f.listener,post("/api/power","on=1"));f.finish(denied);
    fakeStringReserveFailure=false;contains(denied,"503 Service Unavailable");contains(denied,"No command was executed");assert(!f.mutations&&!f.server.metrics().dispatches&&!liveParsers);
    const int healthy=connect(f.listener,post("/api/power","on=1"));f.finish(healthy);contains(healthy,"200 OK");assert(f.mutations==1);
  }else if(scenario=="prepared-survives-upload-completion"){
    Fixture f;const auto complete=upload(multipartBody(std::string(1024,char(0xe9))));const size_t split=complete.size()-100;
    const int transfer=connect(f.listener,complete.substr(0,split));for(unsigned i=0;i<30;++i)turn(f.server);
    assert(f.uploadStarts==1&&f.updateOwned&&!f.uploadEnds&&liveParsers==1);
    fakeFreeHeap=12000;const int waiting=connect(f.listener,post("/api/power","on=1"));for(unsigned i=0;i<12;++i)turn(f.server);
    assert(liveParsers==1&&!f.mutations&&!f.server.hasArg("on"));
    sockets[transfer].incoming+=complete.substr(split);f.finish(transfer);contains(transfer,"200 OK");assert(f.uploadEnds==1&&!f.updateOwned&&!f.uploadAborts&&!f.mutations&&!liveParsers);
    fakeFreeHeap=fakeLargestFreeBlock=65536;f.finish(waiting);contains(waiting,"200 OK");assert(f.mutations==1&&f.uploadEnds==1&&!f.uploadAborts);
  }else if(scenario=="prepared-waits-for-delayed-cleanup"){
    Fixture f;const int a=connect(f.listener,"GET /"),b=connect(f.listener,"GET /");
    for(unsigned i=0;i<6;++i)turn(f.server);assert(liveParsers==2);
    // Model already-owned radio/TCP resources, returned only by actual mocked
    // close-worker execution, not by a test-side dispatch/admission shortcut.
    sockets[a].retainedHeap=sockets[b].retainedHeap=6500;fakeFreeHeap=12000;
    const uint32_t accepted=millis();const int healthy=connect(f.listener,get());for(unsigned i=0;i<12;++i)turn(f.server);
    assert(!f.reads&&liveParsers==2&&sockets[healthy].outgoing.empty());
    turn(f.server,1501);assert(!sockets[healthy].closed&&!f.reads&&!liveParsers&&!sockets[a].closed&&!sockets[b].closed);
    turn(f.server,750);assert(!sockets[healthy].closed&&!f.reads&&fakeFreeHeap==12000);
    runCloser();assert(sockets[a].closed&&sockets[b].closed&&fakeFreeHeap==25000);
    f.finish(healthy);contains(healthy,"200 OK");assert(f.reads==1&&uint32_t(millis()-accepted)>1500&&uint32_t(millis()-accepted)<5000&&f.server.metrics().deadlines==2);
  }else if(scenario=="complete-input-total-deadline-and-rollover"){
    Fixture f;clockUs=uint64_t(UINT32_MAX-1000)*1000;fakeFreeHeap=12000;
    const int a=connect(f.listener,post("/api/power","on=1")),b=connect(f.listener,post("/api/power","on=1")),c=connect(f.listener,post("/api/power","on=1"));
    for(unsigned i=0;i<18;++i)turn(f.server);assert(liveParsers==2&&!f.mutations&&!f.server.metrics().dispatches);
    // Extra pipelined bytes are never consumed as another command and a peek
    // cannot renew either waiting request's original acceptance timestamp.
    sockets[a].incoming+="ignored";sockets[b].incoming+="ignored";sockets[c].incoming+="ignored";
    turn(f.server,1501);assert(!sockets[a].closed&&!sockets[b].closed&&!sockets[c].closed&&!f.mutations&&liveParsers==2);
    turn(f.server,3499);runCloser();assert(sockets[a].closed&&sockets[b].closed&&sockets[c].closed&&!f.mutations&&!f.server.metrics().dispatches&&!liveParsers&&f.server.metrics().deadlines==3);
    assert(f.server.header("Authorization").isEmpty()&&!f.server.hasArg("on"));
    fakeFreeHeap=fakeLargestFreeBlock=65536;const int fresh=connect(f.listener,get());f.finish(fresh);contains(fresh,"200 OK");
    inControl=true;const auto reconciled=f.server.executeControl(LampControlEndpoint::State,false,"",true);inControl=false;
    assert(reconciled.status==200&&f.reads==2&&!f.mutations);
    // Starting Send's idle interval after a late dispatch cannot renew the
    // absolute deadline or replay an executed command whose reply is lost.
    fakeFreeHeap=12000;const int late=connect(f.listener,post("/api/power","on=1"));sockets[late].sendBlocked=true;
    for(unsigned i=0;i<12;++i)turn(f.server);turn(f.server,4500);assert(!f.mutations&&!sockets[late].closed);
    fakeFreeHeap=fakeLargestFreeBlock=65536;for(unsigned i=0;i<6;++i)turn(f.server);assert(f.mutations==1&&!sockets[late].closed&&sockets[late].outgoing.empty());
    turn(f.server,500);runCloser();assert(sockets[late].closed&&f.mutations==1);
    for(unsigned i=0;i<30;++i)turn(f.server);assert(f.mutations==1);
  }else if(scenario=="response-budget"){
    Fixture f;const int fd=connect(f.listener,get("/large"));sockets[fd].sendBlocked=true;for(unsigned i=0;i<30;++i)turn(f.server);assert(f.reads==1);
    const int busy=connect(f.listener,post("/api/power","on=1"));f.finish(busy);contains(busy,"503 Service Unavailable");assert(!f.mutations);
    turn(f.server,1501);runCloser();assert(sockets[fd].closed);
    const int giant=connect(f.listener,get("/giant"));f.finish(giant);contains(giant,"507 Insufficient Storage");assert(f.server.metrics().responseFailures>=1);
  }else if(scenario=="mapped-page-delayed-ack"){
    Fixture f;const uint32_t began=millis();const int page=connect(f.listener,get("/setup-page"));sockets[page].ackDelayMs=250;
    f.finish(page,2000,10);contains(page,"200 OK");const auto body=sockets[page].outgoing.find("\r\n\r\n");assert(body!=std::string::npos);
    std::cout<<"MEASURE actual mappedHTMLbytes="<<sizeof(LAMP_PAGE)-1<<" received="<<sockets[page].outgoing.size()-body-4<<" elapsedMs="<<uint32_t(millis()-began)<<std::endl;
    assert(sockets[page].outgoing.substr(body+4)==LAMP_PAGE&&!f.server.metrics().deadlines&&f.reads==1);
    assert(detachedRequests.at(page).absoluteTimeoutMs==LampHttpServer::MappedHtmlTimeoutMs&&!detachedRequests.at(page).cancelled&&detachedRequests.at(page).acceptedAt>=began);
  }else if(scenario=="single-data-ack-loss-recovers-at-three-seconds"){
    Fixture f;const uint32_t began=millis();const int state=connect(f.listener,get("/full-json"));
    // Allow the initial HTTP header ACK, then delay exactly one data ACK to
    // the pinned SDK's initial3s retransmission boundary. Later ACKs are normal.
    for(unsigned i=0;i<30&&sockets[state].outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    assert(sockets[state].outgoing.find("\r\n\r\n")!=std::string::npos&&f.reads==1);
    sockets[state].ackDelayMs=3000;turn(f.server);assert(sockets[state].unackedBytes==1024);sockets[state].ackDelayMs=0;
    turn(f.server,1501);runCloser();assert(!sockets[state].closed);
    f.finish(state,1000,10);contains(state,"200 OK");const auto body=sockets[state].outgoing.find("\r\n\r\n");assert(sockets[state].outgoing.size()-body-4==6000);
    assert(uint32_t(millis()-began)>=3000&&uint32_t(millis()-began)<5000&&!f.server.metrics().deadlines&&f.reads==1);
  }else if(scenario=="partial-ack-progress-before-drain-and-rollover"){
    Fixture f;clockUs=uint64_t(UINT32_MAX-1500)*1000;const uint32_t began=millis();const int state=connect(f.listener,get("/full-json"));
    for(unsigned i=0;i<30&&sockets[state].outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    auto& peer=sockets[state];turn(f.server);peer.ackBlocked=true;assert(peer.unackedBytes==1024);const size_t copied=peer.outgoing.size();
    for(size_t pending:{768U,512U,256U}){peer.unackedBytes=pending;turn(f.server,1000);runCloser();assert(!peer.closed&&peer.outgoing.size()==copied);}
    // Service while the old complete-drain-only timer would already have
    // expired; jumping directly to the final ACK could hide that defect.
    turn(f.server,600);runCloser();assert(!peer.closed&&peer.outgoing.size()==copied);
    peer.unackedBytes=0;peer.unackedSegments=0;peer.ackBlocked=false;turn(f.server,400);f.finish(state);
    const auto body=peer.outgoing.find("\r\n\r\n");assert(peer.outgoing.size()-body-4==6000&&f.reads==1&&!f.server.metrics().deadlines);
    assert(uint32_t(millis()-began)>=4000&&uint32_t(millis()-began)<5000&&!detachedRequests.at(state).cancelled);
  }else if(scenario=="partial-ack-equal-contention-and-fd-reuse"){
    Fixture f;const int state=connect(f.listener,get("/full-json"));
    for(unsigned i=0;i<30&&sockets[state].outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    auto& peer=sockets[state];turn(f.server);peer.ackBlocked=true;assert(peer.unackedBytes==1024);
    for(unsigned i=0;i<6;++i){turn(f.server,500);runCloser();assert(!peer.closed);}
    turn(f.server,2001);runCloser();assert(peer.closed&&detachedRequests.at(state).cancelled&&f.reads==1);
    // Reusing both a slot and fd must start a fresh observed-flight baseline.
    sockets[state]=Socket{};sockets[state].incoming=get("/full-json");sockets[int(f.listener)].accepted.push_back(state);
    for(unsigned i=0;i<30&&peer.outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    turn(f.server);peer.ackBlocked=true;assert(peer.unackedBytes==1024&&f.reads==2);
    peer.unackedBytes=768;turn(f.server,1000);assert(!peer.closed);
    // The PCB may have changed while the core lock cannot be observed. An
    // unavailable snapshot grants neither a new write nor synthetic progress.
    creditContended=true;peer.unackedBytes=0;peer.unackedSegments=0;turn(f.server,3000);runCloser();assert(!peer.closed);
    turn(f.server,1001);runCloser();assert(peer.closed&&detachedRequests.at(state).cancelled&&f.reads==2);
    creditContended=false;for(unsigned i=0;i<30;++i)turn(f.server);assert(f.reads==2);
  }else if(scenario=="partial-ack-segments-total-and-cancel"){
    Fixture f;const int state=connect(f.listener,get("/full-json"));
    for(unsigned i=0;i<30&&sockets[state].outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    auto& peer=sockets[state];turn(f.server);peer.ackBlocked=true;peer.unackedSegments=4;turn(f.server);
    for(uint16_t segments:{3U,2U,1U}){peer.unackedSegments=segments;turn(f.server,1000);runCloser();assert(!peer.closed);}
    turn(f.server,600);runCloser();assert(!peer.closed);
    peer.unackedBytes=0;peer.unackedSegments=0;peer.ackBlocked=false;turn(f.server,400);f.finish(state);assert(f.reads==1&&!f.server.metrics().deadlines);
    const uint32_t accepted=millis();const int total=connect(f.listener,get("/full-json"));
    for(unsigned i=0;i<30&&sockets[total].outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    turn(f.server);sockets[total].ackBlocked=true;assert(sockets[total].unackedBytes==1024);
    for(unsigned i=0;i<4;++i){--sockets[total].unackedBytes;turn(f.server,1000);runCloser();assert(!sockets[total].closed);}
    --sockets[total].unackedBytes;turn(f.server,1000);runCloser();assert(sockets[total].closed&&uint32_t(millis()-accepted)>=5000&&detachedRequests.at(total).cancelled&&f.reads==2);
    const int cancelled=connect(f.listener,get("/full-json"));
    for(unsigned i=0;i<30&&sockets[cancelled].outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    turn(f.server);sockets[cancelled].ackBlocked=true;sockets[cancelled].unackedBytes=768;turn(f.server,1000);assert(!sockets[cancelled].closed);
    sockets[cancelled].disconnected=true;turn(f.server);runCloser();assert(sockets[cancelled].closed&&detachedRequests.at(cancelled).cancelled&&f.reads==3);
  }else if(scenario=="final-flight-baseline-close-backpressure"){
    Fixture f;const int state=connect(f.listener,get("/full-json"));forceQueueFull=true;
    for(unsigned i=0;i<100;++i)turn(f.server);
    const uint16_t finalFlight=uint16_t(sockets[state].unackedBytes);assert(finalFlight&&finalFlight<=1024&&!sockets[state].closed&&f.reads==1);
    // Clearing response/ACK state and repeated stop retries must not erase the
    // original successful response's known last flight or make it a cancel.
    f.server.stop();f.server.stop();forceQueueFull=false;f.server.serviceCleanup();runCloser();
    assert(sockets[state].closed&&detachedRequests.at(state).knownPendingBytes==finalFlight&&!detachedRequests.at(state).cancelled&&detachedRequests.at(state).absoluteTimeoutMs==5000);
    assert(detachedRequests.at(int(f.listener)).knownPendingBytes==0);
    f.server.begin();sockets[state]=Socket{};sockets[state].incoming=get();sockets[int(lastListener)].accepted.push_back(state);f.finish(state);
    assert(f.reads==2&&detachedRequests.at(state).knownPendingBytes==sockets[state].unackedBytes&&detachedRequests.at(state).knownPendingBytes!=finalFlight);
    const int cancelled=connect(int(lastListener),get("/full-json"));
    for(unsigned i=0;i<30&&sockets[cancelled].outgoing.find("\r\n\r\n")==std::string::npos;++i)turn(f.server);
    turn(f.server);sockets[cancelled].ackBlocked=true;sockets[cancelled].disconnected=true;turn(f.server);runCloser();
    assert(detachedRequests.at(cancelled).cancelled&&detachedRequests.at(cancelled).knownPendingBytes==1024&&f.reads==3);
  }else if(scenario=="mapped-page-deadline-rollover-and-cleanup"){
    Fixture f;clockUs=uint64_t(UINT32_MAX-600)*1000;const uint32_t began=millis();const int page=connect(f.listener,get("/setup-page"));sockets[page].writeLimit=1;sockets[page].ackDelayMs=1000;
    for(unsigned i=0;i<12;++i)turn(f.server);assert(f.reads==1&&!sockets[page].outgoing.empty());
    for(unsigned i=0;i<14;++i){turn(f.server,1000);assert(!sockets[page].closed&&!f.server.metrics().deadlines);}
    forceQueueFull=true;turn(f.server,1000);assert(!sockets[page].closed&&f.server.metrics().deadlines==1);
    // Repeated stop/cleanup backpressure must retain the captured HTML lifetime
    // after static-page/parser storage has already been cleared.
    f.server.stop();f.server.stop();forceQueueFull=false;f.server.serviceCleanup();runCloser();assert(sockets[page].closed);
    assert(detachedRequests.at(page).absoluteTimeoutMs==15000&&detachedRequests.at(page).cancelled&&detachedRequests.at(page).acceptedAt==began);
    // Reusing both the old slot and descriptor must regain the ordinary API
    // fence, never the detached page's longer timeout or cached authorization.
    f.server.begin();sockets[page]=Socket{};sockets[page].incoming=get();sockets[int(lastListener)].accepted.push_back(page);f.finish(page);contains(page,"200 OK");
    assert(f.reads==2&&detachedRequests.at(page).absoluteTimeoutMs==5000&&!detachedRequests.at(page).cancelled);
  }else if(scenario=="ack-drain-restores-unsent-idle"){
    Fixture f;const int page=connect(f.listener,get("/setup-page"));sockets[page].ackDelayMs=3000;
    for(unsigned i=0;i<12;++i)turn(f.server);assert(sockets[page].unackedBytes&&!sockets[page].closed);
    fakeFreeHeap=LampHttpServer::StaticPageHeapFloorBytes-1;turn(f.server,3000);assert(!sockets[page].unackedBytes&&!sockets[page].closed);
    // Once ACK drain was observed, the static memory floor cannot keep an
    // unsent page alive using the longer ACK-only allowance.
    turn(f.server,1499);runCloser();assert(!sockets[page].closed);turn(f.server,2);runCloser();assert(sockets[page].closed);
    assert(detachedRequests.at(page).absoluteTimeoutMs==15000&&detachedRequests.at(page).cancelled&&f.server.metrics().deadlines==1);
  }else if(scenario=="mapped-page-idle-cancel-and-request-bound"){
    Fixture f;const int page=connect(f.listener,get("/setup-page"));sockets[page].ackBlocked=true;
    for(unsigned i=0;i<12;++i)turn(f.server);const auto before=sockets[page].outgoing.size();assert(before);
    const int healthy=connect(f.listener,get());f.finish(healthy);contains(healthy,"200 OK");assert(f.reads==2&&sockets[page].outgoing.size()==before);
    turn(f.server,5001);runCloser();assert(sockets[page].closed&&detachedRequests.at(page).cancelled&&detachedRequests.at(page).absoluteTimeoutMs==15000);
    const int reset=connect(f.listener,get("/setup-page"));sockets[reset].ackBlocked=true;for(unsigned i=0;i<12;++i)turn(f.server);
    sockets[reset].disconnected=true;turn(f.server);runCloser();assert(sockets[reset].closed&&detachedRequests.at(reset).cancelled&&detachedRequests.at(reset).absoluteTimeoutMs==15000);
    fakeFreeHeap=12000;const unsigned reads=f.reads;const int waiting=connect(f.listener,get("/setup-page"));for(unsigned i=0;i<12;++i)turn(f.server);
    turn(f.server,5000);runCloser();assert(sockets[waiting].closed&&f.reads==reads&&detachedRequests.at(waiting).absoluteTimeoutMs==5000);
  }else if(scenario=="transmit-credit-delayed-ack-and-deadline"){
    Fixture f;fakeFreeHeap=12000;const uint32_t accepted=millis();const int full=connect(f.listener,get("/max-json"));sockets[full].ackDelayMs=250;
    for(unsigned i=0;i<12;++i)turn(f.server);turn(f.server,2250);assert(!f.reads&&!sockets[full].closed);
    fakeFreeHeap=fakeLargestFreeBlock=65536;f.finish(full,1000,10);contains(full,"200 OK");contains(full,"Content-Length: 8192");
    assert(f.reads==1&&uint32_t(millis()-accepted)>4000&&uint32_t(millis()-accepted)<5000&&!f.server.metrics().deadlines);
    const int mutation=connect(f.listener,post("/api/power","on=1"));creditContended=true;
    for(unsigned i=0;i<20;++i)turn(f.server);assert(f.mutations==1&&sockets[mutation].outgoing.empty());
    turn(f.server,1501);runCloser();assert(sockets[mutation].closed&&f.mutations==1);creditContended=false;
    for(unsigned i=0;i<30;++i)turn(f.server);assert(f.mutations==1);
  }else if(scenario=="household-compatibility"){
    Fixture f;const int signedRequest=connect(f.listener,post("/api/household/control","blob="+std::string(2000,'a')));f.finish(signedRequest);
    contains(signedRequest,"200 OK");contains(signedRequest,"Content-Length: 11000");assert(f.reads==1&&f.server.metrics().dispatches==1);
    const int normal=connect(f.listener,post("/api/power","on=1&padding="+std::string(1500,'a')));f.finish(normal);contains(normal,"413 Payload Too Large");assert(!f.mutations);
  }else if(scenario=="invalid-json-and-allocation-after-mutation"){
    Fixture f;const int invalid=connect(f.listener,post("/mut-json","kind=truncated"));f.finish(invalid);
    contains(invalid,"507 Insufficient Storage");contains(invalid,"reconcile");assert(f.mutations==1&&f.server.metrics().responseFailures>=1);
    const int allocation=connect(f.listener,post("/mut-json","kind=allocation"));f.finish(allocation);
    contains(allocation,"507 Insufficient Storage");contains(allocation,"reconcile");assert(f.mutations==2);
    for(unsigned i=0;i<30;++i)turn(f.server);assert(f.mutations==2);
  }else if(scenario=="bounded-work"){
    Fixture f;ioCostUs=100;callCostUs=10;
    const int a=connect(f.listener,post("/api/power","on=1&padding="+std::string(900,'a'))),b=connect(f.listener,get("/large")),c=connect(f.listener,get("/large"));
    for(unsigned i=0;i<100;++i){turn(f.server);runCloser();}
    assert(sockets[a].closed&&sockets[b].closed&&sockets[c].closed);
    assert(largestRead<=512&&largestWrite<=1024&&f.server.metrics().maxServiceUs<=LampHttpServer::TurnBudgetUs+200);
  }else if(scenario=="close-queue-full"){
    Fixture f;forceQueueFull=true;const int a=connect(f.listener,"G"),b=connect(f.listener,"G"),c=connect(f.listener,"G"),pending=connect(f.listener,get());
    for(unsigned i=0;i<6;++i)turn(f.server);sockets[a].disconnected=sockets[b].disconnected=sockets[c].disconnected=true;
    for(unsigned i=0;i<6;++i)turn(f.server);assert(!closeCalls&&f.server.metrics().closeQueueFull>=3&&f.server.metrics().accepted==3&&sockets[f.listener].accepted.size()==1);
    forceQueueFull=false;turn(f.server);runCloser();assert(sockets[a].closed&&sockets[b].closed&&sockets[c].closed);f.finish(pending);assert(f.reads==1);
  }else if(scenario=="stopped-close-queue-full"){
    Fixture f;const int a=connect(f.listener,"G"),b=connect(f.listener,"G"),c=connect(f.listener,"G");
    for(unsigned i=0;i<6;++i)turn(f.server);forceQueueFull=true;f.server.stop();assert(!closeCalls&&!f.reads);
    // Wi-Fi is now unavailable, so handleClient() is deliberately not called.
    // The cleanup service must release retained descriptors without reopening
    // the listener, parsing a request, or invoking a handler.
    const unsigned listener=f.listener;forceQueueFull=false;f.server.serviceCleanup();runCloser();
    assert(sockets[a].closed&&sockets[b].closed&&sockets[c].closed&&sockets[int(listener)].closed);
    assert(closeCalls==4&&f.server.metrics().accepted==3&&!f.server.metrics().dispatches);
  }else if(scenario=="upload-complete"){
    Fixture f;const std::string image(40960,char(0xe9));const int fd=connect(f.listener,upload(multipartBody(image)));f.finish(fd,1000,50);
    contains(fd,"200 OK");assert(f.uploadStarts==1&&f.uploadEnds==1&&!f.uploadAborts&&!f.updateOwned&&f.written.size()==image.size());assert(!memcmp(f.written.data(),image.data(),image.size()));assert(millis()>5000);assert(f.server.metrics().maxReceiveBytes<=512);
    assert(!detachedRequests.at(fd).cancelled&&detachedRequests.at(fd).absoluteTimeoutMs==LampHttpParser::UploadTimeoutMs&&uint32_t(millis()-detachedRequests.at(fd).acceptedAt)>5000);
  }else if(scenario=="upload-abort-owner"){
    Fixture f;const auto complete=upload(multipartBody(std::string(1024,char(0xe9))));const int first=connect(f.listener,complete.substr(0,complete.size()-100));
    for(unsigned i=0;i<30;++i)turn(f.server);assert(f.uploadStarts==1&&f.updateOwned&&!f.uploadEnds);
    const int second=connect(f.listener,complete);f.finish(second);contains(second,"409 Conflict");assert(f.uploadStarts==1&&!f.uploadAborts&&f.updateOwned);
    turn(f.server,1501);runCloser();assert(sockets[first].closed&&f.uploadAborts==1&&!f.updateOwned&&!f.uploadEnds);
    const int unauthorized=connect(f.listener,upload(multipartBody("bad"),"wrong-token"));f.finish(unauthorized);contains(unauthorized,"403 Forbidden");assert(f.uploadStarts==2&&f.uploadAborts==1&&!f.updateOwned&&!f.uploadEnds);
  }else if(scenario=="upload-malformed-and-loss"){
    Fixture f;const int malformed=connect(f.listener,upload(multipartBody("data","--X\n")));f.finish(malformed);assert(f.uploadStarts==1&&f.uploadAborts==1&&!f.uploadEnds&&!f.updateOwned);
    const int valid=connect(f.listener,upload(multipartBody("firmware")));sockets[valid].sendBlocked=true;for(unsigned i=0;i<100;++i)turn(f.server);assert(f.uploadEnds==1&&!f.updateOwned);
    turn(f.server,1501);runCloser();assert(sockets[valid].closed&&f.uploadEnds==1);for(unsigned i=0;i<30;++i)turn(f.server);assert(f.uploadEnds==1); // lost final reply never selects the image twice.
  }else if(scenario=="failed-old-upload-new-owner"){
    Fixture f;f.failWrite=true;const int old=connect(f.listener,upload(multipartBody(std::string(1024,char(0xe9)))));sockets[old].sendBlocked=true;
    for(unsigned i=0;i<50;++i)turn(f.server);assert(f.uploadStarts==1&&f.uploadWrites==1&&!f.updateOwned&&!f.uploadEnds&&!f.uploadAborts);
    // Another updater acquires ownership after the service upload explicitly
    // released it. Disconnecting the old transport must not abort that owner.
    f.updateOwned=true;sockets[old].disconnected=true;turn(f.server);runCloser();assert(sockets[old].closed&&f.updateOwned&&!f.uploadAborts&&!f.uploadEnds);
  }else if(scenario=="upload-final-status-under-response-pressure"){
    Fixture f;const int blocked=connect(f.listener,get("/large"));sockets[blocked].sendBlocked=true;
    for(unsigned i=0;i<20;++i)turn(f.server);assert(f.reads==1&&!sockets[blocked].closed);
    const int good=connect(f.listener,upload(multipartBody(std::string(1024,char(0xe9)))));f.finish(good);
    contains(good,"200 OK");contains(good,"Verified.");assert(f.uploadEnds==1&&f.uploadFinalCalls==1&&f.restarts==1&&!f.updateOwned&&!f.uploadAborts);
    // Ordinary commands still get the truthful pre-execution busy result.
    const int mutation=connect(f.listener,post("/api/power","on=1"));f.finish(mutation);contains(mutation,"This request was not executed");assert(!f.mutations);
    const int denied=connect(f.listener,upload(multipartBody("bad"),"wrong-token"));f.finish(denied);
    contains(denied,"403 Forbidden");assert(f.uploadFinalCalls==2&&f.uploadEnds==1&&f.restarts==1&&!f.updateOwned&&!f.uploadAborts);
    f.failWrite=true;const int failed=connect(f.listener,upload(multipartBody(std::string(1024,char(0xe9)))));f.finish(failed);
    contains(failed,"400 Bad Request");contains(failed,"Not completed.");assert(f.uploadFinalCalls==3&&f.uploadEnds==1&&f.restarts==1&&!f.updateOwned&&!f.uploadAborts);
    const int lost=connect(f.listener,upload(multipartBody(std::string(1024,char(0xe9)))));sockets[lost].sendBlocked=true;
    for(unsigned i=0;i<80;++i)turn(f.server);assert(f.uploadEnds==2&&f.uploadFinalCalls==4&&f.restarts==2&&!f.updateOwned&&!f.uploadAborts);
    turn(f.server,1501);runCloser();assert(sockets[blocked].closed&&sockets[lost].closed);
    for(unsigned i=0;i<30;++i)turn(f.server);assert(f.uploadEnds==2&&f.uploadFinalCalls==4&&f.restarts==2&&!f.mutations&&!f.uploadAborts);
  }else if(scenario=="fleet-twenty"){
    std::vector<std::unique_ptr<Fixture>> fleet;std::vector<int> healthy,slow;
    for(unsigned i=0;i<20;++i){fleet.emplace_back(new Fixture);slow.push_back(connect(fleet.back()->listener,"GET /api/state HTTP/1.1\r\nX:"));healthy.push_back(connect(fleet.back()->listener,get()));}
    for(unsigned t=0;t<50;++t){for(auto& lamp:fleet)turn(lamp->server);runCloser();}
    for(unsigned i=0;i<20;++i){assert(fleet[i]->reads==1&&sockets[healthy[i]].closed&&!sockets[slow[i]].closed);}
    clockUs+=1501000;for(auto& lamp:fleet){turn(lamp->server);runCloser();}
    for(unsigned i=0;i<20;++i)assert(sockets[slow[i]].closed&&fleet[i]->server.metrics().deadlines==1);
  }else assert(false);
  assert(taskCreates==1&&liveParsers==0&&liveBodies==0);
  std::cout<<"PASS production HTTP server "<<scenario<<": bounded nonblocking transport, main-loop handlers, off-loop cleanup; maxRequestedRecv="<<largestRead<<" maxRequestedSend="<<largestWrite<<'\n';
}
