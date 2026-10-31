import AppKit
import Foundation
import WebKit

// Use the production implementations in WebKit's Window environment. These
// acquisition/queue paths do not call the broker's imported catalog/style helpers.
func productionModule(_ name: String, symbol: String, root: URL) throws -> String {
    let source = try String(contentsOf: root.appendingPathComponent("src/\(name).js"), encoding: .utf8)
    let body = source
        .replacingOccurrences(of: #"(?m)^import [^\r\n]*(?:\r?\n|$)"#, with: "", options: .regularExpression)
        .replacingOccurrences(of: #"(?m)^export (?=(?:class|function)\b)"#, with: "", options: .regularExpression)
    return "const \(symbol) = (() => {\n'use strict';\n\(body)\nreturn \(symbol);\n})();\n"
}

@MainActor
final class WindowTimerSmoke: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let webView: WKWebView
    let script: String
    private(set) var result: Int32?
    private(set) var currentTest = "loading the local WebKit page"

    init(script: String) {
        self.script = script
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 100, height: 100), configuration: configuration)
        super.init()
        configuration.userContentController.add(self, name: "smoke")
        webView.navigationDelegate = self
    }

    func start() {
        webView.loadHTMLString("<!doctype html><meta charset='utf-8'><title>Window timer smoke test</title>", baseURL: nil)
    }

    func fail(_ message: String) {
        guard result == nil else { return }
        FileHandle.standardError.write(Data("FAIL: \(currentTest): \(message)\n".utf8))
        result = 1
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        currentTest = "starting the production JavaScript"
        webView.evaluateJavaScript(script) { _, error in
            if let error { self.fail(error.localizedDescription) }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error.localizedDescription)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        fail("WebKit's web content process terminated")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard result == nil else { return }
        guard let body = message.body as? [String: String], let phase = body["phase"] else {
            fail("invalid test result from JavaScript")
            return
        }
        switch phase {
        case "running": currentTest = body["name"] ?? "unnamed test"
        case "passed": print("PASS: \(body["name"] ?? currentTest)")
        case "complete": result = 0
        case "failed": fail(body["message"] ?? "unknown JavaScript error")
        default: fail("unexpected test phase: \(phase)")
        }
    }
}

let root = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? FileManager.default.currentDirectoryPath, isDirectory: true)
let modules: String
do {
    modules = try productionModule("connection-broker", symbol: "ConnectionBroker", root: root)
        + productionModule("live-light", symbol: "LiveLightQueue", root: root)
} catch {
    FileHandle.standardError.write(Data("FAIL: reading production JavaScript: \(error)\n".utf8))
    exit(1)
}

let tests = #"""
const report = body => window.webkit.messageHandlers.smoke.postMessage(body);
const fail = error => report({phase: 'failed', message: String(error?.stack || error)});
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));
const assert = (condition, message) => { if (!condition) throw Error(message); };
const pause = delay => new Promise(resolve => window.setTimeout(resolve, delay));
const test = async (name, body) => {
    report({phase: 'running', name});
    await body();
    report({phase: 'passed', name});
};
const id = 'aabbccddeeff';
void (async () => {
    await test('ConnectionBroker default timers: verified success', async () => {
        const broker = new ConnectionBroker();
        const candidate = {};
        const selected = await broker.select(id, {
            routes: [{kind: 'wifi', acquire: async () => candidate}],
            verify: async value => value === candidate,
            timeoutMs: 5000
        });
        assert(selected === candidate && broker.get(id).state === 'ready', 'successful acquisition was not retained');
        broker.invalidate(id);
    });
    await test('ConnectionBroker default timers: timed route fallback', async () => {
        const broker = new ConnectionBroker();
        const attempted = [];
        const candidate = {};
        const selected = await broker.select(id, {
            routes: [
                {kind: 'mesh', timeoutMs: 30, acquire: () => { attempted.push('mesh'); return new Promise(() => {}); }},
                {kind: 'wifi', acquire: async () => { attempted.push('wifi'); return candidate; }}
            ],
            verify: async value => value === candidate,
            timeoutMs: 5000
        });
        assert(selected === candidate && attempted.join(',') === 'mesh,wifi', 'timed route did not fall back to Wi-Fi');
        broker.invalidate(id);
    });
    await test('ConnectionBroker default timers: cancelled acquisition', async () => {
        const broker = new ConnectionBroker();
        const controller = new AbortController();
        const pending = broker.select(id, {
            routes: [{kind: 'wifi', acquire: () => new Promise(() => {})}],
            verify: async () => true,
            signal: controller.signal,
            timeoutMs: 5000
        });
        controller.abort();
        let failure;
        try { await pending; } catch (error) { failure = error; }
        assert(failure?.cancelled === true, 'cancellation did not retain its expected result: ' + failure);
    });
    await test('LiveLightQueue default timers: latest values coalesce', async () => {
        const sent = [];
        const scope = {id, target: 'lamp', epoch: 1, token: 'test', mode: 1};
        await new Promise((resolve, reject) => {
            const queue = new LiveLightQueue({
                send: async change => sent.push([change.operation, change.value, change.option]),
                current: () => true,
                error: reject,
                settled: resolve,
                delay: 20
            });
            queue.schedule(scope, 'brightness', 1);
            queue.schedule(scope, 'brightness', 99);
            queue.schedule(scope, 'effectOptions', 42, 'speed');
        });
        assert(JSON.stringify(sent) === JSON.stringify([['brightness', 99, null], ['effectOptions', 42, 'speed']]),
            'unexpected coalesced commands: ' + JSON.stringify(sent));
    });
    await test('LiveLightQueue default timers: cancellation clears its timer', async () => {
        const sent = [];
        const scope = {id, target: 'lamp', epoch: 1, token: 'test', mode: 1};
        const queue = new LiveLightQueue({send: async change => sent.push(change), current: () => true, delay: 20});
        queue.schedule(scope, 'brightness', 20);
        queue.cancel();
        assert(!queue.pending, 'cancelled queue still has pending values');
        await pause(60);
        assert(sent.length === 0, 'a cancelled command was sent');
    });
    report({phase: 'complete'});
})().catch(fail);
"""#

_ = NSApplication.shared
NSApplication.shared.setActivationPolicy(.prohibited)
let runner = WindowTimerSmoke(script: "(() => {\n'use strict';\n" + modules + tests + "\n})();")
let deadline = Date().addingTimeInterval(25)
runner.start()
while runner.result == nil && Date() < deadline {
    RunLoop.current.run(mode: .default, before: min(deadline, Date().addingTimeInterval(0.05)))
}
if runner.result == nil { runner.fail("exceeded the 25 second watchdog") }
runner.webView.configuration.userContentController.removeScriptMessageHandler(forName: "smoke")
exit(runner.result ?? 1)
