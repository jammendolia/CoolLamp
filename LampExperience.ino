#include "LampExperience.h"
#include "LampControlHttpAdapter.h"
#include "LampCommandLedger.h"
#include "LampModel.h"
#include "LampEffectSchema.h"
#include "LampVersion.h"
#include "UpdatePublisher.h"
#include "LampHousehold.h"
#include <mbedtls/sha256.h>
extern LampControlHttpAdapter lampServer;

namespace {
LampCommands::Ledger lightCommands;
String commandHex(uint64_t value){char text[17];snprintf(text,sizeof(text),"%016llx",(unsigned long long)value);return text;}
bool commandHexParse(const String& text,uint64_t& value){
  if(text.length()!=16)return false;
  value=0;
  for(size_t i=0;i<16;++i){const char c=text[i];const int n=c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;if(n<0)return false;value=(value<<4)|n;}return value!=0;
}
bool commandRevisionParse(const String& text,uint32_t& value){
  if(text.isEmpty()||text.length()>10)return false;
  uint64_t result=0;
  for(size_t i=0;i<text.length();++i){if(text[i]<'0'||text[i]>'9')return false;result=result*10+text[i]-'0';if(result>UINT32_MAX)return false;}value=result;return value!=0;
}
void observeLampAppearance(){
  uint8_t bytes[LampCommands::SnapshotBytes]{};size_t at=0;
  const auto state=getLampControlState();bytes[at++]=state.mode;bytes[at++]=state.brightness;bytes[at++]=state.power;
  for(uint8_t mode=1;mode<=LAMP_EFFECT_COUNT;++mode){const auto c=getLampColor(mode);const auto o=getLampEffectOptions(mode);
    bytes[at++]=c.enabled;bytes[at++]=c.r;bytes[at++]=c.g;bytes[at++]=c.b;
    bytes[at++]=o.speed;bytes[at++]=o.intensity;bytes[at++]=o.dual;bytes[at++]=o.r;bytes[at++]=o.g;bytes[at++]=o.b;
  }
  for(uint8_t zone=0;zone<3;++zone){const auto c=lampVuColors[zone];bytes[at++]=c.r;bytes[at++]=c.g;bytes[at++]=c.b;const auto f=lampFountainColors[zone];bytes[at++]=f.r;bytes[at++]=f.g;bytes[at++]=f.b;}
  bytes[at++]=lampFountainCustom;bytes[at++]=lampGroupScene();bytes[at++]=lampSyncFollowing();
  if(!lightCommands.observe(bytes,sizeof(bytes))){lightCommands.begin((uint64_t(esp_random())<<32|esp_random())|1);lightCommands.observe(bytes,sizeof(bytes));}
}
String receiptJson(const LampCommands::Receipt* receipt,uint64_t requestedBoot,uint64_t id){
  String out="{\"version\":1,\"target\":"+jsonText(lampIdentity())+",\"bootSession\":\""+commandHex(lightCommands.boot())+"\",\"requestBoot\":\""+commandHex(requestedBoot)+"\",\"commandId\":\""+commandHex(id)+"\",\"revision\":"+String(lightCommands.currentRevision());
  if(!receipt||receipt->outcome==LampCommands::Outcome::Uncertain)return out+",\"outcome\":\"uncertain\",\"executed\":null,\"persisted\":null}";
  const auto outcome=receipt->outcome;const bool executed=outcome!=LampCommands::Outcome::Rejected;
  return out+",\"outcome\":\""+(outcome==LampCommands::Outcome::Persisted?"persisted":outcome==LampCommands::Outcome::SaveFailed?"save-failed":executed?"executed":"rejected")+"\",\"executed\":"+(executed?"true":"false")+",\"persisted\":"+(outcome==LampCommands::Outcome::Persisted?"true":"false")+",\"httpStatus\":"+String(receipt->status)+",\"executionRevision\":"+String(receipt->revision)+"}";
}
const char* const lightCommandFields[]={"target","bootSession","commandId","expectedRevision","scope","mode","power","brightness","speed","intensity","dual","r","g","b","r2","g2","b2","resetPalette"};
const char* const commandFields[]={"target","bootSession","commandId","expectedRevision","scope","mode","power","brightness","speed","intensity","dual","r","g","b","r2","g2","b2","resetPalette","expectedPolicyRevision","window","startMinute","endMinute","timezone","deferDuringUse","idleSeconds"};
// Hash decoded canonical fields: a retry on another adapter has the same digest.
void commandDigest(uint8_t endpoint,uint8_t* digest){
  mbedtls_sha256_context hash;mbedtls_sha256_init(&hash);mbedtls_sha256_starts(&hash,0);mbedtls_sha256_update(&hash,&endpoint,1);
  for(const char* field:commandFields){const bool present=lampServer.hasArg(field);const uint8_t flag=present;mbedtls_sha256_update(&hash,&flag,1);if(present){const String value=lampServer.arg(field);const uint16_t length=value.length();const uint8_t size[2]={uint8_t(length),uint8_t(length>>8)};mbedtls_sha256_update(&hash,size,2);mbedtls_sha256_update(&hash,reinterpret_cast<const uint8_t*>(value.c_str()),value.length());}}
  mbedtls_sha256_finish(&hash,digest);mbedtls_sha256_free(&hash);
}
bool admitLampCommand(uint8_t endpoint,LampCommands::Receipt*& receipt){
  if(!authorizedLampRequest(true))return false;
  observeLampAppearance();
  uint64_t boot=0,id=0;uint32_t revision=0;
  if(!lampServer.fieldsAllowed(commandFields,sizeof(commandFields)/sizeof(commandFields[0]))||lampServer.arg("target")!=lampIdentity()||lampServer.arg("scope")!="lamp"||!commandHexParse(lampServer.arg("bootSession"),boot)||!commandHexParse(lampServer.arg("commandId"),id)||!commandRevisionParse(lampServer.arg("expectedRevision"),revision)){
    lampServer.send(400,"application/json","{\"outcome\":\"rejected\",\"error\":\"invalid-command\"}");return false;
  }
  uint8_t digest[32]{};commandDigest(endpoint,digest);const auto admitted=lightCommands.admit(boot,id,revision,digest,millis(),receipt);
  if(admitted==LampCommands::Admission::New)return true;
  const uint16_t status=admitted==LampCommands::Admission::Duplicate?receipt->status:admitted==LampCommands::Admission::Full?429:409;
  if(admitted==LampCommands::Admission::Duplicate||admitted==LampCommands::Admission::Uncertain)lampServer.send(status,"application/json",receiptJson(admitted==LampCommands::Admission::Duplicate?receipt:nullptr,boot,id));
  else lampServer.send(status,"application/json",String("{\"outcome\":\"rejected\",\"error\":\"")+(admitted==LampCommands::Admission::Full?"receipt-capacity":admitted==LampCommands::Admission::Stale?"revision-conflict":"command-id-conflict")+"\",\"revision\":"+String(lightCommands.currentRevision())+"}");
  return false;
}
void finishLampCommand(LampCommands::Receipt& receipt,uint16_t status,LampCommands::Outcome outcome){const uint64_t boot=lightCommands.boot(),id=receipt.id;observeLampAppearance();if(boot!=lightCommands.boot()){lampServer.send(409,"application/json",receiptJson(nullptr,boot,id));return;}lightCommands.finish(receipt,status,outcome);lampServer.send(status,"application/json",receiptJson(&receipt,boot,id));}
String schemaParameter(const char* key,uint32_t low,uint32_t high,uint32_t initial,const char* role,const char* units){return String("{\"key\":\"")+key+"\",\"type\":\"integer\",\"min\":"+String(low)+",\"max\":"+String(high)+",\"step\":1,\"units\":\""+units+"\",\"default\":"+String(initial)+",\"semanticRole\":\""+role+"\"}";}
}

