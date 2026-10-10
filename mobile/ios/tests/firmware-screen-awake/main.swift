let first = String(repeating: "a", count: 32)
let second = String(repeating: "b", count: 32)

final class Flag {
    var value: Bool
    var reads = 0
    var writes: [Bool] = []
    init(_ value: Bool) { self.value = value }
    func lease() -> LampFirmwareScreenAwake {
        LampFirmwareScreenAwake(readFlag: { self.reads += 1; return self.value },
                                writeFlag: { self.value = $0; self.writes.append($0) })
    }
}

func fails(_ expected: LampFirmwareScreenAwake.Failure, _ operation: () throws -> Bool) {
    do { _ = try operation(); preconditionFailure("Expected lease rejection") }
    catch let failure as LampFirmwareScreenAwake.Failure { precondition(failure == expected) }
    catch { preconditionFailure("Unexpected lease error: \(error)") }
}

let flag = Flag(false), lease = flag.lease()
precondition(!lease.active)
precondition(try! lease.set(token: first, enabled: true, foreground: true))
precondition(flag.value && flag.reads == 1 && flag.writes == [true])
precondition(try! lease.set(token: first, enabled: true, foreground: true))
precondition(flag.reads == 1 && flag.writes == [true])
fails(.alreadyOwned) { try lease.set(token: second, enabled: true, foreground: true) }
precondition(try! lease.set(token: second, enabled: false, foreground: true))
precondition(flag.value && flag.writes == [true])
precondition(!(try! lease.set(token: first, enabled: false, foreground: true)))
precondition(!flag.value && flag.writes == [true, false])
precondition(!(try! lease.set(token: first, enabled: false, foreground: false)))
precondition(flag.writes == [true, false])

// Background cleanup and repeated teardown restore once; a late first-token
// completion cannot clear the second owner acquired after foreground resumes.
precondition(try! lease.set(token: first, enabled: true, foreground: true))
lease.cleanup()
precondition(!lease.active && !flag.value)
let writesAfterBackground = flag.writes.count
lease.cleanup()
precondition(flag.writes.count == writesAfterBackground)
precondition(try! lease.set(token: second, enabled: true, foreground: true))
precondition(try! lease.set(token: first, enabled: false, foreground: true))
precondition(lease.active && flag.value && flag.writes.count == writesAfterBackground + 1)
precondition(!(try! lease.set(token: second, enabled: false, foreground: false)))
precondition(!lease.active && !flag.value)

let alreadyAwake = Flag(true), priorLease = alreadyAwake.lease()
precondition(try! priorLease.set(token: first, enabled: true, foreground: true))
precondition(!(try! priorLease.set(token: first, enabled: false, foreground: true)))
precondition(alreadyAwake.value && alreadyAwake.writes == [true, true])
precondition(try! priorLease.set(token: second, enabled: true, foreground: true))
priorLease.cleanup()
precondition(alreadyAwake.value && !priorLease.active)

let background = Flag(false), backgroundLease = background.lease()
fails(.notForeground) { try backgroundLease.set(token: first, enabled: true, foreground: false) }
precondition(background.reads == 0 && background.writes.isEmpty && !backgroundLease.active)
precondition(try! backgroundLease.set(token: first, enabled: true, foreground: true))
fails(.notForeground) { try backgroundLease.set(token: first, enabled: true, foreground: false) }
precondition(background.writes == [true])
backgroundLease.cleanup()
precondition(!background.value)

for invalid in ["", "a", String(repeating: "A", count: 32), String(repeating: "g", count: 32),
                first + "0", first + "\n", String(repeating: "Ã©", count: 16)] {
    let invalidFlag = Flag(false), invalidLease = invalidFlag.lease()
    fails(.invalidToken) { try invalidLease.set(token: invalid, enabled: true, foreground: true) }
    precondition(invalidFlag.reads == 0 && invalidFlag.writes.isEmpty)
    precondition(try! invalidLease.set(token: first, enabled: true, foreground: true))
    fails(.invalidToken) { try invalidLease.set(token: invalid, enabled: false, foreground: true) }
    precondition(invalidLease.active && invalidFlag.value)
    invalidLease.cleanup()
}

print("PASS: production screen lease token validation, idempotence, collision, stale completion, background/teardown and prior flag restoration")
