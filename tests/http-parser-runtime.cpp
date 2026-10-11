#include "LampHttpParser.h"
#include "LampHttpJson.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
#include <algorithm>
#include <cstdlib>
#include <new>

static size_t allocations = 0;
void* operator new(std::size_t size) { ++allocations; if (void* p = std::malloc(size)) return p; throw std::bad_alloc(); }
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }

using namespace LampHttpParser;
template<class P> static Result feed(P& parser, const std::string& data) {
  Result result = Result::More;
  for (unsigned char c : data) { result = parser.feed(c); if (result == Result::Rejected) break; }
  return result;
}
static void denied(const std::string& data, Error expected) {
  Parser parser; const auto before = allocations;
  assert(feed(parser, data) == Result::Rejected);
  assert(parser.phase() == Phase::Failed && parser.error() == expected);
  assert(parser.feed('X') == Result::Rejected && parser.error() == expected);
  assert(allocations == before);
  // Production JSON publishing guard rejects every incomplete prefix of
  // bounded objects, arrays and strings without allocating response memory.
  for(const auto& json : {std::string("{\"samples\":[1,-2.3e+4,true,false,null,{\"color\":\"white\\u0061\"}],\"escaped\":\"\\\"\\\\\\/\\b\\f\\n\\r\\t\"}"),std::string("[0,{},[],\"lamp\"]"),std::string("\"White cursor\"")}){
    const auto count=allocations;
    assert(LampHttpJson::complete(json.c_str(),json.size()));
    for(size_t size=0;size<json.size();++size)assert(!LampHttpJson::complete(json.c_str(),size));
    assert(allocations==count);
  }
  for(const char* invalid : {"", " ", "{", "[", "[,]", "[1,]", "{\"x\":1,}", "{x:1}", "{\"x\"1}", "{\"x\":}", "{\"x\":true} trailing", "\"unclosed", "\"\\x\"", "\"\\u000x\"", "\"\\u00\"", "\"\n\"", "01", "+1", "-", "1.", "1e", "1e+", "1e-", "--1", "True", "tru", "nul", "false false"})assert(!LampHttpJson::complete(invalid,strlen(invalid)));
  for(const char* valid : {" 0\r\n", "-0", "-12.5e-3", "0E+2", "false", "true", "null", "{}", "[]", "{\"name\":\"Pink Corkscrew\"}"})assert(LampHttpJson::complete(valid,strlen(valid)));
  const std::string depth16=std::string(16,'[')+"0"+std::string(16,']');
  const std::string depth17=std::string(17,'[')+"0"+std::string(17,']');
  assert(LampHttpJson::complete(depth16.c_str(),depth16.size())&&!LampHttpJson::complete(depth17.c_str(),depth17.size()));
}
static std::string post(const std::string& body, const std::string& extras = "") {
  return "POST /api/name HTTP/1.1\r\nContent-Type: application/x-www-form-urlencoded; charset=UTF-8\r\nContent-Length: " + std::to_string(body.size()) + "\r\n" + extras + "\r\n" + body;
}
static std::string upload(const std::string& boundary, uint32_t length = 100, const std::string& path = "/update") {
  return "POST " + path + " HTTP/1.1\r\nContent-Length: " + std::to_string(length) + "\r\nContent-Type: multipart/form-data; boundary=" + boundary + "\r\n\r\n";
}
static std::string headerBytes(size_t bytes) {
  std::string data;
  while (bytes > 2) {
    const size_t line = std::min(bytes - 2, HeaderLineLimit + 2);
    assert(line >= 4);
    data += "X:" + std::string(line - 4, 'a') + "\r\n"; bytes -= line;
  }
  assert(bytes == 2); return data + "\r\n";
}
static void cleared(const Parser& parser) {
  const auto& request = parser.request();
  for (const auto* field : {request.path, request.query, request.authorization, request.token, request.contentType, request.boundary}) assert(!field[0]);
  assert(!request.contentLength && !request.hasContentLength && !request.multipart);
  for (size_t i = 0; i <= BodyLimit; ++i) assert(!parser.body()[i]);
  assert(parser.phase() == Phase::RequestLine && parser.error() == Error::None && !parser.bodySize() && !parser.headerBytes());
}

