#pragma once
#include <stdint.h>

// Exclusive ownership transfers only after enqueue succeeds. No lamp state,
// request body, credentials, rendering or storage is accessible to this task.
namespace LampHttpSocketCleanup {
struct Request {
  int fd=-1;
  uint32_t acceptedAt=0,progressAt=0,absoluteTimeoutMs=5000;
  bool cancelled=false;
  // Positive loop-owned send / last observed flight supplies this baseline.
  // Zero means unknown (listeners/default callers), never invented progress.
  uint16_t knownPendingBytes=0;
};
static_assert(sizeof(Request)==20,"Bounded detached socket record unexpectedly grew");
struct Metrics {
  uint32_t queued=0,closeAttempts=0,closeFailures=0,aborts=0,pendingOwned=0,maxOwnedMs=0;
};
// Only the loop owning a live, attached socket may query this. It never waits
// for the core mutex, and returns no PCB/socket pointers across that boundary.
// A new application write waits until all prior copied bytes and the SDK's
// pbuf queue have drained. The SDK may split/retransmit a queued write later;
// this bounds application payload, not its physical pbuf or heap overhead.
constexpr uint16_t MaxTransmitFlightBytes=1024;
// Copied outgoing data may use the original API lifetime instead of a shorter
// secondary cutoff. RTT estimation/scheduling can change SDK retransmission
// timing; this policy is not a retry guarantee. Incomplete input stays 1.5s,
// and original API5s/HTML15s/upload180s totals always take precedence.
constexpr uint32_t AckWaitTimeoutMs=5000;
// observed distinguishes a real bounded TCP snapshot from lock contention or
// a temporarily referenced fd. Pending progress does not grant another write.
struct TransmitCredit {
  uint16_t bytes=0;bool disconnected=false,observed=false;
  uint16_t pendingBytes=0,pendingSegments=0;
};
TransmitCredit transmitCredit(int fd);
bool start();
bool enqueue(const Request& request);
uint32_t taskStackMinimumBytes();
Metrics metrics();

// One bounded owner is also exercised directly by the production host fixture.
// Once close succeeds, step never inspects that fd again: it may be reused.
class Owner {
  Request request_;
  uint32_t previousBytes_=0,previousSegments_=0;
  bool observed_=false,closing_=false,active_=true;
public:
  explicit Owner(const Request& request):request_(request),previousBytes_(request.knownPendingBytes),observed_(request.knownPendingBytes!=0){}
  bool step(uint32_t now);
  bool active()const{return active_;}
};
}
