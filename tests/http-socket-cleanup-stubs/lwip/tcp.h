#pragma once
#include <stdint.h>
#define LWIP_TCPIP_CORE_LOCKING 1
#define LWIP_NETCONN_FULLDUPLEX 1
#define LWIP_SOCKET 1
#define LWIP_TCP 1
#define TCP_SND_BUF 5744
enum tcp_state {CLOSED,LISTEN,ESTABLISHED,FIN_WAIT_1,CLOSE_WAIT,FIN_WAIT_2,TIME_WAIT};
struct tcp_seg {};
struct tcp_pcb {tcp_state state=ESTABLISHED;tcp_seg* unsent=nullptr;tcp_seg* unacked=nullptr;uint32_t snd_buf=TCP_SND_BUF;uint32_t snd_queuelen=0;uint16_t mss=1436;};
#define tcp_sndbuf(pcb) ((pcb)->snd_buf)
#define tcp_sndqueuelen(pcb) ((pcb)->snd_queuelen)
#define tcp_mss(pcb) ((pcb)->mss)
void tcp_abort(tcp_pcb* pcb);
