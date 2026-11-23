#include "UpdateHttpDiagnostics.h"
#include "LampJsonSink.h"
void appendUpdateHttpDiagnostics(LampJsonSink& out,const UpdateHttpDiagnosticsSnapshot& snapshot){
  out.concat(",\"httpStage\":");out.concat(snapshot.stage);out.concat(",\"httpCode\":");out.concat(snapshot.code);
  out.concat(",\"httpHost\":");out.concat(snapshot.host);out.concat(",\"tlsError\":");out.concat(snapshot.tlsError);
  out.concat(",\"tlsFlags\":");out.concat(snapshot.tlsFlags);out.concat(",\"transportError\":");out.concat(snapshot.transportError);
#ifdef COOL_LAMP_TEST_IMAGE
  if(snapshot.allocationProbe){
    out.concat(",\"allocationProbe\":{\"version\":1,\"failedBytes\":");out.concat(snapshot.failedBytes);
    out.concat(",\"failedCaps\":");out.concat(snapshot.failedCaps);out.concat(",\"failedCount\":");out.concat(snapshot.failedCount);out.concat('}');
  }
#endif
}
