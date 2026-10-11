#pragma once
#include "FreeRTOS.h"
using TaskFunction_t=void(*)(void*);
using TaskHandle_t=void*;
BaseType_t xTaskCreate(TaskFunction_t task,const char* name,uint32_t stackBytes,void* argument,UBaseType_t priority,TaskHandle_t* result);
UBaseType_t uxTaskGetStackHighWaterMark(TaskHandle_t);
void vTaskDelay(TickType_t ticks);
