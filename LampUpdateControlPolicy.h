#pragma once
#include <stddef.h>
#include <stdint.h>

// TLS uses the pinned 16 KiB receive / 2 KiB send build. Admission also leaves
// space for control replies; it is a conservative gate, not a heap guarantee.
namespace LampUpdateControlPolicy {
constexpr size_t MinFree = 24576;
// The linked Mbed TLS 3.6.6 input allocation adds 333 bytes of record overhead
// to its 16 KiB content limit. Protect the actual allocation, not just payload.
constexpr size_t MinLargest = 16384 + 333;
// Measured TLS pressure consumed roughly 24 KiB on this C3 build. Automatic
// discovery also reserves one complete control reply and all three bounded
// compact HTTP parsers (<1400 bytes each); explicit operations report failure
// rather than silently taking this background-only admission path.
constexpr size_t MinBackgroundFree = MinFree + 8192 + 3 * 1400;
constexpr size_t MinBackgroundLargest = MinLargest + 8192;
// HTTP headers, manifest parsing and image streaming use separate stack frames.
// Target stack/heap acceptance is still required for the TLS callees.
constexpr size_t WorkerStackBytes = 5120;
constexpr uint32_t DispatchSettleMs = 250;
inline bool manualStartReady(size_t free,size_t largest,size_t taskControlBytes) {
  // Stack and TLS can occupy different heap blocks. Check the actual remaining
  // heap again after task allocation, before the worker is notified.
  return free>=MinFree+WorkerStackBytes+taskControlBytes &&
    largest>=MinLargest && largest>=WorkerStackBytes;
}
// Before a lazy HTTPS worker exists, count its stack and the actual
// pinned FreeRTOS task-control type as well. This remains admission, not an
// allocator/SDK reservation; callers pass sizeof(StaticTask_t).
inline bool backgroundStartReady(bool controlIdle,size_t free,size_t largest,size_t taskControlBytes) {
  const size_t workerBytes=WorkerStackBytes+taskControlBytes;
  return controlIdle && free>=MinBackgroundFree+workerBytes &&
    largest>=MinBackgroundLargest+workerBytes;
}
constexpr uint32_t BackgroundBudgetMs = 6000;
constexpr uint32_t ExplicitBudgetMs = 180000;
constexpr uint32_t ConnectBudgetMs = 12000;
constexpr uint32_t ConnectPollMs = 10;
inline bool memoryReady(size_t free,size_t largest) {
  return free >= MinFree && largest >= MinLargest;
}
inline bool backgroundReady(bool controlIdle,size_t free,size_t largest) {
  return controlIdle && free >= MinBackgroundFree && largest >= MinBackgroundLargest;
}
inline bool withinBudget(uint32_t now,uint32_t started,uint32_t budget) {
  return uint32_t(now-started) < budget;
}
}
