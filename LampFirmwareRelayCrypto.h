#pragma once
#include "LampFirmwareRelayWire.h"
namespace LampFirmwareRelayCrypto {
bool seal(const uint8_t* body,size_t length,const uint8_t* source,const uint8_t* destination,const uint8_t* fleetKey,uint64_t boot,uint32_t sequence,uint8_t* output);
bool open(const uint8_t* input,size_t length,const uint8_t* source,const uint8_t* destination,const uint8_t* fleetKey,uint8_t* body,size_t& bodySize);
}
