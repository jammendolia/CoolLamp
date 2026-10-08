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
struct String:std::string {
 using std::string::string;using std::string::operator=;
 String(const std::string& s):std::string(s){}
 bool reserve(size_t n){std::string::reserve(n);return true;}
 bool concat(const char* p,size_t n){append(p,n);return true;}
};
uint32_t millis();
'''
        fixture = r'''
#include <cassert>
#include <vector>
#include <iostream>
#include "LampBleControl.h"
#include "LampControlEndpoint.h"
uint32_t clockMs=100;uint32_t millis(){return clockMs;}
bool updating=false;bool lampUpdateOwnsResources(){return updating;}
unsigned calls=0;uint8_t lastEndpoint=0;bool lastMutation=false;String lastForm;
String lampControlSnapshotJson(){return "{}";}
LampControlReply lampControlRequest(uint8_t endpoint,bool mutation,const String& form){
 ++calls;lastEndpoint=endpoint;lastMutation=mutation;lastForm=form;
 LampControlReply reply;reply.status=200;
 if(endpoint==3)reply.body="CL1-aabbccddeeff-0123456789abcdef0123456789abcdef";
 else if(endpoint==1)reply.body=std::string(2049,'s');
 else if(endpoint==18)reply.body="{\"version\":\"1.10.0\",\"phase\":0}";
 else reply.body="Saved";
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
 std::cout<<"PASS: loop-only endpoint adapter, exact forms and private replies, acknowledged paging, no commit replay, disconnect/expiry/update cleanup\n";
}
'''
        with tempfile.TemporaryDirectory(prefix='lamp-ble-control-') as directory:
            directory = pathlib.Path(directory)
            (directory/'Arduino.h').write_text(arduino)
            cpp, binary = directory/'test.cpp', directory/'test'
            cpp.write_text(fixture)
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-I'+str(directory), '-I'+str(ROOT),
                            *SANITIZERS, str(ROOT/'LampBleControl.cpp'), str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