int main() {
  // A lost whole append may still be valid JSON. Only actual direct members
  // satisfy the production support snapshot's completeness contract.
  const char* const required[]={"timing","firmware"};
  const char* const firmwareKeys[]={"version","phase"};
  const char* json="{\"timing\":{},\"firmware\" : {\"version\":\"1.15.1\",\"phase\":0}}";
  const auto beforeJson=allocations;
  assert(LampHttpJson::requiredKeys(json,strlen(json),required,2));
  const auto firmware=LampHttpJson::member(json,strlen(json),"firmware");
  assert(firmware&&LampHttpJson::requiredKeys(firmware.bytes,firmware.length,firmwareKeys,2));
  for(const char* omitted:{"{\"timing\":{\"firmware\":{}}}","{\"firmware\":{},\"value\":\"timing\"}","{\"timing\":{},\"firmwareAlias\":{}}","{\"timing\":{},\"firm\\u0077are\":{}}","[\"timing\",\"firmware\"]","{\"timing\":{},\"firmware\":{}} trailing"})
    assert(!LampHttpJson::requiredKeys(omitted,strlen(omitted),required,2));
  for(size_t cut=0;cut<strlen(json);++cut)assert(!LampHttpJson::member(json,cut,"firmware"));
  assert(!LampHttpJson::requiredKeys(nullptr,0,required,2));
  assert(!LampHttpJson::requiredKeys(json,strlen(json),nullptr,2));
  assert(!LampHttpJson::requiredKeys(json,strlen(json),required,33));
  assert(!LampHttpJson::member(json,strlen(json),nullptr));
  struct CountCase {const char* text;size_t count;};
  for(const auto& item:{CountCase{"[]",0},CountCase{" [ ] \r\n",0},CountCase{"[1]",1},CountCase{"[0,false,true,null,-1.25e+2]",5},CountCase{"[[1,2],{\"nested\":[3,4]},\"comma, bracket] escaped\\\"\"]",3},CountCase{"[\"[1,2]\",\"\\u005d\",[]]",3}}){
    size_t count=999;
    assert(LampHttpJson::arrayCount(item.text,strlen(item.text),count)&&count==item.count);
  }
  for(const char* item:{"", " ", "{}", "null", "12", "\"[]\"", "[", "[1,]", "[,1]", "[[1,2]", "[true false]", "[1] extra", "[\"unclosed]", "[\"\\x\"]"}){
    size_t count=999;assert(!LampHttpJson::arrayCount(item,strlen(item),count)&&count==0);
  }
  size_t absent=999;assert(!LampHttpJson::arrayCount(nullptr,0,absent)&&absent==0);
  assert(allocations==beforeJson);
  const std::string arrayDepth16=std::string(16,'[')+"0"+std::string(16,']');
  const std::string arrayDepth17=std::string(17,'[')+"0"+std::string(17,']');
  const auto beforeArray=allocations;size_t nestedCount=0;
  assert(LampHttpJson::arrayCount(arrayDepth16.c_str(),arrayDepth16.size(),nestedCount)&&nestedCount==1);
  assert(!LampHttpJson::arrayCount(arrayDepth17.c_str(),arrayDepth17.size(),nestedCount)&&nestedCount==0);
  assert(allocations==beforeArray);
  // One byte per production parser call: partial/trickled lines, headers and
  // bodies never create a ready request before the exact framing is complete.
  const std::string body = "name=Pink+Corkscrew";
  const auto request = post(body, "aUtHoRiZaTiOn: Basic bGFtcDpkZXZlbG9wbWVudA==\r\nx-LaMp-ToKeN: development-token\r\n");
  for (size_t cut = 0; cut < request.size(); ++cut) {
    Parser parser;
    const auto prefix = request.substr(0, cut), suffix = request.substr(cut);
    const auto before = allocations;
    feed(parser, prefix);
    assert(parser.phase() != Phase::Complete && parser.phase() != Phase::Failed);
    assert(feed(parser, suffix) == Result::Complete && parser.phase() == Phase::Complete);
    assert(!strcmp(parser.request().path, "/api/name") && parser.request().method == Method::Post);
    assert(!strcmp(parser.request().authorization, "Basic bGFtcDpkZXZlbG9wbWVudA=="));
    assert(!strcmp(parser.request().token, "development-token"));
    assert(parser.bodySize() == body.size() && !memcmp(parser.body(), body.data(), body.size()));
    parser.reset(); cleared(parser); assert(allocations == before);
  }
  {
    Parser parser;
    assert(feed(parser, "GET /api/state?fresh=1&x=2 HTTP/1.0\r\nHost: lamp.local\r\nConnection: close\r\n\r\n") == Result::HeadersReady);
    assert(parser.phase() == Phase::Complete && !strcmp(parser.request().path, "/api/state") && !strcmp(parser.request().query, "fresh=1&x=2"));
    assert(parser.feed('G') == Result::Rejected); // pipelined bytes cannot execute a second command.
  }
  {
    Parser parser;
    assert(feed(parser, "POST /api/receipt HTTP/1.1\r\n\r\n") == Result::HeadersReady && parser.phase() == Phase::Complete);
    parser.clear(); cleared(parser);
    assert(feed(parser, "POST /api/name HTTP/1.1\r\nContent-Length: 5\r\n\r\nname=") == Result::Complete);
  }
  // Abrupt connection cancellation wipes incomplete authentication and bodies.
  for (size_t cut = 1; cut <= request.size(); ++cut) {
    Parser parser; feed(parser, request.substr(0, cut)); parser.clear(); cleared(parser);
    assert(feed(parser, "GET /api/revision HTTP/1.1\r\n\r\n") == Result::HeadersReady && parser.phase() == Phase::Complete);
  }
  {
    Parser parser; const auto maximum = post(std::string(NormalBodyLimit, 'a'));
    assert(feed(parser, maximum) == Result::Complete && parser.bodySize() == NormalBodyLimit && parser.body()[NormalBodyLimit] == 0);
  }
  denied(post(std::string(NormalBodyLimit + 1, 'a')), Error::BodyTooLarge);
  {
    const std::string household = "POST /api/household/control HTTP/1.1\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: " + std::to_string(BodyLimit) + "\r\n\r\n" + std::string(BodyLimit, 'a');
    Parser parser; assert(feed(parser, household) == Result::Complete && parser.bodySize() == BodyLimit && parser.body()[BodyLimit] == 0);
    denied("POST /api/household/control HTTP/1.1\r\nContent-Length: " + std::to_string(BodyLimit + 1) + "\r\n\r\n", Error::BodyTooLarge);
    denied("POST /api/household/control-other HTTP/1.1\r\nContent-Length: 2048\r\n\r\n", Error::BodyTooLarge);
  }
  denied("GET /api/state HTTP/1.1\r\nContent-Length: 1\r\n\r\nx", Error::BadRequest);
  denied("GET / HTTP/2.0\r\n\r\n", Error::BadRequest);
  denied("GET http://lamp/api/state HTTP/1.1\r\n\r\n", Error::BadRequest);
  denied("GET /#fragment HTTP/1.1\r\n\r\n", Error::BadRequest);
  denied("GET /a b HTTP/1.1\r\n\r\n", Error::BadRequest);
  denied("GET / HTTP/1.1\n\n", Error::BadRequest);
  denied("GET / HTTP/1.1\rX", Error::BadRequest);
  denied("PUT /api/state HTTP/1.1\r\n\r\n", Error::MethodNotAllowed);
  denied("GET " + std::string(TargetLimit + 1, '/') + " HTTP/1.1\r\n\r\n", Error::BadRequest);
  denied(std::string(RequestLineLimit + 1, 'G'), Error::RequestLineTooLong);
  {
    Parser parser;
    assert(feed(parser, "GET " + std::string(TargetLimit, '/') + " HTTP/1.1\r\n\r\n") == Result::HeadersReady && strlen(parser.request().path) == TargetLimit);
    parser.clear();
    assert(feed(parser, "GET / HTTP/1.1\r\nX:" + std::string(HeaderLineLimit - 2, 'a') + "\r\n\r\n") == Result::HeadersReady);
    parser.clear();
    assert(feed(parser, "GET / HTTP/1.1\r\n" + headerBytes(HeaderBytesLimit)) == Result::HeadersReady && parser.headerBytes() == HeaderBytesLimit);
  }
  denied("GET / HTTP/1.1\r\nX:" + std::string(HeaderLineLimit - 1, 'a'), Error::HeaderLineTooLong);
  denied("GET / HTTP/1.1\r\n" + headerBytes(HeaderBytesLimit + 1), Error::HeadersTooLarge);
  {
    std::string headers;
    for (size_t i = 0; i < HeaderCountLimit; ++i) headers += "X:a\r\n";
    Parser parser; assert(feed(parser, "GET / HTTP/1.1\r\n" + headers + "\r\n") == Result::HeadersReady);
    denied("GET / HTTP/1.1\r\n" + headers + "X:a\r\n\r\n", Error::TooManyHeaders);
  }
  denied("GET / HTTP/1.1\r\n Authorization: secret\r\n\r\n", Error::BadRequest);
  denied("GET / HTTP/1.1\r\nBad Name: x\r\n\r\n", Error::BadRequest);
  denied("GET / HTTP/1.1\r\nNoColon\r\n\r\n", Error::BadRequest);
  denied("GET / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n", Error::TransferEncoding);
  denied(post("a=b", "Content-Length: 3\r\n"), Error::DuplicateHeader);
  denied(post("a=b", "Content-Type: text/plain\r\n"), Error::DuplicateHeader);
  denied(post("a=b", "Authorization: Basic a\r\nAuthorization: Basic b\r\n"), Error::DuplicateHeader);
  denied(post("a=b", "X-Lamp-Token: a\r\nX-Lamp-Token: b\r\n"), Error::DuplicateHeader);
  denied(post("a=b", "Authorization: " + std::string(129, 'a') + "\r\n"), Error::HeaderLineTooLong);
  denied(post("a=b", "X-Lamp-Token: " + std::string(65, 'a') + "\r\n"), Error::HeaderLineTooLong);
  for (const auto& value : {"", "-1", "+1", "3,3", "4294967296", "1x"}) denied("POST /api/name HTTP/1.1\r\nContent-Length: " + std::string(value) + "\r\n\r\n", Error::BadRequest);
  denied("POST /api/name HTTP/1.1\r\nContent-Length: 4294967295\r\n\r\n", Error::BodyTooLarge);
  denied("POST /api/name HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}", Error::UnsupportedContentType);
  denied(post(std::string("x=\0", 3)), Error::BadRequest);

  // Multipart framing is handed off only for the authenticated service-update
  // route. No binary file is buffered by the normal form parser.
  for (const std::string& boundary : {std::string("----native-form-boundary"), std::string("\"----native-form-boundary\""), std::string(BoundaryLimit, 'a')}) {
    Parser parser; assert(feed(parser, upload(boundary, MultipartLimit)) == Result::HeadersReady);
    assert(parser.phase() == Phase::Upload && parser.request().multipart && parser.request().contentLength == MultipartLimit && parser.request().hasContentLength && parser.bodySize() == 0);
    assert(strlen(parser.request().boundary) >= 24 && strlen(parser.request().boundary) <= BoundaryLimit);
    assert(parser.feed(0xe9) == Result::Rejected); // raw file bytes must use the streaming parser.
    parser.reset(); cleared(parser);
  }
  denied(upload("a", MultipartLimit + 1), Error::BodyTooLarge);
  denied(upload(std::string(BoundaryLimit + 1, 'a')), Error::InvalidMultipartBoundary);
  for (const std::string& boundary : {std::string(), std::string("\"unfinished"), std::string("a b"), std::string("a;boundary=b"), std::string("\"a\"; extra=b")}) denied(upload(boundary), Error::InvalidMultipartBoundary);
  denied(upload("valid", 100, "/api/config"), Error::UnsupportedContentType);
  denied("POST /update HTTP/1.1\r\n\r\n", Error::UnsupportedContentType);
  denied("POST /update HTTP/1.1\r\nContent-Type: multipart/form-data; boundary=a\r\n\r\n", Error::BadRequest);
  denied(upload("valid", 0), Error::BadRequest);

  // The live socket parser keeps only header scratch. A validated larger body
  // must attach exactly sized caller-owned storage before any body is consumed.
  static_assert(sizeof(CompactParser)<1400,"Slow GET clients must not retain full form storage");
  for(size_t length : {size_t(1),HeaderLineLimit,HeaderLineLimit+1,NormalBodyLimit,BodyLimit}){
    const bool household=length>NormalBodyLimit;
    const std::string head="POST "+std::string(household?"/api/household/control":"/api/name")+" HTTP/1.1\r\nAuthorization: Basic development\r\nContent-Length: "+std::to_string(length)+"\r\n\r\n";
    const std::string payload(length,'a');
    for(size_t cut=0;cut<=length;++cut){
      CompactParser parser;uint8_t external[BodyLimit+1];memset(external,0xef,sizeof(external));
      const auto count=allocations;assert(feed(parser,head)==Result::HeadersReady&&parser.phase()==Phase::Body);
      const bool needs=length>=CompactParser::StorageCapacity;
      assert(parser.bodyStorageNeeded()==needs);
      if(needs){
        assert(!parser.attachBody(nullptr,length+1)&&!parser.attachBody(external,length)&&!parser.attachBody(external,length+2));
        assert(parser.attachBody(external,length+1)&&!parser.bodyStorageNeeded()&&!parser.attachBody(external,length+1));
      }
      for(size_t i=0;i<cut;++i)parser.feed(uint8_t(payload[i]));
      for(size_t i=cut;i<payload.size();++i)parser.feed(uint8_t(payload[i]));
      assert(parser.phase()==Phase::Complete&&parser.bodySize()==length&&!memcmp(parser.body(),payload.data(),length)&&parser.body()[length]==0);
      parser.reset();assert(!parser.request().authorization[0]);
      if(needs)for(size_t i=0;i<=length;++i)assert(!external[i]);
      assert(allocations==count); // Attached storage never causes parser allocation.
    }
  }
  {
    CompactParser parser;assert(feed(parser,"GET /api/state HTTP/1.1\r\n\r\n")==Result::HeadersReady);
    assert(!parser.bodyStorageNeeded()&&!parser.attachBody(nullptr,0));
    parser.reset();assert(feed(parser,upload("fixture"))==Result::HeadersReady&&parser.phase()==Phase::Upload&&!parser.bodyStorageNeeded());
    parser.reset();assert(feed(parser,"POST /api/name HTTP/1.1\r\nContent-Length: 1024\r\n\r\n")==Result::HeadersReady);
    assert(parser.feed('a')==Result::Rejected&&parser.error()==Error::BodyStorageUnavailable);
    parser.reset();uint8_t external[1025];memset(external,0xef,sizeof(external));
    assert(feed(parser,"POST /api/name HTTP/1.1\r\nContent-Length: 1024\r\n\r\n")==Result::HeadersReady&&parser.attachBody(external,sizeof(external)));
    for(unsigned i=0;i<123;++i)assert(parser.feed('s')==Result::More);
    parser.clear();for(auto byte:external)assert(!byte);
  }

  // Hard lifetime is never renewed by trickle progress; all intervals remain
  // correct across the uint32 millis() wrap.
  for (uint32_t accepted : {uint32_t(0), uint32_t(123), UINT32_MAX - 2000}) {
    Deadline deadline; deadline.begin(accepted);
    assert(!deadline.expired(accepted + IdleTimeoutMs - 1));
    assert(deadline.idleExpired(accepted + IdleTimeoutMs));
    for (uint32_t t = 1000; t < RequestTimeoutMs; t += 1000) { deadline.progress(accepted + t); assert(!deadline.expired(accepted + t)); }
    deadline.progress(accepted + RequestTimeoutMs); assert(deadline.absoluteExpired(accepted + RequestTimeoutMs) && deadline.expired(accepted + RequestTimeoutMs));
    deadline.begin(accepted);
    for (uint32_t t = 1000; t < UploadTimeoutMs; t += 1000) { deadline.progress(accepted + t); assert(!deadline.expired(accepted + t, true)); }
    deadline.progress(accepted + UploadTimeoutMs); assert(deadline.expired(accepted + UploadTimeoutMs, true));
  }
  // Malformed input and canaries exercise production bounds without a second
  // implementation of the parser. No parser call allocates memory.
  struct Guarded { uint32_t before = 0x11223344; Parser parser; uint32_t after = 0x55667788; } guarded;
  uint32_t random = 0x12345678;
  const auto before = allocations;
  for (unsigned trial = 0; trial < 3000; ++trial) {
    guarded.parser.reset();
    for (unsigned i = 0; i < 4096; ++i) {
      random = random * 1664525 + 1013904223;
      if (guarded.parser.feed(uint8_t(random >> 24)) == Result::Rejected) break;
    }
    assert(guarded.before == 0x11223344 && guarded.after == 0x55667788);
  }
  assert(allocations == before);
  std::cout << "PASS production HTTP parser: trickles, framing, limits, cancellation/secret wipe, multipart handoff, duplicate/overflow rejection, rollover/hard deadlines, no allocation; parserBytes=" << sizeof(Parser) << " compactParserBytes=" << sizeof(CompactParser) << '\n';
}
