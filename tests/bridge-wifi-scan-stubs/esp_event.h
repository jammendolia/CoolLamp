#pragma once
#include <stdint.h>
using esp_err_t = int;
using esp_event_base_t = const char*;
using esp_event_handler_t = void (*)(void*, esp_event_base_t, int32_t, void*);
using esp_event_handler_instance_t = void*;
constexpr esp_err_t ESP_OK = 0;
constexpr esp_err_t ESP_FAIL = -1;
extern const char* WIFI_EVENT;
esp_err_t esp_event_handler_instance_register(esp_event_base_t, int32_t, esp_event_handler_t, void*, esp_event_handler_instance_t*);
