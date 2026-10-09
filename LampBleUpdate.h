#pragma once
#include "LampBleUpdateWire.h"
// GATT callbacks only enqueue copied frames. Flash/hash work is loop-owned.
bool enqueueLampBleUpdate(const uint8_t* bytes,size_t size,uint32_t generation);
void serviceLampBleUpdate(uint32_t generation,bool bonded);
void getLampBleUpdateStatus(uint8_t* out); // Exactly 20 bytes; minimum ATT MTU.
