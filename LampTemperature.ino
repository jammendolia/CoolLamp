#include <Arduino.h>
#include <cmath>
#include "soc/soc_caps.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/portmacro.h"
#if SOC_TEMP_SENSOR_SUPPORTED
#include "driver/temperature_sensor.h"
#endif

// Observational chip temperature only; this never changes lamp power or settings.
// Setup/loop own the SDK driver. Diagnostics only copy the cached scalar values.
namespace LampTemperatureRuntime {
// A failed latest read makes current temperature/age unavailable. The peak
// remains the highest successful finite sample since boot, even after errors.
struct Snapshot {
  bool valid = false;
  bool havePeak = false;
  float celsius = 0;
  float peakCelsius = 0;
  uint32_t sampledAt = 0;
  esp_err_t error = ESP_OK;
};
Snapshot snapshot;
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
bool begun = false;
#if SOC_TEMP_SENSOR_SUPPORTED
temperature_sensor_handle_t sensor = nullptr;
bool ready = false;
bool attempted = false;
uint32_t attemptedAt = 0;
#endif
}

void serviceLampTemperature()
{
#if SOC_TEMP_SENSOR_SUPPORTED
  using namespace LampTemperatureRuntime;
  if (!ready) return;
  const uint32_t now = millis();
  if (attempted && static_cast<uint32_t>(now - attemptedAt) < 1000) return;
  attempted = true;
  attemptedAt = now;
  float celsius = NAN;
  esp_err_t error = temperature_sensor_get_celsius(sensor, &celsius);
  // IDF 5.5.5 automatically changes hardware ranges without reinstalling. Its
  // C3 measurement limits are -40..125 C; 20..100 below is the initial range.
  if (error == ESP_OK && !std::isfinite(celsius)) error = ESP_ERR_INVALID_RESPONSE;
  if (error == ESP_OK && (celsius < -40.0f || celsius > 125.0f)) error = ESP_FAIL;
  const uint32_t sampledAt = millis();
  portENTER_CRITICAL(&mux);
  snapshot.error = error;
  snapshot.valid = error == ESP_OK;
  if (snapshot.valid) {
    snapshot.celsius = celsius;
    snapshot.sampledAt = sampledAt;
    if (!snapshot.havePeak || celsius > snapshot.peakCelsius) snapshot.peakCelsius = celsius;
    snapshot.havePeak = true;
  }
  portEXIT_CRITICAL(&mux);
#endif
}

void beginLampTemperature()
{
  using namespace LampTemperatureRuntime;
  if (begun) return;
  begun = true;
#if SOC_TEMP_SENSOR_SUPPORTED
  // Allocate once before networking/TLS. No allocation retries or driver
  // reinitialization occur during sampling, updates, or diagnostic requests.
  const temperature_sensor_config_t config = TEMPERATURE_SENSOR_CONFIG_DEFAULT(20, 100);
  esp_err_t error = temperature_sensor_install(&config, &sensor);
  if (error == ESP_OK) {
    error = temperature_sensor_enable(sensor);
    if (error != ESP_OK) {
      temperature_sensor_uninstall(sensor);
      sensor = nullptr;
    }
  }
  portENTER_CRITICAL(&mux);
  snapshot.error = error;
  portEXIT_CRITICAL(&mux);
  ready = error == ESP_OK;
  serviceLampTemperature();
#endif
}

String lampTemperatureJson()
{
  using namespace LampTemperatureRuntime;
  portENTER_CRITICAL(&mux);
  const Snapshot copy = snapshot;
  portEXIT_CRITICAL(&mux);
  String out;
  out.reserve(192);
#if SOC_TEMP_SENSOR_SUPPORTED
  out = "{\"supported\":true";
#else
  out = "{\"supported\":false";
#endif
  out += ",\"valid\":" + String(copy.valid ? "true" : "false");
  out += ",\"celsius\":" + (copy.valid ? String(copy.celsius, 1) : String("null"));
  out += ",\"peakCelsius\":" + (copy.havePeak ? String(copy.peakCelsius, 1) : String("null"));
  out += ",\"sampleAgeMs\":" + (copy.valid ? String(static_cast<uint32_t>(millis() - copy.sampledAt)) : String("null"));
  // SDK error codes are numeric; success and unsupported/uninitialized are null.
  out += ",\"error\":" + (copy.error == ESP_OK ? String("null") : String(static_cast<int>(copy.error))) + "}";
  return out;
}
