#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// Incremental HTTP framing only. The loop-owned server authenticates and
// dispatches complete requests; this parser never executes a lamp command.
namespace LampHttpParser {
constexpr size_t RequestLineLimit = 256;
constexpr size_t TargetLimit = 192;
constexpr size_t HeaderLineLimit = 384;
constexpr size_t HeaderBytesLimit = 2048;
constexpr size_t HeaderCountLimit = 32;
constexpr size_t NormalBodyLimit = 1024;
// Signed household requests already use a larger legacy envelope. Keep this
// exception route-specific rather than increasing every command's wire limit.
constexpr size_t BodyLimit = 2048;
constexpr size_t ImageLimit = 2031616;
constexpr size_t MultipartLimit = ImageLimit + 1024;
constexpr size_t BoundaryLimit = 70;
constexpr uint32_t IdleTimeoutMs = 1500;
constexpr uint32_t RequestTimeoutMs = 5000;
constexpr uint32_t UploadTimeoutMs = 180000;

enum class Method : uint8_t { Get, Post };
enum class Phase : uint8_t { RequestLine, Headers, Body, Upload, Complete, Failed };
enum class Result : uint8_t { More, HeadersReady, Complete, Rejected };
enum class Error : uint8_t {
  None, BadRequest, MethodNotAllowed, RequestLineTooLong, HeaderLineTooLong,
  HeadersTooLarge, TooManyHeaders, DuplicateHeader, TransferEncoding,
  BodyTooLarge, UnsupportedContentType, InvalidMultipartBoundary, BodyStorageUnavailable
};

inline void wipe(void* memory, size_t size) {
  volatile uint8_t* bytes = static_cast<volatile uint8_t*>(memory);
  while (size--) *bytes++ = 0;
}
inline bool elapsed(uint32_t now, uint32_t began, uint32_t limit) {
  return uint32_t(now - began) >= limit;
}
struct Deadline {
  uint32_t acceptedAt = 0, progressAt = 0;
  void begin(uint32_t now) { acceptedAt = progressAt = now; }
  void progress(uint32_t now) { progressAt = now; }
  bool absoluteExpired(uint32_t now, bool upload = false) const {
    return elapsed(now, acceptedAt, upload ? UploadTimeoutMs : RequestTimeoutMs);
  }
  bool idleExpired(uint32_t now) const { return elapsed(now, progressAt, IdleTimeoutMs); }
  bool expired(uint32_t now, bool upload = false) const {
    return absoluteExpired(now, upload) || idleExpired(now);
  }
};

struct Request {
  Method method = Method::Get;
  // The combined path + '?' + query is limited to TargetLimit bytes.
  char path[TargetLimit + 1] = {}, query[TargetLimit + 1] = {};
  char authorization[129] = {}, token[65] = {}, contentType[129] = {};
  char boundary[BoundaryLimit + 1] = {};
  uint32_t contentLength = 0;
  bool hasContentLength = false, multipart = false;
};

template<size_t StorageBytes> class BasicParser {
  static_assert(StorageBytes >= HeaderLineLimit + 1 && StorageBytes <= BodyLimit + 1,
                "Parser storage must fit a bounded header line");
  Request request_;
  // Header scratch and the form body are never live in the same phase. Reuse
  // their storage instead of retaining an extra buffer for every slow client.
  char work_[StorageBytes] = {};
  char* const line_ = work_;
  uint8_t* body_ = reinterpret_cast<uint8_t*>(work_);
  size_t bodyCapacity_ = StorageBytes;
  size_t lineSize_ = 0, bodySize_ = 0, headerBytes_ = 0, headerCount_ = 0;
  Phase phase_ = Phase::RequestLine;
  Error error_ = Error::None;
  bool carriage_ = false, seenAuthorization_ = false, seenToken_ = false, seenType_ = false;

  Result reject(Error error) { error_ = error; phase_ = Phase::Failed; return Result::Rejected; }
  static char lower(char c) { return c >= 'A' && c <= 'Z' ? char(c + ('a' - 'A')) : c; }
  static bool equal(const char* text, size_t length, const char* expected) {
    const size_t other = strlen(expected);
    if (length != other) return false;
    for (size_t i = 0; i < length; ++i) if (lower(text[i]) != lower(expected[i])) return false;
    return true;
  }
  static bool tokenCharacter(uint8_t c) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return true;
    const char* symbols = "!#$%&'*+-.^_`|~";
    return c && strchr(symbols, c) != nullptr;
  }
  static bool boundaryCharacter(uint8_t c) {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return true;
    return c && strchr("'()+_,-./:=?", c) != nullptr;
  }
  static bool copy(char* out, size_t capacity, const char* text, size_t length) {
    if (length >= capacity) return false;
    memcpy(out, text, length); out[length] = 0; return true;
  }
  Result requestLine() {
    size_t first = 0; while (first < lineSize_ && line_[first] != ' ') ++first;
    size_t last = first + 1; while (last < lineSize_ && line_[last] != ' ') ++last;
    if (!first || first >= lineSize_ || last == first + 1 || last >= lineSize_) return reject(Error::BadRequest);
    if (first == 3 && !memcmp(line_, "GET", 3)) request_.method = Method::Get;
    else if (first == 4 && !memcmp(line_, "POST", 4)) request_.method = Method::Post;
    else return reject(Error::MethodNotAllowed);
    if (lineSize_ - last - 1 != 8 || (memcmp(line_ + last + 1, "HTTP/1.1", 8) && memcmp(line_ + last + 1, "HTTP/1.0", 8))) return reject(Error::BadRequest);
    const size_t length = last - first - 1;
    if (length > TargetLimit || line_[first + 1] != '/') return reject(Error::BadRequest);
    size_t query = length;
    for (size_t i = 0; i < length; ++i) {
      const uint8_t c = uint8_t(line_[first + 1 + i]);
      if (c <= 32 || c >= 127 || c == '#') return reject(Error::BadRequest);
      if (c == '?' && query == length) query = i;
    }
    copy(request_.path, sizeof(request_.path), line_ + first + 1, query);
    if (query < length) copy(request_.query, sizeof(request_.query), line_ + first + query + 2, length - query - 1);
    phase_ = Phase::Headers; return Result::More;
  }
  bool multipartType(const char* text, size_t length) {
    size_t separator = 0; while (separator < length && text[separator] != ';') ++separator;
    size_t mediaEnd = separator; while (mediaEnd && (text[mediaEnd - 1] == ' ' || text[mediaEnd - 1] == '\t')) --mediaEnd;
    if (!equal(text, mediaEnd, "multipart/form-data") || separator == length) return false;
    size_t at = separator + 1; while (at < length && (text[at] == ' ' || text[at] == '\t')) ++at;
    constexpr size_t PrefixLength = 9;
    if (length - at < PrefixLength || !equal(text + at, PrefixLength, "boundary=")) return false;
    at += PrefixLength;
    bool quoted = at < length && text[at] == '"'; if (quoted) ++at;
    const size_t begin = at;
    while (at < length && (!quoted || text[at] != '"')) {
      if (!boundaryCharacter(uint8_t(text[at]))) return false;
      ++at;
    }
    const size_t bytes = at - begin;
    if (!bytes || bytes > BoundaryLimit) return false;
    if (quoted) { if (at == length || text[at++] != '"') return false; }
    while (at < length && (text[at] == ' ' || text[at] == '\t')) ++at;
    if (at != length) return false;
    return copy(request_.boundary, sizeof(request_.boundary), text + begin, bytes);
  }
  Result headersFinished() {
    if (request_.method == Method::Get && request_.contentLength) return reject(Error::BadRequest);
    if (request_.contentType[0]) {
      const size_t length = strlen(request_.contentType);
      size_t end = 0; while (end < length && request_.contentType[end] != ';') ++end;
      size_t mediaEnd = end; while (mediaEnd && (request_.contentType[mediaEnd - 1] == ' ' || request_.contentType[mediaEnd - 1] == '\t')) --mediaEnd;
      if (equal(request_.contentType, mediaEnd, "multipart/form-data")) {
        if (request_.method != Method::Post || strcmp(request_.path, "/update")) return reject(Error::UnsupportedContentType);
        if (!multipartType(request_.contentType, length)) return reject(Error::InvalidMultipartBoundary);
        if (!request_.hasContentLength || !request_.contentLength) return reject(Error::BadRequest);
        if (request_.contentLength > MultipartLimit) return reject(Error::BodyTooLarge);
        request_.multipart = true; phase_ = Phase::Upload; return Result::HeadersReady;
      }
      if (request_.contentLength && !equal(request_.contentType, mediaEnd, "application/x-www-form-urlencoded")) return reject(Error::UnsupportedContentType);
    }
    const size_t bodyLimit = !strcmp(request_.path, "/api/household/control") ? BodyLimit : NormalBodyLimit;
    if (request_.contentLength > bodyLimit) return reject(Error::BodyTooLarge);
    // /update cannot fall through to its commit callback without a framed file.
    if (request_.method == Method::Post && !strcmp(request_.path, "/update")) return reject(Error::UnsupportedContentType);
    phase_ = request_.contentLength ? Phase::Body : Phase::Complete;
    return Result::HeadersReady;
  }
  Result headerLine() {
    if (!lineSize_) return headersFinished();
    if (++headerCount_ > HeaderCountLimit) return reject(Error::TooManyHeaders);
    size_t colon = 0;
    while (colon < lineSize_ && line_[colon] != ':') {
      if (!tokenCharacter(uint8_t(line_[colon]))) return reject(Error::BadRequest);
      ++colon;
    }
    if (!colon || colon == lineSize_) return reject(Error::BadRequest);
    size_t begin = colon + 1, end = lineSize_;
    while (begin < end && (line_[begin] == ' ' || line_[begin] == '\t')) ++begin;
    while (end > begin && (line_[end - 1] == ' ' || line_[end - 1] == '\t')) --end;
    const size_t length = end - begin;
    if (equal(line_, colon, "transfer-encoding")) return reject(Error::TransferEncoding);
    if (equal(line_, colon, "content-length")) {
      if (request_.hasContentLength) return reject(Error::DuplicateHeader);
      if (!length) return reject(Error::BadRequest);
      uint32_t value = 0;
      for (size_t i = begin; i < end; ++i) {
        if (line_[i] < '0' || line_[i] > '9') return reject(Error::BadRequest);
        const uint32_t digit = uint32_t(line_[i] - '0');
        if (value > (UINT32_MAX - digit) / 10) return reject(Error::BadRequest);
        value = value * 10 + digit;
      }
      request_.contentLength = value; request_.hasContentLength = true;
    } else if (equal(line_, colon, "authorization")) {
      if (seenAuthorization_) return reject(Error::DuplicateHeader);
      seenAuthorization_ = true;
      if (!copy(request_.authorization, sizeof(request_.authorization), line_ + begin, length)) return reject(Error::HeaderLineTooLong);
    } else if (equal(line_, colon, "x-lamp-token")) {
      if (seenToken_) return reject(Error::DuplicateHeader);
      seenToken_ = true;
      if (!copy(request_.token, sizeof(request_.token), line_ + begin, length)) return reject(Error::HeaderLineTooLong);
    } else if (equal(line_, colon, "content-type")) {
      if (seenType_) return reject(Error::DuplicateHeader);
      seenType_ = true;
      if (!copy(request_.contentType, sizeof(request_.contentType), line_ + begin, length)) return reject(Error::HeaderLineTooLong);
    }
    return Result::More;
  }
public:
  static constexpr size_t StorageCapacity = StorageBytes;
  BasicParser() = default;
  ~BasicParser() { clear(); }
  BasicParser(const BasicParser&) = delete;
  BasicParser& operator=(const BasicParser&) = delete;
  void clear() {
    // External storage remains caller-owned. Wipe it before reset/destruction;
    // the server frees that exact allocation once after the parser is deleted.
    if(body_ != reinterpret_cast<uint8_t*>(work_))wipe(body_,bodyCapacity_);
    wipe(&request_, sizeof(request_)); wipe(work_, sizeof(work_));
    body_=reinterpret_cast<uint8_t*>(work_);bodyCapacity_=StorageBytes;
    lineSize_ = bodySize_ = headerBytes_ = headerCount_ = 0;
    phase_ = Phase::RequestLine; error_ = Error::None;
    carriage_ = seenAuthorization_ = seenToken_ = seenType_ = false;
  }
  void reset() { clear(); }
  Phase phase() const { return phase_; }
  Error error() const { return error_; }
  const Request& request() const { return request_; }
  const uint8_t* body() const { return body_; }
  size_t bodySize() const { return bodySize_; }
  size_t headerBytes() const { return headerBytes_; }
  bool bodyStorageNeeded() const {
    return phase_==Phase::Body && size_t(request_.contentLength)+1>bodyCapacity_;
  }
  bool attachBody(uint8_t* memory,size_t capacity) {
    if(!memory||!bodyStorageNeeded()||bodySize_||capacity!=size_t(request_.contentLength)+1||capacity>BodyLimit+1)return false;
    wipe(memory,capacity);body_=memory;bodyCapacity_=capacity;return true;
  }
  Result feed(uint8_t byte) {
    if (phase_ == Phase::Failed) return Result::Rejected;
    if (phase_ == Phase::Complete || phase_ == Phase::Upload) return reject(Error::BadRequest);
    if (phase_ == Phase::Body) {
      if(bodyStorageNeeded())return reject(Error::BodyStorageUnavailable);
      if (!byte || bodySize_ >= BodyLimit) return reject(Error::BadRequest);
      body_[bodySize_++] = byte;
      if (bodySize_ == request_.contentLength) { body_[bodySize_] = 0; phase_ = Phase::Complete; return Result::Complete; }
      return Result::More;
    }
    if (phase_ == Phase::Headers && ++headerBytes_ > HeaderBytesLimit) return reject(Error::HeadersTooLarge);
    if (carriage_) {
      carriage_ = false;
      if (byte != '\n') return reject(Error::BadRequest);
      line_[lineSize_] = 0;
      const Result result = phase_ == Phase::RequestLine ? requestLine() : headerLine();
      wipe(line_, lineSize_); lineSize_ = 0; return result;
    }
    if (byte == '\r') { carriage_ = true; return Result::More; }
    if (byte == '\n' || byte == 0 || byte == 127 || (byte < 32 && (phase_ == Phase::RequestLine || byte != '\t'))) return reject(Error::BadRequest);
    const size_t limit = phase_ == Phase::RequestLine ? RequestLineLimit : HeaderLineLimit;
    if (lineSize_ >= limit) return reject(phase_ == Phase::RequestLine ? Error::RequestLineTooLong : Error::HeaderLineTooLong);
    line_[lineSize_++] = char(byte); return Result::More;
  }
};
// The original full parser stays allocation-free for pure host tests and
// callers with fixed storage. Live sockets retain only header scratch and
// attach an exact validated body buffer when a larger form actually arrives.
using Parser = BasicParser<BodyLimit + 1>;
using CompactParser = BasicParser<HeaderLineLimit + 1>;
} // namespace LampHttpParser
