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
        audio_source = (ROOT/'LampAudio.cpp').read_text()
        audio_settings = '\n'.join(function(audio_source, signature) for signature in [
            'bool lampHasMicrophone()', 'bool saveLampMicrophoneInstalled(', 'bool saveLampAudioConfiguration('])
        # Hardware/numeric snapshots are mocked; current serializer logic is real.
        update_source = (ROOT/'LampUpdate.cpp').read_text()
        current_status = '\n'.join(function(update_source, signature) for signature in [
            'String versionText(', 'String lampUpdatePolicyJson()', 'String lampUpdateJson()'])
        current_status += '\n' + function(audio_source, 'String lampAudioJson()')
        current_status += '\n' + function((ROOT/'UpdateHttp.cpp').read_text(), 'String updateHttpDiagnostics()')
        attempt_json = function((ROOT/'LampUpdateAttempt.cpp').read_text(), 'String statusJson(const FirmwareManifest& image)')
        sync_json = function(sync_source, 'String lampSyncJson(')
        quote_json = function(sync_source, 'String quote(')
        routes = '\n'.join(registration(source, route) for route in ['/api/sync', '/api/sync/scene', '/api/sync/invite', '/api/name', '/api/style'])
        routes += '\n' + registration(source, '/api/effects', 'GET')
        setup = r'''
#include <cassert>
#include <cstring>
#include <fstream>
#include <iostream>
#include <atomic>
#include "LampControlHttpAdapter.h"
#include "LampConfig.h"
#include "LampFactory.h"
#include "LampGeometry.h"
#include "LampStyle.h"
#include "LampAudio.h"
#include "LampUpdate.h"
#include "LampSyncProtocol.h"
#include "Preferences.h"
LampControlHttpAdapter lampServer(80);
LampSettings lampSettings;
String lampToken="http-session-token-private",lampHost="coollamp-test",lampName="Test lamp";
uint32_t apLastActivity=0,restartAt=0,fakeMillis=1000;uint32_t millis(){return fakeMillis;}
bool following=false,ownsUpdate=false,remoteBusy=false,wifiSetupBusy=false,otaActive=false,mdnsStarted=false,colorsSaved=true;
bool lampSyncFollowing(){return following;}bool lampUpdateOwnsResources(){return ownsUpdate;}
bool lampRemoteUpdateBusy(){return remoteBusy;}bool lampWifiSetupBusy(){return wifiSetupBusy;}
bool lampRolloutPinsMembership(){return false;}
String lampSyncIncarnation(){return "fefefefefefefefefefefefefefefefe";}
bool resetPending=false;bool lampFactoryResetPending(){return resetPending;}
bool lampIsUpdating(){return ownsUpdate;}bool saveLampColors(){return colorsSaved;}
bool installed=true;uint8_t gain=17;uint16_t gate=23,scale=250;
uint16_t NUM_LEDS=205,lampMidpoint=102;uint8_t Mode=4,Brightness=55;bool PowerOn=true;
constexpr uint8_t MODE_FIRE=4,LAMP_PROTOCOL_VERSION=1,LAMP_BASE_EFFECT_COUNT=38;
uint8_t lampAvailableEffectCount(){return 47;}
struct Color {uint8_t enabled=1,r=70,g=220,b=255;};
Color getLampColor(uint8_t){return {1,255,255,255};}
struct Options {uint8_t speed=60,intensity=85,dual=1,r=255,g=65,b=170;};
Options getLampEffectOptions(uint8_t){return {100,100,1,255,255,255};}
struct RGB {uint8_t r=70,g=220,b=255;};
RGB fountainPaletteColor(unsigned){return {255,255,255};}RGB renderVuColor(unsigned){return {255,255,255};}
bool lampCalibrationActive(){return false;}bool lampCalibrationCenter(){return false;}unsigned lampCalibrationPosition(){return NUM_LEDS-1;}
struct {bool enabled=true,random=false;uint8_t category=0;uint32_t seconds=30;} lampRotation;
bool worstStatus=false;
uint32_t lampRenderedFrames=UINT32_MAX,lampMaxRenderUs=UINT32_MAX;
LampAudioFeatures getLampAudioFeatures(){LampAudioFeatures f{};f.sequence=f.timestamp=f.errors=f.overruns=UINT32_MAX;f.stackFree=6144;f.rms=f.peak=f.effectiveGain=f.noiseFloor=f.effectiveGate=f.bass=f.mid=f.treble=UINT16_MAX;f.beat=f.bassBeat=UINT32_MAX;f.level=255;f.error=INT32_MIN;return f;}
LampUpdateStatus getLampUpdateStatus(){LampUpdateStatus s{};s.phase=UPDATE_ERROR;s.progress=100;s.error=UPDATE_MEMORY;s.latest[0]=s.latest[1]=s.latest[2]=UINT16_MAX;s.route=UPDATE_ROUTE_MANUAL_UPLOAD;s.checkedAt=UINT32_MAX;s.writtenOffset=s.totalBytes=2031616;return s;}
FirmwareManifest candidate{};unsigned mux=0;
void* worker=reinterpret_cast<void*>(1);bool healthy=false;
constexpr int MALLOC_CAP_8BIT=1;
unsigned heap_caps_get_largest_free_block(int){return 327680;}
unsigned uxTaskGetStackHighWaterMark(void*){return 6144;}
namespace UpdatePublisher {bool enforced(){return false;}}
bool policyNeedsReconcile=false,policyReadable=false;
bool reconcileUncertainPolicy(){return false;}
LampUpdatePolicy::Policy updatePolicy;
uint32_t policyRevision=UINT32_MAX;
LampUpdatePolicy::Eligibility policyEligibility(){return LampUpdatePolicy::InvalidPolicy;}
uint8_t lampRolloutAutomaticAdmissionReason(){return 4;}
String lampUpdatePolicyJson();String updateHttpDiagnostics();
std::atomic<int> httpStage{INT32_MIN},httpCode{INT32_MIN},httpHost{INT32_MIN},tlsError{INT32_MIN},tlsFlags{INT32_MIN},transportError{INT32_MIN};
namespace LampUpdateAttempt {constexpr unsigned Capacity=4;unsigned mux=0;bool readable=false;uint8_t count=4;int find(const FirmwareManifest&){return 0;}
ATTEMPT_JSON
}
constexpr int WL_CONNECTED=3;
struct Address {String toString(){return worstStatus?"192.168.255.254":"0.0.0.0";}};
struct {int status(){return 0;}Address localIP(){return {};}Address gatewayIP(){return {};}Address dnsIP(int){return {};}} WiFi;
struct {void addServiceTxt(const char*,const char*,const char*,const String&) {}} MDNS;
using namespace LampSyncWire;
struct {uint8_t role=1;char leader[13]="aabbccddeeff",key[33]="0123456789abcdef0123456789abcdef";} config;
struct Peer {Packet info{};bool joined=false;uint32_t seen=1000,subscribed=1000;bool udpKnown=false,radioKnown=true;uint32_t udpSeen=1000,radioSeen=1000;Address ip;uint8_t radioChannel=6;} peers[31];
struct {uint8_t count=9;char order[32][13]{};} sceneConfig;
char identity[13]="aabbccddeeff";
bool paused=false,followingRadio=true,started=false,serviceBlocked=false;
uint8_t wireVersion=LegacyVersion;
uint64_t nonce=0x123456789abcdef0ULL;
bool slotSaved=false;struct {char leader[13]{};} followerSlot;
uint32_t slotSaveFailures=0,incompatibleSubscriptions=0;
uint32_t receivedPackets=20,discoveries=8,authFailures=0,subscriptionsSent=8,framesReceived=20,clockDrops=0;
namespace LampEspNow {
struct Status {bool active=true,suspended=false,seeking=false;uint8_t channel=14;uint32_t received=UINT32_MAX,receiveDropped=UINT32_MAX,sent=UINT32_MAX,sendFailed=UINT32_MAX,sendDropped=UINT32_MAX,channelChanges=UINT32_MAX;};
Status status(){return {};}
}
Visual lampGroupVisual(){Visual visual{};visual.scene=32;visual.count=sceneConfig.count;visual.sceneSpeed=100;visual.sceneIntensity=100;memset(visual.scenePrimary,255,3);memset(visual.sceneSecondary,255,3);return visual;}
unsigned syncMutations=0,sceneMutations=0,pauseMutations=0,resumeMutations=0;
bool configureLampSync(uint8_t role,const String&,const String&,uint8_t protocol=2,const String& expected=""){if(expected.length()&&expected!=lampSyncIncarnation())return false;++syncMutations;return role<=2&&supportedVersion(protocol);}
bool configureLampScene(uint8_t,uint8_t,uint8_t,const uint8_t*,const uint8_t*){++sceneMutations;return config.role==1;}
void pauseLampSync(){++pauseMutations;}void resumeLampSync(){++resumeMutations;}
bool configureLampSyncPause(bool pause){if(pause)++pauseMutations;else ++resumeMutations;return true;}
String lampSyncInvite(){return String("CL1-")+config.leader+"-"+config.key;}
String lampSyncJson(uint8_t peerCursor=0,uint8_t peerLimit=8);
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
 beginLampStyle();assert(lampStyleCode()==0);
 // Classification is authenticated metadata, even for a current follower.
 const auto hardwareBefore=Preferences::storage.at("settings");
 lampServer.arguments={{"style","3"}};lampServer.headers={{"X-Lamp-Token",lampToken}};lampServer.httpAuthorized=false;
 lampServer.invokeHttp("/api/style",HTTP_POST);assert(lampServer.responseStatus==401&&lampStyleCode()==0);
 lampServer.httpAuthorized=true;lampServer.headers["X-Lamp-Token"]="bad";
 lampServer.invokeHttp("/api/style",HTTP_POST);assert(lampServer.responseStatus==403&&lampStyleCode()==0);
 following=true;auto styleResult=lampControlRequest(LampControlEndpoint::Style,true,"style=3");
 assert(styleResult.status==200&&lampStyleCode()==3&&!restartAt&&Preferences::storage.at("settings")==hardwareBefore&&Mode==4&&Brightness==55&&PowerOn);
 following=false;
 for(const char* body:{"","style=-1","style=4","style=1x","style=3&style=1"})assert(lampControlRequest(LampControlEndpoint::Style,true,body).status==400);
 Preferences::failWrites=true;assert(lampControlRequest(LampControlEndpoint::Style,true,"style=1").status==500&&lampStyleCode()==3);Preferences::failWrites=false;
 resetPending=true;assert(lampControlRequest(LampControlEndpoint::Style,true,"style=1").status==409&&lampStyleCode()==3);resetPending=false;
 wifiSetupBusy=true;assert(lampControlRequest(LampControlEndpoint::Style,true,"style=1").status==409&&lampStyleCode()==3);wifiSetupBusy=false;
 otaActive=true;assert(lampControlRequest(LampControlEndpoint::Style,true,"style=1").status==409&&lampStyleCode()==3);otaActive=false;
 ownsUpdate=true;assert(lampControlRequest(LampControlEndpoint::Style,true,"style=1").status==409&&lampStyleCode()==3);ownsUpdate=false;
 beginLampStyle();assert(lampStyleCode()==3);
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
 // Optional hardware microphone configuration uses the actual production
 // settings helper. Its saved change applies only at reboot, retaining tuning.
 assert(Preferences::storage.count("audioV2")==0);
 assert(saveLampMicrophoneInstalled(true));const auto originalAudio=Preferences::storage.at("audioV2");
 const auto originalHardware=Preferences::storage.at("settings");
 const auto microphoneCalls=Preferences::audioWrites;
 result=lampControlRequest(LampControlEndpoint::Config,true,hardware);
 assert(result.status==200&&Preferences::audioWrites==microphoneCalls&&Preferences::storage.at("audioV2")==originalAudio);
 restartAt=0;const auto validationWrites=Preferences::writes;
 for(const char* value:{"","-1","2","1x","true"}){
  result=lampControlRequest(LampControlEndpoint::Config,true,hardware+"&microphoneInstalled="+value);
  assert(result.status==400&&Preferences::writes==validationWrites&&!restartAt&&lampHasMicrophone());
 }
 Preferences::failKey="audioV2";
 result=lampControlRequest(LampControlEndpoint::Config,true,hardware+"&microphoneInstalled=0");
 assert(result.status==500&&Preferences::storage.at("audioV2")==originalAudio&&!restartAt);
 Preferences::failKey="";
 result=lampControlRequest(LampControlEndpoint::Config,true,hardware+"&microphoneInstalled=0");
 assert(result.status==200&&restartAt==2200&&lampHasMicrophone());
 const auto disabledAudio=Preferences::storage.at("audioV2");assert(disabledAudio.size()==7&&disabledAudio[0]==2&&disabledAudio[1]==0);
 for(unsigned i=2;i<7;++i)assert(disabledAudio[i]==originalAudio[i]);
 assert(lampSettings.ledCount==134&&Mode==4&&Brightness==55&&PowerOn);
 auto microphoneSettings=stored();assert(!strcmp(microphoneSettings.ssid,"Saved network")&&!strcmp(microphoneSettings.wifiPassword,"wifi-password-private")&&!strcmp(microphoneSettings.adminPassword,"admin-password-private"));
 Preferences::storage["audioV2"]=originalAudio;Preferences::storage["settings"]=originalHardware;restartAt=0;
 // The second durable write fails: the actual handler restores the previous
 // microphone state and never schedules reboot or changes runtime hardware.
 Preferences::failKey="settings";
 result=lampControlRequest(LampControlEndpoint::Config,true,hardware+"&microphoneInstalled=0");
 assert(result.status==500&&result.body.find("Nothing changed")!=String::npos&&Preferences::storage.at("audioV2")==originalAudio&&Preferences::storage.at("settings")==originalHardware&&!restartAt);
 // A failed rollback must report a real partial outcome, not 'nothing changed'.
 Preferences::audioWrites=0;Preferences::failAudioAfter=1;
 result=lampControlRequest(LampControlEndpoint::Config,true,hardware+"&microphoneInstalled=0");
 assert(result.status==500&&result.body.find("rollback was not confirmed")!=String::npos&&Preferences::storage.at("audioV2")[1]==0&&Preferences::storage.at("settings")==originalHardware&&!restartAt&&lampHasMicrophone());
 Preferences::failKey="";Preferences::failAudioAfter=0;Preferences::storage["audioV2"]=originalAudio;
 colorsSaved=false;
 result=lampControlRequest(LampControlEndpoint::Config,true,"leds=300&milliamps=900&brightness=99&mode=8&microphoneInstalled=0");
 assert(result.status==500&&result.body.find("Settings saved")!=String::npos&&stored().ledCount==300&&Preferences::storage.at("audioV2")[1]==0&&!restartAt);
 colorsSaved=true;Preferences::storage["audioV2"]=originalAudio;Preferences::storage["settings"]=originalHardware;
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
 const auto beforeFence=syncMutations;
 result=lampControlRequest(LampControlEndpoint::Group,true,"role=0&expectedIncarnation=00000000000000000000000000000000");assert(result.status==409&&syncMutations==beforeFence);
 for(const char* fence:{"","aa","FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"}){result=lampControlRequest(LampControlEndpoint::Group,true,String("role=0&expectedIncarnation=")+fence);assert(result.status==400&&syncMutations==beforeFence);}
 result=lampControlRequest(LampControlEndpoint::Group,true,String("role=0&expectedIncarnation=")+lampSyncIncarnation());assert(result.status==200&&syncMutations==beforeFence+1);
 lampServer.arguments={{"role","0"},{"expectedIncarnation","00000000000000000000000000000000"}};lampServer.invokeHttp("/api/sync",HTTP_POST);assert(lampServer.responseStatus==409&&syncMutations==beforeFence+1);
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
 String fields="name=TwentyFour";for(unsigned i=0;i<23;++i)fields+=String("&field")+String(i)+"=";
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
 // Probe the complete production serializer through real HTTP; the private
 // adapter's 8 KiB guard remains unmodified and is separately checked below.
 lampServer.httpAuthorized=true;lampServer.invokeHttp("/api/state",HTTP_GET);
 auto snapshot=lampServer.responseBody;
 const size_t tokenStart=snapshot.find(",\"token\":");const size_t tokenEnd=snapshot.find(",\"name\":",tokenStart);
 assert(tokenStart!=String::npos&&tokenEnd!=String::npos);snapshot.erase(tokenStart,tokenEnd-tokenStart);
 assert(snapshot.find(lampToken)==String::npos&&snapshot.find("\"token\"")==String::npos);
 assert(snapshot.find(lampSettings.adminPassword)==String::npos&&snapshot.find(lampSettings.wifiPassword)==String::npos&&snapshot.find(config.key)==String::npos&&snapshot.find("CL1-")==String::npos);
 assert(snapshot.find("\"ssid\":\"Saved network\"")!=String::npos&&snapshot.find("\"transport\":\"esp-now\"")!=String::npos&&snapshot.find("\"sceneCount\":32")!=String::npos);
 if(argc>1){std::ofstream file(argv[1]);file<<snapshot;}
 // Full production state, 32 durable order positions and worst escaped names:
 // a bounded state hint and eight hints per dedicated page fit real BLE,
 // that omits colors/options/effects or silently truncates member identities.
 wireVersion=3;sceneConfig.count=32;worstStatus=true;started=true;
 NUM_LEDS=1024;lampMidpoint=1023;Mode=47;Brightness=255;PowerOn=false;
 lampSettings.startupMode=47;lampSettings.brightness=255;lampSettings.milliAmps=UINT16_MAX;
 lampName=std::string(48,'"');lampHost="coollamp-aabbccddeeff";
 memset(lampSettings.ssid,1,32);lampSettings.ssid[32]=0;
 updatePolicy.startMinute=1438;updatePolicy.endMinute=1439;updatePolicy.idleSeconds=86400;
 strcpy(updatePolicy.timezone,"ABCDEFGHIJKLMNOP14:59QRSTUVWX-14:59,M12.5.6/23:59,M12.5.6/23:59");
 assert(strlen(updatePolicy.timezone)==63&&LampUpdatePolicy::validTimezone(updatePolicy.timezone));
 gain=64;gate=1024;scale=400;lampRotation.seconds=UINT32_MAX;
 receivedPackets=discoveries=authFailures=subscriptionsSent=framesReceived=clockDrops=UINT32_MAX;
 slotSaveFailures=incompatibleSubscriptions=UINT32_MAX;
 for(unsigned i=0;i<31;++i){auto& peer=peers[i];snprintf(peer.info.sender,13,"%012x",i+1);peer.info.role=2;peer.info.version=3;peer.info.microphone=1;memset(peer.info.name,'"',48);peer.info.name[48]=0;peer.joined=true;strcpy(sceneConfig.order[i+1],peer.info.sender);}
 fakeMillis=UINT32_MAX;
 for(auto& peer:peers){peer.udpKnown=true;peer.radioChannel=14;peer.info.microphone=0;peer.joined=false;peer.seen=peer.subscribed=peer.udpSeen=peer.radioSeen=fakeMillis;}
 lampServer.httpAuthorized=true;lampServer.invokeHttp("/api/state",HTTP_GET);
 const auto completeHttpSnapshot=lampServer.responseBody;
 const size_t privateOverhead=String(",\"token\":\"").length()+lampToken.length()+1;
 std::cout<<"MEASURE complete production HTTP state bytes="<<completeHttpSnapshot.length()<<" private equivalent="<<completeHttpSnapshot.length()-privateOverhead<<" firmware="<<lampUpdateJson().length()<<" audio="<<lampAudioJson().length()<<" stateSync="<<lampSyncJson(0,1).length()<<" dedicatedSync="<<lampSyncJson().length()<<std::endl;
 assert(completeHttpSnapshot.length()<=8192);
 if(argc>4){std::ofstream file(argv[4]);file<<completeHttpSnapshot;}
 const auto expandedSnapshot=lampControlSnapshotJson();assert(expandedSnapshot.length()>2&&expandedSnapshot.length()<8192);
 assert(expandedSnapshot.find("\"peerTotal\":31")!=String::npos&&expandedSnapshot.find("\"peerNext\":1")!=String::npos);
 const String dedicatedFirst=lampSyncJson();assert(dedicatedFirst.find("\"peerNext\":8")!=String::npos);
 // Continue from the state's next cursor through the production dedicated
 // serializer. Each hint must appear once across its bounded pages.
 String continuation="[";uint8_t cursor=1;bool first=true;
 while(cursor){const auto page=lampSyncJson(cursor);assert(page.length()<8192);if(!first)continuation+=',';first=false;continuation+=page;cursor=cursor+8<31?cursor+8:0;}
 continuation+=']';if(argc>5){std::ofstream file(argv[5]);file<<continuation;}
 if(argc>3){std::ofstream file(argv[3]);file<<expandedSnapshot;}
 result=lampControlRequest(LampControlEndpoint::Effects,false,"");assert(result.status==200&&result.body.find("\"id\":47")!=String::npos);
 if(argc>2){std::ofstream file(argv[2]);file<<result.body;}
 result=lampControlRequest(LampControlEndpoint::Effects,true,"");assert(result.status==404);
 lampServer.httpAuthorized=false;lampServer.headers["X-Lamp-Token"]=lampToken;lampServer.arguments={{"name","HTTP survives"},{"control","true"}};
 lampServer.invokeHttp("/api/name",HTTP_POST);assert(lampServer.responseStatus==401&&lampName!="HTTP survives");
 lampServer.httpAuthorized=true;lampServer.invokeHttp("/api/name",HTTP_POST);assert(lampServer.responseStatus==200&&lampName=="HTTP survives");
 lampServer.invokeHttp("/api/state",HTTP_GET);assert(lampServer.responseStatus==200&&lampServer.responseBody.find(lampToken)!=String::npos&&!lampServer.controlActive());
 std::cout<<"PASS: real HTTP/BLE handlers preserve auth, URI/update/follower guards, strict forms, NVS failures, hardware-only credentials, private snapshot and context cleanup; snapshot bytes="<<snapshot.length()<<" expanded worst-name bytes="<<expandedSnapshot.length()<<"\n";
}
'''
        setup = setup.replace('ATTEMPT_JSON', attempt_json)
        setup = setup.replace('namespace LampUpdateAttempt {', '#define portENTER_CRITICAL(value) ((void)(value))\n#define portEXIT_CRITICAL(value) ((void)(value))\nnamespace LampUpdateAttempt {')
        fixture = setup + current_status + audio_settings + effect_names + quote_json + sync_json + definitions + '\nvoid registerRoutes(){\n' + routes + '\n}\n' + main
        with tempfile.TemporaryDirectory(prefix='lamp-control-http-') as directory:
            directory = pathlib.Path(directory)
            cpp, binary, snapshot, catalog, expanded, continuation = directory/'test.cpp', directory/'test', directory/'snapshot.json', directory/'catalog.json', directory/'expanded.json', directory/'continuation.json'
            # Keep failure injection test-local: real production handlers and
            # audio helpers still call the typed Preferences API unchanged.
            preferences = (ROOT/'tests/control-stubs/Preferences.h').read_text()
            preferences = preferences.replace('inline static unsigned writes=0;',
                'inline static unsigned writes=0,audioWrites=0,failAudioAfter=0;\n  inline static String failKey="";')
            preferences = preferences.replace('if(failWrites)return 0;',
                'if(failWrites||failKey==key)return 0;')
            preferences = preferences.replace('const auto* bytes=static_cast<const uint8_t*>(data);',
                'if(!strcmp(key,"audioV2")&&++audioWrites&&failAudioAfter&&audioWrites>failAudioAfter)return 0;\n    const auto* bytes=static_cast<const uint8_t*>(data);')
            (directory/'Preferences.h').write_text(preferences)
            arduino = (ROOT/'tests/control-stubs/Arduino.h').read_text().replace('uint64_t getEfuseMac()', 'uint32_t getFreeHeap(){return 327680;}uint64_t getEfuseMac()')
            # Arduino String concatenates integer types as decimal numbers.
            arduino += '\ntemplate<class T,typename std::enable_if<std::is_integral<T>::value&&!std::is_same<T,char>::value,int>::type=0> String operator+(const std::string& value,T number){return String(value+std::to_string(number));}\n'
            (directory/'Arduino.h').write_text(arduino)
            (directory/'WebServer.h').write_text((ROOT/'tests/control-stubs/WebServer.h').read_text())
            # Put the local directory before the shared stub directory for both
            # this translation unit and the actual LampStyle implementation.
            cpp.write_text(fixture)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-misleading-indentation',
                            '-I'+str(directory), '-I'+str(ROOT/'tests/control-stubs'), '-I'+str(ROOT), *SANITIZERS,
                            '-DARDUINO=1',str(cpp),str(ROOT/'LampStyle.cpp'),str(ROOT/'LampUpdatePolicy.cpp'), '-o', str(binary)], check=True)
            subprocess.run([str(binary), str(snapshot), str(catalog), str(expanded),str(ROOT/'.build/experience-complete-state.json'),str(continuation)], check=True)
            value = json.loads(snapshot.read_text())
            self.assertEqual(value['deviceId'], 'aabbccddeeff')
            self.assertEqual(value['controlVersion'], 1)
            self.assertEqual(value['lampStyle'], {'version': 1, 'code': 3, 'id': 'corkscrew', 'family': 'corkscrew'})
            self.assertEqual(value['startupMode'], 4)
            self.assertEqual(value['startupBrightness'], 88)
            self.assertEqual(len(value['effects']), 47)
            self.assertEqual(len(value['colors']), 47)
            self.assertEqual(len(value['effectOptions']), 47)
            self.assertEqual(len(value['sync']['peers']), 1)
            self.assertEqual(value['sync']['peerNext'], 1)
            self.assertEqual(len(value['sync']['order']), 9)
            self.assertEqual(value['sync']['transport'], 'esp-now')
            self.assertEqual(value['sync']['radio']['security'], 'aes-gcm-128')
            self.assertNotIn('token', value)
            self.assertNotIn('key', value['sync'])
            self.assertNotIn('wifiPassword', value)
            self.assertNotIn('adminPassword', value)
            expanded_value = json.loads(expanded.read_text())
            self.assertEqual(len(expanded_value['sync']['order']), 32)
            self.assertEqual(len(expanded_value['sync']['peers']), 1)
            self.assertEqual(expanded_value['sync']['peerNext'], 1)
            self.assertEqual(expanded_value['sync']['maxMembers'], 32)
            self.assertEqual(expanded_value['sync']['peerTotal'], 31)
            pages = json.loads(continuation.read_text())
            self.assertEqual([page['peerCursor'] for page in pages], [1, 9, 17, 25])
            self.assertEqual([len(page['peers']) for page in pages], [8, 8, 8, 6])
            self.assertEqual([page['peerNext'] for page in pages], [9, 17, 25, 0])
            peer_ids = [peer['id'] for peer in expanded_value['sync']['peers']]
            for page in pages:
                self.assertEqual(page['peerTotal'], 31)
                self.assertEqual(len(page['order']), 32)
                peer_ids.extend(peer['id'] for peer in page['peers'])
            self.assertEqual(peer_ids, [format(i, '012x') for i in range(1, 32)])
            self.assertEqual(len(expanded_value['firmware']['policy']['timezone']), 63)
            self.assertIn('attemptGuard', expanded_value['firmware'])
            self.assertEqual(expanded_value['audio']['maxRenderUs'], 0xffffffff)
            (ROOT/'.build/experience-state-budget.json').write_text(json.dumps({
                'sourceBackedSerializers': ['sendLampState', 'lampSyncJson', 'lampUpdateJson', 'lampAudioJson',
                                          'lampUpdatePolicyJson', 'LampUpdateAttempt::statusJson', 'updateHttpDiagnostics'],
                'controlResponseLimit': 8192, 'directHttpStateBytes': len((ROOT/'.build/experience-complete-state.json').read_bytes()),
                'privateStateBytes': len(expanded.read_bytes()), 'baselinePrivateStateBytes': len(snapshot.read_bytes()),
                'statePeerHintLimit': 1, 'dedicatedPeerPageLimit': 8, 'durableOrderPositions': 32,
                'colors': 47, 'effectOptions': 47, 'escapedPeerNameBytes': 48, 'timezoneBytes': 63,
                'continuationCursors': [page['peerCursor'] for page in pages],
                'continuationCounts': [len(page['peers']) for page in pages], 'allPeerIdsOnce': True,
                'hardwareTouched': False,
            }, indent=2))
            entries = json.loads(catalog.read_text())
            self.assertEqual(len(entries), 47)
            self.assertEqual([entry['id'] for entry in entries], list(range(1,48)))
            self.assertEqual(entries[-1]['name'], 'Rainbow Embers')
            self.assertEqual(entries[-1]['category'], 'audio')


if __name__ == '__main__':
    unittest.main()
