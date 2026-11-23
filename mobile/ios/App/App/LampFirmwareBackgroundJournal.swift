import Foundation

enum LampFirmwareBackgroundPhase: String, Codable, CaseIterable {
    case awaitingArtifact
    case staged
    case waitingForBluetooth
    case transferring
    case paused
    case verifying
    case committing
    case completed
    case failed
    case cancelled

    var isTerminal: Bool {
        self == .completed || self == .failed || self == .cancelled
    }

    func canTransition(to next: LampFirmwareBackgroundPhase) -> Bool {
        if self == next { return true }
        switch self {
        case .awaitingArtifact:
            return [.staged, .failed, .cancelled].contains(next)
        case .staged:
            return [.waitingForBluetooth, .failed, .cancelled].contains(next)
        case .waitingForBluetooth:
            return [.transferring, .paused, .failed, .cancelled].contains(next)
        case .transferring:
            return [.paused, .verifying, .failed, .cancelled].contains(next)
        case .paused:
            return [.waitingForBluetooth, .transferring, .failed, .cancelled].contains(next)
        case .verifying:
            return [.committing, .failed].contains(next)
        case .committing:
            return [.completed, .failed].contains(next)
        case .completed, .failed, .cancelled:
            return false
        }
    }
}

struct LampFirmwareBackgroundRecord: Codable, Equatable {
    static let schemaVersion = 1
    static let maximumArtifactBytes: Int64 = 16 * 1024 * 1024

    let version: Int
    let sessionId: String
    let lampId: String
    let peripheralId: String
    let targetVersion: String
    let sha256: String
    let totalBytes: Int64
    let artifactFileName: String
    var acknowledgedBytes: Int64
    var phase: LampFirmwareBackgroundPhase
    var reason: String?
    var updatedAtMs: Int64

    var isTerminal: Bool { phase.isTerminal }

    func immutableFieldsMatch(_ other: LampFirmwareBackgroundRecord) -> Bool {
        sessionId == other.sessionId && lampId == other.lampId &&
            peripheralId.caseInsensitiveCompare(other.peripheralId) == .orderedSame &&
            targetVersion == other.targetVersion && sha256 == other.sha256 &&
            totalBytes == other.totalBytes && artifactFileName == other.artifactFileName
    }

    func validated() throws -> LampFirmwareBackgroundRecord {
        guard version == Self.schemaVersion else {
            throw LampFirmwareBackgroundJournalError.invalidRecord("schema-version")
        }
        guard Self.isLowerHex(sessionId, count: 32, nonzero: true) else {
            throw LampFirmwareBackgroundJournalError.invalidRecord("session-id")
        }
        guard Self.isSafeIdentifier(lampId, maximum: 128) else {
            throw LampFirmwareBackgroundJournalError.invalidRecord("lamp-id")
        }
        guard UUID(uuidString: peripheralId) != nil else {
            throw LampFirmwareBackgroundJournalError.invalidRecord("peripheral-id")
        }
        guard Self.isVersion(targetVersion) else {
            throw LampFirmwareBackgroundJournalError.invalidRecord("target-version")
        }
        guard Self.isLowerHex(sha256, count: 64) else {
            throw LampFirmwareBackgroundJournalError.invalidRecord("sha256")
        }
        guard totalBytes > 0, totalBytes <= Self.maximumArtifactBytes,
              acknowledgedBytes >= 0, acknowledgedBytes <= totalBytes else {
            throw LampFirmwareBackgroundJournalError.invalidRecord("byte-range")
        }
        guard Self.isSafeFileName(artifactFileName) else {
            throw LampFirmwareBackgroundJournalError.invalidRecord("artifact-file")
        }
        if let reason = reason, !Self.isReason(reason) {
            throw LampFirmwareBackgroundJournalError.invalidRecord("reason")
        }
        if phase == .completed && acknowledgedBytes != totalBytes {
            throw LampFirmwareBackgroundJournalError.invalidRecord("incomplete-completion")
        }
        guard updatedAtMs > 0 else {
            throw LampFirmwareBackgroundJournalError.invalidRecord("updated-at")
        }
        return self
    }

