"""Run the actual Bluetooth-update Wi-Fi handoff without altering real radios."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS
root = Path(__file__).resolve().parents[1]
source = (root/'LampNetwork.ino').read_text()
adapter = source[source.index('bool bluetoothUpdateWifiHeld='):source.index('void serviceLampNetwork()')]
stub = r'''
#include <cassert>
#include <cstring>
#include <string>
constexpr int WL_CONNECTED=3,ESP_OK=0;
bool associated=false,scanActive=false;
namespace LampCommission {bool working(){return false;}}
struct wifi_ap_record_t{};
int esp_wifi_sta_get_ap_info(wifi_ap_record_t*){return associated?0:-1;}
struct {char ssid[33]="saved-ssid",password[65]="saved-password";unsigned gpio=3,leds=134;}lampSettings;
struct {
 bool automatic=true;int state=0;unsigned disconnects=0,reconnects=0,changes=0;
 int status(){return state;}bool getAutoReconnect(){return automatic;}
 void setAutoReconnect(bool value){automatic=value;++changes;}
 bool disconnect(bool off,bool erase){assert(!off&&!erase&&!associated);++disconnects;return true;}
 bool reconnect(){++reconnects;return true;}
}WiFi;
'''
main = r'''
int main(int argc,char** argv){
 assert(argc==2);const std::string test=argv[1];const auto before=lampSettings;
 if(test=="scan"){scanActive=true;assert(!beginLampBluetoothUpdateRadio());assert(!WiFi.disconnects&&!WiFi.changes);return 0;}
 if(test=="associated"||test=="connected"){
  if(test=="associated")associated=true;else WiFi.state=WL_CONNECTED;
  assert(beginLampBluetoothUpdateRadio());finishLampBluetoothUpdateRadio(false);assert(!WiFi.changes&&!WiFi.disconnects&&!WiFi.reconnects);return 0;
 }
 if(test=="group-owned")WiFi.automatic=false;
 assert(beginLampBluetoothUpdateRadio()&&!WiFi.automatic&&WiFi.disconnects==1);
 assert(beginLampBluetoothUpdateRadio()&&WiFi.disconnects==1);
 if(test=="committed"){finishLampBluetoothUpdateRadio(true);assert(!WiFi.automatic&&bluetoothUpdateWifiHeld&&!WiFi.reconnects);}
 else{finishLampBluetoothUpdateRadio(false);assert(!bluetoothUpdateWifiHeld);assert(WiFi.automatic==(test!="group-owned"));assert(WiFi.reconnects==(test!="group-owned"?1U:0U));finishLampBluetoothUpdateRadio(false);assert(WiFi.disconnects==1);}
 assert(!memcmp(&before,&lampSettings,sizeof(before)));
}
'''
with tempfile.TemporaryDirectory(prefix='lamp-ble-update-radio-') as folder:
    cpp, binary = Path(folder)/'test.cpp', Path(folder)/'test.exe'
    cpp.write_text(stub+adapter+main)
    subprocess.run(['c++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,str(cpp),'-o',str(binary)],check=True)
    for scenario in ['scan','associated','connected','offline','group-owned','committed']:
        subprocess.run([str(binary),scenario],check=True)
    print('PASS: 6 production BLE update radio handoff scenarios; credentials/GPIO preserved')
