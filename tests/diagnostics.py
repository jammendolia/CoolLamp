"""Real diagnostic auth/read handler plus pinned count/write encoders; host only.

Reuse the allocation fixture's production source and exact core3.3.11 WString.
Hardware snapshot providers remain fixtures. No stand-in JSON encoder is used.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('diagnostic_builder_fixture',ROOT/'tests/status-builder-memory.py')
builders=importlib.util.module_from_spec(spec);spec.loader.exec_module(builders)

class HandlerTests(unittest.TestCase):
    def test_authentication_and_json(self):
        with tempfile.TemporaryDirectory(prefix='lamp-diagnostics-') as temp:
            directory=Path(temp)
            environment={**os.environ,'COOLLAMP_STATUS_FIXTURE_DIR':str(directory)}
            baseline=subprocess.run([sys.executable,str(ROOT/'tests/status-builder-memory.py')],env=environment,capture_output=True,text=True)
            self.assertEqual(baseline.returncode,0,baseline.stderr[-2500:])
            fixture=(directory/'builders.cpp').read_text()
            fixture=fixture.replace('int main(){','void memoryFixtureMain(){')
            fixture=fixture.replace('bool authorizedLampRequest(bool){return true;}',
                'bool allowed=false;bool authorizedLampRequest(bool mutation){assert(!mutation);return allowed;}')
            fixture=fixture.replace('Metrics measured{};String body;int status=0;',
                'Metrics measured{};String body;int status=0;unsigned calls=0;')
            fixture=fixture.replace('{status=code;body=', '{++calls;status=code;body=')
            fixture+='\n'+builders.extract.function((ROOT/'LampNetwork.ino').read_text(),'void sendLampDiagnostics()')
            fixture+=r'''
int main(){
 sceneConfig.count=1;strcpy(sceneConfig.order[0],identity);
 const auto beforeUnauthorized=stats.calls;
 sendLampDiagnostics();assert(!lampServer.calls&&stats.calls==beforeUnauthorized);
 const String usb=lampDiagnosticsJson();assert(usb.length()&&!lampServer.calls);
 allowed=true;sendLampDiagnostics();assert(lampServer.calls==1&&lampServer.status==200&&lampServer.body==usb);
 std::cout<<lampServer.body.c_str();
 // Fail an actual captured-leaf allocation, then recover with a fresh read.
 // The pinned production stress fixture has already swept every allocation.
 const auto failuresBefore=stats.failures;failAllocation=stats.calls+1;
 assert(lampDiagnosticsJson().isEmpty()&&stats.failures==failuresBefore+1);
 failAllocation=stats.calls+1;sendLampDiagnostics();assert(lampServer.status==503);
 failAllocation=0;sendLampDiagnostics();assert(lampServer.status==200&&lampServer.body==usb);
 // Reply admission is separate from captured platform data. This read gets
 // an honest failed result when the final allocation cannot retain its margin.
 lampServer.body=static_cast<const char*>(nullptr);heapBudget=8703;sendLampDiagnostics();assert(lampServer.status==503);
 heapBudget=327680;sendLampDiagnostics();assert(lampServer.status==200);
}
'''
            cpp,binary=directory/'diagnostics.cpp',directory/'diagnostics.exe';cpp.write_text(fixture)
            subprocess.run(['c++','-std=c++17','-fno-elide-constructors','-Wall','-Wextra','-Werror',
                            '-Wno-misleading-indentation','-Wno-sign-compare',*SANITIZERS,
                            '-I'+str(directory),'-I'+str(ROOT),str(cpp),str(directory/'WString.cpp'),'-o',str(binary)],check=True)
            result=subprocess.run([str(binary)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            data=json.loads(result.stdout)
        self.assertEqual(data['diagnosticsVersion'],1)
        self.assertEqual(data['deviceId'],'aabbccddeeff')
        self.assertFalse(data['wifi']['connected'])
        self.assertEqual(data['wifi']['accessPoint'],'')
        self.assertEqual(data['wifi']['rssi'],0)
        self.assertEqual(data['wifi']['powerSave'],0)
        self.assertEqual(data['render']['leds'],1024)
        self.assertEqual(data['audio']['errors'],0xffffffff)
        self.assertEqual(data['lampStyle'],{'version':1,'code':3,'id':'corkscrew','family':'corkscrew'})
        self.assertEqual(data['chipTemperature']['celsius'],125.0)
        for key in ('token','ssid','adminPassword','wifiPassword','key'):
            self.assertNotIn('"'+key+'"',json.dumps(data))

if __name__=='__main__':unittest.main()
