"""Production bridge HTTP routes/auth -> bounded form server -> real mesh pager.

The socket/clock and lamp handler are adapters. Bridge authorization, route
field extraction, bounded HTTP parser/form handling, AES-GCM mesh transaction,
execution receipt and result paging are the production implementations.
"""
import ast
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
runtime = (ROOT / 'bridge/BridgeRuntime.cpp').read_text(encoding='utf-8')
extractor = ast.parse((ROOT / 'tests/bridge-runtime-contracts.py').read_text())
scope = dict(re=re, runtime=runtime)
exec(compile(ast.Module(body=[node for node in extractor.body if
    isinstance(node, ast.FunctionDef) and node.name == 'function'], type_ignores=[]),
    'production_function_extractor', 'exec'), scope)
function = scope['function']
routes = function('routes')
begin = routes.index(' server.on("/api/mesh/request"')
end = routes.index(' server.on("/api/bridge/wifi"', begin)
routes = 'void routes(){\n' + routes[begin:end] + '\n}'
assert routes.count('server.on(') == 3
assert 'BridgeControl::request(server.arg("target")' in routes
assert 'BridgeControl::result(server.arg("target")' in routes

base = (ROOT / 'tests/http-server-runtime.cpp').read_text(encoding='utf-8').split('struct Fixture {', 1)[0]
owner = 'Basic ' + base64.b64encode(b'OWNER:development-bridge-password').decode('ascii')
base = base.replace('Basic bGFtcDpkZXZlbG9wbWVudA==', owner)
base = base.replace('static char bulkPage[16385]{};', '[[maybe_unused]] static char bulkPage[16385]{};')
# Use the actual browser's native form encoder, including an empty body value.
client = (ROOT / 'bridge/BridgePage.js').read_text(encoding='utf-8')
assert 'new URLSearchParams(fields).toString()' in client
forms = json.loads(subprocess.check_output(['node', '-e', '''
const fields={target:'5894af4aec24',requestId:'0000000000000001',endpoint:1,method:1,body:'',targetBoot:'0000000000002713'};
const result={target:fields.target,requestId:fields.requestId,offset:'0',targetBoot:fields.targetBoot};
process.stdout.write(JSON.stringify({request:new URLSearchParams(fields).toString(),result:new URLSearchParams(result).toString()}));
'''], text=True))

