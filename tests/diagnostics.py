"""Compile and exercise the actual read-only HTTP diagnostic handler."""
import json
import pathlib
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = pathlib.Path(__file__).resolve().parents[1]


class HandlerTests(unittest.TestCase):
    def test_authentication_and_json(self):
        source = (ROOT / 'LampNetwork.ino').read_text()
        handler = source[source.index('String lampDiagnosticsJson()'):source.index('void sendLampState()')]
        stub = r'''
#include <string>
#include <type_traits>
#include <iostream>
#include <cassert>
#include "LampHttpJson.h"
class String: public std::string {
public:
 using std::string::string;
 String(const std::string& s):std::string(s){}
 template<class T,typename std::enable_if<std::is_integral<T>::value,int>::type=0>
 String(T n):std::string(std::to_string(n)){}
 bool isEmpty()const{return empty();}
 inline static bool failReserve=false;
 inline static unsigned initialReservations=0,reserveFailures=0;
 bool reserve(size_t size){assert(size==6144&&empty());++initialReservations;if(failReserve){++reserveFailures;return false;}std::string::reserve(size);return true;}
};
struct Server {
 int calls=0,code=0;String body;
 unsigned closeTaskStackMinimumBytes(){return 1024;}
 void send(int result,const char*,const String& s){code=result;calls++;body=s;}
} lampServer;
bool allowed=false;
bool authorizedLampRequest(bool mutation){assert(!mutation);return allowed;}
String jsonText(const String& s){return "\""+s+"\"";}
String lampIdentity(){return "test-lamp";}
String lampHost="coollamp-test";
unsigned millis(){return 5000;}
int esp_reset_reason(){return 1;}
unsigned uxTaskGetStackHighWaterMark(void*){return 2048;}
struct {
 unsigned getFreeHeap(){return 50000;}
 unsigned getMinFreeHeap(){return 40000;}
 unsigned getMaxAllocHeap(){return 30000;}
} ESP;
struct IP {String value="192.168.1.222";String toString(){return value;}};
constexpr int WL_CONNECTED=3;
enum wifi_ps_type_t {WIFI_PS_NONE=0,WIFI_PS_MIN_MODEM=1};
constexpr int ESP_OK=0;
int esp_wifi_get_ps(wifi_ps_type_t* mode){*mode=WIFI_PS_NONE;return ESP_OK;}
struct {
 int status(){return 3;} IP localIP(){return {};}
 int RSSI(){return -62;} int channel(){return 6;}
 String BSSIDstr(){return "aa:bb:cc:dd:ee:ff";}
 IP subnetMask(){return {"255.255.255.0"};}IP gatewayIP(){return {"192.168.1.1"};}
 int softAPgetStationNum(){return 0;}
} WiFi;
bool setupAP=false,scanActive=false,PowerOn=true;
unsigned scanStartedAt=0,scanDuration=4813,scanPolls=2;
unsigned lampRenderedFrames=100,lampMaxRenderUs=12000,Mode=46,Brightness=100,NUM_LEDS=134,lampMidpoint=0;
int scanCount=8;
bool omitFirmware=false,omitTiming=false;
unsigned statusBuilders=0;
String lampRuntimeTimingJson(){++statusBuilders;return omitTiming?R"({"version":1})":R"({"version":1,"animationGapTargetUs":100000,"maxAnimationFrameGapUs":17000,"windows":{},"http":{}})";}
String lampUpdateJson(){++statusBuilders;return omitFirmware?"{}":R"({"version":"1.7.3","phase":0,"automatic":false,"bootHealthy":true})";}
String lampAudioJson(){++statusBuilders;return R"({"errors":0})";}
String lampSyncJson(){++statusBuilders;return R"({"role":0})";}
bool appendLampSyncJson(String& out){out+=lampSyncJson();return true;}
String lampStyleJson(){return R"({"version":1,"code":3,"id":"corkscrew","family":"corkscrew"})";}
String lampTemperatureJson(){return R"({"supported":true,"valid":true,"celsius":42.5,"peakCelsius":43.0,"sampleAgeMs":250,"error":null})";}
'''
        main = '''
int main(){
 sendLampDiagnostics();assert(lampServer.calls==0);
 auto usb=lampDiagnosticsJson();assert(lampServer.calls==0);
 allowed=true;sendLampDiagnostics();assert(lampServer.calls==1);
 assert(lampServer.code==200);
 assert(usb==lampServer.body);
 std::cout<<lampServer.body;
 assert(String::initialReservations==2&&statusBuilders==8);
 String::failReserve=true;const auto buildersBeforeFailure=statusBuilders;
 assert(lampDiagnosticsJson().isEmpty());sendLampDiagnostics();
 assert(lampServer.code==503&&String::reserveFailures==2&&statusBuilders==buildersBeforeFailure);
 String::failReserve=false;sendLampDiagnostics();assert(lampServer.code==200&&lampServer.body==usb);
 omitFirmware=true;assert(lampDiagnosticsJson().isEmpty());sendLampDiagnostics();assert(lampServer.code==503);
 omitFirmware=false;omitTiming=true;assert(lampDiagnosticsJson().isEmpty());sendLampDiagnostics();assert(lampServer.code==503);
}
'''
        with tempfile.TemporaryDirectory(prefix='lamp-diagnostics-') as directory:
            cpp, binary = pathlib.Path(directory)/'test.cpp', pathlib.Path(directory)/'test'
            cpp.write_text(stub + handler + main)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS, '-I'+str(ROOT), str(cpp), '-o', str(binary)], check=True)
            data = json.loads(subprocess.check_output([str(binary)], text=True))
        self.assertEqual(data['diagnosticsVersion'], 1)
        self.assertEqual(data['wifi']['rssi'], -62)
        self.assertEqual(data['wifi']['powerSave'], 0)
        self.assertEqual(data['wifi']['subnet'], '255.255.255.0')
        self.assertEqual(data['wifi']['gateway'], '192.168.1.1')
        self.assertEqual(data['scan']['count'], 8)
        self.assertEqual(data['render']['leds'], 134)
        self.assertEqual(data['audio']['errors'], 0)
        self.assertEqual(data['lampStyle'], {'version': 1, 'code': 3, 'id': 'corkscrew', 'family': 'corkscrew'})
        self.assertEqual(data['chipTemperature'], {
            'supported': True, 'valid': True, 'celsius': 42.5,
            'peakCelsius': 43.0, 'sampleAgeMs': 250, 'error': None})
        for key in ('token', 'ssid', 'adminPassword', 'wifiPassword', 'key'):
            self.assertNotIn('"'+key+'"', json.dumps(data))


if __name__ == '__main__':
    unittest.main()
