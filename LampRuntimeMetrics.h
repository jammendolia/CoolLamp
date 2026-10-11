#pragma once
#include <stdint.h>

// Allocation-free, main-loop-owned diagnostics. No request content or radio
// identity is retained. A tracker is fresh on every boot; counters saturate.
// Unsigned microsecond deltas handle rollover provided a sampled interval is
// less than one full micros() period (about 71 minutes).
namespace LampRuntimeMetrics {
constexpr uint32_t AnimationGapTargetUs = 100000;
constexpr uint32_t WindowUs = 5000000;
enum class FrameKind : uint8_t { Animation, Update, Calibration, Signal, Off, Control };
enum class Service : uint8_t { Network, Bluetooth, BeforeRender };

// Fixed windows are aligned to the first loop/show observation. Sequence zero
// means no window yet; sequences wrap UINT32_MAX -> 1. Start/end are modulo
// micros() timestamps; end is exclusive and is scheduled for the current
// partial window. A gap belongs to the window of its completing show, even if
// it began in the prior window. Only current + most recent completed survive.
struct Window {
  uint32_t sequence = 0, startUs = 0, endUs = 0, observedThroughUs = 0;
  uint32_t observations = 0, animationFrames = 0, maxAnimationGapUs = 0, animationGapOverruns = 0;
};

struct Snapshot {
  uint32_t loops = 0, shows = 0, animationShows = 0;
  uint32_t maxLoopUs = 0, maxLoopGapUs = 0;
  uint32_t maxNetworkServiceUs = 0, maxBluetoothServiceUs = 0, maxBeforeRenderUs = 0;
  uint32_t maxShowUs = 0, maxFrameGapUs = 0, maxAnimationFrameGapUs = 0;
  uint32_t animationGapOverruns = 0;
  Window currentWindow{}, lastWindow{};
};

class Tracker {
  Snapshot snapshot_{};
  uint32_t lastLoop_ = 0, lastShow_ = 0, lastAnimationShow_ = 0;
  bool haveLoop_ = false, haveShow_ = false, haveAnimationShow_ = false;
  static void maximum(uint32_t& value, uint32_t next) { if (next > value) value = next; }
  static void increment(uint32_t& value) { if (value != UINT32_MAX) ++value; }
  static uint32_t sequenceAfter(uint32_t previous, uint32_t steps) {
    // At most 858 windows fit one uint32 micros() period: at most one wrap.
    const uint32_t next = previous + steps;
    return next < previous || next == 0 ? next + 1 : next;
  }
  void observe(uint32_t now) {
    auto& current = snapshot_.currentWindow;
    if (!current.sequence) {
      current.sequence = 1; current.startUs = now; current.endUs = now + WindowUs;
    } else {
      const uint32_t elapsed = uint32_t(now - current.startUs);
      const uint32_t windows = elapsed / WindowUs;
      if (windows) {
        const uint32_t nextStart = current.startUs + windows * WindowUs;
        if (windows == 1) snapshot_.lastWindow = current;
        else {
          // No catch-up loop or fabricated samples for unobserved intervals.
          snapshot_.lastWindow = {};
          snapshot_.lastWindow.sequence = sequenceAfter(current.sequence, windows - 1);
          snapshot_.lastWindow.startUs = nextStart - WindowUs;
          snapshot_.lastWindow.endUs = nextStart;
        }
        const uint32_t nextSequence = sequenceAfter(current.sequence, windows);
        current = {}; current.sequence = nextSequence;
        current.startUs = nextStart; current.endUs = nextStart + WindowUs;
      }
    }
    current.observedThroughUs = now; increment(current.observations);
  }
public:
  const Snapshot& snapshot() const { return snapshot_; }
  void beginLoop(uint32_t now) {
    if (haveLoop_) maximum(snapshot_.maxLoopGapUs, uint32_t(now - lastLoop_));
    lastLoop_ = now; haveLoop_ = true; increment(snapshot_.loops); observe(now);
  }
  void endLoop(uint32_t duration) { maximum(snapshot_.maxLoopUs, duration); observe(lastLoop_ + duration); }
  void service(Service kind, uint32_t duration) {
    switch (kind) {
      case Service::Network: maximum(snapshot_.maxNetworkServiceUs, duration); break;
      case Service::Bluetooth: maximum(snapshot_.maxBluetoothServiceUs, duration); break;
      case Service::BeforeRender: maximum(snapshot_.maxBeforeRenderUs, duration); break;
    }
  }
  void show(FrameKind kind, uint32_t completedAt, uint32_t duration) {
    observe(completedAt);
    increment(snapshot_.shows); maximum(snapshot_.maxShowUs, duration);
    if (haveShow_) maximum(snapshot_.maxFrameGapUs, uint32_t(completedAt - lastShow_));
    lastShow_ = completedAt; haveShow_ = true;
    if (kind == FrameKind::Animation) {
      increment(snapshot_.animationShows);
      increment(snapshot_.currentWindow.animationFrames);
      if (haveAnimationShow_) {
        const uint32_t gap = uint32_t(completedAt - lastAnimationShow_);
        maximum(snapshot_.maxAnimationFrameGapUs, gap);
        maximum(snapshot_.currentWindow.maxAnimationGapUs, gap);
        if (gap > AnimationGapTargetUs) {
          increment(snapshot_.animationGapOverruns);
          increment(snapshot_.currentWindow.animationGapOverruns);
        }
      }
      lastAnimationShow_ = completedAt; haveAnimationShow_ = true;
    } else if (kind != FrameKind::Control) {
      // Off and intentionally sparse indicators are separate render domains.
      // Immediate control output does not conceal a stall between animations.
      haveAnimationShow_ = false;
    }
  }
};

// Covers all early returns, delays and pre-render services, unlike maxRenderUs.
class LoopScope {
  Tracker& tracker_;
  uint32_t (*clock_)();
  uint32_t started_;
public:
  LoopScope(Tracker& tracker, uint32_t (*clock)())
      : tracker_(tracker), clock_(clock), started_(clock()) { tracker_.beginLoop(started_); }
  ~LoopScope() { tracker_.endLoop(uint32_t(clock_() - started_)); }
  uint32_t startedAt() const { return started_; }
  LoopScope(const LoopScope&) = delete;
  LoopScope& operator=(const LoopScope&) = delete;
};
}

// These wrappers are invoked only by the loop owner. The network I/O task must
// obtain immutable copies on that path rather than reading a live tracker.
const LampRuntimeMetrics::Snapshot& getLampRuntimeMetrics();
void lampShowFrame(LampRuntimeMetrics::FrameKind kind);
void lampShowFrame(uint8_t brightness, LampRuntimeMetrics::FrameKind kind);
