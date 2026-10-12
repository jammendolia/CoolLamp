#include "LampHttpServer.h"
#include "LampHttpJson.h"
#include "LampHttpSocketCleanup.h"
#include <lwip/sockets.h>
#include <fcntl.h>
#include <errno.h>
#include <new>
#include <stdio.h>

namespace {
bool detach(int fd){const uint32_t now=millis();return LampHttpSocketCleanup::enqueue({fd,now,now,LampHttpParser::RequestTimeoutMs,false});}
bool wouldBlock(){return errno==EAGAIN||errno==EWOULDBLOCK||errno==EINTR;}
const char* statusText(int code){switch(code){case 200:return "OK";case 202:return "Accepted";case 400:return "Bad Request";case 401:return "Unauthorized";case 403:return "Forbidden";case 404:return "Not Found";case 405:return "Method Not Allowed";case 408:return "Request Timeout";case 409:return "Conflict";case 413:return "Payload Too Large";case 500:return "Internal Server Error";case 503:return "Service Unavailable";case 507:return "Insufficient Storage";default:return "Response";}}
}
uint32_t LampHttpServer::closeTaskStackMinimumBytes()const{return LampHttpSocketCleanup::taskStackMinimumBytes();}

bool LampHttpServer::beginTransport(){
  if(listenerClosing_){if(!detach(listener_))return false;listener_=-1;listenerClosing_=false;}
  if(listener_>=0)return true;if(!LampHttpSocketCleanup::start())return false;
  const int fd=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP);if(fd<0)return false;
  int reuse=1;setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&reuse,sizeof(reuse));
  // Also bound the close worker's lwIP FIN allocation wait.
  timeval timeout{0,1000};setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
  sockaddr_in address{};address.sin_family=AF_INET;address.sin_port=htons(port_);address.sin_addr.s_addr=htonl(INADDR_ANY);
  if(fcntl(fd,F_SETFL,O_NONBLOCK)<0||bind(fd,reinterpret_cast<sockaddr*>(&address),sizeof(address))<0||listen(fd,MaxClients)<0){listener_=fd;stopTransport();return false;}
  listener_=fd;return true;
}
void LampHttpServer::stopTransport(){
  for(unsigned i=0;i<MaxClients;++i)if(clients_[i].state!=ClientState::Free)release(i,true);
  if(listener_>=0){listenerClosing_=true;if(detach(listener_)){listener_=-1;listenerClosing_=false;}}
}
void LampHttpServer::serviceCleanup(){
  for(unsigned i=0;i<MaxClients;++i)if(clients_[i].state==ClientState::Closing)closeSlot(i);
  if(listenerClosing_&&detach(listener_)){listener_=-1;listenerClosing_=false;}
}
void LampHttpServer::closeSlot(unsigned index){
  auto& c=clients_[index];
  if(!LampHttpSocketCleanup::enqueue({c.fd,c.deadline.acceptedAt,c.deadline.progressAt,c.closeTimeoutMs,c.closeAbandoned,c.closeKnownPendingBytes})){c.state=ClientState::Closing;increment(metrics_.closeQueueFull);return;}
  c.fd=-1;c.state=ClientState::Free;
}
void LampHttpServer::clearParser(Slot& c){
  delete c.parser;c.parser=nullptr;
  if(c.formBody){LampHttpParser::wipe(c.formBody,c.formCapacity);delete[] c.formBody;c.formBody=nullptr;}
  c.formCapacity=0;
}
LampHttpSocketCleanup::TransmitCredit LampHttpServer::sampleTransmitCredit(unsigned index){
  auto& c=clients_[index];const auto credit=LampHttpSocketCleanup::transmitCredit(c.fd);
  if(c.awaitingAck&&credit.bytes){
    // This is observed transport progress, not synthetic input or a renewed
    // request lifetime. A following unsent/resource wait gets normal idle time.
    c.awaitingAck=false;c.deadline.progress(millis());
  }else if(c.awaitingAck&&credit.observed){
    // A single application write can be split into several SDK segments.
    // Partial ACK progress is real even before every queued byte is released.
    // Contention/equal snapshots never renew idle or the original lifetime.
    if(credit.pendingBytes<c.ackPendingBytes||(c.ackObserved&&credit.pendingSegments<c.ackPendingSegments))c.deadline.progress(millis());
    c.ackPendingBytes=credit.pendingBytes;c.ackPendingSegments=credit.pendingSegments;c.ackObserved=true;
  }
  return credit;
}
void LampHttpServer::release(unsigned index,bool cancelled){
  auto& c=clients_[index];
  // Cleanup queue backpressure retains the original handoff record. A repeated
  // stop must not replace its captured upload/HTML lifetime with an API limit.
  if(c.state==ClientState::Closing){closeSlot(index);return;}
  maximum(metrics_.maxConnectionMs,uint32_t(millis()-c.deadline.acceptedAt));maximum(metrics_.maxIdleMs,uint32_t(millis()-c.deadline.progressAt));
  if(cancelled){increment(metrics_.cancelled);if(c.uploadStarted&&c.uploadAccepted&&uploadOwner_==int(index)){
    current_=int(index);upload_.status=UPLOAD_FILE_ABORTED;routes_[c.route].upload();current_=-1;
  }}
  if(uploadOwner_==int(index))uploadOwner_=-1;
  c.uploadStarted=c.uploadAccepted=false;
  c.closeAbandoned=cancelled;c.closeTimeoutMs=absoluteTimeout(c);
  // Capture before clearing the active flight. Queue-full retries/repeated
  // stops must preserve this original bounded handoff, just like its lifetime.
  c.closeKnownPendingBytes=c.awaitingAck?c.ackPendingBytes:0;
  clearParser(c);delete c.multipart;c.multipart=nullptr;
  // A waiting request owns only this immutable staging record. No adapter
  // fields have been decoded, so cancelling it cannot disturb BLE control.
  if(dispatchContext_==int(index)&&current_!=int(index))clearDispatchRequest();
  erase(c.body);c.staticBody=nullptr;c.staticPage=c.readResponse=false;c.bodyLength=c.sent=c.headerSent=c.headerLength=0;
  c.awaitingAck=c.ackObserved=false;c.ackPendingBytes=c.ackPendingSegments=0;
  LampHttpParser::wipe(c.input,sizeof(c.input));c.inputAt=c.inputSize=0;
  closeSlot(index);
}
bool LampHttpServer::prepareResponse(int code,const char* type,size_t length){
  if(current_<0)return false;auto& c=clients_[current_];
  if(!type||strlen(type)>80||strchr(type,'\r')||strchr(type,'\n'))return false;
  const int n=snprintf(c.responseHeader,sizeof(c.responseHeader),"HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %u\r\nConnection: close\r\n%s\r\n",code,statusText(code),type,unsigned(length),responseHeaders_.length()?responseHeaders_.c_str():"");
  if(n<0||size_t(n)>=sizeof(c.responseHeader))return false;
  c.readResponse=c.readResponse&&code>=200&&code<300&&length>4096&&!strcmp(type,"application/json");
  c.headerLength=size_t(n);c.bodyLength=length;c.sent=c.headerSent=0;c.state=ClientState::Send;c.awaitingAck=c.ackObserved=false;c.ackPendingBytes=c.ackPendingSegments=0;
  // A complete request may have waited for server RAM. The response's idle
  // interval starts when it exists; the original absolute lifetime never moves.
  c.deadline.progress(millis());responseSet_=true;increment(metrics_.responses);return true;
}
void LampHttpServer::queueError(unsigned index,int code,const char* message){
  if(index>=MaxClients)return;const int previous=current_;current_=int(index);auto& c=clients_[index];
  erase(c.body);c.staticBody=message;c.staticPage=false;responseHeaders_=static_cast<const char*>(nullptr);
  prepareResponse(code,"text/plain",strlen(message));current_=previous;
}
void LampHttpServer::retain(int code,const char* type,String&& body){
  if(current_<0)return;auto& c=clients_[current_];
  const auto* request=currentRequest();
  if(code>=200&&code<300&&type&&!strncmp(type,"application/json",16)&&body.isEmpty()&&request&&
     LampControlResourcePolicy::readHttpPath(request->path,request->method==LampHttpParser::Method::Post)){
    increment(metrics_.responseFailures);queueError(unsigned(current_),503,"Read resources unavailable. Nothing changed.");return;
  }
  const size_t limit=request&&!strcmp(request->path,"/api/household/control")?HouseholdResponseBytes:MaxResponseBytes;
  if(body.length()>limit||queuedBodyBytes()-c.body.length()+body.length()>TotalResponseBytes||(code>=200&&code<300&&type&&!strncmp(type,"application/json",16)&&!LampHttpJson::complete(body.c_str(),body.length()))){increment(metrics_.responseFailures);queueError(unsigned(current_),507,"Response unavailable; reconcile any submitted mutation.");return;}
  erase(c.body);c.body=std::move(body);c.staticBody=nullptr;c.staticPage=false;
  if(!prepareResponse(code,type,c.body.length())){increment(metrics_.responseFailures);queueError(unsigned(current_),507,"Response unavailable; reconcile any submitted mutation.");}
}
void LampHttpServer::send_P(int code,const char* type,const char* body){
  send_P(code,type,body,body?strlen(body):0);
}
void LampHttpServer::send_P(int code,const char* type,const char* body,size_t bytes){
  if(current_<0)return;
  if((bytes&&!body)||bytes>MaxMappedPageBytes){increment(metrics_.responseFailures);queueError(unsigned(current_),500,"Mapped response unavailable.");return;}
  auto& c=clients_[current_];erase(c.body);c.staticBody=body;
  c.staticPage=type&&!strncmp(type,"text/html",9)&&(type[9]=='\0'||type[9]==';');
  // ESP32 flash is mapped. The immutable page is sent directly, no heap copy.
  if(!prepareResponse(code,type,bytes))queueError(unsigned(current_),500,"Response unavailable.");
}
bool LampHttpServer::authenticate(const char* name,const char* password){
  const auto* request=currentRequest();
  if(!request||!name||!password)return false;
  const char* header=request->authorization;
  char plain[96]{},expected[137]{};const int count=snprintf(plain,sizeof(plain),"%s:%s",name,password);
  if(count<0||size_t(count)>=sizeof(plain)){LampHttpParser::wipe(plain,sizeof(plain));return false;}
  static constexpr char alphabet[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  memcpy(expected,"Basic ",6);size_t used=6;
  for(size_t i=0;i<size_t(count);i+=3){const uint32_t v=(uint32_t(uint8_t(plain[i]))<<16)|(i+1<size_t(count)?uint32_t(uint8_t(plain[i+1]))<<8:0)|(i+2<size_t(count)?uint8_t(plain[i+2]):0);
    expected[used++]=alphabet[(v>>18)&63];expected[used++]=alphabet[(v>>12)&63];expected[used++]=i+1<size_t(count)?alphabet[(v>>6)&63]:'=';expected[used++]=i+2<size_t(count)?alphabet[v&63]:'=';
  }
  uint8_t difference=uint8_t(strlen(header)!=used);if(used<=128){for(size_t i=0;i<used;++i)difference|=uint8_t(header[i])^uint8_t(expected[i]);}else difference=1;
  LampHttpParser::wipe(plain,sizeof(plain));LampHttpParser::wipe(expected,sizeof(expected));return difference==0;
}
bool LampHttpServer::buildForm(const Slot& c,String& form){
  const auto& request=c.parser->request();const size_t queryBytes=strlen(request.query),bodyBytes=c.parser->bodySize();
  const size_t total=queryBytes+bodyBytes+(queryBytes&&bodyBytes?1:0);
  const size_t limit=!strcmp(request.path,"/api/household/control")?2048:1024;
  if(total>limit)return false;
  if(!total)return true;
  return form.reserve(total)&&(!queryBytes||form.concat(request.query,queryBytes))&&
    (!(queryBytes&&bodyBytes)||form.concat('&'))&&(!bodyBytes||form.concat(reinterpret_cast<const char*>(c.parser->body()),bodyBytes))&&form.length()==total;
}
bool LampHttpServer::prepareDispatch(unsigned index){
  auto& c=clients_[index];if(dispatchContext_>=0)return false;
  String form;
  const auto& request=c.parser->request();const size_t queryBytes=strlen(request.query),bodyBytes=c.parser->bodySize();
  const size_t limit=!strcmp(request.path,"/api/household/control")?2048:1024;
  if(queryBytes+bodyBytes+(queryBytes&&bodyBytes?1:0)>limit){clearParser(c);queueError(index,400,"Invalid request form.");return false;}
  if(!buildForm(c,form)){erase(form);clearParser(c);queueError(index,503,"Request memory unavailable. No command was executed.");return false;}
  dispatchRequest_=c.parser->request();dispatchForm_=std::move(form);dispatchContext_=int(index);
  clearParser(c);LampHttpParser::wipe(c.input,sizeof(c.input));c.inputAt=c.inputSize=0;c.state=ClientState::Prepared;
  return true;
}
void LampHttpServer::dispatch(unsigned index){
  auto& c=clients_[index];const bool prepared=c.state==ClientState::Prepared&&dispatchContext_==int(index);
  current_=int(index);responseSet_=false;erase(responseHeaders_);
  // Reserve scarce response RAM before executing any command. A busy reader
  // may get 503; an already executed command is never dispatched again.
  // Multipart callbacks may already have written or committed the image. Its
  // final /update handler reports that outcome and schedules the verified
  // restart; it must run once even behind an ordinary response. The aggregate
  // response bound still applies, and a missing final reply requires reconcile.
  if(!c.multipart&&queuedBodyBytes()>1024){queueError(index,503,"Another response is pending. This request was not executed.");}
  else {
    // Multipart completion runs immediately while its parser remains owned.
    // It must not overwrite a different ordinary request waiting for RAM.
    String uploadForm;String& form=prepared?dispatchForm_:uploadForm;
    if((!prepared&&!buildForm(c,form))||!prepareHttpForm(form))queueError(index,400,"Invalid request form.");
    else {
      // Fields are now owned by the adapter for this callback only. Ordinary
      // framing was freed before memory admission; raw secrets can go now.
      erase(form);
      const uint32_t began=micros();increment(metrics_.dispatches);
      if(c.route>=0)routes_[c.route].handler();else if(notFound_)notFound_();else send(404,"text/plain","Not found.");
      maximum(metrics_.maxDispatchUs,uint32_t(micros()-began));
      if(!responseSet_)send(500,"text/plain","Handler did not produce a response; reconcile any submitted mutation.");
    }
    erase(form);clearHttpForm();
  }
  clearParser(c);if(prepared)clearDispatchRequest();current_=-1;erase(responseHeaders_);
  LampHttpParser::wipe(c.input,sizeof(c.input));c.inputAt=c.inputSize=0;
}
void LampHttpServer::uploadEvent(unsigned index,LampHttpMultipart::Event event){
  auto& c=clients_[index];current_=int(index);auto& part=*c.multipart;
  if(event==LampHttpMultipart::Event::Start){
    // Avoid a 1436-byte HTTPUpload temporary on the 6144-byte loop stack.
    erase(upload_.name);erase(upload_.filename);erase(upload_.type);LampHttpParser::wipe(upload_.buf,sizeof(upload_.buf));
    upload_.status=UPLOAD_FILE_START;upload_.totalSize=upload_.currentSize=0;
    upload_.name=part.name();upload_.filename=part.filename();upload_.type="application/octet-stream";
    if(upload_.name.length()!=strlen(part.name())||upload_.filename.length()!=strlen(part.filename())||upload_.type.length()!=24){
      uploadOwner_=-1;queueError(index,503,"Upload resources unavailable. Nothing started.");current_=-1;return;
    }
    c.uploadStarted=true;c.uploadAccepted=false;routes_[c.route].upload();
    if(!c.uploadAccepted){uploadOwner_=-1;c.uploadStarted=false;dispatch(index);}
  }else if(event==LampHttpMultipart::Event::Chunk){
    upload_.status=UPLOAD_FILE_WRITE;upload_.currentSize=part.chunkSize();memcpy(upload_.buf,part.chunk(),upload_.currentSize);upload_.totalSize+=upload_.currentSize;
    routes_[c.route].upload();LampHttpParser::wipe(upload_.buf,upload_.currentSize);part.consumeChunk();
    if(!c.uploadAccepted){uploadOwner_=-1;c.uploadStarted=false;dispatch(index);}
  }else if(event==LampHttpMultipart::Event::Complete){
    // No END/boot selection until ALL declared bytes and closing delimiter.
    if(c.received!=c.parser->request().contentLength){current_=-1;release(index,true);return;}
    upload_.status=UPLOAD_FILE_END;upload_.currentSize=0;routes_[c.route].upload();c.uploadAccepted=false;c.uploadStarted=false;uploadOwner_=-1;dispatch(index);
  }else if(event==LampHttpMultipart::Event::Failed){current_=-1;release(index,true);return;}
  current_=-1;
}
void LampHttpServer::serviceTransport(){
  const uint32_t began=micros();size_t rx=0,tx=0;bool callback=false;
  // Retry only nonblocking queue handoff. Never close a socket on this loop.
  for(unsigned i=0;i<MaxClients;++i)if(clients_[i].state==ClientState::Closing)closeSlot(i);
  if(listener_<0)beginTransport();
  unsigned free=MaxClients;for(unsigned i=0;i<MaxClients;++i)if(clients_[i].state==ClientState::Free){free=i;break;}
  if(listener_>=0&&free<MaxClients){
    const int fd=accept(listener_,nullptr,nullptr);
    if(fd>=0){auto& c=clients_[free];c.fd=fd;c.deadline.begin(millis());c.received=0;c.route=-1;
      timeval timeout{0,1000};setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
      if(fcntl(fd,F_SETFL,O_NONBLOCK)<0){increment(metrics_.rejected);release(free);}
      else {
        // A retained BLE/HTTP reply is already included in CURRENT heap. Do
        // not spend the SDK/workspace allowance on another incomplete client.
        // Budget the compiled parser size plus conservative16-byte allocator
        // rounding before new; this is admission, not an SDK heap reservation.
        const size_t allocation=LampControlResourcePolicy::roundedReplyBytes(sizeof(LampHttpParser::CompactParser));
        constexpr size_t reserve=LampControlResourcePolicy::ReadHeadroomBytes+LampControlResourcePolicy::ReadWorkspaceBytes;
        if(ESP.getFreeHeap()<allocation+reserve||ESP.getMaxAllocHeap()<allocation){
          increment(metrics_.rejected);queueError(free,503,"HTTP resources unavailable. No command was executed.");
        }else {
          c.parser=new(std::nothrow)LampHttpParser::CompactParser;
          // SDK allocation can race the preflight. Refuse and release our own
          // parser immediately if allocation failed or current headroom fell.
          if(!c.parser||ESP.getFreeHeap()<reserve){
            clearParser(c);increment(metrics_.rejected);queueError(free,503,"HTTP resources unavailable. No command was executed.");
          }else {c.state=ClientState::Receive;increment(metrics_.accepted);}
        }
      }
    }
  }
  for(unsigned step=0;step<MaxClients;++step){
    const unsigned index=(cursor_+step)%MaxClients;auto& c=clients_[index];
    if(c.state==ClientState::Free||c.state==ClientState::Closing)continue;
    // Complete input waiting for our dispatch/RAM is not idle peer input. It
    // may wait only until the ORIGINAL five-second connection deadline. Reads,
    // uploads retain the 1.5-second input idle fence. Already copied outgoing
    // data uses the separate bounded ACK-progress fence.
    const bool completeInput=c.state==ClientState::Ready||c.state==ClientState::Prepared;
    const uint32_t now=millis();
    if(LampHttpParser::elapsed(now,c.deadline.acceptedAt,absoluteTimeout(c))){increment(metrics_.deadlines);release(index,true);continue;}
    LampHttpSocketCleanup::TransmitCredit credit;bool creditSampled=false;
    if(c.state==ClientState::Send){credit=sampleTransmitCredit(index);creditSampled=true;if(credit.disconnected){release(index,true);continue;}}
    const uint32_t idle=c.state==ClientState::Send&&c.awaitingAck?LampHttpSocketCleanup::AckWaitTimeoutMs:LampHttpParser::IdleTimeoutMs;
    if(!completeInput&&LampHttpParser::elapsed(millis(),c.deadline.progressAt,idle)){increment(metrics_.deadlines);release(index,true);continue;}
    if(uint32_t(micros()-began)>=TurnBudgetUs)break;
    if(c.state==ClientState::Ready&&!callback){
      // Free the completed parser before asking whether a reply allocation is
      // viable. Only one bounded immutable request may wait in staging.
      if(!prepareDispatch(index))continue;
    }
    if(c.state==ClientState::Prepared&&!callback){
      if(rx==TurnReceiveBytes)continue;
      // Pinned core connected() uses a nonblocking peek. A FIN/SHUT_WR (zero)
      // is valid after a complete request; only an actual socket error cancels
      // before execution. Peeking never consumes a second pipelined request.
      uint8_t probe=0;const int available=recv(c.fd,&probe,1,MSG_DONTWAIT|MSG_PEEK);
      if(available<0&&!wouldBlock()){release(index,true);continue;}
      if(available>0)++rx;
      // Wait before executing any mutation until its ordinary reply has a
      // viable allocation budget. 6160 includes pinned WString's rounding for
      // the common 6144-byte reserve. Waiting does not renew request lifetime.
      const bool boundedRead=dispatchContext_==int(index)&&LampControlResourcePolicy::readHttpPath(dispatchRequest_.path,dispatchRequest_.method==LampHttpParser::Method::Post);
      const bool boundedPreparation=dispatchContext_==int(index)&&LampControlResourcePolicy::preparationHttpPath(dispatchRequest_.path,dispatchRequest_.method==LampHttpParser::Method::Post);
      const bool mappedPage=dispatchContext_==int(index)&&LampControlResourcePolicy::mappedPageHttpPath(dispatchRequest_.path,dispatchRequest_.method==LampHttpParser::Method::Post);
      if(mappedPage){
        if(!LampControlResourcePolicy::mappedPageReady(ESP.getFreeHeap(),ESP.getMaxAllocHeap(),dispatchForm_.length())){
          clearDispatchRequest();queueError(index,503,"Page resources unavailable. Nothing changed.");callback=true;continue;
        }
      }else if(boundedRead){
        if(!LampControlResourcePolicy::readReady(ESP.getFreeHeap(),ESP.getMaxAllocHeap(),dispatchForm_.length())){
          clearDispatchRequest();queueError(index,503,"Read resources unavailable. Nothing changed.");callback=true;continue;
        }
      }else if(boundedPreparation){
        if(!LampControlResourcePolicy::preparationReady(ESP.getFreeHeap(),ESP.getMaxAllocHeap(),dispatchForm_.length())){
          clearDispatchRequest();queueError(index,503,"Upload preparation memory unavailable. Nothing started.");callback=true;continue;
        }
      }else if(dispatchContext_==int(index)&&LampControlResourcePolicy::compactMutationHttpPath(dispatchRequest_.path,dispatchRequest_.method==LampHttpParser::Method::Post)){
        if(!LampControlResourcePolicy::compactMutationReady(ESP.getFreeHeap(),ESP.getMaxAllocHeap(),dispatchForm_.length())){
          clearDispatchRequest();queueError(index,503,"Control resources unavailable. This request was not executed.");callback=true;continue;
        }
      }else if(!LampControlResourcePolicy::replyReady(ESP.getFreeHeap(),ESP.getMaxAllocHeap()))continue;
      c.readResponse=boundedRead;dispatch(index);callback=true;continue;
    }
    if(c.state==ClientState::Receive||c.state==ClientState::Upload){
      while(rx<TurnReceiveBytes&&uint32_t(micros()-began)<TurnBudgetUs){
        if(c.inputAt==c.inputSize){
          size_t wanted=sizeof(c.input);if(wanted>TurnReceiveBytes-rx)wanted=TurnReceiveBytes-rx;
          if(c.state==ClientState::Upload&&wanted>c.parser->request().contentLength-c.received)wanted=c.parser->request().contentLength-c.received;
          if(!wanted){release(index,true);break;}
          const int n=recv(c.fd,c.input,wanted,MSG_DONTWAIT);if(n<0){if(!wouldBlock())release(index,true);break;}if(!n){release(index,true);break;}
          c.inputAt=0;c.inputSize=size_t(n);rx+=size_t(n);c.deadline.progress(millis());
        }
        if(c.state==ClientState::Upload){
          if(callback)break;
          ++c.received;const auto event=c.multipart->feed(c.input[c.inputAt++]);
          if(event!=LampHttpMultipart::Event::More){uploadEvent(index,event);callback=true;break;}
          if(c.received==c.parser->request().contentLength){release(index,true);break;}
        }else{
          const auto result=c.parser->feed(c.input[c.inputAt++]);
          if(result==LampHttpParser::Result::Rejected){increment(metrics_.rejected);queueError(index,c.parser->error()==LampHttpParser::Error::BodyTooLarge?413:400,"Invalid or oversized HTTP request.");break;}
          if(result==LampHttpParser::Result::HeadersReady){
            const auto& request=c.parser->request();const HTTPMethod method=request.method==LampHttpParser::Method::Get?HTTP_GET:HTTP_POST;
            for(unsigned r=0;r<routeCount_;++r)if(!strcmp(request.path,routes_[r].path)&&(routes_[r].method==HTTP_ANY||routes_[r].method==method)){c.route=int(r);break;}
            if(request.multipart){
              if(uploadOwner_>=0||c.route<0||!routes_[c.route].upload){queueError(index,409,"Another upload is active or unavailable.");break;}
              c.multipart=new(std::nothrow)LampHttpMultipart::Parser;
              if(!c.multipart){queueError(index,503,"Upload resources unavailable. Nothing started.");break;}
              c.multipart->reset(request.boundary);uploadOwner_=int(index);c.state=ClientState::Upload;break;
            }
            if(c.parser->bodyStorageNeeded()){
              c.formCapacity=size_t(request.contentLength)+1;c.formBody=new(std::nothrow)uint8_t[c.formCapacity];
              if(!c.formBody||!c.parser->attachBody(c.formBody,c.formCapacity)){
                increment(metrics_.rejected);clearParser(c);queueError(index,503,"Request memory unavailable. No command was executed.");break;
              }
            }
          }
          if(c.parser->phase()==LampHttpParser::Phase::Complete){c.state=ClientState::Ready;break;}
        }
      }
    }
    if(c.state==ClientState::Send&&tx<TurnSendBytes){
      // Flash mapping avoids a page-sized application buffer, but lwIP still
      // copies queued TCP bytes. A non-reading setup-page peer must not spend
      // the heap needed by a verified ordinary control read, even while another
      // accepted request is still receiving input. Errors and JSON
      // responses keep draining; withholding page bytes does not renew either
      // its idle or absolute deadline.
      if(c.staticPage&&(ESP.getFreeHeap()<StaticPageHeapFloorBytes||priorityResponsePending(index))){increment(metrics_.blockedSends);continue;}
      if(!creditSampled)credit=sampleTransmitCredit(index);
      if(credit.disconnected){release(index,true);continue;}
      if(!credit.bytes){increment(metrics_.blockedSends);continue;}
      const bool headers=c.headerSent<c.headerLength;const char* bytes=headers?c.responseHeader+c.headerSent:(c.staticBody?c.staticBody:c.body.c_str())+c.sent;
      size_t length=headers?c.headerLength-c.headerSent:c.bodyLength-c.sent;if(length>TurnSendBytes-tx)length=TurnSendBytes-tx;if(length>credit.bytes)length=credit.bytes;
      if(!length){release(index);continue;}
      const int n=::send(c.fd,bytes,length,MSG_DONTWAIT);
      if(n<0){if(wouldBlock())increment(metrics_.blockedSends);else release(index,true);}
      else if(n>0){tx+=size_t(n);c.awaitingAck=true;c.ackObserved=false;c.ackPendingBytes=uint16_t(n);c.ackPendingSegments=0;c.deadline.progress(millis());if(headers)c.headerSent+=size_t(n);else c.sent+=size_t(n);if(c.headerSent==c.headerLength&&c.sent==c.bodyLength)release(index);}
      else release(index,true);
    }
  }
  cursor_=(cursor_+1)%MaxClients;maximum(metrics_.maxReceiveBytes,uint32_t(rx));maximum(metrics_.maxSendBytes,uint32_t(tx));maximum(metrics_.maxServiceUs,uint32_t(micros()-began));
}
