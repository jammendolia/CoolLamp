"""Real bridge authorization and flash page on the actual bounded HTTP server."""
from pathlib import Path
import base64
import re
import subprocess
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
fixture = (ROOT / 'tests/http-server-runtime.cpp').read_text(encoding='utf-8').split('int main(', 1)[0]
runtime = (ROOT / 'bridge/BridgeRuntime.cpp').read_text(encoding='utf-8')
authorization = re.search(r'^bool authorized\(bool mutation=false\)\{\n([\s\S]*?)\n\}', runtime, re.M)
if authorization is None:
    raise ValueError('Production bridge authorization helper was not found.')
start = fixture.index('  bool auth(bool mutation=false){')
end = fixture.index('\n  explicit Fixture(', start)
fixture = fixture[:start] + '  bool auth(bool mutation=false){\nowner();\n' + authorization[1] + '\n  }\n' + fixture[end:]
fixture = fixture.replace('#include "LampPage.h"',
                          '#include "bridge/BridgePage.h"\n#define LAMP_PAGE COOLLAMP_BRIDGE_PAGE')
fixture = fixture.replace('struct Fixture {',
                          'struct {char access[33]="ABCDEFGHIJKLMNOP";bool ownerPasswordSet=true;} config;\nstruct Fixture {', 1)
owner = 'Basic ' + base64.b64encode(b'owner:ABCDEFGHIJKLMNOP').decode('ascii')
uppercase = 'Basic ' + base64.b64encode(b'OWNER:ABCDEFGHIJKLMNOP').decode('ascii')
wrong = 'Basic ' + base64.b64encode(b'owner:wrong-password').decode('ascii')
fixture = fixture.replace('Basic bGFtcDpkZXZlbG9wbWVudA==', owner)
fixture += r'''
int main(){
 Fixture fixture;lampToken="0123456789abcdef0123456789abcdef";
 int fd=connect(fixture.listener,get("/","__OWNER__"));fixture.finish(fd);completeMappedPage(fd);assert(fixture.reads==1);
 fd=connect(fixture.listener,get("/","__UPPER__"));fixture.finish(fd);completeMappedPage(fd);assert(fixture.reads==2);
 fd=connect(fixture.listener,get("/","__WRONG__"));fixture.finish(fd);contains(fd,"401 Unauthorized");contains(fd,"WWW-Authenticate: Basic realm=\"CoolLamp\"");assert(fixture.reads==2);
 fd=connect(fixture.listener,get("/","Basic incorrect"));fixture.finish(fd);contains(fd,"401 Unauthorized");assert(fixture.reads==2);
 fd=connect(fixture.listener,post("/api/power","on=1",""));fixture.finish(fd);contains(fd,"403 Forbidden");assert(!fixture.mutations);
 fd=connect(fixture.listener,post("/api/power","on=1","wrong-token"));fixture.finish(fd);contains(fd,"403 Forbidden");assert(!fixture.mutations);
 std::string bad=post("/api/power","on=1",lampToken);const char* original="Authorization: __OWNER__";
 const auto at=bad.find(original);assert(at!=std::string::npos);bad.replace(at,strlen(original),"Authorization: __WRONG__");
 fd=connect(fixture.listener,bad);fixture.finish(fd);contains(fd,"401 Unauthorized");assert(!fixture.mutations);
 fd=connect(fixture.listener,post("/api/power","on=1",lampToken));fixture.finish(fd);contains(fd,"200 OK");assert(fixture.mutations==1);
 for(unsigned i=0;i<30;++i){fd=connect(fixture.listener,get(i%2?"/":"/api/state","__OWNER__"));fixture.finish(fd);contains(fd,"200 OK");assert(!detachedRequests.at(fd).cancelled);}
 assert(!fixture.server.metrics().deadlines&&!fixture.server.metrics().responseFailures&&!fixture.server.hasActiveClients());
 config.ownerPasswordSet=false;
 fd=connect(fixture.listener,get("/api/state","__OWNER__"));fixture.finish(fd);contains(fd,"409 Conflict");
 fd=connect(fixture.listener,post("/api/power","on=1",lampToken));fixture.finish(fd);contains(fd,"409 Conflict");assert(fixture.mutations==1);
 std::cout<<"PASS bridge production authorization+HTTP: owner/OWNER page, wrong password401, token-gated writes,30reads, unset-owner protected reads/writes409. Host SDK mocks do not prove physical stack headroom.\n";
}
'''.replace('__OWNER__', owner).replace('__UPPER__', uppercase).replace('__WRONG__', wrong)
with tempfile.TemporaryDirectory(prefix='bridge-http-', dir=ROOT / '.build') as temporary:
    folder = Path(temporary)
    source, binary = folder / 'fixture.cpp', folder / 'fixture.exe'
    source.write_text(fixture, encoding='utf-8')
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                    '-Wno-unused-function', '-Wno-misleading-indentation', *SANITIZERS,
                    '-I' + str(ROOT / 'tests/http-server-stubs'), '-I' + str(ROOT),
                    str(source), str(ROOT / 'LampHttpServer.cpp'), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
