// The plugin serializes this lease on the UI thread. Injecting flag access lets
// the production ownership rules run in native tests without importing UIKit.
final class LampFirmwareScreenAwake {
    enum Failure: Error, Equatable {
        case invalidToken
        case notForeground
        case alreadyOwned
    }

    private let readFlag: () -> Bool
    private let writeFlag: (Bool) -> Void
    private var token: String?
    private var previousFlag: Bool?

    init(readFlag: @escaping () -> Bool, writeFlag: @escaping (Bool) -> Void) {
        self.readFlag = readFlag
        self.writeFlag = writeFlag
    }

    var active: Bool { token != nil }

    @discardableResult
    func set(token requested: String, enabled: Bool, foreground: Bool) throws -> Bool {
        guard requested.utf8.count == 32,
              requested.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw Failure.invalidToken
        }
        if enabled {
            guard foreground else { throw Failure.notForeground }
            if let current = token {
                guard current == requested else { throw Failure.alreadyOwned }
                return true
            }
            previousFlag = readFlag()
            token = requested
            writeFlag(true)
        } else if token == requested {
            cleanup()
        }
        return active
    }

    // Backgrounding/teardown revokes the lease. Later completion for its old
    // token cannot release a different transfer's subsequent lease.
    func cleanup() {
        guard let previous = previousFlag else { return }
        token = nil
        previousFlag = nil
        writeFlag(previous)
    }
}
