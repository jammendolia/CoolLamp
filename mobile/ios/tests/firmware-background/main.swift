import Foundation

let root = FileManager.default.temporaryDirectory
    .appendingPathComponent("coollamp-firmware-background-\(UUID().uuidString)", isDirectory: true)
defer { try? FileManager.default.removeItem(at: root) }

var tick: Int64 = 1_800_000_000_000
let journal = LampFirmwareBackgroundJournal(directory: root, now: { tick += 1; return tick })
let firstSession = String(repeating: "a", count: 32)
let secondSession = String(repeating: "b", count: 32)
let digest = String(repeating: "c", count: 64)
let peripheral = "123E4567-E89B-12D3-A456-426614174000"

func record(session: String, phase: LampFirmwareBackgroundPhase = .awaitingArtifact,
            name: String = "CoolLamp.ino.bin") -> LampFirmwareBackgroundRecord {
    LampFirmwareBackgroundRecord(version: 1, sessionId: session, lampId: "lamp-123",
        peripheralId: peripheral, targetVersion: "1.15.9", sha256: digest,
        totalBytes: 1_024, artifactFileName: name, acknowledgedBytes: 0,
        phase: phase, reason: nil, updatedAtMs: tick)
}

func fails(_ expected: LampFirmwareBackgroundJournalError, _ operation: () throws -> Void) {
    do { try operation(); preconditionFailure("Expected journal failure") }
    catch let failure as LampFirmwareBackgroundJournalError { precondition(failure == expected) }
    catch { preconditionFailure("Unexpected journal error: \(error)") }
}

let first = try! journal.stage(record(session: firstSession))
precondition(first.phase == .awaitingArtifact)
precondition(try! journal.stage(record(session: firstSession)) == first)
precondition(try! journal.load() == first)
let ready = try! journal.stage(record(session: firstSession, phase: .staged))
precondition(ready.phase == .staged && ready.updatedAtMs > first.updatedAtMs)
fails(.activeSessionConflict) { _ = try journal.stage(record(session: firstSession, name: "other.bin")) }
fails(.activeSessionConflict) { _ = try journal.stage(record(session: secondSession)) }

_ = try! journal.transition(sessionId: firstSession, to: .waitingForBluetooth)
let moving = try! journal.transition(sessionId: firstSession, to: .transferring,
                                     acknowledgedBytes: 232)
precondition(moving.acknowledgedBytes == 232)
fails(.offsetRegression) {
    _ = try journal.transition(sessionId: firstSession, to: .transferring,
                               acknowledgedBytes: 231)
}
_ = try! journal.transition(sessionId: firstSession, to: .paused, reason: "system-expired")
_ = try! journal.transition(sessionId: firstSession, to: .transferring,
                            acknowledgedBytes: 464)
_ = try! journal.transition(sessionId: firstSession, to: .verifying,
                            acknowledgedBytes: 1_024)
_ = try! journal.transition(sessionId: firstSession, to: .committing)
let completed = try! journal.transition(sessionId: firstSession, to: .completed,
                                        acknowledgedBytes: 1_024)
precondition(completed.isTerminal && completed.acknowledgedBytes == completed.totalBytes)
fails(.terminalSession) { _ = try journal.transition(sessionId: firstSession, to: .failed) }

let replacement = try! journal.stage(record(session: secondSession, phase: .staged))
precondition(replacement.sessionId == secondSession)
let cancelled = try! journal.transition(sessionId: secondSession, to: .cancelled,
                                        reason: "user-cancelled")
precondition(cancelled.isTerminal)
try! journal.clearTerminal(sessionId: secondSession)
precondition(try! journal.load() == nil)

for invalid in ["../firmware.bin", "firmware/part.bin", "firmware\\part.bin", ".", ".."] {
    fails(.invalidRecord("artifact-file")) { _ = try record(session: firstSession, name: invalid).validated() }
}
fails(.invalidRecord("session-id")) {
    _ = try record(session: String(repeating: "A", count: 32)).validated()
}

print("PASS: durable background firmware journal validation, idempotence, conflicts, monotonic resume and terminal fencing")
