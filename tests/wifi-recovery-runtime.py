"""Execute the production offline Wi-Fi adapter with the real recovery policy."""
from pathlib import Path
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]


class WifiRecoveryRuntime(unittest.TestCase):
    def test_real_adapter(self):
        source = (ROOT / 'LampNetwork.ino').read_text()
        start = source.index('bool serviceLampOfflineWifi(')
        adapter = source[start:source.index('\n}\n', start) + 2]
        stub = r'''
#include "LampWifiRecoveryPolicy.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
constexpr int WL_CONNECTED=3,ESP_OK=0;
struct wifi_ap_record_t {};
bool associated=false,setupAP=false,scanActive=false,wifiBusy=false,updateBusy=false,resetBusy=false,pairingBusy=false,paused=false;
uint8_t role=1;
struct Settings {char ssid[33]="SavedSSID";char password[64]="unchanged";uint8_t powerProfile=34;} lampSettings;
struct FakeWiFi {
 bool automatic=true,reconnectWorks=true;
 int state=0,mode=1,power=34;
 unsigned disconnects=0,reconnects=0,autoChanges=0;
 int status(){return state;}
 bool getAutoReconnect(){return automatic;}
 void setAutoReconnect(bool value){automatic=value;++autoChanges;}
 bool disconnect(bool off,bool erase){assert(!off&&!erase&&!associated);++disconnects;return true;}
 bool reconnect(){++reconnects;return reconnectWorks;}
} WiFi;
int esp_wifi_sta_get_ap_info(wifi_ap_record_t*){return associated?ESP_OK:-1;}
uint8_t lampSyncRole(){return role;}
bool lampSyncPaused(){return paused;}
bool lampWifiSetupBusy(){return wifiBusy;}
bool lampUpdateOwnsResources(){return updateBusy;}
bool lampFactoryResetPending(){return resetBusy;}
bool lampPairingOpen(){return pairingBusy;}
'''
        main = r'''
bool tick(uint32_t now){
 const Settings before=lampSettings;
 const bool result=serviceLampOfflineWifi(now);
 assert(!memcmp(&before,&lampSettings,sizeof(before)));assert(WiFi.mode==1&&WiFi.power==34);
 return result;
}
int main(int argc,char** argv){
 assert(argc==2);const std::string scenario=argv[1];
 if(scenario=="bounded"){
  assert(!tick(100)&&!WiFi.automatic&&WiFi.disconnects==1);
  assert(!tick(60099)&&WiFi.reconnects==0);
  assert(tick(60100)&&WiFi.reconnects==1);
  assert(tick(62099)&&WiFi.disconnects==1);
  assert(!tick(62100)&&WiFi.disconnects==2);
  assert(!tick(122099));assert(tick(122100)&&WiFi.reconnects==2);
  associated=true;assert(!tick(122101)&&WiFi.automatic&&WiFi.disconnects==2&&WiFi.reconnects==2);
  assert(!tick(123000)&&WiFi.disconnects==2);
 }else if(scenario=="release"){
  assert(!tick(100)&&WiFi.disconnects==1);role=0;
  assert(!tick(101)&&WiFi.automatic&&WiFi.reconnects==1); // setter alone cannot reconnect after manual ASSOC_LEAVE
  assert(!tick(102)&&WiFi.reconnects==1);
  role=2;assert(!tick(103)&&!WiFi.automatic&&WiFi.disconnects==2);
  paused=true;assert(!tick(104)&&WiFi.automatic&&WiFi.reconnects==2);
  role=1;paused=false;assert(!tick(105)&&WiFi.disconnects==3);
  lampSettings.ssid[0]=0;assert(!tick(106)&&WiFi.automatic&&WiFi.reconnects==2);
 }else if(scenario=="busy"){
  bool* owners[]={&setupAP,&scanActive,&wifiBusy,&updateBusy,&resetBusy,&pairingBusy};
  for(unsigned i=0;i<6;++i){*owners[i]=true;assert(!tick(100+i));*owners[i]=false;assert(WiFi.disconnects==0&&WiFi.reconnects==0&&WiFi.automatic);}
  assert(!tick(200)&&WiFi.disconnects==1);assert(tick(60200)&&WiFi.reconnects==1);
  updateBusy=true;assert(!tick(60201));assert(!tick(63000));assert(WiFi.disconnects==1&&WiFi.reconnects==1);
  associated=true;assert(!tick(63001)&&WiFi.disconnects==1);updateBusy=false;
  assert(!tick(63002)&&WiFi.automatic&&WiFi.reconnects==1&&WiFi.disconnects==1);
 }else if(scenario=="dhcp"){
  associated=true;assert(!tick(100)&&WiFi.disconnects==0&&WiFi.reconnects==0); // STA association is enough before DHCP
  associated=false;assert(!tick(101)&&WiFi.disconnects==1);
  WiFi.reconnectWorks=false;assert(!tick(60101)&&WiFi.reconnects==1);
  assert(!tick(120100));WiFi.reconnectWorks=true;assert(tick(120101)&&WiFi.reconnects==2);
  associated=true;assert(!tick(120102)&&WiFi.automatic&&WiFi.disconnects==1&&WiFi.reconnects==2);
  associated=false;WiFi.state=WL_CONNECTED;assert(!tick(120103)&&WiFi.disconnects==1);
 }else if(scenario=="independent"){
  role=0;assert(!tick(100)&&WiFi.disconnects==0&&WiFi.reconnects==0);
  role=2;paused=true;assert(!tick(101)&&WiFi.disconnects==0);
  role=1;paused=false;lampSettings.ssid[0]=0;assert(!tick(102)&&WiFi.disconnects==0&&WiFi.reconnects==0);
 }else if(scenario=="rollover"){
  assert(!tick(0xfffffff0U)&&WiFi.disconnects==1);
  assert(!tick(59983));assert(tick(59984)&&WiFi.reconnects==1);
  assert(tick(61983));assert(!tick(61984)&&WiFi.disconnects==2);
 }else assert(false);
 std::cout<<"PASS: production recovery adapter "<<scenario<<"\n";
}
'''
        with tempfile.TemporaryDirectory(prefix='coollamp-wifi-recovery-') as directory:
            directory = Path(directory)
            cpp, executable = directory / 'test.cpp', directory / 'test.exe'
            cpp.write_text(stub + '\n' + adapter + '\n' + main)
            subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS,
                            '-I' + str(ROOT), str(cpp), '-o', str(executable)], check=True)
            for scenario in ['bounded', 'release', 'busy', 'dhcp', 'independent', 'rollover']:
                subprocess.run([str(executable), scenario], check=True)


if __name__ == '__main__':
    unittest.main()
