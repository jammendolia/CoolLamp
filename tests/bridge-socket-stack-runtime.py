"""Actual detached worker allocation: unchanged lamp default and S3 override."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
fixture = (ROOT / 'tests/http-socket-cleanup-runtime.cpp').read_text(encoding='utf-8').split('int main(', 1)[0]
fixture = fixture.replace('static TaskFunction_t worker=nullptr;',
                          'static TaskFunction_t worker=nullptr;\n'
                          'static uint32_t expectedStack=2048,allocatedStack=0;\n'
                          'static unsigned queueCalls=0,taskCalls=0;')
fixture = fixture.replace('assert(n==4&&bytes==sizeof(Request));',
                          '++queueCalls;assert(n==4&&bytes==sizeof(Request));')
fixture = fixture.replace('assert(!strcmp(name,"lamp-http-close")&&stack==2048&&priority==1);',
                          '++taskCalls;allocatedStack=stack;'
                          'assert(!strcmp(name,"lamp-http-close")&&stack==expectedStack&&priority==1);')
fixture += r'''
int main(int argc,char** argv){
 assert(argc==2);const std::string scenario=argv[1];
 for(uint32_t invalid:{0u,2047u,8193u,UINT32_MAX})assert(!start(invalid));
 assert(!queueCalls&&!taskCalls&&!allocatedStack&&taskStackMinimumBytes()==0);
 if(scenario=="default"){
  assert(start()&&allocatedStack==2048&&queueCalls==1&&taskCalls==1);
  assert(start(4096)&&allocatedStack==2048&&queueCalls==1&&taskCalls==1);
 }else if(scenario=="bridge"){
  expectedStack=4096;assert(start(4096)&&allocatedStack==4096&&queueCalls==1&&taskCalls==1);
  assert(start()&&start(8192)&&allocatedStack==4096&&queueCalls==1&&taskCalls==1);
 }else if(scenario=="upper-bound"){
  expectedStack=8192;assert(start(8192)&&allocatedStack==8192&&queueCalls==1&&taskCalls==1);
 }else if(scenario=="bridge-retry"){
  expectedStack=4096;queueFailure=true;assert(!start(4096)&&queueCalls==1&&!taskCalls);
  queueFailure=false;taskFailure=true;assert(!start(4096)&&queueCalls==2&&taskCalls==1&&queueDeleted&&taskStackMinimumBytes()==0);
  taskFailure=false;assert(start(4096)&&allocatedStack==4096&&queueCalls==3&&taskCalls==2);
 }else assert(false);
 const unsigned created=taskCalls,queues=queueCalls;
 for(uint32_t invalid:{0u,2047u,8193u,UINT32_MAX})assert(!start(invalid));
 assert(taskCalls==created&&queueCalls==queues&&taskStackMinimumBytes()==800);
 create(70);assert(enqueue({70,0,0,5000,false}));runWorker();
 assert(peers[70].closed&&metrics().pendingOwned==0&&metrics().queued==1&&!abortCalls&&closeCalls==1);
 std::cout<<"PASS production close worker stack "<<scenario<<": requested bytes, bounds, idempotence, ownership\n";
}
'''
with tempfile.TemporaryDirectory(prefix='bridge-socket-stack-', dir=ROOT / '.build') as temporary:
    folder = Path(temporary)
    source, binary = folder / 'fixture.cpp', folder / 'fixture.exe'
    source.write_text(fixture, encoding='utf-8')
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                    '-Wno-unused-function', '-Wno-misleading-indentation', *SANITIZERS,
                    '-I' + str(ROOT / 'tests/http-socket-cleanup-stubs'), '-I' + str(ROOT),
                    str(source), str(ROOT / 'LampHttpSocketCleanup.cpp'), '-o', str(binary)], check=True)
    for scenario in ('default', 'bridge', 'upper-bound', 'bridge-retry'):
        subprocess.run([str(binary), scenario], check=True)
