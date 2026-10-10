#pragma once
#include <Arduino.h>
namespace LampModel {
// Manufacturing metadata lives outside the user-reset namespace. No control
// endpoint provisions it or infers calibration from these strings.
struct Record {uint8_t version=1,preconfigured=0;char id[49]{},name[65]{},artwork[33]{},hardware[33]{};};
void begin();
const Record& current();
bool valid(const Record& record);
bool provision(const Record& record); // service/manufacturing caller only
String json();
}
