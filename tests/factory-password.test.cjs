const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
test('actual settings loader uses factory default only when no valid saved settings exist',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coollamp-factory-'));
 try {
  const root=path.resolve(__dirname,'..');
  const network=fs.readFileSync(path.join(root,'LampNetwork.ino'),'utf8');
  const loader=network.slice(network.indexOf('void loadLampSettings()'),network.indexOf('String jsonText('));
  const source=`#include "LampConfig.h"
#include "LampFactory.h"
#include <Preferences.h>
#include <cassert>
LampSettings lampSettings;
constexpr int MAX_POWER_MILLIAMPS=500,MODE_FIRE=4,MODE_MAX=47;
${loader}
int main(){
loadLampSettings();assert(lampUsesFactoryPassword(lampSettings.adminPassword));
assert(lampSettings.ledCount==134);
auto saved=lampSettings;strlcpy(saved.adminPassword,"owner-kept-password",sizeof(saved.adminPassword));
strlcpy(saved.ssid,"Home",sizeof(saved.ssid));saved.ledCount=132;saved.startupMode=46;
Preferences p;p.putBytes("settings",&saved,sizeof(saved));
loadLampSettings();assert(!lampUsesFactoryPassword(lampSettings.adminPassword));
assert(!strcmp(lampSettings.adminPassword,"owner-kept-password"));assert(lampSettings.ledCount==132&&lampSettings.startupMode==46);
assert(!strcmp(lampSettings.ssid,"Home"));
strlcpy(saved.adminPassword,LAMP_FACTORY_PASSWORD,sizeof(saved.adminPassword));p.putBytes("settings",&saved,sizeof(saved));
loadLampSettings();assert(lampUsesFactoryPassword(lampSettings.adminPassword));assert(lampSettings.ledCount==132);
}`;
  const file=path.join(dir,'test.cpp'),binary=path.join(dir,'test');fs.writeFileSync(file,source);
  const compile=spawnSync('c++',['-std=c++17','-Wall','-Wextra','-Werror','-I'+root,'-I'+path.join(root,'tests/sync-stubs'),'-I'+path.join(root,'tests/stubs'),file,'-o',binary],{encoding:'utf8'});
  assert.equal(compile.status,0,compile.stderr);const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 } finally{fs.rmSync(dir,{recursive:true,force:true});}
});
