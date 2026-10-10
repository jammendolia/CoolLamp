#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace LampUpdatePolicy {
constexpr size_t TimezoneCapacity=64, RecordSize=84;
struct Policy {
 bool window=false,deferDuringUse=false;
 uint16_t startMinute=0,endMinute=0; // Half-open local interval; equal is invalid when enabled.
 uint32_t idleSeconds=300;
 char timezone[TimezoneCapacity]="UTC0"; // Explicit POSIX TZ; includes DST transition rules.
};
enum Eligibility:uint8_t {Ready=0,AutomaticDisabled=1,InUse=2,ClockUnknown=3,OutsideWindow=4,InvalidPolicy=5};
bool valid(const Policy& policy);
bool validTimezone(const char* timezone);
void encode(const Policy& policy,uint32_t revision,uint8_t out[RecordSize]);
bool decode(const uint8_t* bytes,size_t length,Policy& policy,uint32_t& revision);
Eligibility eligibility(const Policy& policy,bool automatic,bool clockValid,uint16_t localMinute,
                        uint32_t now,bool used,uint32_t lastUse);
}
