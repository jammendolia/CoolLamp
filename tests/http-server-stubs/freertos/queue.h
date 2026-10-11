#pragma once
#include "FreeRTOS.h"
struct FakeQueue;
using QueueHandle_t=FakeQueue*;
QueueHandle_t xQueueCreate(UBaseType_t length,UBaseType_t itemSize);
BaseType_t xQueueSend(QueueHandle_t queue,const void* item,TickType_t ticks);
BaseType_t xQueueReceive(QueueHandle_t queue,void* item,TickType_t ticks);
void vQueueDelete(QueueHandle_t queue);
