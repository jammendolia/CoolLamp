import BackgroundTasks
import CoreBluetooth
import CryptoKit
import Foundation
import UIKit

struct LampFirmwareBackgroundStageInput {
    let sessionId: String
    let lampId: String
    let peripheralId: String
    let targetVersion: String
    let sha256: String
    let totalBytes: Int64
    let artifactFileName: String
    let artifactReady: Bool
}

enum LampFirmwareBackgroundCoordinatorError: Error, Equatable {
    case nativeDriverUnavailable
    case sessionNotFound
    case invalidSession
    case artifactUnavailable
    case unsafeToCancel
    case journal(String)
}

final class LampFirmwareBackgroundCoordinator: NSObject, CBCentralManagerDelegate {
    static let shared = LampFirmwareBackgroundCoordinator()
    static let continuedTaskIdentifier = "com.coollamp.controller.firmware-transfer"
    static let centralRestoreIdentifier = "com.coollamp.controller.firmware-central.v1"

    private let queue = DispatchQueue(label: "com.coollamp.controller.firmware-background",
                                      qos: .userInitiated)
    private let journal: LampFirmwareBackgroundJournal
    private let artifactDirectory: URL
    private var manager: CBCentralManager?
    private var prepared = false
    private var registeredContinuedTask = false
    private var bluetoothState = "unknown"
    private var restoredPeripheralIds: [String] = []

    // The wire transfer is intentionally not claimed as ready until the existing
    // OTA protocol has been ported and installed as a native driver.
    private var nativeTransferReady: Bool { false }

