#include "LampHttpMultipart.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>
#include <cstdlib>
#include <new>
#include <algorithm>

static size_t allocations = 0;
void* operator new(std::size_t size) { ++allocations; if (void* p = std::malloc(size)) return p; throw std::bad_alloc(); }
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }
using namespace LampHttpMultipart;

static std::string envelope(const std::string& payload, const std::string& boundary = "----WebKitFormBoundaryCoolLamp123", const std::string& headers = "Content-Disposition: form-data; name=\"firmware\"; filename=\"CoolLamp.ino.bin\"\r\nContent-Type: application/octet-stream\r\n") {
  return "--" + boundary + "\r\n" + headers + "\r\n" + payload + "\r\n--" + boundary + "--\r\n";
}
struct Capture {
  unsigned starts = 0, chunks = 0, completes = 0, failures = 0;
  std::string data;
  void event(Parser& parser, Event result) {
    if (result == Event::Start) { ++starts; assert(!parser.complete()); }
    if (result == Event::Chunk) {
      ++chunks; assert(parser.chunkSize() && parser.chunkSize() <= ChunkBytes);
      data.append(reinterpret_cast<const char*>(parser.chunk()), parser.chunkSize());
      const size_t used = parser.chunkSize(); const auto before = allocations; parser.consumeChunk();
      assert(allocations == before);
      assert(parser.chunkSize() == 0);
      for (size_t i = 0; i < used; ++i) assert(parser.chunk()[i] == 0);
    }
    if (result == Event::Complete) { ++completes; assert(parser.complete() && parser.chunkSize() == 0); }
    if (result == Event::Failed) { ++failures; assert(!parser.complete()); }
  }
};
static bool feed(Parser& parser, Capture& capture, const std::string& data, size_t first = 0, size_t last = SIZE_MAX) {
  last = std::min(last, data.size());
  for (size_t i = first; i < last; ++i) {
    const auto before = allocations; const auto event = parser.feed(uint8_t(data[i]));
    assert(allocations == before); capture.event(parser, event);
    if (event == Event::Failed) return false;
  }
  return true;
}
static void denied(const std::string& wire, const std::string& boundary = "b") {
  Parser parser; parser.reset(boundary.c_str()); Capture capture;
  assert(!feed(parser, capture, wire)); assert(capture.failures == 1 && capture.completes == 0);
  assert(parser.feed(0) == Event::Failed && !parser.complete());
}
static void cancelled(const Parser& parser) {
  Parser reference; reference.reset("");
  assert(!parser.complete() && !parser.name()[0] && !parser.filename()[0] && !parser.chunkSize());
  for (size_t i = 0; i < ChunkBytes; ++i) assert(parser.chunk()[i] == 0);
  // reset("") is the transport's abandon/cancel path. Wiping the entire
  // object includes buffered private image bytes, metadata and scratch tail.
  assert(!std::memcmp(&parser, &reference, sizeof(Parser)));
}
static std::string disposition(const std::string& name = "firmware", const std::string& filename = "CoolLamp.ino.bin") {
  return "Content-Disposition: form-data; name=\"" + name + "\"; filename=\"" + filename + "\"\r\n";
}

