"""Run the complete production audio lifecycle, analysis, persistence and JSON.

Platform I2S/RTOS/NVS are bounded fault fixtures, not alternate audio logic.
No device, raw recording, radio or microphone-presence claim is involved.
"""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]

ARDUINO = (ROOT/'tests/control-stubs/Arduino.h').read_text().replace(
    'uint64_t getEfuseMac(){return 0xaabbccddeeffULL;}',
    'uint64_t getEfuseMac(){return 0xaabbccddeeffULL;}uint32_t getFreeHeap(){return 327680;}uint32_t getMaxAllocHeap(){return 327680;}') + r'''
#include <cassert>
#define IRAM_ATTR
using portMUX_TYPE=int;
#define portMUX_INITIALIZER_UNLOCKED 0
inline int criticalDepth=0;
#define portENTER_CRITICAL(value) ((void)(value),++criticalDepth)
#define portEXIT_CRITICAL(value) ((void)(value),--criticalDepth)
#define portENTER_CRITICAL_ISR(value) portENTER_CRITICAL(value)
#define portEXIT_CRITICAL_ISR(value) portEXIT_CRITICAL(value)
'''

PLATFORM = r'''
#pragma once
#include "Arduino.h"
#include <cstring>
#include <map>
#include <vector>
namespace Fixture {
inline uint32_t now=1000;
inline bool taskActive=false,finished=false,cooperativeStop=true,failTask=false,failSemaphore=false;
inline void (*taskFn)(void*)=nullptr;
inline int creates=0,deletes=0,channelCreates=0,channelDeletes=0,reads=0,readBudget=100,readError=0,driverError=0;
inline bool signal=false,emptyRead=false;
inline int failStage=0;inline size_t readBytes=0;
struct PauseCapture{};
}
using TaskHandle_t=void*;using SemaphoreHandle_t=bool*;
constexpr int pdTRUE=1,pdPASS=1;
#define pdMS_TO_TICKS(value) (value)
inline SemaphoreHandle_t xSemaphoreCreateBinary(){return Fixture::failSemaphore?nullptr:&Fixture::finished;}
inline int xSemaphoreGive(SemaphoreHandle_t semaphore){assert(semaphore);*semaphore=true;return pdTRUE;}
inline int xSemaphoreTake(SemaphoreHandle_t semaphore,uint32_t timeout){
 assert(semaphore);assert(timeout==0||timeout==250);
 if(!*semaphore&&timeout&&Fixture::cooperativeStop&&Fixture::taskActive)Fixture::taskFn(nullptr);
 if(!*semaphore)return 0;*semaphore=false;return pdTRUE;
}
inline int uxSemaphoreGetCount(SemaphoreHandle_t semaphore){return semaphore&&*semaphore;}
inline int xTaskCreate(void (*fn)(void*),const char*,uint32_t stack,void*,int priority,TaskHandle_t* task){
 assert(stack==2048&&priority==1);++Fixture::creates;
 if(Fixture::failTask)return 0;Fixture::taskFn=fn;Fixture::taskActive=true;*task=reinterpret_cast<void*>(1);return pdPASS;
}
inline void vTaskDelete(TaskHandle_t task){assert(task&&Fixture::taskActive);Fixture::taskActive=false;++Fixture::deletes;}
inline void vTaskSuspend(void*){}
inline uint32_t uxTaskGetStackHighWaterMark(void*){return 1372;}
using esp_err_t=int;
constexpr int ESP_OK=0,ESP_FAIL=-1,ESP_ERR_NO_MEM=0x101;
using gpio_num_t=int;
constexpr int GPIO_PULLDOWN_ONLY=1;
inline void gpio_reset_pin(gpio_num_t pin){assert(pin>=5&&pin<=7);}
inline void gpio_set_pull_mode(gpio_num_t pin,int pull){assert(pin==7&&pull==GPIO_PULLDOWN_ONLY);}
using i2s_chan_handle_t=void*;struct i2s_event_data_t{};
constexpr int I2S_NUM_0=0,I2S_ROLE_MASTER=1,I2S_GPIO_UNUSED=-1,I2S_DATA_BIT_WIDTH_16BIT=16,I2S_SLOT_MODE_MONO=1,I2S_STD_SLOT_LEFT=1,I2S_SLOT_BIT_WIDTH_32BIT=32;
struct i2s_chan_config_t{int dma_desc_num=0,dma_frame_num=0;};
struct SlotConfig{int data_bit_width,mode,slot_mask=3,slot_bit_width=16,ws_width=16;bool bit_shift=true,left_align=true,big_endian=false,bit_order_lsb=false;};
struct i2s_std_config_t{int clk_cfg=0;SlotConfig slot_cfg{};struct{int mclk=0,bclk=0,ws=0,dout=0,din=0;}gpio_cfg;};
struct i2s_event_callbacks_t{bool (*on_recv_q_ovf)(i2s_chan_handle_t,i2s_event_data_t*,void*)=nullptr;};
#define I2S_CHANNEL_DEFAULT_CONFIG(port,role) i2s_chan_config_t{}
#define I2S_STD_CLK_DEFAULT_CONFIG(rate) (rate)
#define I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(width,mode) SlotConfig{width,mode}
inline int i2s_new_channel(const i2s_chan_config_t* config,void*,i2s_chan_handle_t* receiver){
 assert(config->dma_desc_num==4&&config->dma_frame_num==256);++Fixture::channelCreates;
 if(Fixture::driverError||Fixture::failStage==1)return ESP_ERR_NO_MEM;*receiver=reinterpret_cast<void*>(2);return ESP_OK;
}
inline int i2s_channel_init_std_mode(i2s_chan_handle_t,const i2s_std_config_t* config){assert(config->clk_cfg==16000&&config->gpio_cfg.din==7&&config->gpio_cfg.bclk==5&&config->gpio_cfg.ws==6);const auto s=config->slot_cfg;assert(s.data_bit_width==16&&s.mode==1&&s.slot_mask==1&&s.slot_bit_width==32&&s.ws_width==32&&s.bit_shift&&s.left_align&&!s.big_endian&&!s.bit_order_lsb);return Fixture::failStage==2?ESP_ERR_NO_MEM:ESP_OK;}
inline int i2s_channel_register_event_callback(i2s_chan_handle_t,const i2s_event_callbacks_t* value,void*){assert(value->on_recv_q_ovf);return Fixture::failStage==3?ESP_ERR_NO_MEM:ESP_OK;}
inline int i2s_channel_enable(i2s_chan_handle_t){return Fixture::failStage==4?ESP_ERR_NO_MEM:ESP_OK;}
inline int i2s_channel_disable(i2s_chan_handle_t){return ESP_OK;}
inline int i2s_del_channel(i2s_chan_handle_t){++Fixture::channelDeletes;return ESP_OK;}
inline int i2s_channel_read(i2s_chan_handle_t,void* samples,size_t length,size_t* bytes,uint32_t timeout){
 assert(Fixture::taskActive&&timeout==40&&length==512&&criticalDepth==0);
 if(Fixture::reads>=Fixture::readBudget)throw Fixture::PauseCapture{};
 ++Fixture::reads;Fixture::now+=16;
 if(Fixture::readError){*bytes=0;return Fixture::readError;}
 auto data=static_cast<int16_t*>(samples);for(unsigned i=0;i<256;++i)data[i]=Fixture::signal?int16_t(i%2?512:-512):0;
 *bytes=Fixture::emptyRead?0:Fixture::readBytes?Fixture::readBytes:length;return ESP_OK;
}
'''

