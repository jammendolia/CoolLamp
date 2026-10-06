import Foundation
import UIKit
import CoreBluetooth
import AccessorySetupKit
import Capacitor

@objc(LampAccessoryPlugin)
public class LampAccessoryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LampAccessoryPlugin"
    public let jsName = "LampAccessory"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "select", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "migrate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]
    private var coordinator: AnyObject?

    @available(iOS 18.0, *)
    private func perform(_ call: CAPPluginCall, _ action: @escaping (LampAccessoryCoordinator) -> Void) {
        DispatchQueue.main.async {
                if self.coordinator == nil { self.coordinator = LampAccessoryCoordinator() }
                guard let manager = self.coordinator as? LampAccessoryCoordinator else { return }
                manager.ready { error in
                    if let error = error { call.reject(error.localizedDescription); return }
                    action(manager)
                }
        }
    }
    private func legacy(_ call: CAPPluginCall) { call.resolve(["supported": false, "devices": [], "removed": false]) }
    @objc func list(_ call: CAPPluginCall) {
        if #available(iOS 18.0, *) { perform(call) { call.resolve(["supported": true, "devices": $0.devices]) } }
        else { legacy(call) }
    }
    @objc func select(_ call: CAPPluginCall) {
        if #available(iOS 18.0, *) { perform(call) { $0.pick(call) } } else { legacy(call) }
    }
    @objc func migrate(_ call: CAPPluginCall) {
        if #available(iOS 18.0, *) { perform(call) { $0.migrate(call) } } else { legacy(call) }
    }
    @objc func remove(_ call: CAPPluginCall) {
        if #available(iOS 18.0, *) { perform(call) { $0.remove(call) } } else { legacy(call) }
    }
}

@available(iOS 18.0, *)
private final class LampAccessoryCoordinator {
    private let session = ASAccessorySession()
    private var activated = false
    private var activationError: Error?
    private var waiters: [(Error?) -> Void] = []
    private var pending: CAPPluginCall?
    private var migrating = false
    private var pickerPresented = false
    private var pickerPending = false
    private var chosen: ASAccessory?
    private var pickerError: Error?
    private var migrationIDs: Set<UUID> = []
    private let service = "7b610001-6e2b-4f3d-9a71-28e45c001001"

    init() {
        session.activate(on: .main) { [weak self] event in self?.handle(event) }
    }
    deinit { session.invalidate() }