fixture = base + r'''
#include "bridge/BridgeControl.h"
#include "LampSyncRadioCrypto.h"
#include <mbedtls/base64.h>
struct {char access[33]="development-bridge-password";bool ownerPasswordSet=true;} config;
LampControlHttpAdapter server{80};
__AUTHORIZED__
__ANSWER__
__ROUTES__
namespace {
const uint8_t addresses[2][6]={{0x34,0xb7,0xda,0x56,0x48,0x8c},{0x24,0xec,0x4a,0xaf,0x94,0x58}};
uint8_t fleet[16]{};
LampMesh::Core target;
struct Frame {unsigned origin;std::vector<uint8_t> bytes;};
std::deque<Frame> frames;
unsigned targetCalls=0;
std::string stateBody;
bool trust(void*,const uint8_t* address){return LampMeshWire::mac(address);}
bool sendRadio(void* context,const uint8_t* bytes,size_t size){frames.push_back({unsigned(reinterpret_cast<uintptr_t>(context)),{bytes,bytes+size}});return true;}
bool copyKey(void*,uint8_t* out){memcpy(out,fleet,16);return true;}
String fleetId(void*){return "1122334455667788";}
uint16_t executeLamp(void*,const uint8_t*,uint64_t,const uint8_t* request,size_t size,uint8_t* response,size_t capacity,size_t& used){
 assert(size==2&&request[0]==1&&request[1]==1);++targetCalls;
 used=stateBody.size();assert(used==5529&&used<=capacity);memcpy(response,stateBody.data(),used);return 200;
}
void meshTurn(){
 clockUs+=1000;BridgeControl::service(millis(),true);target.service(millis());
 while(!frames.empty()){
  auto value=std::move(frames.front());frames.pop_front();
  if(value.origin==0)target.receive(addresses[0],value.bytes.data(),value.bytes.size(),millis());
  else assert(BridgeControl::enqueueReceive(addresses[1],value.bytes.data(),value.bytes.size(),millis()));
 }
}
void finish(int fd){for(unsigned turnCount=0;turnCount<1000&&!sockets[fd].closed;++turnCount){turn(server);runCloser();}assert(sockets[fd].closed);}
int request(const std::string& wire){const int fd=connect(lastListener,wire);finish(fd);return fd;}
std::string responseBody(int fd){const auto begin=sockets[fd].outgoing.find("\r\n\r\n");assert(begin!=std::string::npos);return sockets[fd].outgoing.substr(begin+4);}
void contains(int fd,const char* value){assert(sockets[fd].outgoing.find(value)!=std::string::npos);}
std::string replace(std::string value,const std::string& old,const std::string& replacement){const auto at=value.find(old);assert(at!=std::string::npos);value.replace(at,old.size(),replacement);return value;}
std::string field(const std::string& json,const char* key){const auto prefix=std::string("\"")+key+"\":\"";const auto begin=json.find(prefix);assert(begin!=std::string::npos);const auto at=begin+prefix.size(),end=json.find('"',at);assert(end!=std::string::npos);return json.substr(at,end-at);}
unsigned numeric(const std::string& json,const char* key){const auto prefix=std::string("\"")+key+"\":";const auto begin=json.find(prefix);assert(begin!=std::string::npos);return unsigned(std::stoul(json.substr(begin+prefix.size())));}
std::string pageData(const std::string& json){const auto encoded=field(json,"data");uint8_t decoded[257]{};size_t used=0;assert(!mbedtls_base64_decode(decoded,sizeof(decoded),&used,reinterpret_cast<const uint8_t*>(encoded.data()),encoded.size()));assert(used<=256);return {reinterpret_cast<const char*>(decoded),used};}
}
int main(){
 lampToken="0123456789abcdef0123456789abcdef";
 for(unsigned i=0;i<16;++i)fleet[i]=uint8_t(i+1);
 stateBody="{\"deviceId\":\"5894af4aec24\",\"name\":\"Corkscrew CoolLamp\",\"power\":true,\"brightness\":100,\"mode\":4,\"padding\":\"";
 assert(stateBody.size()+2<5529);stateBody.append(5529-stateBody.size()-2,'x');stateBody+="\"}";assert(LampHttpJson::complete(stateBody.data(),stateBody.size()));
 BridgeControl::Hooks hooks;hooks.copyFleetKey=copyKey;hooks.fleetId=fleetId;hooks.send=sendRadio;
 assert(BridgeControl::begin(addresses[0],10001,"Hall bridge","0.2.2",hooks));
 LampMesh::Hooks targetHooks;targetHooks.context=reinterpret_cast<void*>(uintptr_t(1));targetHooks.trusted=trust;targetHooks.send=sendRadio;targetHooks.execute=executeLamp;
 assert(target.begin(addresses[1],fleet,10003,targetHooks));target.setAnnouncement("Corkscrew CoolLamp","1.15.4",true);
 for(unsigned i=0;i<6000;++i)meshTurn();assert(BridgeControl::online(addresses[1]));
 routes();server.begin();assert(lastListener&&sockets[lastListener].sendTimeoutUs==1000);
 const std::string requestForm=__REQUEST_FORM__,resultForm=__RESULT_FORM__;
 int fd=request(post("/api/mesh/request",requestForm,"wrong-token"));contains(fd,"403 Forbidden");assert(!targetCalls&&BridgeControl::diagnosticJson().find("\"requestsSubmitted\":0")!=std::string::npos);
 fd=request(post("/api/mesh/request",requestForm,lampToken));contains(fd,"202 Accepted");contains(fd,"Content-Type: application/json");
 auto initial=responseBody(fd);assert(LampHttpJson::complete(initial.data(),initial.size()));assert(field(initial,"target")=="5894af4aec24"&&field(initial,"requestId")=="0000000000000001"&&field(initial,"status")=="pending"&&!targetCalls);
 fd=request(get("/api/mesh/result?"+resultForm,__OWNER__));contains(fd,"200 OK");assert(field(responseBody(fd),"status")=="pending"&&!targetCalls);
 fd=request(get("/api/mesh/result?"+replace(resultForm,"0000000000002713","0000000000002714"),__OWNER__));contains(fd,"409 Conflict");assert(!targetCalls);
 for(unsigned i=0;i<3000;++i)meshTurn();assert(targetCalls==1);
 assert(BridgeControl::diagnosticJson().find("\"state\":\"complete\"")!=std::string::npos);
 assert(BridgeControl::diagnosticJson().find("\"consumed\":false")!=std::string::npos);
 // The duplicate request reconciles the retained first page; it cannot replay.
 fd=request(post("/api/mesh/request",requestForm,lampToken));contains(fd,"200 OK");assert(field(responseBody(fd),"status")=="ok"&&targetCalls==1);
 std::string assembled;unsigned pages=0;
 while(assembled.size()<5529){
  const auto fields=replace(resultForm,"offset=0","offset="+std::to_string(assembled.size()));
  // Exercise both actual supported result routes/form parsers, including GET
  // query decoding on every odd page and the final 153-byte page.
  fd=request(pages%2?get("/api/mesh/result?"+fields,__OWNER__):post("/api/mesh/result",fields,lampToken));contains(fd,"200 OK");contains(fd,"Content-Type: application/json");
  const auto page=responseBody(fd);assert(LampHttpJson::complete(page.data(),page.size()));
  assert(field(page,"target")=="5894af4aec24"&&field(page,"requestId")=="0000000000000001"&&field(page,"targetBoot")=="0000000000002713"&&field(page,"status")=="ok");
  assert(page.find("\"executed\":true")!=std::string::npos&&page.find("\"uncertain\":false")!=std::string::npos);
  assert(numeric(page,"httpStatus")==200&&numeric(page,"total")==5529&&numeric(page,"offset")==assembled.size());
  const auto data=pageData(page);assert(data.size()==std::min<size_t>(256,5529-assembled.size()));assembled+=data;++pages;
 }
 assert(pages==22&&assembled==stateBody&&targetCalls==1);
 assert(BridgeControl::diagnosticJson().find("\"consumed\":true")!=std::string::npos);
 fd=request(get("/api/mesh/result?"+replace(resultForm,"offset=0","offset=5530"),__OWNER__));contains(fd,"400 Bad Request");
 fd=request(get("/api/mesh/result?"+replace(resultForm,"0000000000000001","0000000000000002"),__OWNER__));contains(fd,"404 Not Found");
 fd=request(get("/api/mesh/result?"+replace(resultForm,"0000000000002713","0000000000002714"),__OWNER__));contains(fd,"409 Conflict");
 assert(targetCalls==1&&!server.hasActiveClients()&&!server.metrics().responseFailures&&!server.metrics().deadlines);
 std::cout<<"PASS production bridge mesh HTTP: OWNER auth/token403, URLSearchParams empty body, pending GET query, target session409, one real AES-GCM execution, duplicate receipt without replay,5529bytes/22pages GET+POST, final consumption, invalid offset400/missing404, bounded HTTP no response failures\n";
}
'''
fixture = fixture.replace('__AUTHORIZED__', function('authorized')).replace('__ANSWER__', function('answer')).replace('__ROUTES__', routes)
for name, value in [('__OWNER__', owner), ('__REQUEST_FORM__', forms['request']), ('__RESULT_FORM__', forms['result'])]:
    fixture = fixture.replace(name, json.dumps(value))

