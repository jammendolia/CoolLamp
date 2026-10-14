#include "BridgeDisplay.h"
#include <Arduino.h>
#include <cstring>

namespace {
// Heltec HTIT-WB32 V3 schematic/pin map, corroborated by Arduino-ESP32
// 3.3.11 variants/heltec_wifi_kit_32_V3/pins_arduino.h. Vext is active low.
constexpr uint8_t OledAddress=0x3c,Sda=17,Scl=18,Reset=21,VextControl=36;
constexpr uint32_t FrameInterval=1000;
struct Glyph {char character;uint8_t columns[5];};
// Small, fixed 5x7 glyphs; lowercase is rendered as uppercase. Unsupported
// characters use a question mark, without allocating a font workspace.
constexpr Glyph glyphs[]={
 {' ',{0,0,0,0,0}}, {'!',{0,0,0x5f,0,0}},
 {'%',{0x63,0x13,0x08,0x64,0x63}}, {'(',{0,0x1c,0x22,0x41,0}},
 {')',{0,0x41,0x22,0x1c,0}}, {'+',{0x08,0x08,0x3e,0x08,0x08}},
 {',',{0,0x50,0x30,0,0}}, {'-',{0x08,0x08,0x08,0x08,0x08}},
 {'.',{0,0x60,0x60,0,0}}, {'/',{0x20,0x10,0x08,0x04,0x02}},
 {'0',{0x3e,0x51,0x49,0x45,0x3e}}, {'1',{0,0x42,0x7f,0x40,0}},
 {'2',{0x42,0x61,0x51,0x49,0x46}}, {'3',{0x21,0x41,0x45,0x4b,0x31}},
 {'4',{0x18,0x14,0x12,0x7f,0x10}}, {'5',{0x27,0x45,0x45,0x45,0x39}},
 {'6',{0x3c,0x4a,0x49,0x49,0x30}}, {'7',{0x01,0x71,0x09,0x05,0x03}},
 {'8',{0x36,0x49,0x49,0x49,0x36}}, {'9',{0x06,0x49,0x49,0x29,0x1e}},
 {':',{0,0x36,0x36,0,0}}, {'=',{0x14,0x14,0x14,0x14,0x14}},
 {'?',{0x02,0x01,0x51,0x09,0x06}},
 {'A',{0x7e,0x11,0x11,0x11,0x7e}}, {'B',{0x7f,0x49,0x49,0x49,0x36}},
 {'C',{0x3e,0x41,0x41,0x41,0x22}}, {'D',{0x7f,0x41,0x41,0x22,0x1c}},
 {'E',{0x7f,0x49,0x49,0x49,0x41}}, {'F',{0x7f,0x09,0x09,0x09,0x01}},
 {'G',{0x3e,0x41,0x49,0x49,0x7a}}, {'H',{0x7f,0x08,0x08,0x08,0x7f}},
 {'I',{0,0x41,0x7f,0x41,0}}, {'J',{0x20,0x40,0x41,0x3f,0x01}},
 {'K',{0x7f,0x08,0x14,0x22,0x41}}, {'L',{0x7f,0x40,0x40,0x40,0x40}},
 {'M',{0x7f,0x02,0x0c,0x02,0x7f}}, {'N',{0x7f,0x04,0x08,0x10,0x7f}},
 {'O',{0x3e,0x41,0x41,0x41,0x3e}}, {'P',{0x7f,0x09,0x09,0x09,0x06}},
 {'Q',{0x3e,0x41,0x51,0x21,0x5e}}, {'R',{0x7f,0x09,0x19,0x29,0x46}},
 {'S',{0x46,0x49,0x49,0x49,0x31}}, {'T',{0x01,0x01,0x7f,0x01,0x01}},
 {'U',{0x3f,0x40,0x40,0x40,0x3f}}, {'V',{0x1f,0x20,0x40,0x20,0x1f}},
 {'W',{0x3f,0x40,0x38,0x40,0x3f}}, {'X',{0x63,0x14,0x08,0x14,0x63}},
 {'Y',{0x07,0x08,0x70,0x08,0x07}}, {'Z',{0x61,0x51,0x49,0x45,0x43}},
 {'[',{0,0x7f,0x41,0x41,0}}, {']',{0,0x41,0x41,0x7f,0}},
 {'_',{0x40,0x40,0x40,0x40,0x40}}
};
const uint8_t* glyph(char character){
  if(character>='a'&&character<='z')character=char(character-'a'+'A');
  for(const auto& item:glyphs)if(item.character==character)return item.columns;
  for(const auto& item:glyphs)if(item.character=='?')return item.columns;
  return glyphs[0].columns;
}
void copyLine(char* out,const char* in){
  memset(out,0,BridgeDisplayStatus::TextCapacity);
  for(unsigned i=0;i<BridgeDisplayStatus::TextCapacity-1&&in[i];++i)
    out[i]=uint8_t(in[i])>=32&&uint8_t(in[i])<127?in[i]:'?';
}
}

