#pragma once
#include "Arduino.h"
#include <functional>
#include <map>
#include <utility>
enum HTTPMethod {HTTP_ANY,HTTP_GET,HTTP_POST};
struct RequestHandler {};
class WebServer {
public:
  using THandlerFunction=std::function<void()>;
  std::map<std::pair<std::string,int>,THandlerFunction> handlers;
  std::map<std::string,String> arguments,headers,outputHeaders;
  String requestUri,responseBody,responseType;
  int responseStatus=0,authCalls=0,authRequests=0;
  bool httpAuthorized=false;
  RequestHandler registered;
  explicit WebServer(uint16_t){}
  RequestHandler& on(const char* path,HTTPMethod method,THandlerFunction handler){handlers[{path,method}]=std::move(handler);return registered;}
  String arg(const String& key)const{auto found=arguments.find(key);return found==arguments.end()?String():found->second;}
  bool hasArg(const String& key)const{return arguments.count(key);}
  String uri()const{return requestUri;}
  String header(const String& key)const{auto found=headers.find(key);return found==headers.end()?String():found->second;}
  bool authenticate(const char*,const char*){++authCalls;return httpAuthorized;}
  void requestAuthentication(){++authRequests;send(401,"text/plain","Authentication needed");}
  void sendHeader(const String& key,const String& value,bool=false){outputHeaders[key]=value;}
  void send(int status,const char* type,const String& body){responseStatus=status;responseType=type;responseBody=body;}
  void send(int status,const char* type,const char* body){send(status,type,String(body));}
  void invokeHttp(const char* path,HTTPMethod method){requestUri=path;responseStatus=0;responseBody=String();outputHeaders.clear();handlers.at({path,method})();}
};
