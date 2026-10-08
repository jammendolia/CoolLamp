#pragma once
#include <Arduino.h>
#include <WebServer.h>
#include "LampControlEndpoint.h"
#include <utility>

// HTTP and encrypted/bonded BLE commands share the same loop-only handlers.
// Only the trusted BLE service calls executeControl(); HTTP cannot select this
// context with a URL, header or form field. No handler executes on a callback.
extern String lampToken;
class LampControlHttpAdapter : public WebServer {
  static constexpr unsigned Slots=27, Fields=16;
  THandlerFunction controls[Slots][2];
  struct Entry { String key,value; } fields[Fields];
  unsigned fieldCount=0;
  bool control=false;
  String controlUri;
  LampControlReply reply;
  static void erase(String& text){
    volatile char* bytes=const_cast<char*>(text.c_str());
    for(size_t i=0;i<text.length();++i)bytes[i]=0;
    // Arduino String's empty move assignment can retain a large allocation.
    // Null copy assignment invalidates/frees it before an OTA TLS operation.
    text=static_cast<const char*>(nullptr);
  }
  void clearFields(){for(unsigned i=0;i<fieldCount;++i){erase(fields[i].key);erase(fields[i].value);}fieldCount=0;}
  static int digit(char c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;}
  static bool utf8(const String& text){
    for(size_t i=0;i<text.length();){
      const uint8_t a=uint8_t(text[i++]);if(a<0x80)continue;
      unsigned extra=0;uint32_t value=0,minimum=0;
      if(a>=0xc2&&a<=0xdf){extra=1;value=a&31;minimum=0x80;}
      else if(a>=0xe0&&a<=0xef){extra=2;value=a&15;minimum=0x800;}
      else if(a>=0xf0&&a<=0xf4){extra=3;value=a&7;minimum=0x10000;}
      else return false;
      while(extra--){if(i>=text.length())return false;const uint8_t b=uint8_t(text[i++]);if((b&0xc0)!=0x80)return false;value=(value<<6)|(b&63);}
      if(value<minimum||value>0x10ffff||(value>=0xd800&&value<=0xdfff))return false;
    }return true;
  }
  static bool decode(const String& body,size_t begin,size_t end,String& out){
    if(end>begin&&!out.reserve(end-begin))return false;
    for(size_t i=begin;i<end;++i){
      unsigned char c=body[i];
      if(c=='%'){if(i+2>=end)return false;const int a=digit(body[i+1]),b=digit(body[i+2]);if(a<0||b<0)return false;c=uint8_t(a*16+b);i+=2;}
      else if(c=='+')c=' ';
      if(c<32||c==127)return false;
      if(!out.concat(char(c)))return false;
    }return utf8(out);
  }
  bool parse(const String& body){
    if(body.length()>1024)return false;
    for(size_t begin=0;begin<body.length();){
      if(fieldCount==Fields)return false;
      size_t end=begin;while(end<body.length()&&body[end]!='&')++end;
      size_t split=begin;while(split<end&&body[split]!='=')++split;
      if(split==begin||split==end)return false;
      auto& entry=fields[fieldCount++];
      if(!decode(body,begin,split,entry.key)||!decode(body,split+1,end,entry.value)||entry.key.length()>48)return false;
      for(unsigned i=0;i+1<fieldCount;++i)if(fields[i].key==entry.key)return false;
      begin=end+1;if(begin==body.length())return false;
    }return true;
  }
  static uint8_t endpoint(const char* path,HTTPMethod method){
    using namespace LampControlEndpoint;
    if(method==HTTP_GET){if(!strcmp(path,"/api/state"))return State;if(!strcmp(path,"/api/firmware"))return Firmware;if(!strcmp(path,"/api/bluetooth"))return Bluetooth;if(!strcmp(path,"/api/effects"))return Effects;return 0;}
    if(method!=HTTP_POST)return 0;
    const char* paths[]={"/api/sync/invite","/api/sync","/api/sync/scene","/api/sync/order","/api/config","/api/audio","/api/audio/tuning","/api/rotation","/api/geometry","/api/calibration","/api/name","/api/identify","/api/vu-colors","/api/fountain-colors","/api/audio/test"};
    for(unsigned i=0;i<sizeof(paths)/sizeof(paths[0]);++i)if(!strcmp(path,paths[i]))return SyncInvite+i;
    if(!strcmp(path,"/api/firmware/check"))return FirmwareCheck;
    if(!strcmp(path,"/api/firmware/install"))return FirmwareInstall;
    if(!strcmp(path,"/api/firmware/automatic"))return FirmwareAutomatic;
    if(!strcmp(path,"/api/factory-reset"))return FactoryReset;
    if(!strcmp(path,"/api/bluetooth/forget"))return Bluetooth;
    if(!strcmp(path,"/api/style"))return Style;
    return 0;
  }
  static const char* route(uint8_t id,bool mutation){
    using namespace LampControlEndpoint;
    if(!mutation){if(id==State)return "/api/state";if(id==Sync)return "/api/sync";if(id==Firmware)return "/api/firmware";if(id==Bluetooth)return "/api/bluetooth";if(id==Effects)return "/api/effects";return "";}
    const char* paths[]={"/api/sync/invite","/api/sync","/api/sync/scene","/api/sync/order","/api/config","/api/audio","/api/audio/tuning","/api/rotation","/api/geometry","/api/calibration","/api/name","/api/identify","/api/vu-colors","/api/fountain-colors","/api/audio/test"};
    if(id>=SyncInvite&&id<=AudioTest)return paths[id-SyncInvite];
    if(id==FirmwareCheck)return "/api/firmware/check";
    if(id==FirmwareInstall)return "/api/firmware/install";
    if(id==FirmwareAutomatic)return "/api/firmware/automatic";
    if(id==FactoryReset)return "/api/factory-reset";
    if(id==Bluetooth)return "/api/bluetooth/forget";
    if(id==Style)return "/api/style";
    return "";
  }
public:
  explicit LampControlHttpAdapter(uint16_t port):WebServer(port){}
  using WebServer::on;using WebServer::arg;using WebServer::header;using WebServer::send;
  RequestHandler& on(const char* path,HTTPMethod method,THandlerFunction handler){
    const uint8_t id=endpoint(path,method);
    if(id&&id<Slots)controls[id][method==HTTP_POST?1:0]=handler;
    return WebServer::on(path,method,std::move(handler));
  }
  void setControlRead(uint8_t id,THandlerFunction handler){if(id&&id<Slots)controls[id][0]=std::move(handler);}
  bool controlActive()const{return control;}
  String arg(const String& name)const{if(!control)return WebServer::arg(name);for(unsigned i=0;i<fieldCount;++i)if(fields[i].key==name)return fields[i].value;return String();}
  bool hasArg(const String& name)const{if(!control)return WebServer::hasArg(name);for(unsigned i=0;i<fieldCount;++i)if(fields[i].key==name)return true;return false;}
  String uri()const{return control?controlUri:WebServer::uri();}
  bool authenticate(const char* name,const char* password){return control||WebServer::authenticate(name,password);}
  String header(const String& name)const{return control?(name=="X-Lamp-Token"?lampToken:String()):WebServer::header(name);}
  void sendHeader(const String& name,const String& value,bool first=false){if(!control)WebServer::sendHeader(name,value,first);}
  void send(int status,const char* type,const String& body){if(!control){WebServer::send(status,type,body);return;}reply.status=status;if(body.length()>8192){reply.status=507;reply.body="Control response too large.";}else reply.body=body;}
  void send(int status,const char* type,const char* body){send(status,type,String(body));}
  LampControlReply executeControl(uint8_t id,bool mutation,const String& body){
    if(control)return {409,"Another control request is active."};
    if(!id||id>=Slots||!controls[id][mutation?1:0])return {404,"This control endpoint is unavailable."};
    clearFields();
    if((!mutation&&!body.isEmpty())||!parse(body)){clearFields();return {400,"Invalid control request form."};}
    if(id==LampControlEndpoint::Bluetooth&&mutation){bool forget=false;for(unsigned i=0;i<fieldCount;++i)if(fields[i].key=="action"&&fields[i].value=="forget")forget=true;if(!forget){clearFields();return {400,"Choose a supported Bluetooth action."};}}
    reply.status=500;erase(reply.body);controlUri=route(id,mutation);control=true;
    controls[id][mutation?1:0]();
    control=false;controlUri=String();clearFields();
    LampControlReply result{reply.status,std::move(reply.body)};reply.status=500;return result;
  }
};
