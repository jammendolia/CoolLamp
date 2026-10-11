#pragma once
constexpr int F_SETFL=4,O_NONBLOCK=0x800;
int fcntl(int fd,int command,int flags);
