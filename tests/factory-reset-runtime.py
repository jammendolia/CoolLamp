"""Test real reset recovery against namespaced NVS, including interrupted writes."""
import pathlib
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = pathlib.Path(__file__).resolve().parents[1]


class FactoryResetTests(unittest.TestCase):
    def test_recovery(self):
        arduino = r'''
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
        preferences = r'''
#pragma once
#include <map>
#include <string>
#include <vector>
#include <cstring>
struct Preferences {
 inline static std::map<std::string,std::map<std::string,std::vector<uint8_t>>> storage;
 inline static bool failWrites=false;
 std::string ns;
 bool begin(const char* name,bool){ns=name;return true;}void end(){}
 size_t getBytesLength(const char* key){return storage[ns][key].size();}
 size_t getBytes(const char* key,void* out,size_t n){auto& bytes=storage[ns][key];if(bytes.size()!=n)return 0;memcpy(out,bytes.data(),n);return n;}
 size_t putBytes(const char* key,const void* data,size_t n){if(failWrites)return 0;auto* p=static_cast<const uint8_t*>(data);storage[ns][key]={p,p+n};return n;}
 bool clear(){if(failWrites)return false;storage[ns].clear();return true;}
 bool remove(const char* key){if(failWrites)return false;return storage[ns].erase(key)>0;}
};
'''
        source = r'''
#include <cassert>
#include <iostream>
#include "LampConfig.h"
#include "LampFactoryReset.h"
#include "LampWifiSetup.h"
LampSettings lampSettings{};uint16_t lampMidpoint=99;bool updating=false,mic=true;
bool lampUpdateOwnsResources(){return updating;}
bool stopLampAudio(){return true;}bool lampHasMicrophone(){return mic;}
int cancellations=0;
uint8_t lampWifiSetupCommand(const uint8_t*,size_t,uint32_t,String&){++cancellations;return 0;}
'''
        main = r'''
int main(){
 lampSettings.version=1;lampSettings.ledCount=205;lampSettings.milliAmps=500;
 lampSettings.brightness=200;lampSettings.startupMode=47;
 strcpy(lampSettings.ssid,"Home");strcpy(lampSettings.wifiPassword,"old-network-secret");strcpy(lampSettings.adminPassword,"old-access-secret");
 Preferences prefs;prefs.begin("coollamp",false);prefs.putBytes("settings",&lampSettings,sizeof(lampSettings));
 const uint8_t old[]={5,6,7};for(auto key:{"colors","syncV1","name","audioEffectsV1","autoUpdate","rotationV1"})prefs.putBytes(key,old,sizeof(old));
 prefs.begin("other",false);prefs.putBytes("keep",old,sizeof(old));
 updating=true;assert(!requestLampFactoryReset());updating=false;
 Preferences::failWrites=true;assert(!requestLampFactoryReset()&&!lampFactoryResetPending());Preferences::failWrites=false;
 assert(requestLampFactoryReset()&&lampFactoryResetPending()&&cancellations==1);
 assert(!requestLampFactoryReset());assert(Preferences::storage["coollamp"].count("colors"));
 fakeNow=1499;serviceLampFactoryReset();assert(ESP.restarts==0);fakeNow=1500;serviceLampFactoryReset();assert(ESP.restarts==1);
 pending=false;Preferences::failWrites=true;assert(!recoverLampFactoryReset());
 Preferences::failWrites=false;assert(recoverLampFactoryReset()&&lampFactoryResetNeedsBondErase());
 LampSettings restored{};prefs.begin("coollamp",true);assert(prefs.getBytes("settings",&restored,sizeof(restored))==sizeof(restored));
 assert(restored.ledCount==205&&restored.milliAmps==500&&restored.brightness==100&&restored.startupMode==4);
 assert(restored.ssid[0]==0&&restored.wifiPassword[0]==0&&!strcmp(restored.adminPassword,"coollamp"));
 assert(Preferences::storage["coollamp"].size()==3&&Preferences::storage["other"].count("keep"));
 assert(Preferences::storage["coollamp"]["audioV2"][1]==1);
 assert(Preferences::storage["coollamp"]["geometryV1"][1]==99);
 // Power loss after settings recovery must not repeat the destructive clear.
 prefs.putBytes("after-recovery",old,sizeof(old));assert(recoverLampFactoryReset());assert(Preferences::storage["coollamp"].count("after-recovery"));
 assert(completeLampFactoryReset()&&!lampFactoryResetNeedsBondErase());
 assert(!Preferences::storage["coollamp-reset"].count("pendingV1"));
 assert(recoverLampFactoryReset());
 FactoryResetRecord invalid;invalid.encode(205,500,99,true);invalid.data[4]^=1;assert(!invalid.valid());
 for(unsigned count:{1U,205U,1024U}){FactoryResetRecord r;r.encode(count,500,count-1,false);assert(r.valid());}
 FactoryResetRecord r;r.encode(0,500,0,true);assert(!r.valid());r.encode(205,99,0,true);assert(!r.valid());r.encode(205,500,205,true);assert(!r.valid());
 std::cout<<"PASS: deferred reset, update/storage rejection, hardware preservation, full user-settings erase, power-loss recovery, pending bond cleanup and record integrity\n";
}
'''
        implementation = (ROOT/'LampFactoryReset.cpp').read_text()
        with tempfile.TemporaryDirectory(prefix='coollamp-reset-') as directory:
            directory = pathlib.Path(directory)
            (directory/'Arduino.h').write_text(arduino)
            (directory/'Preferences.h').write_text(preferences)
            cpp, binary = directory/'test.cpp', directory/'test'
            cpp.write_text(source+implementation+main)
            subprocess.run(['c++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,
                            '-I'+str(directory),'-I'+str(ROOT),str(cpp),'-o',str(binary)],check=True)
            subprocess.run([str(binary)],check=True)


if __name__=='__main__':
    unittest.main()
