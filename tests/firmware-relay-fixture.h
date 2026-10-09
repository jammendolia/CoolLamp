#pragma once
#include "../LampFirmwareRelay.h"
namespace LampFirmwareRelay {
inline bool ownsRadio(){return false;}
inline bool receive(const LampEspNow::Received&){return false;}
inline void service(uint32_t){}
inline void suspend(){}
}
