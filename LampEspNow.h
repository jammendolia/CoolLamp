#pragma once
#include <stdint.h>
#include <stddef.h>

// The callbacks only copy bounded bytes. All channel changes, peer admission,
// crypto, group state and diagnostics run on the Arduino loop task.
namespace LampEspNow {
constexpr size_t PayloadLimit=250, ReceiveCapacity=8, SendCapacity=12;
struct Received {
  uint8_t data[PayloadLimit]{},source[6]{};
  uint16_t length=0;
  uint8_t channel=0;
  int8_t rssi=0;
  uint32_t receivedAt=0;
};
struct Status {
  bool active=false,seeking=false,suspended=false;
  uint8_t channel=0;
  uint32_t generation=0,received=0,receiveDropped=0,sent=0,sendFailed=0,sendDropped=0,channelChanges=0;
};
void service(uint32_t now,bool blocked,bool scanning,bool associated,bool seeking);
void stop();
void holdChannel(uint32_t until);
bool receive(Received& message);
bool enqueue(const uint8_t* data,size_t length,const uint8_t* destination=nullptr,bool priority=false);
Status status();
}
