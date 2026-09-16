#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Streaming HTTP response headers: ignored values (notably GitHub's large CSP)
// are never accumulated. The entire parser has a fixed memory bound.
class UpdateHttpHeaders {
  enum Stage { Status, Name, Value, End } stage = Status;
  enum Field { Ignore, Length, Location, Transfer, Encoding } field = Ignore;
  char name[48]{}, small[64]{};
  size_t used = 0, total = 0;
  bool cr = false, seenLength = false, seenLocation = false;
  bool finishLine() {
    if (stage == Status) {
      small[used] = 0;
      if (used < 12 || (strncmp(small,"HTTP/1.1 ",9) && strncmp(small,"HTTP/1.0 ",9))) return false;
      if (small[9]<'1'||small[9]>'5'||small[10]<'0'||small[10]>'9'||small[11]<'0'||small[11]>'9'||(used>12&&small[12]!=' ')) return false;
      code=(small[9]-'0')*100+(small[10]-'0')*10+small[11]-'0'; stage=Name;
    } else if (stage == Name) {
      if (used) return false;
      stage=End;
    } else if (stage == Value) {
      if (field == Location) {
        while(used && location[used-1]==' ') --used;
        location[used]=0;
        if (!used) return false;
      } else if (field != Ignore) {
        while(used && small[used-1]==' ') --used;
        small[used]=0;
        if (field == Length) {
          if (!used) return false;
          length=0;
          for(size_t i=0;i<used;++i) {
            if(small[i]<'0'||small[i]>'9'||length>214748364) return false;
            length=length*10+small[i]-'0';
            if(length>2147483647) return false;
          }
        } else if (field == Transfer) transferEncoded=true;
        else if (strcmp(small,"identity")) encoded=true;
      }
      stage=Name;
    } else return false;
    used=0; return true;
  }
public:
  char location[2048]{};
  int code=0;
  int64_t length=-1;
  bool transferEncoded=false, encoded=false;
  bool complete() const { return stage==End; }
  bool feed(char c) {
    if (++total>65536 || complete()) return false;
    if(cr) { cr=false;return c=='\n' && finishLine(); }
    if(c=='\r') { cr=true;return true; }
    if(c=='\n'||(static_cast<unsigned char>(c)<32 && c!='\t')||c==127) return false;
    if(stage==Status) { if(used>=sizeof(small)-1)return false;small[used++]=c;return true; }
    if(stage==Name) {
      if(c==':') {
        if(!used)return false;
        name[used]=0; field=Ignore;
        if(!strcmp(name,"content-length")){if(seenLength)return false;seenLength=true;field=Length;}
        if(!strcmp(name,"location")){if(seenLocation)return false;seenLocation=true;field=Location;}
        if(!strcmp(name,"transfer-encoding"))field=Transfer;
        if(!strcmp(name,"content-encoding"))field=Encoding;
        stage=Value;used=0;return true;
      }
      if(used>=sizeof(name)-1||c==' '||c=='\t')return false;
      name[used++]=c>='A'&&c<='Z'?c+32:c;return true;
    }
    if(stage!=Value)return false;
    if(field==Ignore)return true;
    if(!used&&(c==' '||c=='\t'))return true;
    if(field==Location){if(used>=sizeof(location)-1)return false;location[used++]=c;}
    else {if(used>=sizeof(small)-1)return false;small[used++]=c>='A'&&c<='Z'?c+32:c;}
    return true;
  }
};
