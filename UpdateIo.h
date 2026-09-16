#pragma once
#include <stdint.h>

// TLS may need another read or write even on a blocking socket. Retry the same
// operation, yielding to the lamp loop, with both idle and whole-request limits.
template<class Io, class Clock, class Wait>
int updateIo(Io io, Clock now, Wait wait, uint32_t started, int wantRead, int wantWrite) {
  const uint32_t idle = now();
  while (uint32_t(now() - idle) < 30000 && uint32_t(now() - started) < 180000) {
    const int result = io();
    if (result != wantRead && result != wantWrite) return result;
    wait();
  }
  return -1;
}
