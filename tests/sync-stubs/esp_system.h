#pragma once
#include <stdint.h>
inline uint32_t esp_random(){static uint32_t value=100;return ++value;}