PREFERENCES = r'''
#pragma once
#include "platform.h"
struct Preferences {
protected:
 uint32_t _handle=0;
public:
 using Store=std::map<std::string,std::map<std::string,std::vector<uint8_t>>>;
 inline static Store storage;
 inline static std::map<uint32_t,std::string> handles;inline static uint32_t nextHandle=0;
 inline static std::string wrongType;
 inline static bool failOpen=false,failWrites=false,failRemove=false,corruptWrite=false;
 inline static int writes=0,reads=0,failedRead=0,failedWrite=0,interruptRead=0,removes=0;
 inline static bool interruptWrite=false;
 struct PowerLoss{};
 std::string space;
 bool begin(const char* name,bool readOnly){space=name;if(failOpen||(readOnly&&!storage.count(space)))return false;storage.try_emplace(space);_handle=++nextHandle;handles[_handle]=space;return true;}
 void end(){_handle=0;}
 bool isKey(const char* key){return storage[space].count(key)!=0;}
 size_t getBytesLength(const char* key){return isKey(key)?storage[space][key].size():0;}
 size_t getBytes(const char* key,void* out,size_t length){
  ++reads;if(reads==failedRead||!isKey(key)||storage[space][key].size()!=length)return 0;
  memcpy(out,storage[space][key].data(),length);if(reads==interruptRead)throw PowerLoss{};return length;
 }
 size_t putBytes(const char* key,const void* value,size_t length){
  assert(!Fixture::taskActive&&criticalDepth==0);++writes;if(failWrites||writes==failedWrite)return 0;
  const auto bytes=static_cast<const uint8_t*>(value);storage[space][key]={bytes,bytes+length};
  if(corruptWrite){storage[space][key][length-1]^=1;corruptWrite=false;}if(interruptWrite){interruptWrite=false;throw PowerLoss{};}return length;
 }
 bool remove(const char* key){assert(!Fixture::taskActive);++removes;if(failRemove)return false;storage[space].erase(key);return true;}
};
'''

