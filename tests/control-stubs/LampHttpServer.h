#pragma once
#include <WebServer.h>
class LampHttpServer:public WebServer {
protected:
 virtual bool prepareHttpForm(const String&){return true;}
 virtual void clearHttpForm(){}
public:
 using WebServer::WebServer;
 void on(const char* path,HTTPMethod method,THandlerFunction handler,THandlerFunction=THandlerFunction()){WebServer::on(path,method,std::move(handler));}
};
