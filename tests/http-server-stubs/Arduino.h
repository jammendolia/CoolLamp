#pragma once
#include <cstdint>
#include <cstring>
#include <string>
#include <type_traits>
#include <cctype>
#include <cassert>
#define PROGMEM
inline bool fakeStringReserveFailure=false;
inline size_t fakeStringReserveCalls=0;
inline uint32_t fakeFreeHeap=65536;
inline uint32_t fakeLargestFreeBlock=65536;
inline size_t fakeStringWatchReserveBytes=0,fakeStringWipedWatched=0;
inline const char* fakeStringWatchedStorage=nullptr;
[[maybe_unused]] inline struct {uint32_t getFreeHeap()const{return fakeFreeHeap;}uint32_t getMaxAllocHeap()const{return fakeLargestFreeBlock<fakeFreeHeap?fakeLargestFreeBlock:fakeFreeHeap;}} ESP;
struct String : std::string {
  using std::string::string;
  using std::string::operator=;
  String(const std::string& value) : std::string(value) {}
  String(std::string&& value) : std::string(std::move(value)) {}
  String& operator=(const char* value) {
    if (value) std::string::operator=(value);
    else {
      if(data()==fakeStringWatchedStorage){for(size_t n=0;n<size();++n)assert(!data()[n]);++fakeStringWipedWatched;fakeStringWatchedStorage=nullptr;}
      std::string empty; empty.swap(*this);
    }
    return *this;
  }
  template<class T, typename std::enable_if<std::is_integral<T>::value, int>::type = 0>
  String(T value) : std::string(std::to_string(value)) {}
  bool isEmpty() const { return empty(); }
  bool reserve(size_t size) { ++fakeStringReserveCalls;if(fakeStringReserveFailure)return false;std::string::reserve(size);if(size&&size==fakeStringWatchReserveBytes)fakeStringWatchedStorage=data();return true; }
  bool concat(char value) { push_back(value); return true; }
  bool concat(const char* value, size_t size) { append(value, size); return true; }
  int indexOf(char value) const { const auto at = find(value); return at == npos ? -1 : int(at); }
  void trim() { while (!empty() && std::isspace(uint8_t(front()))) erase(begin()); while (!empty() && std::isspace(uint8_t(back()))) pop_back(); }
};
inline size_t strlcpy(char* target, const char* source, size_t capacity) {
  const size_t size = strlen(source);
  if (capacity) { const size_t copy = size < capacity - 1 ? size : capacity - 1; memcpy(target, source, copy); target[copy] = 0; }
  return size;
}
uint32_t millis();
uint32_t micros();
