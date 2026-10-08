"""Exercise the actual physical-style model with typed NVS failure injection."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
ARDUINO = r'''
#pragma once
#include <cstdint>
#include <string>
class String:public std::string {
public:
 using std::string::string;
 String(const std::string& value):std::string(value){}
 String(uint8_t value):std::string(std::to_string(value)){}
 friend String operator+(const String& a,const String& b){return String(static_cast<const std::string&>(a)+static_cast<const std::string&>(b));}
 friend String operator+(const String& a,const char* b){return a+String(b);}
};
'''
PREFERENCES = r'''
#pragma once
#include <cassert>
#include <cstdint>
#include <map>
#include <string>
#include <vector>
enum PreferenceType {PT_U8,PT_STR,PT_BLOB,PT_INVALID};
struct Entry {PreferenceType type=PT_INVALID;std::vector<uint8_t> bytes;bool operator==(const Entry& other)const{return type==other.type&&bytes==other.bytes;}};
struct Preferences {
 inline static std::map<std::string,Entry> records;
 inline static bool failBegin=false,failWrite=false,failRead=false;
 inline static unsigned opens=0,closes=0,writes=0;
 bool open=false,readOnly=false;
 bool begin(const char* name,bool read){assert(std::string(name)=="coollamp");if(failBegin)return false;open=true;readOnly=read;++opens;return true;}
 void end(){assert(open);open=false;++closes;}
 PreferenceType getType(const char* key){assert(open&&readOnly&&std::string(key)=="lampStyle");auto entry=records.find(key);return entry==records.end()?PT_INVALID:entry->second.type;}
 uint8_t getUChar(const char* key,uint8_t fallback){assert(open&&readOnly);if(failRead)return fallback;const auto& entry=records.at(key);return entry.type==PT_U8&&entry.bytes.size()==1?entry.bytes[0]:fallback;}
 size_t putUChar(const char* key,uint8_t code){assert(open&&!readOnly&&std::string(key)=="lampStyle");++writes;if(failWrite)return 0;records[key]={PT_U8,{code}};return 1;}
 ~Preferences(){assert(!open);}
};
'''
SCENARIOS = r'''
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
void emit(){std::cout<<lampStyleJson()<<"\n";}
int main(int argc,char** argv){
 assert(argc==2);const std::string scenario=argv[1];
 Preferences::records["settings"]={PT_BLOB,{0,2,4,3,1,34,205,102}};
 Preferences::records["syncV1"]={PT_BLOB,{2,17,33,55}};
 Preferences::records["groupSceneV1"]={PT_BLOB,{32,60,85}};
 Preferences::records["wifiPower"]={PT_U8,{34}};
 const auto preserved=Preferences::records;
 if(scenario=="defaults"){
  emit();beginLampStyle();emit();assert(getLampStyle()==LampPhysicalStyle::Unspecified);
  assert(Preferences::records==preserved&&Preferences::writes==0);
  assert(configureLampStyle(0));emit();assert(Preferences::records["lampStyle"].type==PT_U8);
  const auto writes=Preferences::writes;assert(configureLampStyle(0)&&Preferences::writes==writes);
 }else if(scenario=="styles"){
  const char* names[]={"unspecified","helix","large-helix","corkscrew"};
  const char* families[]={"unspecified","helix","helix","corkscrew"};
  beginLampStyle();
  for(uint8_t code=0;code<4;++code){assert(configureLampStyle(code));assert(lampStyleCode()==code);assert(!strcmp(lampStyleId(),names[code]));assert(!strcmp(lampStyleFamily(),families[code]));emit();
   beginLampStyle();assert(lampStyleCode()==code);emit();}
  assert(configureLampStyle(0));beginLampStyle();assert(lampStyleCode()==0);emit();
 }else if(scenario=="invalid"){
  beginLampStyle();assert(configureLampStyle(2));const auto before=Preferences::records;const auto writes=Preferences::writes;
  for(unsigned code=4;code<256;++code){assert(!configureLampStyle(uint8_t(code)));assert(lampStyleCode()==2);}
  assert(Preferences::writes==writes&&Preferences::records==before);emit();
 }else if(scenario=="corrupt"){
  for(const auto& entry:std::vector<Entry>{{PT_U8,{4}},{PT_U8,{255}},{PT_U8,{}},{PT_U8,{1,2}},{PT_STR,{1}},{PT_BLOB,{3}}}){
   Preferences::records["lampStyle"]=entry;const auto before=Preferences::records;beginLampStyle();assert(lampStyleCode()==0&&Preferences::records==before);emit();}
  Preferences::records["lampStyle"]={PT_U8,{3}};Preferences::failRead=true;beginLampStyle();assert(lampStyleCode()==0);emit();Preferences::failRead=false;
  beginLampStyle();assert(lampStyleCode()==3);emit();
 }else if(scenario=="failures"){
  beginLampStyle();assert(configureLampStyle(1));const auto before=Preferences::records;
  Preferences::failWrite=true;assert(!configureLampStyle(3));assert(lampStyleCode()==1&&Preferences::records==before);emit();
  beginLampStyle();assert(lampStyleCode()==1);emit();Preferences::failWrite=false;
  Preferences::failBegin=true;assert(!configureLampStyle(2));assert(lampStyleCode()==1&&Preferences::records==before);emit();
  Preferences::failBegin=false;beginLampStyle();assert(lampStyleCode()==1);
  assert(configureLampStyle(2));beginLampStyle();assert(lampStyleCode()==2);emit();
 }else if(scenario=="unavailable-store"){
  Preferences::failBegin=true;beginLampStyle();assert(lampStyleCode()==0&&Preferences::records==preserved);emit();
  assert(!configureLampStyle(2)&&lampStyleCode()==0&&Preferences::writes==0);
  Preferences::failBegin=false;beginLampStyle();assert(configureLampStyle(3));emit();
 }else assert(false);
 for(const auto& record:preserved)assert(Preferences::records.at(record.first)==record.second);
 assert(Preferences::opens==Preferences::closes);
}
'''


class LampStyleRuntime(unittest.TestCase):
    def test_actual_style_model(self):
        with tempfile.TemporaryDirectory(prefix='coollamp-style-') as folder:
            directory = Path(folder)
            (directory / 'Arduino.h').write_text(ARDUINO)
            (directory / 'Preferences.h').write_text(PREFERENCES)
            cpp, executable = directory / 'test.cpp', directory / 'test.exe'
            cpp.write_text('#include "LampStyle.h"\n#include <Preferences.h>\n' + SCENARIOS)
            subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS, '-DARDUINO=1',
                            '-I' + str(directory), '-I' + str(ROOT), str(cpp), str(ROOT / 'LampStyle.cpp'), '-o', str(executable)], check=True)
            for scenario in ['defaults', 'styles', 'invalid', 'corrupt', 'failures', 'unavailable-store']:
                with self.subTest(scenario=scenario):
                    result = subprocess.run([str(executable), scenario], check=True, capture_output=True, text=True)
                    rows = [json.loads(line) for line in result.stdout.splitlines()]
                    self.assertTrue(rows)
                    for row in rows:
                        self.assertEqual(set(row), {'version', 'code', 'id', 'family'})
                        self.assertEqual(row['version'], 1)
                        self.assertIn(row['code'], range(4))
                        self.assertEqual(row['id'], ['unspecified', 'helix', 'large-helix', 'corkscrew'][row['code']])
                        self.assertEqual(row['family'], ['unspecified', 'helix', 'helix', 'corkscrew'][row['code']])


if __name__ == '__main__':
    unittest.main()
