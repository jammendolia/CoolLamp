import Foundation
import Capacitor
import Security

@objc(LampNetworkPlugin)
public class LampNetworkPlugin: CAPPlugin, CAPBridgedPlugin, NetServiceBrowserDelegate, NetServiceDelegate {
    public let identifier = "LampNetworkPlugin"
    public let jsName = "LampNetwork"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "credential", returnType: CAPPluginReturnPromise)
    ]
    private var browser: NetServiceBrowser?
    private var services: [NetService] = []
    private var found: [[String: String]] = []
    private var pending: CAPPluginCall?
    private var deadline: DispatchWorkItem?

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
        guard pending != nil, services.contains(sender), sender.port == 80, let host = sender.hostName else { return }
        let txt = NetService.dictionary(fromTXTRecord: sender.txtRecordData() ?? Data())
        guard let idData = txt["id"], let id = String(data:idData,encoding:.utf8), !id.isEmpty else { return }
        let name = txt["name"].flatMap { String(data:$0,encoding:.utf8) } ?? sender.name
        let address = "http://" + host.trimmingCharacters(in: CharacterSet(charactersIn: "."))
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
    override func capacitorDidLoad() { bridge?.registerPluginInstance(LampNetworkPlugin()) }
}
