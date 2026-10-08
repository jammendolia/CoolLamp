#include "../LampEspNow.cpp"
#include <cassert>
#include <iostream>
using namespace LampEspNow;
int main(){
 fakeNow=1000;service(fakeNow,false,false,true,false);assert(status().active&&status().channel==1);
 uint8_t data[226]{};data[0]=17;uint8_t mac[6]={2,4,6,8,10,12};
 const auto dropped=status().receiveDropped;
 for(unsigned i=0;i<9;++i){data[1]=i;FakeRadio::receive(mac,data,sizeof(data));}
 data[0]=99;assert(status().receiveDropped==dropped+1);
 Received received;for(unsigned i=0;i<8;++i){assert(receive(received));assert(received.data[0]==17&&received.data[1]==i);assert(received.channel==1&&received.receivedAt==1000);}
 assert(!receive(received));
 FakeRadio::autoComplete=false;assert(enqueue(data,sizeof(data),mac,true));service(++fakeNow,false,false,true,false);assert(FakeRadio::sent.size()==1);
 uint8_t other[6]={4,4,6,8,10,12};assert(enqueue(data,sizeof(data),other));
 data[0]=72;assert(enqueue(data,sizeof(data),other)); // newest queued frame replaces older
 FakeRadio::complete(other);service(++fakeNow,false,false,true,false);assert(FakeRadio::sent.size()==1);
 FakeRadio::complete(mac,ESP_NOW_SEND_FAIL);service(++fakeNow,false,false,true,false);assert(status().sendFailed==1&&FakeRadio::sent.size()==2);
 assert(FakeRadio::sent.back().data[0]==72);FakeRadio::complete(other);service(++fakeNow,false,false,true,false);assert(status().sent==1);
 for(unsigned i=0;i<12;++i){mac[1]=i;assert(enqueue(data,sizeof(data),mac,true));}
 assert(!enqueue(data,sizeof(data),mac,true));assert(status().sendDropped>=1);
 service(++fakeNow,false,false,true,false);const auto sentCount=FakeRadio::sent.size();
 fakeNow+=201;service(fakeNow,false,false,true,false);assert(!status().active&&status().sendFailed==2);
 fakeNow+=1000;service(fakeNow,false,false,true,false);assert(status().active&&FakeRadio::sent.size()==sentCount); // uncertain packets never replay
 FakeRadio::autoComplete=true;stop();FakeRadio::channel=3;fakeNow+=1000;
 service(fakeNow,false,false,false,true);assert(status().active&&status().seeking);
 fakeNow+=341;service(fakeNow,false,false,false,true);assert(status().channel==4);
 holdChannel(fakeNow+450);fakeNow+=350;service(fakeNow,false,false,false,true);assert(status().channel==4);
 service(fakeNow,false,false,false,false);fakeNow+=1000;service(fakeNow,false,false,false,false);assert(status().channel==4&&!status().seeking); // authenticated lock sticks
 FakeRadio::scanning=true;const auto sets=FakeRadio::channelSets;service(++fakeNow,false,true,false,false);assert(!status().active&&FakeRadio::channelSets==sets);
 FakeRadio::channel=8;FakeRadio::scanning=false;service(++fakeNow,false,false,false,false);assert(status().active&&status().channel==4); // recover stable channel after scan
 FakeRadio::channel=6;service(++fakeNow,false,false,true,false);service(++fakeNow,false,false,true,false);assert(status().channel==6&&status().active);
 const auto apSets=FakeRadio::channelSets;fakeNow+=1000;service(fakeNow,false,false,true,true);assert(FakeRadio::channelSets==apSets&&!status().seeking);
 service(++fakeNow,true,false,true,false);assert(!status().active);FakeRadio::receive(mac,data,sizeof(data));assert(!receive(received));
 fakeNow+=1000;service(fakeNow,false,false,true,false);assert(status().active);
 stop();FakeRadio::channel=11;fakeNow+=1000;service(fakeNow,false,false,false,true);fakeNow+=341;service(fakeNow,false,false,false,true);assert(status().channel==1); // legal country wrap
 std::cout<<"PASS: bounded copied callback queue, serialized send completion, latest frames, failure/timeout no replay, scan suspension, legal acquisition/lock/AP channel recovery\n";
}
