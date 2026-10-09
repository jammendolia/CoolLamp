#pragma once
#include "LampMeshWire.h"
namespace LampMeshCrypto {
// Core reserves each (origin boot, sequence) once. Retries reuse identical
// immutable bytes; only the separately authenticated retry wave changes.
bool seal(const LampMeshWire::Packet&,const uint8_t* payload,const uint8_t* fleetKey,const uint8_t* sender,uint8_t ttl,uint8_t attempt,uint8_t* output,size_t& size);
bool open(const uint8_t* input,size_t size,const uint8_t* fleetKey,const uint8_t* sender,LampMeshWire::Packet&,uint8_t* payload);
// Call only after open succeeds. Re-authenticates the unchanged AEAD envelope
// for a new physical sender and exactly one fewer remaining hop.
bool forward(const uint8_t* input,size_t size,const uint8_t* fleetKey,const uint8_t* sender,uint8_t* output);
}