    private override init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory,
                                            in: .userDomainMask).first!
            .appendingPathComponent("CoolLamp", isDirectory: true)
            .appendingPathComponent("FirmwareBackground", isDirectory: true)
        journal = LampFirmwareBackgroundJournal(directory: base)
        artifactDirectory = base.appendingPathComponent("Artifacts", isDirectory: true)
        super.init()
    }

    func prepareForLaunch() {
        guard !prepared else { return }
        prepared = true
        if #available(iOS 26.0, *) { registerContinuedProcessingTask() }
        queue.async { [weak self] in
            guard let self = self, let record = try? self.journal.load(),
                  [.waitingForBluetooth, .transferring, .paused].contains(record.phase) else { return }
            self.ensureCentralManager()
        }
    }

    func capability(completion: @escaping ([String: Any]) -> Void) {
        queue.async {
            let continued: Bool
            if #available(iOS 26.0, *) { continued = true } else { continued = false }
            completion([
                "journalVersion": LampFirmwareBackgroundRecord.schemaVersion,
                "bluetoothCentral": true,
                "stateRestoration": true,
                "continuedProcessing": continued,
                "nativeTransferReady": self.nativeTransferReady,
                "maximumArtifactBytes": LampFirmwareBackgroundRecord.maximumArtifactBytes
            ])
        }
    }

    func state(completion: @escaping (Result<[String: Any], LampFirmwareBackgroundCoordinatorError>) -> Void) {
        queue.async {
            do {
                var value: [String: Any] = [
                    "bluetoothState": self.bluetoothState,
                    "restoredPeripheralIds": self.restoredPeripheralIds
                ]
                if let record = try self.journal.load() { value["record"] = record.capacitorValue }
                else { value["record"] = NSNull() }
                completion(.success(value))
            } catch { completion(.failure(.journal("read-failed"))) }
        }
    }

    func stage(_ input: LampFirmwareBackgroundStageInput,
               completion: @escaping (Result<LampFirmwareBackgroundRecord, LampFirmwareBackgroundCoordinatorError>) -> Void) {
        queue.async {
            if input.artifactReady && !self.verifyArtifact(
                named: input.artifactFileName, byteCount: input.totalBytes, sha256: input.sha256) {
                completion(.failure(.artifactUnavailable)); return
            }
            let record = LampFirmwareBackgroundRecord(
                version: LampFirmwareBackgroundRecord.schemaVersion,
                sessionId: input.sessionId,
                lampId: input.lampId,
                peripheralId: input.peripheralId,
                targetVersion: input.targetVersion,
                sha256: input.sha256,
                totalBytes: input.totalBytes,
                artifactFileName: input.artifactFileName,
                acknowledgedBytes: 0,
                phase: input.artifactReady ? .staged : .awaitingArtifact,
                reason: nil,
                updatedAtMs: Int64(Date().timeIntervalSince1970 * 1000))
            do {
                let saved = try self.journal.stage(record)
                self.applyFileProtection()
                completion(.success(saved))
            } catch let error as LampFirmwareBackgroundJournalError {
                completion(.failure(self.mapJournalError(error)))
            } catch { completion(.failure(.journal("write-failed"))) }
        }
    }

    func start(sessionId: String, resume: Bool,
               completion: @escaping (Result<LampFirmwareBackgroundRecord, LampFirmwareBackgroundCoordinatorError>) -> Void) {
        queue.async {
            do {
                guard let record = try self.journal.load(), record.sessionId == sessionId else {
                    completion(.failure(.sessionNotFound)); return
                }
                guard record.phase != .awaitingArtifact else {
                    completion(.failure(.artifactUnavailable)); return
                }
                // Do not turn a durable staged record into a claim that native
                // transfer began until the production CoreBluetooth wire driver exists.
                guard self.nativeTransferReady else {
                    completion(.failure(.nativeDriverUnavailable)); return
                }
                completion(.success(record))
            } catch { completion(.failure(.journal("read-failed"))) }
        }
    }

    func cancel(sessionId: String,
                completion: @escaping (Result<LampFirmwareBackgroundRecord, LampFirmwareBackgroundCoordinatorError>) -> Void) {
        queue.async {
            do {
                guard let current = try self.journal.load(), current.sessionId == sessionId else {
                    completion(.failure(.sessionNotFound)); return
                }
                guard ![.verifying, .committing].contains(current.phase) else {
                    completion(.failure(.unsafeToCancel)); return
                }
                let record = current.phase == .cancelled ? current :
                    try self.journal.transition(sessionId: sessionId, to: .cancelled,
                                                reason: "user-cancelled")
                if #available(iOS 26.0, *) {
                    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.continuedTaskIdentifier)
                }
                self.applyFileProtection()
                completion(.success(record))
            } catch let error as LampFirmwareBackgroundJournalError {
                completion(.failure(self.mapJournalError(error)))
            } catch { completion(.failure(.journal("write-failed"))) }
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        bluetoothState = Self.bluetoothStateName(central.state)
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        let peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        restoredPeripheralIds = peripherals.map { $0.identifier.uuidString }.sorted()
        guard let record = try? journal.load(),
              !record.isTerminal,
              restoredPeripheralIds.contains(where: {
                  $0.caseInsensitiveCompare(record.peripheralId) == .orderedSame
              }), [.waitingForBluetooth, .transferring].contains(record.phase) else { return }
        _ = try? journal.transition(sessionId: record.sessionId, to: .paused,
                                    reason: "restored-awaiting-driver")
        applyFileProtection()
    }

    @available(iOS 26.0, *)
    private func registerContinuedProcessingTask() {
        guard !registeredContinuedTask else { return }
        registeredContinuedTask = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.continuedTaskIdentifier, using: queue
        ) { [weak self] task in
            guard let self = self, let continued = task as? BGContinuedProcessingTask else {
                task.setTaskCompleted(success: false); return
            }
            self.handleContinuedProcessingTask(continued)
        }
    }

    @available(iOS 26.0, *)
    private func handleContinuedProcessingTask(_ task: BGContinuedProcessingTask) {
        guard let record = try? journal.load() else {
            task.setTaskCompleted(success: false); return
        }
        task.progress.totalUnitCount = record.totalBytes
        task.progress.completedUnitCount = record.acknowledgedBytes
        task.expirationHandler = { [weak self, weak task] in
            guard let self = self, let task = task else { return }
            self.queue.async {
                if let value = try? self.journal.load(),
                   [.waitingForBluetooth, .transferring].contains(value.phase) {
                    _ = try? self.journal.transition(sessionId: value.sessionId, to: .paused,
                                                     reason: "system-expired")
                    self.applyFileProtection()
                }
                task.setTaskCompleted(success: false)
            }
        }
        // Registration is live now, but submitting this task remains gated on a
        // production native transfer driver. A restored stale request fails closed.
        if [.waitingForBluetooth, .transferring].contains(record.phase) {
            _ = try? journal.transition(sessionId: record.sessionId, to: .paused,
                                        reason: "native-driver-unavailable")
            applyFileProtection()
        }
        task.setTaskCompleted(success: false)
    }

    private func applyFileProtection() {
        try? FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: journal.recordURL.path)
    }

    private func verifyArtifact(named fileName: String, byteCount: Int64, sha256: String) -> Bool {
        let url = artifactDirectory.appendingPathComponent(fileName, isDirectory: false)
        guard url.deletingLastPathComponent() == artifactDirectory,
              let data = try? Data(contentsOf: url, options: [.mappedIfSafe]),
              Int64(data.count) == byteCount else { return false }
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return digest == sha256
    }

    private func ensureCentralManager() {
        guard manager == nil else { return }
        manager = CBCentralManager(delegate: self, queue: queue, options: [
            CBCentralManagerOptionRestoreIdentifierKey: Self.centralRestoreIdentifier,
            CBCentralManagerOptionShowPowerAlertKey: false
        ])
    }

    private func mapJournalError(_ error: LampFirmwareBackgroundJournalError) -> LampFirmwareBackgroundCoordinatorError {
        switch error {
        case .activeSessionConflict: return .invalidSession
        case .sessionNotFound: return .sessionNotFound
        case .terminalSession, .invalidTransition: return .invalidSession
        case .invalidRecord(let code): return .journal(code)
        case .offsetRegression: return .journal("offset-regression")
        }
    }

    private static func bluetoothStateName(_ state: CBManagerState) -> String {
        switch state {
        case .unknown: return "unknown"
        case .resetting: return "resetting"
        case .unsupported: return "unsupported"
        case .unauthorized: return "unauthorized"
        case .poweredOff: return "powered-off"
        case .poweredOn: return "powered-on"
        @unknown default: return "unknown"
        }
    }
}

extension LampFirmwareBackgroundRecord {
    var capacitorValue: [String: Any] {
        var value: [String: Any] = [
            "version": version,
            "sessionId": sessionId,
            "lampId": lampId,
            "peripheralId": peripheralId,
            "targetVersion": targetVersion,
            "sha256": sha256,
            "totalBytes": totalBytes,
            "artifactFileName": artifactFileName,
            "acknowledgedBytes": acknowledgedBytes,
            "phase": phase.rawValue,
            "updatedAtMs": updatedAtMs
        ]
        if let reason = reason { value["reason"] = reason }
        else { value["reason"] = NSNull() }
        return value
    }
}
