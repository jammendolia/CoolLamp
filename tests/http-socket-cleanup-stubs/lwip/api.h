#pragma once
#include "tcp.h"
#define NETCONN_TCP 0x10
#define NETCONN_UDP 0x20
#define NETCONNTYPE_GROUP(type) ((type)&0xf0)
struct netconn {int type=NETCONN_TCP;union {tcp_pcb* tcp;} pcb;};
#define netconn_type(conn) ((conn)->type)
