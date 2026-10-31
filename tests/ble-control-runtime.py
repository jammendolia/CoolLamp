"""Exercise the actual loop-only BLE RPC adapter without a radio or NVS."""
import pathlib
import subprocess
import tempfile
import unittest
from host_compiler import SANITIZERS

ROOT = pathlib.Path(__file__).resolve().parents[1]


class BleControlTests(unittest.TestCase):
    def test_loop_adapter_correlation_private_reads_update_and_disconnect(self):
        arduino = r'''
#pragma once
#include <cstdint>
#include <cstring>
#include <string>
#include <cassert>
#include <utility>
inline bool failNextReserve=false,failNextConcat=false;
inline bool failNextText=false,failNextOwnedCopy=false;
inline bool failNextReadRetain=false;
inline unsigned textConstructionAttempts=0,reserveAttempts=0;
inline unsigned wipedBufferReleases=0;
inline size_t wipedBytes=0;
inline uint32_t fakeFreeHeap=50000,fakeLargestBlock=24000;
struct Esp {uint32_t getFreeHeap()const{return fakeFreeHeap;}uint32_t getMaxAllocHeap()const{return fakeLargestBlock;}};
inline Esp ESP;
struct String:std::string {
 using std::string::operator=;
 String()=default;
 String(const char* text):std::string(failNextText?"":text){++textConstructionAttempts;failNextText=false;}
 String(const std::string& s):std::string(s){}
 String(const String& s):std::string(s){}
 String(String&& s)noexcept:std::string(std::move(s)){}
 String& operator=(const String& text){
  if(failNextOwnedCopy&&text=="Saved"){failNextOwnedCopy=false;std::string::clear();return *this;}
  if(failNextReadRetain&&!text.empty()&&text[0]=='s'){failNextReadRetain=false;std::string::clear();return *this;}
  std::string::operator=(text);return *this;
 }
 String& operator=(String&& text)noexcept{
  if(failNextReadRetain&&!text.empty()&&text[0]=='s'){failNextReadRetain=false;std::string::clear();return *this;}
  std::string::operator=(std::move(text));return *this;
 }
 String& operator=(const char* text){
  if(text){if(failNextText){failNextText=false;std::string::clear();}else std::string::operator=(text);return *this;}
  // Model the pinned core's null-assignment invalidation, and verify the
  // production cleanup erased private bytes before releasing this storage.
  if(!empty()){
   for(char byte:*this)assert(byte==0);
   ++wipedBufferReleases;wipedBytes+=size();
  }
  clear();shrink_to_fit();return *this;
 }
 bool isEmpty()const{return empty();}
 bool reserve(size_t n){++reserveAttempts;if(failNextReserve){failNextReserve=false;return false;}std::string::reserve(n);return true;}
 bool concat(const char* p,size_t n){if(failNextConcat){failNextConcat=false;append(p,n/2);return false;}append(p,n);return true;}
};
uint32_t millis();
'''
        fixture = r'''
#include <cassert>
#include <vector>
#include <iostream>
#include <cstdlib>
size_t wireMallocAttempts=0;
bool rejectWireMalloc=false;
void* wireMalloc(size_t bytes){++wireMallocAttempts;return rejectWireMalloc?nullptr:std::malloc(bytes);}
// Compile the unchanged production translation unit here so its legacy wire
// allocator can be faulted independently of String and SDK allocations.
#define malloc wireMalloc
#include "LampBleControl.cpp"
#undef malloc
#include "LampControlEndpoint.h"
uint32_t clockMs=100;uint32_t millis(){return clockMs;}
bool updating=false;bool lampUpdateOwnsResources(){return updating;}
unsigned calls=0;uint8_t lastEndpoint=0;bool lastMutation=false;String lastForm;
unsigned stateBytes=2049,firmwareBytes=0;
uint16_t handlerStatus=200;
const char* lastHandlerBody=nullptr;
String lampControlSnapshotJson(){return "{}";}
namespace LampFirmwareRelay {LampControlReply control(bool,const String&){return {200,"{}"};}}
LampControlReply lampControlRequest(uint8_t endpoint,bool mutation,const String& form,bool confidential){
 assert(confidential);
 ++calls;lastEndpoint=endpoint;lastMutation=mutation;lastForm=form;
 LampControlReply reply;reply.status=handlerStatus;
 if(endpoint==3)reply.body="CL1-aabbccddeeff-0123456789abcdef0123456789abcdef";
 else if(endpoint==1)reply.body=std::string(stateBytes,'s');
 else if(endpoint==18)reply.body=firmwareBytes?String(std::string(firmwareBytes,'f')):String("{\"version\":\"1.10.0\",\"phase\":0}");
 else reply.body="Saved";
 lastHandlerBody=reply.body.c_str();
 return reply;
}
using namespace LampBleControlWire;
uint8_t out[MaxPage]{};size_t outSize=0;
uint8_t send(const std::vector<uint8_t>& frame,uint32_t owner=7){return lampBleControlCommand(frame.data(),frame.size(),owner,out,sizeof(out),outSize);}
std::vector<uint8_t> begin(uint16_t tx,uint8_t endpoint,uint8_t method,uint16_t length=0){return {1,1,Begin,uint8_t(tx),uint8_t(tx>>8),endpoint,method,uint8_t(length),uint8_t(length>>8)};}
std::vector<uint8_t> commit(uint16_t tx){return {1,3,Commit,uint8_t(tx),uint8_t(tx>>8)};}
std::vector<uint8_t> page(uint16_t tx,uint16_t offset=0){return {1,4,Page,uint8_t(tx),uint8_t(tx>>8),uint8_t(offset),uint8_t(offset>>8)};}
std::string payload(){return std::string(reinterpret_cast<const char*>(out+Header),outSize-Header);}
int main(){
 outSize=lampBleControlMetadata(out,sizeof(out));assert(outSize>Header&&u16(out+1)==0&&out[3]==0&&u16(out+4)==200);
 assert(payload().find("\"pageBytes\":480")!=std::string::npos&&payload().find("\"maxRequest\":1024")!=std::string::npos);
 resetLampBleControlTransfer(7);
 assert(send(begin(500,1,Read))==0&&calls==0);assert(send(commit(500))==0&&calls==1&&lastEndpoint==1&&!lastMutation&&lastForm.empty());
 assert(outSize==492&&u16(out+1)==500&&u16(out+6)==2049&&u16(out+10)==480);
 std::string state=payload();
 for(uint16_t offset=480;offset<2049;offset+=480){assert(send(page(500,offset))==0&&u16(out+8)==offset);state+=payload();}
 assert(state==std::string(2049,'s'));
 assert(send(commit(500))==2&&calls==1);assert(send(begin(500,1,Read))==2&&calls==1);
 const std::string form="leds=205&milliamps=500&ssid=Home&wifiPassword=privatepassword";
 assert(send(begin(501,7,Mutation,form.size()))==0);
 for(size_t offset=0;offset<form.size();offset+=13){
  std::vector<uint8_t> frame{1,2,Chunk,245,1,uint8_t(offset),uint8_t(offset>>8)};
  frame.insert(frame.end(),form.begin()+offset,form.begin()+std::min(offset+13,form.size()));assert(send(frame)==0&&calls==1);
 }
 assert(send(commit(501))==0&&calls==2&&lastEndpoint==7&&lastMutation&&lastForm==form&&payload()=="Saved");
 assert(send(commit(501))==2&&calls==2);
 assert(send(begin(502,3,Mutation))==0&&send(commit(502))==0&&calls==3&&payload().find("CL1-")==0);
 assert(serviceLampBleControlTransfer(8,true,false));assert(send(page(502),8)==2&&calls==3);
 assert(send(begin(1,3,Mutation),8)==0&&send(commit(1),8)==0&&calls==4);
 assert(send(begin(1,0,0),8)==0&&u16(out+1)==0&&payload().find("CL1-")==std::string::npos);
 assert(send(commit(1),8)==2&&calls==4);
 assert(send(begin(2,3,Mutation),8)==0&&send(commit(2),8)==0);
 clockMs+=Timeout;assert(serviceLampBleControlTransfer(8,true,false));assert(send(page(2),8)==2);
 assert(send(begin(3,1,Read),8)==0);
 updating=true;assert(serviceLampBleControlTransfer(8,true,true));
 assert(send(commit(3),8)==3);assert(send(begin(4,7,Mutation),8)==3);
 assert(send(begin(4,18,Read),8)==0&&send(commit(4),8)==0&&lastEndpoint==18&&!lastMutation&&payload().find("1.10.0")!=std::string::npos);
 assert(outSize<MaxPage);updating=false;
 assert(serviceLampBleControlTransfer(8,false,false));assert(send(page(4),8)==2);
 // Exercise Style through real Begin/Chunk/Commit, rather than bypassing wire validation.
 const auto styleCalls=calls;
 assert(send(begin(5,25,Mutation,7),8)==0);
 assert(send({1,2,Chunk,5,0,0,0,'s','t','y','l','e','=','3'},8)==0&&calls==styleCalls);
 assert(send(commit(5),8)==0&&calls==styleCalls+1&&lastEndpoint==25&&lastMutation&&lastForm=="style=3");
 assert(send(commit(5),8)==2&&calls==styleCalls+1);
 assert(send(begin(6,25,Read),8)==2);
 updating=true;assert(send(begin(6,25,Mutation,7),8)==3&&calls==styleCalls+1);updating=false;
 // A read is evaluated once. Repeated/out-of-order Page frames only copy
 // the immutable cached response, bounded by the actual page capacity.
 const auto readCalls=calls;
 stateBytes=MaxResponse;
 assert(send(begin(6,1,Read),8)==0&&send(commit(6),8)==0&&calls==readCalls+1);
 assert(u16(out+6)==MaxResponse&&outSize==MaxPage);
 assert(send(page(6,7680),8)==0&&u16(out+8)==7680&&outSize==MaxPage);
 assert(send(page(6,0),8)==0&&u16(out+8)==0&&calls==readCalls+1);
 std::string full;
 for(uint16_t offset=0;offset<MaxResponse;offset+=PageBytes){
  assert(send(page(6,offset),8)==0&&outSize<=MaxPage&&u16(out+10)<=PageBytes);
  full+=payload();assert(calls==readCalls+1);
 }
 assert(full==std::string(MaxResponse,'s'));
 assert(send(page(6,MaxResponse),8)==0&&outSize==Header&&calls==readCalls+1);
 assert(send(page(6,MaxResponse+1),8)==2&&calls==readCalls+1);
 // Read contracts cannot carry a form, or escape the shared endpoint table.
 assert(send(begin(7,1,Read,1),8)==2&&calls==readCalls+1);
 assert(send(begin(7,7,Read),8)==2&&calls==readCalls+1);
 // Failure before dispatch consumes this transfer, but never calls a setter
 // or read handler; retrying Commit cannot execute anything.
 assert(send(begin(7,1,Read),8)==0);failNextReserve=true;
 assert(send(commit(7),8)==0&&calls==readCalls+1&&u16(out+1)==7&&u16(out+4)==503);
 assert(payload()=="Read resources unavailable. Nothing changed.");
 assert(send(commit(7),8)==2&&calls==readCalls+1);
 // An oversized reply becomes an honest bounded failure and stays cached.
 stateBytes=MaxResponse+1;
 const auto wipesBefore=wipedBufferReleases;
 const auto bytesBefore=wipedBytes;
 assert(send(begin(8,1,Read),8)==0&&send(commit(8),8)==0&&calls==readCalls+2);
 assert(u16(out+4)==507&&outSize<=MaxPage);
 assert(payload().find("exceeds the bounded Bluetooth transfer")!=std::string::npos);
 assert(wipedBufferReleases>=wipesBefore+1&&wipedBytes>=bytesBefore+MaxResponse+1);
 assert(send(page(8),8)==0&&u16(out+4)==507&&calls==readCalls+2);
 assert(send(commit(8),8)==2&&calls==readCalls+2);
 // The updater's sole allowed status read cannot retain a large snapshot.
 updating=true;firmwareBytes=PageBytes+1;
 assert(send(begin(9,18,Read),8)==0&&send(commit(9),8)==0&&u16(out+4)==507);
 assert(calls==readCalls+3&&outSize<=MaxPage);updating=false;
 // Timeout subtraction is rollover-safe, and generation change fences every
 // prior page/Commit even when a new phone reuses its transaction number.
 resetLampBleControlTransfer(9);stateBytes=1;clockMs=UINT32_MAX-100;
 assert(send(begin(1,1,Read),9)==0&&send(commit(1),9)==0&&payload()=="s");
 const auto finalCalls=calls;
 clockMs+=Timeout-1;assert(!serviceLampBleControlTransfer(9,true,false));
 clockMs+=1;assert(serviceLampBleControlTransfer(9,true,false));
 assert(send(page(1),9)==2&&send(commit(1),9)==2&&calls==finalCalls);
 assert(send(begin(2,1,Read),9)==0&&send(commit(2),9)==0);
 assert(serviceLampBleControlTransfer(10,true,false));
 assert(send(page(2),10)==2&&send(commit(2),10)==2&&calls==finalCalls+1);
 assert(send(begin(1,1,Read),10)==0&&send(commit(1),10)==0&&calls==finalCalls+2);
 assert(wipedBufferReleases>0&&wipedBytes>MaxResponse);
 // Full responses adopt the handler's allocation. Force every legacy wire
 // malloc to fail: this commit must still succeed and keep the exact view.
 resetLampBleControlTransfer(11);stateBytes=5424;rejectWireMalloc=true;
 const auto beforeOwnedCalls=calls;const auto beforeMalloc=wireMallocAttempts;
 assert(send(begin(1,1,Read),11)==0&&send(commit(1),11)==0&&calls==beforeOwnedCalls+1);
 assert(retainedResponse.c_str()==lastHandlerBody&&wireMallocAttempts==beforeMalloc);
 assert(u16(out+6)==5424&&outSize==MaxPage);
 stateBytes=1;assert(send(page(1,480),11)==0&&payload()==std::string(PageBytes,'s'));
 assert(send(commit(1),11)==2&&calls==beforeOwnedCalls+1);
 const auto retainedWipes=wipedBufferReleases;const auto retainedBytes=wipedBytes;
 resetLampBleControlTransfer(12);
 assert(wipedBufferReleases==retainedWipes+1&&wipedBytes==retainedBytes+5424&&retainedResponse.empty());
 // Simulate simultaneous HTTP/TCP response ownership reducing available heap.
 // A denial is retained as503; no handler is called and Commit never replays.
 fakeFreeHeap=LampControlResourcePolicy::MinFreeHeapBytes-1;fakeLargestBlock=24000;
 assert(send(begin(1,7,Mutation),12)==0&&send(commit(1),12)==0&&u16(out+4)==503);
 assert(payload()=="Control resources unavailable. No command executed."&&calls==beforeOwnedCalls+1);
 assert(send(page(1),12)==0&&u16(out+4)==503&&send(commit(1),12)==2&&calls==beforeOwnedCalls+1);
 // The former 16 KiB budget is explicitly denied under the shared24 KiB
 // policy. Releasing memory never executes any consumed Commit implicitly.
 fakeFreeHeap=16384;
 assert(send(begin(2,7,Mutation),12)==0&&send(commit(2),12)==0&&u16(out+4)==503&&calls==beforeOwnedCalls+1);
 fakeFreeHeap=LampControlResourcePolicy::MinFreeHeapBytes;
 assert(send(page(2),12)==0&&u16(out+4)==503&&send(commit(2),12)==2&&calls==beforeOwnedCalls+1);
 fakeFreeHeap=50000;fakeLargestBlock=15;
 assert(send(begin(3,1,Read),12)==0&&send(commit(3),12)==0&&u16(out+4)==503&&calls==beforeOwnedCalls+1);
 // Once other owners release memory, a fresh transaction can run exactly once.
 fakeFreeHeap=LampControlResourcePolicy::MinFreeHeapBytes;fakeLargestBlock=6160;stateBytes=2000;
 assert(send(begin(4,1,Read),12)==0&&send(commit(4),12)==0&&calls==beforeOwnedCalls+2);
 assert(u16(out+4)==200&&u16(out+6)==2000&&send(commit(4),12)==2);
 // A failed tiny denial allocation clears the consumed transaction. Honest
 // code4/metadata has no execution receipt; an old Commit still cannot replay.
 fakeFreeHeap=100;failNextText=true;
 assert(send(begin(5,7,Mutation),12)==0&&send(commit(5),12)==4&&calls==beforeOwnedCalls+2&&u16(out+1)==0);
 assert(send(commit(5),12)==2&&calls==beforeOwnedCalls+2);
 fakeFreeHeap=50000;fakeLargestBlock=24000;
 // A small successful mutation reply may fail its bounded owned copy after
 // execution. Return code4 and never execute again when that reply is lost.
 assert(send(begin(6,7,Mutation),12)==0);failNextOwnedCopy=true;
 assert(send(commit(6),12)==4&&calls==beforeOwnedCalls+3&&u16(out+1)==0);
 assert(send(commit(6),12)==2&&calls==beforeOwnedCalls+3);
 // Error-text allocation failure after a large/oversized read is also terminal.
 stateBytes=MaxResponse+1;assert(send(begin(7,1,Read),12)==0);failNextText=true;
 assert(send(commit(7),12)==4&&calls==beforeOwnedCalls+4);
 assert(send(commit(7),12)==2&&calls==beforeOwnedCalls+4);
 assert(wireMallocAttempts==beforeMalloc);
 // The compatibility copier still reports its own allocation failure, wipes
 // its request and fences consumed Commit even when no response was allocated.
 Transfer legacy;
 auto oldBegin=begin(1,1,Read);auto oldCommit=commit(1);
 assert(legacy.begin(oldBegin.data(),oldBegin.size(),1,clockMs));
 assert(legacy.consume(oldCommit.data(),oldCommit.size(),1,clockMs));
 const uint8_t oldBytes[]={'p','w','d'};
 assert(!legacy.finish(200,oldBytes,sizeof(oldBytes))&&wireMallocAttempts==beforeMalloc+1);
 for(size_t i=0;i<MaxRequest+1;++i)assert(legacy.body()[i]==0);
 assert(!legacy.consume(oldCommit.data(),oldCommit.size(),1,clockMs));
 // Safe status reads have independent admission; mutations retain the24KiB
 // execution floor. Each read still evaluates once and pages an immutable
 // private reply. Endpoint/form classification never broadens that exception.
 resetLampBleControlTransfer(13);stateBytes=2000;fakeFreeHeap=16316;fakeLargestBlock=7668;
 const auto lowMemoryCalls=calls;
 assert(send(begin(1,LampControlEndpoint::State,Read),13)==0&&send(commit(1),13)==0);
 assert(u16(out+4)==200&&u16(out+6)==2000&&calls==lowMemoryCalls+1);
 assert(send(page(1,480),13)==0&&payload()==std::string(PageBytes,'s')&&calls==lowMemoryCalls+1);
 assert(send(commit(1),13)==2&&calls==lowMemoryCalls+1);
 assert(send(begin(2,LampControlEndpoint::Config,Mutation),13)==0&&send(commit(2),13)==0);
 assert(u16(out+4)==503&&calls==lowMemoryCalls+1&&send(commit(2),13)==2);
 uint16_t sequence=3;
 for(uint8_t endpoint:{uint8_t(LampControlEndpoint::Sync),uint8_t(LampControlEndpoint::Effects),uint8_t(LampControlEndpoint::Descriptor),uint8_t(LampControlEndpoint::Revision),uint8_t(LampControlEndpoint::Firmware)}){
  assert(send(begin(sequence,endpoint,Read),13)==0&&send(commit(sequence),13)==0);
  assert(u16(out+4)==200&&send(commit(sequence),13)==2);
  ++sequence;
 }
 const auto permittedCalls=calls;
 assert(send(begin(100,LampControlEndpoint::Bluetooth,Read),13)==0&&send(commit(100),13)==0&&u16(out+4)==503&&calls==permittedCalls);
 fakeFreeHeap=8703;
 assert(send(begin(101,LampControlEndpoint::State,Read),13)==0&&send(commit(101),13)==0&&u16(out+4)==503&&calls==permittedCalls);
 fakeFreeHeap=50000;fakeLargestBlock=24000;
 assert(send(page(101),13)==0&&u16(out+4)==503&&send(commit(101),13)==2&&calls==permittedCalls);
 resetLampBleControlTransfer(14);
 // A semantic read POST may carry the full1024-byte bounded form. BLE must
 // budget its owned copy and decoded fields before any handler is evaluated.
 resetLampBleControlTransfer(15);const std::string maximumForm(1024,'x');
 const auto formCalls=calls;uint16_t formSequence=1;
 const auto submitForm=[&](uint16_t tx){
  assert(send(begin(tx,LampControlEndpoint::SchemaPage,Mutation,maximumForm.size()),15)==0);
  for(size_t offset=0;offset<maximumForm.size();offset+=13){
   std::vector<uint8_t> frame{1,2,Chunk,uint8_t(tx),uint8_t(tx>>8),uint8_t(offset),uint8_t(offset>>8)};
   frame.insert(frame.end(),maximumForm.begin()+offset,maximumForm.begin()+std::min(offset+13,maximumForm.size()));assert(send(frame,15)==0);
  }
  assert(send(commit(tx),15)==0);
 };
 for(const auto budget:{std::pair<uint32_t,uint32_t>{10752,2048},{13599,2048},{50000,1039}}){
  fakeFreeHeap=budget.first;fakeLargestBlock=budget.second;submitForm(formSequence);
  assert(u16(out+4)==503&&calls==formCalls&&send(commit(formSequence++),15)==2);
 }
 fakeFreeHeap=13600;fakeLargestBlock=1040;submitForm(formSequence);
 assert(u16(out+4)==200&&calls==formCalls+1&&lastForm==maximumForm&&send(commit(formSequence),15)==2);
 resetLampBleControlTransfer(16);
 // Known read admission failure must explain itself with no String or wire
 // allocation at all, even when every allocator fault is armed. Only this
 // exact read classification receives the immutable resource-refusal owner.
 constexpr const char* refused="Read resources unavailable. Nothing changed.";
 const auto refusalCalls=calls;
 fakeFreeHeap=0;fakeLargestBlock=0;failNextText=true;failNextReserve=true;
 const auto beforeStaticText=textConstructionAttempts,beforeStaticReserve=reserveAttempts;
 const auto beforeStaticMalloc=wireMallocAttempts;
 assert(send(begin(1,LampControlEndpoint::State,Read),16)==0&&send(commit(1),16)==0);
 assert(u16(out+1)==1&&out[3]==LampControlEndpoint::State&&u16(out+4)==503&&payload()==refused);
 assert(calls==refusalCalls&&textConstructionAttempts==beforeStaticText&&reserveAttempts==beforeStaticReserve&&wireMallocAttempts==beforeStaticMalloc);
 assert(failNextText&&failNextReserve&&retainedResponse.empty());
 for(uint16_t offset:{uint16_t(0),uint16_t(7),uint16_t(sizeof("Read resources unavailable. Nothing changed.")-1),uint16_t(0)}){
  assert(send(page(1,offset),16)==0&&u16(out+8)==offset&&u16(out+4)==503&&outSize<=MaxPage);
  assert(payload()==std::string(refused).substr(offset));
 }
 assert(send(commit(1),16)==2&&calls==refusalCalls);
 assert(send(begin(1,0,0),16)==0&&u16(out+1)==0);
 assert(send(page(1),16)==2&&send(commit(1),16)==2&&calls==refusalCalls);
 assert(std::strcmp(readRefusal,refused)==0); // cleanup must never wipe flash bytes
 failNextText=failNextReserve=false;fakeFreeHeap=50000;fakeLargestBlock=24000;
 // The form-reservation failure is a pre-dispatch read refusal. It consumes
 // the transaction once, but does not call a handler or fake a saved setting.
 assert(send(begin(2,LampControlEndpoint::State,Read),16)==0);failNextReserve=true;
 assert(send(commit(2),16)==0&&u16(out+4)==503&&payload()==refused&&calls==refusalCalls);
 assert(send(commit(2),16)==2&&calls==refusalCalls);
 // Successful read retention failures use the same cached503. A handler was
 // evaluated once; paging and repeated Commit never evaluate it again.
 for(const auto bytes:{1u,32u}){
  stateBytes=bytes;const auto tx=uint16_t(bytes==1?3:4);const auto evaluations=calls;
  assert(send(begin(tx,LampControlEndpoint::State,Read),16)==0);failNextReadRetain=true;
  assert(send(commit(tx),16)==0&&!failNextReadRetain&&u16(out+4)==503&&payload()==refused&&calls==evaluations+1);
  assert(send(page(tx),16)==0&&payload()==refused&&send(commit(tx),16)==2&&calls==evaluations+1);
 }
 // A known503 with an empty body can result from error-text allocation
 // failure. Preserve503; don't classify empty success or other errors as it.
 stateBytes=0;handlerStatus=503;
 assert(send(begin(5,LampControlEndpoint::State,Read),16)==0&&send(commit(5),16)==0&&u16(out+4)==503&&payload()==refused);
 assert(send(page(5),16)==0&&send(commit(5),16)==2);
 handlerStatus=200;
 assert(send(begin(6,LampControlEndpoint::State,Read),16)==0&&send(commit(6),16)==0&&u16(out+4)==200&&outSize==Header);
 handlerStatus=404;
 assert(send(begin(7,LampControlEndpoint::State,Read),16)==0&&send(commit(7),16)==0&&u16(out+4)==404&&outSize==Header);
 stateBytes=32;
 assert(send(begin(8,LampControlEndpoint::State,Read),16)==0&&send(commit(8),16)==0&&u16(out+4)==404&&payload()==std::string(32,'s'));
 assert(send(begin(9,LampControlEndpoint::State,Read),16)==0);failNextReadRetain=true;
 assert(send(commit(9),16)==4&&!failNextReadRetain&&u16(out+1)==0);
 assert(send(commit(9),16)==2);handlerStatus=200;
 // A failed mutation form allocation and failed post-execution reply retain
 // legacy ACK4; there is no cached503 claiming a setter never ran.
 const auto mutationCalls=calls;
 assert(send(begin(10,LampControlEndpoint::Config,Mutation),16)==0);failNextReserve=true;
 assert(send(commit(10),16)==4&&u16(out+1)==0&&calls==mutationCalls&&send(commit(10),16)==2);
 assert(send(begin(11,LampControlEndpoint::Config,Mutation),16)==0);failNextOwnedCopy=true;
 assert(send(commit(11),16)==4&&u16(out+1)==0&&calls==mutationCalls+1&&send(commit(11),16)==2);
 // A static read owner uses the same rollover-safe timeout and authorization,
 // generation and update cleanup. No logical reply outlives its session.
 uint16_t refusalTx=12;
 for(const auto cleanup:{0,1,2,3}){
  fakeFreeHeap=0;assert(send(begin(refusalTx,LampControlEndpoint::State,Read),16)==0&&send(commit(refusalTx),16)==0&&payload()==refused);
  if(cleanup==0){clockMs=UINT32_MAX-10;resetLampBleControlTransfer(16);assert(send(begin(++refusalTx,LampControlEndpoint::State,Read),16)==0&&send(commit(refusalTx),16)==0);clockMs+=Timeout;assert(serviceLampBleControlTransfer(16,true,false));}
  if(cleanup==1)assert(serviceLampBleControlTransfer(16,false,false));
  if(cleanup==2){assert(serviceLampBleControlTransfer(17,true,false));resetLampBleControlTransfer(16);}
  if(cleanup==3)assert(serviceLampBleControlTransfer(16,true,true));
  assert(send(page(refusalTx),16)==2&&send(commit(refusalTx),16)==2&&std::strcmp(readRefusal,refused)==0);
  ++refusalTx;
 }
 assert(wireMallocAttempts==beforeStaticMalloc);
 resetLampBleControlTransfer(18);
 // A GET that is not on the resource policy's read allowlist keeps legacy
 // error handling, even though its wire method is Read.
 const auto unpermittedCalls=calls;failNextText=true;
 assert(send(begin(1,LampControlEndpoint::Bluetooth,Read),18)==0&&send(commit(1),18)==4&&u16(out+1)==0);
 assert(!failNextText&&calls==unpermittedCalls&&send(commit(1),18)==2);
 fakeFreeHeap=50000;fakeLargestBlock=24000;
 // A whitelisted read POST can fail halfway through copying its form. The
 // partial String and wire staging bytes are wiped before static503 paging.
 const std::string readForm="offset=0&kind=effects&count=1";
 assert(send(begin(2,LampControlEndpoint::SchemaPage,Mutation,readForm.size()),18)==0);
 for(size_t offset=0;offset<readForm.size();offset+=13){
  std::vector<uint8_t> frame{1,2,Chunk,2,0,uint8_t(offset),uint8_t(offset>>8)};
  frame.insert(frame.end(),readForm.begin()+offset,readForm.begin()+std::min(offset+13,readForm.size()));assert(send(frame,18)==0);
 }
 const auto copiedFormWipes=wipedBytes;failNextConcat=true;
 assert(send(commit(2),18)==0&&!failNextConcat&&u16(out+4)==503&&payload()==refused&&calls==unpermittedCalls);
 assert(wipedBytes>=copiedFormWipes+readForm.size()/2);
 for(size_t i=0;i<MaxRequest+1;++i)assert(transfer.body()[i]==0);
 assert(send(page(2),18)==0&&send(commit(2),18)==2&&calls==unpermittedCalls);
 resetLampBleControlTransfer(19);
 resetLampBleControlTransfer(19);fakeFreeHeap=16316;fakeLargestBlock=2048;
 const auto compactCalls=calls;const std::string compactForm="brightness=90";
 const auto compactSubmit=[&](uint16_t tx,uint8_t endpoint,const std::string& form){
  assert(send(begin(tx,endpoint,Mutation,form.size()),19)==0);
  for(size_t offset=0;offset<form.size();offset+=13){
   std::vector<uint8_t> frame{1,2,Chunk,uint8_t(tx),uint8_t(tx>>8),uint8_t(offset),uint8_t(offset>>8)};
   frame.insert(frame.end(),form.begin()+offset,form.begin()+std::min(offset+13,form.size()));assert(send(frame,19)==0);
  }
  assert(send(commit(tx),19)==0);
 };
 compactSubmit(1,LampControlEndpoint::StatePatch,compactForm);assert(u16(out+4)==200&&calls==compactCalls+1&&lastEndpoint==42&&lastForm==compactForm&&send(commit(1),19)==2);
 const auto compactFloor=LampControlResourcePolicy::ReadDispatchHeapBytes+LampControlResourcePolicy::roundedReplyBytes(512)+2*LampControlResourcePolicy::roundedReplyBytes(compactForm.size())+24*32;
 fakeFreeHeap=compactFloor-1;compactSubmit(2,LampControlEndpoint::StatePatch,compactForm);assert(u16(out+4)==503&&payload()=="Control resources unavailable. No command executed."&&calls==compactCalls+1);
 fakeFreeHeap=compactFloor;assert(send(page(2),19)==0&&u16(out+4)==503&&send(commit(2),19)==2&&calls==compactCalls+1);
 compactSubmit(3,LampControlEndpoint::StatePatch,compactForm);assert(u16(out+4)==200&&calls==compactCalls+2);
 fakeLargestBlock=527;compactSubmit(4,LampControlEndpoint::StatePatch,compactForm);assert(u16(out+4)==503&&calls==compactCalls+2);
 fakeFreeHeap=16316;fakeLargestBlock=2048;
 assert(send(begin(5,LampControlEndpoint::AppearanceSave,Mutation),19)==0&&send(commit(5),19)==0&&u16(out+4)==503&&calls==compactCalls+2);
 // The physical Sonata profile sits below the general mutation floor, but a
 // scene write has a fixed 432-byte record and an explicitly reserved NVS
 // workspace. It is admitted over Bluetooth without weakening other writes.
 const std::string sceneForm="scene=0&speed=50&intensity=85&r=70&g=220&b=255&r2=255&g2=65&b2=170";
 fakeFreeHeap=23388;fakeLargestBlock=9204;
 compactSubmit(6,LampControlEndpoint::Scene,sceneForm);assert(u16(out+4)==200&&calls==compactCalls+3&&lastEndpoint==LampControlEndpoint::Scene&&lastForm==sceneForm);
 fakeLargestBlock=LampControlResourcePolicy::CompactScenePersistenceBytes-1;
 compactSubmit(7,LampControlEndpoint::Scene,sceneForm);assert(u16(out+4)==503&&calls==compactCalls+3);
 // An updater still rejects this ordinary mutation before admission. A new
 // compact budget never overrides update ownership or replays old Commit.
 updating=true;assert(send(begin(8,LampControlEndpoint::StatePatch,Mutation),19)==3&&calls==compactCalls+3);updating=false;
 resetLampBleControlTransfer(20);fakeFreeHeap=16316;fakeLargestBlock=2048;
 const auto currentCalls=calls;const std::string currentForm="view=current";
 outSize=lampBleControlMetadata(out,sizeof(out));assert(payload().find("current-state-v1")!=std::string::npos);
 assert(send(begin(1,LampControlEndpoint::State,Read,currentForm.size()),20)==0);
 std::vector<uint8_t> currentFrame{1,2,Chunk,1,0,0,0};currentFrame.insert(currentFrame.end(),currentForm.begin(),currentForm.end());assert(send(currentFrame,20)==0);
 assert(send(commit(1),20)==0&&u16(out+4)==200&&calls==currentCalls+1&&!lastMutation&&lastForm==currentForm);
 assert(send(commit(1),20)==2&&calls==currentCalls+1);
 for(uint16_t bytes:{uint16_t(1),uint16_t(11),uint16_t(13),uint16_t(1024)})assert(send(begin(2,LampControlEndpoint::State,Read,bytes),20)==2&&calls==currentCalls+1);
 assert(send(begin(2,LampControlEndpoint::Firmware,Read,currentForm.size()),20)==2&&calls==currentCalls+1);
 assert(send(begin(2,LampControlEndpoint::State,Read),20)==0&&send(commit(2),20)==0&&calls==currentCalls+2&&lastForm.empty());
  std::cout<<"PASS: loop-only endpoint adapter, exact forms and private replies, one GET evaluation with immutable480-byte paging, move-owned5424-byte response with zero wire allocations, separate safe-read/compact-patch-and-scene/legacy-mutation admission, allocation-free immutable503 read refusals, unchanged persistent mutation/error outcomes, wiped owner release, no Commit replay, generation/rollover/expiry/update cleanup\n";
}
'''
        with tempfile.TemporaryDirectory(prefix='lamp-ble-control-') as directory:
            directory = pathlib.Path(directory)
            (directory/'Arduino.h').write_text(arduino)
            cpp, binary = directory/'test.cpp', directory/'test'
            cpp.write_text(fixture)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-I'+str(directory), '-I'+str(ROOT),
                            *SANITIZERS, str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
