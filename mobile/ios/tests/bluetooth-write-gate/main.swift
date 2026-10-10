import Foundation

final class Timer {
    let delay: Double
    let action: () -> Void
    var cancelled = false
    init(_ delay: Double, _ action: @escaping () -> Void) {
        self.delay = delay
        self.action = action
    }
}

final class Fixture {
    var connected = true
    var canSend = false
    var writes = 0
    var outcomes: [(Bool, String)] = []
    var timers: [Timer] = []
    lazy var gate = WriteWithoutResponseGate { delay, action in
        let timer = Timer(delay, action)
        self.timers.append(timer)
        return { timer.cancelled = true }
    }
    func write(timeout: Double = 5) {
        gate.write(timeout: timeout, isCurrent: { self.connected },
                   canSend: { self.canSend }, submit: { self.writes += 1 },
                   completion: { self.outcomes.append(($0, $1)) })
    }
}

// Immediate native readiness queues one frame; a readiness callback is not an ACK.
let immediate = Fixture()
immediate.canSend = true
immediate.write()
precondition(immediate.writes == 1 && immediate.outcomes.count == 1)
precondition(immediate.outcomes[0].0 && immediate.outcomes[0].1.contains("queued"))
precondition(!immediate.gate.hasPendingWrite && immediate.timers.isEmpty)
immediate.gate.ready()
precondition(immediate.writes == 1 && immediate.outcomes.count == 1)

// False/spurious readiness cannot submit. One native operation owns the gate.
let deferred = Fixture()
deferred.write()
precondition(deferred.gate.hasPendingWrite && deferred.writes == 0)
precondition(deferred.timers.count == 1 && deferred.timers[0].delay == 5)
deferred.gate.ready()
precondition(deferred.writes == 0 && deferred.outcomes.isEmpty)
deferred.write()
precondition(deferred.outcomes.count == 1 && !deferred.outcomes[0].0)
precondition(deferred.outcomes[0].1.contains("pending") && deferred.gate.hasPendingWrite)
deferred.canSend = true
deferred.gate.ready()
precondition(deferred.writes == 1 && deferred.outcomes.count == 2 && deferred.outcomes[1].0)
precondition(deferred.timers[0].cancelled && !deferred.gate.hasPendingWrite)
deferred.timers[0].action() // A cancelled timer may still be delivered late.
precondition(deferred.outcomes.count == 2 && deferred.writes == 1)

// Timeout invalidates its owner before completion; late readiness cannot send it.
let expired = Fixture()
expired.write()
expired.timers[0].action()
precondition(expired.outcomes.count == 1 && !expired.outcomes[0].0)
precondition(expired.outcomes[0].1.contains("timeout") && !expired.gate.hasPendingWrite)
expired.canSend = true
expired.gate.ready()
precondition(expired.writes == 0 && expired.outcomes.count == 1)

// Explicit cancellation/disconnect rejects once and permits a fresh operation.
for reason in ["Connection cancelled.", "Peripheral disconnect requested.", "Peripheral disconnected."] {
    let cancelled = Fixture()
    cancelled.write()
    cancelled.gate.cancel(reason)
    precondition(cancelled.outcomes.count == 1 && !cancelled.outcomes[0].0)
    precondition(cancelled.outcomes[0].1 == reason && cancelled.timers[0].cancelled)
    cancelled.gate.cancel(reason)
    cancelled.canSend = true
    cancelled.gate.ready()
    precondition(cancelled.writes == 0 && cancelled.outcomes.count == 1)
    cancelled.write()
    precondition(cancelled.writes == 1 && cancelled.outcomes.count == 2 && cancelled.outcomes[1].0)
}

let disconnected = Fixture()
disconnected.connected = false
disconnected.canSend = true
disconnected.write()
precondition(disconnected.writes == 0 && !disconnected.outcomes[0].0)
precondition(disconnected.timers.isEmpty && !disconnected.gate.hasPendingWrite)

// Peripheral identity/connection-generation checks also reject a deferred owner.
let replaced = Fixture()
replaced.write()
replaced.connected = false
replaced.canSend = true
replaced.gate.ready()
precondition(replaced.writes == 0 && !replaced.outcomes[0].0)
precondition(replaced.outcomes[0].1.contains("replaced") && replaced.timers[0].cancelled)

// A reused peripheral can have the same object identity after reconnection;
// its captured connection generation must still invalidate the old operation.
let generationFixture = Fixture()
var connectionGeneration = 1
let oldGeneration = connectionGeneration
generationFixture.gate.write(timeout: 5,
                             isCurrent: { connectionGeneration == oldGeneration },
                             canSend: { generationFixture.canSend },
                             submit: { generationFixture.writes += 1 },
                             completion: { generationFixture.outcomes.append(($0, $1)) })
connectionGeneration = 2
generationFixture.canSend = true
generationFixture.gate.ready()
precondition(generationFixture.writes == 0 && !generationFixture.outcomes[0].0)

// An old owner's late timer cannot reject the replacement operation.
let replacement = Fixture()
replacement.write()
replacement.gate.cancel("Peripheral replaced.")
replacement.write()
precondition(replacement.gate.hasPendingWrite && replacement.timers.count == 2)
replacement.timers[0].action()
precondition(replacement.gate.hasPendingWrite && replacement.outcomes.count == 1)
replacement.canSend = true
replacement.gate.ready()
precondition(replacement.writes == 1 && replacement.outcomes.count == 2 && replacement.outcomes[1].0)

// Excessive/invalid deadlines cannot create an unbounded queued native write.
let bounded = Fixture()
bounded.write(timeout: 1_000)
precondition(bounded.timers[0].delay == 60)
bounded.gate.cancel()
for invalid in [Double.nan, Double.infinity, -1, 0] {
    let fixture = Fixture()
    fixture.canSend = true
    fixture.write(timeout: invalid)
    precondition(fixture.writes == 0 && !fixture.outcomes[0].0 && fixture.timers.isEmpty)
}

// Old completion must not remove a new request started synchronously by it.
let reentrant = Fixture()
reentrant.canSend = true
reentrant.gate.write(timeout: 5, isCurrent: { true }, canSend: { true },
                     submit: { reentrant.writes += 1 }, completion: { success, _ in
    precondition(success)
    reentrant.canSend = false
    reentrant.write()
})
precondition(reentrant.writes == 1 && reentrant.gate.hasPendingWrite)
reentrant.canSend = true
reentrant.gate.ready()
precondition(reentrant.writes == 2 && reentrant.outcomes.count == 1 && reentrant.outcomes[0].0)

print("PASS: production Bluetooth NR gate immediate/deferred readiness, one owner, deadline, disconnect/cancel, replacement, stale timers and completion reentrancy")
