"""Real shared handlers, appearance NVS and SDK SHA on host; no radio or device."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS

ROOT=Path(__file__).resolve().parents[1]
# Reuse the pinned-source verifier, without running the other test suite.
tree=ast.parse((ROOT/'tests/espnow-runtime.py').read_text())
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='verified_source' or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('SOURCE','ARCHIVE_SHA','PRIMITIVES') for t in n.targets)]
scope=dict(Path=Path,hashlib=hashlib,json=json,tarfile=tarfile)
exec(compile(ast.Module(body=nodes,type_ignores=[]),'verified_source','exec'),scope)
crypto=scope['verified_source'](ROOT/'.build/tls-library')
adapter_tree=ast.parse((ROOT/'tests/control-http-adapter.py').read_text())
extract={}
exec(compile(ast.Module(body=[n for n in adapter_tree.body if isinstance(n,ast.FunctionDef) and n.name=='function'],type_ignores=[]),'extract','exec'),extract)
network=(ROOT/'LampNetwork.ino').read_text()
functions='\n'.join(extract['function'](network,name) for name in ['String jsonText(', 'bool readNumber('])
with tempfile.TemporaryDirectory(prefix='experience-',dir=ROOT/'.build') as tmp:
    folder=Path(tmp)
    prefs=(ROOT/'tests/control-stubs/Preferences.h').read_text().replace('  bool begin(','''  size_t getBytesLength(const char* key){return storage[key].size();}
  inline static bool failReadback=false,commitThenFail=false;
  size_t getBytes(const char* key,void* out,size_t length){if(failReadback||storage[key].size()!=length)return 0;memcpy(out,storage[key].data(),length);return length;}
  bool begin(''')
    prefs=prefs.replace('++writes;return length;', '++writes;return commitThenFail?0:length;')
    (folder/'Preferences.h').write_text(prefs)
    (folder/'crypto-config.h').write_text('#pragma once\n#define MBEDTLS_PLATFORM_C\n#define MBEDTLS_SHA256_C\n')
    includes=['-I'+str(folder),'-I'+str(ROOT/'tests/control-stubs'),'-I'+str(ROOT),'-I'+str(crypto/'include')]
    define=['-DMBEDTLS_CONFIG_FILE="crypto-config.h"']
    objects=[]
    for name in ['sha256','platform_util','platform']:
        out=folder/(name+'.o')
        subprocess.run(['gcc','-std=c11',*includes,*define,'-c',str(crypto/'library'/(name+'.c')),'-o',str(out)],check=True)
        objects.append(str(out))
    fixture=r'''
#include <cassert>
#include <iostream>
#include <fstream>
#include "LampControlHttpAdapter.h"
#include "LampControl.h"
#include "LampConfig.h"
#include "LampVu.h"
#include "LampFountain.h"
#include "LampUpdate.h"
#include "LampSync.h"
#include "LampModel.h"
#include "UpdatePublisher.h"
LampControlHttpAdapter lampServer(80);LampSettings lampSettings{};
String lampToken="private-token";uint32_t now=100;uint32_t millis(){return now;}
uint32_t esp_random(){static uint32_t value=900;return ++value;}
uint16_t NUM_LEDS=205,lampMidpoint=102;uint8_t Mode=4,Brightness=100;bool PowerOn=true;
bool following=false,updating=false,calibrating=false,resetting=false;uint8_t scene=0;unsigned controls=0,uses=0;
const LampSyncWire::Visual* lampSyncVisual=nullptr;
bool lampSyncFollowing(){return following;}bool lampUpdateOwnsResources(){return updating;}bool lampCalibrationActive(){return calibrating;}bool lampFactoryResetPending(){return resetting;}
bool lampHasMicrophone(){return true;}constexpr uint8_t MODE_MAX=47;
uint8_t lampGroupScene(){return scene;}String lampStyleJson(){return "{\"id\":\"corkscrew\"}";}
void noteLampUpdateUse(){++uses;}bool leaveLampSceneForEffect(){return true;}void pauseLampSync(){}void syncLampKnob(){}
struct CRGB {inline static int Black=0;};int* leds=nullptr;void fill_solid(int*,uint16_t,int){}
struct {void setBrightness(uint8_t){}} FastLED;
namespace UpdatePublisher {bool enforced(){return false;}}
namespace LampHousehold {void begin(){}}
bool authorizedLampRequest(bool mutation){if(!lampServer.authenticate("lamp","password")){lampServer.send(401,"text/plain","Unauthorized");return false;}if(mutation&&lampServer.header("X-Lamp-Token")!=lampToken){lampServer.send(403,"text/plain","Token");return false;}return true;}
VuColor lampVuColors[3]={{1,2,3},{4,5,6},{7,8,9}};FountainColor lampFountainColors[3]{};bool lampFountainCustom=false;
uint32_t fixturePolicyRevision=1;unsigned policyAttempts=0;bool policyFail=false,policyUncertain=false;
uint32_t lampUpdatePolicyRevision(){return fixturePolicyRevision;}bool setLampUpdatePolicy(const LampUpdatePolicy::Policy&,uint32_t revision){++policyAttempts;if(policyFail||revision!=fixturePolicyRevision)return false;++fixturePolicyRevision;return true;}bool lampUpdatePolicySaveUncertain(){return policyUncertain;}String lampUpdatePolicyJson(){return "{\"version\":1,\"revision\":"+String(fixturePolicyRevision)+"}";}
#include "LampColors.ino"
#include "LampControl.ino"
'''+functions+r'''
#include "LampExperience.ino"
String envelope(uint64_t id,uint32_t revision){return "target="+lampIdentity()+"&scope=lamp&bootSession="+commandHex(lightCommands.boot())+"&commandId="+commandHex(id)+"&expectedRevision="+String(revision);}
LampControlReply patch(uint64_t id,uint32_t revision,const String& fields){return lampServer.executeControl(LampControlEndpoint::StatePatch,true,envelope(id,revision)+fields);}
int main(int argc,char** argv){
 lampServer.on("/api/state/patch",HTTP_POST,handleLampStatePatch);lampServer.on("/api/appearance/save",HTTP_POST,handleLampAppearanceSave);lampServer.on("/api/receipt",HTTP_POST,handleLampReceipt);lampServer.on("/api/firmware/policy",HTTP_POST,handleLampUpdatePolicy);
 lampSettings.brightness=77;lampSettings.startupMode=8;lampSettings.ledCount=205;lampSettings.milliAmps=500;
 loadLampColors();loadLampAppearanceV2();beginLampExperience();const auto boot=lightCommands.boot();
 auto result=patch(1,1,"&brightness=33");assert(result.status==200&&Mode==4&&Brightness==33);assert(result.body.find("executed")!=String::npos);
 result=patch(1,1,"&brightness=33");assert(result.status==200&&Brightness==33); // route-independent duplicate
 result=patch(1,1,"&brightness=34");assert(result.status==409&&Brightness==33);
 Brightness=52; // concurrent physical knob; observe before CAS
 result=patch(2,2,"&power=0");assert(result.status==409&&PowerOn&&Brightness==52);
 result=patch(2,3,"&power=0");assert(result.status==200&&!PowerOn&&Brightness==52&&Mode==4);
 result=patch(3,4,"&r=10&g=20&b=30&speed=75");assert(result.status==200&&getLampColor(4).r==10&&getLampEffectOptions(4).speed==75);
 const auto revision=lightCommands.currentRevision();const auto settings=lampSettings;
 result=lampServer.executeControl(LampControlEndpoint::AppearanceSave,true,envelope(4,revision)+"&mode=4");assert(result.status==200&&result.body.find("persisted")!=String::npos);
 assert(lampSettings.startupMode==settings.startupMode&&lampSettings.brightness==settings.brightness);
 const auto writes=Preferences::writes;result=lampServer.executeControl(LampControlEndpoint::AppearanceSave,true,envelope(4,revision)+"&mode=4");assert(result.status==200&&writes==Preferences::writes);
 setLampColor(4,200,201,202);loadLampColors();loadLampAppearanceV2();assert(getLampColor(4).r==10&&getLampEffectOptions(4).speed==75);
 now+=2500;setLampColor(4,22,23,24);observeLampAppearance();Preferences::failWrites=true;
 result=lampServer.executeControl(LampControlEndpoint::AppearanceSave,true,envelope(5,lightCommands.currentRevision())+"&mode=4");assert(result.status==503&&result.body.find("save-failed")!=String::npos);Preferences::failWrites=false;
 loadLampColors();loadLampAppearanceV2();assert(getLampColor(4).r==10);observeLampAppearance();
 result=patch(6,lightCommands.currentRevision(),"&brightness=0&r=9");assert(result.status==400&&getLampColor(4).r==10);
 following=true;result=patch(7,lightCommands.currentRevision(),"&brightness=80");assert(result.status==409);following=false;
 // Wrong target/session, duplicate fields, malformed and unbounded forms.
 assert(lampServer.executeControl(42,true,envelope(8,lightCommands.currentRevision())+"&target=112233445566&power=1").status==400);
 assert(lampServer.executeControl(42,true,envelope(8,lightCommands.currentRevision())+"&brightness=2&bogus=1").status==400);
 String wrong="target="+lampIdentity()+"&scope=lamp&bootSession=0000000000000001&commandId=0000000000000008&expectedRevision=1&power=1";assert(lampServer.executeControl(42,true,wrong).body.find("uncertain")!=String::npos);
 now+=LampCommands::LifetimeMs;result=patch(1,1,"&brightness=33");assert(result.status==409&&result.body.find("uncertain")!=String::npos);
 assert(lampServer.executeControl(44,true,"target="+lampIdentity()+"&bootSession="+commandHex(boot)+"&commandId=0000000000000001").body.find("uncertain")!=String::npos);
 beginLampExperience();assert(lightCommands.boot()!=boot); // reboot fence
 setLampEffectOptions(4,{75,61,1,2,3,4});observeLampAppearance();result=patch(1,lightCommands.currentRevision(),"&resetPalette=1");assert(result.status==200&&getLampEffectOptions(4).speed==75&&getLampEffectOptions(4).intensity==61);
 now+=2500;setLampColor(4,23,24,25);Preferences::commitThenFail=true;assert(saveLampAppearanceAccepted(4,now)==LampAppearanceResult::Persisted);Preferences::commitThenFail=false;
 now+=2500;setLampColor(4,34,35,36);Preferences::commitThenFail=true;Preferences::failReadback=true;assert(saveLampAppearanceAccepted(4,now)==LampAppearanceResult::Uncertain);Preferences::commitThenFail=false;Preferences::failReadback=false;
 loadLampColors();loadLampAppearanceV2();assert(getLampColor(4).r==34);now+=2500;setLampColor(4,45,46,47);Preferences::failWrites=true;assert(saveLampAppearanceAccepted(4,now)==LampAppearanceResult::Failed);Preferences::failWrites=false;assert(saveLampAppearanceAccepted(4,now)==LampAppearanceResult::Persisted);setLampColor(4,46,47,48);assert(saveLampAppearanceAccepted(4,now)==LampAppearanceResult::Busy);
 // A downgrade's real v1 record wins, and is durably rebased so returning to
 // an older v1 color later cannot resurrect a previously accepted v2 color.
 now+=2500;setLampColor(5,71,72,73);assert(saveLampAppearanceAccepted(5,now)==LampAppearanceResult::Persisted);
 const auto originalBaseline=Preferences::storage["look04"];
 std::vector<uint8_t> oldColors(153);oldColors[0]=1;
 for(unsigned i=0;i<38;++i){const auto c=defaultLampColor(i+1);oldColors[1+i*4]=c.enabled;oldColors[2+i*4]=c.r;oldColors[3+i*4]=c.g;oldColors[4+i*4]=c.b;}
 oldColors[1+3*4]=1;oldColors[2+3*4]=81;oldColors[3+3*4]=82;oldColors[4+3*4]=83;Preferences::storage["colors"]=oldColors;
 loadLampColors();loadLampAppearanceV2();assert(getLampColor(4).r==81&&!lampAppearanceMigrationPending());assert(getLampColor(5).r==71);
 oldColors[1+3*4]=originalBaseline[14];oldColors[2+3*4]=originalBaseline[15];oldColors[3+3*4]=originalBaseline[16];oldColors[4+3*4]=originalBaseline[17];Preferences::storage["colors"]=oldColors;
 loadLampColors();loadLampAppearanceV2();assert(getLampColor(4).r==originalBaseline[15]&&getLampColor(4).r!=45&&!lampAppearanceMigrationPending());assert(getLampColor(5).r==71);
 oldColors[2+3*4]=91;Preferences::storage["colors"]=oldColors;Preferences::failWrites=true;
 loadLampColors();loadLampAppearanceV2();assert(getLampColor(4).r==91&&lampAppearanceMigrationPending());assert(getLampColor(5).r==71);Preferences::failWrites=false;
 loadLampColors();loadLampAppearanceV2();assert(getLampColor(4).r==91&&!lampAppearanceMigrationPending());
 const auto migrationWrites=Preferences::writes;loadLampColors();loadLampAppearanceV2();assert(Preferences::writes==migrationWrites);
 observeLampAppearance();const auto policyLightRevision=lightCommands.currentRevision();const String policyFields="&window=1&startMinute=0&endMinute=60&timezone=UTC0&deferDuringUse=1&idleSeconds=900";
 auto policyForm=envelope(2,policyLightRevision)+"&expectedPolicyRevision=1"+policyFields;
 result=lampServer.executeControl(46,true,policyForm);assert(result.status==200&&result.body.find("persisted")!=String::npos&&fixturePolicyRevision==2&&policyAttempts==1);
 result=lampServer.executeControl(46,true,policyForm);assert(result.status==200&&policyAttempts==1);
 assert(lampServer.executeControl(46,true,envelope(2,policyLightRevision)+"&expectedPolicyRevision=2"+policyFields).status==409&&policyAttempts==1);
 result=lampServer.executeControl(46,true,envelope(3,policyLightRevision)+"&expectedPolicyRevision=1"+policyFields);assert(result.status==409&&result.body.find("rejected")!=String::npos&&policyAttempts==1);
 policyFail=true;result=lampServer.executeControl(46,true,envelope(4,policyLightRevision)+"&expectedPolicyRevision=2"+policyFields);assert(result.status==503&&result.body.find("save-failed")!=String::npos);
 policyUncertain=true;result=lampServer.executeControl(46,true,envelope(5,policyLightRevision)+"&expectedPolicyRevision=2"+policyFields);assert(result.status==503&&result.body.find("uncertain")!=String::npos&&result.body.find("null")!=String::npos);policyFail=false;policyUncertain=false;
 assert(lampServer.executeControl(46,true,"expectedRevision=2"+policyFields).status==400);
 assert(lampServer.executeControl(46,true,"action=read&target="+lampIdentity()+"&bootSession="+commandHex(lightCommands.boot())).body.find("policy")!=String::npos);
 assert(lampServer.executeControl(46,true,"action=read&target=112233445566&bootSession="+commandHex(lightCommands.boot())).status==400);
 assert(lampServer.executeControl(46,true,"action=read&target="+lampIdentity()+"&bootSession=0000000000000001").status==409);
 assert(patch(6,policyLightRevision,"&window=1&brightness=42").status==400&&Brightness==52);
 LampCommands::Ledger ledger;ledger.begin(99);uint8_t state[512]{},digest[32]{};assert(ledger.observe(state,512));LampCommands::Receipt* receipt=nullptr;
 for(uint64_t id=1;id<=8;++id){assert(ledger.admit(99,id,1,digest,0xfffffff0,receipt)==LampCommands::Admission::New);ledger.finish(*receipt,200,LampCommands::Outcome::Executed);}
 assert(ledger.admit(99,9,1,digest,0x10,receipt)==LampCommands::Admission::New);assert(!ledger.query(99,1,0x10));assert(ledger.admit(99,1,1,digest,0x10,receipt)==LampCommands::Admission::Uncertain);assert(ledger.admit(99,2,1,digest,120000,receipt)==LampCommands::Admission::Uncertain);
 LampModel::Record model;strcpy(model.id,"future-coil-2070");strcpy(model.name,"Future coil");strcpy(model.artwork,"future-art");strcpy(model.hardware,"rev-z");model.preconfigured=1;assert(LampModel::provision(model));LampModel::begin();assert(!strcmp(LampModel::current().id,"future-coil-2070"));Preferences::failWrites=true;strcpy(model.id,"other");assert(!LampModel::provision(model));Preferences::failWrites=false;assert(!strcmp(LampModel::current().id,"future-coil-2070"));
 if(argc>1){std::ofstream output(argv[1]);output<<"["<<lampDescriptorJson();for(bool scenes:{false,true})for(unsigned offset=0;offset<(scenes?33:47);offset+=4){const auto page=lampEffectSchemaPage(offset,4,scenes);assert(!page.empty()&&page.size()<=4096);output<<","<<page;}output<<"]";}
 std::cout<<"PASS real appearance/command handlers, duplicate/loss/reboot/CAS/knob/storage/schema; ledger bytes="<<sizeof(LampCommands::Ledger)<<"\n";
}
'''
    cpp=folder/'fixture.cpp';cpp.write_text(fixture)
    exe=folder/'fixture.exe';output=folder/'contracts.json'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra',*SANITIZERS,*includes,*define,str(cpp),str(ROOT/'LampModel.cpp'),str(ROOT/'LampUpdatePolicy.cpp'),*objects,'-o',str(exe)],check=True)
    subprocess.run([str(exe),str(output)],check=True)
    values=json.loads(output.read_text());assert values[0]['descriptorVersion']==2
    # Parse exact production serialization with the actual mobile contract model.
    validator=folder/'verify.mjs'
    validator.write_text("import fs from 'node:fs';import {lampDescriptor,effectSchemaPage} from '"+(ROOT/'mobile/src/experience-contracts.js').as_uri()+"';const values=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));lampDescriptor(values[0],values[0].deviceId);for(const page of values.slice(1))effectSchemaPage(page,values[0].deviceId);")
    subprocess.run(['node',str(validator),str(output)],check=True)
    effects=[entry for page in values[1:] if page['kind']=='effects' for entry in page['entries']]
    assert len(effects)==47 and len({entry['key'] for entry in effects})==47
    assert all(not entry['motion'] and not entry['parameters'] for entry in effects[20:29])
    prism=[entry for page in values[1:] if page['kind']=='scenes' for entry in page['entries'] if entry['localId']==15][0]
    assert prism['palette']['modes']==['fixed'] and prism['palette']['colorRoles']==[]
    print('Schema maximum bytes:',max(len(json.dumps(v,separators=(',',':'))) for v in values[1:]))