bool BridgeDisplay::commands(const uint8_t* bytes,unsigned length){
  wire_.beginTransmission(OledAddress);
  const bool control=wire_.write(uint8_t(0))==1;
  const bool body=wire_.write(bytes,length)==length;
  const bool sent=wire_.endTransmission()==0;
  return control&&body&&sent;
}
bool BridgeDisplay::begin(){
  available_=false;
  digitalWrite(VextControl,LOW);pinMode(VextControl,OUTPUT);
  digitalWrite(Reset,HIGH);pinMode(Reset,OUTPUT);delay(10);
  digitalWrite(Reset,LOW);delay(10);digitalWrite(Reset,HIGH);delay(20);
  // Each data transaction has 64 bytes plus a control byte, fitting the core's
  // default 128-byte Wire buffer. A failed/missing panel costs at most 5 ms.
  wire_.setTimeOut(5);
  if(!wire_.begin(Sda,Scl,400000))return false;
  const uint8_t init[]={0xae,0xd5,0x80,0xa8,0x3f,0xd3,0,0x40,0x8d,0x14,
    0x20,0x02,0xa1,0xc8,0xda,0x12,0x81,0x7f,0xd9,0xf1,0xdb,0x40,0xa4,0xa6,0xaf};
  if(!commands(init,sizeof(init)))return false;
  available_=true;dirty_=true;page_=8;nextFrameAt_=0;return true;
}
void BridgeDisplay::show(const BridgeDisplayStatus& status){
  BridgeDisplayStatus normalized;
  copyLine(normalized.title,status.title);copyLine(normalized.line1,status.line1);
  copyLine(normalized.line2,status.line2);copyLine(normalized.line3,status.line3);copyLine(normalized.line4,status.line4);
  normalized.progressPercent=status.progressPercent<0?-1:(status.progressPercent>100?100:status.progressPercent);
  normalized.activity=status.activity;
  if(strcmp(normalized.title,pending_.title)||strcmp(normalized.line1,pending_.line1)||
     strcmp(normalized.line2,pending_.line2)||strcmp(normalized.line3,pending_.line3)||
     strcmp(normalized.line4,pending_.line4)||normalized.progressPercent!=pending_.progressPercent||
     normalized.activity!=pending_.activity){pending_=normalized;dirty_=true;}
}
void BridgeDisplay::pixel(unsigned x,unsigned y){if(x<128&&y<64)frame_[(y/8)*128+x]|=uint8_t(1U<<(y%8));}
void BridgeDisplay::text(unsigned x,unsigned y,const char* value,unsigned maximum){
  for(unsigned i=0;i<maximum&&value[i]&&x+5<=128;++i,x+=6){
    const auto* columns=glyph(value[i]);
    for(unsigned column=0;column<5;++column)for(unsigned row=0;row<7;++row)
      if(columns[column]&(1U<<row))pixel(x+column,y+row);
  }
}
void BridgeDisplay::render(){
  memset(frame_,0,sizeof(frame_));
  text(0,0,pending_.title,20);for(unsigned x=0;x<128;++x)pixel(x,9);
  text(0,13,pending_.line1,21);text(0,23,pending_.line2,21);
  text(0,33,pending_.line3,21);text(0,43,pending_.line4,21);
  if(pending_.activity)for(unsigned y=1;y<5;++y)for(unsigned x=123;x<127;++x)pixel(x,y);
  if(pending_.progressPercent>=0){
    for(unsigned x=0;x<128;++x){pixel(x,55);pixel(x,62);}
    for(unsigned y=55;y<63;++y){pixel(0,y);pixel(127,y);}
    const unsigned filled=unsigned(pending_.progressPercent)*124/100;
    for(unsigned x=2;x<2+filled;++x)for(unsigned y=57;y<61;++y)pixel(x,y);
  }
}
bool BridgeDisplay::sendPage(unsigned page){
  const uint8_t position[]={uint8_t(0xb0|page),0x00,0x10};
  if(!commands(position,sizeof(position)))return false;
  for(unsigned offset=0;offset<128;offset+=64){
    wire_.beginTransmission(OledAddress);
    const bool control=wire_.write(uint8_t(0x40))==1;
    const bool body=wire_.write(frame_+page*128+offset,64)==64;
    const bool sent=wire_.endTransmission()==0;
    if(!control||!body||!sent)return false;
  }
  return true;
}
void BridgeDisplay::loop(uint32_t nowMs){
  if(!available_)return;
  if(page_>=8){
    if(!dirty_||int32_t(nowMs-nextFrameAt_)<0)return;
    render();dirty_=false;page_=0;nextFrameAt_=nowMs+FrameInterval;
  }
  // One page per call: roughly 3 ms at 400 kHz. The existing bridge loop gets
  // control between every page and changes coalesce into the next snapshot.
  if(!sendPage(page_++))available_=false;
}
