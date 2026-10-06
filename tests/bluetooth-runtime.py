"""Compile the real Bluetooth connection/security callbacks and pairing cue."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class BluetoothTests(unittest.TestCase):
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
std::atomic<uint32_t> generation{0},connects{0},authentications{0};
std::atomic<bool> secure{false},knownPeer{false},pairing{false},advertisingDirty{false},lastEncrypted{false},lastBonded{false};
std::atomic<uint8_t> extendedControls{0};
BLEServer* server=&instance;int deleted=0;uint32_t clockMs=0,pairingStarted=0;
uint32_t millis(){return clockMs;}
bool bonded(const ble_addr_t& peer){return peer.value==1;}
void ble_store_util_delete_peer(const ble_addr_t*){++deleted;}
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
 assert(connects==4&&authentications==3&&lastEncrypted&&lastBonded);
}
'''
        with tempfile.TemporaryDirectory(prefix='lamp-bluetooth-') as directory:
            cpp, binary = pathlib.Path(directory)/'test.cpp', pathlib.Path(directory)/'test'
            cpp.write_text(stub + callbacks + cue + '\nvoid closeEnrollment(){\n' + closing + '}\n' + main)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
