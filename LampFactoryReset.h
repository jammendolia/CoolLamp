#pragma once
#include <Arduino.h>

// Startup recovery runs before any settings or radios are loaded.
bool recoverLampFactoryReset();
bool lampFactoryResetNeedsBondErase();
bool completeLampFactoryReset();
bool requestLampFactoryReset();
bool lampFactoryResetPending();
bool lampFactoryResetArmed();
void armLampFactoryReset(bool armed);
void serviceLampFactoryReset();

constexpr uint8_t LAMP_FACTORY_RESET_COMMAND = 19;
constexpr uint8_t LAMP_FACTORY_RESET_CONFIRM = 0xa5;
