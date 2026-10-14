"""Actual Runtime links routes/auth -> bounded HTTP adapter -> durable link core.

The radio-busy getters and SDK storage/socket calls are fault-injected adapters.
No route, authorization, form parser or serving-policy implementation is copied.
"""
import ast
import base64
import json
from pathlib import Path
import re
import subprocess
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
end = routes.index(' server.on("/",HTTP_GET')
routes = routes[:end] + '\n}'
assert routes.count('server.on(') == 3
assert all(path in routes for path in ('"/api/bridge/links"', '"/api/bridge/links/receipt"'))
config = re.search(r'^struct Config .*;', runtime, re.M).group(0)
base = (ROOT / 'tests/http-server-runtime.cpp').read_text(encoding='utf-8').split('struct Fixture {', 1)[0]
owner = 'Basic ' + base64.b64encode(b'OWNER:development-bridge-password').decode('ascii')
lowercase = 'Basic ' + base64.b64encode(b'owner:development-bridge-password').decode('ascii')
wrong = 'Basic ' + base64.b64encode(b'OWNER:wrong-password').decode('ascii')
base = base.replace('Basic bGFtcDpkZXZlbG9wbWVudA==', owner)
base = base.replace('static char bulkPage[16385]{};', '[[maybe_unused]] static char bulkPage[16385]{};')
link_tree = ast.parse((ROOT / 'tests/bridge-lamp-links-runtime.py').read_text())
adapter_scope = {}
exec(compile(ast.Module(body=[node for node in link_tree.body if
    isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and
        target.id in ('PREFERENCES', 'NVS') for target in node.targets)], type_ignores=[]),
    'link_storage_adapters', 'exec'), adapter_scope)
