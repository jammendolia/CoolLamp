"""Exercise the actual cached chip temperature observer without hardware."""
import json
import pathlib
import subprocess
import tempfile
import unittest

from host_compiler import SANITIZERS

ROOT = pathlib.Path(__file__).resolve().parents[1]

ARDUINO = r'''
#pragma once
#include <cstdint>
#include <cstdio>
#include <string>
#include <type_traits>
#include <cassert>
extern uint32_t clockMs;
extern int criticalDepth;
inline uint32_t millis(){return clockMs;}
struct String : std::string {
 using std::string::string;
 String(const std::string& s):std::string(s){}
 template<class T,typename std::enable_if<std::is_integral<T>::value,int>::type=0>
 String(T value):std::string(std::to_string(value)){assert(criticalDepth==0);}
 String(float value,int decimals){assert(criticalDepth==0);char text[48];std::snprintf(text,sizeof(text),"%.*f",decimals,value);assign(text);}
};
'''

ERRORS = r'''
#pragma once
using esp_err_t=int;
constexpr esp_err_t ESP_OK=0,ESP_FAIL=-1,ESP_ERR_NO_MEM=0x101,
 ESP_ERR_INVALID_STATE=0x103,ESP_ERR_INVALID_RESPONSE=0x108;
'''

LOCKS = r'''
#pragma once
#include <cassert>
using portMUX_TYPE=int;
#define portMUX_INITIALIZER_UNLOCKED 0
extern int criticalDepth;
inline void enterCritical(portMUX_TYPE*){assert(criticalDepth==0);++criticalDepth;}
inline void exitCritical(portMUX_TYPE*){assert(criticalDepth==1);--criticalDepth;}
#define portENTER_CRITICAL(mux) enterCritical(mux)
#define portEXIT_CRITICAL(mux) exitCritical(mux)
'''

DRIVER = r'''
#pragma once
#include "esp_err.h"
#include <cassert>
struct temperature_sensor_obj_t {int value;};
using temperature_sensor_handle_t=temperature_sensor_obj_t*;
struct temperature_sensor_config_t {int range_min,range_max;struct {unsigned allow_pd;} flags;};
#define TEMPERATURE_SENSOR_CONFIG_DEFAULT(low,high) {low,high,{0}}
inline temperature_sensor_obj_t device{};
inline int installs=0,enables=0,uninstalls=0,reads=0;
inline esp_err_t installResult=ESP_OK,enableResult=ESP_OK,readResult=ESP_OK;
inline float sensorValue=42.2f;
extern int criticalDepth;
inline esp_err_t temperature_sensor_install(const temperature_sensor_config_t* config,temperature_sensor_handle_t* sensor){
 assert(criticalDepth==0);++installs;assert(config->range_min==20&&config->range_max==100&&config->flags.allow_pd==0);
 *sensor=installResult==ESP_OK?&device:nullptr;return installResult;
}
inline esp_err_t temperature_sensor_enable(temperature_sensor_handle_t sensor){assert(criticalDepth==0&&sensor==&device);++enables;return enableResult;}
inline esp_err_t temperature_sensor_uninstall(temperature_sensor_handle_t sensor){assert(criticalDepth==0&&sensor==&device);++uninstalls;return ESP_OK;}
inline esp_err_t temperature_sensor_get_celsius(temperature_sensor_handle_t sensor,float* value){
 assert(criticalDepth==0&&sensor==&device);++reads;*value=sensorValue;return readResult;
}
'''

SCENARIOS = r'''
#include <iostream>
#include <limits>
uint32_t clockMs=0;
int criticalDepth=0;
void emit(){std::cout<<lampTemperatureJson()<<"\n";assert(criticalDepth==0);}
int main(int argc,char** argv){
 assert(argc==2);const std::string test=argv[1];
#if SOC_TEMP_SENSOR_SUPPORTED
 if(test=="cache"){
  emit();beginLampTemperature();emit();assert(installs==1&&enables==1&&reads==1);
  for(int i=0;i<10;++i){clockMs=999;serviceLampTemperature();lampTemperatureJson();}
  assert(reads==1);emit();clockMs=1000;sensorValue=80;serviceLampTemperature();emit();
  clockMs=2000;sensorValue=35;serviceLampTemperature();emit();
  clockMs=3000;sensorValue=105;serviceLampTemperature();emit();
  clockMs=4000;sensorValue=-5;serviceLampTemperature();emit();
  clockMs=5000;sensorValue=0;serviceLampTemperature();emit();
  clockMs=120000;emit();assert(reads==6);
  beginLampTemperature();assert(installs==1&&enables==1&&uninstalls==0&&reads==6);
 }else if(test=="recovery"){
  sensorValue=55.1f;beginLampTemperature();emit();
  clockMs=1000;readResult=ESP_FAIL;sensorValue=999;serviceLampTemperature();emit();
  for(int i=0;i<10;++i){serviceLampTemperature();lampTemperatureJson();}
  assert(reads==2);clockMs=2000;readResult=ESP_OK;sensorValue=61.5f;serviceLampTemperature();emit();
  clockMs=3000;readResult=ESP_ERR_INVALID_STATE;sensorValue=80;serviceLampTemperature();emit();
  assert(installs==1&&enables==1&&uninstalls==0&&reads==4);
 }else if(test=="bad_values"){
  sensorValue=std::numeric_limits<float>::quiet_NaN();beginLampTemperature();emit();
  clockMs=1000;sensorValue=std::numeric_limits<float>::infinity();serviceLampTemperature();emit();
  clockMs=2000;sensorValue=125.1f;serviceLampTemperature();emit();
  clockMs=3000;sensorValue=-40.1f;serviceLampTemperature();emit();
  clockMs=4000;sensorValue=-40;serviceLampTemperature();emit();
  clockMs=5000;sensorValue=125;serviceLampTemperature();emit();
 }else if(test=="install_failure"||test=="enable_failure"){
  if(test=="install_failure")installResult=ESP_ERR_NO_MEM;else enableResult=ESP_ERR_INVALID_STATE;
  beginLampTemperature();emit();
  for(int i=0;i<20;++i){clockMs+=1000;beginLampTemperature();serviceLampTemperature();lampTemperatureJson();}
  assert(installs==1&&reads==0);
  assert(enables==(test=="install_failure"?0:1)&&uninstalls==(test=="install_failure"?0:1));emit();
 }else if(test=="wrap"){
  clockMs=std::numeric_limits<uint32_t>::max()-500;beginLampTemperature();emit();
  clockMs=498;serviceLampTemperature();assert(reads==1);emit();
  clockMs=499;sensorValue=75;serviceLampTemperature();assert(reads==2);emit();
  clockMs=1498;serviceLampTemperature();assert(reads==2);emit();
  clockMs=1499;serviceLampTemperature();assert(reads==3);emit();
 }else assert(false);
#else
 assert(test=="unsupported");emit();beginLampTemperature();emit();
 for(int i=0;i<20;++i){clockMs+=1000;beginLampTemperature();serviceLampTemperature();}
 emit();
#endif
}
'''


class TemperatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='coollamp-temperature-')
        cls.addClassCleanup(cls.directory.cleanup)
        cls.binaries = {}
        for supported in (False, True):
            directory = pathlib.Path(cls.directory.name) / str(int(supported))
            directory.mkdir()
            for folder in ('soc', 'freertos'):
                (directory / folder).mkdir()
            (directory / 'Arduino.h').write_text(ARDUINO)
            (directory / 'esp_err.h').write_text(ERRORS)
            (directory / 'soc/soc_caps.h').write_text(f'#define SOC_TEMP_SENSOR_SUPPORTED {int(supported)}\n')
            (directory / 'freertos/FreeRTOS.h').write_text(LOCKS)
            (directory / 'freertos/portmacro.h').write_text('#pragma once\n')
            if supported:
                (directory / 'driver').mkdir()
                (directory / 'driver/temperature_sensor.h').write_text(DRIVER)
            source = directory / 'test.cpp'
            binary = directory / 'test'
            source.write_text('#include "Arduino.h"\n' + (ROOT / 'LampTemperature.ino').read_text() + SCENARIOS)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS,
                            '-I' + str(directory), str(source), '-o', str(binary)], check=True)
            cls.binaries[supported] = binary

    def run_scenario(self, name, supported=True):
        result = subprocess.run([str(self.binaries[supported]), name], check=True,
                                text=True, capture_output=True)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def assert_unavailable(self, sample, error=None, peak=None, supported=True):
        self.assertEqual(sample, {'supported': supported, 'valid': False, 'celsius': None,
                                 'peakCelsius': peak, 'sampleAgeMs': None, 'error': error})

    def test_sampling_cache_high_range_and_peak(self):
        samples = self.run_scenario('cache')
        self.assert_unavailable(samples[0])
        self.assertEqual(samples[1]['celsius'], 42.2)
        self.assertEqual(samples[2]['sampleAgeMs'], 999)
        self.assertEqual([s['celsius'] for s in samples[3:8]], [80, 35, 105, -5, 0])
        self.assertEqual([s['peakCelsius'] for s in samples[3:8]], [80, 80, 105, 105, 105])
        self.assertTrue(all(s['valid'] and s['error'] is None for s in samples[1:]))
        self.assertEqual(samples[8]['sampleAgeMs'], 115000)

    def test_errors_never_publish_driver_output_and_recover_without_reinstall(self):
        samples = self.run_scenario('recovery')
        self.assert_unavailable(samples[1], error=-1, peak=55.1)
        self.assertEqual(samples[2]['celsius'], 61.5)
        self.assertEqual(samples[2]['peakCelsius'], 61.5)
        self.assert_unavailable(samples[3], error=0x103, peak=61.5)

    def test_nonfinite_and_out_of_range_samples_are_not_valid_json_numbers(self):
        samples = self.run_scenario('bad_values')
        for sample, error in zip(samples[:4], [0x108, 0x108, -1, -1]):
            self.assert_unavailable(sample, error=error)
        self.assertEqual([s['celsius'] for s in samples[4:]], [-40, 125])
        self.assertEqual([s['peakCelsius'] for s in samples[4:]], [-40, 125])

    def test_initialization_failures_cleanup_once_and_never_retry_allocations(self):
        for scenario, error in [('install_failure', 0x101), ('enable_failure', 0x103)]:
            with self.subTest(scenario=scenario):
                for sample in self.run_scenario(scenario):
                    self.assert_unavailable(sample, error=error)

    def test_millis_wrap_preserves_sampling_interval_and_age(self):
        samples = self.run_scenario('wrap')
        self.assertEqual([s['sampleAgeMs'] for s in samples], [0, 999, 0, 999, 0])
        self.assertEqual(samples[2]['celsius'], 75)

    def test_unsupported_target_compiles_without_sensor_driver(self):
        for sample in self.run_scenario('unsupported', supported=False):
            self.assert_unavailable(sample, supported=False)


if __name__ == '__main__':
    unittest.main()
