#include "../LampRuntimeMetrics.h"
#include <cassert>
#include <cstring>
#include <iostream>
using namespace LampRuntimeMetrics;
static uint32_t clockUs = 0;
static uint32_t clockNow() { return clockUs; }

static void earlyReturn(Tracker& tracker) {
  const LoopScope timing(tracker, clockNow);
  clockUs += 5000000; // A blocking transport must be visible in the loop metric.
  tracker.service(Service::Network, 5000000);
  clockUs += 21;
  tracker.service(Service::Bluetooth, 21);
  tracker.service(Service::BeforeRender, uint32_t(clockUs - timing.startedAt()));
  return;
}

int main() {
  static_assert(sizeof(Window) == 32 && sizeof(Snapshot) == 112, "Keep metric storage bounded");
  static_assert(sizeof(Tracker) <= 128, "Main-loop metric storage budget");
  Tracker loopTracker;
  earlyReturn(loopTracker);
  assert(loopTracker.snapshot().loops == 1);
  assert(loopTracker.snapshot().maxLoopUs == 5000021);
  assert(loopTracker.snapshot().maxNetworkServiceUs == 5000000);
  assert(loopTracker.snapshot().maxBluetoothServiceUs == 21);
  assert(loopTracker.snapshot().maxBeforeRenderUs == 5000021);
  assert(loopTracker.snapshot().lastWindow.sequence == 1 && loopTracker.snapshot().currentWindow.sequence == 2);
  clockUs += 1;
  { const LoopScope next(loopTracker, clockNow); clockUs += 16; }
  assert(loopTracker.snapshot().maxLoopGapUs == 5000022);
  assert(loopTracker.snapshot().loops == 2);

  // Frame completions, including time spent in transport, determine the gap.
  Tracker tracker;
  tracker.show(FrameKind::Animation, 0, 5300);
  tracker.show(FrameKind::Animation, 16000, 5300);
  tracker.show(FrameKind::Control, 150000, 5300);
  tracker.show(FrameKind::Animation, 160001, 5300);
  assert(tracker.snapshot().maxAnimationFrameGapUs == 144001);
  assert(tracker.snapshot().animationGapOverruns == 1);
  assert(tracker.snapshot().shows == 4 && tracker.snapshot().animationShows == 3);
  assert(tracker.snapshot().maxFrameGapUs == 134000);
  assert(tracker.snapshot().maxShowUs == 5300);
  tracker.show(FrameKind::Off, 160002, 5300);
  tracker.show(FrameKind::Animation, 9160002, 5300);
  assert(tracker.snapshot().maxFrameGapUs == 9000000);
  assert(tracker.snapshot().maxAnimationFrameGapUs == 144001);
  uint32_t sparseAt = 10000000;
  for (const auto kind : {FrameKind::Update, FrameKind::Calibration, FrameKind::Signal}) {
    tracker.show(kind, sparseAt, 30720);
    sparseAt += 2000000;
    tracker.show(FrameKind::Animation, sparseAt, 30720);
    sparseAt += 1000000;
  }
  assert(tracker.snapshot().maxAnimationFrameGapUs == 144001);
  assert(tracker.snapshot().maxShowUs == 30720);

  Tracker loopRollover;
  clockUs = UINT32_MAX - 30;
  { const LoopScope timing(loopRollover, clockNow); clockUs = 12; }
  assert(loopRollover.snapshot().maxLoopUs == 43);
  clockUs = 25;
  { const LoopScope timing(loopRollover, clockNow); }
  assert(loopRollover.snapshot().maxLoopGapUs == 56);
  Tracker rollover;
  rollover.show(FrameKind::Animation, UINT32_MAX - 100, 5000);
  rollover.show(FrameKind::Animation, 15900, 5000);
  assert(rollover.snapshot().maxFrameGapUs == 16001);
  assert(rollover.snapshot().maxAnimationFrameGapUs == 16001);
  assert(rollover.snapshot().animationGapOverruns == 0);
  rollover.show(FrameKind::Animation, 115900, 5000);
  assert(rollover.snapshot().animationGapOverruns == 0); // Exact target passes.
  rollover.show(FrameKind::Animation, 215901, 5000);
  assert(rollover.snapshot().animationGapOverruns == 1);

  // Deliberate saturation fixture: storage remains bounded for long uptime.
  auto& saturated = const_cast<Snapshot&>(rollover.snapshot());
  saturated.loops = saturated.shows = saturated.animationShows = saturated.animationGapOverruns = UINT32_MAX;
  saturated.currentWindow.animationFrames = saturated.currentWindow.observations = saturated.currentWindow.animationGapOverruns = UINT32_MAX;
  rollover.beginLoop(216000);
  rollover.show(FrameKind::Animation, 500000, 1);
  assert(saturated.loops == UINT32_MAX && saturated.shows == UINT32_MAX);
  assert(saturated.animationShows == UINT32_MAX && saturated.animationGapOverruns == UINT32_MAX);
  assert(saturated.currentWindow.animationFrames == UINT32_MAX && saturated.currentWindow.observations == UINT32_MAX && saturated.currentWindow.animationGapOverruns == UINT32_MAX);
  Tracker nextBoot;
  assert(nextBoot.snapshot().loops == 0 && nextBoot.snapshot().shows == 0);
  nextBoot.show(FrameKind::Animation, 900000000, 1);
  assert(nextBoot.snapshot().maxAnimationFrameGapUs == 0); // No prior-session interval.
  // Completed five-second windows reveal sustained performance without
  // changing boot-cumulative startup evidence. Diagnostic reads are pure.
  Tracker windows; windows.beginLoop(0);
  windows.show(FrameKind::Animation, 0, 100);
  windows.show(FrameKind::Animation, 381349, 100);
  uint32_t at = 381349 + 16000;
  for (; at < WindowUs; at += 16000) windows.show(FrameKind::Animation, at, 100);
  windows.beginLoop(WindowUs);
  assert(windows.snapshot().lastWindow.sequence == 1 && windows.snapshot().lastWindow.startUs == 0 && windows.snapshot().lastWindow.endUs == WindowUs);
  assert(windows.snapshot().lastWindow.maxAnimationGapUs == 381349 && windows.snapshot().lastWindow.animationGapOverruns == 1);
  assert(windows.snapshot().currentWindow.sequence == 2 && windows.snapshot().currentWindow.animationFrames == 0);
  const auto pure = windows.snapshot();
  for (unsigned reads = 0; reads < 100; ++reads) assert(!std::memcmp(&pure, &windows.snapshot(), sizeof(Snapshot)));
  for (; at < 2 * WindowUs; at += 16000) windows.show(FrameKind::Animation, at, 100);
  windows.beginLoop(2 * WindowUs);
  assert(windows.snapshot().lastWindow.sequence == 2 && windows.snapshot().lastWindow.maxAnimationGapUs == 16000);
  assert(windows.snapshot().lastWindow.animationGapOverruns == 0 && windows.snapshot().lastWindow.animationFrames > 300);
  assert(windows.snapshot().maxAnimationFrameGapUs == 381349 && windows.snapshot().animationGapOverruns == 1);
  assert(windows.snapshot().currentWindow.sequence == 3 && windows.snapshot().currentWindow.startUs == 2 * WindowUs);

  Tracker edges; edges.beginLoop(0);
  edges.show(FrameKind::Animation, WindowUs - 5000, 1);
  edges.show(FrameKind::Animation, WindowUs + 7000, 1);
  assert(edges.snapshot().lastWindow.sequence == 1 && edges.snapshot().lastWindow.maxAnimationGapUs == 0);
  assert(edges.snapshot().currentWindow.sequence == 2 && edges.snapshot().currentWindow.maxAnimationGapUs == 12000);
  assert(edges.snapshot().currentWindow.animationFrames == 1);
  edges.show(FrameKind::Off, WindowUs + 10000, 1);
  edges.show(FrameKind::Animation, 2 * WindowUs + 10000, 1);
  assert(edges.snapshot().currentWindow.sequence == 3 && edges.snapshot().currentWindow.maxAnimationGapUs == 0);
  assert(edges.snapshot().maxAnimationFrameGapUs == 12000);

  Tracker skipped; skipped.beginLoop(100); skipped.show(FrameKind::Animation, 120, 1);
  skipped.beginLoop(3 * WindowUs + 100);
  assert(skipped.snapshot().lastWindow.sequence == 3 && skipped.snapshot().lastWindow.startUs == 2 * WindowUs + 100);
  assert(skipped.snapshot().lastWindow.endUs == 3 * WindowUs + 100 && skipped.snapshot().lastWindow.animationFrames == 0 && skipped.snapshot().lastWindow.observations == 0);
  assert(skipped.snapshot().currentWindow.sequence == 4 && skipped.snapshot().currentWindow.startUs == 3 * WindowUs + 100);
  skipped.show(FrameKind::Animation, 3 * WindowUs + 200, 1);
  assert(skipped.snapshot().currentWindow.maxAnimationGapUs == 3 * WindowUs + 80); // Stalls are not hidden by window rotation.

  Tracker windowRollover; const uint32_t began = UINT32_MAX - 1000;
  windowRollover.beginLoop(began); windowRollover.show(FrameKind::Animation, began, 1);
  windowRollover.show(FrameKind::Animation, uint32_t(began + WindowUs - 1), 1);
  assert(windowRollover.snapshot().currentWindow.sequence == 1);
  windowRollover.beginLoop(uint32_t(began + WindowUs));
  assert(windowRollover.snapshot().currentWindow.sequence == 2 && windowRollover.snapshot().lastWindow.sequence == 1);
  assert(windowRollover.snapshot().lastWindow.endUs == uint32_t(began + WindowUs));
  assert(windowRollover.snapshot().lastWindow.maxAnimationGapUs == WindowUs - 1);
  auto& epoch = const_cast<Snapshot&>(windowRollover.snapshot()); epoch.currentWindow.sequence = UINT32_MAX;
  windowRollover.beginLoop(uint32_t(began + 3 * WindowUs));
  assert(windowRollover.snapshot().lastWindow.sequence == 1 && windowRollover.snapshot().currentWindow.sequence == 2);
  // Maximum representable sampled delay advances in constant work, no loop.
  Tracker longPause; longPause.beginLoop(0); longPause.beginLoop(UINT32_MAX);
  assert(longPause.snapshot().currentWindow.sequence == 859 && longPause.snapshot().lastWindow.sequence == 858);
  assert(longPause.snapshot().lastWindow.observations == 0 && longPause.snapshot().currentWindow.observations == 1);
  assert(nextBoot.snapshot().lastWindow.sequence == 0);
  std::cout << "PASS production runtime metrics: all-return/network coverage, every output domain, control continuity, sparse/off fencing, rollover/saturation/boot; pure reads, exact five-second current/last windows, retained startup maximum, cross-window gaps, skipped windows and sequence rollover; trackerBytes=" << sizeof(Tracker) << '\n';
}
