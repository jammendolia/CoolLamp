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

static_assert(sizeof(Visual) == 83, "New scenes keep the existing visual packet");
static_assert(sizeof(LampSyncWire::Packet) == 226, "New scenes keep the existing wire format");

namespace {
constexpr unsigned FirstScene = 27, LastScene = 32;
struct Geometry { uint16_t count, midpoint; };
constexpr std::array<Geometry, 9> Geometries{{
    {134, 0}, {134, 32}, {205, 102}, {11, 10}, {7, 1}, {5, 2}, {3, 1}, {2, 1}, {1, 0}
}};
enum class Input { Quiet, Bass, Mid, Treble, Beat, Dropout, Maximum, Weak };
constexpr std::array<Input, 8> Inputs{{
    Input::Quiet, Input::Bass, Input::Mid, Input::Treble,
    Input::Beat, Input::Dropout, Input::Maximum, Input::Weak
}};

void require(bool okay, const std::string& message) {
    if (!okay) { std::cerr << "FAIL: " << message << '\n'; std::exit(1); }
}
bool equal(RGB a, RGB b) { return a.r == b.r && a.g == b.g && a.b == b.b; }
unsigned energy(RGB c) { return unsigned(c.r) + c.g + c.b; }
unsigned peak(RGB c) { return std::max({unsigned(c.r), unsigned(c.g), unsigned(c.b)}); }
RGB dim(RGB c, unsigned brightness) {
    return {uint8_t(unsigned(c.r) * brightness / 255),
            uint8_t(unsigned(c.g) * brightness / 255),
            uint8_t(unsigned(c.b) * brightness / 255)};
}
uint64_t accumulate(uint64_t hash, RGB c) {
    return (hash ^ (uint32_t(c.r) << 16 | uint32_t(c.g) << 8 | c.b)) * 1099511628211ULL;
}
Visual scene(unsigned id, unsigned count = 3, unsigned position = 0) {
    Visual v{};
    v.scene = id; v.count = count; v.position = position;
    v.sceneSpeed = 60; v.sceneIntensity = 85; v.groupStart = 1000;
    v.scenePrimary[0] = 70; v.scenePrimary[1] = 220; v.scenePrimary[2] = 255;
    v.sceneSecondary[0] = 255; v.sceneSecondary[1] = 65; v.sceneSecondary[2] = 170;
    v.mode = 46; v.brightness = 55; v.power = 1; v.speed = 60; v.intensity = 85;
    return v;
}
void signal(Visual& v, Input input, uint32_t elapsed) {
    v.audioValid = input != Input::Dropout;
    v.level = 0; v.bass = v.mid = v.treble = 0;
    v.groupBeat = 0; v.groupBeatLevel = 0;
    v.groupBeatAt = v.groupStart + elapsed - elapsed % 750;
    v.groupMotionAt = v.groupStart; v.groupMotion = 0;
    if (input == Input::Quiet) return;
    v.level = 176;
    if (input == Input::Bass) { v.bass = 46000; return; }
    if (input == Input::Mid) { v.mid = 46000; return; }
    if (input == Input::Treble) { v.treble = 46000; return; }
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
std::string context(const Visual& v, uint32_t elapsed) {
    return "scene=" + std::to_string(v.scene) + " count=" + std::to_string(v.count) +
        " position=" + std::to_string(v.position) + " speed=" + std::to_string(v.sceneSpeed) +
        " elapsed=" + std::to_string(elapsed);
}

void existingScenesUnchanged() {
    // Captured from the previously published 0..26 renderer before adding the
    // new branch. Keep this golden fixture independent of new scene formulas.
    uint64_t hash = 1469598103934665603ULL;
    for (unsigned id = 0; id <= 26; ++id)
        for (unsigned count : {2U, 3U, 5U, 9U})
            for (unsigned position = 0; position < count; ++position)
                for (unsigned speed : {1U, 60U, 100U})
                    for (unsigned input : {0U, 1U, 2U})
                        for (uint32_t elapsed : {0U, 101U, 1001U, 4999U, 9019U, 31881U}) {
                            auto v = scene(id, count, position); v.sceneSpeed = speed;
                            v.audioValid = input != 2; v.level = input ? 191 : 0;
                            v.bass = input ? 41000 : 0; v.mid = input ? 12000 : 0; v.treble = input ? 27000 : 0;
                            v.groupBeat = input ? 17 : 0; v.groupBeatLevel = input ? 231 : 0;
                            v.groupBeatAt = v.groupStart + elapsed - elapsed % 750;
                            v.groupMotionAt = v.groupStart; v.groupMotion = 1700;
                            for (uint16_t h : {uint16_t(0), uint16_t(11), uint16_t(4097), uint16_t(16381),
                                              uint16_t(32768), uint16_t(52221), uint16_t(65535)})
                                hash = accumulate(hash, LampGroupScenes::pixel(v, h, v.groupStart + elapsed));
                        }
    require(hash == 17481880130900799249ULL, "existing scenes 0..26 changed");
}

void physicalRoomCoverage() {
    uint64_t samples = 0;
    unsigned minimumPeak = 255;
    for (unsigned id = FirstScene; id <= LastScene; ++id)
        for (unsigned count : {2U, 3U, 5U, 9U})
            for (unsigned position = 0; position < count; ++position)
                for (unsigned speed : {1U, 60U, 100U})
                    for (Input input : Inputs)
                        for (uint32_t elapsed = 0; elapsed <= 24000; elapsed += 487) {
                            auto v = scene(id, count, position); v.sceneSpeed = speed;
                            signal(v, input, elapsed);
                            for (Geometry g : Geometries) {
                                unsigned lit = 0, brightest = 0;
                                for (uint16_t led = 0; led < g.count; ++led) {
                                    const auto h = LampGroupScenes::height(led, g.count, g.midpoint);
                                    const auto c = dim(LampGroupScenes::pixel(v, h, v.groupStart + elapsed), v.brightness);
                                    lit += energy(c) != 0; brightest = std::max(brightest, peak(c)); ++samples;
                                }
                                const auto where = context(v, elapsed) + " leds=" + std::to_string(g.count) +
                                    " midpoint=" + std::to_string(g.midpoint) + " input=" + std::to_string(unsigned(input));
                                require(lit == g.count, "an LED went black: " + where);
                                require(brightest >= 3, "lamp too faint at brightness55/intensity85: " + where);
                                minimumPeak = std::min(minimumPeak, brightest);
                            }
                        }
    std::cout << "Coverage: " << samples << " physical LED samples, all lit; minimum lamp peak "
              << minimumPeak << "/255 at brightness55/intensity85\n";
}

void inputValidity() {
    for (unsigned id = FirstScene; id <= LastScene; ++id)
        for (unsigned count : {2U, 3U, 5U, 9U})
            for (unsigned position = 0; position < count; ++position)
                for (unsigned speed : {1U, 60U, 100U})
                    for (uint32_t elapsed = 0; elapsed < 13000; elapsed += 431) {
                        auto empty = scene(id, count, position); empty.sceneSpeed = speed;
                        signal(empty, Input::Quiet, elapsed);
                        const uint32_t now = empty.groupStart + elapsed;
                        auto stale = empty; signal(stale, Input::Dropout, elapsed);
                        auto levelZero = stale; levelZero.audioValid = 1; levelZero.level = 0;
                        for (uint16_t h : {uint16_t(0), uint16_t(1), uint16_t(8191), uint16_t(32768), uint16_t(65535)}) {
                            const auto expected = LampGroupScenes::pixel(empty, h, now);
                            require(equal(expected, LampGroupScenes::pixel(stale, h, now)),
                                    "invalid audio used stale data: " + context(empty, elapsed));
                            require(equal(expected, LampGroupScenes::pixel(levelZero, h, now)),
                                    "level-zero audio used stale data: " + context(empty, elapsed));
                            if (id <= 28)
                                for (Input input : Inputs) {
                                    auto music = empty; signal(music, input, elapsed);
                                    require(equal(expected, LampGroupScenes::pixel(music, h, now)),
                                            "ambient scene used audio: " + context(empty, elapsed));
                                }
                        }
                        auto music = empty; signal(music, Input::Beat, elapsed);
                        auto noBeat = music;
                        noBeat.groupBeat = 0; noBeat.groupBeatLevel = 0; noBeat.groupBeatAt = 0;
                        // The maximal valid freshness window is 4368 ms at speed1.
                        // Test future beats and expired beats across both clock sides.
                        for (uint32_t beatAt : {now + 1, now + 10000, now - 5000, now - 90000}) {
                            auto invalidBeat = music; invalidBeat.groupBeatAt = beatAt;
                            for (uint16_t h : {uint16_t(0), uint16_t(8191), uint16_t(32768), uint16_t(65535)})
                                require(equal(LampGroupScenes::pixel(noBeat, h, now),
                                              LampGroupScenes::pixel(invalidBeat, h, now)),
                                        "future/expired beat affected pixels: " + context(empty, elapsed));
                        }
                    }
}

void saturatedPaletteCoverage() {
    // A black palette endpoint is a valid artistic choice. The colored endpoint
    // must still produce a visible lamp, including a single physical LED.
    for (unsigned id = FirstScene; id <= LastScene; ++id)
        for (unsigned position = 0; position < 9; ++position)
            for (unsigned endpoint : {0U, 1U})
                for (uint32_t elapsed = 0; elapsed < 19000; elapsed += 137) {
                    auto v = scene(id, 9, position); signal(v, Input::Quiet, elapsed);
                    std::fill(std::begin(v.scenePrimary), std::end(v.scenePrimary), 0);
                    std::fill(std::begin(v.sceneSecondary), std::end(v.sceneSecondary), 0);
                    if (endpoint) v.scenePrimary[0] = 255;
                    else v.sceneSecondary[2] = 255;
                    for (Geometry g : Geometries) {
                        unsigned lit = 0;
                        for (uint16_t led = 0; led < g.count; ++led) {
                            const auto h = LampGroupScenes::height(led, g.count, g.midpoint);
                            lit += energy(dim(LampGroupScenes::pixel(v, h, v.groupStart + elapsed), v.brightness)) != 0;
                        }
                        require(lit != 0, "one black palette endpoint blanked a lamp: " + context(v, elapsed));
                    }
                }
}

uint64_t signature(unsigned id, Input input, uint32_t offset = 0, unsigned speed = 60,
                   unsigned position = 0, unsigned count = 5) {
    uint64_t hash = 1469598103934665603ULL;
    for (uint32_t elapsed = 0; elapsed < 21000; elapsed += 317) {
        auto v = scene(id, count, position); v.sceneSpeed = speed;
        signal(v, input, elapsed + offset);
        for (uint32_t h = 0; h <= 65535; h += 4095) {
            const auto c = LampGroupScenes::pixel(v, h, v.groupStart + elapsed + offset);
            require(equal(c, LampGroupScenes::pixel(v, h, v.groupStart + elapsed + offset)),
                    "nondeterministic pixels in scene " + std::to_string(id));
            hash = accumulate(hash, c);
        }
    }
    return hash;
}

void distinctMotionAndAudio() {
    std::set<uint64_t> scenes;
    for (unsigned id = FirstScene; id <= LastScene; ++id) {
        const auto quiet = signature(id, Input::Quiet);
        const auto music = signature(id, Input::Beat);
        require(scenes.insert(music).second, "two new scenes have identical signatures");
        require(quiet != signature(id, Input::Quiet, 1000), "scene does not animate: " + std::to_string(id));
        require(quiet != signature(id, Input::Quiet, 0, 1), "speed does not change scene: " + std::to_string(id));
        std::set<uint64_t> positions;
        for (unsigned position = 0; position < 5; ++position)
            positions.insert(signature(id, Input::Beat, 0, 60, position));
        require(positions.size() == 5, "group members render the same spatial phase: " + std::to_string(id));
        if (id <= 28) {
            require(quiet == music, "ambient effect is audio dependent");
        } else {
            require(quiet != music, "audio effect ignores music: " + std::to_string(id));
            const std::set<uint64_t> bands{
                signature(id, Input::Bass), signature(id, Input::Mid), signature(id, Input::Treble)
            };
            require(bands.size() == 3, "audio bands collapsed: " + std::to_string(id));
            require(signature(id, Input::Weak) != signature(id, Input::Maximum),
                    "audio energy does not change effect: " + std::to_string(id));
        }
    }
}

void boundariesAndRollover() {
    for (unsigned id = FirstScene; id <= LastScene; ++id)
        for (unsigned count : {2U, 3U, 5U, 9U})
            for (unsigned position = 0; position < count; ++position)
                for (unsigned intensity : {0U, 1U, 85U, 100U})
                    for (unsigned speed : {1U, 60U, 100U})
                        for (uint32_t elapsed : {0U, 1U, 127U, 255U, 256U, 750U, 3000U, 90000U,
                                                 0x3fffffffU, 0x40000000U, 0x7ffffffeU}) {
                            auto v = scene(id, count, position); v.sceneIntensity = intensity; v.sceneSpeed = speed;
                            signal(v, Input::Maximum, elapsed);
                            require(LampSyncWire::validVisual(v), "new scene rejected by protocol");
                            auto rollover = v;
                            const uint32_t displacement = 0xffffff00U - v.groupStart;
                            rollover.groupStart += displacement; rollover.groupBeatAt += displacement;
                            rollover.groupMotionAt += displacement;
                            for (uint16_t h : {uint16_t(0), uint16_t(1), uint16_t(32768), uint16_t(65535)}) {
                                const auto c = LampGroupScenes::pixel(v, h, v.groupStart + elapsed);
                                require(equal(c, LampGroupScenes::pixel(rollover, h, rollover.groupStart + elapsed)),
                                        "clock rollover changed scene: " + context(v, elapsed));
                                require(peak(c) <= 255 * intensity / 100, "scene exceeds intensity bound");
                                require(intensity || !energy(c), "zero intensity remains lit");
                                require(!energy(LampGroupScenes::pixel(v, h, v.groupStart - 1)), "future start remains lit");
                                auto black = v;
                                std::fill(std::begin(black.scenePrimary), std::end(black.scenePrimary), 0);
                                std::fill(std::begin(black.sceneSecondary), std::end(black.sceneSecondary), 0);
                                require(!energy(LampGroupScenes::pixel(black, h, black.groupStart + elapsed)),
                                        "explicit black palette is ignored");
                                auto off = v; off.power = 0;
                                require(!energy(LampGroupScenes::pixel(off, h, off.groupStart + elapsed)), "power off remains lit");
                                off = v; off.brightness = 0;
                                require(!energy(LampGroupScenes::pixel(off, h, off.groupStart + elapsed)), "zero brightness remains lit");
                            }
                        }
    for (unsigned id = FirstScene; id <= LastScene; ++id) {
        auto v = scene(id); signal(v, Input::Maximum, 1000);
        for (unsigned count : {0U, 1U, 10U}) {
            v.count = count; require(!energy(LampGroupScenes::pixel(v, 32768, 2000)), "invalid group count remains lit");
        }
        v.count = 3; v.position = 3;
        require(!energy(LampGroupScenes::pixel(v, 32768, 2000)), "invalid member position remains lit");
        v.position = 0;
        for (uint32_t beat : {0U, 1U, 0xfffffff0U, 0xffffffffU}) {
            v.groupBeat = beat;
            const auto c = LampGroupScenes::pixel(v, 32768, 2000);
            require(energy(c) != 0 && equal(c, LampGroupScenes::pixel(v, 32768, 2000)),
                    "beat counter extremes violate presence/determinism");
        }
    }
}
} // namespace

int main() {
    existingScenesUnchanged();
    physicalRoomCoverage();
    inputValidity();
    saturatedPaletteCoverage();
    distinctMotionAndAudio();
    boundariesAndRollover();
    std::cout << "PASS: six corkscrew scenes preserve existing0..26; all lamps stay lit through silence/dropout; "
                 "distinct motion/bands, asymmetric geometry, invalid input, bounds and rollover\n";
}
