"""Production motion record/storage; every durable write boundary, no hardware."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS
ROOT=Path(__file__).resolve().parents[1]
prefs=r'''
#pragma once
#include <map>
#include <string>
#include <vector>
#include <cstring>
#include <cstdint>
enum PreferenceType{PT_INVALID,PT_BLOB,PT_U8};
struct PowerLoss{};
struct Preferences{
 struct Value{PreferenceType type=PT_BLOB;std::vector<uint8_t> bytes;};
 inline static std::map<std::string,std::map<std::string,Value>> store;
 inline static bool failOpen=false;
 inline static unsigned writes=0,reads=0,readFailure=0,cutAfter=0,corruptAfter=0;
 inline static unsigned namespaceCreations=0;
 inline static bool cutAfterNamespace=false;
 inline static uint64_t failBefore=0,failAfter=0;
 inline static std::map<uint32_t,std::string> handles;
 protected:uint32_t _handle=0;
 public:
 std::string ns;
 static void faults(){writes=reads=readFailure=cutAfter=corruptAfter=namespaceCreations=0;failBefore=failAfter=0;failOpen=cutAfterNamespace=false;}
 bool begin(const char* name,bool readOnly){ns=name;if(failOpen||(readOnly&&!store.count(ns)))return false;if(!store.count(ns)){store[ns]={};++namespaceCreations;if(cutAfterNamespace)throw PowerLoss{};}_handle=handles.size()+1;handles[_handle]=ns;return true;}void end(){}
 bool isKey(const char* key){return store[ns].count(key);}
 PreferenceType getType(const char* key){return isKey(key)?store[ns][key].type:PT_INVALID;}
 size_t getBytesLength(const char* key){return isKey(key)?store[ns][key].bytes.size():0;}
 size_t getBytes(const char* key,void* out,size_t size){++reads;if(reads==readFailure||!isKey(key)||getBytesLength(key)!=size)return 0;memcpy(out,store[ns][key].bytes.data(),size);return size;}
 size_t putBytes(const char* key,const void* data,size_t size){++writes;if(failBefore&(uint64_t(1)<<writes))return 0;const auto* p=static_cast<const uint8_t*>(data);store[ns][key]={PT_BLOB,{p,p+size}};if(corruptAfter==writes)store[ns][key].bytes.back()^=1;if(cutAfter==writes)throw PowerLoss{};return failAfter&(uint64_t(1)<<writes)?0:size;}
 bool remove(const char* key){++writes;if(failBefore&(uint64_t(1)<<writes))return false;const bool removed=store[ns].erase(key);if(cutAfter==writes)throw PowerLoss{};return removed&&!(failAfter&(uint64_t(1)<<writes));}
};
'''
nvs=r'''
#pragma once
#include "Preferences.h"
using esp_err_t=int;
constexpr esp_err_t ESP_OK=0,ESP_ERR_NVS_NOT_FOUND=1,ESP_ERR_NVS_INVALID_LENGTH=2,ESP_ERR_NVS_TYPE_MISMATCH=3,ESP_FAIL=4;
inline esp_err_t nvs_get_blob(uint32_t handle,const char* key,void* data,size_t* length){
 using P=Preferences;++P::reads;if(P::reads==P::readFailure)return ESP_FAIL;
 auto& values=P::store[P::handles[handle]];const auto found=values.find(key);
 if(found==values.end())return ESP_ERR_NVS_NOT_FOUND;
 if(found->second.type!=PT_BLOB)return ESP_ERR_NVS_TYPE_MISMATCH;
 if(!data){*length=found->second.bytes.size();return ESP_OK;}
 if(*length<found->second.bytes.size())return ESP_ERR_NVS_INVALID_LENGTH;
 *length=found->second.bytes.size();memcpy(data,found->second.bytes.data(),*length);return ESP_OK;
}
'''
test=r'''
#include <cassert>
#include <cstdio>
#include "LampGeometry.cpp"
using P=Preferences;
void seed(bool exists=true){P::store.clear();P::faults();lampMidpoint=40;lampMotionPath=0;
 P::store["coollamp"]["geometryV1"]={PT_BLOB,{1,40,0}};
 P::store["coollamp"]["settings"]={PT_BLOB,{4,5,6}};
 P::store["lampmodel"]["descriptorV1"]={PT_BLOB,{11,22,33}};
 if(exists){LampMotionPathRecord record;record.encode(0);P::store[LAMP_MOTION_PATH_NAMESPACE][LAMP_MOTION_PATH_KEY]={PT_BLOB,{record.data,record.data+3}};}
 loadLampGeometry();P::faults();}
int main(){
 static_assert(sizeof(LampMotionPathRecord)==3,"Versioned record stays tiny");
 // A first-ever writable open may create only its empty namespace. It never
 // synthesizes a motion record or manufacturing descriptor on boot.
 P::store.clear();P::faults();loadLampGeometry();assert(lampMotionPath==0&&!lampMotionPathSaveUncertain());
 assert(P::namespaceCreations==1&&!P::writes&&P::store.size()==1&&P::store["lampmodel"].empty());
 P::store.clear();P::faults();P::cutAfterNamespace=true;bool freshCut=false;
 try{loadLampGeometry();}catch(const PowerLoss&){freshCut=true;}assert(freshCut);
 P::faults();loadLampGeometry();assert(lampMotionPath==0&&!lampMotionPathSaveUncertain()&&!P::writes&&!P::namespaceCreations&&P::store["lampmodel"].empty());
 seed(false);uint8_t path=9;assert(readStoredLampMotionPath(path)&&path==0);
 assert(saveLampMotionPath(1)&&lampMotionPath==1&&!lampMotionPathSaveUncertain()&&P::writes==1);
 const auto protectedKeys=P::store;loadLampGeometry();assert(lampMidpoint==40&&lampMotionPath==1&&P::store==protectedKeys);
 P::faults();assert(saveLampMotionPath(1)&&!P::writes);assert(!saveLampMotionPath(2)&&!P::writes);
 assert(readStoredLampMotionPath(path)&&path==1);
 // A normal user-namespace reset cannot erase hardware layout or model identity.
 P::store.erase("coollamp");loadLampGeometry();assert(lampMotionPath==1&&lampMidpoint==0);
 for(unsigned fault=0;fault<5;++fault){
  seed();const auto old=P::store[LAMP_MOTION_PATH_NAMESPACE][LAMP_MOTION_PATH_KEY].bytes;
  if(fault==0)P::failBefore=uint64_t(1)<<1;
  if(fault==1)P::failAfter=uint64_t(1)<<1;
  if(fault==2)P::readFailure=2;
  if(fault==3)P::corruptAfter=1;
  if(fault==4)P::readFailure=1;
  assert(!saveLampMotionPath(1)&&lampMotionPath==0&&lampMotionPathSaveUncertain()==(fault==4)&&P::writes<=2);
  assert(P::store[LAMP_MOTION_PATH_NAMESPACE][LAMP_MOTION_PATH_KEY].bytes==old);
  assert(P::store["coollamp"]["geometryV1"].bytes==std::vector<uint8_t>({1,40,0}));
 }
 seed(false);P::failAfter=uint64_t(1)<<1;assert(!saveLampMotionPath(1)&&!lampMotionPathSaveUncertain());assert(!P::store[LAMP_MOTION_PATH_NAMESPACE].count(LAMP_MOTION_PATH_KEY));
 for(bool existed:{false,true}){
  seed(existed);P::failAfter=uint64_t(1)<<1;P::failBefore=uint64_t(1)<<2;
  assert(!saveLampMotionPath(1)&&lampMotionPath==0&&lampMotionPathSaveUncertain()&&P::writes==2);
  P::faults();loadLampGeometry();assert(lampMotionPath==1&&!lampMotionPathSaveUncertain());
 }
 // Power loss after the first committed record, or its compensating restore,
 // leaves one valid record/absence. No motion-record writes on boot or duplicate save.
 for(bool existed:{false,true})for(unsigned boundary:{1u,2u}){
  seed(existed);P::cutAfter=boundary;if(boundary==2)P::failAfter=uint64_t(1)<<1;
  bool interrupted=false;try{saveLampMotionPath(1);}catch(const PowerLoss&){interrupted=true;}assert(interrupted);
  P::faults();loadLampGeometry();assert(lampMidpoint==40&&lampMotionPath==(boundary==1?1:0)&&!P::writes);
 }
 for(unsigned invalid=0;invalid<6;++invalid){
  seed();auto& value=P::store[LAMP_MOTION_PATH_NAMESPACE][LAMP_MOTION_PATH_KEY];
  if(invalid==0)value.bytes={2,1,0};if(invalid==1)value.bytes={1,2,0};if(invalid==2)value.bytes[2]^=1;if(invalid==3)value.type=PT_U8;
  if(invalid==4)value.bytes.resize(2);if(invalid==5)value.bytes.resize(4);
  const auto bytes=value.bytes;path=9;assert(!readStoredLampMotionPath(path)&&path==0);assert(!saveLampMotionPath(1)&&!P::writes&&value.bytes==bytes);
  loadLampGeometry();assert(lampMidpoint==40&&lampMotionPath==0&&lampMotionPathSaveUncertain()&&value.bytes==bytes);
 }
 seed();P::failOpen=true;path=9;assert(!readStoredLampMotionPath(path)&&path==0);assert(!saveLampMotionPath(1)&&!P::writes&&lampMotionPathSaveUncertain());
 loadLampGeometry();assert(lampMotionPath==0&&lampMotionPathSaveUncertain()&&!P::writes);
 P::faults();loadLampGeometry();assert(lampMotionPath==0&&!lampMotionPathSaveUncertain());
 seed();P::readFailure=1;loadLampGeometry();assert(lampMotionPath==0&&lampMotionPathSaveUncertain()&&!P::writes);
 P::faults();assert(saveLampMotionPath(0)&&!lampMotionPathSaveUncertain()&&!P::writes);
 seed(false);P::readFailure=1;loadLampGeometry();assert(lampMotionPath==0&&lampMotionPathSaveUncertain()&&!P::writes);
 P::faults();P::readFailure=1;assert(!saveLampMotionPath(1)&&lampMotionPathSaveUncertain()&&!P::writes);
 puts("PASS production motion storage: reset-surviving separate3B record, exact geometryV1/model preservation, first empty namespace creation/powercut, no motion-record boot migration, valid/missing/future/corrupt/type bounds, commit+readback, before/after/storage-read failure, verified old restore/absence, honest uncertainty, every durable boundary, idempotent confirmed save");
}
'''
# std::map equality needs only the test SDK value comparison.
prefs=prefs.replace('struct Value{PreferenceType type=PT_BLOB;std::vector<uint8_t> bytes;};','struct Value{PreferenceType type=PT_BLOB;std::vector<uint8_t> bytes;bool operator==(const Value& other)const{return type==other.type&&bytes==other.bytes;}};')
with tempfile.TemporaryDirectory(prefix='motion-storage-',dir=ROOT/'.build') as directory:
    folder=Path(directory);(folder/'Preferences.h').write_text(prefs);(folder/'nvs.h').write_text(nvs);(folder/'test.cpp').write_text(test)
    binary=folder/'motion.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',*SANITIZERS,'-I'+str(folder),'-I'+str(ROOT),str(folder/'test.cpp'),'-o',str(binary)],check=True)
    subprocess.run([str(binary)],check=True)
