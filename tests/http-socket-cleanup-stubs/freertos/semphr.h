#pragma once
#include "FreeRTOS.h"
using SemaphoreHandle_t=void*;
BaseType_t xSemaphoreTake(SemaphoreHandle_t semaphore,TickType_t ticks);
BaseType_t xSemaphoreGive(SemaphoreHandle_t semaphore);
