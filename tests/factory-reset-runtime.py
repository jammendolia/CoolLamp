"""Compile real reset recovery; interrupt every durable NVS mutation boundary."""
import pathlib
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = pathlib.Path(__file__).resolve().parents[1]

ARDUINO = r'''
#pragma once
#include <cstdint>
#include <cstring>
#include <string>
using String=std::string;
inline struct {int restarts=0;uint64_t getEfuseMac(){return 0x24eae26e9e9cULL;}void restart(){++restarts;}} ESP;
inline size_t strlcpy(char* d,const char* s,size_t n){auto len=strlen(s);if(n){auto c=len<n-1?len:n-1;memcpy(d,s,c);d[c]=0;}return len;}
inline uint32_t fakeNow=0;
inline uint32_t millis(){return fakeNow;}
'''

PREFERENCES = r'''
#pragma once
#include <map>
#include <string>
#include <vector>
#include <cstring>
enum PreferenceType {PT_INVALID,PT_U8,PT_BLOB};
struct PowerLoss {};
struct Preferences {
 using Keys=std::map<std::string,std::vector<uint8_t>>;
 inline static std::map<std::string,Keys> storage;
 inline static std::map<std::string,std::map<std::string,PreferenceType>> types;
 inline static std::vector<std::string> events;
 inline static int operation=0,failAt=0,cutAt=0;
 inline static bool failWrites=false;
 inline static std::string failBegin;
 std::string ns;
 static void faults(int fail=0,int cut=0){operation=0;failAt=fail;cutAt=cut;failWrites=false;events.clear();}
 static void reset(){storage.clear();types.clear();failBegin.clear();faults();}
 bool begin(const char* name,bool){ns=name;return ns!=failBegin;}void end(){}
 bool isKey(const char* key){return storage[ns].count(key)!=0;}
 PreferenceType getType(const char* key){auto i=types[ns].find(key);return i==types[ns].end()?PT_INVALID:i->second;}
 size_t getBytesLength(const char* key){auto i=storage[ns].find(key);return getType(key)==PT_BLOB&&i!=storage[ns].end()?i->second.size():0;}
 size_t getBytes(const char* key,void* out,size_t n){if(getBytesLength(key)!=n)return 0;memcpy(out,storage[ns][key].data(),n);return n;}
 uint8_t getUChar(const char* key,uint8_t fallback=0){auto i=storage[ns].find(key);return getType(key)==PT_U8&&i!=storage[ns].end()&&i->second.size()==1?i->second[0]:fallback;}
 bool before(const std::string& name){events.push_back(ns+":"+name);++operation;return !failWrites&&operation!=failAt;}
 void after(){if(operation==cutAt)throw PowerLoss{};}
 size_t putBytes(const char* key,const void* data,size_t n){if(!before(key))return 0;auto* p=static_cast<const uint8_t*>(data);storage[ns][key]={p,p+n};types[ns][key]=PT_BLOB;after();return n;}
 size_t putUChar(const char* key,uint8_t value){if(!before(key))return 0;storage[ns][key]={value};types[ns][key]=PT_U8;after();return 1;}
 bool clear(){if(!before("clear"))return false;storage[ns].clear();types[ns].clear();after();return true;}
 bool remove(const char* key){if(!before(std::string("remove/")+key))return false;bool removed=storage[ns].erase(key)>0;types[ns].erase(key);after();return removed;}
};
'''

SOURCE = r'''
#include <cassert>
#include <iostream>
#include <algorithm>
#include "LampConfig.h"
#include "LampFactoryReset.h"
#include "LampWifiSetup.h"
LampSettings lampSettings{};uint16_t lampMidpoint=99;bool updating=false,mic=true;
bool lampUpdateOwnsResources(){return updating;}
bool stopLampAudio(){return true;}bool lampHasMicrophone(){return mic;}
int cancellations=0;
uint8_t lampWifiSetupCommand(const uint8_t*,size_t,uint32_t,String&){++cancellations;return 0;}
'''