crypto_tree = ast.parse((ROOT / 'tests/espnow-runtime.py').read_text())
nodes = [node for node in crypto_tree.body if
    isinstance(node, ast.FunctionDef) and node.name == 'verified_source' or
    isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and
        target.id in ('SOURCE', 'ARCHIVE_SHA', 'PRIMITIVES') for target in node.targets)]
crypto_scope = dict(Path=Path, hashlib=hashlib, json=json, tarfile=tarfile)
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'verified_crypto_source', 'exec'), crypto_scope)
crypto_scope['PRIMITIVES'] += ['base64']
crypto_source = crypto_scope['verified_source'](ROOT / '.build/tls-library')
with tempfile.TemporaryDirectory(prefix='bridge-mesh-http-', dir=ROOT / '.build') as temporary:
    folder = Path(temporary)
    (folder / 'bridge-mbedtls-config.h').write_text('#pragma once\n#include "espnow-host-mbedtls-config.h"\n#define MBEDTLS_BASE64_C\n')
    includes = ['-I' + str(ROOT / 'tests/http-server-stubs'), '-I' + str(ROOT),
                '-I' + str(ROOT / 'tests'), '-I' + str(folder),
                '-I' + str(crypto_source / 'include'), '-I' + str(crypto_source / 'library')]
    defines = ['-DMBEDTLS_CONFIG_FILE="bridge-mbedtls-config.h"']
    objects = []
    for name in crypto_scope['PRIMITIVES']:
        output = folder / (name + '.o')
        subprocess.run(['gcc', '-std=c11', *SANITIZERS, *includes, *defines, '-c',
                        str(crypto_source / 'library' / (name + '.c')), '-o', str(output)], check=True)
        objects.append(str(output))
    source, binary = folder / 'fixture.cpp', folder / 'fixture.exe'
    source.write_text(fixture, encoding='utf-8')
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-pthread',
                    '-Wno-unused-function', '-Wno-misleading-indentation', *SANITIZERS,
                    *includes, *defines, str(source), str(ROOT / 'LampHttpServer.cpp'),
                    str(ROOT / 'bridge/BridgeControl.cpp'), str(ROOT / 'LampMeshCore.cpp'),
                    str(ROOT / 'LampMeshCrypto.cpp'), str(ROOT / 'LampSyncRadioCrypto.cpp'),
                    *objects, '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
