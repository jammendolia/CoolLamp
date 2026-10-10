"""Signed mode drives the actual flash receiver and retained trust records."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS
ROOT=Path(__file__).resolve().parents[1]
subprocess.run(['node',str(ROOT/'tools/development-signing-fixture.cjs')],check=True)
data=json.loads((ROOT/'.build/publisher-fixtures/fixture.json').read_text())
tree=ast.parse((ROOT/'tests/espnow-runtime.py').read_text())
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='verified_source' or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('SOURCE','ARCHIVE_SHA','PRIMITIVES') for t in n.targets)]
scope=dict(Path=Path,hashlib=hashlib,json=json,tarfile=tarfile)
exec(compile(ast.Module(body=nodes,type_ignores=[]),'verified_source','exec'),scope)
scope['PRIMITIVES']+=['bignum','bignum_core','bignum_mod','bignum_mod_raw','ecp','ecp_curves','ecp_curves_new','ecdh','hkdf','ecdsa','asn1parse','asn1write']
source=scope['verified_source'](ROOT/'.build/tls-library')
receiver=ast.parse((ROOT/'tests/ble-update-runtime.py').read_text());constants={}
exec(compile(ast.Module(body=[n for n in receiver.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('ARDUINO','SDK','FORMAT','FIXTURE') for t in n.targets)],type_ignores=[]),'receiver_fixture','exec'),constants)
stub='''namespace UpdatePublisher {
 bool enforced(){return false;}
 bool verifyProvisioned(const char*,size_t,Manifest&){return false;}
 bool recordEpoch(uint32_t){return false;}
 bool retainManifest(const char*,size_t){return false;}
}
'''
assert constants['FIXTURE'].count(stub)==1
cpp=constants['FIXTURE'].replace(stub,'')
cpp=cpp[:cpp.index('int main(')]+r'''
int main(int argc,char** argv){
 assert(argc==2);const std::string scenario=argv[1];assert(UpdatePublisher::enforced());
 if(scenario=="unsigned"||scenario=="bad-signature"||scenario=="wrong-epoch"||scenario=="trust-open-failure"){
  std::string text=manifestText;
  if(scenario=="unsigned")text=legacyManifest;
  if(scenario=="bad-signature")text[text.rfind('\n',text.size()-2)+1]^=1;
  if(scenario=="wrong-epoch")text.replace(text.find("\n7\n"),3,"\n8\n");
  if(scenario=="trust-open-failure")Preferences::failOpen=true;
  for(size_t at=0;at<text.size();){const size_t count=std::min(size_t(100),text.size()-at);send(Manifest,at,reinterpret_cast<const uint8_t*>(text.data()+at),count);at+=count;}
  send(Start);assert(status()[1]==Error&&status()[2]==Invalid&&!begins&&!boots&&!reserved);return 0;
 }
 start();assert(status()[1]==Receiving);upload();
 if(scenario=="storage-failure")Preferences::failWrite=true;
 send(Finish);
 if(scenario=="storage-failure"){assert(status()[1]==Error&&status()[2]==Flash&&ends==1&&!boots&&!reserved);return 0;}
 assert(status()[1]==Restarting&&boots==1&&ends==1);
 assert(UpdatePublisher::minimumEpoch()==7);
 char retained[UpdatePublisher::ManifestCapacity];size_t length=0;assert(UpdatePublisher::copyRetainedManifest(retained,sizeof(retained),length));assert(length==strlen(manifestText)&&!strcmp(retained,manifestText));
 // Owner reset clears only coollamp. Immutable keys and lamptrust remain.
 Preferences::storage.erase("coollamp");assert(UpdatePublisher::minimumEpoch()==7);
 send(Finish);assert(boots==1&&ends==1);
 puts("PASS signed receiver: exact signature/image, retained original metadata, reset-retained epoch, commit once");
}
'''
prefs=r'''#pragma once
#include <map>
#include <string>
#include <vector>
#include <cstring>
#include <cstdint>
constexpr int PT_U32=1,PT_BLOB=2,PT_INVALID=0;
class Preferences {std::string scope;
 public:
 inline static std::map<std::string,std::map<std::string,std::vector<uint8_t>>> storage;
 inline static bool failOpen=false,failWrite=false;
 bool begin(const char* name,bool){scope=name;return !failOpen;}void end(){}
 bool isKey(const char* key){return storage[scope].count(key);}
 int getType(const char* key){return !isKey(key)?PT_INVALID:storage[scope][key].size()==4?PT_U32:PT_BLOB;}
 size_t getBytesLength(const char* key){const auto found=storage[scope].find(key);return found==storage[scope].end()?0:found->second.size();}
 size_t getBytes(const char* key,void* out,size_t n){const auto& bytes=storage[scope][key];if(n<bytes.size())return 0;memcpy(out,bytes.data(),bytes.size());return bytes.size();}
 size_t putBytes(const char* key,const void* p,size_t n){if(failWrite)return 0;const auto* bytes=static_cast<const uint8_t*>(p);storage[scope][key]={bytes,bytes+n};return n;}
 uint32_t getUInt(const char* key,uint32_t fallback){uint32_t result=fallback;if(getBytesLength(key)==4)getBytes(key,&result,4);return result;}
 size_t putUInt(const char* key,uint32_t v){return putBytes(key,&v,4);}
};
'''
version=data['manifest'].split('\n')[1]
legacy=f"COOLLAMP-OTA-1\n{version}\nesp32c3\ndual-ota-2031616\n512\n{data['sha256']}\n"
with tempfile.TemporaryDirectory(prefix='signed-receiver-',dir=ROOT/'.build') as folder:
    folder=Path(folder)
    fixture='const uint8_t image[]={'+','.join(map(str,data['artifact']))+'};\nconst char manifestText[]='+json.dumps(data['manifest'])+';\nconst char fixtureVersion[]='+json.dumps(version)+';\nconst char legacyManifest[]='+json.dumps(legacy)+';'
    trust='static constexpr UpdatePublisher::TrustedKey publisherKeys[]={{0x42,1,9,{'+','.join(str(b) for b in bytes.fromhex(data['publicKey']))+'}}};\nstatic constexpr uint32_t publisherMinimumEpoch=1;\n'
    for name,text in [('Arduino.h',constants['ARDUINO']),('esp_ota_ops.h',constants['SDK']),('esp_app_format.h',constants['FORMAT']),('Preferences.h',prefs),('fixture.h',fixture),('fixture-trust.h',trust),('test.cpp','#include "Preferences.h"\n'+cpp)]:
        (folder/name).write_text(text)
    includes=['-I'+str(folder),'-I'+str(ROOT),'-I'+str(ROOT/'tests'),'-I'+str(source/'include'),'-I'+str(source/'library')]
    defines=['-DMBEDTLS_CONFIG_FILE="publisher-host-mbedtls-config.h"','-DCOOL_LAMP_PUBLISHER_TRUST_CONFIG="fixture-trust.h"']
    objects=[]
    for name in scope['PRIMITIVES']:
        output=folder/(name+'.o');subprocess.run(['gcc','-std=c11',*SANITIZERS,*includes,*defines,'-c',str(source/'library'/(name+'.c')),'-o',str(output)],check=True);objects.append(str(output))
    binary=folder/'receiver.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,*includes,*defines,str(folder/'test.cpp'),str(ROOT/'LampBleUpdate.cpp'),str(ROOT/'UpdatePublisher.cpp'),*objects,'-o',str(binary)],check=True)
    for scenario in ['success','unsigned','bad-signature','wrong-epoch','trust-open-failure','storage-failure']:subprocess.run([str(binary),scenario],check=True)
    print('PASS 6 provisioned-mode production receiver cases; untracked ephemeral development key only')