TESTS = r'''
void reboot(){pending=false;armed=false;bondErase=false;restartAt=0;}
void seed(int style=3){
 Preferences::reset();reboot();fakeNow=0;ESP.restarts=0;cancellations=0;updating=false;mic=true;
 lampSettings={};lampSettings.version=1;lampSettings.ledCount=205;lampSettings.milliAmps=500;
 lampSettings.brightness=200;lampSettings.startupMode=47;lampMidpoint=99;
 strcpy(lampSettings.ssid,"Home");strcpy(lampSettings.wifiPassword,"old-network-secret");strcpy(lampSettings.adminPassword,"old-access-secret");
 Preferences p;p.begin("coollamp",false);p.putBytes("settings",&lampSettings,sizeof(lampSettings));
 const uint8_t old[]={5,6,7};for(auto key:{"colors","syncV1","name","audioEffectsV1","autoUpdate","rotationV1"})p.putBytes(key,old,sizeof(old));
 if(style>=0)p.putUChar("lampStyle",uint8_t(style));
 p.begin("other",false);p.putBytes("keep",old,sizeof(old));Preferences::faults();
}
uint8_t storedStyle(){Preferences p;p.begin("coollamp",true);return p.getUChar("lampStyle",0);}
bool marker(){return Preferences::storage["coollamp-reset"].count("pendingV1")!=0;}
void assertOriginal(int style){
 assert(Preferences::storage["coollamp"].count("colors"));assert(storedStyle()==style);
 assert(Preferences::storage["other"].count("keep"));
}
void assertFactory(int style){
 Preferences p;p.begin("coollamp",true);LampSettings s{};assert(p.getBytes("settings",&s,sizeof(s))==sizeof(s));
 assert(s.ledCount==205&&s.milliAmps==500&&s.brightness==100&&s.startupMode==4);
 assert(!s.ssid[0]&&!s.wifiPassword[0]&&!strcmp(s.adminPassword,"coollamp"));
 assert(storedStyle()==style);
 assert(Preferences::storage["coollamp"].size()==size_t(style?4:3));
 assert(Preferences::storage["coollamp"]["audioV2"][1]==1);
 assert(Preferences::storage["coollamp"]["geometryV1"][1]==99);
 assert(Preferences::storage["other"].count("keep"));
}
void finish(){
 Preferences::faults();reboot();assert(recoverLampFactoryReset());
 assert(completeLampFactoryReset());assert(!marker());assert(!Preferences::storage["coollamp-reset"].count("styleV1"));
}
FactoryResetRecord resetRecord(uint8_t phase=0){FactoryResetRecord r;r.encode(205,500,99,true,phase);return r;}
void putMarker(const FactoryResetRecord& record){Preferences p;p.begin("coollamp-reset",false);p.putBytes("pendingV1",&record,sizeof(record));}
void putSnapshot(const ResetStyleRecord& snapshot){Preferences p;p.begin("coollamp-reset",false);p.putBytes("styleV1",&snapshot,sizeof(snapshot));}
void normal(){
 seed();updating=true;assert(!requestLampFactoryReset());updating=false;
 Preferences::failWrites=true;assert(!requestLampFactoryReset()&&!lampFactoryResetPending());Preferences::failWrites=false;
 assert(requestLampFactoryReset()&&lampFactoryResetPending()&&cancellations==1);assert(!requestLampFactoryReset());assertOriginal(3);
 fakeNow=1499;serviceLampFactoryReset();assert(ESP.restarts==0);fakeNow=1500;serviceLampFactoryReset();assert(ESP.restarts==1);
 reboot();Preferences::failWrites=true;assert(!recoverLampFactoryReset());assertOriginal(3);
 Preferences::failWrites=false;assert(recoverLampFactoryReset()&&lampFactoryResetNeedsBondErase());assertFactory(3);
 // A phase-one retry must not erase subsequently saved data, even without its style snapshot.
 Preferences p;p.begin("coollamp",false);uint8_t value=7;p.putBytes("after-recovery",&value,1);
 p.begin("coollamp-reset",false);assert(p.remove("styleV1"));reboot();assert(recoverLampFactoryReset());
 assert(Preferences::storage["coollamp"].count("after-recovery"));assert(completeLampFactoryReset());assert(!marker());
 // RAM-pending false cannot replace an already durable reset transaction.
 seed();assert(requestLampFactoryReset());reboot();Preferences::faults();assert(!requestLampFactoryReset());assert(Preferences::operation==0);finish();
 std::cout<<"PASS: deferred reset, hardware/style retention, settings erase and phase-one idempotence\n";
}
void powerLoss(){
 // Complete sequence has two preparation, seven recovery and two cleanup commits.
 // Cut immediately after every commit, then reboot and resume with no fault.
 for(int style:{0,1,2,3}){
  seed(style);assert(requestLampFactoryReset());reboot();assert(recoverLampFactoryReset());assert(completeLampFactoryReset());
  const int commits=Preferences::operation;assert(commits==(style?11:10));
  for(int cut=1;cut<=commits;++cut){
   seed(style);Preferences::faults(0,cut);bool interrupted=false;
   try{assert(requestLampFactoryReset());reboot();assert(recoverLampFactoryReset());assert(completeLampFactoryReset());}catch(PowerLoss&){interrupted=true;}
   assert(interrupted);Preferences::faults();reboot();
   if(cut==1){assert(!marker());assert(recoverLampFactoryReset());assertOriginal(style);
    // Orphan PREPARED snapshot cannot supply stale style to a later legacy reset.
    Preferences p;p.begin("coollamp",false);p.putUChar("lampStyle",3);putMarker(resetRecord());
    finish();assertFactory(3);
   }else{finish();assertFactory(style);}
  }
 }
 std::cout<<"PASS: all 43 request/recovery/cleanup power-loss boundaries retain typed physical style\n";
}
void failedWrites(){
 for(int failure=1;failure<=11;++failure){
  seed();Preferences::faults(failure);const bool requested=requestLampFactoryReset();
  if(failure<=2){assert(!requested&&!lampFactoryResetPending());assert(!marker());assertOriginal(3);}
  else{assert(requested);reboot();bool recovered=recoverLampFactoryReset();
   if(failure<=9){assert(!recovered);assert(marker());if(failure<=4)assertOriginal(3);}
   else{assert(recovered);assert(!completeLampFactoryReset());assertFactory(3);assert(marker());}
   finish();assertFactory(3);
  }
 }
 // Failed opening a namespace must not clear settings or pretend to retain style.
 for(auto ns:{"coollamp","coollamp-reset"}){seed();Preferences::failBegin=ns;assert(!requestLampFactoryReset());assertOriginal(3);}
 seed();assert(requestLampFactoryReset());reboot();Preferences::failBegin="coollamp";assert(!recoverLampFactoryReset());assertOriginal(3);
 Preferences::failBegin.clear();finish();assertFactory(3);
 std::cout<<"PASS: each failed write/clear/remove and namespace-open failure remains safely retryable\n";
}
void compatibility(){
 // Legacy phase-zero marker captures typed style before destructive clear.
 for(int style:{-1,0,1,2,3,255}){seed(style);putMarker(resetRecord());finish();assertFactory(style>=1&&style<=3?style:0);}
 // Incorrect NVS types never classify a lamp or infer a model from its hardware.
 seed();Preferences p;p.begin("coollamp",false);uint8_t raw=2;p.putBytes("lampStyle",&raw,1);putMarker(resetRecord());finish();assertFactory(0);
 // A valid unrelated snapshot must not override the current lamp's style.
 for(uint8_t phase:{0,1}){seed(2);FactoryResetRecord other;other.encode(206,500,99,true);
  ResetStyleRecord old;old.encode(other,1,phase);putSnapshot(old);putMarker(resetRecord());finish();assertFactory(2);}
 // A same-hardware PREPARED orphan is also refreshed, rather than reused.
 seed(3);ResetStyleRecord orphan;orphan.encode(resetRecord(),1,0);putSnapshot(orphan);putMarker(resetRecord());finish();assertFactory(3);
 // Active phase-zero snapshot survives loss after clear, including legacy requests.
 seed(2);putMarker(resetRecord());Preferences::faults(0,2);bool interrupted=false;
 try{recoverLampFactoryReset();}catch(PowerLoss&){interrupted=true;}assert(interrupted);assert(!Preferences::storage["coollamp"].count("lampStyle"));finish();assertFactory(2);
 // Legacy completed marker never repeats clear and may have no style snapshot.
 seed(2);putMarker(resetRecord(1));reboot();assert(recoverLampFactoryReset());assertOriginal(2);assert(completeLampFactoryReset());
 std::cout<<"PASS: legacy pendingV1, unclassified/corrupt style, stale snapshots and typed restart compatibility\n";
}
void malformed(){
 for(int variant=0;variant<6;++variant){
  seed();FactoryResetRecord record=resetRecord();ResetStyleRecord snapshot;snapshot.encode(record,3,1);
  putMarker(record);putSnapshot(snapshot);auto& bytes=Preferences::storage["coollamp-reset"]["styleV1"];
  if(variant==0)bytes.pop_back();
  if(variant==1)bytes[13]^=1;
  if(variant==2){snapshot.data[2]=4;snapshot.data[13]=0x3c;for(unsigned i=0;i<13;++i)snapshot.data[13]^=snapshot.data[i];putSnapshot(snapshot);}
  if(variant==3){snapshot.data[1]=2;snapshot.data[13]=0x3c;for(unsigned i=0;i<13;++i)snapshot.data[13]^=snapshot.data[i];putSnapshot(snapshot);}
  if(variant==4)Preferences::types["coollamp-reset"]["styleV1"]=PT_U8;
  if(variant==5){snapshot.data[3]=2;snapshot.data[13]=0x3c;for(unsigned i=0;i<13;++i)snapshot.data[13]^=snapshot.data[i];putSnapshot(snapshot);}
  Preferences::faults();reboot();assert(!recoverLampFactoryReset());assertOriginal(3);assert(Preferences::operation==0);
 }
 // Invalid pending markers never authorize erasure, even beside an active snapshot.
 for(int variant=0;variant<4;++variant){seed();FactoryResetRecord r=resetRecord();ResetStyleRecord s;s.encode(r,1,1);putSnapshot(s);
  if(variant==0)r.data[4]^=1;
  if(variant==1)r.encode(205,500,205,true);
  if(variant==2)r.encode(205,500,99,true,2);
  if(variant==3)r.encode(0,500,0,true);
  putMarker(r);Preferences::faults();reboot();assert(recoverLampFactoryReset());assertOriginal(3);assert(!lampFactoryResetNeedsBondErase());assert(Preferences::operation==0);
 }
 for(unsigned count:{1U,205U,1024U}){FactoryResetRecord r;r.encode(count,500,count-1,false);assert(r.valid());}
 static_assert(sizeof(FactoryResetRecord)==10,"pendingV1 must stay byte-compatible");
 std::cout<<"PASS: malformed markers never cause destructive recovery; pendingV1 stays 10 bytes\n";
}
int main(){normal();powerLoss();failedWrites();compatibility();malformed();}
'''


class FactoryResetTests(unittest.TestCase):
    def test_recovery(self):
        with tempfile.TemporaryDirectory(prefix='coollamp-reset-') as directory:
            directory = pathlib.Path(directory)
            (directory/'Arduino.h').write_text(ARDUINO)
            (directory/'Preferences.h').write_text(PREFERENCES)
            cpp, binary = directory/'test.cpp', directory/'test'
            cpp.write_text(SOURCE+(ROOT/'LampFactoryReset.cpp').read_text()+TESTS)
            subprocess.run(['c++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,
                            '-I'+str(directory),'-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True)
            subprocess.run([str(binary)],check=True)


if __name__=='__main__':
    unittest.main()
