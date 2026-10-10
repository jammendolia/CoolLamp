"""Actual household HTTP/RPC + light handlers, pinned HMAC, mobile verification."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS

ROOT=Path(__file__).resolve().parents[1]
tree=ast.parse((ROOT/'tests/espnow-runtime.py').read_text())
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='verified_source' or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('SOURCE','ARCHIVE_SHA','PRIMITIVES') for t in n.targets)]
scope=dict(Path=Path,hashlib=hashlib,json=json,tarfile=tarfile)
exec(compile(ast.Module(body=nodes,type_ignores=[]),'verified_source','exec'),scope)
scope['PRIMITIVES']+=['base64']
crypto=scope['verified_source'](ROOT/'.build/tls-library')
adapter=ast.parse((ROOT/'tests/control-http-adapter.py').read_text())
extract={};exec(compile(ast.Module(body=[n for n in adapter.body if isinstance(n,ast.FunctionDef) and n.name=='function'],type_ignores=[]),'extract','exec'),extract)
network=(ROOT/'LampNetwork.ino').read_text()
functions='\n'.join(extract['function'](network,name) for name in ['String jsonText(', 'bool readNumber(', 'bool authorizedLampRequest(', 'LampControlReply lampControlRequest('])
reset=ast.parse((ROOT/'tests/factory-reset-runtime.py').read_text())
preferences=next(ast.literal_eval(n.value) for n in reset.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PREFERENCES' for t in n.targets))

with tempfile.TemporaryDirectory(prefix='household-adapter-',dir=ROOT/'.build') as tmp:
    folder=Path(tmp)
    (folder/'Preferences.h').write_text('#pragma once\n#include "Arduino.h"\n'+preferences)
    arduino=(ROOT/'tests/control-stubs/Arduino.h').read_text().replace('0xaabbccddeeffULL','0x050403020102ULL').replace('  bool isEmpty()', '  void remove(size_t at){std::string::erase(at);}\n  bool isEmpty()')
    (folder/'Arduino.h').write_text(arduino)
    (folder/'WebServer.h').write_text((ROOT/'tests/control-stubs/WebServer.h').read_text())
    (folder/'esp_mac.h').write_text('#pragma once\n#include <stdint.h>\nconstexpr int ESP_MAC_WIFI_STA=0;\nint esp_read_mac(uint8_t*,int);\n')
    (folder/'esp_random.h').write_text('#pragma once\n#include <stdint.h>\n#ifdef __cplusplus\nextern "C" {\n#endif\nuint32_t esp_random(void);\n#ifdef __cplusplus\n}\n#endif\n')
    (folder/'adapter-crypto-config.h').write_text('#pragma once\n#include "espnow-host-mbedtls-config.h"\n#define MBEDTLS_BASE64_C\n')
    includes=['-I'+str(folder),'-I'+str(ROOT/'tests/control-stubs'),'-I'+str(ROOT),'-I'+str(ROOT/'tests'),'-I'+str(crypto/'include'),'-I'+str(crypto/'library')]
    define=['-DMBEDTLS_CONFIG_FILE="adapter-crypto-config.h"']
    objects=[]
    for name in scope['PRIMITIVES']:
        out=folder/(name+'.o')
        subprocess.run(['gcc','-std=c11',*SANITIZERS,*includes,*define,'-c',str(crypto/'library'/(name+'.c')),'-o',str(out)],check=True)
        objects.append(str(out))
    fixture=r'''
#include <cassert>
#include <iostream>
#include <fstream>
#include <vector>
#include "LampControlHttpAdapter.h"
#include "LampControl.h"
#include "LampConfig.h"
#include "LampVu.h"
#include "LampFountain.h"
#include "LampUpdate.h"
#include "LampSync.h"
#include "LampModel.h"
#include "UpdatePublisher.h"
#include "LampHousehold.h"
#include "esp_mac.h"
#include "esp_random.h"
LampControlHttpAdapter lampServer(80);LampSettings lampSettings{};
String lampToken="fixture-only-admin-token";uint32_t now=1000,apLastActivity=0;uint32_t millis(){return now;}
uint32_t esp_random(){static uint32_t value=19;value=value*1664525+1013904223;return value;}
int esp_read_mac(uint8_t* out,int){const uint8_t mac[6]{2,1,2,3,4,5};memcpy(out,mac,6);return 0;}
uint16_t NUM_LEDS=205,lampMidpoint=102;uint8_t Mode=4,Brightness=100;bool PowerOn=true;
bool following=false,updating=false,calibrating=false,resetting=false;uint8_t scene=0;unsigned uses=0;
const LampSyncWire::Visual* lampSyncVisual=nullptr;
bool lampSyncFollowing(){return following;}bool lampUpdateOwnsResources(){return updating;}bool lampCalibrationActive(){return calibrating;}bool lampFactoryResetPending(){return resetting;}
bool lampHasMicrophone(){return true;}constexpr uint8_t MODE_MAX=47;
uint8_t lampGroupScene(){return scene;}String lampStyleJson(){return "{\"id\":\"corkscrew\"}";}
void noteLampUpdateUse(){++uses;}bool leaveLampSceneForEffect(){return true;}void pauseLampSync(){}void syncLampKnob(){}
struct CRGB {inline static int Black=0;};int* leds=nullptr;void fill_solid(int*,uint16_t,int){}
struct {void setBrightness(uint8_t){}} FastLED;
namespace UpdatePublisher {bool enforced(){return false;}}
VuColor lampVuColors[3]={{1,2,3},{4,5,6},{7,8,9}};FountainColor lampFountainColors[3]{};bool lampFountainCustom=false;
uint32_t lampUpdatePolicyRevision(){return 1;}bool setLampUpdatePolicy(const LampUpdatePolicy::Policy&,uint32_t){return true;}bool lampUpdatePolicySaveUncertain(){return false;}String lampUpdatePolicyJson(){return "{}";}
#include "LampColors.ino"
#include "LampControl.ino"
'''+functions+r'''
#include "LampExperience.ino"
#include "LampHouseholdAdapter.ino"
std::string textField(const String& json,const char* name){const std::string key=std::string("\"")+name+"\":\"";const auto start=json.find(key);assert(start!=std::string::npos);const auto first=start+key.size(),last=json.find('"',first);assert(last!=std::string::npos);return json.substr(first,last-first);}
String lightForm(uint64_t command){return "target="+lampIdentity()+"&scope=lamp&bootSession="+commandHex(lightCommands.boot())+"&commandId="+commandHex(command)+"&expectedRevision="+String(lightCommands.currentRevision())+"&power=0&brightness=55";}
void http(const char* path,const std::map<std::string,String>& fields,bool admin=false){lampServer.arguments=fields;lampServer.httpAuthorized=admin;lampServer.headers["X-Lamp-Token"]=lampToken;lampServer.invokeHttp(path,HTTP_POST);}
void control(const LampHousehold::Authorization& a,const String& body){http("/api/household/control",{{"phone",householdHex(a.phone,8)},{"bootSession",commandHex(a.boot)},{"epoch",String(a.epoch)},{"sequence",String(a.sequence)},{"requestId",commandHex(a.requestId)},{"endpoint",String(a.endpoint)},{"method",String(a.method)},{"body",body},{"proof",householdHex(a.proof,32)}});}
int main(int argc,char** argv){
 assert(argc==2);using Result=LampHousehold::Result;Preferences::reset();strcpy(lampSettings.adminPassword,"fixture-only-admin-password");loadLampColors();loadLampAppearanceV2();beginLampExperience();
 lampServer.on("/api/household",HTTP_POST,handleLampHouseholdAdmin);lampServer.on("/api/household/challenge",HTTP_POST,handleLampHouseholdChallenge);lampServer.on("/api/household/control",HTTP_POST,handleLampHouseholdControl);
 lampServer.on("/api/state/patch",HTTP_POST,handleLampStatePatch);lampServer.on("/api/appearance/save",HTTP_POST,handleLampAppearanceSave);lampServer.on("/api/receipt",HTTP_POST,handleLampReceipt);
 lampServer.on("/api/revision",HTTP_GET,[](){lampServer.send(200,"application/json",lampRevisionJson());});
 const uint8_t phone[8]{1,2,3,4,5,6,7,8};const String phoneId=householdHex(phone,8);
 const String inviteForm="action=invite&phone="+phoneId+"&requestId=0000000000000001&expectedRevision="+String(LampHousehold::status().revision);
 http("/api/household",{{"action","invite"},{"phone",phoneId},{"requestId","0000000000000001"},{"expectedRevision",String(LampHousehold::status().revision)}},true);
 assert(lampServer.responseStatus==403&&!LampHousehold::status().pending&&lampServer.responseBody.find("secret")==String::npos);
 assert(lampServer.executeControl(48,true,inviteForm,false).status==403&&!LampHousehold::status().pending);
 const auto invitation=lampServer.executeControl(48,true,inviteForm,true);assert(invitation.status==200&&LampHousehold::status().pending==1&&!lampServer.controlActive()&&!lampServer.controlConfidential());
 const String grant=invitation.body;uint8_t secret[16]{};assert(householdUnhex(textField(grant,"secret"),secret,16));
 LampHousehold::Challenge challenge;assert(LampHousehold::challenge(phone,challenge)==Result::Accepted);uint8_t proof[32];assert(LampHousehold::adoptionProof(secret,challenge,1,proof));
 const auto adoption=std::map<std::string,String>{{"action","adopt"},{"phone",phoneId},{"requestId","0000000000000001"},{"proof",householdHex(proof,32)}};
 updating=true;http("/api/household/challenge",adoption);assert(lampServer.responseStatus==409&&!LampHousehold::status().active);updating=false;resetting=true;http("/api/household/challenge",adoption);assert(lampServer.responseStatus==409&&!LampHousehold::status().active);resetting=false;
 proof[0]^=1;auto tampered=adoption;tampered["proof"]=householdHex(proof,32);http("/api/household/challenge",tampered);assert(lampServer.responseStatus==409&&!LampHousehold::status().active);proof[0]^=1;
 http("/api/household/challenge",adoption);assert(lampServer.responseStatus==200&&LampHousehold::status().active==1);const auto adoptedRevision=LampHousehold::status().revision;
 http("/api/household/challenge",adoption);assert(lampServer.responseStatus==200&&LampHousehold::status().revision==adoptedRevision); // lost ACK reconciliation
 http("/api/household/challenge",{{"action","challenge"},{"phone",phoneId}});assert(lampServer.responseStatus==200);const String challengeJson=lampServer.responseBody;
 LampHousehold::Authorization a;memcpy(a.phone,phone,8);a.epoch=challenge.epoch;a.boot=challenge.boot;a.sequence=1;a.requestId=10;a.endpoint=42;a.method=2;
 const String body=lightForm(1);assert(LampHousehold::commandProof(secret,challenge,a,reinterpret_cast<const uint8_t*>(body.c_str()),body.size(),a.proof));
 a.proof[0]^=1;control(a,body);assert(lampServer.responseStatus==409&&PowerOn&&Brightness==100&&!uses);a.proof[0]^=1;
 control(a,body);assert(lampServer.responseStatus==200&&!PowerOn&&Brightness==55);const auto executedUses=uses;const String response=lampServer.responseBody;assert(response.size()<16384);
 auto encoded=textField(response,"body");uint8_t raw[8192]{};size_t length=0;assert(!mbedtls_base64_decode(raw,sizeof(raw),&length,reinterpret_cast<const uint8_t*>(encoded.data()),encoded.size()));uint8_t expected[32],actual[32];assert(householdUnhex(textField(response,"proof"),actual,32));assert(LampHousehold::responseProof(secret,challenge,a,200,raw,length,expected)&&!memcmp(actual,expected,32));
 assert(lampServer.outputHeaders["Cache-Control"]=="no-store");control(a,body);assert(lampServer.responseStatus==409&&uses==executedUses&&!PowerOn&&Brightness==55);
 auto privateCommand=a;privateCommand.sequence=2;privateCommand.endpoint=22;privateCommand.requestId=11;assert(LampHousehold::commandProof(secret,challenge,privateCommand,nullptr,0,privateCommand.proof));control(privateCommand,String());assert(lampServer.responseStatus==409&&uses==executedUses);
 std::ofstream output(argv[1]);output<<"{\"grant\":"<<grant<<",\"challenge\":"<<challengeJson<<",\"body\":"<<jsonText(body)<<",\"requestId\":\"000000000000000a\",\"proof\":\""<<householdHex(a.proof,32)<<"\",\"response\":"<<response<<"}";output.close();
 // Reboot fences the old signed command. Adopted authority survives; a new
 // signed fresh read can reconcile a lost final adoption without re-adopting.
 const auto oldBoot=a.boot;beginLampExperience();control(a,body);assert(lampServer.responseStatus==409&&uses==executedUses);assert(LampHousehold::challenge(phone,challenge)==Result::Accepted&&challenge.boot!=oldBoot);
 a.boot=challenge.boot;a.sequence=1;a.requestId=12;a.endpoint=45;a.method=1;assert(LampHousehold::commandProof(secret,challenge,a,nullptr,0,a.proof));control(a,String());assert(lampServer.responseStatus==200&&uses==executedUses);
 const String revoke="action=revoke&phone="+phoneId+"&requestId=0000000000000002&expectedRevision="+String(LampHousehold::status().revision);assert(lampServer.executeControl(48,true,revoke,true).status==200&&LampHousehold::status().revoked==1);a.sequence=2;a.requestId=13;assert(LampHousehold::commandProof(secret,challenge,a,nullptr,0,a.proof));control(a,String());assert(lampServer.responseStatus==409&&uses==executedUses);
 assert(!lampServer.controlActive()&&!lampServer.controlConfidential());LampHousehold::erase(secret,sizeof(secret));std::cout<<"PASS actual household adapter: private origin, busy adoption, scoped command, one execution, signed reply, duplicate, revoke, reboot and lost-adopt reconciliation\n";
}
'''
    cpp=folder/'fixture.cpp';cpp.write_text(fixture)
    exe=folder/'fixture.exe';output=folder/'private-fixture.json'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,*includes,*define,str(cpp),str(ROOT/'LampHousehold.cpp'),str(ROOT/'LampModel.cpp'),str(ROOT/'LampUpdatePolicy.cpp'),*objects,'-o',str(exe)],check=True)
    subprocess.run([str(exe),str(output)],check=True)
    validator=folder/'verify.mjs'
    validator.write_text("""
