#pragma once
#include <cstddef>
#include <cstdint>
#include <sys/time.h>
constexpr int AF_INET=2, SOCK_STREAM=1, IPPROTO_TCP=6, SOL_SOCKET=1;
constexpr int SO_REUSEADDR=2, SO_SNDTIMEO=21, MSG_DONTWAIT=0x40, MSG_PEEK=2;
constexpr uint32_t INADDR_ANY=0;
struct sockaddr { uint16_t sa_family; char sa_data[14]; };
struct in_addr { uint32_t s_addr; };
struct sockaddr_in { uint16_t sin_family, sin_port; in_addr sin_addr; char sin_zero[8]; };
using socklen_t=unsigned int;
inline uint16_t htons(uint16_t value) { return uint16_t((value>>8)|(value<<8)); }
inline uint32_t htonl(uint32_t value) { return (value>>24)|((value>>8)&0xff00)|((value<<8)&0xff0000)|(value<<24); }
int socket(int family,int type,int protocol);
int setsockopt(int fd,int level,int option,const void* value,socklen_t length);
int bind(int fd,const sockaddr* address,socklen_t length);
int listen(int fd,int backlog);
int accept(int fd,sockaddr* address,socklen_t* length);
int recv(int fd,void* data,size_t size,int flags);
int send(int fd,const void* data,size_t size,int flags);
int close(int fd);
