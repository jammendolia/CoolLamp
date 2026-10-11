#pragma once
#include <cstdint>
using BaseType_t=int;
using UBaseType_t=unsigned int;
using TickType_t=uint32_t;
constexpr BaseType_t pdTRUE=1,pdFALSE=0,pdPASS=1;
constexpr TickType_t portMAX_DELAY=UINT32_MAX;
