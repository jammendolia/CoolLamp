#pragma once
#include <freertos/semphr.h>
extern SemaphoreHandle_t lock_tcpip_core;
enum sys_thread_core_lock_t {LWIP_CORE_LOCK_QUERY_HOLDER,LWIP_CORE_LOCK_MARK_HOLDER,LWIP_CORE_LOCK_UNMARK_HOLDER};
bool sys_thread_tcpip(sys_thread_core_lock_t type);
void testLock();
void testUnlock();
#define LOCK_TCPIP_CORE() testLock()
#define UNLOCK_TCPIP_CORE() testUnlock()
