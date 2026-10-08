#pragma once
#include "LampBleControlWire.h"

// All helpers run on the Arduino loop. GATT callbacks only enqueue frames.
size_t lampBleControlMetadata(uint8_t* out,size_t capacity);
void resetLampBleControlTransfer(uint32_t generation=0);
bool serviceLampBleControlTransfer(uint32_t generation,bool authorized,bool updating);
uint8_t lampBleControlCommand(const uint8_t* frame,size_t size,uint32_t generation,
                             uint8_t* reply,size_t capacity,size_t& replySize);