# The real client uses platform URLSearchParams. Generate exactly those wire
# forms, then feed them to the production HTTP/form parser, not a fake decoder.
client = (ROOT / 'mobile/src/bridge-management.js').read_text(encoding='utf-8')
assert 'new URLSearchParams(fields).toString()' in client
forms = json.loads(subprocess.check_output(['node', '-e', '''
const common={deviceId:'8c4856dab734',target:'5894af4aec24',action:'remove',requestId:'0000000000000001',expectedBoot:'000000000000000b',expectedRevision:'1'};
const forms={remove:new URLSearchParams(common).toString(),receipt:new URLSearchParams({deviceId:common.deviceId,requestId:common.requestId,expectedBoot:common.expectedBoot}).toString()};process.stdout.write(JSON.stringify(forms));
'''], text=True))
fixture = base + r'''
#include "bridge/BridgeLampLinks.h"
#include "Preferences.h"
__CONFIG__
Config config;
char identity[13]="8c4856dab734";
bool configStorageFault=false,configWriteUncertain=false;
namespace LampCommission {bool workingFlag=false;bool working(){return workingFlag;}}
namespace BridgeControl {bool pending=false,unconsumed=false;bool policyChangeAllowed(){return !pending&&!unconsumed;}}
struct Donor {bool active=false;bool sending()const{return active;}} donor;
LampControlHttpAdapter server{80};
__AUTHORIZED__
__ANSWER__
__ROUTES__
const uint8_t lampMac[6]={0x24,0xec,0x4a,0xaf,0x94,0x58};
const char removeForm[]=__REMOVE_FORM__,receiptForm[]=__RECEIPT_FORM__;
static void finish(int fd){for(unsigned i=0;i<1000&&!sockets[fd].closed;++i){turn(server);runCloser();}assert(sockets[fd].closed);}
static std::string responseBody(int fd){const auto start=sockets[fd].outgoing.find("\r\n\r\n");assert(start!=std::string::npos);return sockets[fd].outgoing.substr(start+4);}
static void contains(int fd,const char* value){assert(sockets[fd].outgoing.find(value)!=std::string::npos);}
static int request(const std::string& wire){const int fd=connect(lastListener,wire);finish(fd);return fd;}
static std::string replace(std::string value,const std::string& from,const std::string& to){const auto at=value.find(from);assert(at!=std::string::npos);value.replace(at,from.size(),to);return value;}
static void fresh(){
 Preferences::storage.clear();Preferences::namespacePresent=false;Preferences::unavailable=Preferences::failWriteOpen=Preferences::wrongType=Preferences::keyLookupFailure=Preferences::keyReadFailure=false;Preferences::failure=Preferences::None;Preferences::opens=Preferences::reads=Preferences::writes=0;Preferences::replyFailureOnce=false;
 config=Config{};config.ownerPasswordSet=1;config.trusted=1;strcpy(config.access,"development-bridge-password");configStorageFault=configWriteUncertain=false;donor.active=BridgeControl::pending=BridgeControl::unconsumed=LampCommission::workingFlag=false;fakeStringReserveFailure=fakeOneReserve=false;fakeFreeHeap=fakeLargestFreeBlock=65536;
 assert(BridgeLampLinks::begin(identity,11));assert(BridgeLampLinks::allows(lampMac));
}
int main(){
 routes();server.begin();assert(lastListener&&sockets[lastListener].sendTimeoutUs==1000);fresh();
 int fd=request(get("/api/bridge/links",__OWNER__));contains(fd,"200 OK");contains(fd,"Content-Type: application/json");contains(fd,"Cache-Control: no-store");assert(responseBody(fd).find("\"deviceId\":\"8c4856dab734\"")!=std::string::npos&&!Preferences::writes);
 const auto initialReads=Preferences::reads,initialOpens=Preferences::opens;
 for(unsigned i=0;i<10;++i){fd=request(get("/api/bridge/links",__LOWER__));contains(fd,"200 OK");}assert(Preferences::reads==initialReads&&Preferences::opens==initialOpens&&!Preferences::writes);
 fd=request(get("/api/bridge/links",__WRONG__));contains(fd,"401 Unauthorized");contains(fd,"WWW-Authenticate: Basic");
 fd=request(post("/api/bridge/links",removeForm,"wrong-token"));contains(fd,"403 Forbidden");assert(!Preferences::writes);
 fd=request(post("/api/bridge/links",removeForm,""));contains(fd,"403 Forbidden");assert(!Preferences::writes);
 fd=request(replace(post("/api/bridge/links",removeForm,lampToken),__OWNER__,__WRONG__));contains(fd,"401 Unauthorized");assert(!Preferences::writes);
 fd=request(post("/api/bridge/links",replace(removeForm,"8c4856dab734","8c4856dab736"),lampToken));contains(fd,"409 Conflict");assert(!Preferences::writes);
 fd=request(post("/api/bridge/links",replace(removeForm,"expectedRevision=1","expectedRevision=x"),lampToken));contains(fd,"400 Bad Request");contains(fd,"Content-Type: application/json");assert(!Preferences::writes);
 fd=request(post("/api/bridge/links",replace(removeForm,"expectedBoot=000000000000000b","expectedBoot=0000000000000016"),lampToken));contains(fd,"409 Conflict");assert(!Preferences::writes);
 config.trusted=0;fd=request(post("/api/bridge/links",removeForm,lampToken));contains(fd,"409 Conflict");assert(!Preferences::writes);config.trusted=1;
 std::cout<<"PASS actual bridge HTTP routes: OWNER/owner auth, wrong auth401, CSRF403, exact bridge/boot/revision fields400/409, side-effect-free GET\n";
 for(unsigned busy=0;busy<6;++busy){
  fresh();donor.active=busy==0;BridgeControl::pending=busy==1;BridgeControl::unconsumed=busy==2;LampCommission::workingFlag=busy==3;configStorageFault=busy==4;configWriteUncertain=busy==5;
  fd=request(post("/api/bridge/links",removeForm,lampToken));contains(fd,"409 Conflict");contains(fd,"Content-Type: application/json");assert(responseBody(fd).find("\"executed\":false")!=std::string::npos&&!Preferences::writes&&BridgeLampLinks::allows(lampMac));
 }
 fresh();fd=request(post("/api/bridge/links",removeForm,lampToken));contains(fd,"200 OK");assert(Preferences::writes==1&&!BridgeLampLinks::allows(lampMac));
 fd=request(post("/api/bridge/links",removeForm,lampToken));contains(fd,"200 OK");assert(Preferences::writes==1);
 // A POST receipt is a read: owner auth is required, mutation token is not.
 fd=request(post("/api/bridge/links/receipt",receiptForm,""));contains(fd,"200 OK");contains(fd,"Content-Type: application/json");assert(responseBody(fd).find("\"persisted\":true")!=std::string::npos&&Preferences::writes==1);
 fd=request(replace(post("/api/bridge/links/receipt",receiptForm,""),__OWNER__,__WRONG__));contains(fd,"401 Unauthorized");
 fd=request(post("/api/bridge/links/receipt",replace(receiptForm,"8c4856dab734","8c4856dab736"),""));contains(fd,"409 Conflict");
 assert(BridgeLampLinks::begin(identity,22));fd=request(post("/api/bridge/links/receipt",receiptForm,""));contains(fd,"409 Conflict");contains(fd,"Content-Type: application/json");assert(responseBody(fd).find("\"found\":false")!=std::string::npos&&!BridgeLampLinks::allows(lampMac)&&Preferences::writes==1);
 std::cout<<"PASS actual bridge HTTP routes: donor/active/unconsumed/commission/storage busy before writes, duplicate receipt, remove/reboot persistence, owner-only receipt read\n";
 fresh();Preferences::replyFailureOnce=true;fd=request(post("/api/bridge/links",removeForm,lampToken));contains(fd,"507 Insufficient Storage");assert(responseBody(fd).find("Check the saved result")!=std::string::npos&&Preferences::writes==1&&!BridgeLampLinks::allows(lampMac));
 fd=request(post("/api/bridge/links/receipt",receiptForm,""));contains(fd,"200 OK");assert(responseBody(fd).find("\"executed\":true")!=std::string::npos&&Preferences::writes==1);
 fresh();Preferences::failure=Preferences::AppliedButShort;fd=request(post("/api/bridge/links",removeForm,lampToken));contains(fd,"507 Insufficient Storage");contains(fd,"Content-Type: application/json");assert(responseBody(fd).find("\"executed\":null")!=std::string::npos&&responseBody(fd).find("\"uncertain\":true")!=std::string::npos&&Preferences::writes==1&&!BridgeLampLinks::ready());
 Preferences::failure=Preferences::None;BridgeLampLinks::service(millis());fd=request(post("/api/bridge/links/receipt",receiptForm,""));contains(fd,"200 OK");assert(responseBody(fd).find("\"persisted\":true")!=std::string::npos&&!BridgeLampLinks::allows(lampMac)&&Preferences::writes==1);
 Preferences::keyLookupFailure=true;assert(!BridgeLampLinks::begin(identity,11));const auto unreadableReads=Preferences::reads;
 fd=request(get("/api/bridge/links",__OWNER__));contains(fd,"200 OK");assert(responseBody(fd).find("\"ready\":false")!=std::string::npos&&Preferences::reads==unreadableReads&&!BridgeLampLinks::allows(lampMac));
 config.ownerPasswordSet=0;fd=request(get("/api/bridge/links",__OWNER__));contains(fd,"409 Conflict");assert(Preferences::writes==1);
 assert(!server.hasActiveClients());std::cout<<"PASS actual bridge HTTP routes: empty reply507 after durable write, original receipt reconciliation without replay, uncertain JSON error, unreadable RAM snapshot\n";
}
'''
fixture = fixture.replace('__CONFIG__', config).replace('__AUTHORIZED__', function('authorized')).replace(
    '__ANSWER__', function('answerLinks')).replace('__ROUTES__', routes).replace(
    '__REMOVE_FORM__', json.dumps(forms['remove'])).replace('__RECEIPT_FORM__', json.dumps(forms['receipt']))
