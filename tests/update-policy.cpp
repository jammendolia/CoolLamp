#include "LampUpdatePolicy.h"
#include "LampUpdateHealth.h"
#include <cassert>
#include <cstring>
#include <iostream>
using namespace LampUpdatePolicy;
int main(){
 Policy p;assert(valid(p));assert(eligibility(p,false,false,1440,0,false,0)==AutomaticDisabled);
 assert(eligibility(p,true,false,1440,0,false,0)==Ready);
 const char* good[]={"UTC0","CST6CDT,M3.2.0/2,M11.1.0/2","EST5EDT4,M3.2.0,M11.1.0","CET-1CEST,M3.5.0/2,M10.5.0/3","IST-5:30"};
 for(auto zone:good){char bounded[64]{};strcpy(bounded,zone);assert(validTimezone(bounded));}
 const char* bad[]={"","UTC","A0","UTC15","UTC0BAD","UTC0BAD,M13.2.0,M11.1.0","UTC0BAD,M3.6.0,M11.1.0","UTC0BAD,M3.2.7,M11.1.0","UTC0BAD,M3.2.0/24,M11.1.0","UTC0BAD,M3.2.0,M11.1.0extra","UTC0\"","UTC0\n"};
 for(auto zone:bad){char bounded[64]{};strcpy(bounded,zone);assert(!validTimezone(bounded));}
 char full[64];memset(full,'A',sizeof(full));assert(!validTimezone(full));
 p.window=true;p.startMinute=22*60;p.endMinute=6*60;
 assert(eligibility(p,true,false,0,0,false,0)==ClockUnknown);
 for(uint16_t minute:{uint16_t(0),uint16_t(359),uint16_t(1320),uint16_t(1439)})assert(eligibility(p,true,true,minute,0,false,0)==Ready);
 for(uint16_t minute:{uint16_t(360),uint16_t(1319)})assert(eligibility(p,true,true,minute,0,false,0)==OutsideWindow);
 p.deferDuringUse=true;p.idleSeconds=60;
 assert(eligibility(p,true,true,0,10,true,UINT32_MAX-49)==InUse);
 assert(eligibility(p,true,true,0,59950,true,UINT32_MAX-49)==Ready);
 p.startMinute=300;p.endMinute=360;assert(eligibility(p,true,true,300,0,false,0)==Ready);assert(eligibility(p,true,true,360,0,false,0)==OutsideWindow);
 uint8_t record[RecordSize];encode(p,7,record);Policy restored;uint32_t revision=0;assert(decode(record,sizeof(record),restored,revision)&&revision==7&&restored.startMinute==300&&restored.deferDuringUse);
 for(size_t i=0;i<sizeof(record);++i){record[i]^=1;assert(!decode(record,sizeof(record),restored,revision));record[i]^=1;}
 assert(!decode(record,sizeof(record)-1,restored,revision));
 p.endMinute=p.startMinute;assert(!valid(p));p.window=false;assert(valid(p));p.idleSeconds=86401;assert(!valid(p));
 LampUpdateHealth health;health.begin(UINT32_MAX-10000);
 for(uint32_t elapsed=0;elapsed<30000;elapsed+=100)assert(!health.observe(UINT32_MAX-10000+elapsed));
 assert(health.observe(UINT32_MAX-10000+30000));
 health.begin(0);assert(!health.observe(30000)); // A single elapsed-time sample cannot confirm.
 for(uint32_t now=30100;now<60000;now+=100){assert(!health.observe(now));}
 assert(health.observe(60000));
 std::cout<<"PASS update policy: versioned record, all-byte corruption, TZ/DST rules, boundaries, opt-out, clock, rollover\n";
}
