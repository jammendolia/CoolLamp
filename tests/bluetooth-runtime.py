"""Compile the real Bluetooth connection/security callbacks and pairing cue."""
import pathlib
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = pathlib.Path(__file__).resolve().parents[1]


class BluetoothTests(unittest.TestCase):
    def test_ota_callbacks_only_copy_from_live_encrypted_bonded_peer(self):
        source = (ROOT/'LampBluetooth.cpp').read_text()
        helper = source[source.index('bool authorizeEncryptedPeer'):source.index('class Connections final')]
        callbacks = source[source.index('class OtaWrites final'):source.index('OtaWrites otaWriteCallbacks;')]
        characteristic_setup = source[source.index('  auto* otaWrite='):source.index('  otaStatusCharacteristic=')]
        stub = r'''
#include <atomic>
#include <cstdint>
#include <cstring>
#include <string>
#include <cassert>
#include "LampBleUpdateWire.h"
using String=std::string;
struct ble_gap_conn_desc {uint16_t conn_handle=1;struct {bool encrypted=true,bonded=true;}sec_state;};
struct BLECharacteristicCallbacks;
struct BLECharacteristic {
 static constexpr unsigned PROPERTY_WRITE=1,PROPERTY_WRITE_NR=2,PROPERTY_WRITE_ENC=4;
 String value;unsigned properties=0;BLECharacteristicCallbacks* callbacks=nullptr;
 String getValue(){return value;}void setValue(const uint8_t* p,size_t n){value.assign(reinterpret_cast<const char*>(p),n);}
 void setCallbacks(BLECharacteristicCallbacks* value){callbacks=value;}
};
struct BLEService {BLECharacteristic ota;BLECharacteristic* createCharacteristic(const char*,unsigned properties){ota.properties=properties;return &ota;}};
constexpr char OTA_WRITE[]="receiver";
struct BLECharacteristicCallbacks {virtual void onWrite(BLECharacteristic*,ble_gap_conn_desc*){};virtual void onRead(BLECharacteristic*,ble_gap_conn_desc*){};};
std::atomic<uint16_t> connection{1};std::atomic<uint32_t> generation{7};
std::atomic<bool> secure{false},knownPeer{true},pairing{false},disconnectRequested{false};
struct {unsigned disconnects=0;void disconnect(uint16_t){++disconnects;}} instance;
auto* server=&instance;
unsigned copied=0;bool room=true;
LampBleUpdateWire::Queue queue;
bool enqueueLampBleUpdate(const uint8_t* p,size_t size,uint32_t owner){
 assert(owner==7);if(!room||!LampBleUpdateWire::valid(p,size))return false;
 LampBleUpdateWire::Frame frame;frame.generation=owner;frame.length=size;memcpy(frame.bytes,p,size);
 if(!queue.push(frame))return false;
 ++copied;return true;
}
'''
        main = r'''
int main(){
 OtaReads reads;BLECharacteristicCallbacks& read=reads;
 BLEService service;initializeOtaWrite(&service);
 assert(service.ota.properties==(BLECharacteristic::PROPERTY_WRITE|BLECharacteristic::PROPERTY_WRITE_NR|BLECharacteristic::PROPERTY_WRITE_ENC));
 BLECharacteristic& characteristic=service.ota;BLECharacteristicCallbacks& write=*characteristic.callbacks;ble_gap_conn_desc peer;
 uint8_t frame[8]={1,2,11,0,0,0,1,0};characteristic.setValue(frame,8);write.onWrite(&characteristic,&peer);assert(copied==1&&secure);
 peer.sec_state.bonded=false;write.onWrite(&characteristic,&peer);assert(copied==1);peer.sec_state.bonded=true;
 peer.sec_state.encrypted=false;write.onWrite(&characteristic,&peer);assert(copied==1);peer.sec_state.encrypted=true;
 peer.conn_handle=2;write.onWrite(&characteristic,&peer);assert(copied==1);peer.conn_handle=1;
 write.onWrite(&characteristic,nullptr);assert(copied==1);
 secure=false;knownPeer=false;write.onWrite(&characteristic,&peer);assert(copied==1);knownPeer=true;
 LampBleUpdateWire::Frame saved;assert(queue.pop(saved)&&saved.generation==7&&saved.length==8&&!memcmp(saved.bytes,frame,8));assert(!queue.pop(saved));
 // WRITE and WRITE_NR enter the same real callback. Four native command
 // payloads are copied before the characteristic backing storage is changed.
 uint8_t data[20]={1,LampBleUpdateWire::Data,11,0,0,0,1,0};
 for(unsigned i=0;i<LampBleUpdateWire::DataWriteWithoutResponseWindow;++i){data[6]=i+2;data[12]=i+40;characteristic.setValue(data,sizeof(data));write.onWrite(&characteristic,&peer);}
 characteristic.value.assign(20,'x');assert(copied==5);
 for(unsigned i=0;i<LampBleUpdateWire::DataWriteWithoutResponseWindow;++i){assert(queue.pop(saved)&&saved.generation==7&&saved.length==20&&saved.bytes[6]==i+2&&saved.bytes[12]==i+40);}assert(!queue.pop(saved));
 characteristic.value="status";read.onRead(&characteristic,&peer);assert(characteristic.value=="status");
 peer.sec_state.bonded=false;read.onRead(&characteristic,&peer);assert(characteristic.value.size()==20&&characteristic.value[2]==LampBleUpdateWire::Denied);peer.sec_state.bonded=true;
 room=false;characteristic.setValue(frame,8);write.onWrite(&characteristic,&peer);assert(copied==5&&instance.disconnects==1&&disconnectRequested);
}
'''
        with tempfile.TemporaryDirectory(prefix='lamp-ble-ota-auth-') as folder:
            cpp, binary = pathlib.Path(folder)/'test.cpp', pathlib.Path(folder)/'test'
            cpp.write_text(stub+helper+callbacks+'\nOtaWrites otaWriteCallbacks;\nvoid initializeOtaWrite(BLEService* service){\n'+characteristic_setup+'}\n'+main)
            subprocess.run(['c++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,'-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True)
            subprocess.run([str(binary)],check=True)

    def test_encrypted_write_without_authentication_callback(self):
        source = (ROOT / 'LampBluetooth.cpp').read_text()
        helper = source[source.index('bool authorizeEncryptedPeer'):source.index('class Connections final')]
        callback = source[source.index('class Writes final'):source.index('Connections connectionCallbacks')]
        stub = r'''
#include <atomic>
#include <cstdint>
#include <cstring>
#include <string>
#include <cassert>
#include "WifiSetupWire.h"
#include "LampBleControlWire.h"
using String=std::string;
struct ble_gap_conn_desc {uint16_t conn_handle=1;struct {bool encrypted=true,bonded=true;}sec_state;};
struct BLECharacteristic {String value;String getValue(){return value;}void setValue(const uint8_t* p,size_t n){value.assign(reinterpret_cast<const char*>(p),n);}};
struct BLECharacteristicCallbacks {virtual void onWrite(BLECharacteristic*,ble_gap_conn_desc*){}};
std::atomic<uint16_t> connection{1};std::atomic<bool> secure{false},knownPeer{true},pairing{false},disconnectRequested{false};
std::atomic<uint32_t> writes{0},rejectedWrites{0},generation{7},lastWriteAt{0};
std::atomic<uint8_t> lastCommandId{0},lastOperation{0};
std::atomic<bool> rejectedSecure{false},rejectedSameConnection{false},rejectedEncrypted{false};
uint32_t millis(){return 100;}
struct {int disconnects=0;void disconnect(uint16_t){++disconnects;}} instance;
auto* server=&instance;
struct Command {uint32_t generation;uint8_t length;uint8_t bytes[20];};
void* commands=nullptr;constexpr int pdTRUE=1;int queued=0;Command received{};
LampBleControlWire::FrameQueue controlCommands;
int xQueueSend(void*,const Command* c,int){++queued;received=*c;return pdTRUE;}
'''
        main = r'''
int main(){
 Writes writes;BLECharacteristicCallbacks& callback=writes;BLECharacteristic characteristic;
 const uint8_t frame[]={1,1,12,3};characteristic.value.assign(reinterpret_cast<const char*>(frame),sizeof(frame));
 ble_gap_conn_desc peer;callback.onWrite(&characteristic,&peer);
 assert(secure&&queued==1&&rejectedWrites==0&&received.generation==7&&received.length==4);
 assert(lastCommandId==1&&lastOperation==12);
 secure=false;knownPeer=false;callback.onWrite(&characteristic,&peer);
 assert(queued==1&&rejectedWrites==1&&rejectedEncrypted&&rejectedSameConnection);
 knownPeer=true;peer.sec_state.encrypted=false;callback.onWrite(&characteristic,&peer);assert(queued==1&&rejectedWrites==2);
 peer.sec_state.encrypted=true;peer.conn_handle=2;callback.onWrite(&characteristic,&peer);assert(queued==1&&rejectedWrites==3&&!rejectedSameConnection);
 peer.conn_handle=1;knownPeer=false;pairing=true;callback.onWrite(&characteristic,&peer);assert(queued==2&&secure);
 characteristic.value.pop_back();callback.onWrite(&characteristic,&peer);assert(queued==2&&instance.disconnects==1);
 disconnectRequested=false;knownPeer=true;secure=false;
 const uint8_t rpc[]={1,9,22,1,0,7,2,3,0};characteristic.value.assign(reinterpret_cast<const char*>(rpc),sizeof(rpc));
 callback.onWrite(&characteristic,&peer);LampBleControlWire::Frame transfer;
 assert(controlCommands.pop(transfer)&&transfer.generation==7&&transfer.length==9&&transfer.bytes[2]==22&&queued==2);
 assert(characteristic.value.size()==sizeof(rpc));for(char byte:characteristic.value)assert(byte==0);
 peer.sec_state.bonded=false;characteristic.value.assign(reinterpret_cast<const char*>(rpc),sizeof(rpc));
 callback.onWrite(&characteristic,&peer);assert(!controlCommands.pop(transfer)&&queued==2);
 peer.sec_state.bonded=true;peer.sec_state.encrypted=false;
 callback.onWrite(&characteristic,&peer);assert(!controlCommands.pop(transfer)&&queued==2);
}
'''
        with tempfile.TemporaryDirectory(prefix='lamp-ble-write-') as directory:
            cpp, binary = pathlib.Path(directory)/'test.cpp', pathlib.Path(directory)/'test'
            cpp.write_text(stub + helper + callback + main)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-I'+str(ROOT),
                            *SANITIZERS, str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

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
bool authorizeEncryptedPeer(const ble_gap_conn_desc&){return true;}
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
                            *SANITIZERS, str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

    def test_enrollment_and_saved_phone_policy(self):
        source = (ROOT / 'LampBluetooth.cpp').read_text()
        helper = source[source.index('bool authorizeEncryptedPeer'):source.index('class Connections final')]
        callbacks = source[source.index('class Connections final'):source.index('class StateReads final')]
        cue = source[source.index('bool lampPairingCueActive()'):source.index('bool lampBluetoothReady()')]
        closing = source[source.index('  ble_gap_conn_desc peer{};'):source.index('  if (advertisingDirty.exchange(false))')]
        closing = closing[:closing.index('  serviceLampBleUpdate(')] + closing[closing.index('  if(authenticated) {'):]
        stub = r'''
#include <atomic>
#include <cstdint>
#include <cassert>
constexpr int CONFIG_BT_NIMBLE_MAX_BONDS=3;
struct ble_addr_t { int value=0; };
int ble_addr_cmp(const ble_addr_t* a,const ble_addr_t* b){return a->value-b->value;}
ble_addr_t refreshedPeers[CONFIG_BT_NIMBLE_MAX_BONDS]{};uint8_t refreshedPeerCount=0;
struct ble_gap_conn_desc {uint16_t conn_handle=1;ble_addr_t peer_id_addr;struct {bool encrypted=false,bonded=false;}sec_state;};
struct BLEServer {int disconnects=0;void disconnect(uint16_t){++disconnects;}} instance;
struct BLEServerCallbacks {virtual void onConnect(BLEServer*,ble_gap_conn_desc*){};virtual void onDisconnect(BLEServer*,ble_gap_conn_desc*){};};
struct BLESecurityCallbacks {virtual bool onSecurityRequest(){return false;}virtual uint32_t onPassKeyRequest(){return 0;}virtual void onPassKeyNotify(uint32_t){};virtual bool onConfirmPIN(uint32_t){return false;}virtual void onAuthenticationComplete(ble_gap_conn_desc*){};};
constexpr uint16_t NO_CONNECTION=0xffff;
std::atomic<uint16_t> connection{NO_CONNECTION};
std::atomic<uint32_t> generation{0},connects{0},authentications{0},serviceRefreshes{0};
std::atomic<bool> secure{false},knownPeer{false},pairing{false},advertisingDirty{false},lastEncrypted{false},lastBonded{false},lastAuthAccepted{false},disconnectRequested{false};
std::atomic<uint32_t> lastDisconnectAt{0},lastAuthAt{0};
std::atomic<uint8_t> extendedControls{0};
std::atomic<bool> controlPageReady{true};constexpr uint32_t currentGeneration=0;
bool serviceLampBleControlTransfer(uint32_t,bool,bool){return false;}
bool lampUpdateOwnsResources(){return false;}void cacheControlMetadata(){}
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
 actual.sec_state.encrypted=true;actual.sec_state.bonded=true;security.onAuthenticationComplete(&actual);assert(secure);closeEnrollment();
 cb.onDisconnect(server,&actual);
 // A bonded encrypted reconnect can omit the authentication callback entirely.
 cb.onConnect(server,&actual);assert(!secure);closeEnrollment();assert(secure&&authentications==3&&serviceRefreshes==2);
 ble_gap_conn_desc stale=actual;stale.conn_handle=99;assert(!authorizeEncryptedPeer(stale));
 pairing=true;disconnectRequested=true;secure=false;closeEnrollment();assert(pairing&&!secure);
 cb.onDisconnect(server,&actual);pairing=false;actual.peer_id_addr.value=0;cb.onConnect(server,&actual);
 assert(instance.disconnects==2&&!security.onSecurityRequest()&&!authorizeEncryptedPeer(actual));cb.onDisconnect(server,&actual);
 pairing=true;clockMs=120000;closeEnrollment();assert(!pairing&&!lampPairingCueActive());
 assert(connects==5&&authentications==3&&lastEncrypted&&lastBonded&&serviceRefreshes==2);
}
'''
        with tempfile.TemporaryDirectory(prefix='lamp-bluetooth-') as directory:
            cpp, binary = pathlib.Path(directory)/'test.cpp', pathlib.Path(directory)/'test'
            cpp.write_text(stub + helper + callbacks + cue + '\nvoid closeEnrollment(){\n' + closing + '}\n' + main)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

    def test_control_pages_are_bonded_and_generation_bound(self):
        source = (ROOT / 'LampBluetooth.cpp').read_text()
        helper = source[source.index('bool authorizeEncryptedPeer'):source.index('class Connections final')]
        callback = source[source.index('class ControlReads final'):source.index('ControlReads controlReadCallbacks')]
        stub = r'''
#include <atomic>
#include <cstdint>
#include <cstring>
#include <string>
#include <cassert>
#include "LampBleControlWire.h"
using String=std::string;
struct ble_gap_conn_desc {uint16_t conn_handle=1;struct {bool encrypted=true,bonded=true;}sec_state;};
struct BLECharacteristic {String value;void setValue(const uint8_t* p,size_t n){value.assign(reinterpret_cast<const char*>(p),n);}};
struct BLECharacteristicCallbacks {virtual void onRead(BLECharacteristic*,ble_gap_conn_desc*){}};
std::atomic<uint16_t> connection{1};std::atomic<bool> secure{false},knownPeer{true},pairing{false},disconnectRequested{false};
std::atomic<uint32_t> generation{7},controlPageGeneration{7};
std::atomic<uint16_t> controlPageTransaction{42};std::atomic<bool> controlPageReady{true};
'''
        main = r'''
int main(){
 ControlReads reads;BLECharacteristicCallbacks& callback=reads;BLECharacteristic characteristic;
 characteristic.value="private-invitation";ble_gap_conn_desc peer;callback.onRead(&characteristic,&peer);
 assert(characteristic.value=="private-invitation"&&secure);
 generation=8;callback.onRead(&characteristic,&peer);
 assert(characteristic.value.size()==12&&LampBleControlWire::u16(reinterpret_cast<const uint8_t*>(characteristic.value.data())+4)==403&&!controlPageReady);
 controlPageReady=true;controlPageGeneration=8;characteristic.value="private-invitation";peer.sec_state.bonded=false;
 callback.onRead(&characteristic,&peer);assert(characteristic.value.size()==12&&!controlPageReady);
 controlPageReady=true;peer.sec_state.bonded=true;peer.sec_state.encrypted=false;characteristic.value="private-invitation";
 callback.onRead(&characteristic,&peer);assert(characteristic.value.size()==12&&!controlPageReady);
 controlPageReady=true;peer.sec_state.encrypted=true;peer.conn_handle=2;characteristic.value="private-invitation";
 callback.onRead(&characteristic,&peer);assert(characteristic.value.size()==12&&!controlPageReady);
 controlPageReady=true;peer.conn_handle=1;controlPageTransaction=0;controlPageGeneration=0;characteristic.value="metadata";
 callback.onRead(&characteristic,&peer);assert(characteristic.value=="metadata");
}
'''
        with tempfile.TemporaryDirectory(prefix='lamp-ble-control-read-') as directory:
            cpp, binary = pathlib.Path(directory)/'test.cpp', pathlib.Path(directory)/'test'
            cpp.write_text(stub + helper + callback + main)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-I'+str(ROOT),
                            *SANITIZERS, str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