for placeholder, value in [('__OWNER__', owner), ('__LOWER__', lowercase), ('__WRONG__', wrong)]:
    fixture = fixture.replace(placeholder, json.dumps(value))
with tempfile.TemporaryDirectory(prefix='bridge-links-http-', dir=ROOT / '.build') as folder:
    folder = Path(folder)
    for original in (ROOT / 'tests/http-server-stubs').rglob('*'):
        if original.is_file() and original.name != 'Arduino.h':
            target = folder / original.relative_to(ROOT / 'tests/http-server-stubs')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(original.read_bytes())
    arduino = (ROOT / 'tests/http-server-stubs/Arduino.h').read_text().replace(
        'inline bool fakeStringReserveFailure=false;',
        'inline bool fakeStringReserveFailure=false,fakeOneReserve=false;').replace(
        'if(fakeStringReserveFailure)return false;',
        'if(fakeStringReserveFailure){if(fakeOneReserve){fakeStringReserveFailure=false;fakeOneReserve=false;}return false;}')
    preferences = adapter_scope['PREFERENCES'].replace(
        '#include <stdint.h>', '#include <Arduino.h>\n#include <stdint.h>').replace(
        'inline static unsigned opens=0,reads=0,writes=0;',
        'inline static unsigned opens=0,reads=0,writes=0; inline static bool replyFailureOnce=false;').replace(
        '++writes;namespacePresent=true;',
        '++writes;namespacePresent=true;if(replyFailureOnce){replyFailureOnce=false;fakeStringReserveFailure=fakeOneReserve=true;}')
    (folder / 'Arduino.h').write_text(arduino)
    (folder / 'Preferences.h').write_text(preferences)
    (folder / 'nvs.h').write_text(adapter_scope['NVS'])
    source, binary = folder / 'fixture.cpp', folder / 'fixture.exe'
    source.write_text(fixture, encoding='utf-8')
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                    '-Wno-unused-function', '-Wno-misleading-indentation', *SANITIZERS,
                    '-I' + str(folder), '-I' + str(ROOT / 'tests/http-server-stubs'),
                    '-I' + str(ROOT), str(source), str(ROOT / 'LampHttpServer.cpp'),
                    str(ROOT / 'bridge/BridgeLampLinks.cpp'), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