NVS = r'''
#pragma once
#include "Preferences.h"
constexpr esp_err_t ESP_ERR_NVS_NOT_FOUND=1,ESP_ERR_NVS_INVALID_LENGTH=2,ESP_ERR_NVS_TYPE_MISMATCH=3;
inline esp_err_t nvs_get_blob(uint32_t handle,const char* key,void* data,size_t* length){
 ++Preferences::reads;if(Preferences::reads==Preferences::failedRead||!Preferences::handles.count(handle))return ESP_FAIL;
 const auto space=Preferences::handles.at(handle);if(Preferences::wrongType==space+"/"+key)return ESP_ERR_NVS_TYPE_MISMATCH;
 const auto found=Preferences::storage[space].find(key);if(found==Preferences::storage[space].end())return ESP_ERR_NVS_NOT_FOUND;
 if(!data){*length=found->second.size();return ESP_OK;}
 if(*length<found->second.size()){*length=found->second.size();return ESP_ERR_NVS_INVALID_LENGTH;}
 *length=found->second.size();memcpy(data,found->second.data(),*length);
 if(Preferences::reads==Preferences::interruptRead)throw Preferences::PowerLoss{};return ESP_OK;
}
'''

SCENARIOS = r'''
#include <iostream>
#include <limits>
uint32_t millis(){return Fixture::now;}
uint32_t lampRenderedFrames=100,lampMaxRenderUs=1500;
bool following=false;uint8_t syncRole=0;bool syncPaused=false;
bool lampSyncFollowing(){return following;}bool leaveLampSceneForEffect(){return true;}
void pauseLampSync(){if(syncRole==2){following=false;syncPaused=true;}}
bool lampCalibrationActive(){return false;}unsigned short lampCalibrationPosition(){return 1;}
void moveLampCalibration(unsigned short){}bool finishLampCalibration(bool){return true;}
constexpr uint8_t MODE_MAX=47;uint8_t Mode=4,Brightness=100;bool PowerOn=true;
struct CRGB{static constexpr int Black=0;};int leds[1];constexpr int NUM_LEDS=1;
void fill_solid(int*,int,int){}void syncLampKnob(){}void noteLampUpdateUse(){}
struct{void setBrightness(int){}} FastLED;
#include "LampControl.ino"
void seed(bool microphone=true){Preferences::storage["coollamp"]["audioV2"]={2,uint8_t(microphone),8,8,0,100,0};}
void runCapture(){try{Fixture::taskFn(nullptr);}catch(const Fixture::PauseCapture&){} }
void output(){std::cout<<lampAudioJson()<<'\n';}
void snapshotOnly(){const int reads=Fixture::reads,writes=Preferences::writes,creates=Fixture::creates;for(int i=0;i<20;++i){getLampAudioFeatures();lampAudioCaptureStatus();lampAudioJson();}assert(reads==Fixture::reads&&writes==Preferences::writes&&creates==Fixture::creates);}
int main(int argc,char** argv){assert(argc==2);const std::string scenario=argv[1];
 if(scenario=="legacy"){
  Preferences::storage["coollamp"]["audioV1"]={1,1,16,12,0};beginLampAudio();assert(lampHasMicrophone()&&lampMicrophoneEnabled()&&lampMicrophoneEnabledKnown());
  assert(gain==16&&gate==12&&scale==100);snapshotOnly();assert(Preferences::writes==0);output();
 }else if(scenario=="hardware"){
  assert(provisionLampMicrophoneHardware(true));const int writes=Preferences::writes;assert(provisionLampMicrophoneHardware(true)&&Preferences::writes==writes);
  assert(!provisionLampMicrophoneHardware(false));beginLampAudio();assert(lampHasMicrophone());output();
  installed=false;seed(false);beginLampAudio();assert(!lampHasMicrophone());
  Preferences::storage["coollamp"]["audioV2"]={2,1};beginLampAudio();assert(!lampHasMicrophone());
  Preferences::storage["lampmodel"]["audioHwV1"][3]^=1;assert(!provisionLampMicrophoneHardware(true));
 }else if(scenario=="no_manufacturing"){
  beginLampAudio();assert(!lampHasMicrophone()&&Preferences::writes==0);serviceLampAudio(true,false);assert(Fixture::creates==0);output();
 }else if(scenario=="malformed_preference"){
  seed();Preferences::storage["coollamp"]["audioUseV1"]={1,0,0,0};beginLampAudio();assert(lampHasMicrophone()&&!lampMicrophoneEnabled()&&!lampMicrophoneEnabledKnown());serviceLampAudio(true,false);assert(Fixture::creates==0);snapshotOnly();output();
 }else if(scenario=="disabled"){
  seed();beginLampAudio();serviceLampAudio(true,false);assert(worker&&Fixture::taskActive);assert(!provisionLampMicrophoneHardware(true));
  assert(saveLampMicrophoneEnabled(false));assert(!Fixture::taskActive&&lampHasMicrophone()&&!lampMicrophoneEnabled());const int writes=Preferences::writes;
  assert(lampAvailableEffectCount()==47&&setLampControl(47,100,true));assert(Mode==47&&!setLampControl(48,100,true));
  assert(saveLampMicrophoneEnabled(false)&&Preferences::writes==writes);diagnoseLampAudio();serviceLampAudio(true,false);assert(!worker);output();
  enabled=true;enabledStored=false;beginLampAudio();assert(!lampMicrophoneEnabled());assert(saveLampMicrophoneEnabled(true));serviceLampAudio(true,false);assert(worker);assert(stopLampAudio());
 }else if(scenario=="capture-layout"||scenario=="partial-read"||scenario=="odd-read"||scenario=="oversize-read"||scenario=="empty-read"){
  seed();beginLampAudio();Fixture::signal=true;
  if(scenario=="partial-read")Fixture::readBytes=510;
  if(scenario=="odd-read")Fixture::readBytes=511;
  if(scenario=="oversize-read")Fixture::readBytes=514;
  if(scenario=="empty-read")Fixture::emptyRead=true;
  serviceLampAudio(true,false);assert(worker&&samples&&sizeof(*samples)==2&&CaptureStackBytes==2048);
  runCapture();const bool invalid=scenario=="odd-read"||scenario=="oversize-read"||scenario=="empty-read";
  assert(invalid?getLampAudioFeatures().errors==5:getLampAudioFeatures().valid);
  assert(stopLampAudio()&&!worker&&!samples&&!receiver&&!Fixture::taskActive);
  assert(Fixture::channelCreates==1&&Fixture::channelDeletes==1&&Fixture::creates==1&&Fixture::deletes==1);
  assert(stopLampAudio()&&Fixture::channelDeletes==1&&Fixture::deletes==1);output();
 }else if(scenario=="init-error"||scenario=="callback-error"||scenario=="enable-error"){
  seed();beginLampAudio();Fixture::failStage=scenario=="init-error"?2:scenario=="callback-error"?3:4;
  serviceLampAudio(true,false);assert(!worker&&!samples&&!receiver&&Fixture::channelDeletes==1&&Fixture::creates==0);
  assert(lampAudioCaptureStatus()==LampAudioCaptureStatus::Error);assert(stopLampAudio()&&Fixture::channelDeletes==1);output();
 }else if(scenario=="health"||scenario=="wrap"){
  seed();beginLampAudio();if(scenario=="wrap")Fixture::now=std::numeric_limits<uint32_t>::max()-500;
  serviceLampAudio(true,false);assert(lampAudioCaptureStatus()==LampAudioCaptureStatus::Starting);output();
  runCapture();assert(lampAudioCaptureStatus()==LampAudioCaptureStatus::Healthy&&!getLampAudioFeatures().signalSeen);output();snapshotOnly();
  Fixture::now+=100;assert(lampAudioCaptureStatus()==LampAudioCaptureStatus::Healthy);Fixture::now+=1;assert(lampAudioCaptureStatus()==LampAudioCaptureStatus::Stale);output();
  assert(lampHasMicrophone()&&lampMicrophoneEnabled());serviceLampAudio(false,false);assert(!worker&&lampAudioCaptureStatus()==LampAudioCaptureStatus::Idle);output();
 }else if(scenario=="starting_timeout"){
  seed();beginLampAudio();serviceLampAudio(true,false);Fixture::now+=2001;assert(lampAudioCaptureStatus()==LampAudioCaptureStatus::Stale);output();assert(stopLampAudio());
 }else if(scenario=="driver_error"||scenario=="task_error"||scenario=="read_error"){
  seed();beginLampAudio();if(scenario=="driver_error")Fixture::driverError=ESP_ERR_NO_MEM;if(scenario=="task_error")Fixture::failTask=true;
  serviceLampAudio(true,false);if(scenario=="read_error"){Fixture::readError=ESP_FAIL;runCapture();assert(Fixture::reads==5);}
  assert(lampAudioCaptureStatus()==LampAudioCaptureStatus::Error);output();snapshotOnly();
  Fixture::driverError=0;Fixture::failTask=false;Fixture::readError=0;if(worker)serviceLampAudio(true,false);
  const int attempts=Fixture::creates;Fixture::now+=4999;serviceLampAudio(true,false);assert(Fixture::creates==attempts);Fixture::now+=1;serviceLampAudio(true,false);assert(worker);assert(stopLampAudio());
 }else if(scenario=="stop_timeout"){
  seed();beginLampAudio();serviceLampAudio(true,false);Fixture::cooperativeStop=false;const int writes=Preferences::writes;
  assert(!saveLampMicrophoneEnabled(false)&&Preferences::writes==writes&&lampMicrophoneEnabled());assert(!tuneLampAudio(16,9,150)&&Preferences::writes==writes);Fixture::cooperativeStop=true;assert(stopLampAudio());
 }else if(scenario=="storage_rollback"||scenario=="storage_uncertain"){
  seed();beginLampAudio();assert(saveLampMicrophoneEnabled(true));const auto original=Preferences::storage["coollamp"]["audioUseV1"];
  serviceLampAudio(true,false);Preferences::corruptWrite=true;
  if(scenario=="storage_uncertain")Preferences::failedRead=Preferences::reads+3;
  if(scenario=="storage_uncertain")Preferences::failRemove=true;
  assert(!saveLampMicrophoneEnabled(false));assert(!Fixture::taskActive);
  assert(!lampAudioSaveUncertain()&&lampMicrophoneEnabled());assert(Preferences::storage["coollamp"]["audioUseV1"]==original);output();
 }else if(scenario=="uncertain_absence"){
  seed();beginLampAudio();Preferences::corruptWrite=true;Preferences::failRemove=true;assert(!saveLampMicrophoneEnabled(false));
  assert(lampAudioSaveUncertain()&&!lampMicrophoneEnabledKnown()&&!lampMicrophoneEnabled());serviceLampAudio(true,false);assert(Fixture::creates==0);output();
 }else if(scenario=="uncertain_prior"){
  seed();beginLampAudio();assert(saveLampMicrophoneEnabled(true));Preferences::corruptWrite=true;Preferences::failedWrite=Preferences::writes+2;
  assert(!saveLampMicrophoneEnabled(false)&&lampAudioSaveUncertain()&&!lampMicrophoneEnabledKnown());output();
  Preferences::failedWrite=0;assert(saveLampMicrophoneEnabled(false)&&lampMicrophoneEnabledKnown()&&!lampMicrophoneEnabled());
 }else if(scenario=="interrupt_write"||scenario=="interrupt_readback"){
  seed();beginLampAudio();assert(saveLampMicrophoneEnabled(true));const auto hardware=Preferences::storage["coollamp"]["audioV2"];
  serviceLampAudio(true,false);if(scenario=="interrupt_write")Preferences::interruptWrite=true;else Preferences::interruptRead=Preferences::reads+3;
  bool interrupted=false;try{saveLampMicrophoneEnabled(false);}catch(const Preferences::PowerLoss&){interrupted=true;}
  assert(interrupted&&!Fixture::taskActive);Preferences::interruptRead=0;enabled=true;enabledStored=false;beginLampAudio();
  assert(!lampMicrophoneEnabled()&&lampMicrophoneEnabledKnown()&&lampHasMicrophone());assert(Preferences::storage["coollamp"]["audioV2"]==hardware);output();
 }else if(scenario=="future_preference"){
  seed();Preferences::storage["coollamp"]["audioUseV1"]={2,1,0,0};beginLampAudio();const auto old=Preferences::storage;
  assert(!saveLampMicrophoneEnabled(false)&&Preferences::storage==old&&Preferences::writes==0);output();
 }else if(scenario=="unreadable_save"){
  seed();beginLampAudio();assert(saveLampMicrophoneEnabled(true));const auto original=Preferences::storage;const int writes=Preferences::writes;
  Preferences::failedRead=Preferences::reads+1;assert(!saveLampMicrophoneEnabled(false));assert(!lampMicrophoneEnabledKnown()&&Preferences::storage==original&&Preferences::writes==writes);output();
 }else if(scenario=="legacy_probe1"||scenario=="legacy_probe2"){
  assert(provisionLampMicrophoneHardware(true));seed(false);const auto original=Preferences::storage;const int writes=Preferences::writes;
  Preferences::failedRead=Preferences::reads+(scenario=="legacy_probe1"?1:2);beginLampAudio();assert(!lampHasMicrophone()&&!lampMicrophoneEnabledKnown()&&Preferences::storage==original&&Preferences::writes==writes);output();
 }else if(scenario=="owner_probe_error"||scenario=="owner_wrong_type"){
  seed();if(scenario=="owner_probe_error")Preferences::failedRead=Preferences::reads+4;else Preferences::wrongType="coollamp/audioUseV1";
  const int writes=Preferences::writes;beginLampAudio();assert(lampHasMicrophone()&&!lampMicrophoneEnabledKnown()&&Preferences::writes==writes);output();
 }else if(scenario=="rollback_absence_error"){
  seed();beginLampAudio();Preferences::corruptWrite=true;Preferences::failedRead=Preferences::reads+4;
  assert(!saveLampMicrophoneEnabled(false)&&lampAudioSaveUncertain()&&!lampMicrophoneEnabledKnown());assert(Preferences::removes==0&&Preferences::storage["coollamp"].count("audioUseV1"));output();
 }else if(scenario=="hardware_wrong_type"){
  assert(provisionLampMicrophoneHardware(true));const int writes=Preferences::writes;Preferences::wrongType="lampmodel/audioHwV1";
  assert(!provisionLampMicrophoneHardware(true)&&!provisionLampMicrophoneHardware(false)&&Preferences::writes==writes);beginLampAudio();assert(!lampHasMicrophone());output();
 }else if(scenario=="wrong_type_save"){
  seed();beginLampAudio();const int writes=Preferences::writes;Preferences::wrongType="coollamp/audioUseV1";
  assert(!saveLampMicrophoneEnabled(false)&&!lampMicrophoneEnabledKnown()&&Preferences::writes==writes&&Preferences::removes==0);output();
 }else if(scenario=="retry_deadline_zero"){
  seed();beginLampAudio();Fixture::now=std::numeric_limits<uint32_t>::max()-4999;Fixture::driverError=ESP_ERR_NO_MEM;
  serviceLampAudio(true,false);assert(retryPending&&retryAt==0&&Fixture::channelCreates==1);serviceLampAudio(true,false);assert(Fixture::channelCreates==1);
  Fixture::now+=4999;serviceLampAudio(true,false);assert(Fixture::channelCreates==1);Fixture::now+=1;Fixture::driverError=0;
  serviceLampAudio(true,false);assert(worker&&!retryPending&&Fixture::channelCreates==2);assert(stopLampAudio());output();
 }else if(scenario=="tuning"){
  seed();beginLampAudio();assert(saveLampMicrophoneEnabled(false));const auto use=Preferences::storage["coollamp"]["audioUseV1"];
  assert(tuneLampAudio(16,12,200));assert(gain==16&&gate==12&&scale==200&&!lampMicrophoneEnabled()&&lampHasMicrophone());assert(Preferences::storage["coollamp"]["audioUseV1"]==use);
  Preferences::failWrites=true;assert(!tuneLampAudio(32,14,250));assert(gain==16&&gate==12&&scale==200&&!lampAudioSaveUncertain());assert(!saveLampAudioConfiguration(true,0,12,100));output();
 }else if(scenario=="unreadable"){
  seed();Preferences::failOpen=true;beginLampAudio();assert(!lampMicrophoneEnabledKnown()&&!lampMicrophoneEnabled());output();
 }else if(scenario=="diagnostic_wrap"){
  seed();beginLampAudio();Fixture::now=std::numeric_limits<uint32_t>::max()-9999;diagnoseLampAudio();serviceLampAudio(false,false);assert(worker);
  Fixture::now+=9999;serviceLampAudio(false,false);assert(worker);Fixture::now+=1;serviceLampAudio(false,false);assert(!worker);output();
 }else assert(false);
}
'''


class AudioHealthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='coollamp-audio-health-')
        cls.addClassCleanup(cls.directory.cleanup)
        directory = Path(cls.directory.name)
        for folder in ('driver', 'freertos'):
            (directory/folder).mkdir()
        (directory/'Arduino.h').write_text(ARDUINO)
        (directory/'platform.h').write_text(PLATFORM)
        (directory/'Preferences.h').write_text(PREFERENCES)
        (directory/'nvs.h').write_text(NVS)
        for relative in ('driver/i2s_std.h', 'driver/gpio.h', 'freertos/semphr.h'):
            (directory/relative).write_text('#pragma once\n#include "platform.h"\n')
        source = directory/'test.cpp'
        source.write_text('#include "platform.h"\n#include "LampAudio.cpp"\n'+SCENARIOS)
        cls.binary = directory/'test'
        subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-misleading-indentation',
                        *SANITIZERS, '-I'+str(directory), '-I'+str(ROOT), str(source), '-o', str(cls.binary)], check=True)
        cls.layout_binary=directory/'layout'
        subprocess.run(['c++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,
                        str(ROOT/'tests/audio-layout.cpp'),'-o',str(cls.layout_binary)],check=True)

    def scenario(self, name):
        result = subprocess.run([str(self.binary), name], check=True, text=True, capture_output=True, timeout=5)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def test_legacy_installed_metadata_and_no_read_migration(self):
        value = self.scenario('legacy')[0]
        self.assertTrue(value['installed'] and value['enabled'])
        self.assertEqual(value['captureVersion'], 1)
        self.assertEqual(value['captureStatus'], 0)

    def test_mono_processed_values_match_existing_stereo_analysis(self):
        subprocess.run([str(self.layout_binary)],check=True,capture_output=True,timeout=10)

    def test_compact_capture_layout_partial_reads_and_exact_teardown(self):
        for scenario in ('capture-layout','partial-read','odd-read','oversize-read','empty-read',
                         'init-error','callback-error','enable-error'):
            self.scenario(scenario)

    def test_manufacturing_provisioning_and_legacy_precedence(self):
        self.assertTrue(self.scenario('hardware')[0]['installed'])
        self.assertFalse(self.scenario('no_manufacturing')[0]['installed'])

    def test_disable_retains_installed_hardware_and_survives_reload(self):
        value = self.scenario('disabled')[0]
        self.assertTrue(value['installed'])
        self.assertFalse(value['enabled'])
        self.assertEqual(value['captureStatus'], 0)

    def test_silent_capture_is_healthy_without_claiming_sound_or_presence(self):
        for scenario in ('health', 'wrap'):
            values = self.scenario(scenario)
            self.assertEqual([value['captureStatus'] for value in values], [1, 2, 3, 0])
            self.assertFalse(values[1]['signalSeen'])
            self.assertTrue(values[1]['valid'] and values[1]['enabled'])
        self.assertEqual(self.scenario('starting_timeout')[0]['captureStatus'], 3)

    def test_driver_task_and_read_failures_have_bounded_retry_and_stop(self):
        for scenario in ('driver_error', 'task_error', 'read_error'):
            self.assertEqual(self.scenario(scenario)[0]['captureStatus'], 4)
        self.scenario('stop_timeout')

    def test_storage_failure_restoration_and_uncertain_readback(self):
        for scenario in ('storage_rollback', 'storage_uncertain'):
            self.assertTrue(self.scenario(scenario)[0]['enabled'])
        value = self.scenario('uncertain_absence')[0]
        self.assertIsNone(value['enabled'])
        self.assertEqual(value['captureStatus'], 4)

    def test_corrupt_and_unreadable_owner_records_fail_closed(self):
        for scenario in ('malformed_preference', 'unreadable'):
            self.assertIsNone(self.scenario(scenario)[0]['enabled'])

    def test_tuning_preserves_owner_disable_and_rolls_back_failed_legacy_save(self):
        value = self.scenario('tuning')[0]
        self.assertEqual((value['gain'], value['gate'], value['scale']), (16, 12, 200))
        self.assertFalse(value['enabled'])

    def test_diagnostic_expiry_handles_deadline_zero_at_clock_rollover(self):
        self.assertEqual(self.scenario('diagnostic_wrap')[0]['captureStatus'], 0)

    def test_failed_restoration_reports_unknown_until_an_explicit_durable_repair(self):
        self.assertIsNone(self.scenario('uncertain_prior')[0]['enabled'])

    def test_restart_after_write_or_readback_recovers_durable_preference_without_hardware_change(self):
        for scenario in ('interrupt_write', 'interrupt_readback'):
            value = self.scenario(scenario)[0]
            self.assertTrue(value['installed'])
            self.assertFalse(value['enabled'])

    def test_unsupported_owner_preference_version_is_preserved(self):
        self.assertIsNone(self.scenario('future_preference')[0]['enabled'])

    def test_unreadable_existing_preference_never_claims_cached_permission_is_durable(self):
        self.assertIsNone(self.scenario('unreadable_save')[0]['enabled'])

    def test_raw_errors_on_either_legacy_probe_never_enable_factory_hardware(self):
        for scenario in ('legacy_probe1', 'legacy_probe2'):
            value = self.scenario(scenario)[0]
            self.assertFalse(value['installed'])
            self.assertIsNone(value['enabled'])

    def test_owner_query_error_or_wrong_type_never_becomes_default_or_save_authority(self):
        for scenario in ('owner_probe_error', 'owner_wrong_type', 'wrong_type_save'):
            self.assertIsNone(self.scenario(scenario)[0]['enabled'])

    def test_rollback_to_absence_requires_not_found_and_never_deletes_after_read_error(self):
        self.assertIsNone(self.scenario('rollback_absence_error')[0]['enabled'])

    def test_factory_wrong_type_is_preserved_and_cannot_activate_or_be_overwritten(self):
        self.assertFalse(self.scenario('hardware_wrong_type')[0]['installed'])

    def test_failure_backoff_does_not_treat_deadline_zero_as_immediate_retry(self):
        self.scenario('retry_deadline_zero')


if __name__ == '__main__':
    unittest.main()