    private static func isLowerHex(_ value: String, count: Int, nonzero: Bool = false) -> Bool {
        guard value.utf8.count == count,
              value.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            return false
        }
        return !nonzero || value != String(repeating: "0", count: count)
    }

    private static func isSafeIdentifier(_ value: String, maximum: Int) -> Bool {
        let bytes = value.utf8
        return !bytes.isEmpty && bytes.count <= maximum && bytes.allSatisfy { $0 >= 0x21 && $0 <= 0x7e }
    }

    private static func isVersion(_ value: String) -> Bool {
        guard value.utf8.count <= 64 else { return false }
        return value.range(of: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$",
                           options: .regularExpression) != nil
    }

    private static func isSafeFileName(_ value: String) -> Bool {
        guard !value.isEmpty, value.utf8.count <= 128,
              value == (value as NSString).lastPathComponent,
              value != ".", value != ".." else { return false }
        return value.utf8.allSatisfy { byte in
            byte >= 0x21 && byte <= 0x7e && byte != 0x2f && byte != 0x5c
        }
    }

    private static func isReason(_ value: String) -> Bool {
        guard !value.isEmpty, value.utf8.count <= 96 else { return false }
        return value.utf8.allSatisfy {
            (48...57).contains($0) || (97...122).contains($0) || $0 == 0x2d || $0 == 0x2e
        }
    }
}

enum LampFirmwareBackgroundJournalError: Error, Equatable {
    case invalidRecord(String)
    case activeSessionConflict
    case sessionNotFound
    case invalidTransition
    case offsetRegression
    case terminalSession
}

final class LampFirmwareBackgroundJournal {
    private let fileManager: FileManager
    private let directory: URL
    private let now: () -> Int64
    private let fileName = "firmware-background-session-v1.json"

    init(directory: URL, fileManager: FileManager = .default,
         now: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) {
        self.directory = directory
        self.fileManager = fileManager
        self.now = now
    }

    var recordURL: URL { directory.appendingPathComponent(fileName, isDirectory: false) }

    func load() throws -> LampFirmwareBackgroundRecord? {
        guard fileManager.fileExists(atPath: recordURL.path) else { return nil }
        let data = try Data(contentsOf: recordURL, options: [.mappedIfSafe])
        guard !data.isEmpty, data.count <= 16 * 1024 else {
            throw LampFirmwareBackgroundJournalError.invalidRecord("encoded-size")
        }
        let record: LampFirmwareBackgroundRecord
        do { record = try JSONDecoder().decode(LampFirmwareBackgroundRecord.self, from: data) }
        catch { throw LampFirmwareBackgroundJournalError.invalidRecord("encoding") }
        return try record.validated()
    }

    @discardableResult
    func stage(_ candidate: LampFirmwareBackgroundRecord) throws -> LampFirmwareBackgroundRecord {
        let value = try candidate.validated()
        guard value.phase == .awaitingArtifact || value.phase == .staged else {
            throw LampFirmwareBackgroundJournalError.invalidTransition
        }
        if let current = try load() {
            if current.sessionId == value.sessionId {
                guard current.immutableFieldsMatch(value) else {
                    throw LampFirmwareBackgroundJournalError.activeSessionConflict
                }
                if current.phase == .awaitingArtifact && value.phase == .staged {
                    var staged = current
                    staged.phase = .staged
                    staged.reason = nil
                    staged.updatedAtMs = max(now(), current.updatedAtMs + 1)
                    try save(staged)
                    return staged
                }
                return current
            }
            guard current.isTerminal else {
                throw LampFirmwareBackgroundJournalError.activeSessionConflict
            }
        }
        try save(value)
        return value
    }

    @discardableResult
    func transition(sessionId: String, to phase: LampFirmwareBackgroundPhase,
                    acknowledgedBytes: Int64? = nil, reason: String? = nil) throws -> LampFirmwareBackgroundRecord {
        guard var current = try load(), current.sessionId == sessionId else {
            throw LampFirmwareBackgroundJournalError.sessionNotFound
        }
        guard !current.isTerminal || phase == current.phase else {
            throw LampFirmwareBackgroundJournalError.terminalSession
        }
        guard current.phase.canTransition(to: phase) else {
            throw LampFirmwareBackgroundJournalError.invalidTransition
        }
        if let offset = acknowledgedBytes {
            guard offset >= current.acknowledgedBytes else {
                throw LampFirmwareBackgroundJournalError.offsetRegression
            }
            guard offset <= current.totalBytes else {
                throw LampFirmwareBackgroundJournalError.invalidRecord("byte-range")
            }
            current.acknowledgedBytes = offset
        }
        current.phase = phase
        current.reason = reason
        current.updatedAtMs = max(now(), current.updatedAtMs + 1)
        _ = try current.validated()
        try save(current)
        return current
    }

    func clearTerminal(sessionId: String) throws {
        guard let current = try load(), current.sessionId == sessionId else {
            throw LampFirmwareBackgroundJournalError.sessionNotFound
        }
        guard current.isTerminal else { throw LampFirmwareBackgroundJournalError.terminalSession }
        try fileManager.removeItem(at: recordURL)
    }

    private func save(_ record: LampFirmwareBackgroundRecord) throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(record)
        try data.write(to: recordURL, options: [.atomic])
    }
}
