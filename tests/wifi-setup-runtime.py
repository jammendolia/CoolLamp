"""Exercise the actual provisioning engine with simulated Wi-Fi and NVS."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class WifiSetupTests(unittest.TestCase):
    def test_transactions_and_recovery(self):
        arduino = r'''
#pragma once
#include <cstdint>
#include <cstring>
#include <string>
#include <type_traits>
struct String : std::string {
 using std::string::string;
 String(const std::string& s):std::string(s){}
 template<class T,typename std::enable_if<std::is_integral<T>::value,int>::type=0>
 String(T n):std::string(std::to_string(n)){}
 bool isEmpty()const{return empty();}
};
inline struct { uint64_t getEfuseMac(){return 0x24eae26e9e9cULL;} } ESP;
template<class T,typename std::enable_if<std::is_integral<T>::value,int>::type=0>
String operator+(const String& s,T n){return String(std::string(s)+std::to_string(n));}
inline size_t strlcpy(char* dst,const char* src,size_t n){size_t len=strlen(src);if(n){size_t c=len<n-1?len:n-1;memcpy(dst,src,c);dst[c]=0;}return len;}
'''
        stubs = r'''
#include <cassert>
#include <iostream>
#include <functional>
#include "LampConfig.h"
#include "LampFactory.h"
#include "LampVersion.h"
#include "LampWifiSetup.h"
#include "Preferences.h"
uint32_t clockMs=0;uint32_t millis(){return clockMs;}
constexpr int WIFI_OFF=0,WIFI_STA=1,WIFI_AP_STA=3,WL_CONNECTED=3;
using arduino_event_id_t=int;
struct arduino_event_info_t {struct {uint16_t reason=0;}wifi_sta_disconnected;};
constexpr int ARDUINO_EVENT_WIFI_STA_CONNECTED=1,ARDUINO_EVENT_WIFI_STA_GOT_IP=2,ARDUINO_EVENT_WIFI_STA_DISCONNECTED=3;
struct IPAddress {
 int octets[4];IPAddress(int a=0,int b=0,int c=0,int d=0):octets{a,b,c,d}{}
 bool operator!=(const IPAddress& o)const{return memcmp(octets,o.octets,sizeof(octets))!=0;}
 String toString()const{return std::to_string(octets[0])+"."+std::to_string(octets[1])+"."+std::to_string(octets[2])+"."+std::to_string(octets[3]);}
};
struct Wifi {
 int state=0,radioMode=0;String name,lastPassword;bool automatic=true;IPAddress address;
 std::function<void(arduino_event_id_t,arduino_event_info_t)> callback;
 void onEvent(std::function<void(arduino_event_id_t,arduino_event_info_t)> fn){callback=fn;}
 int status(){return state;}String SSID(){return name;}IPAddress localIP(){return address;}
 void mode(int n){radioMode=n;}void setAutoReconnect(bool b){automatic=b;}
 void disconnect(bool,bool){state=0;address={};}
 void softAPdisconnect(bool){radioMode=WIFI_STA;}
 void begin(const char* ssid,const char* pass){name=ssid;lastPassword=pass;}
 void scanDelete(){}
} WiFi;
LampSettings lampSettings;
bool setupAP=false,scanActive=false,updating=false;
bool otaActive=false;uint32_t apLastActivity=0;
void beginLampScan(){scanActive=true;}void esp_wifi_scan_stop(){}
bool lampIsUpdating(){return updating;}bool lampUpdateOwnsResources(){return updating;}
bool lampFactoryResetPending(){return false;}
String jsonText(const String& s){return String("\"")+s+"\"";}
String lampHost="coollamp-e2ea24";
'''
        main = r'''
uint8_t command(const uint8_t* frame,size_t size,uint32_t owner=7){String response;return lampWifiSetupCommand(frame,size,owner,response);}
void credentials(){
 uint8_t begin[]={1,1,16,4,8,0};assert(command(begin,sizeof(begin))==0);
 uint8_t chunk[]={1,2,17,0,'H','o','m','e','p','a','s','s','w','o','r','d'};
 assert(command(chunk,sizeof(chunk))==0);
}
int main(){
 beginLampWifiSetupDiagnostics();
 lampSettings={};lampSettings.version=1;lampSettings.ledCount=205;lampSettings.milliAmps=500;
 lampSettings.brightness=100;lampSettings.startupMode=4;
 strcpy(lampSettings.adminPassword,"coollamp");strcpy(lampSettings.ssid,"Previous");
 strcpy(lampSettings.wifiPassword,"previous-password");
 uint8_t commit[]={1,3,18,0},scan[]={1,1,14,1},cancel[]={1,1,14,2};
 // An expired setup hotspot must not disable a first-time BLE Wi-Fi join.
 lampSettings.ssid[0]=0;setupAP=true;clockMs=600001;
 credentials();assert(command(commit,sizeof(commit))==0);expireHotspot();
 assert(setupAP&&WiFi.radioMode==WIFI_AP_STA);
 assert(command(cancel,sizeof(cancel))==0);expireHotspot();assert(!setupAP&&WiFi.radioMode==WIFI_OFF);
 setupAP=true;assert(command(scan,sizeof(scan))==0);expireHotspot();assert(setupAP);
 assert(command(cancel,sizeof(cancel))==0);scanActive=true;expireHotspot();assert(setupAP);
 scanActive=false;expireHotspot();assert(!setupAP);clockMs=0;
 strcpy(lampSettings.ssid,"Previous");
 assert(command(commit,sizeof(commit))==2);
 credentials();assert(command(commit,sizeof(commit),99)==2);
 credentials();assert(command(commit,sizeof(commit))==0);
 assert(lampWifiSetupBusy());assert(Preferences::storage["settings"].empty());
 assert(WiFi.automatic); // Transient authentication retries stay within the setup deadline.
 assert(!strcmp(lampSettings.ssid,"Previous"));
 WiFi.callback(ARDUINO_EVENT_WIFI_STA_CONNECTED,{});WiFi.callback(ARDUINO_EVENT_WIFI_STA_GOT_IP,{});
 WiFi.state=WL_CONNECTED;WiFi.address={192,168,1,123};serviceLampWifiSetup();
 assert(LampWifiSetup::phase==LampWifiSetup::CONNECTED);
 assert(lampSettings.ledCount==205&&lampSettings.milliAmps==500);
 assert(!strcmp(lampSettings.ssid,"Home")&&!strcmp(lampSettings.adminPassword,"coollamp"));
 assert(Preferences::storage["settings"].size()==sizeof(LampSettings));
 assert(LampWifiSetup::candidatePassword[0]==0&&LampWifiSetup::transfer.ssidSize==0);
 assert(lampWifiSetupJson().find("password")==String::npos);
 credentials();assert(command(commit,sizeof(commit))==0);
 arduino_event_info_t reason;reason.wifi_sta_disconnected.reason=202;WiFi.callback(ARDUINO_EVENT_WIFI_STA_DISCONNECTED,reason);
 clockMs+=35000;serviceLampWifiSetup();assert(LampWifiSetup::error==2);
 assert(LampWifiSetup::disconnectReason==202&&LampWifiSetup::lastJoinError==2);
 assert(command(cancel,sizeof(cancel))==0&&LampWifiSetup::disconnectReason==202&&LampWifiSetup::lastJoinError==2);
 assert(lampWifiSetupJson().find("\"join\":[2,202,0,0]")!=String::npos);
 assert(!strcmp(lampSettings.ssid,"Home")&&WiFi.name=="Home");
 credentials();assert(command(commit,sizeof(commit))==0);
 Preferences::failWrites=true;WiFi.state=WL_CONNECTED;WiFi.address={192,168,1,123};
 serviceLampWifiSetup();assert(LampWifiSetup::error==3);Preferences::failWrites=false;
 assert(!strcmp(lampSettings.ssid,"Home"));
 credentials();assert(command(commit,sizeof(commit))==0);assert(command(cancel,sizeof(cancel))==0);
 assert(!lampWifiSetupBusy()&&LampWifiSetup::candidatePassword[0]==0);
 assert(command(scan,sizeof(scan))==0&&lampWifiSetupBusy());
 captureLampWifiSetupNetwork(0,"Home",-40,false);captureLampWifiSetupNetwork(1,"Guest",-80,true);
 scanActive=false;finishLampWifiSetupScan(true);assert(LampWifiSetup::count==2);
 uint8_t network[]={1,1,15,1};String response;
 assert(lampWifiSetupCommand(network,sizeof(network),7,response)==0&&response.find("Guest")!=String::npos);
 network[3]=2;assert(command(network,sizeof(network))==2);
 updating=true;assert(command(scan,sizeof(scan))==3);updating=false;
 credentials();clockMs+=20000;serviceLampWifiSetup();assert(command(commit,sizeof(commit))==2);
 uint8_t begin[]={1,1,16,1,8,0};WifiSetupWire::Credentials transfer;
 assert(transfer.begin(begin,sizeof(begin),1,0));
 uint8_t bad[]={1,1,17,1,'A'};assert(!transfer.append(bad,sizeof(bad),1,1)&&transfer.ssidSize==0);
 begin[3]=32;begin[4]=63;assert(transfer.begin(begin,sizeof(begin),2,UINT32_MAX-10));
 uint8_t maxChunk[20]={1,1,17,0};memset(maxChunk+4,'x',16);
 for(unsigned offset=0;offset<95;offset+=16){maxChunk[3]=offset;assert(transfer.append(maxChunk,4+(95-offset<16?95-offset:16),2,10));}
 assert(transfer.complete(2,11));transfer.clear();for(auto b:transfer.bytes)assert(b==0);
 std::cout<<"PASS: successful/failed/cancelled joins, settings preservation, scan paging, ownership, timeout and 95-byte credentials\n";
}
'''
        engine = (ROOT / 'LampWifiSetup.ino').read_text().replace('#include "LampWifiSetup.h"', '')
        network = (ROOT / 'LampNetwork.ino').read_text()
        expiry = network[network.index('  if (setupAP && !otaActive && !lampWifiSetupBusy()'):network.index('  const bool connected = WiFi.status()', network.index('void serviceLampNetwork()'))]
        with tempfile.TemporaryDirectory(prefix='coollamp-wifi-setup-') as directory:
            directory = pathlib.Path(directory)
            (directory / 'Arduino.h').write_text(arduino)
            source, binary = directory / 'test.cpp', directory / 'test'
            source.write_text(stubs + engine + '\nvoid expireHotspot(){const uint32_t now=millis();\n' + expiry + '}\n' + main)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            '-fsanitize=address,undefined', '-I'+str(directory), '-I'+str(ROOT),
                            '-I'+str(ROOT/'tests/stubs'), str(source), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
