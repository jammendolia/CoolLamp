#pragma once
#include <Arduino.h>
#include "LampFactoryDesign.h"
class LampJsonSink;
namespace LampModel {
// Manufacturing metadata lives outside the user-reset namespace. No control
// endpoint provisions it or infers calibration from these strings.
using Record=LampFactoryDesign::Model;
void begin();
const Record& current();
bool valid(const Record& record);
bool provision(const Record& record); // service/manufacturing caller only
bool locked();
bool factoryAvailable();
// Only verified finished-product profiles may supply absent hardware defaults.
bool defaultMicrophoneInstalled();
const char* factoryStyle();
void appendJson(LampJsonSink& out);
String json();
}
