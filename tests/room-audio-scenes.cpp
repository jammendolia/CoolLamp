#include "../LampGroupScenes.h"
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <set>
#include <string>

using LampGroupScenes::RGB;
using LampSyncWire::Visual;

// Adding scenes must not grow a frame or change the version-2 wire layout.
static_assert(sizeof(Visual) == 83, "Keep the existing group visual layout");
static_assert(sizeof(LampSyncWire::Packet) == 226, "Keep the existing group packet layout");

namespace {
constexpr unsigned FirstScene = 19, LastScene = 26;
constexpr uint8_t RoomBrightness = 55;
struct Geometry { uint16_t leds, midpoint; };
constexpr std::array<Geometry, 8> Geometries{{
    {205, 102}, {134, 0}, {11, 10}, {7, 1}, {5, 2}, {3, 1}, {2, 1}, {1, 0}
}};
enum class Input { Quiet, Bass, Treble, Beat, Dropout, Maximum, Weak };
constexpr std::array<Input, 7> Inputs{{
    Input::Quiet, Input::Bass, Input::Treble, Input::Beat,
    Input::Dropout, Input::Maximum, Input::Weak
}};

void require(bool okay, const std::string& message) {
    if (!okay) { std::cerr << "FAIL: " << message << '\n'; std::exit(1); }
}
bool equal(RGB a, RGB b) { return a.r == b.r && a.g == b.g && a.b == b.b; }
unsigned energy(RGB c) { return unsigned(c.r) + c.g + c.b; }
unsigned peak(RGB c) { return std::max({unsigned(c.r), unsigned(c.g), unsigned(c.b)}); }
RGB roomPixel(const Visual& v, uint16_t h, uint32_t now) {
    const RGB c = LampGroupScenes::pixel(v, h, now);
    return {uint8_t(unsigned(c.r) * RoomBrightness / 255),
            uint8_t(unsigned(c.g) * RoomBrightness / 255),
            uint8_t(unsigned(c.b) * RoomBrightness / 255)};
}
uint64_t accumulate(uint64_t signature, RGB c) {
    return (signature ^ (uint32_t(c.r) << 16 | uint32_t(c.g) << 8 | c.b)) * 1099511628211ULL;
}
Visual scene(unsigned id, unsigned count = 3, unsigned position = 0) {
    Visual v{};
    v.scene = id; v.count = count; v.position = position;
    v.sceneSpeed = 60; v.sceneIntensity = 85; v.groupStart = 1000;
    v.scenePrimary[0] = 70; v.scenePrimary[1] = 220; v.scenePrimary[2] = 255;
    v.sceneSecondary[0] = 255; v.sceneSecondary[1] = 65; v.sceneSecondary[2] = 170;
    v.mode = 46; v.brightness = RoomBrightness; v.power = 1;
    v.speed = 60; v.intensity = 85;
    return v;
}
void signal(Visual& v, Input input, uint32_t elapsed) {
    // The last shared beat is 0..749 ms old. Audio-invalid frames deliberately
    // retain stale features, as a dropped microphone stream can in real frames.
    v.audioValid = input != Input::Dropout;
    v.level = 0; v.bass = v.mid = v.treble = 0;
    v.groupBeat = 0; v.groupBeatLevel = 0;
    v.groupBeatAt = v.groupStart + elapsed - elapsed % 750;
    v.groupMotionAt = v.groupStart;
    v.groupMotion = 0;
    if (input == Input::Quiet) return;
    if (input == Input::Bass) { v.level = 176; v.bass = 46000; }
    if (input == Input::Treble) { v.level = 166; v.treble = 46000; }
    if (input == Input::Beat || input == Input::Dropout) {
        v.level = 245; v.bass = 58000; v.mid = 28000; v.treble = 39000;
    }
    if (input == Input::Maximum) {
        v.level = 255; v.bass = v.mid = v.treble = 65535;
    }
    if (input == Input::Weak) { v.level = 1; v.bass = v.mid = v.treble = 1; }
    v.groupBeat = 7 + elapsed / 750;
    v.groupBeatLevel = input == Input::Weak ? 1 : 255;
}
std::string context(const Visual& v, Geometry g, Input input, uint32_t elapsed) {
    return "scene=" + std::to_string(v.scene) + " lamps=" + std::to_string(v.count) +
        " position=" + std::to_string(v.position) + " leds=" + std::to_string(g.leds) +
        " midpoint=" + std::to_string(g.midpoint) + " speed=" + std::to_string(v.sceneSpeed) +
        " input=" + std::to_string(unsigned(input)) + " elapsed=" + std::to_string(elapsed);
}

void roomCoverage() {
    uint64_t rendered = 0;
    unsigned minimumPeak = 255;
    for (unsigned id = FirstScene; id <= LastScene; ++id)
        for (unsigned count : {2U, 3U, 5U, 9U})
            for (unsigned position = 0; position < count; ++position)
                for (unsigned speed : {1U, 60U, 100U})
                    for (Input input : Inputs)
                        for (uint32_t elapsed = 0; elapsed <= 18000; elapsed += 431)
                            for (Geometry g : Geometries) {
                                Visual v = scene(id, count, position); v.sceneSpeed = speed;
                                signal(v, input, elapsed);
                                unsigned lit = 0, brightest = 0;
                                for (uint16_t led = 0; led < g.leds; ++led) {
                                    const auto h = LampGroupScenes::height(led, g.leds, g.midpoint);
                                    const auto c = roomPixel(v, h, v.groupStart + elapsed);
                                    lit += energy(c) != 0; brightest = std::max(brightest, peak(c));
                                    ++rendered;
                                }
                                const auto where = context(v, g, input, elapsed);
                                require(lit == g.leds, "room wash left LEDs unlit: " + where);
                                require(brightest >= 3, "room wash too faint at brightness 55: " + where);
                                minimumPeak = std::min(minimumPeak, brightest);
                            }
    std::cout << "Coverage: " << rendered << " physical LED samples, 100% lit, minimum lamp peak "
              << minimumPeak << "/255 at brightness 55 and intensity 85\n";
}

void invalidInputCannotInventBeats() {
    for (unsigned id = FirstScene; id <= LastScene; ++id)
        for (unsigned count : {2U, 3U, 5U, 9U})
            for (unsigned position = 0; position < count; ++position)
                for (uint32_t elapsed = 0; elapsed < 12000; elapsed += 137) {
                    auto stale = scene(id, count, position); signal(stale, Input::Dropout, elapsed);
                    auto empty = stale;
                    empty.level = 0; empty.bass = empty.mid = empty.treble = 0;
                    empty.groupBeat = 0; empty.groupBeatLevel = 0; empty.groupBeatAt = 0;
                    for (uint32_t h = 0; h <= 65535; h += 4095) {
                        const auto a = LampGroupScenes::pixel(stale, h, stale.groupStart + elapsed);
                        const auto b = LampGroupScenes::pixel(empty, h, empty.groupStart + elapsed);
                        require(equal(a, b), "invalid audio used stale features in scene " + std::to_string(id));
                    }
                }
}

void beatAndSilenceBoundaries() {
    for (unsigned id = FirstScene; id <= LastScene; ++id)
        for (unsigned count : {2U, 3U, 5U, 9U})
            for (unsigned position = 0; position < count; ++position)
                for (unsigned speed : {1U, 100U}) {
                    auto v = scene(id, count, position); v.sceneSpeed = speed;
                    signal(v, Input::Beat, 10000);
                    const uint32_t now = v.groupStart + 10000, leg = 2200 - speed * 16;
                    // Valid quiet audio must ignore leftover band/beat values too.
                    auto silentStale = v; silentStale.level = 0;
                    auto silentEmpty = silentStale;
                    silentEmpty.bass = silentEmpty.mid = silentEmpty.treble = 0;
                    silentEmpty.groupBeat = 0; silentEmpty.groupBeatLevel = 0; silentEmpty.groupBeatAt = 0;
                    for (uint16_t h : {uint16_t(0), uint16_t(8191), uint16_t(32768), uint16_t(65535)}) {
                        require(equal(LampGroupScenes::pixel(silentStale, h, now),
                                      LampGroupScenes::pixel(silentEmpty, h, now)),
                                "level-zero input used stale features in scene " + std::to_string(id));
                        for (uint32_t beatAt : {now + 1, now + 5000, now - 2 * leg, now - 10 * leg}) {
                            auto withBeat = v; withBeat.groupBeatAt = beatAt;
                            auto noBeat = withBeat; noBeat.groupBeatLevel = 0;
                            require(equal(LampGroupScenes::pixel(withBeat, h, now),
                                          LampGroupScenes::pixel(noBeat, h, now)),
                                    "future/expired beat caused a pulse in scene " + std::to_string(id));
                        }
                        // A valid level without spectral/beat features is a real
                        // intermediate state, and must still keep its lamp lit.
                        auto noBands = v;
                        noBands.bass = noBands.mid = noBands.treble = 0;
                        noBands.groupBeatLevel = 0;
                        require(energy(roomPixel(noBands, h, now)) != 0, "missing spectral bins blanked a lamp");
                    }
                }
}

void signaturesAndAudioSensitivity() {
    std::set<uint64_t> allScenes;
    for (unsigned id = FirstScene; id <= LastScene; ++id) {
        uint64_t quietSignature = 1469598103934665603ULL, musicSignature = quietSignature;
        for (unsigned position = 0; position < 5; ++position)
            for (uint32_t elapsed = 0; elapsed < 22000; elapsed += 137) {
                auto quiet = scene(id, 5, position); signal(quiet, Input::Quiet, elapsed);
                auto music = quiet; signal(music, Input::Beat, elapsed);
                for (uint32_t h = 0; h <= 65535; h += 4095) {
                    const auto a = LampGroupScenes::pixel(quiet, h, quiet.groupStart + elapsed);
                    const auto b = LampGroupScenes::pixel(music, h, music.groupStart + elapsed);
                    require(equal(b, LampGroupScenes::pixel(music, h, music.groupStart + elapsed)),
                            "renderer is not deterministic in scene " + std::to_string(id));
                    quietSignature = accumulate(quietSignature, a);
                    musicSignature = accumulate(musicSignature, b);
                }
            }
        require(quietSignature != musicSignature, "scene ignores audio: " + std::to_string(id));
        require(allScenes.insert(musicSignature).second, "new scenes have identical room signatures");
    }
}

void boundariesAndRollover() {
    for (unsigned id = FirstScene; id <= LastScene; ++id)
        for (unsigned count : {2U, 3U, 5U, 9U})
            for (unsigned position = 0; position < count; ++position)
                for (unsigned intensity : {0U, 1U, 85U, 100U})
                    for (unsigned speed : {1U, 100U})
                        for (uint32_t elapsed : {0U, 1U, 127U, 255U, 256U, 750U, 3000U, 90000U,
                                                 0x3fffffffU, 0x40000000U, 0x7ffffffeU}) {
                            auto v = scene(id, count, position); v.sceneIntensity = intensity; v.sceneSpeed = speed;
                            signal(v, Input::Maximum, elapsed);
                            require(LampSyncWire::validVisual(v), "new scene is rejected by wire validation");
                            auto wrapped = v;
                            const uint32_t displacement = 0xffffff00U - v.groupStart;
                            wrapped.groupStart += displacement;
                            wrapped.groupBeatAt += displacement;
                            wrapped.groupMotionAt += displacement;
                            for (uint16_t h : {uint16_t(0), uint16_t(1), uint16_t(32768), uint16_t(65535)}) {
                                const auto normal = LampGroupScenes::pixel(v, h, v.groupStart + elapsed);
                                const auto rollover = LampGroupScenes::pixel(wrapped, h, wrapped.groupStart + elapsed);
                                require(equal(normal, rollover), "absolute clock affects scene " + std::to_string(id));
                                require(intensity || !energy(normal), "zero intensity remains lit");
                                require(peak(normal) <= 255 * intensity / 100, "scene exceeds its intensity bound");
                                require(!energy(LampGroupScenes::pixel(v, h, v.groupStart - 1)), "future start is lit");
                                auto black = v;
                                std::fill(std::begin(black.scenePrimary), std::end(black.scenePrimary), 0);
                                std::fill(std::begin(black.sceneSecondary), std::end(black.sceneSecondary), 0);
                                require(!energy(LampGroupScenes::pixel(black, h, black.groupStart + elapsed)),
                                        "explicit black palette is not respected");
                            }
                        }
    for (unsigned id = FirstScene; id <= LastScene; ++id) {
        auto v = scene(id); signal(v, Input::Maximum, 1000);
        for (uint32_t beat : {0U, 1U, 0xfffffff0U, 0xffffffffU}) {
            v.groupBeat = beat;
            for (uint16_t h : {uint16_t(0), uint16_t(8191), uint16_t(32768), uint16_t(65535)}) {
                const auto a = LampGroupScenes::pixel(v, h, 2000);
                require(equal(a, LampGroupScenes::pixel(v, h, 2000)), "beat counter extremes are not deterministic");
                require(energy(a) != 0 && peak(a) <= 255 * v.sceneIntensity / 100,
                        "beat counter extremes violate visibility/intensity bounds");
            }
        }
        for (unsigned count : {0U, 1U, unsigned(LampSyncWire::MaxMembers)+1U}) {
            v.count = count; require(!energy(LampGroupScenes::pixel(v, 32768, 2000)), "invalid group count is lit");
        }
        v.count = 3; v.position = 3;
        require(!energy(LampGroupScenes::pixel(v, 32768, 2000)), "out-of-range member is lit");
    }
}
} // namespace

int main() {
    roomCoverage();
    invalidInputCannotInventBeats();
    beatAndSilenceBoundaries();
    signaturesAndAudioSensitivity();
    boundariesAndRollover();
    std::cout << "PASS: eight audio room scenes fill every lamp through silence/dropouts, distinct music responses, "
                 "invalid-input gating, asymmetrical and short geometry, bounds and clock rollover\n";
}
