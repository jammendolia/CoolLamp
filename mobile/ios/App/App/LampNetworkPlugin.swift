import Foundation
import Capacitor
import CryptoKit
import Security
import UIKit

private struct HomeInstallationIdentityRecord: Codable {
    let version: Int
    let installationId: String
    let credentialKeyId: String
    let credentialGeneration: Int
    let displayName: String
    let publicKeyThumbprint: String
    let keyState: String

    var capacitorValue: [String: Any] {
        ["version": version, "installationId": installationId,
         "credentialKeyId": credentialKeyId, "credentialGeneration": credentialGeneration,
         "displayName": displayName, "publicKeyThumbprint": publicKeyThumbprint,
         "keyState": keyState]
    }
}

private enum HomeInstallationIdentityFailure: Error {
    case locked
    case unavailable
    case recovery
}

@objc(LampNetworkPlugin)
public class LampNetworkPlugin: CAPPlugin, CAPBridgedPlugin, NetServiceBrowserDelegate, NetServiceDelegate {
    public let identifier = "LampNetworkPlugin"
    public let jsName = "LampNetwork"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "credential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "homeInstallationIdentity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "firmwareDigest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFirmwareScreenAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "firmwareBackgroundCapability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "firmwareBackgroundState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stageFirmwareBackgroundUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startFirmwareBackgroundUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeFirmwareBackgroundUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelFirmwareBackgroundUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginFirmwareHandoff", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endFirmwareHandoff", returnType: CAPPluginReturnPromise)
    ]
    private var browser: NetServiceBrowser?
    private var services: [NetService] = []
    private var found: [[String: String]] = []
    private var pending: CAPPluginCall?
    private var deadline: DispatchWorkItem?
    private static let firmwareScreenAwake = LampFirmwareScreenAwake(
        readFlag: { UIApplication.shared.isIdleTimerDisabled },
        writeFlag: { UIApplication.shared.isIdleTimerDisabled = $0 })
    private static let firmwareHandoff = LampFirmwareHandoffLease(
        invalidTask: UIBackgroundTaskIdentifier.invalid.rawValue,
        beginTask: { expiration in
            UIApplication.shared.beginBackgroundTask(
                withName: "CoolLamp firmware handoff", expirationHandler: expiration).rawValue
        },
        endTask: { rawValue in
            UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: rawValue))
        })
    private let homeIdentityQueue = DispatchQueue(label: "com.coollamp.controller.home-installation-identity")
    private static let homeIdentityFreshInstallMarker = "coollamp.home-installation-identity.initialized.v1"
    private static let homeIdentityKeyTag = Data("com.coollamp.controller.home-installation-key.v1".utf8)
    private static let homeIdentityMetadataService = "com.coollamp.controller.home-installation"
    private static let homeIdentityMetadataAccount = "identity.v1"
    private static let p256SubjectPublicKeyInfoHeader = Data([
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce,
        0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
        0x03, 0x01, 0x07, 0x03, 0x42, 0x00
    ])
    private var firmwareScreenToken: String?
    private var firmwareBackgroundObserver: NSObjectProtocol?

    public override func load() {
        super.load()
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.firmwareBackgroundObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
            ) { [weak self] _ in self?.restoreFirmwareScreenAwake() }
        }
    }

    deinit {
        if let observer = firmwareBackgroundObserver { NotificationCenter.default.removeObserver(observer) }
        if let token = firmwareScreenToken {
            let lease = Self.firmwareScreenAwake
            let restore = { _ = try? lease.set(token: token, enabled: false, foreground: false) }
            if Thread.isMainThread { restore() }
            else { DispatchQueue.main.async(execute: restore) }
        }
    }

    private func restoreFirmwareScreenAwake() {
        if let token = firmwareScreenToken {
            firmwareScreenToken = nil
            _ = try? Self.firmwareScreenAwake.set(token: token, enabled: false, foreground: false)
        }
    }

    @objc func setFirmwareScreenAwake(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), let enabled = call.getBool("enabled") else {
            call.reject("Invalid firmware screen lease."); return
        }
        DispatchQueue.main.async {
            do {
                let active = try Self.firmwareScreenAwake.set(token: token, enabled: enabled,
                    foreground: UIApplication.shared.applicationState == .active)
                if enabled { self.firmwareScreenToken = token }
                else if self.firmwareScreenToken == token { self.firmwareScreenToken = nil }
                call.resolve(["active": active])
            } catch LampFirmwareScreenAwake.Failure.notForeground {
                call.reject("Keep the app in the foreground to update through Bluetooth.")
            } catch LampFirmwareScreenAwake.Failure.alreadyOwned {
                call.reject("Another firmware transfer already holds the screen awake.")
            } catch {
                call.reject("Invalid firmware screen lease.")
            }
        }
    }

    @objc func firmwareDigest(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"), encoded.utf8.count <= 2_708_824 else {
            call.reject("Invalid firmware image."); return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            guard let digest = LampFirmwareDigest.sha256(encoded) else {
                call.reject("Invalid firmware image."); return
            }
            call.resolve(["sha256": digest])
        }
    }

    @objc func firmwareBackgroundCapability(_ call: CAPPluginCall) {
        LampFirmwareBackgroundCoordinator.shared.capability { call.resolve($0) }
    }

    @objc func firmwareBackgroundState(_ call: CAPPluginCall) {
        LampFirmwareBackgroundCoordinator.shared.state { result in
            switch result {
            case .success(let value): call.resolve(value)
            case .failure(let error): self.rejectFirmwareBackground(call, error)
            }
        }
    }

    @objc func stageFirmwareBackgroundUpdate(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId"),
              let lampId = call.getString("lampId"),
              let peripheralId = call.getString("peripheralId"),
              let targetVersion = call.getString("targetVersion"),
              let sha256 = call.getString("sha256"),
              let totalBytes = call.getInt("totalBytes"),
              let artifactFileName = call.getString("artifactFileName") else {
            call.reject("Invalid background firmware session.", "invalid-background-firmware-session")
            return
        }
        let input = LampFirmwareBackgroundStageInput(
            sessionId: sessionId, lampId: lampId, peripheralId: peripheralId,
            targetVersion: targetVersion, sha256: sha256, totalBytes: Int64(totalBytes),
            artifactFileName: artifactFileName,
            artifactReady: call.getBool("artifactReady") ?? false)
        LampFirmwareBackgroundCoordinator.shared.stage(input) { result in
            switch result {
            case .success(let record): call.resolve(["record": record.capacitorValue])
            case .failure(let error): self.rejectFirmwareBackground(call, error)
            }
        }
    }

    @objc func startFirmwareBackgroundUpdate(_ call: CAPPluginCall) {
        runFirmwareBackgroundUpdate(call, resume: false)
    }

    @objc func resumeFirmwareBackgroundUpdate(_ call: CAPPluginCall) {
        runFirmwareBackgroundUpdate(call, resume: true)
    }

    private func runFirmwareBackgroundUpdate(_ call: CAPPluginCall, resume: Bool) {
        guard let sessionId = call.getString("sessionId") else {
            call.reject("Invalid background firmware session.", "invalid-background-firmware-session")
            return
        }
        LampFirmwareBackgroundCoordinator.shared.start(sessionId: sessionId, resume: resume) { result in
            switch result {
            case .success(let record): call.resolve(["record": record.capacitorValue])
            case .failure(let error): self.rejectFirmwareBackground(call, error)
            }
        }
    }

    @objc func cancelFirmwareBackgroundUpdate(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId") else {
            call.reject("Invalid background firmware session.", "invalid-background-firmware-session")
            return
        }
        LampFirmwareBackgroundCoordinator.shared.cancel(sessionId: sessionId) { result in
            switch result {
            case .success(let record): call.resolve(["record": record.capacitorValue])
            case .failure(let error): self.rejectFirmwareBackground(call, error)
            }
        }
    }

    @objc func beginFirmwareHandoff(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId") else {
            call.reject("Invalid firmware handoff session.", "invalid-firmware-handoff")
            return
        }
        DispatchQueue.main.async {
            do {
                call.resolve(["active": try Self.firmwareHandoff.begin(session: sessionId)])
            } catch LampFirmwareHandoffLease.Failure.alreadyOwned {
                call.reject("Another firmware handoff is already active.", "firmware-handoff-owned")
            } catch LampFirmwareHandoffLease.Failure.unavailable {
                call.reject("The firmware handoff could not continue in the background.",
                            "firmware-handoff-unavailable")
            } catch {
                call.reject("Invalid firmware handoff session.", "invalid-firmware-handoff")
            }
        }
    }

    @objc func endFirmwareHandoff(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId") else {
            call.reject("Invalid firmware handoff session.", "invalid-firmware-handoff")
            return
        }
        DispatchQueue.main.async {
            do {
                call.resolve(["active": try Self.firmwareHandoff.end(session: sessionId)])
            } catch {
                call.reject("Invalid firmware handoff session.", "invalid-firmware-handoff")
            }
        }
    }

    private func rejectFirmwareBackground(_ call: CAPPluginCall,
                                          _ error: LampFirmwareBackgroundCoordinatorError) {
        switch error {
        case .nativeDriverUnavailable:
            call.reject("Native background Bluetooth transfer is not available in this build.",
                        "native-firmware-driver-unavailable")
        case .sessionNotFound:
            call.reject("The background firmware session was not found.",
                        "background-firmware-session-not-found")
        case .artifactUnavailable:
            call.reject("The firmware artifact has not been staged on this device.",
                        "background-firmware-artifact-unavailable")
        case .unsafeToCancel:
            call.reject("The firmware update is already verifying or committing.",
                        "background-firmware-cancel-unsafe")
        case .invalidSession:
            call.reject("The background firmware session conflicts with active work.",
                        "background-firmware-session-conflict")
        case .journal(let code):
            call.reject("The protected firmware session could not be read or saved.",
                        "background-firmware-journal-\(code)")
        }
    }

    private static func homeIdentityMetadataQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: homeIdentityMetadataService,
         kSecAttrAccount as String: homeIdentityMetadataAccount]
    }

    private static func homeIdentityKeyQuery() -> [String: Any] {
        [kSecClass as String: kSecClassKey,
         kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
         kSecAttrApplicationTag as String: homeIdentityKeyTag,
         kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave]
    }

    private static func deleteHomeIdentityArtifacts() throws {
        for query in [homeIdentityMetadataQuery(), homeIdentityKeyQuery()] {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                if status == errSecInteractionNotAllowed { throw HomeInstallationIdentityFailure.locked }
                throw HomeInstallationIdentityFailure.unavailable
            }
        }
    }

    private static func randomOpaqueId(excluding: String? = nil) throws -> String {
        for _ in 0..<4 {
            var bytes = [UInt8](repeating: 0, count: 16)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
                throw HomeInstallationIdentityFailure.unavailable
            }
            let value = bytes.map { String(format: "%02x", $0) }.joined()
            if value != String(repeating: "0", count: 32), value != excluding { return value }
        }
        throw HomeInstallationIdentityFailure.unavailable
    }

    private static func validLowerHex(_ value: String, count: Int, nonzero: Bool = false) -> Bool {
        guard value.count == count,
              value.range(of: "^[a-f0-9]{\(count)}$", options: .regularExpression) != nil else { return false }
        return !nonzero || value != String(repeating: "0", count: count)
    }

    private static func publicKeyThumbprint(_ privateKey: SecKey) throws -> String {
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw HomeInstallationIdentityFailure.recovery
        }
        var error: Unmanaged<CFError>?
        guard let point = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?,
              point.count == 65, point.first == 0x04 else {
            throw HomeInstallationIdentityFailure.recovery
        }
        let digest = SHA256.hash(data: p256SubjectPublicKeyInfoHeader + point)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func readHomeIdentityMetadata() throws -> HomeInstallationIdentityRecord {
        var query = homeIdentityMetadataQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecInteractionNotAllowed { throw HomeInstallationIdentityFailure.locked }
        guard status == errSecSuccess, let data = item as? Data, data.count <= 2048 else {
            throw HomeInstallationIdentityFailure.recovery
        }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(json.keys) == Set(["version", "installationId", "credentialKeyId",
                                     "credentialGeneration", "displayName",
                                     "publicKeyThumbprint", "keyState"]),
              let value = try? JSONDecoder().decode(HomeInstallationIdentityRecord.self, from: data),
              value.version == 1, value.credentialGeneration == 1,
              value.keyState == "active",
              ["This iPhone", "This iPad"].contains(value.displayName),
              validLowerHex(value.installationId, count: 32, nonzero: true),
              validLowerHex(value.credentialKeyId, count: 32, nonzero: true),
              value.installationId != value.credentialKeyId,
              validLowerHex(value.publicKeyThumbprint, count: 64) else {
            throw HomeInstallationIdentityFailure.recovery
        }
        return value
    }

    private static func readHomeIdentityKey() throws -> SecKey {
        var query = homeIdentityKeyQuery()
        query[kSecReturnRef as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecInteractionNotAllowed { throw HomeInstallationIdentityFailure.locked }
        guard status == errSecSuccess, item != nil else {
            throw HomeInstallationIdentityFailure.recovery
        }
        return item as! SecKey
    }

    private static func readVerifiedHomeIdentity() throws -> HomeInstallationIdentityRecord {
        let metadata = try readHomeIdentityMetadata()
        let key = try readHomeIdentityKey()
        guard try publicKeyThumbprint(key) == metadata.publicKeyThumbprint else {
            throw HomeInstallationIdentityFailure.recovery
        }
        return metadata
    }

    private static func createHomeIdentity(displayName: String) throws -> HomeInstallationIdentityRecord {
        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage], &accessError) else {
            throw HomeInstallationIdentityFailure.unavailable
        }
        let privateAttributes: [String: Any] = [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: homeIdentityKeyTag,
            kSecAttrAccessControl as String: access
        ]
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: privateAttributes
        ]
        var keyError: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &keyError) else {
            throw HomeInstallationIdentityFailure.unavailable
        }
        let installationId = try randomOpaqueId()
        let credentialKeyId = try randomOpaqueId(excluding: installationId)
        let metadata = HomeInstallationIdentityRecord(version: 1,
            installationId: installationId, credentialKeyId: credentialKeyId,
            credentialGeneration: 1, displayName: displayName,
            publicKeyThumbprint: try publicKeyThumbprint(privateKey), keyState: "active")
        let encoded: Data
        do { encoded = try JSONEncoder().encode(metadata) }
        catch { throw HomeInstallationIdentityFailure.unavailable }
        let query = homeIdentityMetadataQuery().merging([
            kSecValueData as String: encoded,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]) { _, new in new }
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else {
            _ = try? deleteHomeIdentityArtifacts()
            throw HomeInstallationIdentityFailure.unavailable
        }
        return try readVerifiedHomeIdentity()
    }

    private static func loadOrCreateHomeIdentity(displayName: String) throws -> HomeInstallationIdentityRecord {
        let defaults = UserDefaults.standard
        let marker = defaults.object(forKey: homeIdentityFreshInstallMarker)
        if marker == nil {
            try deleteHomeIdentityArtifacts()
            do {
                let value = try createHomeIdentity(displayName: displayName)
                defaults.set(true, forKey: homeIdentityFreshInstallMarker)
                return value
            } catch {
                _ = try? deleteHomeIdentityArtifacts()
                throw error
            }
        }
        guard defaults.bool(forKey: homeIdentityFreshInstallMarker) else {
            throw HomeInstallationIdentityFailure.recovery
        }
        return try readVerifiedHomeIdentity()
    }

    @objc func homeInstallationIdentity(_ call: CAPPluginCall) {
        let displayName = UIDevice.current.userInterfaceIdiom == .pad ? "This iPad" : "This iPhone"
        homeIdentityQueue.async {
            do {
                call.resolve(try Self.loadOrCreateHomeIdentity(displayName: displayName).capacitorValue)
            } catch HomeInstallationIdentityFailure.locked {
                call.reject("Unlock this device, then check this phone's Home access again.", "home-identity-locked")
            } catch HomeInstallationIdentityFailure.recovery {
                call.reject("This phone's Home identity needs recovery. Reinstall the app before joining a Home again.", "home-identity-recovery")
            } catch {
                call.reject("This device could not create a protected Home identity.", "home-identity-unavailable")
            }
        }
    }

    @objc func discover(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("Discovery is already running."); return }
            self.pending = call; self.found = []; self.services = []
            let browser = NetServiceBrowser(); self.browser = browser; browser.delegate = self
            browser.searchForServices(ofType: "_coollamp._tcp.", inDomain: "local.")
            let task = DispatchWorkItem { [weak self] in self?.finish() }
            self.deadline = task; DispatchQueue.main.asyncAfter(deadline: .now()+8, execute: task)
        }
    }
    private func finish(_ error: String? = nil) {
        deadline?.cancel(); deadline = nil
        browser?.stop(); browser?.delegate = nil; browser = nil
        services.forEach { $0.stop(); $0.delegate = nil }; services = []
        let call = pending; pending = nil
        if let error = error { call?.reject(error) } else { call?.resolve(["lamps": found]) }
    }
    public func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        guard browser === self.browser else { return }
        finish("Could not search the local network. Allow Local Network access in Settings, then try again.")
    }
    public func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        guard browser === self.browser, services.count < 64 else { return }
        services.append(service); service.delegate = self; service.resolve(withTimeout: 5)
    }
    public func netServiceDidResolveAddress(_ sender: NetService) {
        guard pending != nil, services.contains(sender), sender.port == 80,
              let address = LampNetworkAddress.url(addresses: sender.addresses ?? [], hostname: sender.hostName) else { return }
        let txt = NetService.dictionary(fromTXTRecord: sender.txtRecordData() ?? Data())
        guard let idData = txt["id"], let id = String(data:idData,encoding:.utf8), !id.isEmpty else { return }
        let name = txt["name"].flatMap { String(data:$0,encoding:.utf8) } ?? sender.name
        found.removeAll { $0["id"] == id }; found.append(["id":id,"name":name,"address":address])
    }
    @objc func credential(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty, id.count <= 128 else { call.reject("Invalid lamp identity."); return }
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,
            kSecAttrService as String:"com.coollamp.controller.lamps", kSecAttrAccount as String:id]
        if let value = call.getString("value") {
            if value.isEmpty {
                let result = SecItemDelete(query as CFDictionary)
                guard result == errSecSuccess || result == errSecItemNotFound else { call.reject("Could not remove password."); return }
            } else {
                let attributes: [String:Any] = [kSecValueData as String:Data(value.utf8), kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
                let result = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
                if result == errSecItemNotFound {
                    guard SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary,nil) == errSecSuccess else { call.reject("Could not save password."); return }
                } else if result != errSecSuccess { call.reject("Could not save password."); return }
            }
            call.resolve(); return
        }
        var read = query; read[kSecReturnData as String] = true; read[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(read as CFDictionary, &result)
        guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("Unlock your phone to access the lamp password."); return }
        call.resolve(["value": (result as? Data).flatMap { String(data:$0,encoding:.utf8) } ?? ""])
    }
}

class LampViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LampNetworkPlugin())
        bridge?.registerPluginInstance(LampAccessoryPlugin())
    }
}
