#include "UpdateHttpDiagnostics.h"
#include "LampJsonSink.h"
void appendUpdateHttpDiagnostics(LampJsonSink& out,const UpdateHttpDiagnosticsSnapshot& snapshot){
  out.concat(",\"httpStage\":");out.concat(snapshot.stage);out.concat(",\"httpCode\":");out.concat(snapshot.code);
  out.concat(",\"httpHost\":");out.concat(snapshot.host);out.concat(",\"tlsError\":");out.concat(snapshot.tlsError);
  out.concat(",\"tlsFlags\":");out.concat(snapshot.tlsFlags);out.concat(",\"transportError\":");out.concat(snapshot.transportError);
}