import fs from 'node:fs';import assert from 'node:assert/strict';
import {HouseholdVault,HouseholdClient,householdCommandProof,householdResponseProof} from '"""+(ROOT/'mobile/src/household.js').as_uri()+"""';
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const authorization={sequence:1,requestId:fixture.requestId,endpoint:42,method:2};
assert.equal(await householdCommandProof(fixture.grant,fixture.challenge,authorization,fixture.body),fixture.proof);
const raw=Uint8Array.from(atob(fixture.response.body),c=>c.charCodeAt(0));
assert.equal(await householdResponseProof(fixture.grant,fixture.challenge,authorization,fixture.response.status,raw),fixture.response.proof);
for(const patch of [null,{proof:'f'.repeat(64)},{body:btoa('forged HTTP 200')},{deviceId:'aaaaaaaaaaaa'},{bootSession:'ffffffffffffffff'},{sequence:2}]){
 const values=new Map();const vault=new HouseholdVault({isNative:true,credential:async(id,value)=>{if(value!==undefined)values.set(id,value);return {value:values.get(id)||''};}});
 await vault.importAuthenticated({receiveAuthenticatedInvitation:async()=>({authenticated:true,confidential:true,grant:fixture.grant})});let writes=0;
 const http={request:async options=>{if(options.url.endsWith('/challenge'))return {status:200,data:fixture.challenge};writes++;assert.equal(new URLSearchParams(options.data).get('proof'),fixture.proof);return {status:200,data:{...fixture.response,...patch}};}};
 const client=new HouseholdClient({http,vault,deviceId:fixture.grant.deviceId,phone:fixture.grant.phone,address:'http://192.168.1.9',nextRequest:()=>fixture.requestId});
 if(patch)await assert.rejects(client.control(42,2,fixture.body),error=>error.uncertain===true);else assert.equal((await client.control(42,2,fixture.body)).verified,true);
 assert.equal(writes,1);
}
console.log('PASS actual C++ adapter response verified by native-vault/WebCrypto client; forged HTTP 200 rejected without replay');
""")
    subprocess.run(['node',str(validator),str(output)],check=True)
