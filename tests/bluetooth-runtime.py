"""Compile the real Bluetooth connection/security callbacks and pairing cue."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class BluetoothTests(unittest.TestCase):
    def test_state_read_preserves_binary_packet_and_legacy_catalog(self):
        source = (ROOT / 'LampBluetooth.cpp').read_text()
        callback = source[source.index('class StateReads final'):source.index('class Writes final')]
        stub = r'''
#include <atomic>
#include <cstdint>
#include <cstring>
#include <string>
#include <cassert>
using String=std::string;
struct ble_gap_conn_desc {};
struct BLECharacteristic {
 String value;size_t getLength(){return value.size();}String getValue(){return value;}
 void setValue(const uint8_t* p,size_t n){value.assign(reinterpret_cast<const char*>(p),n);}
};
struct BLECharacteristicCallbacks {
 enum Status {SUCCESS_NOTIFY=1};
 virtual void onRead(BLECharacteristic*,ble_gap_conn_desc*){}
 virtual void onStatus(BLECharacteristic*,Status,uint32_t){}
};
std::atomic<uint32_t> stateReads{0};std::atomic<uint16_t> lastReadLength{0};
std::atomic<uint8_t> extendedControls{0};std::atomic<int> lastNotifyStatus{-1},lastNotifyCode{0};
'''
        main = r'''
int main(){
 StateReads reads;BLECharacteristicCallbacks& callback=reads;BLECharacteristic characteristic;
 const uint8_t packet[16]={1,5,0,46,100,1,47,255,1,0,0,0,1,0,200,0};
 characteristic.setValue(packet,sizeof(packet));callback.onRead(&characteristic,nullptr);
 assert(characteristic.value.size()==16&&lastReadLength==16&&stateReads==1);
 assert(uint8_t(characteristic.value[3])==29&&uint8_t(characteristic.value[6])==29);
 assert(uint8_t(characteristic.value[1])==5&&uint8_t(characteristic.value[14])==200&&characteristic.value[15]==0);
 extendedControls=47;characteristic.setValue(packet,sizeof(packet));callback.onRead(&characteristic,nullptr);
 assert(uint8_t(characteristic.value[3])==46&&uint8_t(characteristic.value[6])==47);
 extendedControls=0;characteristic.setValue(packet,8);callback.onRead(&characteristic,nullptr);assert(characteristic.value.size()==8);
 callback.onStatus(&characteristic,BLECharacteristicCallbacks::SUCCESS_NOTIFY,0);assert(lastNotifyStatus==1&&lastNotifyCode==0);
}
'''
        with tempfile.TemporaryDirectory(prefix='lamp-ble-state-') as directory:
            cpp, binary = pathlib.Path(directory)/'test.cpp', pathlib.Path(directory)/'test'
            cpp.write_text(stub + callback + main)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            '-fsanitize=address,undefined', str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

    def test_enrollment_and_saved_phone_policy(self):
        source = (ROOT / 'LampBluetooth.cpp').read_text()
        callbacks = source[source.index('class Connections final'):source.index('class StateReads final')]
        cue = source[source.index('bool lampPairingCueActive()'):source.index('bool lampBluetoothReady()')]
        closing = source[source.index('  ble_gap_conn_desc peer{};'):source.index('  if (advertisingDirty.exchange(false))')]
        stub = r'''
#include <atomic>
#include <cstdint>
#include <cassert>
struct ble_addr_t { int value=0; };
struct ble_gap_conn_desc {uint16_t conn_handle=1;ble_addr_t peer_id_addr;struct {bool encrypted=false,bonded=false;}sec_state;};
struct BLEServer {int disconnects=0;void disconnect(uint16_t){++disconnects;}} instance;
struct BLEServerCallbacks {virtual void onConnect(BLEServer*,ble_gap_conn_desc*){};virtual void onDisconnect(BLEServer*,ble_gap_conn_desc*){};};
struct BLESecurityCallbacks {virtual bool onSecurityRequest(){return false;}virtual uint32_t onPassKeyRequest(){return 0;}virtual void onPassKeyNotify(uint32_t){};virtual bool onConfirmPIN(uint32_t){return false;}virtual void onAuthenticationComplete(ble_gap_conn_desc*){};};
constexpr uint16_t NO_CONNECTION=0xffff;
std::atomic<uint16_t> connection{NO_CONNECTION};
std::atomic<uint32_t> generation{0},connects{0},authentications{0},serviceRefreshes{0};
std::atomic<bool> secure{false},knownPeer{false},pairing{false},advertisingDirty{false},lastEncrypted{false},lastBonded{false};
std::atomic<uint8_t> extendedControls{0};
BLEServer* server=&instance;int deleted=0;uint32_t clockMs=0,pairingStarted=0;
uint32_t millis(){return clockMs;}
bool bonded(const ble_addr_t& peer){return peer.value==1;}
void ble_store_util_delete_peer(const ble_addr_t*){++deleted;}
void ble_svc_gatt_changed(uint16_t start,uint16_t end){assert(start==1&&end==0xffff);}
ble_gap_conn_desc actual;
int ble_gap_conn_find(uint16_t,ble_gap_conn_desc* p){*p=actual;return 0;}
'''
        main = r'''
int main(){
 Connections c;Security s;BLEServerCallbacks& cb=c;BLESecurityCallbacks& security=s;
 pairing=true;assert(lampPairingCueActive());
 cb.onConnect(server,&actual);assert(!lampPairingCueActive()&&pairing&&!secure);
 assert(security.onSecurityRequest());actual.sec_state.encrypted=true;actual.sec_state.bonded=true;
 security.onAuthenticationComplete(&actual);assert(secure);closeEnrollment();assert(!pairing);
 cb.onDisconnect(server,&actual);assert(!secure&&!lampPairingCueActive());
 pairing=true;actual.sec_state.encrypted=false;actual.sec_state.bonded=false;
 cb.onConnect(server,&actual);security.onAuthenticationComplete(&actual);
 assert(instance.disconnects==1&&deleted==1);cb.onDisconnect(server,&actual);assert(lampPairingCueActive());
 pairing=false;actual.peer_id_addr.value=1;cb.onConnect(server,&actual);
 assert(knownPeer&&security.onSecurityRequest()&&instance.disconnects==1);
 actual.sec_state.encrypted=true;actual.sec_state.bonded=true;security.onAuthenticationComplete(&actual);assert(secure);
 cb.onDisconnect(server,&actual);actual.peer_id_addr.value=0;cb.onConnect(server,&actual);
 assert(instance.disconnects==2&&!security.onSecurityRequest());cb.onDisconnect(server,&actual);
 pairing=true;clockMs=120000;closeEnrollment();assert(!pairing&&!lampPairingCueActive());
 assert(connects==4&&authentications==3&&lastEncrypted&&lastBonded&&serviceRefreshes==2);
}
'''
        with tempfile.TemporaryDirectory(prefix='lamp-bluetooth-') as directory:
            cpp, binary = pathlib.Path(directory)/'test.cpp', pathlib.Path(directory)/'test'
            cpp.write_text(stub + callbacks + cue + '\nvoid closeEnrollment(){\n' + closing + '}\n' + main)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
