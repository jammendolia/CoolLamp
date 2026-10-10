"""Production signed-manifest verifier with pinned real P256/SHA256 primitives."""
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
fixture=json.loads((ROOT/'.build/publisher-fixtures/fixture.json').read_text())
tree=ast.parse((ROOT/'tests/espnow-runtime.py').read_text())
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='verified_source' or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('SOURCE','ARCHIVE_SHA','PRIMITIVES') for t in n.targets)]
scope=dict(Path=Path,hashlib=hashlib,json=json,tarfile=tarfile)
exec(compile(ast.Module(body=nodes,type_ignores=[]),'verified_source','exec'),scope)
scope['PRIMITIVES']+=['bignum','bignum_core','bignum_mod','bignum_mod_raw','ecp','ecp_curves','ecp_curves_new','ecdh','hkdf','ecdsa','asn1parse','asn1write']
source=scope['verified_source'](ROOT/'.build/tls-library')
with tempfile.TemporaryDirectory(prefix='publisher-',dir=ROOT/'.build') as folder:
    folder=Path(folder)
    (folder/'Preferences.h').write_text('''#pragma once
#include <stdint.h>
#include <stddef.h>
constexpr int PT_U32=1;
class Preferences {public:bool begin(const char*,bool){return true;}void end(){}bool isKey(const char*){return false;}int getType(const char*){return PT_U32;}uint32_t getUInt(const char*,uint32_t x){return x;}size_t putUInt(const char*,uint32_t){return 4;}size_t putBytes(const char*,const void*,size_t n){return n;}size_t getBytesLength(const char*){return 0;}size_t getBytes(const char*,void*,size_t){return 0;}};
''')
    code='''#include "UpdatePublisher.h"
#include <cassert>
#include <cstring>
#include <string>
#include <iostream>
using namespace UpdatePublisher;
int main(){
const char text[]='''+json.dumps(fixture['manifest'])+''';
TrustedKey key{0x42,1,9,{'''+','.join(str(b) for b in bytes.fromhex(fixture['publicKey']))+'''}};
const uint16_t minimum[]={0,0,0};Manifest result;
assert(verify(text,strlen(text),&key,1,1,minimum,result)&&result.epoch==7&&result.keyId==0x42&&result.image.size==512);
Manifest maximum=result;for(auto& n:maximum.image.version)n=65535;maximum.image.size=2031616;maximum.epoch=UINT32_MAX-1;maximum.keyId=UINT32_MAX;
char bounded[ManifestCapacity];size_t maximumLength=0;assert(format(maximum,bounded,sizeof(bounded),maximumLength)&&maximumLength==280&&maximumLength<ManifestCapacity);
assert(!enforced()&&!verifyProvisioned(text,strlen(text),result));
assert(!verify(text,strlen(text),&key,1,8,minimum,result));
key.lastEpoch=6;assert(!verify(text,strlen(text),&key,1,1,minimum,result));key.lastEpoch=9;
key.firstEpoch=8;assert(!verify(text,strlen(text),&key,1,1,minimum,result));key.firstEpoch=1;
key.id=0x43;assert(!verify(text,strlen(text),&key,1,1,minimum,result));key.id=0x42;
TrustedKey duplicate[2]={key,key};assert(!verify(text,strlen(text),duplicate,2,1,minimum,result));
uint16_t newer[]={65535,65535,65535};assert(!verify(text,strlen(text),&key,1,1,newer,result));
std::string tampered=text;for(size_t i=0;i<tampered.size();++i){tampered[i]^=1;assert(!verify(tampered.data(),tampered.size(),&key,1,1,minimum,result));tampered[i]^=1;}
assert(!verify(text,strlen(text)-1,&key,1,1,minimum,result));tampered=text;tampered+='x';assert(!verify(tampered.data(),tampered.size(),&key,1,1,minimum,result));
key.publicKey[20]^=1;assert(!verify(text,strlen(text),&key,1,1,minimum,result));
std::cout<<"PASS publisher signature: canonical metadata, every-byte tamper, wrong key/epoch/chip, anti-rollback, rotation bounds, absent provisioning\\n";
}
'''
    (folder/'test.cpp').write_text(code)
    includes=['-I'+str(folder),'-I'+str(ROOT),'-I'+str(ROOT/'tests'),'-I'+str(source/'include'),'-I'+str(source/'library')]
    defines=['-DMBEDTLS_CONFIG_FILE="publisher-host-mbedtls-config.h"']
    objects=[]
    for name in scope['PRIMITIVES']:
        output=folder/(name+'.o')
        subprocess.run(['gcc','-std=c11',*SANITIZERS,*includes,*defines,'-c',str(source/'library'/(name+'.c')),'-o',str(output)],check=True)
        objects.append(str(output))
    binary=folder/'publisher.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,*includes,*defines,str(folder/'test.cpp'),str(ROOT/'UpdatePublisher.cpp'),*objects,'-o',str(binary)],check=True)
    subprocess.run([str(binary)],check=True)
