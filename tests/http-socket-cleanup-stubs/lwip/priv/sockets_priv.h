#pragma once
#include <stdint.h>
#include <stddef.h>
#include <lwip/api.h>
struct lwip_sock {netconn* conn=nullptr;uint8_t fd_used=0,fd_free_pending=0;};
struct lwip_sock* lwip_socket_dbg_get_socket(int fd);
int close(int fd);
