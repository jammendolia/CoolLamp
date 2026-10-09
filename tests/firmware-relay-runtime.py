"""Production relay + shared flash receiver, two simulated radios, real AES-GCM/SHA."""
import ast,hashlib,json,subprocess,tarfile,tempfile
from pathlib import Path
from host_compiler import SANITIZERS
ROOT=Path(__file__).resolve().parents[1]
tree=ast.parse((ROOT/'tests/espnow-runtime.py').read_text())
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='verified_source' or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('SOURCE','ARCHIVE_SHA','PRIMITIVES') for t in n.targets)]
scope=dict(Path=Path,hashlib=hashlib,json=json,tarfile=tarfile)
exec(compile(ast.Module(body=nodes,type_ignores=[]),'verified_source','exec'),scope)
source=scope['verified_source'](ROOT/'.build/tls-library')
ble_tree=ast.parse((ROOT/'tests/ble-update-runtime.py').read_text())
sdk_scope={}
exec(compile(ast.Module(body=[n for n in ble_tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('SDK','FORMAT') for t in n.targets)],type_ignores=[]),'sdk_stubs','exec'),sdk_scope)
arduino=(ROOT/'tests/sync-stubs/Arduino.h').read_text().replace('  using std::string::string;','  using std::string::string;\n  bool startsWith(const char* s)const{return rfind(s,0)==0;}').replace('inline uint32_t fakeNow=0;','using std::min;\ninline uint32_t fakeNow=40000;')
sdk=sdk_scope['SDK']+'\nconst esp_partition_t* esp_ota_get_running_partition();\nint esp_partition_read(const esp_partition_t*,size_t,void*,size_t);\nstruct esp_app_desc_t;\nint esp_ota_get_partition_description(const esp_partition_t*,esp_app_desc_t*);\n'
format_text=sdk_scope['FORMAT'].replace('uint8_t magic;uint8_t unused[11];','uint8_t magic,segment_count;uint8_t unused[10];').replace('uint8_t tail[10];','uint8_t tail[9],hash_appended;').replace('uint32_t address,length;','uint32_t address,data_len;')
fixture=r'''
#include <cassert>
#include <iostream>
#include <deque>
#include <vector>
#include "LampEspNow.h"
#include "LampBleUpdate.h"
#include "LampUpdate.h"
#include "LampFirmwareRelayCrypto.h"
#include "esp_ota_ops.h"
#include "esp_app_format.h"
#include "fixture.h"
bool commissionBusy=false;
namespace LampCommission {bool working(){return commissionBusy;}}
int side=0;bool automatic=true,reservations[2]{},verified=false,radioAvailable=true;
unsigned begins=0,writes=0,ends=0,boots=0;bool dropAck=false,dropData=false,dropFinish=false,corrupt=false;
bool ackDropped=false,dataDropped=false,finishDropped=false,corrupted=false;unsigned rejectedData=0;
esp_partition_t runningPartition,nextPartition;std::vector<uint8_t> installed(image,image+sizeof(image)),flash;
uint8_t addresses[2][6]={{0x24,0xec,0x4a,0xaf,0x94,0x58},{0x80,0xf1,0xb2,0x50,0xb9,0xac}};
struct Envelope{std::vector<uint8_t> data;uint8_t source[6],destination[6];};std::deque<Envelope> packets;
uint32_t esp_random(){static uint32_t x=17;x=x*1664525+1013904223;return x;}
int esp_read_mac(uint8_t* out,int){memcpy(out,addresses[side],6);return 0;}
const esp_partition_t* esp_ota_get_running_partition(){return &runningPartition;}
const esp_partition_t* esp_ota_get_next_update_partition(const void*){return &nextPartition;}
int esp_partition_read(const esp_partition_t*,size_t at,void* out,size_t n){if(at>installed.size()||n>installed.size()-at)return -1;memcpy(out,installed.data()+at,n);return 0;}
int esp_ota_get_partition_description(const esp_partition_t*,esp_app_desc_t* out){out->magic_word=ESP_APP_DESC_MAGIC_WORD;return 0;}
int esp_ota_begin(const esp_partition_t*,size_t,esp_ota_handle_t* handle){assert(reservations[side]);++begins;*handle=1;flash.clear();return 0;}
int esp_ota_write(esp_ota_handle_t,const void* p,size_t n){++writes;auto b=static_cast<const uint8_t*>(p);flash.insert(flash.end(),b,b+n);return 0;}
int esp_ota_abort(esp_ota_handle_t){return 0;}
int esp_ota_end(esp_ota_handle_t){++ends;return flash.size()==installed.size()?0:-1;}
int esp_ota_set_boot_partition(const esp_partition_t*){assert(flash==installed);++boots;return 0;}
bool lampUpdateOwnsResources(){return reservations[side];}
bool reserveLampManualUpdate(){if(reservations[side])return false;reservations[side]=true;return true;}
void releaseLampManualUpdate(){reservations[side]=false;}
bool beginLampBluetoothUpdateRadio(){return true;}
void finishLampBluetoothUpdateRadio(bool){}
bool beginLampBluetoothUpdate(){return reserveLampManualUpdate();}
void setLampBluetoothUpdateProgress(uint32_t n,uint32_t size){assert(n<=size);}
void finishLampBluetoothUpdate(bool okay,bool){reservations[side]=false;verified=okay;}
LampUpdateStatus getLampUpdateStatus(){LampUpdateStatus s{};s.automatic=side==1&&automatic;return s;}
namespace LampEspNow {
bool enqueue(const uint8_t* p,size_t n,const uint8_t* destination,bool){assert(n<=250);Envelope e;e.data.assign(p,p+n);memcpy(e.source,addresses[side],6);memcpy(e.destination,destination,6);packets.push_back(e);return true;}
Status status(){Status s;s.active=radioAvailable;s.channel=11;return s;}
void holdChannel(uint32_t){}
}
// Compile the actual sender and recipient state machines with separate state.
#define LampFirmwareRelay Donor
#include "LampFirmwareRelay.cpp"
#undef LampFirmwareRelay
#undef LAMP_FIRMWARE_VERSION
#undef LAMP_VERSION_MINOR
#define LAMP_FIRMWARE_VERSION "1.11.0"
#define LAMP_VERSION_MINOR 11
#define LampFirmwareRelay Recipient
#include "LampFirmwareRelay.cpp"
#undef LampFirmwareRelay
void deliver(){
 while(!packets.empty()){
  auto e=packets.front();packets.pop_front();side=e.source[0]==addresses[0][0]?1:0;
  LampEspNow::Received message;message.length=e.data.size();memcpy(message.data,e.data.data(),e.data.size());memcpy(message.source,e.source,6);message.channel=11;message.receivedAt=fakeNow;
  uint8_t plain[218];size_t n=0;
  const bool opened=LampFirmwareRelayCrypto::open(e.data.data(),e.data.size(),e.source,e.destination,fleetKey,plain,n);
  if(opened){
   if(plain[0]==LampFirmwareRelayWire::Data&&dropData&&!dataDropped){dataDropped=true;continue;}
   if(plain[0]==LampFirmwareRelayWire::Ack&&plain[13]==1&&dropAck&&!ackDropped&&LampFirmwareRelayWire::u32(plain+9)>0){ackDropped=true;continue;}
   if(plain[0]==LampFirmwareRelayWire::Ack&&plain[13]==2&&dropFinish&&!finishDropped){finishDropped=true;continue;}
   if(plain[0]==LampFirmwareRelayWire::Data&&corrupt&&LampFirmwareRelayWire::u32(plain+9)==402){corrupted=true;plain[13]^=0x40;assert(LampFirmwareRelayCrypto::seal(plain,n,e.source,e.destination,fleetKey,LampFirmwareRelayWire::u64(e.data.data()+4),LampFirmwareRelayWire::u32(e.data.data()+12),message.data));}
  }
  if(side==1)Recipient::receive(message);else Donor::receive(message);
 }
}
int main(int argc,char** argv){
 assert(argc==2);const std::string scenario=argv[1];side=0;Donor::begin();side=1;Recipient::begin();
 if(scenario=="crypto"){
  uint8_t p[51]{LampFirmwareRelayWire::Offer},sealed[250]{},decoded[218]{};size_t n=0;LampFirmwareRelayWire::put32(p+7,sizeof(image));LampFirmwareRelayWire::put64(p+43,123);
  assert(LampFirmwareRelayCrypto::seal(p,sizeof(p),addresses[0],addresses[1],fleetKey,1234,1,sealed));
  assert(LampFirmwareRelayCrypto::open(sealed,83,addresses[0],addresses[1],fleetKey,decoded,n)&&n==51);
  for(unsigned i=0;i<83;++i){sealed[i]^=1;assert(!LampFirmwareRelayCrypto::open(sealed,83,addresses[0],addresses[1],fleetKey,decoded,n));sealed[i]^=1;}
  assert(!LampFirmwareRelayCrypto::open(sealed,83,addresses[1],addresses[0],fleetKey,decoded,n));uint8_t wrong[16]{};assert(!LampFirmwareRelayCrypto::open(sealed,83,addresses[0],addresses[1],wrong,decoded,n));
  std::cout<<"PASS relay crypto: every-byte tamper and MAC/destination/key binding\n";return 0;
 }
 const String form="key="+String(keyHex);side=0;assert(Donor::control(true,form).status==200);side=1;
 assert(Recipient::control(true,scenario=="wrong-fleet"?String("key=ffffffffffffffffffffffffffffffff"):form).status==200);
 auto status=Recipient::control(false,"");assert(status.body.find(keyHex)==std::string::npos);assert(Recipient::control(true,"key=11111111111111111111111111111111").status==409);
 if(scenario=="auto-off")automatic=false;
 if(scenario=="commission")commissionBusy=true;
 dropAck=scenario=="lost-ack";dropData=scenario=="lost-data";dropFinish=scenario=="lost-finish-ack";corrupt=scenario=="corrupt";
 if(scenario=="old-offer")installed[300+16]='0';
 for(unsigned i=0;i<160000&&!boots;++i){
  side=0;Donor::service(fakeNow);deliver();side=1;Recipient::service(fakeNow);deliver();
  if(scenario=="auto-disabled-midway"&&flash.size()>1000)automatic=false;
  if(scenario=="radio-lost"&&flash.size()>1000)radioAvailable=false;
  ++fakeNow;
 }
 if(scenario=="lost-finish-ack")for(unsigned i=0;i<2000;++i){side=0;Donor::service(fakeNow);deliver();side=1;Recipient::service(fakeNow);deliver();++fakeNow;}
 if(scenario=="success"||scenario=="lost-ack"||scenario=="lost-data"||scenario=="lost-finish-ack"){
  assert(boots==1&&ends==1&&verified&&flash==installed);assert(begins==1);if(dropAck)assert(ackDropped);if(dropData)assert(dataDropped);if(dropFinish)assert(finishDropped);
 }else{assert(!boots&&!verified);if(scenario=="auto-off"||scenario=="wrong-fleet"||scenario=="old-offer"||scenario=="commission")assert(!begins);}
 std::cout<<"PASS relay "<<scenario<<" begins="<<begins<<" boots="<<boots<<"\n";
}
'''
# Synthetic full C3 image format, including a matching public marker. SHA is real.
version=(ROOT/'LampVersion.h').read_text().split('LAMP_FIRMWARE_VERSION "')[1].split('"')[0]
image=bytearray(65584);image[0:2]=bytes([0xe9,1]);image[12:14]=(5).to_bytes(2,'little');image[23]=1;image[28:32]=(65504).to_bytes(4,'little');image[32:36]=(0xabcd5432).to_bytes(4,'little');marker=('COOLLAMP-PUBLIC-'+version+'\0').encode();image[300:300+len(marker)]=marker
key=bytes(range(1,17));key_hex=key.hex()
with tempfile.TemporaryDirectory(prefix='coollamp-firmware-relay-') as folder:
 folder=Path(folder)
 files={'Arduino.h':arduino,'Preferences.h':(ROOT/'tests/stubs/Preferences.h').read_text(),'esp_ota_ops.h':sdk,'esp_app_format.h':format_text,'esp_system.h':'#pragma once\n#include <stdint.h>\nuint32_t esp_random();\n','esp_wifi.h':'#pragma once\n','esp_mac.h':'#pragma once\n#include <stdint.h>\nconstexpr int ESP_MAC_WIFI_STA=0;\nint esp_read_mac(uint8_t*,int);\n','fixture.h':'const uint8_t image[]={'+','.join(map(str,image))+'};\nconst uint8_t fleetKey[]={'+','.join(map(str,key))+'};\nconst char keyHex[]='+json.dumps(key_hex)+';\n','fixture.cpp':fixture}
 for name,text in files.items():(folder/name).write_text(text)
 includes=['-I'+str(folder),'-I'+str(ROOT),'-I'+str(ROOT/'tests'),'-I'+str(source/'include'),'-I'+str(source/'library')]
 defines=['-DMBEDTLS_CONFIG_FILE="espnow-host-mbedtls-config.h"','-DCOOL_LAMP_PUBLIC_RELEASE=1']
 objects=[]
 for name in scope['PRIMITIVES']:
  output=folder/(name+'.o');subprocess.run(['gcc','-std=c11',*SANITIZERS,*includes,*defines,'-c',str(source/'library'/f'{name}.c'),'-o',str(output)],check=True);objects.append(str(output))
 binary=folder/'relay.exe'
 subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,*includes,*defines,str(folder/'fixture.cpp'),str(ROOT/'LampFirmwareRelayCrypto.cpp'),str(ROOT/'LampBleUpdate.cpp'),*objects,'-o',str(binary)],check=True)
 scenarios=['crypto','success','auto-off','commission','wrong-fleet','old-offer','lost-data','lost-ack','lost-finish-ack','corrupt','auto-disabled-midway','radio-lost']
 for scenario in scenarios:subprocess.run([str(binary),scenario],check=True)
 print(f'PASS: {len(scenarios)} production relay scenarios; real pinned AES-GCM and SHA-256')
