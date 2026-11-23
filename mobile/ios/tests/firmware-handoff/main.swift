let first = String(repeating: "a", count: 32)
let second = String(repeating: "b", count: 32)

final class FakeTasks {
    var next = 10
    var beginReturnsInvalid = false
    var expirations: [() -> Void] = []
    var ended: [Int] = []

    func lease() -> LampFirmwareHandoffLease {
        LampFirmwareHandoffLease(invalidTask: -1, beginTask: { expiration in
            self.expirations.append(expiration)
            if self.beginReturnsInvalid { return -1 }
            defer { self.next += 1 }
            return self.next
        }, endTask: { self.ended.append($0) })
    }
}

func fails(_ expected: LampFirmwareHandoffLease.Failure, _ operation: () throws -> Bool) {
    do { _ = try operation(); preconditionFailure("Expected handoff failure") }
    catch let failure as LampFirmwareHandoffLease.Failure { precondition(failure == expected) }
    catch { preconditionFailure("Unexpected handoff error: \(error)") }
}

let tasks = FakeTasks(), lease = tasks.lease()
precondition(try! lease.begin(session: first))
precondition(lease.owner == first && tasks.expirations.count == 1)
precondition(try! lease.begin(session: first))
precondition(tasks.expirations.count == 2 && tasks.ended == [10])
fails(.alreadyOwned) { try lease.begin(session: second) }
precondition(try! lease.end(session: second))
precondition(lease.active && tasks.ended == [10])
precondition(!(try! lease.end(session: first)))
precondition(!lease.active && tasks.ended == [10, 11])

precondition(try! lease.begin(session: second))
tasks.expirations.first?()
precondition(lease.active && lease.owner == second && tasks.ended == [10, 11])
tasks.expirations.last?()
precondition(!lease.active && tasks.ended == [10, 11, 12])
tasks.expirations.last?()
precondition(tasks.ended == [10, 11, 12])

let unavailableTasks = FakeTasks()
unavailableTasks.beginReturnsInvalid = true
let unavailable = unavailableTasks.lease()
fails(.unavailable) { try unavailable.begin(session: first) }
precondition(!unavailable.active && unavailableTasks.ended.isEmpty)

let renewalTasks = FakeTasks(), renewal = renewalTasks.lease()
precondition(try! renewal.begin(session: first))
renewalTasks.beginReturnsInvalid = true
fails(.unavailable) { try renewal.begin(session: first) }
precondition(renewal.active && renewal.owner == first && renewalTasks.ended.isEmpty)
precondition(!(try! renewal.end(session: first)) && renewalTasks.ended == [10])

for invalid in ["", "a", String(repeating: "0", count: 32),
                String(repeating: "A", count: 32), String(repeating: "g", count: 32)] {
    fails(.invalidSession) { try lease.begin(session: invalid) }
    fails(.invalidSession) { try lease.end(session: invalid) }
}

print("PASS: short firmware handoff renewal, token isolation, expiry cleanup and unavailable handling")
