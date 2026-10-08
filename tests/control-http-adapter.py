"""Run the real BLE/HTTP adapter and extracted production handlers together."""
import json
import pathlib
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = pathlib.Path(__file__).resolve().parents[1]


def function(source, signature):
    start = source.index(signature)
    cursor = source.index('{', start)
    depth = 0
    quote = None
    while cursor < len(source):
        char = source[cursor]
        if quote:
            if char == '\\':
                cursor += 2
                continue
            if char == quote:
                quote = None
        elif char in '\"\'':
            quote = char
        elif source.startswith('//', cursor):
            cursor = source.index('\n', cursor)
            continue
        elif source.startswith('/*', cursor):
            cursor = source.index('*/', cursor) + 2
            continue
        elif char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if not depth:
                return source[start:cursor + 1]
        cursor += 1
    raise ValueError('Unclosed function ' + signature)


def registration(source, route, method='POST'):
    start = source.index('  lampServer.on("' + route + '", HTTP_' + method)
    end = source.index('\n  lampServer.on(', start + 1)
    return source[start:end]


class ControlHttpAdapterTests(unittest.TestCase):
    def test_real_handlers_authentication_configuration_snapshot_and_cleanup(self):
        source = (ROOT/'LampNetwork.ino').read_text()
        sync_source = (ROOT/'LampSync.cpp').read_text()
        effect_names = source[source.index('const char* const effectNames[]'):source.index('static_assert(sizeof(effectNames)')]
        definitions = '\n'.join(function(source, signature) for signature in [
            'String jsonText(', 'bool authorizedLampRequest(', 'bool readNumber(', 'String lampEffectCatalogEntry(',
            'void sendLampState()', 'LampControlReply lampControlRequest(',
            'String lampControlSnapshotJson()', 'void saveLampConfiguration()'])
        sync_json = function(sync_source, 'String lampSyncJson()')
        quote_json = function(sync_source, 'String quote(')
        routes = '\n'.join(registration(source, route) for route in ['/api/sync', '/api/sync/scene', '/api/sync/invite', '/api/name'])
        routes += '\n' + registration(source, '/api/effects', 'GET')
        setup = r'''
#include <cassert>
#include <cstring>
#include <fstream>
#include <iostream>
#include "LampControlHttpAdapter.h"
#include "LampConfig.h"
#include "LampFactory.h"
#include "LampGeometry.h"
#include "LampSyncProtocol.h"
#include "Preferences.h"
LampControlHttpAdapter lampServer(80);
LampSettings lampSettings;
String lampToken="http-session-token-private",lampHost="coollamp-test",lampName="Test lamp";
uint32_t apLastActivity=0,restartAt=0;uint32_t millis(){return 1000;}
bool following=false,ownsUpdate=false,remoteBusy=false,wifiSetupBusy=false,otaActive=false,mdnsStarted=false,colorsSaved=true;
bool lampSyncFollowing(){return following;}bool lampUpdateOwnsResources(){return ownsUpdate;}
bool lampRemoteUpdateBusy(){return remoteBusy;}bool lampWifiSetupBusy(){return wifiSetupBusy;}
bool lampIsUpdating(){return ownsUpdate;}bool saveLampColors(){return colorsSaved;}
uint16_t NUM_LEDS=205,lampMidpoint=102;uint8_t Mode=4,Brightness=55;bool PowerOn=true;
constexpr uint8_t MODE_FIRE=4,LAMP_PROTOCOL_VERSION=1,LAMP_BASE_EFFECT_COUNT=38;
uint8_t lampAvailableEffectCount(){return 47;}
struct Color {uint8_t enabled=1,r=70,g=220,b=255;};
Color getLampColor(uint8_t){return {};}
struct Options {uint8_t speed=60,intensity=85,dual=1,r=255,g=65,b=170;};
Options getLampEffectOptions(uint8_t){return {};}
struct RGB {uint8_t r=70,g=220,b=255;};
RGB fountainPaletteColor(unsigned){return {};}RGB renderVuColor(unsigned){return {};}
bool lampCalibrationActive(){return false;}bool lampCalibrationCenter(){return false;}unsigned lampCalibrationPosition(){return 134;}
struct {bool enabled=true,random=false;uint8_t category=0;uint32_t seconds=30;} lampRotation;
String lampUpdateJson(){return "{\"version\":\"1.10.0\",\"phase\":0,\"progress\":0,\"error\":0,\"wifi\":false,\"available\":false,\"automatic\":false,\"latest\":\"1.10.0\"}";}
String lampAudioJson(){return "{\"installed\":true,\"gain\":8,\"gate\":8,\"scale\":100}";}
constexpr int WL_CONNECTED=3;
struct Address {String toString(){return "0.0.0.0";}};
struct {int status(){return 0;}Address localIP(){return {};}Address gatewayIP(){return {};}Address dnsIP(int){return {};}} WiFi;
struct {void addServiceTxt(const char*,const char*,const char*,const String&) {}} MDNS;
using namespace LampSyncWire;
struct {uint8_t role=1;char leader[13]="aabbccddeeff",key[33]="0123456789abcdef0123456789abcdef";} config;
struct Peer {Packet info{};bool joined=false;uint32_t seen=1000,subscribed=1000;bool udpKnown=false,radioKnown=true;uint32_t udpSeen=1000,radioSeen=1000;Address ip;uint8_t radioChannel=6;} peers[8];
struct {uint8_t count=9;char order[9][13]{};} sceneConfig;
char identity[13]="aabbccddeeff";
bool paused=false,followingRadio=true,started=false,serviceBlocked=false;
uint32_t receivedPackets=20,discoveries=8,authFailures=0,subscriptionsSent=8,framesReceived=20,clockDrops=0;
namespace LampEspNow {
struct Status {bool active=true,suspended=false,seeking=false;uint8_t channel=6;uint32_t received=10,receiveDropped=0,sent=20,sendFailed=0,sendDropped=0,channelChanges=0;};
Status status(){return {};}
}
Visual lampGroupVisual(){Visual visual{};visual.scene=32;visual.count=9;visual.sceneSpeed=60;visual.sceneIntensity=85;return visual;}
unsigned syncMutations=0,sceneMutations=0,pauseMutations=0,resumeMutations=0;
bool configureLampSync(uint8_t role,const String&,const String&){++syncMutations;return role<=2;}
bool configureLampScene(uint8_t,uint8_t,uint8_t,const uint8_t*,const uint8_t*){++sceneMutations;return config.role==1;}
void pauseLampSync(){++pauseMutations;}void resumeLampSync(){++resumeMutations;}
String lampSyncInvite(){return String("CL1-")+config.leader+"-"+config.key;}
String lampSyncJson();
'''
        main = r'''
LampSettings stored(){LampSettings value{};const auto& bytes=Preferences::storage.at("settings");assert(bytes.size()==sizeof(value));memcpy(&value,bytes.data(),sizeof(value));return value;}
void initial(){
 lampSettings={};lampSettings.version=1;lampSettings.ledCount=134;lampSettings.milliAmps=500;lampSettings.brightness=88;lampSettings.startupMode=4;
 strcpy(lampSettings.ssid,"Saved network");strcpy(lampSettings.wifiPassword,"wifi-password-private");strcpy(lampSettings.adminPassword,"admin-password-private");
 strcpy(sceneConfig.order[0],identity);
 for(unsigned i=0;i<8;++i){auto& peer=peers[i];snprintf(peer.info.sender,13,"%012x",i+1);peer.info.role=2;peer.info.microphone=1;memset(peer.info.name,'N',48);peer.info.name[48]=0;peer.joined=true;strcpy(sceneConfig.order[i+1],peer.info.sender);}
 Preferences prefs;assert(prefs.putBytes("settings",&lampSettings,sizeof(lampSettings))==sizeof(lampSettings));
}
int main(int argc,char** argv){
 initial();
 lampServer.on("/api/state",HTTP_GET,sendLampState);
 lampServer.on("/api/config",HTTP_POST,saveLampConfiguration);
 registerRoutes();
 const String hardware="leds=205&milliamps=700&brightness=88&mode=4";
 // Real HTTP authentication/token checks still run after a private BLE context.
 lampServer.arguments={{"leds","205"},{"milliamps","700"},{"brightness","88"},{"mode","4"},{"ssid","Saved network"},{"control","true"}};
 lampServer.headers={{"X-Lamp-Token",lampToken}};lampServer.httpAuthorized=false;
 const auto original=Preferences::storage["settings"];
 lampServer.invokeHttp("/api/config",HTTP_POST);assert(lampServer.responseStatus==401&&Preferences::storage["settings"]==original);
 lampServer.httpAuthorized=true;lampServer.headers["X-Lamp-Token"]="incorrect";
 lampServer.invokeHttp("/api/config",HTTP_POST);assert(lampServer.responseStatus==403&&Preferences::storage["settings"]==original);
 const int authBefore=lampServer.authCalls;
 auto result=lampControlRequest(LampControlEndpoint::Config,true,hardware);
 assert(result.status==200&&lampServer.authCalls==authBefore&&!lampServer.controlActive());
 auto next=stored();assert(next.ledCount==205&&next.milliAmps==700&&next.brightness==88&&next.startupMode==4);
 assert(!strcmp(next.ssid,"Saved network")&&!strcmp(next.wifiPassword,"wifi-password-private")&&!strcmp(next.adminPassword,"admin-password-private"));
 assert(lampSettings.ledCount==134&&lampSettings.brightness==88&&lampSettings.startupMode==4);
 assert(lampServer.arg("ssid")=="Saved network"&&lampServer.arg("leds")=="205");
 assert(lampServer.header("X-Lamp-Token")=="incorrect"&&lampServer.uri()=="/api/config");
 assert(lampServer.authenticate("lamp","ignored"));
 // Startup defaults change only when the caller explicitly chooses them.
 result=lampControlRequest(LampControlEndpoint::Config,true,"leds=205&milliamps=700&brightness=99&mode=8");
 assert(result.status==200);next=stored();assert(next.brightness==99&&next.startupMode==8&&!strcmp(next.ssid,"Saved network"));
 const auto saved=Preferences::storage["settings"];
 restartAt=0;Preferences::failWrites=true;
 result=lampControlRequest(LampControlEndpoint::Config,true,"leds=300&milliamps=800&brightness=120&mode=9");
 assert(result.status==500&&Preferences::storage["settings"]==saved&&!restartAt&&lampSettings.ledCount==134);
 Preferences::failWrites=false;Preferences::failOpen=true;
 result=lampControlRequest(LampControlEndpoint::Config,true,hardware);assert(result.status==500&&Preferences::storage["settings"]==saved&&!restartAt);
 Preferences::failOpen=false;
 for(const char* form:{"leds=0&milliamps=700&brightness=99&mode=8","leds=1025&milliamps=700&brightness=99&mode=8","leds=205&milliamps=99&brightness=99&mode=8","leds=205&milliamps=700&brightness=0&mode=8","leds=205&milliamps=700&brightness=99&mode=48","leds=205&milliamps=700&brightness=99&mode=8&adminPassword=short"}){
   result=lampControlRequest(LampControlEndpoint::Config,true,form);assert(result.status==400&&Preferences::storage["settings"]==saved);
 }
 result=lampControlRequest(LampControlEndpoint::Config,true,hardware+"&ssid=Different");assert(result.status==400&&Preferences::storage["settings"]==saved);
 result=lampControlRequest(LampControlEndpoint::Config,true,hardware+"&ssid=Saved+network&wifiPassword=&adminPassword=");
 assert(result.status==200);next=stored();assert(!strcmp(next.ssid,"Saved network")&&!strcmp(next.wifiPassword,"wifi-password-private")&&!strcmp(next.adminPassword,"admin-password-private"));
 Preferences::storage["settings"]=saved;
 result=lampControlRequest(LampControlEndpoint::Config,true,hardware+"&ssid=");assert(result.status==200);next=stored();assert(!next.ssid[0]&&!next.wifiPassword[0]&&!strcmp(next.adminPassword,"admin-password-private"));
 result=lampControlRequest(LampControlEndpoint::Config,true,hardware+"&forgetWifi=1");assert(result.status==200);next=stored();assert(!next.ssid[0]&&!next.wifiPassword[0]&&next.brightness==88&&next.startupMode==4);
 Preferences::storage["settings"]=saved;
 following=true;result=lampControlRequest(LampControlEndpoint::Config,true,hardware);assert(result.status==409&&Preferences::storage["settings"]==saved);
 lampServer.headers["X-Lamp-Token"]=lampToken;lampServer.invokeHttp("/api/config",HTTP_POST);assert(lampServer.responseStatus==409&&Preferences::storage["settings"]==saved);following=false;
 otaActive=true;result=lampControlRequest(LampControlEndpoint::Config,true,hardware);assert(result.status==409);otaActive=false;
 ownsUpdate=true;result=lampControlRequest(LampControlEndpoint::Group,true,"role=0");assert(result.status==409&&!syncMutations);
 lampServer.arguments={{"role","0"}};lampServer.invokeHttp("/api/sync",HTTP_POST);assert(lampServer.responseStatus==409&&!syncMutations);ownsUpdate=false;
 result=lampControlRequest(LampControlEndpoint::Group,true,"action=pause");assert(result.status==200&&pauseMutations==1);
 result=lampControlRequest(LampControlEndpoint::Group,true,"action=resume");assert(result.status==200&&resumeMutations==1);
 const String scene="scene=32&speed=60&intensity=85&r=70&g=220&b=255&r2=255&g2=65&b2=170";
 config.role=2;result=lampControlRequest(LampControlEndpoint::Scene,true,scene);assert(result.status==409&&sceneMutations==1);config.role=1;
 result=lampControlRequest(LampControlEndpoint::Scene,true,scene);assert(result.status==200&&sceneMutations==2);
 // Percent decoding reaches the actual name/NVS handler as correct UTF-8.
 result=lampControlRequest(LampControlEndpoint::Name,true,"name=%E2%9C%A8%C3%A9+coil");assert(result.status==200&&lampName=="\xe2\x9c\xa8\xc3\xa9 coil"&&Preferences::strings["name"]==lampName);
 result=lampControlRequest(LampControlEndpoint::Name,true,"name=A%2BB%26C%3D%E2%9C%A8");assert(result.status==200&&lampName=="A+B&C=\xe2\x9c\xa8");
 const auto beforeMalformed=Preferences::writes;
 for(const char* body:{"name=Good&name=Other","name=Good&na%6De=Other","name=Good&","name","=Good","name=%","name=%0","name=%QQ","name=%00","name=%1F","name=%7F","name=%C0%AF","name=%ED%A0%80","name=%F4%90%80%80","name=%E2%82","name=%80"}){
   result=lampControlRequest(LampControlEndpoint::Name,true,body);assert(result.status==400&&!lampServer.controlActive()&&Preferences::writes==beforeMalformed);
 }
 String embedded="name=Good";embedded.push_back(char(0));embedded+="extra";result=lampControlRequest(LampControlEndpoint::Name,true,embedded);assert(result.status==400);
 embedded="name=";embedded.push_back(char(1));result=lampControlRequest(LampControlEndpoint::Name,true,embedded);assert(result.status==400);
 String fields="name=Sixteen";for(unsigned i=0;i<15;++i)fields+=String("&field")+String(i)+"=";
 result=lampControlRequest(LampControlEndpoint::Name,true,fields);assert(result.status==200);
 fields+="&overflow=";result=lampControlRequest(LampControlEndpoint::Name,true,fields);assert(result.status==400);
 String boundary="name=Boundary&padding=";boundary+=std::string(1024-boundary.length(),'x');
 result=lampControlRequest(LampControlEndpoint::Name,true,boundary);assert(result.status==200);
 boundary+='x';result=lampControlRequest(LampControlEndpoint::Name,true,boundary);assert(result.status==400);
 result=lampControlRequest(LampControlEndpoint::Name,true,"name=");assert(result.status==400);
 result=lampControlRequest(LampControlEndpoint::State,false,"name=unused");assert(result.status==400);
 result=lampControlRequest(LampControlEndpoint::OfflineJoin,true,"id=aabbccddeeff");assert(result.status==404&&!lampServer.controlActive());
 // Reentrant execution cannot replace the outer trusted URI/argument context.
 lampServer.setControlRead(LampControlEndpoint::Sync,[]{assert(lampServer.controlActive()&&lampServer.uri()=="/api/sync");const auto nested=lampServer.executeControl(LampControlEndpoint::Name,true,"name=Nested");assert(nested.status==409&&lampServer.uri()=="/api/sync");lampServer.send(200,"text/plain","Outer context kept");});
 result=lampControlRequest(LampControlEndpoint::Sync,false,"");assert(result.status==200&&result.body=="Outer context kept"&&!lampServer.controlActive());
 // Explicit private invite can return the key; regular snapshots never do.
 result=lampControlRequest(LampControlEndpoint::SyncInvite,true,"");assert(result.status==200&&result.body.find(config.key)!=String::npos);
 auto snapshot=lampControlSnapshotJson();assert(snapshot.find(lampToken)==String::npos&&snapshot.find("\"token\"")==String::npos);
 assert(snapshot.find(lampSettings.adminPassword)==String::npos&&snapshot.find(lampSettings.wifiPassword)==String::npos&&snapshot.find(config.key)==String::npos&&snapshot.find("CL1-")==String::npos);
 assert(snapshot.find("\"ssid\":\"Saved network\"")!=String::npos&&snapshot.find("\"transport\":\"esp-now\"")!=String::npos&&snapshot.find("\"sceneCount\":32")!=String::npos);
 assert(snapshot.length()<8192);if(argc>1){std::ofstream file(argv[1]);file<<snapshot;}
 result=lampControlRequest(LampControlEndpoint::Effects,false,"");assert(result.status==200&&result.body.find("\"id\":47")!=String::npos);
 if(argc>2){std::ofstream file(argv[2]);file<<result.body;}
 result=lampControlRequest(LampControlEndpoint::Effects,true,"");assert(result.status==404);
 lampServer.httpAuthorized=false;lampServer.headers["X-Lamp-Token"]=lampToken;lampServer.arguments={{"name","HTTP survives"},{"control","true"}};
 lampServer.invokeHttp("/api/name",HTTP_POST);assert(lampServer.responseStatus==401&&lampName!="HTTP survives");
 lampServer.httpAuthorized=true;lampServer.invokeHttp("/api/name",HTTP_POST);assert(lampServer.responseStatus==200&&lampName=="HTTP survives");
 lampServer.invokeHttp("/api/state",HTTP_GET);assert(lampServer.responseStatus==200&&lampServer.responseBody.find(lampToken)!=String::npos&&!lampServer.controlActive());
 std::cout<<"PASS: real HTTP/BLE handlers preserve auth, URI/update/follower guards, strict forms, NVS failures, hardware-only credentials, private snapshot and context cleanup; snapshot bytes="<<snapshot.length()<<"\n";
}
'''
        fixture = setup + effect_names + quote_json + sync_json + definitions + '\nvoid registerRoutes(){\n' + routes + '\n}\n' + main
        with tempfile.TemporaryDirectory(prefix='lamp-control-http-') as directory:
            directory = pathlib.Path(directory)
            cpp, binary, snapshot, catalog = directory/'test.cpp', directory/'test', directory/'snapshot.json', directory/'catalog.json'
            cpp.write_text(fixture)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-misleading-indentation',
                            '-I'+str(ROOT/'tests/control-stubs'), '-I'+str(ROOT), *SANITIZERS,
                            str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary), str(snapshot), str(catalog)], check=True)
            value = json.loads(snapshot.read_text())
            self.assertEqual(value['deviceId'], 'aabbccddeeff')
            self.assertEqual(value['controlVersion'], 1)
            self.assertEqual(value['startupMode'], 4)
            self.assertEqual(value['startupBrightness'], 88)
            self.assertEqual(len(value['effects']), 47)
            self.assertEqual(len(value['colors']), 47)
            self.assertEqual(len(value['effectOptions']), 47)
            self.assertEqual(len(value['sync']['peers']), 8)
            self.assertEqual(len(value['sync']['order']), 9)
            self.assertEqual(value['sync']['transport'], 'esp-now')
            self.assertEqual(value['sync']['radio']['security'], 'aes-gcm-128')
            self.assertNotIn('token', value)
            self.assertNotIn('key', value['sync'])
            self.assertNotIn('wifiPassword', value)
            self.assertNotIn('adminPassword', value)
            entries = json.loads(catalog.read_text())
            self.assertEqual(len(entries), 47)
            self.assertEqual([entry['id'] for entry in entries], list(range(1,48)))
            self.assertEqual(entries[-1]['name'], 'Rainbow Embers')
            self.assertEqual(entries[-1]['category'], 'audio')


if __name__ == '__main__':
    unittest.main()
