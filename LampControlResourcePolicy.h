#pragma once
#ifndef COOLLAMP_CONTROL_RESOURCE_POLICY_H
#define COOLLAMP_CONTROL_RESOURCE_POLICY_H
#include <stddef.h>

// A common admission floor for complete HTTP/BLE/mesh control replies. 24 KiB
// covers the measured 16096-byte moving String peak plus 8 KiB of headroom.
// The initial 6 KiB String reservation requires 6160 contiguous bytes in core
// 3.3.11. This is admission, not a reservation or a bound on SDK allocations.
namespace LampControlResourcePolicy {
constexpr size_t MinFreeHeapBytes=24576,MinLargestBlockBytes=6160;
inline bool replyReady(size_t freeHeap,size_t largestBlock){
  return freeHeap>=MinFreeHeapBytes&&largestBlock>=MinLargestBlockBytes;
}
}
#endif
