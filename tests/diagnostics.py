"""Compile and exercise the actual read-only HTTP diagnostic handler."""
import json
import pathlib
import subprocess
import tempfile
import unittest

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
class String: public std::string {
public:
 using std::string::string;
 String(const std::string& s):std::string(s){}
 template<class T,typename std::enable_if<std::is_integral<T>::value,int>::type=0>
 String(T n):std::string(std::to_string(n)){}
};
struct Server {
 int calls=0;String body;
 void send(int code,const char*,const String& s){assert(code==200);calls++;body=s;}
} lampServer;
bool allowed=false;
bool authorizedLampRequest(bool mutation){assert(!mutation);return allowed;}
String jsonText(const String& s){return "\""+s+"\"";}
String lampIdentity(){return "test-lamp";}
String lampHost="coollamp-test";
unsigned millis(){return 5000;}
int esp_reset_reason(){return 1;}
struct {
 unsigned getFreeHeap(){return 50000;}
 unsigned getMinFreeHeap(){return 40000;}
 unsigned getMaxAllocHeap(){return 30000;}
} ESP;
struct IP {String value="192.168.1.222";String toString(){return value;}};
constexpr int WL_CONNECTED=3;
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
String lampUpdateJson(){return R"({"version":"1.7.3"})";}
String lampAudioJson(){return R"({"errors":0})";}
String lampSyncJson(){return R"({"role":0})";}
'''
        main = '''
int main(){
 sendLampDiagnostics();assert(lampServer.calls==0);
 auto usb=lampDiagnosticsJson();assert(lampServer.calls==0);
 allowed=true;sendLampDiagnostics();assert(lampServer.calls==1);
 assert(usb==lampServer.body);
 std::cout<<lampServer.body;
}
'''
        with tempfile.TemporaryDirectory(prefix='lamp-diagnostics-') as directory:
            cpp, binary = pathlib.Path(directory)/'test.cpp', pathlib.Path(directory)/'test'
            cpp.write_text(stub + handler + main)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', str(cpp), '-o', str(binary)], check=True)
            data = json.loads(subprocess.check_output([str(binary)], text=True))
        self.assertEqual(data['diagnosticsVersion'], 1)
        self.assertEqual(data['wifi']['rssi'], -62)
        self.assertEqual(data['wifi']['subnet'], '255.255.255.0')
        self.assertEqual(data['wifi']['gateway'], '192.168.1.1')
        self.assertEqual(data['scan']['count'], 8)
        self.assertEqual(data['render']['leds'], 134)
        self.assertEqual(data['audio']['errors'], 0)
        for key in ('token', 'ssid', 'adminPassword', 'wifiPassword', 'key'):
            self.assertNotIn('"'+key+'"', json.dumps(data))


if __name__ == '__main__':
    unittest.main()
