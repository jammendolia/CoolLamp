import Foundation

// This lease protects only a brief authenticated Wi-Fi handoff and the durable
// recording of its response. It must never wrap a firmware download or BLE transfer.
final class LampFirmwareHandoffLease {
    enum Failure: Error, Equatable {
        case invalidSession
        case alreadyOwned
        case unavailable
    }

    typealias BeginTask = (@escaping () -> Void) -> Int
    typealias EndTask = (Int) -> Void

    private let beginTask: BeginTask
    private let endTask: EndTask
    private let invalidTask: Int
    private var task: Int?
    private var sessionId: String?
    private var generation = 0

    init(invalidTask: Int, beginTask: @escaping BeginTask, endTask: @escaping EndTask) {
        self.invalidTask = invalidTask
        self.beginTask = beginTask
        self.endTask = endTask
    }

    var active: Bool { task != nil }
    var owner: String? { sessionId }

    @discardableResult
    func begin(session requested: String) throws -> Bool {
        guard Self.validSession(requested) else { throw Failure.invalidSession }
        if let current = sessionId {
            guard current == requested else { throw Failure.alreadyOwned }
        }
        // Same-owner begin is a real renewal, not a stale liveness check. Take
        // the replacement first so failure leaves the existing task intact,
        // then generation-fence and end the old task with no uncovered gap.
        let requestedGeneration = generation + 1
        let newTask = beginTask { [weak self] in self?.expire(generation: requestedGeneration) }
        guard newTask != invalidTask else { throw Failure.unavailable }
        let previousTask = task
        generation = requestedGeneration
        task = newTask
        sessionId = requested
        if let previousTask { endTask(previousTask) }
        return true
    }

    @discardableResult
    func end(session requested: String) throws -> Bool {
        guard Self.validSession(requested) else { throw Failure.invalidSession }
        guard sessionId == requested else { return active }
        cleanup()
        return false
    }

    private func expire(generation requested: Int) {
        guard requested == generation else { return }
        cleanup()
    }

    func cleanup() {
        guard let current = task else { return }
        task = nil
        sessionId = nil
        endTask(current)
    }

    private static func validSession(_ value: String) -> Bool {
        value.utf8.count == 32 && value.utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        } && value != String(repeating: "0", count: 32)
    }
}
