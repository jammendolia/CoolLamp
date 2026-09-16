#include <cassert>
#include <iostream>
#include <string>
#include "../UpdateHttpHeaders.h"
bool parse(UpdateHttpHeaders& h,const std::string& s){for(char c:s)if(!h.feed(c))return false;return h.complete();}
int main(){
  UpdateHttpHeaders h;
  const std::string huge="HTTP/1.1 302 Found\r\nContent-Security-Policy: "+std::string(48000,'x')+"\r\nLocation: https://release-assets.githubusercontent.com/path?token=ABC%2Fxyz\r\nContent-Length: 0\r\n\r\n";
  assert(parse(h,huge));assert(h.code==302&&h.length==0);assert(std::string(h.location).find("ABC%2Fxyz")!=std::string::npos);
  static_assert(sizeof(UpdateHttpHeaders)<2400,"Header memory must remain bounded");
  UpdateHttpHeaders asset;assert(parse(asset,"HTTP/1.1 200 OK\r\ncOnTeNt-LeNgTh: 1741008 \r\nContent-Encoding: identity\r\n\r\n"));assert(asset.length==1741008&&!asset.encoded&&!asset.transferEncoded);
  for(const auto& invalid:{std::string("HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n"),
    std::string("HTTP/1.1 200 OK\r\nContent-Length: 2147483648\r\n\r\n"),
    std::string("HTTP/1.1 200 OK\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\n"),
    std::string("HTTP/1.1 302 Found\r\nLocation: ")+std::string(2048,'x')+"\r\n\r\n",
    std::string("HTTP/1.1 200 OK\r\nX: ")+std::string(65536,'x')+"\r\n\r\n",
    std::string("HTTP/1.1 200 OK\nContent-Length: 1\n\n"),
    std::string("HTTP/1.1 200 OK\r\n folded: header\r\n\r\n")}){UpdateHttpHeaders bad;assert(!parse(bad,invalid));}
  UpdateHttpHeaders chunk;assert(parse(chunk,"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"));assert(chunk.transferEncoded);
  UpdateHttpHeaders gzip;assert(parse(gzip,"HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\n"));assert(gzip.encoded);
  UpdateHttpHeaders missing;assert(parse(missing,"HTTP/1.1 404 Not Found\r\n\r\n"));assert(missing.length==-1);
  std::cout<<"PASS: bounded large-header parsing, fragmented input, redirect preservation, framing and malformed/oversized header rejection.\n";
}
