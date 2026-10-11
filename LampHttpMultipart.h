#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Single-file browser /update framing, never the whole firmware in RAM.
// The caller invokes END only after both the closing delimiter and the declared
// Content-Length are complete. A malformed/abandoned stream cannot commit.
namespace LampHttpMultipart {
constexpr size_t ChunkBytes = 512;
constexpr size_t BoundaryBytes = 70, LineBytes = 384, HeaderBytes = 1024;
constexpr size_t HeaderCount = 8, NameBytes = 48, FilenameBytes = 128;
enum class Event : uint8_t { More, Start, Chunk, Complete, Failed };
class Parser {
  enum class Phase : uint8_t { First, Headers, Data, Closing, Done, Failed };
  Phase phase_ = Phase::Failed;
  char boundary_[BoundaryBytes+1]{}, line_[LineBytes+1]{}, name_[NameBytes+1]{}, filename_[FilenameBytes+1]{};
  uint8_t tail_[BoundaryBytes+8]{}, chunk_[ChunkBytes]{};
  size_t lineUsed_=0, tailUsed_=0, chunkUsed_=0, needleBytes_=0;
  uint16_t headerBytes_=0;
  uint8_t headers_=0;
  bool disposition_=false, contentType_=false;
  static void wipe(void* p,size_t n){volatile uint8_t* b=static_cast<volatile uint8_t*>(p);while(n--)*b++=0;}
  static char lower(char c){return c>='A'&&c<='Z'?char(c+('a'-'A')):c;}
  static bool equal(const char* text,size_t length,const char* expected){
    if(length!=strlen(expected))return false;
    for(size_t i=0;i<length;++i)if(lower(text[i])!=lower(expected[i]))return false;
    return true;
  }
  static void spaces(const char*& at){while(*at==' '||*at=='\t')++at;}
  bool disposition(const char* at){
    spaces(at);const char* kind=at;
    while(*at&&*at!=';'&&*at!=' '&&*at!='\t')++at;
    if(!equal(kind,size_t(at-kind),"form-data"))return false;
    bool seenName=false,seenFilename=false;
    for(;;){
      spaces(at);if(!*at)return seenName&&seenFilename;
      if(*at++!=';')return false;
      spaces(at);const char* key=at;
      while((*at>='a'&&*at<='z')||(*at>='A'&&*at<='Z')||(*at>='0'&&*at<='9')||*at=='-'||*at=='_')++at;
      const size_t length=size_t(at-key);if(!length)return false;
      spaces(at);if(*at++!='=')return false;
      spaces(at);if(*at++!='"')return false;
      char* out=nullptr;size_t capacity=FilenameBytes+1;
      if(equal(key,length,"name")){if(seenName)return false;seenName=true;out=name_;capacity=sizeof(name_);}
      else if(equal(key,length,"filename")){if(seenFilename)return false;seenFilename=true;out=filename_;capacity=sizeof(filename_);}
      size_t n=0;
      while(*at&&*at!='"'){
        const uint8_t c=uint8_t(*at++);if(c<32||c==127||c=='\\'||n+1>=capacity)return false;
        if(out)out[n]=char(c);
        ++n;
      }
      if(*at!='"'||!n)return false;
      ++at;if(out)out[n]=0;
    }
  }
  Event fail(){wipe(this,sizeof(*this));phase_=Phase::Failed;return Event::Failed;}
public:
  Parser()=default;
  Parser(const Parser&)=delete;
  Parser& operator=(const Parser&)=delete;
  ~Parser(){reset("");}
  void reset(const char* boundary){
    wipe(this,sizeof(*this));phase_=Phase::First;
    if(!boundary){phase_=Phase::Failed;return;}
    size_t n=0;while(n<=BoundaryBytes&&boundary[n]){
      const uint8_t c=uint8_t(boundary[n]);
      if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||strchr("'()+_,-./:=?",c))){phase_=Phase::Failed;return;}
      ++n;
    }
    if(!n||n>BoundaryBytes){phase_=Phase::Failed;return;}
    memcpy(boundary_,boundary,n+1);needleBytes_=n+4;
  }
  const uint8_t* chunk()const{return chunk_;}
  size_t chunkSize()const{return chunkUsed_;}
  void consumeChunk(){wipe(chunk_,chunkUsed_);chunkUsed_=0;}
  const char* name()const{return name_;}
  const char* filename()const{return filename_;}
  bool complete()const{return phase_==Phase::Done;}
  Event feed(uint8_t byte){
    if(phase_==Phase::Done||phase_==Phase::Failed||chunkUsed_==ChunkBytes)return fail();
    if(phase_==Phase::First||phase_==Phase::Headers){
      if(byte==0||byte==127||(byte<32&&byte!='\r'&&byte!='\n'&&byte!='\t'))return fail();
      if(lineUsed_&&line_[lineUsed_-1]=='\r'&&byte!='\n')return fail();
      if(++headerBytes_>HeaderBytes||lineUsed_==sizeof(line_)-1)return fail();
      line_[lineUsed_++]=char(byte);
      if(byte!='\n')return Event::More;
      if(lineUsed_<2||line_[lineUsed_-2]!='\r')return fail();
      line_[lineUsed_-2]=0;
      if(phase_==Phase::First){
        if(strncmp(line_,"--",2)||strcmp(line_+2,boundary_))return fail();
        phase_=Phase::Headers;
      }else if(!line_[0]){
        if(!disposition_)return fail();
        phase_=Phase::Data;lineUsed_=0;return Event::Start;
      }else{
        if(++headers_>HeaderCount)return fail();
        const char* colon=strchr(line_,':');if(!colon)return fail();
        if(equal(line_,size_t(colon-line_),"Content-Disposition")){
          if(disposition_||!disposition(colon+1))return fail();
          disposition_=true;
        }else if(equal(line_,size_t(colon-line_),"Content-Type")){
          if(contentType_)return fail();
          const char* value=colon+1;spaces(value);if(!*value)return fail();
          contentType_=true;
        }else return fail();
      }
      wipe(line_,lineUsed_);lineUsed_=0;return Event::More;
    }
    if(phase_==Phase::Closing){
      tail_[tailUsed_++]=byte;
      if(byte=='\n'){wipe(tail_,tailUsed_);tailUsed_=0;phase_=Phase::Done;return Event::Complete;}
      // A binary boundary prefix with a non-closing suffix is file data.
      phase_=Phase::Data;
    }else tail_[tailUsed_++]=byte;
    for(;;){
      const bool candidate=tailUsed_>=needleBytes_&&tail_[0]=='\r'&&tail_[1]=='\n'&&tail_[2]=='-'&&tail_[3]=='-'&&!memcmp(tail_+4,boundary_,needleBytes_-4);
      if(candidate&&tailUsed_>=needleBytes_+2&&tail_[needleBytes_]=='\r'&&tail_[needleBytes_+1]=='\n')return fail(); // One file only.
      if(candidate&&tailUsed_>=needleBytes_+3&&tail_[needleBytes_]=='-'&&tail_[needleBytes_+1]=='-'&&tail_[needleBytes_+2]=='\r'){
        if(tailUsed_==needleBytes_+3){phase_=Phase::Closing;return chunkUsed_?Event::Chunk:Event::More;}
        if(tail_[needleBytes_+3]=='\n'){
          // This path can follow a just-consumed full chunk. Any partial chunk
          // is emitted in the Closing branch before its final newline arrives.
          if(chunkUsed_)return fail();
          wipe(tail_,tailUsed_);tailUsed_=0;phase_=Phase::Done;return Event::Complete;
        }
      }
      if(tailUsed_<needleBytes_+4)return Event::More;
      chunk_[chunkUsed_++]=tail_[0];memmove(tail_,tail_+1,--tailUsed_);
      if(chunkUsed_==ChunkBytes)return Event::Chunk;
    }
  }
};
}