    func ready(_ completion: @escaping (Error?) -> Void) {
        if activated { completion(nil) }
        else if let error = activationError { completion(error) }
        else { waiters.append(completion) }
    }
    var devices: [JSObject] {
        session.accessories.compactMap { accessory in
            guard let id = accessory.bluetoothIdentifier else { return nil }
            return ["deviceId": id.uuidString, "name": accessory.displayName, "accessoryManaged": true]
        }
    }
    private func descriptor() -> ASDiscoveryDescriptor {
        let descriptor = ASDiscoveryDescriptor()
        descriptor.bluetoothServiceUUID = CBUUID(string: service)
        descriptor.bluetoothNameSubstring = "CoolLamp"
        descriptor.supportedOptions = [.bluetoothPairingLE]
        return descriptor
    }
    private var productImage: UIImage {
        UIImage(named: "CoolLampAccessory") ?? UIImage(systemName: "lightbulb.fill")!
    }
    private func begin(_ call: CAPPluginCall, migrating: Bool) -> Bool {
        guard pending == nil else { call.reject("Accessory setup is already in progress."); return false }
        pending = call; self.migrating = migrating; chosen = nil; pickerError = nil; pickerPresented = false; pickerPending = true
        migrationIDs = []
        return true
    }
    func pick(_ call: CAPPluginCall) {
        guard begin(call, migrating: false) else { return }
        let item = ASPickerDisplayItem(name: "CoolLamp", productImage: productImage, descriptor: descriptor())
        item.setupOptions = [.rename]
        show([item])
    }
    func migrate(_ call: CAPPluginCall) {
        guard begin(call, migrating: true) else { return }
        let entries = call.getArray("devices", JSObject.self) ?? []
        let existing = Set(session.accessories.compactMap { $0.bluetoothIdentifier })
        var items: [ASPickerDisplayItem] = []
        for entry in entries.prefix(64) {
            guard let text = entry["deviceId"] as? String, let id = UUID(uuidString: text) else {
                fail("Invalid saved Bluetooth identity."); return
            }
            if existing.contains(id) || migrationIDs.contains(id) { continue }
            migrationIDs.insert(id)
            let item = ASMigrationDisplayItem(name: entry["name"] as? String ?? "CoolLamp",
                productImage: productImage, descriptor: descriptor())
            item.peripheralIdentifier = id; items.append(item)
        }
        if items.isEmpty { finishMigration(); return }
        show(items)
    }
    private func show(_ items: [ASPickerDisplayItem]) {
        let request = pending
        session.showPicker(for: items) { [weak self] error in
            guard let self = self, self.pending === request, self.pickerPending, let error = error else { return }
            self.pickerError = error
            if !self.pickerPresented { self.fail(error.localizedDescription, error: error) }
        }
    }
    func remove(_ call: CAPPluginCall) {
        guard pending == nil else { call.reject("Finish accessory setup before removing a lamp."); return }
        guard let text = call.getString("deviceId"), let id = UUID(uuidString: text) else {
            call.reject("Invalid Bluetooth identity."); return
        }
        guard let accessory = session.accessories.first(where: { $0.bluetoothIdentifier == id }) else {
            call.resolve(["removed": false]); return
        }
        pending = call; pickerPending = false
        session.removeAccessory(accessory) { [weak self] error in
            guard let self = self, self.pending === call else { return }
            self.pending = nil
            if let error = error { call.reject(error.localizedDescription, "ACCESSORY_REMOVE_FAILED", error) }
            else { call.resolve(["removed": true]) }
        }
    }
    private func finishMigration() {
        let current = Set(session.accessories.compactMap { $0.bluetoothIdentifier })
        guard migrationIDs.isSubset(of: current) else {
            fail("Apple did not authorize every saved lamp. Try again; your saved lamps are unchanged."); return
        }
        let call = pending; pending = nil; pickerPending = false
        call?.resolve(["supported": true, "devices": devices])
    }
    private func fail(_ message: String, error: Error? = nil) {
        let call = pending; pending = nil; pickerPending = false
        let nsError = error as NSError?
        var code = "ACCESSORY_SETUP_FAILED"
        if nsError?.domain == ASErrorDomain && nsError?.code == 700 { code = "PAIRING_CANCELLED" }
        if message.localizedCaseInsensitiveContains("peer removed pairing information") { code = "PAIRING_KEYS_CHANGED" }
        let data: JSObject? = chosen.flatMap { accessory in
            guard let id = accessory.bluetoothIdentifier else { return nil }
            return ["device": ["deviceId": id.uuidString, "name": accessory.displayName]]
        }
        call?.reject(message, code, error, data)
    }
    private func handle(_ event: ASAccessoryEvent) {
        switch event.eventType {
        case .activated:
            activated = true; let callbacks = waiters; waiters = []; callbacks.forEach { $0(nil) }
        case .invalidated:
            let error = event.error ?? NSError(domain: ASErrorDomain, code: 400,
                userInfo: [NSLocalizedDescriptionKey: "Accessory setup stopped. Close and reopen CoolLamp."])
            activated = false; activationError = error
            let callbacks = waiters; waiters = []; callbacks.forEach { $0(error) }
            fail(error.localizedDescription, error: error)
        case .pickerDidPresent: if pickerPending { pickerPresented = true }
        case .accessoryAdded:
            if pickerPending, !migrating, pending != nil { chosen = event.accessory }
        case .pickerSetupFailed:
            if pickerPending {
                pickerError = event.error
                if chosen == nil { chosen = event.accessory }
            }
        case .migrationComplete:
            if pickerPending, migrating, pending != nil, !pickerPresented,
                migrationIDs.isSubset(of: Set(session.accessories.compactMap { $0.bluetoothIdentifier })) { finishMigration() }
        case .pickerDidDismiss:
            guard pending != nil, pickerPending else { return }
            if let error = pickerError ?? event.error { fail(error.localizedDescription, error: error); return }
            if migrating { finishMigration(); return }
            guard let accessory = chosen, let id = accessory.bluetoothIdentifier else {
                fail("Accessory setup was cancelled.", error: NSError(domain: ASErrorDomain, code: 700)); return
            }
            let call = pending; pending = nil; pickerPending = false
            call?.resolve(["deviceId": id.uuidString, "name": accessory.displayName, "accessoryManaged": true])
        default: break
        }
    }
}