void beginLampExperience(){LampModel::begin();LampHousehold::begin();lightCommands.begin((uint64_t(esp_random())<<32|esp_random())|1);observeLampAppearance();}
String lampRevisionJson(){observeLampAppearance();return String("{\"version\":1,\"target\":")+jsonText(lampIdentity())+",\"bootSession\":\""+commandHex(lightCommands.boot())+"\",\"revision\":"+String(lightCommands.currentRevision())+",\"nextCommandId\":\""+commandHex(lightCommands.nextId())+"\",\"mode\":"+String(Mode)+",\"brightness\":"+String(Brightness)+",\"power\":"+(PowerOn?"true":"false")+"}";}
String lampDescriptorJson(){
  String out="{\"descriptorVersion\":2,\"deviceId\":"+jsonText(lampIdentity())+",\"firmwareVersion\":\"" LAMP_FIRMWARE_VERSION "\",\"model\":"+LampModel::json()+",\"state\":"+lampRevisionJson();
  out+=",\"hardware\":{\"ledCount\":"+String(NUM_LEDS)+",\"midpoint\":"+String(lampMidpoint)+",\"currentBudgetMa\":"+String(lampSettings.milliAmps)+",\"microphone\":"+(lampHasMicrophone()?"true":"false")+",\"style\":"+lampStyleJson()+"}";
  out+=",\"capabilities\":{\"catalogVersions\":[1,2],\"sceneVersions\":[2,3],\"control\":[\"http-auth\",\"bonded-ble-rpc\",\"owner-mesh\",\"partial-state-v1\",\"revision-snapshot-v1\",\"command-receipts-v1\",\"household-light-v1\",\"group-dissolution-v1\"],\"persistence\":[\"per-effect-appearance-v2\",\"legacy-startup-defaults\",\"shared-group-appearance\"],\"updates\":[\"https-pinned\",\"ble-pinned\",\"trusted-donation\",\"quiet-policy-v1\",\"ble-resume-lease-v1\",\"staged-rollout-v1\",\"publisher-signatures-v2\",\"update-status-v2\",\"local-update-cue-v1\"],\"commissioning\":[\"physical-comparison-v1\",\"physical-comparison-v2\",\"six-second-pairing\"],\"publisherProvisioned\":"+String(UpdatePublisher::enforced()?"true":"false")+",\"householdCredentials\":true,\"householdPermissions\":\"light-control\",\"nativeBondInvitations\":false,\"coordinatorMigration\":false,\"notifications\":false,\"automaticRadioRollout\":false}";
  out+=",\"limits\":{\"groupMembers\":32,\"legacyGroupMembers\":9,\"localPresence\":16,\"forwardingHops\":4,\"bleConnections\":1,\"bleBonds\":3,\"householdPhones\":8,\"requestBytes\":1024,\"responseBytes\":8192,\"schemaPageEntries\":4,\"schemaPageBytes\":4096,\"receipts\":8,\"receiptLifetimeMs\":120000,\"appearanceWriteIntervalMs\":2000},\"compatibility\":{\"legacyCatalog\":true,\"expandedGroupRequiresEveryMember\":true,\"appearanceMigrationPending\":"+String(lampAppearanceMigrationPending()?"true":"false")+",\"inventory\":\"multi-broker-local-snapshots\"}}";return out;
}
String lampEffectSchemaPage(uint8_t offset,uint8_t count,bool scenes){
  static const char* const sceneKeys[]={"mirror","portal","ping-pong","stereo-fountain","duet","orbit","storm-front","ember-exchange","color-wave","newtons-cradle","conversation","constellation","tidal-basin","firefly-courtship","rocket-relay","prism-split","rhythm-section","beat-chase","shared-heartbeat","bass-cathedral","spectrum-loom","resonant-rings","velvet-thunder","prism-chorus","twin-vortex","electric-bloom","room-groove","chromatic-screw","mercury-ribbon","bass-turbine","prism-torque","echo-coils","aurora-braid"};
  const uint8_t total=scenes?33:lampAvailableEffectCount();if(offset>=total||count<1||count>4)return "";
  const uint8_t end=uint16_t(offset)+count<total?offset+count:total;String out;out.reserve(4096);
  out=String("{\"schemaVersion\":2,\"target\":")+jsonText(lampIdentity())+",\"kind\":\""+(scenes?"scenes":"effects")+"\",\"offset\":"+String(offset)+",\"next\":"+String(end)+",\"total\":"+String(total)+",\"entries\":[";
  for(uint8_t index=offset;index<end;++index){const uint8_t id=scenes?index:index+1;if(index!=offset)out+=',';
    const bool motion=scenes?id!=0:LampEffectSchema::motion(id),intensity=scenes?id!=0:LampEffectSchema::intensity(id),zones=!scenes&&LampEffectSchema::zonePalette(id),audio=scenes?LampSyncWire::sceneNeedsAudio(id):id>38,fixed=scenes&&id==15;
    out+=String("{\"key\":\"")+(scenes?"scene.":"effect.")+(scenes?sceneKeys[id]:LampEffectSchema::key(id))+"\",\"localId\":"+String(id)+",\"motion\":"+(motion?"true":"false")+",\"parameters\":[";bool comma=false;
    if(motion){out+=schemaParameter("speed",1,100,50,scenes?"scene-motion":audio?"audio-response":"motion","percent");comma=true;}
    if(intensity){if(comma)out+=',';out+=schemaParameter("intensity",0,100,scenes?85:id==31?35:100,scenes?"glow":LampEffectSchema::intensityRole(id),"percent");}
    out+=String("],\"palette\":{\"modes\":[")+(fixed?"\"fixed\"":zones?(id==46?"\"custom\"":"\"automatic\",\"custom\""):!scenes&&LampEffectSchema::automatic(id)?"\"automatic\",\"custom\"":"\"custom\"")+"],\"colorRoles\":[";
    if(!fixed&&!(scenes&&id==0)){if(zones)out+=id==46?"\"zone-low\",\"zone-middle\",\"zone-high\"":"\"band-bass\",\"band-mid\",\"band-treble\"";else out+="\"primary\",\"secondary\"";}
    out+=String("],\"secondaryToggle\":")+(!fixed&&!zones&&!(scenes&&id==0)?"true":"false")+",\"preservesAutomaticUntilCustom\":true,\"colorType\":\"rgb8\",\"channelMin\":0,\"channelMax\":255,\"channelStep\":1";
    if(zones)out+=id==46?",\"defaults\":[[0,255,0],[255,255,0],[255,0,0]]":",\"defaults\":[[255,65,0],[0,230,130],[75,30,255]]";
    else if(!fixed&&!(scenes&&id==0)){const auto c=defaultLampColor(id);out+=scenes?",\"defaults\":[[70,220,255],[255,65,170]]":",\"defaults\":[["+String(c.r)+","+String(c.g)+","+String(c.b)+"],[35,160,255]]";}
    out+="},\"audio\":{\"required\":"+String(audio?"true":"false")+",\"optional\":"+(scenes&&id==2?"true":"false")+",\"source\":\""+(scenes?"coordinator":audio?"local-or-coordinator":"none")+"\"},\"persistence\":\""+(scenes?"shared-group":zones?"dedicated-palette-and-per-effect":"per-effect")+"\",\"requirements\":{\"catalogVersion\":2,\"sceneProtocol\":"+String(scenes?2:0)+",\"expandedSceneProtocol\":3,\"coordinatorMicrophone\":"+(scenes&&audio?"true":"false")+"},\"styleRecommendations\":[]}";
  }out+="]}";return out.length()<=4096?out:String();
}
void handleLampStatePatch(){
  LampCommands::Receipt* receipt=nullptr;if(!admitLampCommand(LampControlEndpoint::StatePatch,receipt))return;
  using Outcome=LampCommands::Outcome;
  if(!lampServer.fieldsAllowed(lightCommandFields,sizeof(lightCommandFields)/sizeof(lightCommandFields[0]))){finishLampCommand(*receipt,400,Outcome::Rejected);return;}
  if(lampUpdateOwnsResources()||lampCalibrationActive()||lampSyncFollowing()||lampGroupScene()||lampFactoryResetPending()){finishLampCommand(*receipt,409,Outcome::Rejected);return;}
  const auto state=getLampControlState();uint32_t mode=state.mode,brightness=state.brightness,power=state.power;
  auto number=[](const char* key,uint32_t low,uint32_t high,uint32_t& value){return !lampServer.hasArg(key)||readNumber(key,low,high,value);};
  if(!number("mode",1,lampAvailableEffectCount(),mode)||!number("brightness",1,255,brightness)||!number("power",0,1,power)){finishLampCommand(*receipt,400,Outcome::Rejected);return;}
  const auto original=getLampEffectOptions(mode);uint32_t speed=original.speed,intensity=original.intensity,dual=original.dual,r2=original.r,g2=original.g,b2=original.b;
  const auto color=getLampColor(mode);uint32_t r=color.r,g=color.g,b=color.b;
  const bool tuning=lampServer.hasArg("speed")||lampServer.hasArg("intensity")||lampServer.hasArg("dual")||lampServer.hasArg("r2")||lampServer.hasArg("g2")||lampServer.hasArg("b2"),primary=lampServer.hasArg("r")||lampServer.hasArg("g")||lampServer.hasArg("b"),reset=lampServer.arg("resetPalette")=="1";
  if(!number("speed",1,100,speed)||!number("intensity",0,100,intensity)||!number("dual",0,1,dual)||!number("r",0,255,r)||!number("g",0,255,g)||!number("b",0,255,b)||!number("r2",0,255,r2)||!number("g2",0,255,g2)||!number("b2",0,255,b2)||(lampServer.hasArg("resetPalette")&&lampServer.arg("resetPalette")!="1")||(reset&&(tuning||primary))||(lampServer.hasArg("speed")&&!LampEffectSchema::motion(mode))){finishLampCommand(*receipt,400,Outcome::Rejected);return;}
  if(!setLampControl(mode,brightness,power)){finishLampCommand(*receipt,409,Outcome::Rejected);return;}
  if(reset){resetLampColor(mode);const auto palette=getLampEffectOptions(mode);setLampEffectOptions(mode,{original.speed,original.intensity,palette.dual,palette.r,palette.g,palette.b});}
  if(primary)setLampColor(mode,r,g,b);
  if(tuning)setLampEffectOptions(mode,{uint8_t(speed),uint8_t(intensity),uint8_t(dual),uint8_t(r2),uint8_t(g2),uint8_t(b2)});
  noteLampUpdateUse();
  finishLampCommand(*receipt,200,Outcome::Executed);
}
void handleLampAppearanceSave(){
  LampCommands::Receipt* receipt=nullptr;if(!admitLampCommand(LampControlEndpoint::AppearanceSave,receipt))return;
  using Outcome=LampCommands::Outcome;uint32_t mode=0;
  const char* const fields[]={"target","bootSession","commandId","expectedRevision","scope","mode"};
  if(!lampServer.fieldsAllowed(fields,6)||!readNumber("mode",1,lampAvailableEffectCount(),mode)){finishLampCommand(*receipt,400,Outcome::Rejected);return;}
  if(lampUpdateOwnsResources()||lampCalibrationActive()||lampSyncFollowing()||lampGroupScene()||lampFactoryResetPending()){finishLampCommand(*receipt,409,Outcome::Rejected);return;}
  const auto saved=saveLampAppearanceAccepted(mode,millis());
  finishLampCommand(*receipt,saved==LampAppearanceResult::Persisted?200:saved==LampAppearanceResult::Busy?429:503,saved==LampAppearanceResult::Persisted?Outcome::Persisted:saved==LampAppearanceResult::Busy?Outcome::Rejected:saved==LampAppearanceResult::Uncertain?Outcome::Uncertain:Outcome::SaveFailed);
}
void handleLampReceipt(){
  if(!authorizedLampRequest(true))return;
  uint64_t boot=0,id=0;const char* const fields[]={"target","bootSession","commandId"};
  if(!lampServer.fieldsAllowed(fields,3)||lampServer.arg("target")!=lampIdentity()||!commandHexParse(lampServer.arg("bootSession"),boot)||!commandHexParse(lampServer.arg("commandId"),id)){lampServer.send(400,"application/json","{\"error\":\"invalid-receipt-query\"}");return;}
  observeLampAppearance();const auto* receipt=lightCommands.query(boot,id,millis());lampServer.send(200,"application/json",receiptJson(receipt,boot,id));
}
void handleLampUpdatePolicy(){
  if(lampServer.arg("action")=="read"){
    if(!authorizedLampRequest(true))return;
    const char* const fields[]={"action","target","bootSession"};uint64_t boot=0;
    if(!lampServer.fieldsAllowed(fields,3)||lampServer.arg("target")!=lampIdentity()||!commandHexParse(lampServer.arg("bootSession"),boot)){lampServer.send(400,"text/plain","Invalid policy query.");return;}
    if(boot!=lightCommands.boot()){lampServer.send(409,"text/plain","Lamp restarted. Refresh its identity and session.");return;}
    lampServer.send(200,"application/json",String("{\"version\":1,\"target\":")+jsonText(lampIdentity())+",\"bootSession\":\""+commandHex(boot)+"\",\"policy\":"+lampUpdatePolicyJson()+"}");return;
  }
  LampCommands::Receipt* receipt=nullptr;if(!admitLampCommand(LampControlEndpoint::UpdatePolicy,receipt))return;
  using Outcome=LampCommands::Outcome;
  const char* const fields[]={"target","bootSession","commandId","expectedRevision","scope","expectedPolicyRevision","window","startMinute","endMinute","timezone","deferDuringUse","idleSeconds"};
  uint32_t revision=0,window=0,start=0,end=0,defer=0,idle=0;
  if(!lampServer.fieldsAllowed(fields,12)||!commandRevisionParse(lampServer.arg("expectedPolicyRevision"),revision)||!readNumber("window",0,1,window)||!readNumber("startMinute",0,1439,start)||!readNumber("endMinute",0,1439,end)||!readNumber("deferDuringUse",0,1,defer)||!readNumber("idleSeconds",1,86400,idle)||lampServer.arg("timezone").length()>=LampUpdatePolicy::TimezoneCapacity){finishLampCommand(*receipt,400,Outcome::Rejected);return;}
  LampUpdatePolicy::Policy policy;policy.window=window;policy.startMinute=start;policy.endMinute=end;policy.deferDuringUse=defer;policy.idleSeconds=idle;strlcpy(policy.timezone,lampServer.arg("timezone").c_str(),sizeof(policy.timezone));
  if(!LampUpdatePolicy::valid(policy)){finishLampCommand(*receipt,400,Outcome::Rejected);return;}
  if(lampUpdateOwnsResources()||lampCalibrationActive()||lampFactoryResetPending()||revision!=lampUpdatePolicyRevision()||revision==UINT32_MAX){finishLampCommand(*receipt,409,Outcome::Rejected);return;}
  const bool ok=setLampUpdatePolicy(policy,revision);
  finishLampCommand(*receipt,ok?200:503,ok?Outcome::Persisted:lampUpdatePolicySaveUncertain()?Outcome::Uncertain:Outcome::SaveFailed);
}
