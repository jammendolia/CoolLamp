#pragma once
#include <stdint.h>
class LampJsonSink;
struct UpdateHttpDiagnosticsSnapshot {
  int32_t stage=0,code=0,host=0,tlsError=0,tlsFlags=0,transportError=0;
#ifdef COOL_LAMP_TEST_IMAGE
  uint32_t failedBytes=0,failedCaps=0,failedCount=0;
  bool allocationProbe=false;
#endif
};
UpdateHttpDiagnosticsSnapshot captureUpdateHttpDiagnostics();
void appendUpdateHttpDiagnostics(LampJsonSink& out,const UpdateHttpDiagnosticsSnapshot& snapshot);
