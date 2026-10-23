#pragma once
#include <Arduino.h>
#include <WebServer.h>  // Pinned core HTTP method/upload types only, no server/parser.
#include <functional>
#include <utility>
#include "LampHttpParser.h"
#include "LampHttpMultipart.h"
#include "LampHttpSocketCleanup.h"
#include "LampControlResourcePolicy.h"

// Incremental HTTP transport. Every route/upload callback runs ONLY on loop().
// Parsing and transmitting never use Stream or NetworkClient blocking methods.
// Fully formed requests are queued in slots before one loop-owned dispatch.
class LampHttpServer {
public:
  using THandlerFunction=std::function<void()>;
  static constexpr unsigned MaxClients=3, MaxRoutes=72;
  static constexpr size_t MaxResponseBytes=8192, HouseholdResponseBytes=12288, TotalResponseBytes=12288;
  static constexpr size_t MaxMappedPageBytes=65536;
  static constexpr size_t TurnReceiveBytes=512, TurnSendBytes=1024;
  static constexpr uint32_t TurnBudgetUs=2000;
  // The legacy mapped setup page is 24 KiB. Stop-and-wait sends can need more
  // than five seconds with healthy delayed ACKs; API/request limits stay fixed.
  static constexpr uint32_t MappedHtmlTimeoutMs=15000;
  // A large immutable read can need about3s of delayed ACKs plus the pinned
  // SDK's initial3s retransmission. Parsing/dispatch and mutations stay5s.
  static constexpr uint32_t LargeReadResponseTimeoutMs=8000;
  // Mapped pages have no page-sized heap buffer. A separate measured-work
  // allowance protects SDK/workspace plus one bounded TCP flight; accepted
  // input and ordinary responses retain priority. Other admission is unchanged.
  static constexpr uint32_t StaticPageHeapFloorBytes=LampControlResourcePolicy::MappedPageSendHeapBytes;
  static constexpr uint32_t DispatchHeapFloorBytes=LampControlResourcePolicy::MinFreeHeapBytes,DispatchLargestBlockBytes=LampControlResourcePolicy::MinLargestBlockBytes;
  // Internal upload callback storage follows the actual streaming chunk bound.
  // Wire framing and UPLOAD_FILE_* semantics remain the legacy service API.
  struct Upload {
    HTTPUploadStatus status=UPLOAD_FILE_START;
    String filename,name,type;
    size_t totalSize=0,currentSize=0;
    uint8_t buf[LampHttpMultipart::ChunkBytes]{};
  };
  struct Metrics {
    uint32_t accepted=0, rejected=0, deadlines=0, cancelled=0, blockedSends=0;
    uint32_t responses=0, responseFailures=0, dispatches=0, maxServiceUs=0;
    uint32_t maxDispatchUs=0, maxReceiveBytes=0, maxSendBytes=0, closeQueueFull=0;
    uint32_t maxConnectionMs=0,maxIdleMs=0;
  };
private:
  struct Route {const char* path=nullptr;HTTPMethod method=HTTP_ANY;THandlerFunction handler,upload;};
  enum class ClientState:uint8_t {Free, Receive, Ready, Prepared, Upload, Send, Closing};
  struct Slot {
    int fd=-1;ClientState state=ClientState::Free;LampHttpParser::CompactParser* parser=nullptr;
    uint8_t* formBody=nullptr;size_t formCapacity=0;
    LampHttpMultipart::Parser* multipart=nullptr;LampHttpParser::Deadline deadline;
    String body;const char* staticBody=nullptr;size_t bodyLength=0, sent=0, headerSent=0;
    char responseHeader[512]{};size_t headerLength=0;uint32_t received=0;
    uint8_t input[128]{};size_t inputAt=0,inputSize=0;
    int route=-1;bool uploadStarted=false, uploadAccepted=false,staticPage=false,readResponse=false;
    bool closeAbandoned=false,awaitingAck=false,localSendDeferred=false;uint32_t closeTimeoutMs=LampHttpParser::RequestTimeoutMs;
    uint16_t ackPendingBytes=0,ackPendingSegments=0;bool ackObserved=false;
    uint16_t closeKnownPendingBytes=0;
  };
  Slot clients_[MaxClients];Route routes_[MaxRoutes];unsigned routeCount_=0, cursor_=0;
  uint16_t port_;int listener_=-1, current_=-1, uploadOwner_=-1;bool listenerClosing_=false;
  THandlerFunction notFound_;Metrics metrics_{};Upload upload_{};
  String responseHeaders_;bool responseSet_=false;
  // One completed ordinary request may wait for reply RAM after its parser is
  // freed. Raw form data stays private here, never in the adapter's shared BLE
  // fields; it is decoded only immediately before the loop-owned callback.
  LampHttpParser::Request dispatchRequest_{};String dispatchForm_;int dispatchContext_=-1;
  const LampHttpParser::Request* currentRequest()const{
    if(current_<0)return nullptr;
    if(clients_[current_].parser)return &clients_[current_].parser->request();
    return dispatchContext_==current_?&dispatchRequest_:nullptr;
  }
  void clearDispatchRequest(){erase(dispatchForm_);LampHttpParser::wipe(&dispatchRequest_,sizeof(dispatchRequest_));dispatchContext_=-1;}
  static void erase(String& text){volatile char* b=const_cast<char*>(text.c_str());for(size_t n=0;n<text.length();++n)b[n]=0;text=static_cast<const char*>(nullptr);}
  static void increment(uint32_t& n){if(n!=UINT32_MAX)++n;}
  static void maximum(uint32_t& n,uint32_t value){if(value>n)n=value;}
  static uint32_t absoluteTimeout(const Slot& slot){return slot.multipart?LampHttpParser::UploadTimeoutMs:
    slot.state==ClientState::Send&&slot.staticPage?MappedHtmlTimeoutMs:
    slot.state==ClientState::Send&&slot.readResponse?LargeReadResponseTimeoutMs:LampHttpParser::RequestTimeoutMs;}
  bool beginTransport();void stopTransport();void serviceTransport();
  void clearParser(Slot& slot);
  LampHttpSocketCleanup::TransmitCredit sampleTransmitCredit(unsigned slot);
  void release(unsigned slot,bool cancelled=false);void closeSlot(unsigned slot);
  bool buildForm(const Slot& slot,String& form);bool prepareDispatch(unsigned slot);
  void dispatch(unsigned slot);void uploadEvent(unsigned slot,LampHttpMultipart::Event event);
  bool prepareResponse(int code,const char* type,size_t length);
  void queueError(unsigned slot,int code,const char* text);
  void retain(int code,const char* type,String&& body);
  size_t queuedBodyBytes()const{size_t n=0;for(const auto& c:clients_)n+=c.body.length();return n;}
  bool priorityResponsePending(unsigned index)const{
    for(unsigned i=0;i<MaxClients;++i)if(i!=index&&
      (clients_[i].state==ClientState::Receive||clients_[i].state==ClientState::Upload||
       clients_[i].state==ClientState::Ready||clients_[i].state==ClientState::Prepared||(clients_[i].state==ClientState::Send&&!clients_[i].staticPage)))return true;
    return false;
  }
protected:
  virtual bool prepareHttpForm(const String& body){(void)body;return true;}
  virtual void clearHttpForm(){}
public:
  explicit LampHttpServer(uint16_t port):port_(port){}
  virtual ~LampHttpServer()=default;
  void begin(){beginTransport();}void stop(){stopTransport();}void handleClient(){serviceTransport();}
  void serviceCleanup();
  bool hasActiveClients()const{for(const auto& c:clients_)if(c.state!=ClientState::Free)return true;return false;}
  void on(const char* path,HTTPMethod method,THandlerFunction handler,THandlerFunction upload=THandlerFunction()){
    if(routeCount_==MaxRoutes)return;auto& r=routes_[routeCount_++];r.path=path;r.method=method;r.handler=std::move(handler);r.upload=std::move(upload);
  }
  void onNotFound(THandlerFunction handler){notFound_=std::move(handler);}
  void collectHeaders(const char*[],size_t){}  // Auth/token collected by the bounded parser.
  virtual String arg(const String&)const{return String();}
  virtual bool hasArg(const String&)const{return false;}
  virtual size_t args()const{return 0;}
  virtual String argName(size_t)const{return String();}
  String uri()const{const auto* request=currentRequest();return request?String(request->path):String();}
  String header(const String& name)const{
    const auto* current=currentRequest();if(!current)return String();const auto& request=*current;
    if(name=="X-Lamp-Token")return String(request.token);if(name=="Authorization")return String(request.authorization);return String();
  }
  bool authenticate(const char* name,const char* password);
  void requestAuthentication(){sendHeader("WWW-Authenticate","Basic realm=\"CoolLamp\"");send(401,"text/plain","Authentication required.");}
  void sendHeader(const String& name,const String& value,bool=false){
    if(current_<0||name.indexOf('\r')>=0||name.indexOf('\n')>=0||value.indexOf('\r')>=0||value.indexOf('\n')>=0)return;
    if(responseHeaders_.length()+name.length()+value.length()+4>256)return;
    responseHeaders_+=name;responseHeaders_+=": ";responseHeaders_+=value;responseHeaders_+="\r\n";
  }
  void send(int code,const char* type,const String& body){String copy;if(body.length()&&(!copy.reserve(body.length())||!copy.concat(body.c_str(),body.length()))){increment(metrics_.responseFailures);queueError(unsigned(current_),507,"Response unavailable; reconcile any submitted mutation.");return;}retain(code,type,std::move(copy));}
  void send(int code,const char* type,String&& body){retain(code,type,std::move(body));}
  void send(int code,const char* type,const char* body){send(code,type,String(body));}
  void send_P(int code,const char* type,const char* body);
  void send_P(int code,const char* type,const char* body,size_t bytes);
  Upload& upload(){return upload_;}
  void acceptUpload(bool accepted){if(current_>=0)clients_[current_].uploadAccepted=accepted;}
  const Metrics& metrics()const{return metrics_;}
  uint32_t closeTaskStackMinimumBytes()const;
  LampHttpSocketCleanup::Metrics closeMetrics()const{return LampHttpSocketCleanup::metrics();}
};
