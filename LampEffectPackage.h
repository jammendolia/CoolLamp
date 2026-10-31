#pragma once
#include <stddef.h>
#include <stdint.h>
#include "LampEffectFrame.h"

// Local prototype only: CRC detects accidental corruption, not an authentic
// publisher. No installer, signature policy, persistence or network access.
namespace LampEffectPackage {
constexpr uint8_t Version=1, HeaderBytes=32, InstructionBytes=12;
constexpr uint16_t MaxInstructions=128, MaxPackageBytes=32768;
constexpr uint8_t MaxScalars=32, MaxColors=8, MaxDraws=18;
enum Capability:uint16_t {Strip=1,EdisonRegions=2,AudioFeatures=4};
enum class Error:uint8_t {None,Truncated,Magic,Version,Length,Checksum,Limits,Unsupported,Geometry,Instruction,Register,Draws};
enum class Op:uint8_t {
  Constant=1,Input,Divide,Multiply,Add,SubtractFrom,ShiftRight,Sin8,Triangle8,Clamp8,AddRegister,
  Modulo,MultiplyRegister,Minimum,MinimumRegister,Gate,
  ColorLiteral=32,Primary,Secondary,Blend8,Mix255,Scale8,Scale255,
  Fill=64,Region,Glow,RegionThreshold,RegionPulse,WrappedPair
};
enum class Input:uint8_t {Clock=0,Bass,Mid,Treble,Level};
struct RGB {uint8_t r,g,b;};
struct Audio {uint8_t bass=0,mid=0,treble=0,level=0;bool valid=false;};
struct Inputs {
  uint32_t clock=0;uint16_t count=0,midpoint=0,capabilities=Strip;
  uint8_t motionPath=0;RGB primary{255,255,255},secondary{255,255,255};Audio audio{};
};
struct Draw {RGB color;uint8_t kind;uint16_t position,width;uint8_t strength,region;};
struct Workspace {
  uint32_t scalars[MaxScalars];RGB colors[MaxColors];Draw draws[MaxDraws];
  LampEffectFrame::Context context{};uint8_t drawCount=0;bool valid=false,hasRegional=false;
};
class View;
Error validate(const uint8_t*,size_t,uint16_t,uint16_t,uint16_t,View&);
template<class Math> bool prepare(const View&,const Inputs&,Workspace&);
class View {
public:
  View()=default;
  bool valid()const{return data_!=nullptr;}
  uint16_t effectId()const{return data_?uint16_t(data_[8])|(uint16_t(data_[9])<<8):0;}
  uint16_t instructionCount()const{return count_;}
  uint16_t requirements()const{return requirements_;}
  const uint8_t* bytes()const{return data_;}
  size_t size()const{return length_;}
private:
  const uint8_t* data_=nullptr;size_t length_=0;uint16_t count_=0,requirements_=0;
  uint8_t scalars_=0,colors_=0,draws_=0;
  friend Error validate(const uint8_t*,size_t,uint16_t,uint16_t,uint16_t,View&);
  template<class Math> friend bool prepare(const View&,const Inputs&,Workspace&);
};
namespace detail {
inline uint16_t u16(const uint8_t* p){return uint16_t(p[0])|(uint16_t(p[1])<<8);}
inline uint32_t u32(const uint8_t* p){return uint32_t(u16(p))|(uint32_t(u16(p+2))<<16);}
struct Instruction {Op op;uint8_t dst,a,b;uint32_t immediate,aux;};
inline Instruction instruction(const uint8_t* p){return {Op(p[0]),p[1],p[2],p[3],u32(p+4),u32(p+8)};}
inline uint32_t crc32(const uint8_t* p,size_t size){
  uint32_t crc=~uint32_t(0);
  while(size--){crc^=*p++;for(unsigned bit=0;bit<8;++bit)crc=(crc>>1)^(0xedb88320u&uint32_t(-int32_t(crc&1)));}
  return ~crc;
}
inline uint32_t checksum(const uint8_t* p,size_t size){
  uint32_t crc=~uint32_t(0);
  for(size_t n=0;n<size;++n){crc^=n>=16&&n<20?0:p[n];for(unsigned bit=0;bit<8;++bit)crc=(crc>>1)^(0xedb88320u&uint32_t(-int32_t(crc&1)));}
  return ~crc;
}
inline Error compatible(uint16_t requirements,uint16_t capabilities,uint16_t count,uint16_t midpoint){
  if(!count||count>1024)return Error::Geometry;
  if((requirements&capabilities)!=requirements)return Error::Unsupported;
  if((requirements&EdisonRegions)&&(count!=222||midpoint!=81))return Error::Geometry;
  return Error::None;
}
inline bool initialized(uint32_t mask,uint8_t reg,uint8_t count){return reg<count&&(mask&(uint32_t(1)<<reg));}
// Regional coordinates are generic forward, reversed, folded and wrapped8
// positions within the already validated measured-region geometry.
inline bool regional(uint8_t selector){return (selector&7)>=1&&(selector&7)<=4&&(selector>>3)<=3;}
inline Error check(const Instruction& i,uint8_t scalarCount,uint8_t colorCount,uint16_t requirements,
                   uint32_t& scalars,uint32_t& colors,uint8_t& draws,uint8_t drawCap){
  const auto scalar=[&](uint8_t r){return initialized(scalars,r,scalarCount);};
  const auto color=[&](uint8_t r){return initialized(colors,r,colorCount);};
  bool scalarOutput=false,colorOutput=false;uint8_t drawCost=1;
  switch(i.op){
    case Op::Constant:scalarOutput=true;break;
    case Op::Input:
      if(i.immediate>uint8_t(Input::Level))return Error::Instruction;
      if(i.immediate&&!(requirements&AudioFeatures))return Error::Unsupported;
      scalarOutput=true;break;
    case Op::Divide:case Op::Modulo:if(!i.immediate)return Error::Instruction;[[fallthrough]];
    case Op::Multiply:case Op::Add:case Op::SubtractFrom:case Op::Sin8:case Op::Triangle8:case Op::Clamp8:case Op::Minimum:
      if(!scalar(i.a))return Error::Register;
      scalarOutput=true;break;
    case Op::ShiftRight:
      if(i.immediate>=32)return Error::Instruction;
      if(!scalar(i.a))return Error::Register;
      scalarOutput=true;break;
    case Op::AddRegister:case Op::MultiplyRegister:case Op::MinimumRegister:
      if(!scalar(i.a)||!scalar(i.b))return Error::Register;
      scalarOutput=true;break;
    case Op::Gate:
      if(i.dst||i.b||i.immediate>=i.aux)return Error::Instruction;
      if(!scalar(i.a))return Error::Register;
      return Error::None;
    case Op::ColorLiteral:if(i.immediate>0xffffff)return Error::Instruction;[[fallthrough]];
    case Op::Primary:case Op::Secondary:colorOutput=true;break;
    case Op::Blend8:
      if(i.immediate>=scalarCount||!color(i.a)||!color(i.b)||!scalar(uint8_t(i.immediate)))return Error::Register;
      colorOutput=true;break;
    case Op::Mix255:
      if(i.immediate>255)return Error::Instruction;
      if(!color(i.a)||!color(i.b))return Error::Register;
      colorOutput=true;break;
    case Op::Scale8:case Op::Scale255:
      if(!color(i.a)||!scalar(i.b))return Error::Register;
      colorOutput=true;break;
    case Op::Fill:if(!color(i.a))return Error::Register;break;
    case Op::Region:
      if(!(requirements&EdisonRegions))return Error::Unsupported;
      if(i.immediate<1||i.immediate>4)return Error::Instruction;
      if(!color(i.a))return Error::Register;
      break;
    case Op::Glow:
      if(i.dst>1||i.immediate>=scalarCount||i.aux>=scalarCount)return Error::Instruction;
      if(!color(i.a)||!scalar(i.b)||!scalar(uint8_t(i.immediate))||!scalar(uint8_t(i.aux)))return Error::Register;
      break;
    case Op::RegionThreshold:case Op::RegionPulse:
      if(!(requirements&EdisonRegions))return Error::Unsupported;
      if(!regional(i.dst))return Error::Instruction;
      if(!color(i.a)||!scalar(i.b))return Error::Register;
      if(i.op==Op::RegionThreshold){if(i.immediate||i.aux)return Error::Instruction;}
      else {
        if(!uint8_t(i.immediate)||!uint8_t(i.immediate>>8)||i.aux)return Error::Instruction;
        if(!scalar(uint8_t(i.immediate>>24)))return Error::Register;
      }
      break;
    case Op::WrappedPair:
      if(!(requirements&EdisonRegions))return Error::Unsupported;
      if(i.dst<1||i.dst>4||!uint8_t(i.immediate>>16)||(i.aux>>24))return Error::Instruction;
      if(!color(i.a)||!color(i.b)||!scalar(uint8_t(i.immediate))||!scalar(uint8_t(i.immediate>>8)))return Error::Register;
      drawCost=2;break;
    default:return Error::Instruction;
  }
  if(scalarOutput){if(i.dst>=scalarCount)return Error::Register;scalars|=uint32_t(1)<<i.dst;}
  else if(colorOutput){if(i.dst>=colorCount)return Error::Register;colors|=uint32_t(1)<<i.dst;}
  else if(draws+drawCost>drawCap)return Error::Draws;
  else draws+=drawCost;
  return Error::None;
}
inline RGB mix255(RGB a,RGB b,uint8_t amount){
  return {uint8_t((uint32_t(a.r)*(255-amount)+uint32_t(b.r)*amount)/255),
    uint8_t((uint32_t(a.g)*(255-amount)+uint32_t(b.g)*amount)/255),
    uint8_t((uint32_t(a.b)*(255-amount)+uint32_t(b.b)*amount)/255)};
}
inline RGB scale255(RGB c,uint8_t level){return {uint8_t(uint16_t(c.r)*level/255),uint8_t(uint16_t(c.g)*level/255),uint8_t(uint16_t(c.b)*level/255)};}
inline uint16_t localPosition(uint16_t index,uint8_t region,uint8_t coordinate){
  const uint16_t first=region==1?0:region==2?37:region==3?124:127;
  const uint16_t count=region==1?37:region==2?87:region==3?3:95;
  const uint16_t forward=index-first,reverse=count-1-forward;
  return coordinate==0?forward:coordinate==1?reverse:coordinate==2?(forward<reverse?forward:reverse):uint32_t(forward)*256/count;
}
inline uint8_t wrappedDistance(uint8_t position,uint8_t head){const uint8_t a=position-head,b=head-position;return a<b?a:b;}
inline uint16_t pulseWeight(uint8_t distance,uint8_t width,uint8_t gain,uint8_t base){return base+(distance<width?uint16_t(width-distance)*gain/width:0);}
inline RGB weighted255(RGB a,RGB b,uint16_t first,uint16_t second){
  const auto channel=[&](uint8_t x,uint8_t y){const uint32_t value=(uint32_t(x)*first+uint32_t(y)*second)/255;return uint8_t(value>255?255:value);};
  return {channel(a.r,b.r),channel(a.g,b.g),channel(a.b,b.b)};
}
}
__attribute__((noipa)) inline Error validate(const uint8_t* bytes,size_t size,uint16_t capabilities,uint16_t count,uint16_t midpoint,View& out){
  out=View{};
  if(!bytes||size<HeaderBytes)return Error::Truncated;
  if(bytes[0]!='C'||bytes[1]!='L'||bytes[2]!='F'||bytes[3]!='X')return Error::Magic;
  if(bytes[4]!=Version||bytes[5]!=HeaderBytes||bytes[6]!=InstructionBytes||bytes[7])return Error::Version;
  if(!detail::u16(bytes+8))return Error::Instruction;
  if(size>MaxPackageBytes||detail::u32(bytes+12)!=size)return Error::Length;
  const auto instructions=detail::u16(bytes+20),requirements=detail::u16(bytes+10);
  if(!instructions||instructions>MaxInstructions||size!=HeaderBytes+size_t(instructions)*InstructionBytes||
     !bytes[22]||bytes[22]>MaxDraws||!bytes[23]||bytes[23]>MaxScalars||!bytes[24]||bytes[24]>MaxColors)return Error::Limits;
  if((requirements&~uint16_t(Strip|EdisonRegions|AudioFeatures))||!(requirements&Strip))return Error::Unsupported;
  for(unsigned n=25;n<HeaderBytes;++n)if(bytes[n])return Error::Version;
  const auto compatibility=detail::compatible(requirements,capabilities,count,midpoint);if(compatibility!=Error::None)return compatibility;
  if(detail::checksum(bytes,size)!=detail::u32(bytes+16))return Error::Checksum;
  uint32_t scalars=0,colors=0;uint8_t draws=0;
  for(unsigned n=0;n<instructions;++n){const auto error=detail::check(detail::instruction(bytes+HeaderBytes+n*InstructionBytes),bytes[23],bytes[24],requirements,scalars,colors,draws,bytes[22]);if(error!=Error::None)return error;}
  if(!draws)return Error::Draws;
  out.data_=bytes;out.length_=size;out.count_=instructions;out.requirements_=requirements;
  out.scalars_=bytes[23];out.colors_=bytes[24];out.draws_=bytes[22];return Error::None;
}

// View borrows a pinned, immutable package buffer. CRC validation happens once;
// instruction/register checks also run during prepare, before any pixels change.
template<class Math> __attribute__((noipa)) bool prepare(const View& view,const Inputs& in,Workspace& w){
  w.valid=false;w.drawCount=0;w.hasRegional=false;
  if(!view.valid()||detail::compatible(view.requirements_,in.capabilities,in.count,in.midpoint)!=Error::None)return false;
  w.context={in.clock,in.count,in.midpoint,in.motionPath};
  uint32_t scalars=0,colors=0;uint8_t draws=0;bool enabled=true;
  for(unsigned n=0;n<view.count_;++n){
    const auto i=detail::instruction(view.data_+HeaderBytes+n*InstructionBytes);
    if(detail::check(i,view.scalars_,view.colors_,view.requirements_,scalars,colors,draws,view.draws_)!=Error::None)return false;
    // Gates never bypass static bytecode/capability/resource validation.
    if(uint8_t(i.op)>=uint8_t(Op::Fill)&&!enabled)continue;
    switch(i.op){
      case Op::Constant:w.scalars[i.dst]=i.immediate;break;
      case Op::Input:
        w.scalars[i.dst]=i.immediate==0?in.clock:!in.audio.valid?0:i.immediate==1?in.audio.bass:i.immediate==2?in.audio.mid:i.immediate==3?in.audio.treble:in.audio.level;break;
      case Op::Divide:w.scalars[i.dst]=w.scalars[i.a]/i.immediate;break;
      case Op::Modulo:w.scalars[i.dst]=w.scalars[i.a]%i.immediate;break;
      case Op::Multiply:w.scalars[i.dst]=w.scalars[i.a]*i.immediate;break;
      case Op::Add:w.scalars[i.dst]=w.scalars[i.a]+i.immediate;break;
      case Op::SubtractFrom:w.scalars[i.dst]=i.immediate-w.scalars[i.a];break;
      case Op::ShiftRight:w.scalars[i.dst]=w.scalars[i.a]>>i.immediate;break;
      case Op::Sin8:w.scalars[i.dst]=Math::sin8(uint8_t(w.scalars[i.a]));break;
      case Op::Triangle8:{const uint8_t p=uint8_t(w.scalars[i.a]);w.scalars[i.dst]=p<128?uint8_t(p*2):uint8_t((255-p)*2);break;}
      case Op::Clamp8:w.scalars[i.dst]=w.scalars[i.a]>255?255:w.scalars[i.a];break;
      case Op::AddRegister:w.scalars[i.dst]=w.scalars[i.a]+w.scalars[i.b];break;
      case Op::MultiplyRegister:w.scalars[i.dst]=w.scalars[i.a]*w.scalars[i.b];break;
      case Op::Minimum:w.scalars[i.dst]=w.scalars[i.a]<i.immediate?w.scalars[i.a]:i.immediate;break;
      case Op::MinimumRegister:w.scalars[i.dst]=w.scalars[i.a]<w.scalars[i.b]?w.scalars[i.a]:w.scalars[i.b];break;
      case Op::Gate:enabled=w.scalars[i.a]>=i.immediate&&w.scalars[i.a]<i.aux;break;
      case Op::ColorLiteral:w.colors[i.dst]={uint8_t(i.immediate>>16),uint8_t(i.immediate>>8),uint8_t(i.immediate)};break;
      case Op::Primary:w.colors[i.dst]=in.primary;break;
      case Op::Secondary:w.colors[i.dst]=in.secondary;break;
      case Op::Blend8:w.colors[i.dst]=Math::blend8(w.colors[i.a],w.colors[i.b],uint8_t(w.scalars[i.immediate]));break;
      case Op::Mix255:w.colors[i.dst]=detail::mix255(w.colors[i.a],w.colors[i.b],uint8_t(i.immediate));break;
      case Op::Scale8:w.colors[i.dst]=Math::scale8(w.colors[i.a],uint8_t(w.scalars[i.b]));break;
      case Op::Scale255:w.colors[i.dst]=detail::scale255(w.colors[i.a],uint8_t(w.scalars[i.b]));break;
      case Op::Fill:case Op::Region:w.draws[w.drawCount++]={w.colors[i.a],uint8_t(i.op==Op::Fill?0:1),0,0,255,uint8_t(i.immediate)};break;
      case Op::Glow:{const uint16_t width=uint16_t(w.scalars[i.aux]);if(!width)return false;w.draws[w.drawCount++]={w.colors[i.a],uint8_t(2+i.dst),uint16_t(w.scalars[i.immediate]),width,uint8_t(w.scalars[i.b]),0};break;}
      case Op::RegionThreshold:
        if(w.scalars[i.b]>65535)return false;
        w.draws[w.drawCount++]={w.colors[i.a],4,uint16_t(w.scalars[i.b]),0,0,i.dst};w.hasRegional=true;break;
      case Op::RegionPulse:{
        const auto head=w.scalars[i.b],gain=w.scalars[uint8_t(i.immediate>>24)];
        if(head>255||gain>255)return false;
        w.draws[w.drawCount++]={w.colors[i.a],5,uint16_t(head|(gain<<8)),uint16_t(i.immediate),uint8_t(i.immediate>>16),i.dst};w.hasRegional=true;break;
      }
      case Op::WrappedPair:{
        const auto first=w.scalars[uint8_t(i.immediate)],second=w.scalars[uint8_t(i.immediate>>8)];
        if(first>255||second>255)return false;
        w.draws[w.drawCount++]={w.colors[i.a],6,uint16_t(first|(second<<8)),uint16_t(i.immediate>>16),uint8_t(i.aux),i.dst};
        w.draws[w.drawCount++]={w.colors[i.b],7,uint16_t(i.aux>>8),0,0,0};w.hasRegional=true;break;
      }
    }
  }
  w.valid=true;return true;
}
// Keep the established fill/region/glow loop separate from regional arithmetic.
// A flag in existing Workspace padding chooses it once for the entire frame.
template<class Math> RGB basicPixel(const Workspace& w,uint16_t index){
  RGB result{0,0,0};if(!w.valid||index>=w.context.count)return result;
  const uint8_t region=index<37?1:index<124?2:index<127?3:4;
  for(unsigned n=0;n<w.drawCount;++n){
    const auto& d=w.draws[n];
    if(d.kind==0){result=d.color;continue;}
    if(d.kind==1){if(region==d.region)result=d.color;continue;}
    const int32_t x=w.context.position(index,d.kind==3?LampEffectFrame::Space::Motion:LampEffectFrame::Space::Strip);
    const uint32_t distance=x>=d.position?x-d.position:d.position-x;
    if(distance<d.width)result=Math::add(result,Math::scale8(d.color,uint8_t(uint32_t(d.strength)*(d.width-distance)/d.width)));
  }
  return result;
}

template<class Math> RGB regionalPixel(const Workspace& w,uint16_t index){
  RGB result{0,0,0};if(!w.valid||index>=w.context.count)return result;
  const uint8_t region=index<37?1:index<124?2:index<127?3:4;
  for(unsigned n=0;n<w.drawCount;++n){
    const auto& d=w.draws[n];
    if(d.kind==0){result=d.color;continue;}
    if(d.kind==1){if(region==d.region)result=d.color;continue;}
    if(d.kind<4){
      const int32_t x=w.context.position(index,d.kind==3?LampEffectFrame::Space::Motion:LampEffectFrame::Space::Strip);
      const uint32_t distance=x>=d.position?x-d.position:d.position-x;
      if(distance<d.width)result=Math::add(result,Math::scale8(d.color,uint8_t(uint32_t(d.strength)*(d.width-distance)/d.width)));
      continue;
    }
    if(d.kind==4||d.kind==5){
      if(region!=(d.region&7))continue;
      const uint16_t position=detail::localPosition(index,region,d.region>>3);
      if(d.kind==4){if(position<=d.position)result=d.color;}
      else {
        const uint16_t head=uint8_t(d.position),distance=position>head?position-head:head-position;
        const uint8_t width=uint8_t(d.width);
        const uint32_t pulse=distance<width?uint32_t(width-distance)*255/width:0;
        const uint32_t level=d.strength+pulse*uint8_t(d.position>>8)/uint8_t(d.width>>8);
        result=detail::scale255(d.color,uint8_t(level>255?255:level));
      }
      continue;
    }
    if(d.kind==6){
      if(n+1>=w.drawCount||w.draws[n+1].kind!=7)return {0,0,0};
      const auto& second=w.draws[++n];
      if(region!=d.region)continue;
      const uint8_t position=uint8_t(detail::localPosition(index,region,3));
      const uint16_t firstWeight=detail::pulseWeight(detail::wrappedDistance(position,uint8_t(d.position)),uint8_t(d.width),uint8_t(d.width>>8),uint8_t(second.position));
      const uint16_t secondWeight=detail::pulseWeight(detail::wrappedDistance(position,uint8_t(d.position>>8)),uint8_t(d.width),d.strength,uint8_t(second.position>>8));
      result=detail::weighted255(d.color,second.color,firstWeight,secondWeight);continue;
    }
    if(d.kind==7)continue;
  }
  return result;
}

template<class Math> RGB pixel(const Workspace& w,uint16_t index){
  return w.hasRegional?regionalPixel<Math>(w,index):basicPixel<Math>(w,index);
}
template<class Math> RGB pixel(const Workspace& w,const Inputs& in,uint16_t index){
  if(in.count!=w.context.count||in.midpoint!=w.context.midpoint||in.motionPath!=w.context.motionPath)return {0,0,0};
  return pixel<Math>(w,index);
}
template<class Math,class Pixel> bool render(const View& view,const Inputs& in,Workspace& w,Pixel* pixels){
  if(!pixels||!prepare<Math>(view,in,w))return false;
  if(w.drawCount==1&&w.draws[0].kind==0){
    const auto color=w.draws[0].color;
    for(uint16_t n=0;n<in.count;++n){pixels[n].r=color.r;pixels[n].g=color.g;pixels[n].b=color.b;}
    return true;
  }
  if(w.hasRegional){
    for(uint16_t n=0;n<in.count;++n){const auto c=regionalPixel<Math>(w,n);pixels[n].r=c.r;pixels[n].g=c.g;pixels[n].b=c.b;}
  }else{
    for(uint16_t n=0;n<in.count;++n){const auto c=basicPixel<Math>(w,n);pixels[n].r=c.r;pixels[n].g=c.g;pixels[n].b=c.b;}
  }
  return true;
}
}
