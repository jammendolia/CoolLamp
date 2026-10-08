#include "../LampWifiRecoveryPolicy.h"
#include <cassert>
#include <iostream>
int main(){
  using P=LampWifiRecoveryPolicy;
  P p;
  assert(p.tick(100,false,false,false,true)==P::None);
  assert(p.tick(101,true,false,false,true)==P::Suspend);
  assert(!p.probing());
  assert(p.tick(60100,true,false,false,false)==P::None);
  assert(p.tick(60101,true,false,false,false)==P::Probe&&p.probing());
  assert(p.tick(62000,true,false,false,false)==P::None);
  assert(p.tick(62101,true,false,false,false)==P::AbortProbe&&!p.probing());
  assert(p.tick(122100,true,false,false,false)==P::None);
  assert(p.tick(122101,true,false,false,false)==P::Probe);
  // Association fixes the channel before DHCP supplies an IP address.
  assert(p.tick(122102,true,true,false,false)==P::Restore&&!p.probing());
  assert(p.tick(122103,true,true,false,true)==P::None);
  assert(p.tick(122104,true,false,false,true)==P::Suspend);
  assert(p.tick(122105,false,false,false,false)==P::Restore);
  // Explicit setup/update owns the radio; never disconnect it mid-job.
  assert(p.tick(122106,true,false,false,true)==P::Suspend);
  assert(p.tick(182106,true,false,false,false)==P::Probe);
  assert(p.tick(182200,true,false,true,false)==P::None&&!p.probing());
  assert(p.tick(184500,true,false,true,true)==P::None);
  assert(p.tick(184501,true,false,false,true)==P::Suspend);
  assert(p.tick(184502,false,false,false,false)==P::Restore);
  P wrap;
  assert(wrap.tick(0xfffffff0U,true,false,false,true)==P::Suspend);
  assert(wrap.tick(59983,true,false,false,false)==P::None);
  assert(wrap.tick(59984,true,false,false,false)==P::Probe);
  wrap.failed(60000);assert(!wrap.probing());
  assert(wrap.tick(119999,true,false,false,false)==P::None);
  assert(wrap.tick(120000,true,false,false,false)==P::Probe);
  std::cout<<"PASS: offline group radio, bounded AP recovery, DHCP, explicit radio ownership and rollover\n";
}