int main() {
  // Baseline browser FormData contract and exact binary contents, including
  // every byte value. Pause/resume at every byte boundary uses one parser.
  std::string payload;
  for (unsigned n = 0; n < 1300; ++n) payload += char(n & 255);
  const std::string boundary = "----WebKitFormBoundaryCoolLamp123";
  const auto wire = envelope(payload);
  for (size_t split = 0; split <= wire.size(); ++split) {
    Parser parser; parser.reset(boundary.c_str()); Capture capture;
    assert(feed(parser, capture, wire, 0, split));
    if (split < wire.size()) assert(!parser.complete() && capture.completes == 0);
    assert(feed(parser, capture, wire, split));
    assert(parser.complete() && capture.starts == 1 && capture.completes == 1);
    assert(capture.data == payload && capture.chunks == 3);
    assert(!std::strcmp(parser.name(), "firmware") && !std::strcmp(parser.filename(), "CoolLamp.ino.bin"));
    assert(parser.feed('X') == Event::Failed); // Trailing epilogue cannot commit twice.
    cancelled(parser);
    Parser interrupted; interrupted.reset(boundary.c_str()); Capture partial;
    assert(feed(interrupted, partial, wire, 0, split));
    const auto before = allocations; interrupted.reset("");
    assert(allocations == before); cancelled(interrupted);
    assert(interrupted.feed('X') == Event::Failed); // Cancellation never resumes an earlier artifact.
  }

  // Missing name must not match the substring inside filename.
  denied(envelope("x", "b", "Content-Disposition: form-data; filename=\"secret.bin\"\r\n"));
  denied(envelope("x", "b", "Content-Disposition: not-form-data; name=\"firmware\"; filename=\"f.bin\"\r\n"));

  // Delimiter lookalikes inside a binary image must survive byte for byte.
  for (const std::string& suffix : {std::string("X"), std::string("-x"), std::string("--x"), std::string("--\rX"), std::string(""), std::string("-"), std::string("--"), std::string("--\r")}) {
    for (const std::string& ending : {std::string(), std::string("tail")}) {
      // These two suffixes join the envelope's CRLF to become actual MIME
      // delimiters. Such a payload requires the browser to choose a boundary
      // that does not collide; it is not a binary delimiter lookalike.
      if(ending.empty() && (suffix.empty() || suffix == "--"))continue;
      const auto binary = std::string("head\0", 5) + "\r\n--b" + suffix + ending;
      Parser parser; parser.reset("b"); Capture capture;
      assert(feed(parser, capture, envelope(binary, "b")));
      assert(parser.complete() && capture.data == binary && capture.completes == 1);
    }
  }

  // Every truncation boundary must leave the receiver uncommitted. Refeeding
  // later bytes is permitted only on the same still-live parser; cancel wipes.
  for (size_t last = 0; last < wire.size(); ++last) {
    Parser parser; parser.reset(boundary.c_str()); Capture capture;
    assert(feed(parser, capture, wire, 0, last));
    assert(!parser.complete() && capture.completes == 0);
    parser.reset(""); cancelled(parser);
  }
  for (const std::string& close : {std::string(""), std::string("-"), std::string("--"), std::string("--\r"), std::string("--\n"), std::string("--X\r\n"), std::string("-\r\n"), std::string("--\rX")}) {
    auto incomplete = envelope("abc", "b"); incomplete.resize(incomplete.size() - 4); incomplete += close;
    Parser parser; parser.reset("b"); Capture capture;
    feed(parser, capture, incomplete);
    assert(!parser.complete() && capture.completes == 0);
  }
  denied(envelope("abc\r\n--b\r\nContent-Disposition: form-data; name=\"second\"; filename=\"x.bin\"\r\n\r\ndef", "b"));
  denied(envelope("x", "b", "Content-Disposition: form-data; name=\"firmware\"\r\n"));
  denied(envelope("x", "b", "Content-Disposition: form-data; notname=\"firmware\"; filename=\"f.bin\"\r\n"));
  denied(envelope("x", "b", "Content-Disposition: form-data; name=\"firmware\"; name=\"other\"; filename=\"f.bin\"\r\n"));
  denied(envelope("x", "b", "Content-Disposition: form-data; name=\"firmware\"; filename=\"f.bin\"; filename=\"g.bin\"\r\n"));
  denied(envelope("x", "b", "Content-Disposition: form-data; name=firmware; filename=\"f.bin\"\r\n"));
  denied(envelope("x", "b", "Content-Disposition: form-data; name=\"\"; filename=\"f.bin\"\r\n"));
  denied(envelope("x", "b", "Content-Disposition: form-data; name=\"firmware\"; filename=\"\"\r\n"));
  denied(envelope("x", "b", "Content-Disposition: form-dataX; name=\"firmware\"; filename=\"f.bin\"\r\n"));
  denied(envelope("x", "b", "Content-Disposition: form-data; name=\"firmware\"; filename=\"f.bin\" junk\r\n"));
  denied(envelope("x", "b", disposition() + disposition()));
  denied(envelope("x", "b", disposition() + "Content-Type: application/octet-stream\r\nContent-Type: application/octet-stream\r\n"));
  denied(envelope("x", "b", disposition() + "Content-Type: \r\n"));
  denied(envelope("x", "b", disposition() + "X-Unbounded: data\r\n"));
  denied(envelope("x", "b", disposition() + " Content-Type: application/octet-stream\r\n"));
  denied(envelope("x", "b", disposition() + "Content-Type: application\rbad\r\n"));
  denied(envelope("x", "b", disposition("bad\\name")));
  denied(envelope("x", "b", disposition("bad\tname")));
  denied(envelope("x", "b", disposition("bad\rname")));
  denied(envelope("x", "b", disposition(std::string("bad\0name", 8))));
  denied(envelope("x", "b", disposition(std::string("bad\x7fname", 8))));
  denied(envelope("x", "b", disposition(std::string(NameBytes + 1, 'n'))));
  denied(envelope("x", "b", disposition("firmware", std::string(FilenameBytes + 1, 'f'))));
  denied("--b\n" + disposition() + "\r\nx\r\n--b--\r\n");
  denied(envelope("x", "b"), "wrong");

  // Standard browsers send filename first or mixed-case headers too. Preserve
  // quoted values, spaces, UTF-8 bytes and exact maximum metadata lengths.
  for (const auto& headers : {
       std::string("cOnTeNt-DiSpOsItIoN: FoRm-DaTa; FILENAME = \"lamp update.bin\"; NAME = \"firmware\"\r\ncOnTeNt-TyPe: application/octet-stream\r\n"),
       disposition(std::string(NameBytes, 'n'), std::string(FilenameBytes, 'f')),
       disposition("firmware", std::string("lamp-") + char(0xc3) + char(0xa9) + ".bin"),
       disposition() + "Content-Type: " + std::string(LineBytes - 16, 't') + "\r\n"}) {
    Parser parser; parser.reset("b"); Capture capture;
    assert(feed(parser, capture, envelope("payload", "b", headers)));
    assert(parser.complete() && capture.data == "payload");
  }
  denied(envelope("x", "b", disposition() + "Content-Type: " + std::string(LineBytes - 15, 't') + "\r\n"));
  denied(envelope("x", "b", disposition() + std::string(HeaderBytes + 1, 'h') + "\r\n"));
  denied(envelope("x", "b", disposition() + std::string(HeaderCount + 1, '\n')));
  for (const auto& invalid : {std::string(), std::string(BoundaryBytes + 1, 'b'), std::string("bad boundary"), std::string("bad;boundary"), std::string("bad\r\n"), std::string("bad\\boundary")}) {
    Parser parser; const auto before = allocations; parser.reset(invalid.c_str());
    assert(allocations == before && parser.feed('-') == Event::Failed); cancelled(parser);
  }
  { Parser parser; assert(parser.feed('-') == Event::Failed); parser.reset(nullptr); cancelled(parser); }

  // Delimiters and lookalikes placed beside every chunk alignment, including
  // complete 512-byte writes, last-byte tails, and the 70-byte boundary.
  for (const std::string& testBoundary : {std::string("b"), std::string(BoundaryBytes, 'a')}) {
    for (size_t size : {size_t(0), size_t(1), size_t(2), size_t(511), size_t(512), size_t(513), size_t(1023), size_t(1024), size_t(1025), size_t(32768)}) {
      std::string binary(size, char(0xe9));
      if (size > 20) for (size_t offset : {size_t(0), size / 2, size - 1}) binary.insert(offset, "\r\n--" + testBoundary + "--\rX");
      Parser parser; parser.reset(testBoundary.c_str()); Capture capture;
      assert(feed(parser, capture, envelope(binary, testBoundary)));
      assert(parser.complete() && capture.data == binary);
      const size_t minimumChunks = (binary.size() + ChunkBytes - 1) / ChunkBytes;
      assert(capture.chunks >= minimumChunks && capture.chunks <= minimumChunks + 3);
    }
    // One feed call per byte of a real OTA-slot-sized image exercises streaming
    // with constant parser storage rather than retaining the image in firmware.
    const std::string binary(2031616, char(0xe9));
    Parser parser; parser.reset(testBoundary.c_str()); Capture capture;
    assert(feed(parser, capture, envelope(binary, testBoundary)));
    assert(parser.complete() && capture.data == binary);
  }
  for (size_t padding = 0; padding <= 2 * ChunkBytes; ++padding) {
    const auto binary = std::string(padding, 'x') + "\r\n--b--\r\r\n--b--\rX\r\n--bX";
    Parser parser; parser.reset("b"); Capture capture;
    assert(feed(parser, capture, envelope(binary, "b")));
    assert(parser.complete() && capture.data == binary);
  }

  // A caller that ignores an emitted full chunk cannot overrun its buffer.
  {
    Parser parser; parser.reset("b"); const auto stream = envelope(std::string(1024, 'x'), "b");
    bool full = false;
    for (uint8_t byte : stream) if (parser.feed(byte) == Event::Chunk) { full = true; break; }
    assert(full && parser.chunkSize() == ChunkBytes);
    assert(parser.feed('x') == Event::Failed); cancelled(parser);
  }

  // Bounded random bytes with surrounding canaries use the production parser.
  struct Guarded { uint32_t before = 0x11223344; Parser parser; uint32_t after = 0x55667788; } guarded;
  uint32_t random = 0x12345678;
  const std::string dataPrefix = "--b\r\n" + disposition() + "\r\n";
  const auto before = allocations;
  for (unsigned trial = 0; trial < 3000; ++trial) {
    guarded.parser.reset("b");
    if (trial & 1) for (uint8_t c : dataPrefix) assert(guarded.parser.feed(c) != Event::Failed);
    for (unsigned i = 0; i < 2048; ++i) {
      random = random * 1664525 + 1013904223;
      const auto event = guarded.parser.feed(uint8_t(random >> 24));
      if (event == Event::Chunk) guarded.parser.consumeChunk();
      if (event == Event::Failed) break;
    }
    assert(guarded.before == 0x11223344 && guarded.after == 0x55667788);
    guarded.parser.reset(""); cancelled(guarded.parser);
  }
  assert(allocations == before);
  alignas(Parser) uint8_t storage[sizeof(Parser)]{};
  auto* destroyed = new(storage) Parser; destroyed->reset("b");
  Capture capture; assert(feed(*destroyed, capture, envelope("private-image-canary", "b"), 0, envelope("private-image-canary", "b").size() - 5));
  destroyed->~Parser(); Parser reference; reference.reset("");
  assert(!std::memcmp(storage, &reference, sizeof(Parser)));
  static_assert(sizeof(Parser) <= 1320, "Keep browser streaming parser bounded");
  std::cout << "PASS production multipart: every interruption/cancel, browser FormData, exact binary/chunks/tails/false delimiters, malformed/truncated/multi-part, disposition/metadata bounds, slot-size stream, wipe/destructor, no heap/canaries; parserBytes=" << sizeof(Parser) << '\n';
}
